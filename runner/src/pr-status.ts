// Keeps each thread's GitHub PRs and their status (docs/protocol.md, "Pull
// request status"). Events say which PRs a thread has; one timer asks GitHub
// about all of them together, fast while checks run, slow while a PR is open.
import type { Clock, TimerHandle } from './clock.ts';
import type { Logger } from './log.ts';
import type { PersistedEvent } from './protocol.ts';
import { PrFinder, parsePrUrl } from './pr-find.ts';
import { BATCH, type Gh, buildQuery, parseAnswer, toThreadPr } from './pr-github.ts';
import type { PrDetail, ThreadPr, TrackedPr } from './pr-status-types.ts';

export const FIRST_MS = 10_000;
export const FAST_MS = 30_000;
export const OPEN_MS = 60_000;
// A new PR or a push is looked at after this, so a burst of events asks once.
const SOON_MS = 1_000;

export type PrRecordHost = {
  threads(): { id: string; cwd: string; archived: boolean; prs?: TrackedPr[] }[];
  setPrs(threadId: string, prs: TrackedPr[]): void; // saves on the record and marks the thread dirty
};

type Deps = { clock: Clock; log: Logger; host: PrRecordHost; gh: () => Promise<Gh | undefined>; now: () => string };

export class PrStatus {
  private deps: Deps;
  // A finder keeps half-seen commands, so each thread needs its own.
  private finders = new Map<string, PrFinder>();
  private gh: Gh | undefined;
  private warnedNoGh = false;
  private timer: TimerHandle | undefined;
  private soon: TimerHandle | undefined;
  private running = false;
  private wanted = false;
  private stopped = true;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  start(): void {
    this.stopped = false;
    this.timer ??= this.deps.clock.setTimeout(() => this.tick(), FIRST_MS);
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.soon?.cancel();
    this.timer = this.soon = undefined;
  }

  observe(threadId: string, cwd: string, e: PersistedEvent): void {
    let finder = this.finders.get(threadId);
    if (!finder) this.finders.set(threadId, (finder = new PrFinder()));
    const found = finder.observe(e, cwd);
    if (!found.length) return;
    for (const f of found) {
      if (f.kind === 'url') this.add(threadId, f.url, f.how);
      else void this.lookUpPush(threadId, f.cwd, f.branches);
    }
    this.lookSoon();
  }

  adopt(threadId: string, urls: string[]): void {
    for (const u of urls) this.add(threadId, u, 'created');
    this.arm();
  }

  summary(prs: TrackedPr[] | undefined): ThreadPr[] | undefined {
    if (!prs?.length) return undefined;
    return [...prs]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map((p) => (p.snapshot ? toThreadPr(p.snapshot) : { url: p.url, repo: p.repo, number: p.number, title: `${p.repo}#${p.number}`, state: 'open' as const }));
  }

  details(prs: TrackedPr[] | undefined): PrDetail[] {
    return (prs ?? []).flatMap((p) => (p.snapshot ? [p.snapshot] : []));
  }

  // Returns whether the thread is new to this PR. A PR already tracked keeps how it was found.
  private add(threadId: string, rawUrl: string, how: TrackedPr['how']): boolean {
    const pr = parsePrUrl(rawUrl);
    const thread = this.deps.host.threads().find((t) => t.id === threadId);
    if (!pr || !thread) return false;
    const prs = thread.prs ?? [];
    if (prs.some((p) => p.url === pr.url)) return false;
    this.deps.host.setPrs(threadId, [...prs, { url: pr.url, repo: `${pr.owner}/${pr.name}`, number: pr.number, how, addedAt: this.deps.now() }]);
    return true;
  }

  // gh is looked for again until it turns up (it may be offline or logged out
  // at start); only a success is kept.
  private async resolveGh(): Promise<Gh | undefined> {
    if (this.gh) return this.gh;
    let gh: Gh | undefined;
    try {
      gh = await this.deps.gh();
    } catch (e) {
      this.deps.log.warn('pr status: could not look for gh', { error: String(e) });
    }
    if (gh) return (this.gh = gh);
    if (!this.warnedNoGh) {
      this.warnedNoGh = true;
      this.deps.log.info("PR status is off: gh isn't installed or logged in");
    }
    return undefined;
  }

  private async lookUpPush(threadId: string, cwd: string, branches: string[]): Promise<void> {
    const gh = await this.resolveGh();
    if (!gh) return;
    for (const branch of branches.length ? branches : [undefined]) {
      try {
        const url = await gh.prForBranch(cwd, branch);
        if (url && this.add(threadId, url, 'pushed')) this.lookSoon();
      } catch (e) {
        this.deps.log.warn('pr status: could not find the PR for a push', { error: String(e) });
      }
    }
  }

  private lookSoon(): void {
    if (this.stopped) return;
    this.soon?.cancel();
    this.soon = this.deps.clock.setTimeout(() => {
      this.soon = undefined;
      void this.round();
    }, SOON_MS);
  }

  // The delay to the next look, or none when nothing is left to watch.
  private nextDelay(): number | undefined {
    const open = this.deps.host.threads().filter((t) => !t.archived).flatMap((t) => t.prs ?? []).filter((p) => !p.final);
    if (!open.length) return undefined;
    return open.some((p) => p.snapshot && toThreadPr(p.snapshot).checks?.state === 'running') ? FAST_MS : OPEN_MS;
  }

  // Starts the timer if something needs watching and none is running.
  private arm(): void {
    if (this.stopped || this.timer || this.running) return;
    if (this.nextDelay() !== undefined) this.timer = this.deps.clock.setTimeout(() => this.tick(), FIRST_MS);
  }

  private tick(): void {
    this.timer = undefined;
    void this.round();
  }

  // One round at a time: a request that comes during one runs after it.
  private async round(): Promise<void> {
    if (this.running) {
      this.wanted = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.wanted = false;
        await this.look().catch((e) => this.deps.log.warn('pr status: a round failed', { error: String(e) }));
      } while (this.wanted && !this.stopped);
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.timer?.cancel();
        const ms = this.nextDelay();
        this.timer = ms === undefined ? undefined : this.deps.clock.setTimeout(() => this.tick(), ms);
      }
    }
  }

  private async look(): Promise<void> {
    const { host, log } = this.deps;
    const listed = host.threads();
    for (const id of this.finders.keys()) if (!listed.some((t) => t.id === id)) this.finders.delete(id);
    const asked = new Map<string, NonNullable<ReturnType<typeof parsePrUrl>>>();
    for (const t of listed) {
      if (t.archived) continue;
      for (const p of t.prs ?? []) {
        const parsed = p.final ? undefined : parsePrUrl(p.url);
        if (parsed) asked.set(parsed.url, parsed);
      }
    }
    if (!asked.size) return;
    const gh = await this.resolveGh();
    if (!gh) return;
    const all = [...asked.values()];
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      let answer: Map<string, PrDetail>;
      try {
        answer = parseAnswer(await gh.graphql(buildQuery(batch)), batch, this.deps.now());
      } catch (e) {
        log.warn('pr status: GitHub did not answer, keeping the last status', { error: String(e) });
        continue;
      }
      this.store(answer);
    }
  }

  // Writes snapshots to every thread that still exists and tracks the PR.
  // Saved even when nothing changed: checkedAt is when GitHub last answered,
  // and the app only hears of it when the thread is marked dirty.
  private store(answer: Map<string, PrDetail>): void {
    for (const t of this.deps.host.threads()) {
      let changed = false;
      const prs = (t.prs ?? []).map((p) => {
        const snap = answer.get(p.url);
        if (!snap) return p;
        changed = true;
        const next: TrackedPr = { ...p, snapshot: snap };
        if (snap.state === 'merged' || snap.state === 'closed') next.final = true;
        else delete next.final;
        return next;
      });
      if (changed) this.deps.host.setPrs(t.id, prs);
    }
  }
}
