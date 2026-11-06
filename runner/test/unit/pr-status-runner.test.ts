// PR status wired into a real Runner (docs/protocol.md, "Pull request
// status"): events reach the tracker, the summary carries `prs`, and
// threads.prs answers with the checks. GitHub is a fake gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, type Harness } from '../helpers/fakes.ts';
import { checkSummary } from '../helpers/protocol-check.ts';
import { RpcServer } from '../../src/rpc.ts';
import { RunnerClient } from '../../src/client.ts';
import { readToken } from '../../src/config.ts';
import { nullLogger } from '../../src/log.ts';
import type { Gh } from '../../src/pr-github.ts';
import { PrStatus } from '../../src/pr-status.ts';
import type { PrDetail } from '../../src/pr-status-types.ts';
import { prRecordHost } from '../../src/runner/prs.ts';

const URL = 'https://github.com/acme/widgets/pull/12';

const gh: Gh = {
  async graphql() {
    return {
      data: {
        p0: {
          pullRequest: {
            title: 'Sort widgets',
            state: 'OPEN',
            merged: false,
            headRefName: 'sort',
            baseRefName: 'main',
            commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
          },
        },
      },
    };
  },
  async prForBranch() {
    return undefined;
  },
};

function track(h: Harness): PrStatus {
  const ps = new PrStatus({ clock: h.clock, log: nullLogger, host: prRecordHost(h.runner), gh: async () => gh, now: () => new Date(h.clock.now()).toISOString() });
  h.runner.prStatus = ps;
  ps.start();
  return ps;
}

// A turn whose agent runs `gh pr create`, which prints the PR's address.
function createPr(h: Harness): string {
  const { thread } = h.runner.create({ text: 'Open a PR', accountId: 'claude-3' });
  const s = h.adapter.last;
  s.init();
  s.out({ kind: 'event', event: { type: 'tool.call', itemId: 'c1', name: 'Bash', kind: 'command', title: 'gh pr create', input: { command: 'gh pr create --fill' } } });
  s.out({ kind: 'event', event: { type: 'tool.result', itemId: 'c1', ok: true, text: `${URL}\n`, truncated: false, images: [] } });
  s.result('completed');
  return thread.id;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

test('summary carries prs once GitHub has answered, and thread.updated sends it', async () => {
  const h = makeHarness();
  track(h);
  const id = createPr(h);
  h.notes.length = 0;
  h.clock.advance(1_000);
  await flush();
  const s = h.runner.get(id);
  assert.equal(s.prs?.[0]?.state, 'open');
  assert.equal(s.prs?.[0]?.title, 'Sort widgets');
  assert.deepEqual(s.prs?.[0]?.checks, { state: 'passing', passed: 1, total: 1 });
  assert.deepEqual(checkSummary(s as never), []);
  const sent = h.notes.filter((n) => n.method === 'thread.updated' && n.params.thread.id === id).map((n) => (n as { params: { thread: { prs?: unknown[] } } }).params.thread);
  assert.ok(sent.some((t) => (t.prs?.[0] as { state?: string } | undefined)?.state === 'open'), 'thread.updated went out with the PR');
  // Saved on the record, so a restart still knows it.
  assert.equal(h.store.load(id)?.prs?.[0]?.url, URL);

  const server = new RpcServer({ host: '127.0.0.1', port: 0, token: readToken(h.home), runner: h.runner, log: nullLogger });
  const { port } = await server.listen();
  const c = await RunnerClient.connect(`ws://127.0.0.1:${port}/rpc`, readToken(h.home));
  try {
    await c.call('hello', { client: 'test', version: '1' });
    const r = await c.call<{ prs: PrDetail[] }>('threads.prs', { threadId: id });
    assert.deepEqual(r.prs.map((p) => p.checkList.map((x) => [x.name, x.outcome])), [[['ci', 'passed']]]);
    await assert.rejects(c.call('threads.prs', { threadId: 'nope' }));
  } finally {
    c.close();
    await server.close();
  }
});

test('without the tracker a summary has no prs and nothing is recorded', async () => {
  const h = makeHarness();
  const id = createPr(h);
  h.clock.advance(1_000);
  await flush();
  assert.equal(h.runner.get(id).prs, undefined);
  assert.equal(h.store.load(id)?.prs, undefined);
});

test('the host leaves deleted threads out and says which are archived', () => {
  const h = makeHarness();
  const a = h.runner.create({ text: 'a', accountId: 'claude-3' }).thread.id;
  const b = h.runner.create({ text: 'b', accountId: 'claude-3' }).thread.id;
  const c = h.runner.create({ text: 'c', accountId: 'claude-3' }).thread.id;
  h.runner.update({ threadId: b, archived: true });
  h.runner.delete(c);
  const host = prRecordHost(h.runner);
  const listed = host.threads();
  assert.deepEqual(listed.map((t) => [t.id, t.archived]).sort(), [[a, false], [b, true]].sort());
  // A round that ends after the thread went writes nowhere.
  host.setPrs(c, [{ url: URL, repo: 'acme/widgets', number: 12, how: 'created', addedAt: '2026-11-06T10:00:00.000Z' }]);
  assert.equal(host.threads().length, 2);
});

test('a PR made before the tracker started is adopted from highlights', async () => {
  const h = makeHarness();
  const id = createPr(h);
  assert.equal(h.store.load(id)?.prs, undefined);
  track(h);
  h.runner.highlights(id);
  assert.deepEqual(h.runner.get(id).prs?.map((p) => p.url), [URL]);
});

test('a thread handed over by a draining runner is watched by the new one', async () => {
  const a = makeHarness();
  const ps = track(a);
  const id = createPr(a);
  a.clock.advance(1_000);
  await flush();
  assert.equal(a.runner.get(id).prs?.[0]?.title, 'Sort widgets');
  ps.stop();
  // The new runner on the same data dir, whose tracker has looked and found nothing to watch.
  const b = makeHarness(a.home);
  b.runner.threads.delete(id);
  let asked = 0;
  const counting: Gh = { ...gh, graphql: async (q) => (asked++, gh.graphql(q)) };
  const ps2 = new PrStatus({ clock: b.clock, log: nullLogger, host: prRecordHost(b.runner), gh: async () => counting, now: () => new Date(b.clock.now()).toISOString() });
  b.runner.prStatus = ps2;
  ps2.start();
  b.clock.advance(10_000);
  await flush();
  assert.equal(asked, 0, 'nothing to watch before the thread comes across');
  b.runner.adopt(id);
  b.clock.advance(10_000);
  await flush();
  assert.equal(asked, 1, 'the handed-over thread\'s open PR is looked at');
});

test('after an unarchive, threads.prs starts polling again', async () => {
  const h = makeHarness();
  let asked = 0;
  const counting: Gh = { ...gh, graphql: async (q) => (asked++, gh.graphql(q)) };
  const ps = new PrStatus({ clock: h.clock, log: nullLogger, host: prRecordHost(h.runner), gh: async () => counting, now: () => new Date(h.clock.now()).toISOString() });
  h.runner.prStatus = ps;
  ps.start();
  const id = createPr(h);
  h.clock.advance(1_000);
  await flush();
  assert.equal(asked, 1);
  h.runner.update({ threadId: id, archived: true });
  h.clock.advance(60_000);
  await flush();
  const before = asked;
  h.clock.advance(10 * 60_000);
  await flush();
  assert.equal(asked, before, 'nothing polled while archived');
  h.runner.update({ threadId: id, archived: false });
  h.clock.advance(10 * 60_000);
  await flush();
  assert.equal(asked, before, 'unarchiving alone does not restart it');

  const server = new RpcServer({ host: '127.0.0.1', port: 0, token: readToken(h.home), runner: h.runner, log: nullLogger });
  const { port } = await server.listen();
  const c = await RunnerClient.connect(`ws://127.0.0.1:${port}/rpc`, readToken(h.home));
  try {
    await c.call('hello', { client: 'test', version: '1' });
    await c.call('threads.prs', { threadId: id });
  } finally {
    c.close();
    await server.close();
  }
  h.clock.advance(10_000);
  await flush();
  assert.equal(asked, before + 1, 'opening the pane watches the open PR again');
});
