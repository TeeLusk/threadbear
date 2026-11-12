// GitHub Actions runs in a thread's Highlights (experiment ciRuns,
// ci-runs.ts; docs/protocol.md, "Highlights"). Looked at when a command's
// result looks like a push or a `gh workflow run`, and when a client fetches
// the thread's highlights (so a restart picks them up again). Then again on
// a timer, only while a run is queued or running, and never for an archived
// thread. Each method's `this` is the Runner; runner.ts puts them on its
// prototype.
import { execFile } from 'node:child_process';
import type { Runner, ThreadState } from '../runner.ts';
import type { RunnerPart } from './part.ts';
import type { EventBody } from '../protocol.ts';
import { experimentOn } from '../experiments.ts';
import { loginShell } from '../system-tools.ts';
import { addWatches, check, delayMs, emptyCiRuns, shellQuote, watching, type Gh, type RevParse } from '../ci-runs.ts';

// The first look waits a little: GitHub makes the runs a few seconds after
// the push.
const FIRST_LOOK_MS = 5_000;
const GH_TIMEOUT_MS = 20_000;

// A tool result that may have set off runs: git push's "a..b x -> y" or
// "[new branch]" line, or what `gh workflow run` prints.
const MAYBE_RUNS = /->|workflow_dispatch|actions\/runs\//;

export type CiShell = (cwd: string, command: string) => Promise<string>;

function shell(cwd: string, command: string): Promise<string> {
  const [bin, ...args] = loginShell();
  return new Promise((resolve, reject) => {
    execFile(bin, [...args, command], { cwd, encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

export const ciRunsPart = {
  // From emit: a command's result that looks like a push or a dispatch.
  ciRunsEvent(this: Runner, st: ThreadState, body: EventBody): void {
    if (body.type !== 'tool.result' || !body.ok || !MAYBE_RUNS.test(body.text ?? '')) return;
    if (!experimentOn(this.cfg.home, 'ciRuns')) return;
    // After this event is in the log, so catching up sees it.
    queueMicrotask(() => this.kickCiRuns(st));
  },

  // Picks up anything new to watch and makes sure a look is booked.
  kickCiRuns(this: Runner, st: ThreadState): void {
    if (st.rt.deleted || st.rec.archivedAt || !experimentOn(this.cfg.home, 'ciRuns')) return;
    this.catchUpHighlights(st);
    const state = (st.rec.ciRuns ??= emptyCiRuns());
    const added = addWatches(state, st.rec.highlights!);
    if (added) this.markDirty(st);
    if (!watching(state) || st.rt.ciChecking) return;
    if (added) st.rt.ciTimer?.cancel();
    else if (st.rt.ciTimer) return;
    st.rt.ciTimer = this.clock.setTimeout(() => void this.checkCiRuns(st), added ? FIRST_LOOK_MS : delayMs(state));
  },

  async checkCiRuns(this: Runner, st: ThreadState): Promise<void> {
    st.rt.ciTimer = undefined;
    const state = st.rec.ciRuns;
    if (!state || st.rt.deleted || st.rec.archivedAt || !experimentOn(this.cfg.home, 'ciRuns')) return;
    const run = this.ciShell ?? shell;
    const cwd = st.rec.cwd;
    const gh: Gh = (args) => run(cwd, `gh ${shellQuote(args)}`);
    const revParse: RevParse = async (sha) => {
      if (!/^[0-9a-f]{4,40}$/.test(sha)) return undefined;
      try {
        return (await run(cwd, `git rev-parse --verify -q ${shellQuote([`${sha}^{commit}`])}`)).trim() || undefined;
      } catch {
        return undefined;
      }
    };
    st.rt.ciChecking = true;
    const open = state.watches.filter((w) => !w.done).length;
    let changed = false;
    try {
      changed = await check(state, gh, revParse, this.clock.now());
    } finally {
      st.rt.ciChecking = false;
    }
    if (st.rt.deleted) return;
    // Saved only when something moved: a quiet look sends no summary.
    if (changed) this.highlightsChanged(st);
    else if (state.watches.filter((w) => !w.done).length !== open) this.markDirty(st);
    // A push while this look ran may have added a watch.
    addWatches(state, st.rec.highlights ?? { seq: 0, items: [], edited: [] });
    if (watching(state) && !st.rec.archivedAt && !st.rt.ciTimer) {
      st.rt.ciTimer = this.clock.setTimeout(() => void this.checkCiRuns(st), delayMs(state));
    }
  },
};

export type CiRunsPart = RunnerPart<typeof ciRunsPart>;
