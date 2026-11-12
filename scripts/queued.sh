#!/bin/bash
# Tells Threadbear a job of this thread's is waiting for its turn on a lock,
# so the app says Queued rather than running (docs/protocol.md, "Queued jobs"):
#
#   scripts/queued.sh wait <id> <what> <behind> <pid>
#   scripts/queued.sh done <id> [-- <command...>]
#
# `wait` as the job starts waiting: <pid> is the process that waits (the
# runner drops the entry once it's gone). `done` once it has its turn; with a
# command after --, it then runs that in its place, which is how a lock tool
# that runs the command holding the lock says so (one-build.sh).
#
# Outside a Threadbear thread (no THREADBEAR_THREAD_ID), or with no tb to
# hand, it does nothing. It never fails the job: any error is ignored.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

report() {
  [ -n "${THREADBEAR_THREAD_ID:-}" ] || return 0
  local tb
  tb="$(command -v tb 2>/dev/null)" || tb="$here/../runner/bin/tb"
  [ -x "$tb" ] || return 0
  "$tb" queued "$@" >/dev/null 2>&1 || true
}

case "${1:-}" in
  wait)
    [ $# -ge 5 ] || exit 0
    report "$2" --what "$3" --behind "$4" --pid "$5"
    ;;
  done)
    [ $# -ge 2 ] || exit 0
    id="$2"
    shift 2
    report "$id" --done
    if [ "${1:-}" = "--" ]; then
      shift
      exec "$@"
    fi
    ;;
esac
exit 0
