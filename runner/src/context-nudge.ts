// Long threads (docs/protocol.md, "Long threads"): when a thread's
// conversation has got long enough to suggest compacting it or carrying on
// in a new thread. Every model call re-reads the whole history, so one
// thread at ~380K tokens of context spent about 30M cache-read tokens in an
// hour (David, 8 Nov 2026), and the model keeps track of early details less
// well past a couple of hundred thousand. Fixed token counts rather than a
// share of the window: a 1M window doesn't make 380K any cheaper to re-read.

export type ContextNudge = { gentle: number; firm: number };
export type ContextLong = 'gentle' | 'firm';

export const DEFAULT_CONTEXT_NUDGE: ContextNudge = { gentle: 150_000, firm: 250_000 };

// runner.json's contextNudge: { gentle?, firm? } (positive token counts), or
// false for none. Anything else falls back to the defaults, one key at a time.
export function contextNudgeConfig(json: unknown): ContextNudge | null {
  if (json === false) return null;
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : d);
  const gentle = n(o.gentle, DEFAULT_CONTEXT_NUDGE.gentle);
  // A firm level under the gentle one would skip the gentle card.
  return { gentle, firm: Math.max(gentle, n(o.firm, DEFAULT_CONTEXT_NUDGE.firm)) };
}

export function contextLong(tokens: number | undefined, cfg: ContextNudge | null | undefined): ContextLong | undefined {
  if (tokens === undefined || cfg === null) return undefined;
  const c = cfg ?? DEFAULT_CONTEXT_NUDGE;
  if (tokens >= c.firm) return 'firm';
  if (tokens >= c.gentle) return 'gentle';
  return undefined;
}

// What the thread's agent is asked for: the new thread's first message.
export const HANDOFF_PROMPT = [
  'This conversation has grown long, so I am going to carry on in a new thread.',
  'Write a short handoff for the agent there, who will know nothing else: what is done, the decisions made and why, what is still open or next, and the key files and commands.',
  'Plain markdown, under about 400 words. Reply with the handoff itself and nothing else, and do no more work on the task in this turn.',
].join(' ');

// The new thread's first message: where it comes from, then the handoff.
export function handoffMessage(from: { id: string; title: string; worktree?: { path: string; branch: string } }, handoff: string): string {
  const lines = [`Carrying on from the thread "${from.title}" (${from.id.slice(0, 8)}), which had grown long. read_thread has the whole of it. Its agent's handoff:`];
  if (from.worktree) {
    lines.push('', `That thread worked in its own worktree, ${from.worktree.path}, on the branch ${from.worktree.branch}. Anything it hadn't landed is there, not on main.`);
  }
  lines.push('', handoff.trim());
  return lines.join('\n');
}
