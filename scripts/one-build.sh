#!/bin/bash
# Runs a build with this machine's Threadbear build lock held, so threads
# build one at a time rather than all at once:
#
#   scripts/one-build.sh <command...>     e.g. scripts/one-build.sh swift build
#
# Mike asked on 9 Nov, with his M5 at a load of 50: two threads were building
# the app (one for screenshots) and a third the iPhone app, each on every
# core, alongside everything else. Builds are minutes long, so a second one
# waiting for the first costs it little and keeps the Mac usable.
#
# The lock is one file per user (~/Library/Caches/Threadbear/build.lock, or
# ~/.cache/threadbear on Linux), whatever the worktree, held for the command
# only and let go when it ends, however it ends. The build scripts take it
# themselves (build-app.sh, dev-app.sh, ios/scripts/sim-shots.sh and
# install-phone.sh, dock/run.sh), and on Mike's M5 the heavy-compute hook
# puts a thread's own `swift build`/`swift test`/`xcodebuild` through it.
# Inside a command that already holds it (screenshots.sh's build-app.sh, say)
# it just runs the command, as waiting on itself would never end.
set -u

[ $# -gt 0 ] || { echo "usage: scripts/one-build.sh <command...>" >&2; exit 2; }
[ -z "${THREADBEAR_BUILD_LOCK_HELD:-}" ] || exec "$@"

if [ "$(uname -s)" = Darwin ]; then dir="$HOME/Library/Caches/Threadbear"; else dir="${XDG_CACHE_HOME:-$HOME/.cache}/threadbear"; fi
mkdir -p "$dir" || exec "$@"
lock="$dir/build.lock"
export THREADBEAR_BUILD_LOCK_HELD=1

# Waiting: said here, and to the thread's runner, which shows the job as
# Queued until the lock is ours (scripts/queued.sh; this shell's pid is the
# lock tool's after exec, so the runner sees the wait end if it's killed).
queued="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/queued.sh"
waiting() {
  echo "Waiting for another Threadbear build on this machine to finish..." >&2
  "$queued" wait "build-$$" "$(basename "$1")${2:+ $2}" "another Threadbear build on this machine" "$$"
}

if [ -x /usr/bin/lockf ]; then
  # A quick try first, only to say why it's waiting. It keeps the file too (-k):
  # without it lockf unlinks the file as `true` ends, and a build already waiting
  # on that file would take a lock on nothing, beside the one made next.
  if ! /usr/bin/lockf -k -s -t 0 "$lock" true 2>/dev/null; then
    waiting "$@"
    exec /usr/bin/lockf -k "$lock" "$queued" done "build-$$" -- "$@"
  fi
  exec /usr/bin/lockf -k "$lock" "$@"
elif command -v flock >/dev/null 2>&1; then
  if ! flock -n "$lock" true 2>/dev/null; then
    waiting "$@"
    exec flock "$lock" "$queued" done "build-$$" -- "$@"
  fi
  exec flock "$lock" "$@"
fi
exec "$@"
