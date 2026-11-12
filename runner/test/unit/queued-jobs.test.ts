// docs/protocol.md, "Queued jobs": a job waiting for its turn on a lock says
// so, and the thread's summary carries it until it has its turn or is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { makeHarness } from '../helpers/fakes.ts';
import { CallerGate } from '../../src/rpc-gate.ts';
import { ErrorCode } from '../../src/protocol.ts';

const until = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), what);
};

test('a job says it is queued, then that it has its turn; the summary follows', () => {
  const h = makeHarness();
  const { thread } = h.runner.create({ text: 'Land it', accountId: 'claude-3' });
  h.runner.setQueued(thread.id, { id: 'land-1', pid: process.pid, queued: true, what: 'tb land', behind: 'another landing of this repo' });
  const [job] = h.runner.get(thread.id).queued ?? [];
  assert.equal(job.id, 'land-1');
  assert.equal(job.what, 'tb land');
  assert.equal(job.behind, 'another landing of this repo');
  assert.ok(job.since);
  assert.equal('pid' in job, false, 'the pid stays on the runner');
  // Said again: the same entry, its time kept.
  h.runner.setQueued(thread.id, { id: 'land-1', pid: process.pid, queued: true, what: 'tb land' });
  assert.equal(h.runner.get(thread.id).queued?.length, 1);
  assert.equal(h.runner.get(thread.id).queued?.[0].since, job.since);
  h.runner.setQueued(thread.id, { id: 'land-1', pid: process.pid, queued: false });
  assert.equal(h.runner.get(thread.id).queued, undefined);
  // An end for a job it never heard of changes nothing.
  h.runner.setQueued(thread.id, { id: 'never', pid: process.pid, queued: false });
  assert.equal(h.runner.get(thread.id).queued, undefined);
});

test('a queued job whose process has gone drops off by itself', async () => {
  const h = makeHarness(undefined, {}, {});
  const { thread } = h.runner.create({ text: 'Build it', accountId: 'claude-3' });
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  await new Promise((r) => child.once('spawn', r));
  h.runner.setQueued(thread.id, { id: 'build-1', pid: child.pid!, queued: true, what: 'swift build' });
  assert.equal(h.runner.get(thread.id).queued?.length, 1);
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
  await until(() => h.runner.get(thread.id).queued === undefined, 'dropped once its process went');
});

test("a thread's own key reports only its own jobs", () => {
  const h = makeHarness();
  const mine = h.runner.create({ text: 'Mine', accountId: 'claude-3', permissionMode: 'ask' }).thread;
  const other = h.runner.create({ text: 'Other', accountId: 'claude-3', permissionMode: 'ask' }).thread;
  const gate = new CallerGate({ runner: h.runner });
  const p = { threadId: mine.id, id: 'x', pid: 1, queued: true };
  assert.deepEqual(gate.check(mine.id, 'threads.queued', p), p);
  assert.throws(() => gate.check(mine.id, 'threads.queued', { ...p, threadId: other.id }), (e: { code?: number }) => e.code === ErrorCode.notAllowed);
});
