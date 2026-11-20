// Keeping a waiting thread's prompt cache warm (docs/guide.md, "Keeping the
// cache warm"). Claude threads run with a one-hour cache: reading a
// conversation of C tokens from it costs about 0.1×C, building it again once
// it has expired about 2×C, so one rebuild costs as much as some twenty
// pings. So a ping goes only to threads that are likely to get an answer
// soon: Claude ones waiting on you in Needs you, with a big context, a little
// before the hour is up, a few times at most, and only in working hours.
// The ping itself is the adapter's (pingCache): a throwaway fork of the
// session that nothing writes down. This file says which threads and when;
// runner/keep-warm.ts runs it.
//
// Settings: runner.json `cacheKeepAlive` (all optional):
//   { "enabled": true, "minContextTokens": 50000, "intervalMinutes": 55,
//     "maxPings": 3, "timeZone": "America/Phoenix",
//     "weekdays": [7, 15], "weekends": [7, 20] }
// weekdays and weekends are [from, to) in hours of the day, in timeZone.
import type { RunnerJson } from './config.ts';

export type KeepAliveConfig = {
  enabled: boolean;
  minContextTokens: number;
  intervalMs: number;
  maxPings: number;
  timeZone: string;
  weekdays: [number, number];
  weekends: [number, number];
};

// The cache's lifetime: a thread whose last call is older than this has
// lost its cache already, and a ping would only pay to build it again.
export const CACHE_TTL_MS = 60 * 60_000;

export const DEFAULT_KEEP_ALIVE: KeepAliveConfig = {
  enabled: true,
  minContextTokens: 50_000,
  intervalMs: 55 * 60_000,
  maxPings: 3,
  timeZone: 'America/Phoenix',
  weekdays: [7, 15],
  weekends: [7, 20],
};

export function keepAliveConfig(json: RunnerJson): KeepAliveConfig {
  const raw: unknown = json.cacheKeepAlive;
  const d = DEFAULT_KEEP_ALIVE;
  if (raw === false) return { ...d, enabled: false };
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
  const hours = (v: unknown, def: [number, number]): [number, number] =>
    Array.isArray(v) && v.length === 2 && num(v[0], 0, 24) !== undefined && num(v[1], 0, 24) !== undefined && v[0] <= v[1] ? [v[0], v[1]] : def;
  const minutes = num(r.intervalMinutes, 1, 59);
  return {
    enabled: r.enabled !== false,
    minContextTokens: num(r.minContextTokens, 0, Infinity) ?? d.minContextTokens,
    intervalMs: minutes !== undefined ? minutes * 60_000 : d.intervalMs,
    maxPings: Math.floor(num(r.maxPings, 0, 100) ?? d.maxPings),
    timeZone: typeof r.timeZone === 'string' && validZone(r.timeZone) ? r.timeZone : d.timeZone,
    weekdays: hours(r.weekdays, d.weekdays),
    weekends: hours(r.weekends, d.weekends),
  };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Whether `now` is inside the hours pings may go out: weekdays' window
// Monday to Friday, weekends' on Saturday and Sunday, in cfg.timeZone.
export function inHours(now: number, cfg: Pick<KeepAliveConfig, 'timeZone' | 'weekdays' | 'weekends'>): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekend = get('weekday') === 'Sat' || get('weekday') === 'Sun';
  const h = Number(get('hour')) + Number(get('minute')) / 60;
  const [from, to] = weekend ? cfg.weekends : cfg.weekdays;
  return h >= from && h < to;
}

// What the keep-alive needs to know of a thread.
export type KeepWarmThread = {
  provider: string;
  // The last finished turn said it needs you (Needs you).
  needsYou: boolean;
  busy: boolean; // a turn, approval, queued message, background job or sub-agent
  snoozed: boolean; // snoozed or hibernated, waiting on other threads included
  archived: boolean;
  waiting: boolean; // for room on a login or for the network
  hasSession: boolean;
  confined: boolean;
  contextTokens?: number;
  lastTurnCompletedSeq: number;
  lastActivityAt: string; // the last turn's end, as the runner has it
  // Pings since the turn at `seq`, the last at `at` (ThreadRecord.keepWarm).
  keepWarm?: { seq: number; pings: number; at: string };
};

// The pings sent since the thread's last real turn, and when its cache was
// last read (that turn's end, or the last ping). A real turn, which is
// what a message from you starts, moves lastTurnCompletedSeq on, so the
// count starts again.
export function warmState(t: KeepWarmThread): { pings: number; lastCallAt: number } {
  const current = t.keepWarm && t.keepWarm.seq === t.lastTurnCompletedSeq ? t.keepWarm : undefined;
  const turnEnd = Date.parse(t.lastActivityAt);
  if (!current) return { pings: 0, lastCallAt: turnEnd };
  return { pings: current.pings, lastCallAt: Math.max(turnEnd || 0, Date.parse(current.at) || 0) };
}

export type PingPlan = { due: true; pings: number } | { due: false; why: string; at?: number };

// Whether a thread gets a ping now, and if not why (or when it would).
export function pingPlan(t: KeepWarmThread, cfg: KeepAliveConfig, now: number): PingPlan {
  if (!cfg.enabled) return { due: false, why: 'off' };
  if (t.provider !== 'claude') return { due: false, why: 'not claude' };
  if (t.archived) return { due: false, why: 'archived' };
  if (t.snoozed) return { due: false, why: 'snoozed' };
  if (!t.needsYou) return { due: false, why: 'not in Needs you' };
  if (t.busy) return { due: false, why: 'busy' };
  if (t.waiting) return { due: false, why: 'waiting' };
  if (!t.hasSession) return { due: false, why: 'no session' };
  if (t.confined) return { due: false, why: 'sandboxed' };
  if ((t.contextTokens ?? 0) < cfg.minContextTokens) return { due: false, why: 'small context' };
  const { pings, lastCallAt } = warmState(t);
  if (pings >= cfg.maxPings) return { due: false, why: 'ping limit' };
  if (!Number.isFinite(lastCallAt)) return { due: false, why: 'no last call' };
  const at = lastCallAt + cfg.intervalMs;
  if (now < at) return { due: false, why: 'not yet', at };
  if (now - lastCallAt >= CACHE_TTL_MS) return { due: false, why: 'cache expired' };
  if (!inHours(now, cfg)) return { due: false, why: 'outside hours' };
  return { due: true, pings };
}
