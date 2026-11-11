import { execFileSync } from 'node:child_process';

// The machine's git, for tests of something older git doesn't have (a fork
// on Ubuntu 22.04 has 2.34): they skip there, saying why, rather than fail.
const m = /git version (\d+)\.(\d+)/.exec(execFileSync('git', ['--version']).toString());
const have: [number, number] = m ? [Number(m[1]), Number(m[2])] : [0, 0];

export const GIT_VERSION = `${have[0]}.${have[1]}`;

export function gitAtLeast(major: number, minor: number): boolean {
  return have[0] > major || (have[0] === major && have[1] >= minor);
}

// node:test's skip option: false to run, or the reason it can't here.
export function needsGit(major: number, minor: number, what: string): false | string {
  return gitAtLeast(major, minor) ? false : `needs git ${major}.${minor}+ (${what}); this one is ${GIT_VERSION}`;
}
