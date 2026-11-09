// Long threads (docs/protocol.md, "Long threads"): the thresholds, the
// count dropped after /compact, and Continue in a new thread's handoff.
// Fake adapters (fakes.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, tick } from '../helpers/fakes.ts';
import { contextLong, contextNudgeConfig, DEFAULT_CONTEXT_NUDGE, HANDOFF_PROMPT, handoffMessage } from '../../src/context-nudge.ts';

const notes = (h: { events(id: string): any[] }, id: string): string[] => h.events(id).filter((e) => e.type === 'system.note').map((e) => e.text);

test('contextLong: gentle from 150K, firm from 250K, nothing under or unknown', () => {
  assert.equal(contextLong(undefined, undefined), undefined);
  assert.equal(contextLong(149_999, undefined), undefined);
  assert.equal(contextLong(150_000, undefined), 'gentle');
  assert.equal(contextLong(249_999, DEFAULT_CONTEXT_NUDGE), 'gentle');
  assert.equal(contextLong(250_000, DEFAULT_CONTEXT_NUDGE), 'firm');
  assert.equal(contextLong(900_000, null), undefined, 'turned off');
  assert.equal(contextLong(60_000, { gentle: 50_000, firm: 100_000 }), 'gentle');
});

test('contextNudgeConfig reads runner.json, key by key, and false turns it off', () => {
  assert.deepEqual(contextNudgeConfig(undefined), DEFAULT_CONTEXT_NUDGE);
  assert.equal(contextNudgeConfig(false), null);
  assert.deepEqual(contextNudgeConfig({ gentle: 100_000 }), { gentle: 100_000, firm: 250_000 });
  assert.deepEqual(contextNudgeConfig({ gentle: 'lots', firm: -1 }), DEFAULT_CONTEXT_NUDGE);
  // A firm level under the gentle one is raised to it.
  assert.deepEqual(contextNudgeConfig({ gentle: 300_000, firm: 200_000 }), { gentle: 300_000, firm: 300_000 });
});

test('a thread past a threshold says so on its summary', async () => {
  const h = makeHarness(undefined, { contextNudge: { gentle: 1000, firm: 2000 } });
  const { thread } = h.runner.create({ text: 'hi', accountId: 'claude-main' });
  const s = h.adapter.last;
  s.init();
  s.out({ kind: 'context', contextTokens: 500 });
  assert.equal(h.runner.get(thread.id).contextLong, undefined);
  s.out({ kind: 'context', contextTokens: 1500 });
  assert.equal(h.runner.get(thread.id).contextLong, 'gentle');
  s.out({ kind: 'context', contextTokens: 2500 });
  assert.equal(h.runner.get(thread.id).contextLong, 'firm');
});

test('a /compact drops the old count, so the card goes; a newer count stays', async () => {
  const h = makeHarness();
  const { thread } = h.runner.create({ text: 'hi', accountId: 'claude-main' });
  const s = h.adapter.last;
  s.init();
  s.out({ kind: 'context', contextTokens: 300_000 });
  s.result();
  h.runner.send(thread.id, '/compact');
  await tick();
  // Claude's result repeats the count it had.
  s.out({ kind: 'context', contextTokens: 300_000, contextWindow: 1_000_000 });
  s.result();
  await tick();
  assert.equal(h.runner.get(thread.id).contextTokens, undefined);
  assert.equal(h.runner.get(thread.id).contextLong, undefined);

  // One whose CLI reports the compacted size keeps it.
  h.runner.send(thread.id, 'more');
  await tick();
  s.out({ kind: 'context', contextTokens: 200_000 });
  s.result();
  h.runner.send(thread.id, '/compact');
  await tick();
  s.out({ kind: 'context', contextTokens: 20_000 });
  s.result();
  await tick();
  assert.equal(h.runner.get(thread.id).contextTokens, 20_000);
});

test('Continue in a new thread asks for a handoff, then starts a thread with it and links the two', async () => {
  const h = makeHarness();
  const { thread } = h.runner.create({ text: 'build the thing', accountId: 'claude-main', model: 'claude-opus-5-5', effort: 'high', permissionMode: 'ask', title: 'The thing' });
  const s = h.adapter.last;
  s.init();
  s.out({ kind: 'context', contextTokens: 300_000 });
  s.result();
  await tick();

  const { turnId } = h.runner.continueFresh(thread.id);
  await tick();
  assert.equal(s.sent.at(-1)!.text.includes(HANDOFF_PROMPT), true, 'the agent is asked for the handoff');
  assert.equal(h.runner.get(thread.id).continuing, true);
  assert.throws(() => h.runner.continueFresh(thread.id), /working|already/);

  s.text('h1', 'Done: the parser. Open: the tests. Files: src/x.ts');
  s.result();
  await tick();

  const old = h.runner.get(thread.id);
  assert.equal(old.continuing, undefined);
  assert.ok(old.continuedIn, 'the old thread links to the new one');
  assert.equal(old.archivedAt, undefined, 'and is left where it is');
  assert.match(notes(h, thread.id).at(-1)!, /Continued in a new thread/);
  const fresh = h.runner.get(old.continuedIn!.threadId);
  assert.equal(fresh.startedBy?.threadId, thread.id, 'the new thread links back');
  assert.equal(fresh.startedBy?.label, 'Continued');
  assert.equal(fresh.cwd, old.cwd);
  assert.equal(fresh.accountId, old.accountId);
  assert.equal(fresh.model, 'claude-opus-5-5');
  assert.equal(fresh.effort, 'high');
  assert.equal(fresh.permissionMode, 'ask');
  assert.equal(fresh.title, 'The thing (continued)');
  const first = h.events(fresh.id).find((e) => e.type === 'user.message');
  assert.match(first.text, /Carrying on from the thread "The thing"/);
  assert.match(first.text, /Done: the parser\. Open: the tests\./);
  assert.ok(turnId);
});

test('a handoff turn that fails starts no thread and says so', async () => {
  const h = makeHarness();
  const { thread } = h.runner.create({ text: 'hi', accountId: 'claude-main' });
  const s = h.adapter.last;
  s.init();
  s.result();
  await tick();
  const before = h.runner.list().length;
  h.runner.continueFresh(thread.id);
  await tick();
  s.result('failed', undefined, 'boom');
  await tick();
  assert.equal(h.runner.list().length, before);
  assert.equal(h.runner.get(thread.id).continuedIn, undefined);
  assert.equal(h.runner.get(thread.id).continuing, undefined);
  assert.match(notes(h, thread.id).at(-1)!, /No new thread/);
});

test('Continue in a new thread is refused while a turn is running', () => {
  const h = makeHarness();
  const { thread } = h.runner.create({ text: 'hi', accountId: 'claude-main' });
  assert.throws(() => h.runner.continueFresh(thread.id), /working/);
});

test('handoffMessage names a worktree\'s branch', () => {
  const text = handoffMessage({ id: 'abcdef123456', title: 'T', worktree: { path: '/w/slot-1', branch: 'thread/abcdef12' } }, ' the summary ');
  assert.match(text, /\(abcdef12\)/);
  assert.match(text, /thread\/abcdef12/);
  assert.ok(text.endsWith('the summary'));
});
