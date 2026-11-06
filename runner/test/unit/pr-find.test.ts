import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersistedEvent } from '../../src/protocol.ts';
import { PrFinder, parsePrUrl } from '../../src/pr-find.ts';

const CWD = '/Users/christian/dev/app';
let seq = 0;
function ev(body: Record<string, unknown>): PersistedEvent {
  seq++;
  return { seq, ts: `2026-11-06T10:00:${String(seq).padStart(2, '0')}.000Z`, threadId: 't', ...body } as PersistedEvent;
}
const call = (itemId: string, command: string) => ev({ type: 'tool.call', itemId, name: 'Bash', kind: 'command', title: command, input: { command } });
const result = (itemId: string, ok: boolean, text: string) => ev({ type: 'tool.result', itemId, ok, text, truncated: false, images: [] });
function run(events: PersistedEvent[]) {
  const f = new PrFinder();
  return events.flatMap((e) => f.observe(e, CWD));
}

test('created PR url from gh pr create', () => {
  const found = run([call('a', 'gh pr create --fill'), result('a', true, 'https://github.com/trackmyprop/trackmyprop/pull/683\n')]);
  assert.deepEqual(found, [{ kind: 'url', url: 'https://github.com/trackmyprop/trackmyprop/pull/683', how: 'created' }]);
});

test('failed gh pr create finds nothing', () => {
  const found = run([call('a', 'gh pr create --fill'), result('a', false, 'a pull request for branch "x" already exists:')]);
  assert.deepEqual(found, []);
});

test('pin of a PR url', () => {
  const pin = (url: string) => ev({ type: 'tool.call', itemId: 'p', name: 'mcp__threadbear__pin', kind: 'other', title: 'pin', input: { url } });
  assert.deepEqual(run([pin('https://github.com/a/b/pull/3')]), [{ kind: 'url', url: 'https://github.com/a/b/pull/3', how: 'pinned' }]);
  assert.deepEqual(run([pin('https://example.com')]), []);
});

test('push with branch', () => {
  const found = run([call('a', 'git push -u origin feat/x'), result('a', true, ' * [new branch]      feat/x -> feat/x')]);
  assert.deepEqual(found, [{ kind: 'push', cwd: CWD, branches: ['feat/x'] }]);
});

test('push -q with no branch', () => {
  const found = run([call('a', 'git push -q'), result('a', true, '')]);
  assert.deepEqual(found, [{ kind: 'push', cwd: CWD, branches: [] }]);
});

test('a failed push finds nothing', () => {
  assert.deepEqual(run([call('a', 'git push origin x'), result('a', false, 'rejected')]), []);
});

test('parsePrUrl trims a trailing path', () => {
  assert.deepEqual(parsePrUrl('https://github.com/a/b/pull/3/files'), { url: 'https://github.com/a/b/pull/3', owner: 'a', name: 'b', number: 3 });
  assert.deepEqual(parsePrUrl('https://github.com/a/b/pull/3#discussion_r1')?.number, 3);
  assert.equal(parsePrUrl('https://example.com'), undefined);
});
