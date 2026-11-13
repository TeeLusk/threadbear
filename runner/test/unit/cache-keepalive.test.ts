// Keeping waiting threads' prompt cache warm (src/cache-keepalive.ts, the
// adapter's pingCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_TTL_MS, DEFAULT_KEEP_ALIVE, inHours, keepAliveConfig, pingPlan, warmState, type KeepWarmThread } from '../../src/cache-keepalive.ts';
import { ClaudeAdapter, PING_PROMPT } from '../../src/adapters/claude/adapter.ts';
import { ProcessRegistry } from '../../src/proc.ts';
import { nullLogger } from '../../src/log.ts';
import { tmpDir } from '../helpers/fakes.ts';

const MIN = 60_000;
// Monday 9 Nov 2026, 10:00 in Phoenix (UTC-7 all year).
const MON_10 = Date.parse('2026-11-09T17:00:00Z');
// Saturday 14 Nov 2026, 10:00 in Phoenix.
const SAT_10 = Date.parse('2026-11-14T17:00:00Z');
const phx = (iso: string) => Date.parse(`${iso}-07:00`);

function thread(o: Partial<KeepWarmThread> = {}, endedAt = MON_10 - 55 * MIN): KeepWarmThread {
  return {
    provider: 'claude',
    needsYou: true,
    busy: false,
    snoozed: false,
    archived: false,
    waiting: false,
    hasSession: true,
    confined: false,
    contextTokens: 80_000,
    lastTurnCompletedSeq: 40,
    lastActivityAt: new Date(endedAt).toISOString(),
    ...o,
  };
}

// The hours default to the Mac's own zone; these tests are in Phoenix's.
const cfg = { ...DEFAULT_KEEP_ALIVE, timeZone: 'America/Phoenix' };

test("keep-alive: defaults are on, 50K, 55 minutes, 3 pings, the Mac's own hours", () => {
  const c = keepAliveConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.minContextTokens, 50_000);
  assert.equal(c.intervalMs, 55 * MIN);
  assert.equal(c.maxPings, 3);
  assert.equal(c.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(c.weekdays, [7, 15]);
  assert.deepEqual(c.weekends, [7, 20]);
});

test('keep-alive: runner.json turns it off or changes the limits; bad values keep the defaults', () => {
  assert.equal(keepAliveConfig({ cacheKeepAlive: false }).enabled, false);
  assert.equal(keepAliveConfig({ cacheKeepAlive: { enabled: false } }).enabled, false);
  const c = keepAliveConfig({ cacheKeepAlive: { minContextTokens: 20_000, intervalMinutes: 50, maxPings: 5, timeZone: 'Europe/London', weekdays: [9, 17], weekends: [10, 12] } });
  assert.deepEqual(c, { enabled: true, minContextTokens: 20_000, intervalMs: 50 * MIN, maxPings: 5, timeZone: 'Europe/London', weekdays: [9, 17], weekends: [10, 12] });
  const bad = keepAliveConfig({ cacheKeepAlive: { intervalMinutes: 90, maxPings: -1, timeZone: 'Mars/Olympus', weekdays: [15, 7] } as never });
  assert.equal(bad.intervalMs, 55 * MIN, 'past the cache lifetime, a ping would come too late');
  assert.equal(bad.maxPings, 3);
  assert.equal(bad.timeZone, DEFAULT_KEEP_ALIVE.timeZone);
  assert.deepEqual(bad.weekdays, [7, 15]);
});

test('keep-alive: weekday hours are 7:00 to 15:00 and weekend hours 7:00 to 20:00, in Phoenix', () => {
  // Monday
  assert.equal(inHours(phx('2026-11-09T06:59:00'), cfg), false);
  assert.equal(inHours(phx('2026-11-09T07:00:00'), cfg), true);
  assert.equal(inHours(phx('2026-11-09T14:59:00'), cfg), true);
  assert.equal(inHours(phx('2026-11-09T15:00:00'), cfg), false);
  assert.equal(inHours(phx('2026-11-09T18:00:00'), cfg), false, 'weekday evening');
  // Friday evening is a weekday; Saturday evening isn't.
  assert.equal(inHours(phx('2026-11-13T18:00:00'), cfg), false);
  assert.equal(inHours(phx('2026-11-14T18:00:00'), cfg), true);
  assert.equal(inHours(phx('2026-11-14T19:59:00'), cfg), true);
  assert.equal(inHours(phx('2026-11-14T20:00:00'), cfg), false);
  assert.equal(inHours(phx('2026-11-15T06:30:00'), cfg), false, 'Sunday before 7');
  assert.equal(inHours(phx('2026-11-15T12:00:00'), cfg), true);
  // Sunday 23:30 UTC is Sunday afternoon in Phoenix, not Monday: the zone decides the day.
  assert.equal(inHours(Date.parse('2026-11-16T00:30:00Z'), cfg), true);
});

test('keep-alive: only a big Claude thread waiting on you, idle and with a session', () => {
  assert.deepEqual(pingPlan(thread(), cfg, MON_10), { due: true, pings: 0 });
  const no = (o: Partial<KeepWarmThread>, why: string) => assert.equal((pingPlan(thread(o), cfg, MON_10) as { why: string }).why, why);
  no({ provider: 'codex' }, 'not claude');
  no({ needsYou: false }, 'not in Needs you');
  no({ busy: true }, 'busy');
  no({ snoozed: true }, 'snoozed');
  no({ archived: true }, 'archived');
  no({ waiting: true }, 'waiting');
  no({ hasSession: false }, 'no session');
  no({ confined: true }, 'sandboxed');
  no({ contextTokens: 49_999 }, 'small context');
  no({ contextTokens: undefined }, 'small context');
  assert.equal(pingPlan(thread(), { ...cfg, enabled: false }, MON_10).due, false);
});

test('keep-alive: due 55 minutes after the last call, never once the cache has gone', () => {
  const end = MON_10 - 30 * MIN;
  const plan = pingPlan(thread({}, end), cfg, MON_10);
  assert.deepEqual(plan, { due: false, why: 'not yet', at: end + 55 * MIN });
  assert.equal(pingPlan(thread({}, end), cfg, end + 54 * MIN).due, false);
  assert.equal(pingPlan(thread({}, end), cfg, end + 55 * MIN).due, true);
  assert.equal(pingPlan(thread({}, end), cfg, end + 59 * MIN).due, true);
  // An hour on, the cache has expired: a ping would pay to rebuild it.
  assert.equal((pingPlan(thread({}, end), cfg, end + CACHE_TTL_MS) as { why: string }).why, 'cache expired');
  assert.equal((pingPlan(thread({}, end), cfg, end + 8 * 60 * MIN) as { why: string }).why, 'cache expired');
});

test('keep-alive: outside the hours nothing is sent, weekday or weekend', () => {
  const weekdayEvening = phx('2026-11-09T16:00:00');
  assert.equal((pingPlan(thread({}, weekdayEvening - 55 * MIN), cfg, weekdayEvening) as { why: string }).why, 'outside hours');
  const saturdayEvening = phx('2026-11-14T16:00:00');
  assert.equal(pingPlan(thread({}, saturdayEvening - 55 * MIN), cfg, saturdayEvening).due, true, 'weekends run to 20:00');
  assert.equal(pingPlan(thread({}, SAT_10 - 55 * MIN), cfg, SAT_10).due, true);
});

test('keep-alive: at most 3 pings, each 55 minutes after the one before', () => {
  const end = MON_10 - 3 * 60 * MIN; // 7:00, so all three fall inside the hours
  let t = thread({}, end);
  let now = end + 55 * MIN;
  for (let i = 0; i < 3; i++) {
    const plan = pingPlan(t, cfg, now);
    assert.deepEqual(plan, { due: true, pings: i }, `ping ${i + 1}`);
    t = { ...t, keepWarm: { seq: t.lastTurnCompletedSeq, pings: i + 1, at: new Date(now).toISOString() } };
    assert.equal(pingPlan(t, cfg, now + 54 * MIN).due, false, 'not before 55 minutes from the last ping');
    now += 55 * MIN;
  }
  assert.equal((pingPlan(t, cfg, now) as { why: string }).why, 'ping limit');
});

test('keep-alive: a real turn (your message) starts the count again', () => {
  const t = thread({ keepWarm: { seq: 40, pings: 3, at: new Date(MON_10 - 60 * MIN).toISOString() } }, MON_10 - 4 * 60 * MIN);
  assert.equal((pingPlan(t, cfg, MON_10) as { why: string }).why, 'ping limit');
  // You answered: a new turn ran and finished at seq 52, 55 minutes ago.
  const after = { ...t, lastTurnCompletedSeq: 52, lastActivityAt: new Date(MON_10 - 55 * MIN).toISOString() };
  assert.deepEqual(warmState(after), { pings: 0, lastCallAt: MON_10 - 55 * MIN });
  assert.deepEqual(pingPlan(after, cfg, MON_10), { due: true, pings: 0 });
});

// A stand-in for the SDK's query() that records the options and answers
// with one result.
function fakeQuery(result: Record<string, unknown>) {
  const state: { options?: any; prompts: any[] } = { prompts: [] };
  const fn = ((args: { prompt: AsyncIterable<any>; options: any }) => {
    state.options = args.options;
    return (async function* () {
      for await (const m of args.prompt) state.prompts.push(m);
      yield { type: 'result', ...result };
    })();
  }) as any;
  return { fn, state };
}

const account = { id: 'claude-2', provider: 'claude' as const, title: 'x', configDir: '/tmp/x' };
function startOpts(dir: string) {
  return { threadId: 't1', cwd: dir, account, model: 'claude-opus-5-5', effort: 'high' as const, permissionMode: 'full' as const, sessionId: '00000000-0000-0000-0000-000000000009', resume: true, mediaDir: dir, blobsDir: dir, tmpDir: dir, allowRules: ['Bash(ls)'] };
}

test('pingCache: a fork of the session with the same prompt options, never saved, tools refused', async () => {
  const dir = tmpDir();
  const servers = { threadbear: { type: 'sdk', name: 'threadbear' } } as never;
  const { fn, state } = fakeQuery({ subtype: 'success', usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 66_384, cache_creation_input_tokens: 125 } });
  const adapter = new ClaudeAdapter({ claudePath: '/nonexistent', registry: new ProcessRegistry(dir, nullLogger), log: nullLogger, queryFn: fn, mcpServersFor: () => servers });
  const r = await adapter.pingCache(startOpts(dir));
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r, ms: 0 }, { ok: true, inputTokens: 2, outputTokens: 4, cacheReadTokens: 66_384, cacheWriteTokens: 125, ms: 0 });
  const o = state.options;
  assert.equal(o.resume, '00000000-0000-0000-0000-000000000009');
  assert.equal(o.forkSession, true);
  assert.equal(o.persistSession, false, 'nothing written, so no thread or archive sees it');
  assert.equal(o.maxTurns, 1);
  assert.equal(o.sessionId, undefined, 'the fork gets a new id of its own');
  assert.equal(o.resumeSessionAt, undefined);
  // What goes into the prompt matches a real session's, so the cache is read.
  assert.equal(o.model, 'claude-opus-5-5');
  assert.equal(o.effort, 'high');
  assert.equal(o.permissionMode, 'bypassPermissions');
  assert.deepEqual(o.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(o.systemPrompt, { type: 'preset', preset: 'claude_code' });
  assert.equal(o.mcpServers, servers);
  assert.ok(o.allowedTools.includes('Bash(ls)'));
  // Every tool call is refused, whatever the mode or allow rules.
  const deny = await o.hooks.PreToolUse[0].hooks[0]({ tool_name: 'Bash' });
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await o.canUseTool('Write', {}, {})).behavior, 'deny');
  assert.equal(o.hooks.Stop, undefined, "the thread's own hooks aren't there to send it back for more");
  assert.equal(state.prompts.length, 1);
  assert.equal(state.prompts[0].message.content, PING_PROMPT);
});

test('pingCache: a login out of room says so; a sandboxed thread is never pinged', async () => {
  const dir = tmpDir();
  const { fn } = fakeQuery({ subtype: 'success', is_error: true, result: "You've hit your usage limit" });
  const adapter = new ClaudeAdapter({ claudePath: '/nonexistent', registry: new ProcessRegistry(dir, nullLogger), log: nullLogger, queryFn: fn });
  const r = await adapter.pingCache(startOpts(dir));
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.limit, true);
  const boxed = await adapter.pingCache({ ...startOpts(dir), confined: true });
  assert.equal(boxed.ok, false);
});

test('runner: a due thread is pinged on its own login, counted, and nothing reaches the thread', async () => {
  const { makeHarness } = await import('../helpers/fakes.ts');
  const h = makeHarness();
  // An experiment, off until runner.json turns it on (experiments/cacheKeepAlive.md).
  const json = path.join(h.cfg.home, 'runner.json');
  fs.writeFileSync(json, JSON.stringify({ cacheKeepAlive: { timeZone: 'America/Phoenix' } }));
  const { thread } = h.runner.create({ text: 'Look into the cache', accountId: 'claude-3' });
  const s = h.adapter.last;
  s.init();
  s.text('a1', 'Which one do you want?');
  s.result('completed');
  const st = (h.runner as any).threads.get(thread.id);
  // Waiting on you, with a big context, its turn ended 55 minutes ago at
  // 10:00 on a Monday in Phoenix.
  h.clock.advance(MON_10 - h.clock.now());
  st.rec.needs = { seq: st.rec.lastTurnCompletedSeq, needs: 'you' };
  st.rec.contextTokens = 120_000;
  st.rec.lastActivityAt = new Date(MON_10 - 55 * MIN).toISOString();
  st.rt.session = undefined;
  const asked: any[] = [];
  (h.adapter as any).pingCache = async (opts: any) => {
    asked.push(opts);
    return { ok: true, inputTokens: 2, outputTokens: 4, cacheReadTokens: 119_000, cacheWriteTokens: 90, ms: 800 };
  };
  const before = h.events(thread.id).length;
  assert.equal((await h.runner.keepWarmTick()).length, 0, 'the experiment is off by default');
  fs.writeFileSync(json, JSON.stringify({ experiments: { cacheKeepAlive: true }, cacheKeepAlive: { timeZone: 'America/Phoenix' } }));
  const sent = await h.runner.keepWarmTick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].accountId, 'claude-3');
  assert.equal(asked[0].account.id, 'claude-3', 'the login the thread last ran on');
  assert.equal(asked[0].sessionId, st.rec.nativeSessionId);
  assert.equal(asked[0].resume, true);
  assert.deepEqual(st.rec.keepWarm, { seq: st.rec.lastTurnCompletedSeq, pings: 1, at: new Date(MON_10).toISOString() });
  assert.equal(h.events(thread.id).length, before, 'no events in the thread');
  // Not again until 55 minutes after this ping.
  assert.equal((await h.runner.keepWarmTick()).length, 0);
  h.clock.advance(55 * MIN);
  assert.equal((await h.runner.keepWarmTick()).length, 1);
  assert.equal(st.rec.keepWarm.pings, 2);
});
