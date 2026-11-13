// Cache pings for threads waiting on you (cache-keepalive.ts says which and
// when; the adapter's pingCache sends one). A part of the Runner like the
// others in this folder: each method's `this` is the Runner, and runner.ts
// puts them on its prototype. main.ts calls keepWarmTick once a minute.
import path from 'node:path';
import type { Runner, ThreadState } from '../runner.ts';
import type { RunnerPart } from './part.ts';
import type { CachePing } from '../adapters/types.ts';
import { keepAliveConfig, pingPlan, type KeepWarmThread } from '../cache-keepalive.ts';
import { claudeOptions, claudeSettingsWithoutCommands } from '../claude-trust.ts';
import { paths, readRunnerJson } from '../config.ts';
import { experimentOn } from '../experiments.ts';
import { loginOk } from '../pools.ts';
import { threadEnv } from '../restart.ts';

// One ping that went out, for the Usage panel's hourly tokens (main.ts).
export type SentPing = { threadId: string; accountId: string; at: number; ping: CachePing };

// Pings in flight, by thread, so a slow one isn't sent twice.
const pinging = new WeakMap<Runner, Set<string>>();

export const keepWarmPart = {
  keepWarmView(this: Runner, st: ThreadState): KeepWarmThread {
    const { rec, rt } = st;
    const busy = Boolean(rt.turn) || rt.approvals.size > 0 || rec.queue.length > 0 || rt.tasks.length > 0
      || Boolean(rec.subagents?.some((a) => a.status === 'running'))
      || rec.status === 'running' || rec.status === 'starting' || rec.status === 'waiting'
      || Boolean(pinging.get(this)?.has(rec.id));
    return {
      provider: rec.provider,
      needsYou: rec.needs?.seq === rec.lastTurnCompletedSeq && rec.needs.needs === 'you',
      busy,
      // Snoozed or hibernated, which waiting on other threads is too.
      snoozed: Boolean(rec.snoozedUntil),
      archived: Boolean(rec.archivedAt) || Boolean(rt.deleted),
      waiting: Boolean(rec.waitingForRoom || rec.waitingForNetwork),
      hasSession: Boolean(rec.sessionUsed && rec.nativeSessionId),
      confined: Boolean(rec.confined) || this.sandboxed(rec.cwd),
      ...(rec.contextTokens !== undefined ? { contextTokens: rec.contextTokens } : {}),
      lastTurnCompletedSeq: rec.lastTurnCompletedSeq,
      lastActivityAt: rec.lastActivityAt,
      ...(rec.keepWarm ? { keepWarm: rec.keepWarm } : {}),
    };
  },

  // Sends the pings that are due, one after another, and says what went.
  async keepWarmTick(this: Runner): Promise<SentPing[]> {
    // An experiment (experiments/cacheKeepAlive.md): off unless it's on,
    // and then runner.json's cacheKeepAlive sets the limits.
    if (!experimentOn(this.cfg.home, 'cacheKeepAlive')) return [];
    const cfg = keepAliveConfig(readRunnerJson(this.cfg.home));
    if (!cfg.enabled || this.stopping) return [];
    const sent: SentPing[] = [];
    for (const st of [...this.threads.values()]) {
      if (this.stopping) break;
      const plan = pingPlan(this.keepWarmView(st), cfg, this.clock.now());
      if (!plan.due) continue;
      const done = await this.pingThreadCache(st, plan.pings, cfg.maxPings);
      if (done) sent.push(done);
    }
    return sent;
  },

  // One ping, on the login the thread last ran on, as its cache is that
  // login's. A login with no room is left alone: the ping waits for the
  // next minute, and the cache may expire meanwhile.
  async pingThreadCache(this: Runner, st: ThreadState, before: number, max: number): Promise<SentPing | undefined> {
    const { rec } = st;
    const adapter = this.adapters[rec.provider];
    if (!adapter?.pingCache || !rec.nativeSessionId) return undefined;
    const account = this.usableAccounts().find((a) => a.id === rec.accountId);
    if (!account || !loginOk(account)) {
      this.log.info('cache ping skipped: no room on its login', { threadId: rec.id, accountId: rec.accountId });
      return undefined;
    }
    const set = pinging.get(this) ?? new Set<string>();
    pinging.set(this, set);
    set.add(rec.id);
    const seq = rec.lastTurnCompletedSeq;
    const claude = this.patchTrust.checkClaude(rec.cwd, claudeOptions(rec));
    let ping: CachePing;
    try {
      ping = await adapter.pingCache({
        threadId: rec.id,
        cwd: rec.cwd,
        account,
        model: rec.model,
        effort: rec.effort,
        permissionMode: rec.permissionMode,
        sessionId: rec.nativeSessionId,
        resume: true,
        mediaDir: this.store.mediaDir(rec.id),
        blobsDir: this.store.blobsDir(rec.id),
        tmpDir: path.join(paths.run(this.cfg.home), 'tmp'),
        allowRules: rec.allowRules ?? [],
        env: threadEnv(rec.id, this.cfg.home),
        ...(!claude.trusted ? { untrustedProjectSettings: claudeSettingsWithoutCommands(rec.cwd) } : {}),
      });
    } finally {
      set.delete(rec.id);
    }
    const at = this.clock.now();
    // Counted even when it failed, so a failing one isn't sent every minute.
    // A turn meanwhile has started the count again, and wins.
    if (rec.lastTurnCompletedSeq === seq && !st.rt.deleted) {
      rec.keepWarm = { seq, pings: before + 1, at: new Date(at).toISOString() };
      this.markDirty(st);
    }
    const n = before + 1;
    if (ping.ok) {
      const fields = { threadId: rec.id, accountId: account.id, ping: `${n} of ${max}`, context: rec.contextTokens, cacheRead: ping.cacheReadTokens, cacheWrite: ping.cacheWriteTokens, input: ping.inputTokens, output: ping.outputTokens, ms: ping.ms };
      // A write as big as the read means the prefix didn't match and the
      // cache was built again: worth knowing, as that's the costly case.
      if (ping.cacheWriteTokens > ping.cacheReadTokens) this.log.warn('cache ping missed the cache', fields);
      else this.log.info('cache ping', fields);
    } else {
      this.log.warn('cache ping failed', { threadId: rec.id, accountId: account.id, ping: `${n} of ${max}`, error: ping.error, ms: ping.ms });
      if (ping.limit) this.markRanDry(account);
    }
    return { threadId: rec.id, accountId: account.id, at, ping };
  },
};

export type KeepWarmPart = RunnerPart<typeof keepWarmPart>;
