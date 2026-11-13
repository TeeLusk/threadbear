// worktrees: catching main up with origin's before a worktree is made, and
// `land: "pr"`, which pushes the branch and opens its PR (elie-h's fork,
// 6 and 7 Nov). Real git with a bare repo for origin, and a fake gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/fakes.ts';
import { readPatchModule } from '../../src/patches.ts';
import { land } from '../../src/worktrees.ts';
import { PATCH, capture, commit, harness, makeBranch, makeRepo, sh, until } from '../helpers/worktrees-harness.ts';

// `main` with a bare origin that has main, and a clone of origin to push
// other people's work from.
function withOrigin(main: string): { origin: string; other: string } {
  const root = path.dirname(main);
  const origin = path.join(root, 'origin.git');
  sh(root, `git init -q --bare -b main ${origin}`);
  sh(main, `git remote add origin ${origin} && git push -q origin main`);
  const other = path.join(root, 'other');
  sh(root, `git clone -q ${origin} ${other}`);
  return { origin, other };
}

function pushFromOther(other: string, file: string, message: string): string {
  commit(other, { [file]: `${message}\n` }, message);
  sh(other, 'git push -q origin main');
  return sh(other, 'git rev-parse HEAD');
}

// A gh on PATH that logs its arguments, says the PR list is whatever
// `pr-open` holds, and "opens" one by writing it there.
function fakeGh(): { log: string; restore: () => void } {
  const bin = tmpDir('tb-fake-gh-');
  const log = path.join(bin, 'calls');
  const open = path.join(bin, 'pr-open');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${log}'`,
    'case "$1 $2" in',
    `  "pr list") cat '${open}' 2>/dev/null; exit 0 ;;`,
    `  "pr create") echo https://github.com/o/r/pull/7 > '${open}'; echo "Creating pull request"; echo https://github.com/o/r/pull/7; exit 0 ;;`,
    'esac',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  return { log, restore: () => { process.env.PATH = before; } };
}

test('worktree.land takes "pr" or "main"; anything else is the file\'s error', () => {
  assert.deepEqual(readPatchModule('p', 'project', '/x/p.ts', { worktree: { land: 'pr' } }).worktree, { land: 'pr' });
  assert.deepEqual(readPatchModule('m', 'project', '/x/m.ts', { worktree: { land: 'main' } }).worktree, {});
  const bad = readPatchModule('b', 'project', '/x/b.ts', { worktree: { land: 'merge' } });
  assert.equal(bad.info.error, 'worktree.land should be "main" (move main to the branch) or "pr" (push it and open a pull request).');
});

test("a new thread's worktree starts from origin's main when the local one is only behind it", async () => {
  const { root, main } = makeRepo();
  const { other } = withOrigin(main);
  const theirs = pushFromOther(other, 'merged.txt', 'Merged on GitHub');
  const h = harness();
  const { thread } = h.runner.create({ text: 'Go', accountId: 'claude-3', cwd: main });
  await until(() => h.adapter.sessions.length === 1, 'the CLI to start');
  const wt = path.join(root, 'proj-threads', thread.id.slice(0, 8));
  assert.equal(sh(main, 'git rev-parse main'), theirs, 'main fast-forwarded');
  assert.equal(sh(wt, 'git rev-parse HEAD'), theirs);
  assert.ok(fs.existsSync(path.join(main, 'merged.txt')), "main's working tree has it");
  const note = h.events(thread.id).find((e) => e.type === 'system.note');
  assert.match(note?.text ?? '', /tb land puts it on main\.$/);
});

test('a main with commits of its own is left as it is, and the note says why', async () => {
  const { root, main } = makeRepo();
  const { other } = withOrigin(main);
  pushFromOther(other, 'merged.txt', 'Merged on GitHub');
  commit(main, { 'mine.txt': 'x\n' }, 'Not pushed');
  const ours = sh(main, 'git rev-parse main');
  const h = harness();
  const { thread } = h.runner.create({ text: 'Go', accountId: 'claude-3', cwd: main });
  await until(() => h.adapter.sessions.length === 1, 'the CLI to start');
  assert.equal(sh(main, 'git rev-parse main'), ours);
  assert.equal(sh(path.join(root, 'proj-threads', thread.id.slice(0, 8)), 'git rev-parse HEAD'), ours);
  const note = h.events(thread.id).find((e) => e.type === 'system.note');
  assert.match(note?.text ?? '', /main has 1 commit that isn't on origin\/main and is 1 behind it, so this worktree starts from main as it is\.$/);
});

test('an origin that can\'t be fetched leaves main as it is and says so', async () => {
  const { main } = makeRepo();
  sh(main, `git remote add origin ${path.join(path.dirname(main), 'nowhere.git')}`);
  const before = sh(main, 'git rev-parse main');
  const h = harness();
  const { thread } = h.runner.create({ text: 'Go', accountId: 'claude-3', cwd: main });
  await until(() => h.adapter.sessions.length === 1, 'the CLI to start');
  assert.equal(sh(main, 'git rev-parse main'), before);
  const note = h.events(thread.id).find((e) => e.type === 'system.note');
  assert.match(note?.text ?? '', /Couldn't fetch origin, so this worktree starts from main as it is: /);
});

test('a thread in a land: "pr" repo is told tb land opens a PR, and gets no Land chip', async () => {
  const { main } = makeRepo(PATCH(`{ land: "pr" }`));
  const h = harness();
  const { thread } = h.runner.create({ text: 'Go', accountId: 'claude-3', cwd: main });
  await until(() => h.adapter.sessions.length === 1, 'the CLI to start');
  assert.match(h.adapter.last.opts.instructions ?? '', /pushes the branch and opens or updates its pull request/);
  assert.doesNotMatch(h.adapter.last.opts.instructions ?? '', /fast-forwards main/);
  const note = h.events(thread.id).find((e) => e.type === 'system.note');
  assert.match(note?.text ?? '', /tb land opens a pull request for it\.$/);
  assert.equal(h.store.load(thread.id)?.worktree?.land, 'pr');
  // The patch has no actions of its own, so the Land chip would be all there is.
  assert.equal(h.runner.worktreeAction(h.store.load(thread.id)!), undefined);
  assert.ok(!h.runner.get(thread.id).actions?.some((a) => a.id === 'worktree.land'));
});

test('land as a PR: rebases on origin\'s main, checks, pushes and opens the PR, then updates it', async () => {
  const { main } = makeRepo();
  const { origin, other } = withOrigin(main);
  const t = { ...makeBranch(main), land: 'pr' as const };
  commit(t.path, { 'runner/b.ts': 'export const b = 2;\n' }, 'Add b');
  const theirs = pushFromOther(other, 'merged.txt', 'Merged on GitHub');
  const gh = fakeGh();
  try {
    const c = capture();
    const code = await land({ ...t, check: 'test -f merged.txt && echo checked' }, c.opts);
    assert.equal(code, 0, c.err.join('\n'));
    assert.equal(c.out.at(-1), 'Opened a pull request: https://github.com/o/r/pull/7');
    assert.equal(sh(t.path, 'git rev-parse HEAD~1'), theirs, "rebased on origin's main");
    assert.equal(sh(origin, `git rev-parse ${t.branch}`), sh(t.path, 'git rev-parse HEAD'), 'pushed');
    assert.equal(sh(main, 'git rev-parse main'), theirs, "local main only follows origin's");
    assert.equal(sh(origin, 'git rev-parse main'), theirs, "origin's main untouched");
    const calls = fs.readFileSync(gh.log, 'utf8').trim().split('\n');
    assert.match(calls[0], /^pr list --head thread\/abcd1234 --state open/);
    assert.match(calls[1], /^pr create --base main --head thread\/abcd1234 --title Add b --body/);

    // More work, and origin's main moves again: rebased and force-pushed,
    // and the open PR is updated rather than another opened.
    commit(t.path, { 'runner/c.ts': '3\n' }, 'Add c');
    pushFromOther(other, 'more.txt', 'More on GitHub');
    const again = capture();
    assert.equal(await land(t, again.opts), 0, again.err.join('\n'));
    assert.equal(again.out.at(-1), 'Updated the pull request: https://github.com/o/r/pull/7');
    assert.equal(sh(origin, `git rev-parse ${t.branch}`), sh(t.path, 'git rev-parse HEAD'));
    assert.equal(sh(t.path, 'git log --format=%s -3'), 'Add c\nAdd b\nMore on GitHub');
    assert.equal(fs.readFileSync(gh.log, 'utf8').trim().split('\n').filter((l) => l.startsWith('pr create')).length, 1);
  } finally {
    gh.restore();
  }
});

test('land as a PR: a failing check or a dry run pushes nothing', async () => {
  const { main } = makeRepo();
  const { origin } = withOrigin(main);
  const t = { ...makeBranch(main), land: 'pr' as const };
  commit(t.path, { 'runner/b.ts': '2\n' }, 'Add b');
  const gh = fakeGh();
  try {
    const failed = capture();
    assert.equal(await land({ ...t, check: 'echo nope; exit 3' }, failed.opts), 1);
    assert.match(failed.err.join('\n'), /The check failed \(exit 3\), so nothing was pushed/);
    const dry = capture();
    assert.equal(await land(t, { ...dry.opts, dryRun: true }), 0);
    assert.equal(dry.out.at(-2), `Would push ${t.branch} to origin and open or update its pull request:`);
    assert.equal(sh(origin, `git branch --list ${t.branch}`), '', 'nothing pushed');
    assert.equal(fs.existsSync(gh.log), false, 'gh never ran');
  } finally {
    gh.restore();
  }
});
