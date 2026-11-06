import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersistedEvent } from '../../src/protocol.ts';
import { FakeClock } from '../../src/clock.ts';
import type { Logger } from '../../src/log.ts';
import type { Gh } from '../../src/pr-github.ts';
import type { TrackedPr } from '../../src/pr-status-types.ts';
import { PrStatus, FAST_MS, OPEN_MS, FIRST_MS } from '../../src/pr-status.ts';

const URL1 = 'https://github.com/acme/widgets/pull/12';
const URL2 = 'https://github.com/acme/widgets/pull/13';
let seq = 0;
function ev(body: Record<string, unknown>): PersistedEvent {
  seq++;
  return { seq, ts: '2026-11-06T10:00:00.000Z', threadId: 't', ...body } as PersistedEvent;
}
const call = (itemId: string, command: string) => ev({ type: 'tool.call', itemId, name: 'Bash', kind: 'command', title: command, input: { command } });
const result = (itemId: string, ok: boolean, text: string) => ev({ type: 'tool.result', itemId, ok, text, truncated: false, images: [] });
const created = (id: string, url: string) => [call(id, 'gh pr create --fill'), result(id, true, `${url}\n`)];

// Lets the promises an advance() started run to the end.
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

type Node = { state?: string; merged?: boolean; running?: boolean };
function fakeGh() {
  const prs = new Map<string, Node>();
  const queries: string[] = [];
  let failNext = false;
  const branchUrls = new Map<string, string>();
  const gh: Gh = {
    async graphql(query) {
      queries.push(query);
      if (failNext) {
        failNext = false;
        throw new Error('network');
      }
      const data: Record<string, unknown> = {};
      [...query.matchAll(/(p\d+): repository\(owner:"([^"]+)", name:"([^"]+)"\) \{ pullRequest\(number: (\d+)\)/g)].forEach((m) => {
        const n = prs.get(`${m[2]}/${m[3]}#${m[4]}`);
        data[m[1]!] = {
          pullRequest: n && {
            title: 'Sort widgets',
            state: n.state ?? 'OPEN',
            merged: n.merged ?? false,
            commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: n.running ? 'IN_PROGRESS' : 'COMPLETED', conclusion: n.running ? null : 'SUCCESS' }] } } } }] },
          },
        };
      });
      return { data };
    },
    async prForBranch(_cwd, branch) {
      return branchUrls.get(branch ?? '');
    },
  };
  return { gh, prs, queries, branchUrls, failNext: () => (failNext = true) };
}

type Rec = { id: string; cwd: string; archived: boolean; prs?: TrackedPr[] };
function setup(opts: { gh?: () => Promise<Gh | undefined> } = {}) {
  const clock = new FakeClock();
  const g = fakeGh();
  const threads: Rec[] = [{ id: 't1', cwd: '/w', archived: false }];
  const sets: { id: string; prs: TrackedPr[] }[] = [];
  const logs: string[] = [];
  const log: Logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m), debug() {} };
  const host = {
    threads: () => threads,
    setPrs(id: string, prs: TrackedPr[]) {
      sets.push({ id, prs });
      threads.find((t) => t.id === id)!.prs = prs;
    },
  };
  const s = new PrStatus({ clock, log, host, gh: opts.gh ?? (async () => g.gh), now: () => new Date(clock.now()).toISOString() });
  const advance = async (ms: number) => {
    clock.advance(ms);
    await flush();
  };
  const observe = (id: string, es: PersistedEvent[]) => es.forEach((e) => s.observe(id, '/w', e));
  return { clock, g, threads, sets, logs, s, advance, observe };
}

test('created PR is looked at soon and shown', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  assert.equal(t.g.queries.length, 1);
  assert.ok(t.sets.length >= 1);
  const sum = t.s.summary(t.threads[0]!.prs)!;
  assert.equal(sum.length, 1);
  assert.equal(sum[0]!.state, 'open');
  assert.ok(sum[0]!.checkedAt);
  assert.equal(t.s.details(t.threads[0]!.prs)[0]!.headRef, '');
});

test('summary of a PR never fetched, newest first, and undefined without prs', () => {
  const t = setup();
  assert.equal(t.s.summary(undefined), undefined);
  const mk = (n: number, addedAt: string): TrackedPr => ({ url: `https://github.com/a/b/pull/${n}`, repo: 'a/b', number: n, how: 'created', addedAt });
  const sum = t.s.summary([mk(1, '2026-11-06T10:00:00Z'), mk(2, '2026-11-06T11:00:00Z')])!;
  assert.deepEqual(sum.map((p) => p.number), [2, 1]);
  assert.deepEqual(sum[0], { url: 'https://github.com/a/b/pull/2', repo: 'a/b', number: 2, title: 'a/b#2', state: 'open' });
  assert.deepEqual(t.s.details([mk(1, 'x')]), []);
});

test('rhythm', async () => {
  const t = setup();
  const n = { running: true } as Node;
  t.g.prs.set('acme/widgets#12', n);
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  assert.equal(t.g.queries.length, 1);
  await t.advance(FAST_MS - 1);
  assert.equal(t.g.queries.length, 1);
  await t.advance(1);
  assert.equal(t.g.queries.length, 2);
  n.running = false;
  await t.advance(FAST_MS);
  assert.equal(t.g.queries.length, 3); // sees it passing
  await t.advance(OPEN_MS - 1);
  assert.equal(t.g.queries.length, 3);
  await t.advance(1);
  assert.equal(t.g.queries.length, 4);
  n.state = 'MERGED';
  n.merged = true;
  await t.advance(OPEN_MS);
  assert.equal(t.g.queries.length, 5); // sees it merged, final
  assert.equal(t.threads[0]!.prs![0]!.final, true);
  await t.advance(10 * 60_000);
  assert.equal(t.g.queries.length, 5);
});

test('first look is 10 s after start', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.threads[0]!.prs = [{ url: URL1, repo: 'acme/widgets', number: 12, how: 'created', addedAt: 'x' }];
  t.s.start();
  await t.advance(FIRST_MS - 1);
  assert.equal(t.g.queries.length, 0);
  await t.advance(1);
  assert.equal(t.g.queries.length, 1);
});

test('archived thread is not polled', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  t.threads[0]!.archived = true;
  await t.advance(5 * 60_000);
  assert.ok(t.g.queries.every((q) => !q.includes('"widgets"')));
});

test('deleted mid-round', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  const before = t.sets.length;
  const orig = t.g.gh.graphql;
  t.g.gh.graphql = async (q) => {
    const r = await orig(q);
    t.threads.length = 0;
    return r;
  };
  await t.advance(1000);
  assert.equal(t.g.queries.length, 1);
  assert.equal(t.sets.length, before);
});

test('failure keeps last status', async () => {
  const t = setup();
  const n = { running: true } as Node;
  t.g.prs.set('acme/widgets#12', n);
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  const snap = t.threads[0]!.prs![0]!.snapshot;
  assert.ok(snap);
  t.g.failNext();
  await t.advance(FAST_MS);
  assert.equal(t.g.queries.length, 2);
  assert.deepEqual(t.threads[0]!.prs![0]!.snapshot, snap);
  assert.ok(t.logs.some((l) => /pr status/i.test(l)));
  await t.advance(OPEN_MS);
  assert.equal(t.g.queries.length, 3);
});

test('shared PR asked once', async () => {
  const t = setup();
  t.threads.push({ id: 't2', cwd: '/w', archived: false });
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  t.observe('t2', [...created('b', URL1)]);
  await t.advance(1000);
  assert.equal(t.g.queries.length, 1);
  assert.equal(t.g.queries[0]!.match(/pullRequest\(number: 12\)/g)?.length, 1);
  assert.ok(t.threads[0]!.prs![0]!.snapshot);
  assert.ok(t.threads[1]!.prs![0]!.snapshot);
});

test('a pin of a created PR keeps created, and a url is not tracked twice', () => {
  const t = setup();
  t.observe('t1', created('a', URL1));
  t.observe('t1', [ev({ type: 'tool.call', itemId: 'p', name: 'mcp__threadbear__pin', kind: 'other', title: 'pin', input: { url: URL1 } })]);
  assert.equal(t.threads[0]!.prs!.length, 1);
  assert.equal(t.threads[0]!.prs![0]!.how, 'created');
});

test('push finds the open PR', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#13', {});
  t.g.branchUrls.set('feat/x', URL2);
  t.s.start();
  t.observe('t1', [call('a', 'git push -u origin feat/x'), result('a', true, ' * [new branch]      feat/x -> feat/x')]);
  await flush(); // the branch lookup finishes, then the look is 1 s away
  await t.advance(1000);
  assert.equal(t.threads[0]!.prs!.length, 1);
  assert.equal(t.threads[0]!.prs![0]!.how, 'pushed');
  assert.equal(t.threads[0]!.prs![0]!.url, URL2);
  assert.ok(t.threads[0]!.prs![0]!.snapshot);
});

test('adopt adds created PRs without forcing a look', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.s.adopt('t1', [URL1, URL1, 'https://example.com']);
  assert.equal(t.threads[0]!.prs!.length, 1);
  assert.equal(t.threads[0]!.prs![0]!.how, 'created');
  await t.advance(FIRST_MS - 1);
  assert.equal(t.g.queries.length, 0);
});

test('no gh', async () => {
  let asked = 0;
  const t = setup({ gh: async () => (asked++, undefined) });
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  await t.advance(OPEN_MS * 3);
  assert.equal(t.g.queries.length, 0);
  assert.ok(asked > 1);
  assert.equal(t.logs.filter((l) => l.includes("gh isn't installed or logged in")).length, 1);
});

test('gh turning up later is picked up', async () => {
  let gh: Gh | undefined;
  const t = setup({ gh: async () => gh });
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  assert.equal(t.g.queries.length, 0);
  gh = t.g.gh;
  await t.advance(OPEN_MS);
  assert.equal(t.g.queries.length, 1);
});

test('rounds do not overlap', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const orig = t.g.gh.graphql;
  let active = 0, peak = 0;
  t.g.gh.graphql = async (q) => {
    active++;
    peak = Math.max(peak, active);
    await gate;
    active--;
    return orig(q);
  };
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  t.observe('t1', [call('b', 'git push'), result('b', true, '')]);
  await t.advance(1000);
  release();
  await flush();
  assert.equal(peak, 1);
  assert.ok(t.g.queries.length >= 2);
});

test('checkedAt moves on every look, even when nothing changed', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  const seen = () => t.s.summary(t.threads[0]!.prs)![0]!.checkedAt!;
  const first = seen();
  const sets = t.sets.length;
  await t.advance(OPEN_MS);
  const second = seen();
  assert.ok(second > first);
  assert.equal(t.sets.length, sets + 1);
  await t.advance(OPEN_MS);
  assert.ok(seen() > second);
  assert.equal(t.sets.length, sets + 2);
});

test('a failed round leaves checkedAt as it was', async () => {
  const t = setup();
  t.g.prs.set('acme/widgets#12', {});
  t.s.start();
  t.observe('t1', created('a', URL1));
  await t.advance(1000);
  const before = t.s.summary(t.threads[0]!.prs)![0]!.checkedAt;
  const sets = t.sets.length;
  t.g.failNext();
  await t.advance(OPEN_MS);
  assert.equal(t.g.queries.length, 2);
  assert.equal(t.s.summary(t.threads[0]!.prs)![0]!.checkedAt, before);
  assert.equal(t.sets.length, sets);
});
