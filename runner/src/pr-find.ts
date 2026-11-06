// Finds a thread's GitHub PRs in its events, with no model (docs/protocol.md,
// "Pull request status"): the URL a `gh pr create` printed, a PR the thread
// pinned, and the branches a `git push` sent (the caller asks GitHub which
// PRs those have). Mirrors how highlights.ts reads commands and results.
import type { PersistedEvent } from './protocol.ts';
import { PR_URL, PR_URL_G, gitRuns, pushArgBranches, pushedBranches } from './highlights.ts';

export type PrFound = { kind: 'url'; url: string; how: 'created' | 'pinned' } | { kind: 'push'; cwd: string; branches: string[] };

// "https://github.com/a/b/pull/3/files#x" is PR 3 of a/b.
export function parsePrUrl(url: string): { url: string; owner: string; name: string; number: number } | undefined {
  const m = PR_URL.exec(url.trim());
  if (!m) return undefined;
  return { url: m[0], owner: m[1]!, name: m[2]!, number: Number(m[3]) };
}

const CREATE = /\bgh\s+pr\s+create\b/;

export class PrFinder {
  // Command calls whose result matters, by itemId, until it comes.
  private pending = new Map<string, { command: string; cwd: string }>();

  observe(e: PersistedEvent, cwd: string): PrFound[] {
    if (e.type === 'tool.call') {
      const input = e.input ?? {};
      if (/(^|__)pin$/.test(e.name)) {
        const pr = typeof input.url === 'string' ? parsePrUrl(input.url) : undefined;
        return pr ? [{ kind: 'url', url: pr.url, how: 'pinned' }] : [];
      }
      if (typeof input.command === 'string' && (CREATE.test(input.command) || gitRuns(input.command, 'push'))) {
        this.pending.set(e.itemId, { command: input.command, cwd: typeof input.cwd === 'string' ? input.cwd : cwd });
      }
      return [];
    }
    if (e.type !== 'tool.result') return [];
    const call = this.pending.get(e.itemId);
    if (!call) return [];
    this.pending.delete(e.itemId);
    const out: PrFound[] = [];
    const text = e.text ?? '';
    // A failed create, or one that printed no address, finds nothing.
    if (e.ok && CREATE.test(call.command)) {
      const seen = new Set<string>();
      for (const raw of text.match(PR_URL_G) ?? []) {
        const pr = parsePrUrl(raw);
        if (pr && !seen.has(pr.url)) {
          seen.add(pr.url);
          out.push({ kind: 'url', url: pr.url, how: 'created' });
        }
      }
    }
    if (e.ok && gitRuns(call.command, 'push')) {
      out.push({ kind: 'push', cwd: call.cwd, branches: [...new Set([...pushedBranches(text), ...pushArgBranches(call.command)])] });
    }
    return out;
  }
}
