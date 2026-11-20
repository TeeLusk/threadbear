import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseAnswer, outcomeOf, toThreadPr } from '../../src/pr-github.ts';
import type { PrDetail } from '../../src/pr-status-types.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/pr-graphql.json', import.meta.url), 'utf8'));
const asked = [
  { url: 'https://github.com/acme/widgets/pull/12' },
  { url: 'https://github.com/acme/widgets/pull/9' },
  { url: 'https://github.com/gone/gone/pull/1' },
];
const NOW = '2026-11-06T11:00:00.000Z';

test('buildQuery quotes and aliases', () => {
  const q = buildQuery([
    { owner: 'acme', name: 'widgets', number: 12 },
    { owner: 'other', name: 'thing', number: 7 },
  ]);
  assert.ok(q.includes('p0: repository(owner:"acme", name:"widgets")'));
  assert.ok(q.includes('pullRequest(number: 12)'));
  assert.ok(q.includes('p1: repository(owner:"other", name:"thing")'));
  assert.equal(q.match(/fragment F on PullRequest/g)?.length, 1);
  assert.ok(buildQuery([{ owner: 'a"b', name: 'n', number: 1 }]).includes('owner:"a\\"b"'));
});

test('parseAnswer maps the fixture', () => {
  const m = parseAnswer(fixture, asked, NOW);
  const d = m.get(asked[0]!.url)!;
  assert.equal(d.state, 'open');
  assert.equal(d.repo, 'acme/widgets');
  assert.equal(d.number, 12);
  assert.equal(d.headRef, 'feature/sort-widgets');
  assert.deepEqual(d.checkList.map((c) => c.name), ['unit-tests', 'lint', 'deploy-preview', 'ci/legacy-build']);
  assert.deepEqual(d.checkList.map((c) => c.outcome), ['failed', 'passed', 'skipped', 'passed']);
  assert.equal(d.checkList[0]!.url, 'https://github.com/acme/widgets/actions/runs/1001/job/2001');
  assert.equal(d.checkList[0]!.seconds, 125);
  assert.equal(d.checkList[0]!.workflow, 'CI');
  assert.equal(d.checkList[2]!.workflow, undefined);
  assert.equal(d.review?.decision, 'changes');
  assert.equal(d.review?.approvals, 1);
  assert.equal(d.review?.required, 2);
  assert.equal(d.conflicts, true);
  assert.deepEqual(d.reviews, [
    { author: 'alice-dev', state: 'changes' },
    { author: 'bob-review', state: 'approved' },
    { author: 'carol-qa', state: 'commented' },
  ]);
  assert.deepEqual(d.requested, ['dave-lead', 'platform-team']);
  assert.equal(d.checkedAt, NOW);
  assert.deepEqual(d.checks, { state: 'failing', passed: 2, total: 3 });
});

test('merged PR with no protection rule and no checks', () => {
  const d = parseAnswer(fixture, asked, NOW).get(asked[1]!.url)!;
  assert.equal(d.state, 'merged');
  assert.equal(d.review?.required, undefined);
  assert.equal(d.review?.decision, 'none');
  assert.equal(d.conflicts, undefined);
  assert.deepEqual(d.checkList, []);
  assert.equal(d.checks?.state, 'none');
});

test('null PR is skipped', () => {
  const m = parseAnswer(fixture, asked, NOW);
  assert.equal(m.size, 2);
  assert.equal(m.has(asked[2]!.url), false);
  assert.equal(parseAnswer({ data: null }, asked, NOW).size, 0);
  assert.equal(parseAnswer('junk', asked, NOW).size, 0);
});

test('draft and merged', () => {
  const one = (pr: Record<string, unknown>) =>
    parseAnswer({ data: { p0: { pullRequest: { url: asked[0]!.url, ...pr } } } }, [asked[0]!], NOW).get(asked[0]!.url)!.state;
  assert.equal(one({ state: 'OPEN', isDraft: true }), 'draft');
  assert.equal(one({ state: 'MERGED', merged: true }), 'merged');
  assert.equal(one({ state: 'CLOSED', merged: false }), 'closed');
  assert.equal(one({ state: 'OPEN', isDraft: false }), 'open');
});

test('outcomeOf', () => {
  assert.equal(outcomeOf({ __typename: 'CheckRun', status: 'IN_PROGRESS' }), 'running');
  assert.equal(outcomeOf({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }), 'passed');
  assert.equal(outcomeOf({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' }), 'skipped');
  assert.equal(outcomeOf({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' }), 'failed');
  assert.equal(outcomeOf({ __typename: 'StatusContext', state: 'PENDING' }), 'running');
  assert.equal(outcomeOf({ __typename: 'StatusContext', state: 'ERROR' }), 'failed');
});

test('toThreadPr counts', () => {
  const base = { url: 'u', repo: 'a/b', number: 1, title: 't', state: 'open' as const, headRef: 'h', baseRef: 'b', reviews: [], requested: [] };
  const checks = (...o: string[]) => o.map((outcome, i) => ({ name: `c${i}`, outcome })) as PrDetail['checkList'];
  const t = toThreadPr({ ...base, checkList: checks('passed', 'passed', 'passed', 'skipped', 'failed') });
  assert.deepEqual(t.checks, { state: 'failing', passed: 3, total: 4 });
  assert.equal('checkList' in t, false);
  assert.equal(toThreadPr({ ...base, checkList: checks('passed', 'running') }).checks?.state, 'running');
  assert.equal(toThreadPr({ ...base, checkList: checks('passed', 'skipped') }).checks?.state, 'passing');
  assert.equal(toThreadPr({ ...base, checkList: checks('skipped') }).checks?.state, 'none');
});
