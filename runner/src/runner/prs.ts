// Pull request status (docs/protocol.md, "Pull request status") wired to the
// Runner: the tracker (pr-status.ts) reads and writes each thread's PRs on its
// record through this host. Kept out of runner.ts, which only has small
// hooks for it, so Mike's changes there merge cleanly.
import type { Runner } from '../runner.ts';
import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';
import { ghFromLoginShell } from '../pr-github.ts';
import { PrStatus, type PrRecordHost } from '../pr-status.ts';

export function prRecordHost(runner: Pick<Runner, 'threads' | 'markDirty'>): PrRecordHost {
  return {
    // A deleted thread is gone from the map, so it never shows here.
    threads: () => [...runner.threads.values()].map(({ rec }) => ({ id: rec.id, cwd: rec.cwd, archived: Boolean(rec.archivedAt), prs: rec.prs })),
    setPrs(threadId, prs) {
      const st = runner.threads.get(threadId);
      if (!st) return;
      st.rec.prs = prs;
      // Saves the record and sends thread.updated with the new summary.
      runner.markDirty(st);
    },
  };
}

// The tracker for main.ts, asking GitHub through the user's own gh.
export function makePrStatus(runner: Pick<Runner, 'threads' | 'markDirty'>, clock: Clock, log: Logger): PrStatus {
  return new PrStatus({ clock, log, host: prRecordHost(runner), gh: () => ghFromLoginShell(log), now: () => new Date(clock.now()).toISOString() });
}
