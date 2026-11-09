// Long threads (docs/protocol.md, "Long threads"): Continue in a new thread,
// and the context count dropped after a /compact. The thresholds and the
// handoff's words are in ../context-nudge.ts. A part of the Runner
// (runner.ts) like the others here, kept in one file of its own so it stays
// out of the way of Mike's releases when a fork brings them in.
import type { Runner, ThreadState } from '../runner.ts';
import type { RunnerPart } from './part.ts';
import { ErrorCode, RpcError } from '../protocol.ts';
import { HANDOFF_PROMPT, handoffMessage } from '../context-nudge.ts';

// The handoff turn each thread is writing, by its turn id. Not saved: a
// runner that stops mid-handoff just leaves the reply in the thread.
const writing = new WeakMap<ThreadState, string>();

// A /compact turn and the context count it started with.
const compacting = new WeakMap<ThreadState, { turnId: string; before?: number }>();

export const longThreadsPart = {
  continueFresh(this: Runner, threadId: string): { turnId: string } {
    const st = this.mustGet(threadId);
    if (st.rt.turn) throw new RpcError(ErrorCode.busy, 'The thread is working. Continue in a new thread once its turn is over.');
    if (writing.has(st)) throw new RpcError(ErrorCode.busy, 'The handoff is already being written.');
    const { turnId } = this.send(threadId, HANDOFF_PROMPT);
    writing.set(st, turnId);
    this.markDirty(st);
    return { turnId };
  },

  isContinuing(this: Runner, st: ThreadState): boolean {
    return writing.has(st);
  },

  // A /compact the CLI is about to run (runner.ts, as it sends the turn).
  noteCompact(this: Runner, st: ThreadState, turnId: string): void {
    compacting.set(st, { turnId, before: st.rec.contextTokens });
  },

  // From completeTurn, once the turn is over and recorded.
  afterLongTurn(this: Runner, st: ThreadState, turnId: string, outcome: string, lastText: string | undefined): void {
    const c = compacting.get(st);
    if (c?.turnId === turnId) {
      compacting.delete(st);
      // The CLI says how big the context is only on its next model call
      // (Claude's result repeats the last count), so the old count goes
      // until then, unless a new one came in during the compaction.
      if (outcome === 'completed' && st.rec.contextTokens === c.before && st.rec.contextTokens !== undefined) {
        delete st.rec.contextTokens;
        this.markDirty(st);
      }
    }
    if (writing.get(st) !== turnId) return;
    writing.delete(st);
    const handoff = lastText?.trim();
    if (outcome !== 'completed' || !handoff) {
      this.emit(st, { type: 'system.note', text: "No new thread: the handoff wasn't written. Try Continue in a new thread again." });
      this.markDirty(st);
      return;
    }
    const { rec } = st;
    const worktree = rec.worktree && !rec.worktree.removedAt ? rec.worktree : undefined;
    const projectIds = (rec.projects ?? []).map((p) => p.id).filter((id) => {
      try {
        this.projects?.get(id);
        return Boolean(this.projects);
      } catch {
        return false;
      }
    });
    try {
      const made = this.create({
        text: handoffMessage({ id: rec.id, title: rec.title, ...(worktree ? { worktree: { path: worktree.path, branch: worktree.branch } } : {}) }, handoff),
        title: `${rec.title} (continued)`,
        // A thread's worktree is its own: the new one gets one of its own
        // from the repo, as any new thread there does.
        cwd: worktree ? worktree.mainCheckout : rec.cwd,
        ...(rec.poolId ? { poolId: rec.poolId } : { accountId: rec.accountId }),
        ...(rec.model ? { model: rec.model } : {}),
        ...(rec.effort ? { effort: rec.effort } : {}),
        permissionMode: rec.permissionMode,
        ...(rec.confined ? { confined: true } : {}),
        startedBy: { kind: 'thread', label: 'Continued', threadId: rec.id, threadTitle: rec.title, why: 'carrying on from a long thread' },
        ...(projectIds.length ? { projectIds } : {}),
      });
      rec.continuedIn = { threadId: made.thread.id, title: made.thread.title };
      this.emit(st, { type: 'system.note', text: `Continued in a new thread, "${made.thread.title}".` });
      this.markDirty(st);
    } catch (e) {
      this.emit(st, { type: 'system.note', text: `No new thread: ${e instanceof Error ? e.message : String(e)}` });
      this.markDirty(st);
    }
  },
};

export type LongThreadsPart = RunnerPart<typeof longThreadsPart>;
