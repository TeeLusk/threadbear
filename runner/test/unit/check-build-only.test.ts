// check.sh --quick only typechecks and builds a branch that brings in one of
// Mike's releases (a merge titled "Bring in Mike's release"): his CI tests
// those, and here they only have to build (Tyler, 16 Nov 2026). Any other
// branch still gets the tests.
//
// This runs the real check.sh --quick --local in a throwaway git checkout
// whose steps are stand-ins that pass at once, so only what it picks to run
// is under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function checkout(mergeTitle: string) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tb-check-build-'));
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const copy = (rel: string) => put(rel, fs.readFileSync(path.join(repo, rel), 'utf8'));
  copy('check.sh');
  fs.chmodSync(path.join(root, 'check.sh'), 0o755);
  copy('runner/scripts/find-node.sh');
  copy('runner/test/helpers/failed-files-reporter.mjs');
  put('runner/package.json', JSON.stringify({ scripts: { typecheck: 'true' } }));
  put('runner/test/helpers/clean-env.ts', '');
  put('runner/test/unit/ok.test.ts', "import { test } from 'node:test';\ntest('ok', () => {});\n");
  put('package.json', JSON.stringify({ scripts: { 'convex:typecheck': 'true', 'web:typecheck': 'true', 'web:test': 'true' } }));
  put('app/Tools/ok.mjs', '');
  put('app/Tools/mock-runner/ok.mjs', '');
  put('.gitignore', 'node_modules\n.tb-check*\n');
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'release');
  put('runner/release.txt', 'his\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'his change');
  git('checkout', '-q', '-b', 'thread', 'main');
  put('runner/mine.txt', 'mine\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'my change');
  git('merge', '-q', '--no-ff', '-m', mergeTitle, 'release');
  put('runner/node_modules/.keep', '');
  put('node_modules/.keep', '');
  return root;
}

function quick(root: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, THREADBEAR_NODE: process.execPath, TMPDIR: root };
  for (const k of Object.keys(env)) if (/^THREAD(BEAR|BARE)_CHECK_(HOST|CHANGED_FILE)$/.test(k)) delete env[k];
  const r = spawnSync('bash', [path.join(root, 'check.sh'), '--quick', '--local'], { env, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test("a branch bringing in Mike's release is typechecked, not tested", () => {
  const root = checkout("Bring in Mike's release 2026-11-16");
  try {
    const r = quick(root);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /typechecks and builds only, no tests/, r.out);
    assert.match(r.out, /^ok    runner typecheck/m, r.out);
    assert.match(r.out, /^skip  runner unit tests/m, r.out);
    assert.match(r.out, /^skip  web tests/m, r.out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('any other merge still runs the tests', () => {
  const root = checkout('Merge branch release');
  try {
    const r = quick(root);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /build only/, r.out);
    assert.match(r.out, /^ok    runner unit tests/m, r.out);
    assert.match(r.out, /^ok    web tests/m, r.out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
