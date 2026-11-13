// GitHub Actions runs in Highlights (experiment ciRuns; ci-runs.ts and
// runner/ci-runs.ts): the runs a thread's pushes and dispatches set off,
// asked of `gh` only while one is queued or running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarness, tmpDir } from '../helpers/fakes.ts';
import { PATIENCE_MS } from '../helpers/patience.ts';
import { EXPERIMENTS } from '../../src/experiments.ts';
import { addWatches, check, delayMs, emptyCiRuns, shellQuote, statusOf, watching } from '../../src/ci-runs.ts';
import { dispatchOf, emptyHighlights, observe, pushedRepo } from '../../src/highlights.ts';
import type { PersistedEvent } from '../../src/protocol.ts';

const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const T0 = Date.parse('2026-11-12T10:00:00.000Z');

let seq = 0;
function ev(body: Record<string, unknown>, ts = '2026-11-12T10:00:00.000Z'): PersistedEvent {
  seq++;
  return { seq, ts, threadId: 't', ...body } as PersistedEvent;
}

const ghRun = (id: number, workflow: string, status: string, conclusion = '', at = '2026-11-12T10:00:05Z') => ({
  databaseId: id, status, conclusion, workflowName: workflow, headSha: FULL, headBranch: 'feat', url: `https://github.com/o/r/actions/runs/${id}`, event: 'push', createdAt: at,
});

test('ciRuns: off by default, with a check-in booked', () => {
  const x = EXPERIMENTS.find((e) => e.id === 'ciRuns');
  assert.equal(x?.on, false);
  assert.match(x?.reminder ?? '', /^[0-9a-f]{8}$/);
});

test('ciRuns: GitHub states read as queued, running, passed, failed, cancelled or skipped', () => {
  assert.equal(statusOf('queued', ''), 'queued');
  assert.equal(statusOf('pending', ''), 'queued');
  assert.equal(statusOf('waiting', ''), 'queued');
  assert.equal(statusOf('in_progress', ''), 'running');
  assert.equal(statusOf('completed', 'success'), 'passed');
  assert.equal(statusOf('completed', 'failure'), 'failed');
  assert.equal(statusOf('completed', 'timed_out'), 'failed');
  assert.equal(statusOf('completed', 'cancelled'), 'cancelled');
  assert.equal(statusOf('completed', 'skipped'), 'skipped');
  assert.equal(shellQuote(['-w', "it's ci.yml"]), `'-w' 'it'\\''s ci.yml'`);
});

test('ciRuns: the repo comes from a push to GitHub, and a dispatch from gh workflow run', () => {
  assert.equal(pushedRepo('To https://github.com/mikecann/threadbear.git\n   a..b  main -> main'), 'mikecann/threadbear');
  assert.equal(pushedRepo('To github.com:o/r.git\n'), undefined);
  assert.equal(pushedRepo('To git@github.com:o/r.git\n * [new branch] x -> x'), 'o/r');
  assert.equal(pushedRepo('To https://x-access-token@github.com/o/r\n'), 'o/r');
  assert.equal(pushedRepo('To https://gitlab.com/o/r.git\n'), undefined);
  assert.deepEqual(dispatchOf('gh workflow run deploy.yml --ref feat -f env=prod', '✓ Created workflow_dispatch event for deploy.yml at feat'), { workflow: 'deploy.yml', ref: 'feat' });
  assert.deepEqual(dispatchOf('cd app && gh workflow run "Deploy preview" -R o/r && echo ok', ''), { workflow: 'Deploy preview', repo: 'o/r' });
  assert.deepEqual(dispatchOf('gh workflow run ci.yml', 'https://github.com/o/r/actions/runs/99\n'), { workflow: 'ci.yml', runId: 99, repo: 'o/r' });
  assert.equal(dispatchOf('gh workflow list', ''), undefined);
  // A re-run is followed by its run's id.
  assert.deepEqual(dispatchOf('gh run rerun 43395974641 --failed -R o/r', '✓ Requested rerun (failed jobs) of run 43395974641'), { workflow: '', runId: 43395974641, repo: 'o/r' });
  assert.deepEqual(dispatchOf('gh run rerun https://github.com/o/r/actions/runs/77', ''), { workflow: '', runId: 77, repo: 'o/r' });
  assert.deepEqual(dispatchOf('gh run rerun --job 5 12', ''), { workflow: '', runId: 12 });
  assert.equal(dispatchOf('gh run rerun', ''), undefined, 'gh asks which run: nothing to follow');
});

test('ciRuns: pushed commits and dispatches become watches, once each', () => {
  const hl = emptyHighlights();
  observe(hl, [
    ev({ type: 'tool.call', itemId: 'c', name: 'Bash', kind: 'command', title: '', input: { command: 'git commit -m x' } }),
    ev({ type: 'tool.result', itemId: 'c', ok: true, text: '[feat a1b2c3d] Fix it\n', truncated: false, images: [] }),
    ev({ type: 'tool.call', itemId: 'u', name: 'Bash', kind: 'command', title: '', input: { command: 'git commit -m y' } }),
    ev({ type: 'tool.result', itemId: 'u', ok: true, text: '[other 0000aaa] Not pushed\n', truncated: false, images: [] }),
    ev({ type: 'tool.call', itemId: 'p', name: 'Bash', kind: 'command', title: '', input: { command: 'git push' } }),
    ev({ type: 'tool.result', itemId: 'p', ok: true, text: 'To https://github.com/o/r.git\n   0123456..a1b2c3d  feat -> feat\n', truncated: false, images: [] }, '2026-11-12T10:00:01.000Z'),
    ev({ type: 'tool.call', itemId: 'd', name: 'Bash', kind: 'command', title: '', input: { command: 'gh workflow run deploy.yml' } }),
    ev({ type: 'tool.result', itemId: 'd', ok: true, text: 'Created workflow_dispatch event\n', truncated: false, images: [] }),
  ], { cwd: '/x', home: '/h', exists: () => false });
  const commit = hl.items.find((i) => i.id === 'commit:a1b2c3d')!;
  assert.equal(commit.repo, 'o/r');
  assert.equal(commit.pushedAt, '2026-11-12T10:00:01.000Z');
  const state = emptyCiRuns();
  assert.equal(addWatches(state, hl), true);
  assert.deepEqual(state.watches.map((w) => [w.key.split(':')[0], w.sha ?? w.workflow, w.repo]), [['commit', 'a1b2c3d', 'o/r'], ['dispatch', 'deploy.yml', undefined]]);
  assert.equal(addWatches(state, hl), false);
});

test('ciRuns: asks while runs go, backs off when quiet, and stops once they finish', async () => {
  const state = emptyCiRuns();
  state.watches.push({ key: 'commit:a1b2c3d', sha: 'a1b2c3d', repo: 'o/r', since: new Date(T0).toISOString() });
  let answer = [ghRun(1, 'CI', 'queued'), ghRun(2, 'Lint', 'in_progress')];
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return JSON.stringify(answer);
  };
  const revParse = async () => FULL;
  assert.equal(await check(state, gh, revParse, T0 + 5_000), true);
  assert.deepEqual(calls[0].slice(0, 6), ['run', 'list', '-R', 'o/r', '--commit', FULL]);
  assert.deepEqual(state.runs.map((r) => [r.workflow, r.status, r.sha, r.url]), [
    ['CI', 'queued', 'a1b2c3d', 'https://github.com/o/r/actions/runs/1'],
    ['Lint', 'running', 'a1b2c3d', 'https://github.com/o/r/actions/runs/2'],
  ]);
  assert.equal(delayMs(state), 15_000);
  // Nothing new: quieter each time, up to two minutes.
  assert.equal(await check(state, gh, revParse, T0 + 20_000), false);
  assert.equal(delayMs(state), 30_000);
  for (let i = 0; i < 5; i++) await check(state, gh, revParse, T0 + 30_000);
  assert.equal(delayMs(state), 120_000);
  // All finished, past the settling time: done, and asked no more.
  answer = [ghRun(1, 'CI', 'completed', 'failure'), ghRun(2, 'Lint', 'completed', 'success')];
  assert.equal(await check(state, gh, revParse, T0 + 60_000), true);
  assert.deepEqual(state.runs.map((r) => r.status), ['failed', 'passed']);
  assert.equal(watching(state), false);
});

test('ciRuns: a push with no runs is let go after three minutes; a failing gh is tried again', async () => {
  const state = emptyCiRuns();
  state.watches.push({ key: 'commit:a1b2c3d', sha: 'a1b2c3d', since: new Date(T0).toISOString() });
  let fail = true;
  const gh = async () => {
    if (fail) throw new Error('gh: not logged in');
    return '[]';
  };
  // Without a full sha nothing is asked.
  await check(state, gh, async () => undefined, T0 + 10_000);
  assert.equal(watching(state), true);
  await check(state, gh, async () => FULL, T0 + 10_000);
  assert.equal(watching(state), true);
  fail = false;
  await check(state, gh, async () => FULL, T0 + 60_000);
  assert.equal(watching(state), true);
  await check(state, gh, async () => FULL, T0 + 4 * 60_000);
  assert.equal(watching(state), false);
});

test('ciRuns: a re-run of a finished run shows it going again, and follows it until it finishes', async () => {
  const state = emptyCiRuns();
  state.runs.push({ id: 'run:5', workflow: 'Lint', status: 'failed', url: 'https://github.com/o/r/actions/runs/5', sha: 'a1b2c3d', at: '2026-11-11T10:00:00Z' });
  const hl = emptyHighlights();
  observe(hl, [
    ev({ type: 'tool.call', itemId: 'r', name: 'Bash', kind: 'command', title: '', input: { command: 'gh run rerun 5 -R o/r' } }),
    ev({ type: 'tool.result', itemId: 'r', ok: true, text: '✓ Requested rerun of run 5\n', truncated: false, images: [] }, '2026-11-12T10:00:00.000Z'),
  ], { cwd: '/x', home: '/h', exists: () => false });
  assert.equal(addWatches(state, hl), true);
  let status = 'queued';
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return JSON.stringify({ ...ghRun(5, 'Lint', status, status === 'completed' ? 'success' : ''), createdAt: '2026-11-11T10:00:00Z' });
  };
  assert.equal(await check(state, gh, async () => undefined, T0 + 5_000), true);
  assert.deepEqual(calls[0].slice(0, 5), ['run', 'view', '5', '-R', 'o/r']);
  assert.equal(state.runs[0].status, 'queued');
  status = 'completed';
  await check(state, gh, async () => undefined, T0 + 60_000);
  assert.equal(state.runs[0].status, 'passed');
  assert.equal(watching(state), false);
});

test('ciRuns: a dispatch finds its own run, then follows it by id', async () => {
  const state = emptyCiRuns();
  state.watches.push({ key: 'dispatch:4', workflow: 'deploy.yml', ref: 'feat', since: '2026-11-12T10:00:00.000Z' });
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[1] === 'view') return JSON.stringify({ ...ghRun(7, 'Deploy', 'completed', 'success', '2026-11-12T10:00:03Z'), event: 'workflow_dispatch' });
    return JSON.stringify([
      { ...ghRun(8, 'Deploy', 'queued', '', '2026-11-12T10:20:00Z'), event: 'workflow_dispatch' },
      { ...ghRun(7, 'Deploy', 'queued', '', '2026-11-12T10:00:03Z'), event: 'workflow_dispatch' },
      { ...ghRun(6, 'Deploy', 'completed', 'success', '2026-11-11T09:00:00Z'), event: 'workflow_dispatch' },
    ]);
  };
  await check(state, gh, async () => undefined, T0 + 5_000);
  assert.deepEqual(calls[0], ['run', 'list', '-w', 'deploy.yml', '-e', 'workflow_dispatch', '-L', '10', '--json', calls[0][9], '-b', 'feat']);
  assert.deepEqual(state.runs.map((r) => r.id), ['run:7']);
  assert.equal(state.watches[0].runId, 7);
  await check(state, gh, async () => undefined, T0 + 60_000);
  assert.deepEqual(calls[1].slice(0, 3), ['run', 'view', '7']);
  assert.equal(state.runs[0].status, 'passed');
  assert.equal(watching(state), false);
});

async function until(ok: () => boolean, what: string): Promise<void> {
  const end = Date.now() + PATIENCE_MS;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function setup(on = true) {
  const home = tmpDir();
  if (on) fs.writeFileSync(path.join(home, 'runner.json'), JSON.stringify({ experiments: { ciRuns: true } }));
  const h = makeHarness(home);
  const commands: string[] = [];
  let runs = [ghRun(1, 'CI', 'in_progress')];
  h.runner.ciShell = async (_cwd, command) => {
    commands.push(command);
    if (command.startsWith('git rev-parse')) return `${FULL}\n`;
    return JSON.stringify(runs);
  };
  const { thread } = h.runner.create({ text: 'Ship it', accountId: 'claude-main' });
  const s = h.adapter.sessions.at(-1)!;
  s.init();
  const push = () => {
    s.out({ kind: 'event', event: { type: 'tool.call', itemId: 'c', name: 'Bash', kind: 'command', title: 'commit', input: { command: 'git commit -m "Fix it"' } } });
    s.out({ kind: 'event', event: { type: 'tool.result', itemId: 'c', ok: true, text: '[feat a1b2c3d] Fix it\n', truncated: false, images: [] } });
    s.out({ kind: 'event', event: { type: 'tool.call', itemId: 'p', name: 'Bash', kind: 'command', title: 'push', input: { command: 'git push' } } });
    s.out({ kind: 'event', event: { type: 'tool.result', itemId: 'p', ok: true, text: 'To https://github.com/o/r.git\n   0123456..a1b2c3d  feat -> feat\n', truncated: false, images: [] } });
  };
  return { h, id: thread.id, push, commands, setRuns: (r: typeof runs) => (runs = r) };
}

test('ciRuns: a push in a thread shows its runs in Highlights, and the runner stops asking once they finish', async () => {
  const { h, id, push, commands, setRuns } = setup();
  push();
  await until(() => Boolean(h.runner.threads.get(id)!.rt.ciTimer), 'a look booked');
  assert.equal(commands.length, 0);
  h.clock.advance(5_000);
  await until(() => (h.runner.highlights(id).runs?.length ?? 0) > 0, 'the run');
  assert.deepEqual(h.runner.highlights(id).runs!.map((r) => [r.workflow, r.status]), [['CI', 'running']]);
  assert.ok(h.runner.get(id).highlightsAt, 'clients are told to fetch again');
  assert.match(commands.find((c) => c.startsWith('gh'))!, /^gh 'run' 'list' '-R' 'o\/r' '--commit' 'a1b2c3d4/);
  setRuns([ghRun(1, 'CI', 'completed', 'success')]);
  h.clock.advance(60_000);
  await until(() => h.runner.highlights(id).runs?.[0].status === 'passed', 'passed');
  // Past the settling time, one more look closes it.
  const rec = h.runner.threads.get(id)!;
  await until(() => !rec.rt.ciChecking && Boolean(rec.rt.ciTimer), 'the next look booked');
  h.clock.advance(2 * 60_000);
  await until(() => !rec.rt.ciChecking && !rec.rt.ciTimer, 'the watch to close');
  assert.equal(rec.rec.ciRuns?.watches.every((w) => w.done), true);
  const asked = commands.length;
  h.clock.advance(10 * 60_000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(commands.length, asked, 'nothing more asked');
});

test('ciRuns: a re-run in a thread is followed even though gh prints nothing', async () => {
  const { h, id, commands, setRuns } = setup();
  setRuns([{ ...ghRun(5, 'Lint', 'queued'), createdAt: '2026-11-11T10:00:00Z' }]);
  const s = h.adapter.sessions.at(-1)!;
  s.out({ kind: 'event', event: { type: 'tool.call', itemId: 'r', name: 'Bash', kind: 'command', title: 'rerun', input: { command: 'gh run rerun 5 -R o/r' } } });
  s.out({ kind: 'event', event: { type: 'tool.result', itemId: 'r', ok: true, text: '', truncated: false, images: [] } });
  await until(() => Boolean(h.runner.threads.get(id)!.rt.ciTimer), 'a look booked');
  h.clock.advance(5_000);
  await until(() => h.runner.highlights(id).runs?.[0]?.id === 'run:5', 'the re-run');
  assert.match(commands.at(-1)!, /^gh 'run' 'view' '5' '-R' 'o\/r'/);
});

test('ciRuns: off, or archived, nothing is asked and no runs are shown', async () => {
  const off = setup(false);
  off.push();
  off.h.clock.advance(60_000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(off.commands.length, 0);
  assert.equal(off.h.runner.highlights(off.id).runs, undefined);

  const on = setup();
  on.push();
  await until(() => Boolean(on.h.runner.threads.get(on.id)!.rt.ciTimer), 'a look booked');
  on.h.runner.threads.get(on.id)!.rec.archivedAt = '2026-11-12T10:00:00.000Z';
  on.h.clock.advance(60_000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(on.commands.length, 0);
});
