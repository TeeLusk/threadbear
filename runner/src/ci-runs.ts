// GitHub Actions runs a thread set off (experiment ciRuns; docs/protocol.md,
// "Highlights", Runs). The commits a thread pushed and the workflows it
// started with `gh workflow run` are found with its highlights
// (highlights.ts); this asks the `gh` CLI, on the user's own login, for the
// runs each one started, and keeps asking only while one is queued or
// running. Pure apart from the `gh` passed in, so tests give a fake.
import type { HighlightState } from './highlights.ts';

export type CiRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';

export type CiRun = {
  id: string; // "run:<GitHub's run id>"
  workflow: string;
  status: CiRunStatus;
  url: string;
  sha: string; // short
  branch?: string;
  event?: string; // push, pull_request, workflow_dispatch...
  at: string; // when GitHub made it
};

// One thing that sets off runs: a pushed commit, or a `gh workflow run`.
export type CiWatch = {
  key: string; // "commit:<short sha>" or "dispatch:<seq>"
  sha?: string; // short, as the commit line printed it
  full?: string; // the full sha, once looked up
  workflow?: string; // a dispatch's workflow
  ref?: string; // a dispatch's --ref
  runId?: number; // a dispatch's run, once found
  repo?: string; // owner/name, from the push's output or -R
  since: string; // when it was pushed or dispatched
  done?: true; // nothing more to ask about
};

export type CiRunsState = {
  watches: CiWatch[];
  runs: CiRun[];
  quiet: number; // checks in a row that found nothing new
};

// What is shown: the newest this many. Watches past WATCHES_KEPT are let go.
export const RUNS_KEPT = 30;
const WATCHES_KEPT = 20;
// Waits between checks: 15 s, doubling while nothing changes, at most 2 min.
export const FIRST_DELAY_MS = 15_000;
const MAX_DELAY_MS = 120_000;
// A push with no runs after this has none coming (no workflows, or none on
// that branch). A watch is let go after GIVE_UP_MS whatever its state.
const NO_RUNS_MS = 3 * 60_000;
const GIVE_UP_MS = 2 * 60 * 60_000;
// Runs come a few seconds after a push: all done before this may have more.
const SETTLE_MS = 30_000;

export function emptyCiRuns(): CiRunsState {
  return { watches: [], runs: [], quiet: 0 };
}

export function delayMs(state: CiRunsState): number {
  return Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** Math.min(state.quiet, 4));
}

export function watching(state: CiRunsState): boolean {
  return state.watches.some((w) => !w.done);
}

// Picks up commits the thread has pushed and workflows it dispatched since
// last time. Returns whether there is anything new to watch.
export function addWatches(state: CiRunsState, hl: HighlightState): boolean {
  let added = false;
  const have = new Set(state.watches.map((w) => w.key));
  for (const item of hl.items) {
    if (item.kind !== 'commit' || !item.pushed || !item.sha) continue;
    const key = `commit:${item.sha}`;
    if (have.has(key)) continue;
    const w: CiWatch = { key, sha: item.sha, since: item.pushedAt ?? item.at };
    if (item.repo) w.repo = item.repo;
    state.watches.push(w);
    have.add(key);
    added = true;
  }
  for (const d of hl.dispatches ?? []) {
    const key = `dispatch:${d.seq}`;
    if (have.has(key)) continue;
    const w: CiWatch = { key, workflow: d.workflow, since: d.at };
    if (d.ref) w.ref = d.ref;
    if (d.repo) w.repo = d.repo;
    if (d.runId) w.runId = d.runId;
    state.watches.push(w);
    have.add(key);
    added = true;
  }
  if (added) {
    state.quiet = 0;
    state.watches = state.watches.slice(-WATCHES_KEPT);
  }
  return added;
}

// Runs `gh` with these arguments in the thread's folder and resolves with
// what it printed; rejects when it fails.
export type Gh = (args: string[]) => Promise<string>;
// Resolves a short sha to the full one in the thread's folder, if git can.
export type RevParse = (sha: string) => Promise<string | undefined>;

export const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,headBranch,url,event,createdAt';

type GhRun = { databaseId: number; status: string; conclusion: string; workflowName: string; headSha: string; headBranch?: string; url: string; event?: string; createdAt: string };

export function statusOf(status: string, conclusion: string): CiRunStatus {
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'queued';
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion === 'skipped' || conclusion === 'neutral') return 'skipped';
  return 'failed';
}

export function toRun(g: GhRun): CiRun | undefined {
  if (typeof g?.databaseId !== 'number' || typeof g.url !== 'string' || !/^https:\/\//.test(g.url)) return undefined;
  const run: CiRun = {
    id: `run:${g.databaseId}`,
    workflow: String(g.workflowName || 'Workflow'),
    status: statusOf(String(g.status ?? ''), String(g.conclusion ?? '')),
    url: g.url,
    sha: String(g.headSha ?? '').slice(0, 7),
    at: String(g.createdAt ?? ''),
  };
  if (g.headBranch) run.branch = String(g.headBranch);
  if (g.event) run.event = String(g.event);
  return run;
}

function parse(out: string): CiRun[] {
  const data: unknown = JSON.parse(out || '[]');
  const list = Array.isArray(data) ? data : [data];
  return list.map((g) => toRun(g as GhRun)).filter((r): r is CiRun => Boolean(r));
}

const finished = (r: CiRun) => r.status !== 'queued' && r.status !== 'running';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const repoArgs = (w: CiWatch) => (w.repo && REPO.test(w.repo) ? ['-R', w.repo] : []);

// One look at every open watch. Returns whether the runs changed. A failing
// `gh` (not installed, not logged in, no network) is left for next time,
// and counts as a quiet check, so it backs off like one.
export async function check(state: CiRunsState, gh: Gh, revParse: RevParse, now: number): Promise<boolean> {
  let changed = false;
  for (const w of state.watches) {
    if (w.done) continue;
    const age = now - Date.parse(w.since);
    let found: CiRun[];
    try {
      found = await runsFor(w, gh, revParse);
    } catch {
      if (age > GIVE_UP_MS) w.done = true;
      continue;
    }
    for (const r of found) if (merge(state, r)) changed = true;
    const mine = w.runId ? found.filter((r) => r.id === `run:${w.runId}`) : found;
    if (age > GIVE_UP_MS) w.done = true;
    else if (!mine.length && age > NO_RUNS_MS) w.done = true;
    else if (mine.length && mine.every(finished) && age > SETTLE_MS) w.done = true;
  }
  state.runs.sort((a, b) => b.at.localeCompare(a.at));
  state.runs = state.runs.slice(0, RUNS_KEPT);
  state.quiet = changed ? 0 : state.quiet + 1;
  return changed;
}

async function runsFor(w: CiWatch, gh: Gh, revParse: RevParse): Promise<CiRun[]> {
  if (w.sha) {
    w.full ??= await revParse(w.sha) ?? (w.repo && REPO.test(w.repo) ? (await gh(['api', `repos/${w.repo}/commits/${w.sha}`, '--jq', '.sha'])).trim() : undefined);
    if (!w.full || !/^[0-9a-f]{40}$/.test(w.full)) throw new Error('no full sha');
    return parse(await gh(['run', 'list', ...repoArgs(w), '--commit', w.full, '-L', '30', '--json', RUN_FIELDS]));
  }
  if (w.runId) return parse(await gh(['run', 'view', String(w.runId), ...repoArgs(w), '--json', RUN_FIELDS]));
  if (!w.workflow) return [];
  // The run a `gh workflow run` started, when its output didn't say: the
  // first dispatch of that workflow since (GitHub's clock may be a little
  // ahead or behind, hence the minute).
  const args = ['run', 'list', ...repoArgs(w), '-w', w.workflow, '-e', 'workflow_dispatch', '-L', '10', '--json', RUN_FIELDS];
  if (w.ref) args.push('-b', w.ref);
  const after = Date.parse(w.since) - 60_000;
  const first = parse(await gh(args)).filter((r) => Date.parse(r.at) >= after).sort((a, b) => a.at.localeCompare(b.at))[0];
  if (first) w.runId = Number(first.id.slice(4));
  return first ? [first] : [];
}

// Adds a run or updates its state. Returns whether anything shown changed.
function merge(state: CiRunsState, r: CiRun): boolean {
  const i = state.runs.findIndex((x) => x.id === r.id);
  if (i < 0) {
    state.runs.push(r);
    return true;
  }
  const old = state.runs[i];
  if (old.status === r.status && old.workflow === r.workflow) return false;
  state.runs[i] = r;
  return true;
}

// Single quotes around each argument, for the login shell `gh` runs in.
export function shellQuote(args: string[]): string {
  return args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
}
