---
id: cacheKeepAlive
name: Cache pings
title: Cache pings: keep a big waiting thread's prompt cache warm while you're likely to answer
added: 2026-11-13
on: false
reminder: e87d6543
---

## What it does

Claude keeps a conversation in its prompt cache for an hour after each call. Coming back to a big thread after that reads the whole conversation in again at full price, about twenty times what reading it from the cache costs. With this on, a Claude thread waiting on you in Needs you with more than 50K tokens of context gets a tiny ping about 55 minutes after its last call, which reads the cache and keeps it another hour. The ping goes to a throwaway copy of the conversation on the login the thread last ran on, so nothing is added to the thread. At most 3 pings per wait, only in working hours (7:00 to 15:00 on weekdays, 7:00 to 20:00 at weekends, your Mac's time), never to a thread that's done, hibernating, snoozed, archived, working or sandboxed, and never on a login with no room. Their tokens count in Usage, and each one is a line in the runner log ("cache ping"). The limits are `cacheKeepAlive` in `runner.json`.

## Lives in

`runner/src/cache-keepalive.ts` (which threads, when), `runner/src/runner/keep-warm.ts`, `pingCache` and `sessionOptions` in `runner/src/adapters/claude/adapter.ts`, the timer in `runner/src/main.ts`, `addCall` in `runner/src/token-tally.ts`. From DavidClarkTucson's fork.

## Taking it out

Delete the two files, the timer in `main.ts`, `pingCache` (keep `sessionOptions`, the session uses it), `addCall`, `keepWarm` in `store.ts`, `cacheKeepAlive` in `config.ts`, and `keepWarmPart` from `runner.ts`'s list of parts.
