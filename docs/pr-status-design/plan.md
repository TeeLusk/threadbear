# PR status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each thread's GitHub pull requests, with their state, checks and review stage, shown as a coloured badge on the thread's sidebar row and as cards in its Highlights pane, kept up to date by the runner.

**Architecture:** A new runner service (`runner/src/pr-status.ts`) sees each event as the runner emits it and records the thread's PRs (created, pushed to, pinned) on the thread record. It polls GitHub through `gh api graphql` on a self-rescheduling timer and stores the answers. The summary carries a short `prs` list for the sidebar, and a new `threads.prs` request returns the full checks and reviews for the pane. The Mac app decodes `prs`, works out one tone per thread, and draws Hugeicons (free set) in GitHub's colours.

**Tech Stack:** TypeScript on Node 26 (`node --test`), SwiftUI and AppKit (`swift test`), `gh` CLI GraphQL.

**Spec:** `docs/pr-status-design/README.md`. Read it first. This plan argues from it.

## Global Constraints

- For Christian's copy only. Keep edits to Mike's existing files to small hooks. New logic goes in new files.
- Protocol first: `docs/protocol.md` changes before runner and app code. Both sides tolerate a missing `prs` field and unknown enum values.
- GitHub is only reached through the user's `gh` (resolved with the login shell, `loginShell()` in `runner/src/system-tools.ts`). Threadbear keeps no tokens. No `gh`, or not logged in: the feature is off, with one log line and nothing in the UI.
- Polling: a look 10 s after start if any PR isn't final. Then every 30 s while any non-archived thread has an open PR with checks running, every 60 s while any has an open PR, and none otherwise. A merged or closed PR gets one more look, then it's final.
- `runner.json` `prStatus: false` turns it off. It's on by default.
- Colours (light / dark): open and passing `#1F883D` / `#3FB950`, merged `#8250DF` / `#A371F7`, closed and failing `#CF222E` / `#F85149`, running `#9A6700` / `#D29922`, draft and unknown `#59636E` / `#9198A1`.
- Icons: Hugeicons free set (`@hugeicons/core-free-icons`, MIT), stroke-rounded, as path data in code. No npm dependency and no resource files.
- UI copy: plain words, no em dashes (AGENTS.md).
- Tests while working: `node --test test/unit/<file>.test.ts` in `runner/`, `swift test --filter <Name>` in `app/`. The whole suite runs once at the end: `./check.sh` from the worktree root, on this Mac.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A `gh pr create` that fails or prints no URL** (the PR already exists, or there's no network). Nothing gets tracked and nothing throws. Test in Task 1.
2. **A thread that's archived or deleted while it has an open PR.** Polling stops for it, and a round already running doesn't crash on the missing thread. Test in Task 3.
3. **One PR in a batch that GitHub can't see** (deleted repo, no access: `null` in the answer, or a partial `errors` array). The others still update, and that PR keeps its last snapshot. Test in Task 2.
4. **A summary from a runner without `prs`, or with an unknown `state`** (an old or newer runner). The app decodes it and shows no badge, or a grey one for the unknown state. It never fails to decode the summary. Test in Task 5.
5. **The same PR created by one thread and pushed to by another.** Each thread tracks it, and one GitHub query asks for it once. Test in Task 3.

---

### Task 1: Protocol and finding a thread's PRs

**Files:**
- Modify: `docs/protocol.md`. Add `prs?: ThreadPr[]` to `ThreadSummary` (next to `highlightsAt`, about line 278), `threads.prs` to the requests table, and a "Pull request status" section after "Highlights" with the types below, the polling rhythm and the `prStatus` switch.
- Create: `runner/src/pr-status-types.ts`
- Create: `runner/src/pr-find.ts`
- Test: `runner/test/unit/pr-find.test.ts`

**Interfaces:**
- Produces, in `pr-status-types.ts` (copy the same shapes into protocol.md):

```ts
export type PrState = 'open' | 'draft' | 'merged' | 'closed';
export type PrOutcome = 'passed' | 'failed' | 'running' | 'skipped';
export type PrCheck = { name: string; workflow?: string; outcome: PrOutcome; url?: string; seconds?: number };
export type PrReview = { author: string; state: 'approved' | 'changes' | 'commented' };
export type ThreadPr = {
  url: string; repo: string; number: number; title: string; state: PrState;
  checks?: { state: 'passing' | 'failing' | 'running' | 'none'; passed: number; total: number }; // total leaves out skipped
  review?: { decision: 'approved' | 'changes' | 'waiting' | 'none'; approvals: number; required?: number };
  conflicts?: true;
  checkedAt?: string;
};
export type PrDetail = ThreadPr & { headRef: string; baseRef: string; checkList: PrCheck[]; reviews: PrReview[]; requested: string[] };
export type TrackedPr = { url: string; repo: string; number: number; how: 'created' | 'pushed' | 'pinned'; addedAt: string; snapshot?: PrDetail; final?: true };
```

- Produces, in `pr-find.ts`:
  - `parsePrUrl(url: string): { url: string; owner: string; name: string; number: number } | undefined`. Uses `PR_URL` from `highlights.ts`, exported, not copied.
  - `class PrFinder` with `observe(e: PersistedEvent, cwd: string): PrFound[]`. It keeps pending command calls by `itemId`, the same way `observe` in `highlights.ts` does. Reuse `gitRuns`, `pushedBranches` and `pushArgBranches` from there.
  - `type PrFound = { kind: 'url'; url: string; how: 'created' | 'pinned' } | { kind: 'push'; cwd: string; branches: string[] }`.
    - A `tool.result` for a `gh pr create` call gives `url` items for the PR URLs in its text.
    - A `tool.call` whose `name` matches `/(^|__)pin$/` with a PR URL in `input.url` gives `{ kind: 'url', how: 'pinned' }`.
    - A successful (`e.ok`) `tool.result` for a `git push` gives `push` with the branches it sent. The list is empty when it can't tell, and `cwd` comes from `input.cwd` or else the thread's.

- [ ] **Step 1: Update `docs/protocol.md`** as listed above.
- [ ] **Step 2: Write failing tests** in `pr-find.test.ts`:
  - `created PR url from gh pr create`: call `{type:'tool.call', itemId:'a', input:{command:'gh pr create --fill'}}`, then `{type:'tool.result', itemId:'a', ok:true, text:'https://github.com/trackmyprop/trackmyprop/pull/683\n'}`. Expect `[{kind:'url', url:'https://github.com/trackmyprop/trackmyprop/pull/683', how:'created'}]`.
  - `failed gh pr create finds nothing`: the same call, with result `ok:false`, text `a pull request for branch "x" already exists:` and no URL. Expect `[]` and no throw.
  - `pin of a PR url`: `{type:'tool.call', name:'mcp__threadbear__pin', input:{url:'https://github.com/a/b/pull/3'}}` gives `how:'pinned'`. A pin of `https://example.com` gives `[]`.
  - `push with branch`: command `git push -u origin feat/x`, result ok, text ` * [new branch]      feat/x -> feat/x`. Expect `[{kind:'push', cwd:<thread cwd>, branches:['feat/x']}]`.
  - `push -q with no branch`: gives `branches: []`.
  - `parsePrUrl` trims a trailing `/files` and `#discussion` (`https://github.com/a/b/pull/3/files` gives number 3, url `https://github.com/a/b/pull/3`).
- [ ] **Step 3: Run** `cd runner && node --test test/unit/pr-find.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `pr-status-types.ts` and `pr-find.ts`. Export `PR_URL`, `gitRuns`, `pushedBranches` and `pushArgBranches` from `highlights.ts` where they aren't exported already.
- [ ] **Step 5: Run** the test and `node --test test/unit/highlights.test.ts`. Expected: both PASS.
- [ ] **Step 6: Commit** `PR status: protocol and finding a thread's PRs`.

### Task 2: Asking GitHub

**Files:**
- Create: `runner/src/pr-github.ts`
- Test: `runner/test/unit/pr-github.test.ts`, with fixture `runner/test/fixtures/pr-graphql.json` (a real `gh api graphql` answer for 2 PRs plus one `null`, trimmed of anything private)

**Interfaces:**
- Consumes: the types from Task 1.
- Produces:
  - `buildQuery(prs: { owner: string; name: string; number: number }[]): string`. Aliases `p0`, `p1`, and so on: `p0: repository(owner:"o", name:"n") { pullRequest(number: 1) { ...F } }` with one `fragment F on PullRequest`. Fields: `title url state isDraft merged headRefName baseRefName mergeable reviewDecision`, `latestReviews(first:20){nodes{author{login} state}}`, `reviewRequests(first:10){nodes{requestedReviewer{... on User{login} ... on Team{name}}}}`, `baseRef{branchProtectionRule{requiredApprovingReviewCount}}`, and `commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion detailsUrl startedAt completedAt checkSuite{workflowRun{workflow{name}}}} ... on StatusContext{context state targetUrl}}}}}}}`. Owner and name are JSON-quoted.
  - `parseAnswer(json: unknown, asked: { url: string }[], now: string): Map<string, PrDetail>`. Keyed by PR url. Aliases that are `null` or missing are left out.
  - `outcomeOf(node): PrOutcome`. Same rules as `outcome()` in `~/.threadbear/patches/github-pr.ts`, but on GraphQL values (`COMPLETED`/`SUCCESS`, etc.).
  - `toThreadPr(d: PrDetail): ThreadPr`. Checks state: `failing` if any failed, else `running` if any running, else `passing` if any passed, else `none`. `total` leaves out skipped.
  - `type Gh = { graphql(query: string): Promise<unknown>; prForBranch(cwd: string, branch?: string): Promise<string | undefined> }` and `async function ghFromLoginShell(log: Logger): Promise<Gh | undefined>`.
    - `ghFromLoginShell` resolves `gh` once with `command -v gh` through `loginShell()`. It returns `undefined` when `gh` is missing or `gh auth status` fails.
    - `graphql` runs `gh api graphql -f query=<q>` with a 20 s timeout. It returns the parsed JSON even when it carries `errors`, as long as there's `data`.
    - `prForBranch` runs `gh pr view [branch] --json url,state` in `cwd`. It gives the url only when `state` is `OPEN`.
  - `BATCH = 25`.

- [ ] **Step 1: Write failing tests:**
  - `buildQuery quotes and aliases`: two PRs in two repos give a query containing `p0: repository(owner:"trackmyprop", name:"trackmyprop")` and `pullRequest(number: 683)`. `owner:'a"b'` comes out JSON-escaped.
  - `parseAnswer maps the fixture`: the open PR gives `state:'open'`, the check names, one `failed` outcome with its `detailsUrl`, `seconds` from the start and end times, `review.decision`, `required` when `branchProtectionRule` is present, and `conflicts` when `mergeable` is `CONFLICTING`.
  - `null PR is skipped`: the third alias is `null`, so the map has 2 entries.
  - `draft and merged`: `isDraft:true` with `state:"OPEN"` gives `draft`. `merged:true` gives `merged`. `CLOSED` and not merged gives `closed`.
  - `toThreadPr counts`: 3 passed, 1 skipped and 1 failed give `{state:'failing', passed:3, total:4}`.
- [ ] **Step 2: Run** `node --test test/unit/pr-github.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pr-github.ts`. Get the fixture by running the query against two of Christian's PRs (`trackmyprop/trackmyprop` #683 and #681), then set the third alias to `null` by hand.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `PR status: asking GitHub`.

### Task 3: The tracker and its rhythm

**Files:**
- Create: `runner/src/pr-status.ts`
- Test: `runner/test/unit/pr-status.test.ts`

**Interfaces:**
- Consumes: `PrFinder` (Task 1), `Gh`, `buildQuery`, `parseAnswer`, `toThreadPr` and `BATCH` (Task 2), `Clock` and `FakeClock` (`src/clock.ts`).
- Produces:

```ts
export type PrRecordHost = {
  threads(): { id: string; cwd: string; archived: boolean; prs?: TrackedPr[] }[];
  setPrs(threadId: string, prs: TrackedPr[]): void; // saves on the record and marks the thread dirty
};
export class PrStatus {
  constructor(deps: { clock: Clock; log: Logger; host: PrRecordHost; gh: () => Promise<Gh | undefined>; now: () => string });
  start(): void; stop(): void;
  observe(threadId: string, cwd: string, e: PersistedEvent): void; // runs the PrFinder; a new PR or a push triggers a look soon (1 s debounce)
  adopt(threadId: string, urls: string[]): void;                   // PRs from old highlights (how 'created'), no look forced
  summary(prs: TrackedPr[] | undefined): ThreadPr[] | undefined;   // newest first; a PR never fetched → { url, repo, number, title: `${repo}#${n}`, state: 'open' } without checkedAt
  details(prs: TrackedPr[] | undefined): PrDetail[];
}
export const FIRST_MS = 10_000, FAST_MS = 30_000, OPEN_MS = 60_000;
```

- One round collects the distinct URLs that aren't `final`, from threads that aren't archived. It queries them in batches of `BATCH` and writes each snapshot back to every thread tracking that URL, calling `setPrs` only for threads whose snapshots changed. A merged or closed snapshot sets `final`.
- A push `PrFound` calls `gh.prForBranch` for each branch, or once with no branch when the list is empty, and adds any URL found as `how:'pushed'`.
- A failed `graphql` keeps every snapshot and logs a warning.
- The next delay: `FAST_MS` if any open PR has checks running, else `OPEN_MS` if any is open, else no timer. `observe` and `adopt` re-arm it.
- `gh()` returning `undefined` logs `PR status is off: gh isn't installed or logged in` once, and rounds do nothing.

- [ ] **Step 1: Write failing tests** with `FakeClock` and a fake `Gh` that counts calls and serves answers from a map:
  - `created PR is looked at soon and shown`: observe a `gh pr create` pair, then advance 1 s. There's 1 graphql call, `setPrs` is called with a snapshot, and `summary()` has `checkedAt`.
  - `rhythm`: with an open PR whose checks are running, the next look is after 30 s. Once the checks pass, it's after 60 s. Once merged, there's one more look, then no timer, and advancing 10 minutes makes 0 more calls.
  - `archived thread is not polled`: set `archived:true` and advance. No query includes its URL.
  - `deleted mid-round`: `threads()` no longer lists the thread when the answer arrives. There's no throw and no `setPrs` for it.
  - `failure keeps last status`: graphql rejects once. The snapshot is unchanged and the next round still runs.
  - `shared PR asked once`: two threads track the same URL. The query has it once, and both threads get the snapshot.
  - `push finds the open PR`: a push event whose fake `prForBranch` returns a URL adds it with `how:'pushed'`.
  - `no gh`: `gh` resolves `undefined`. There are no calls, no throw, and one log line.
- [ ] **Step 2: Run** `node --test test/unit/pr-status.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `PrStatus`. Copy the timer pattern from `Upstream.start/stop/tick` in `src/upstream.ts:230-260`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `PR status: the tracker`.

### Task 4: Wiring it into the runner

**Files:**
- Modify: `runner/src/store.ts` (the thread record, near `highlights?` at line 145): add `prs?: TrackedPr[]`.
- Modify: `runner/src/runner.ts`:
  - Add a public field `prStatus?: PrStatus`.
  - In `emit()` (line 2821), after `log.append(event)`: `this.prStatus?.observe(st.rec.id, st.rec.cwd, event);`.
  - In `summary()` (line 3019 area): `if (rec.prs?.length && this.prStatus) s.prs = this.prStatus.summary(rec.prs);`.
- Modify: `runner/src/runner/highlights.ts`, at the end of `catchUpHighlights` (line 114): `this.prStatus?.adopt(st.rec.id, items.filter(h => h.kind === 'pr' && h.how === 'created').map(h => h.url!))`.
- Modify: `runner/src/rpc.ts`:
  - Add `'threads.prs'` to the list at line 65.
  - Add `case 'threads.prs': return { prs: r.prStatus?.details(r.mustGet(reqString(p, 'threadId')).rec.prs) ?? [] };` next to `threads.highlights` (line 615). Use whatever public accessor `highlights()` uses if `mustGet` isn't reachable from rpc.
- Modify: `runner/src/config.ts`: `prStatus: boolean`, from `json.prStatus !== false` and env `THREADBEAR_PR_STATUS`, the same way `followMain` is read (line 265).
- Modify: `runner/src/main.ts`: build the `PrStatus` next to `Upstream` (line 529), with a host built on the runner's thread list and a `setPrs` that writes `rec.prs` and calls `markDirty`. Set `runner.prStatus` and `start()` it next to `upstream.start()` (line 690), and `stop()` it at line 710. Only when `cfg.prStatus` is on.
- Modify: `docs/on-your-mac.md`, the GitHub row (line 208). Append: "Your threads' pull requests, through your own `gh` login: their state, checks and reviews, every 30 to 60 seconds while one is open (`runner/src/pr-status.ts`). Off with `prStatus: false` in `runner.json`."
- Test: `runner/test/unit/pr-status-runner.test.ts`. Build a Runner the way `test/unit/highlights.test.ts` or the nearest Runner-level test does, with a fake `Gh`.

- [ ] **Step 1: Write failing test** `summary carries prs`. Emit a `gh pr create` call and result on a thread, advance the clock, and check that `runner.summary(st).prs[0].state === 'open'` and that `thread.updated` went out with it. Then `threads.prs` returns its `checkList`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the hooks above.
- [ ] **Step 4: Run** it, then `npx tsc --noEmit -p .` in `runner/`. Expected: PASS, with no type errors.
- [ ] **Step 5: Commit** `PR status: wired into the runner`.

### Task 5: App models and badge logic

**Files:**
- Modify: `app/Sources/ThreadbearCore/Protocol/Models.swift`. Add `prs: [ThreadPR]` to `ThreadSummary` (default `[]`), with init param, lenient decode (`(try? c.decodeIfPresent([ThreadPR].self, forKey: .prs)) ?? nil ?? []`), encode, and a `CodingKeys` entry. Keep the diff to those lines.
- Create: `app/Sources/ThreadbearCore/Protocol/PullRequests.swift` with `ThreadPR`, `PRDetail`, `PRCheck` and `PRReview`, mirroring Task 1.
  - Enums decode unknown strings to `.unknown`, so unknown values never throw.
  - A `public func threadPRs(threadId: String) async throws -> [PRDetail]` goes in an `extension` of the RunnerAPI type in this file, calling `threads.prs` (see `threadHighlights` in `RPC/RunnerAPI.swift:119`).
- Create: `app/Sources/ThreadbearCore/Threads/PRBadge.swift`:
  - `public enum PRTone { case failing, running, open, draft, merged, closed }`
  - `public static func tone(_ prs: [ThreadPR]) -> PRTone?`. The order: failing (an open PR with failing checks, conflicts or changes requested), running, open, draft (also any PR with `checkedAt == nil` or state `.unknown`), merged (all merged), closed. `nil` for none.
  - `public static func tooltip(_ prs: [ThreadPR]) -> String`, e.g. `2 pull requests: #683 checks failing, #681 merged`.
  - `public static func reviewLine(_ pr: PRDetail) -> String?`: "Approved", "1 of 2 approvals", "Changes requested by @x", "Waiting for review from @x", or "Waiting for review".
- Test: `app/Tests/ThreadbearCoreTests/PullRequestsTests.swift`

- [ ] **Step 1: Write failing tests:**
  - `testDecodesSummaryWithoutPRs`: an existing summary fixture or JSON without `prs` gives `prs == []`.
  - `testUnknownStateDecodes`: `"state":"queued"` decodes to `.unknown`, and `tone` is `.draft`.
  - `testToneOrder`: [merged, open with failing checks] gives `.failing`. [merged, open running] gives `.running`. [merged, merged] gives `.merged`. [closed] gives `.closed`. [draft] gives `.draft`. [open with no `checkedAt`] gives `.draft`. [] gives `nil`.
  - `testTooltip`: the exact string above for #683 failing and #681 merged.
  - `testReviewLine`: required 2 with 1 approval gives `"1 of 2 approvals"`. Decision changes by `x` gives `"Changes requested by @x"`.
- [ ] **Step 2: Run** `cd app && swift test --filter PullRequestsTests`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus `swift test --filter HighlightsTests`. Expected: PASS.
- [ ] **Step 5: Commit** `PR status: app models and badge logic`.

### Task 6: Icons, colours and the sidebar badge

**Files:**
- Create: `app/Sources/Threadbear/PRIcon.swift`. A `PRIcon` enum shaped like `ProviderLogo` (`ProviderLogo.swift`): template `NSImage` from SVG, cached by name and size.
  - Icons: `GitPullRequestIcon`, `GitPullRequestDraftIcon`, `GitPullRequestClosedIcon`, `GitMergeIcon`, `CheckmarkCircle02Icon`, `CancelCircleIcon`, `Loading03Icon`.
  - Get their element arrays from `@hugeicons/core-free-icons` 4.x: `npm pack` it into a temp folder outside the repo, read `dist/esm`, and delete the folder.
  - They're stroke icons, so the SVG wrapper uses `fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"` with each element as given.
  - The comment names Hugeicons, the MIT licence and the package version.
- Create: `app/Sources/Threadbear/PRColors.swift`: `extension PRTone { var color: Color }`, using the Global Constraints hex values through `NSColor(name:dynamicProvider:)` for light and dark.
- Create: `app/Sources/Threadbear/Views/PRBadgeView.swift`: `struct PRBadgeView: View { let prs: [ThreadPR] }`.
  - Draws nothing when `PRBadge.tone` is nil.
  - The icon is merge for `.merged`, closed for `.closed`, draft for `.draft`, and pull request otherwise. It's sized to `TypeScale.sidebarMeta + 2`, tinted with the tone colour.
  - The count is in `TypeScale.sidebarMeta`, `SidebarMetrics.faint`, `.monospacedDigit()`, and only when there are 2 or more PRs.
  - `.tip(PRBadge.tooltip(prs))`, and an accessibility label with the same text.
- Modify: `app/Sources/Threadbear/Views/SidebarView.swift:672`, in the title `HStack` after `Spacer(minLength: 0)`: `if !showsActions { PRBadgeView(prs: thread.prs).padding(.leading, zoomed(6)) }`. That's the only edit to this file.

- [ ] **Step 1: Build** `cd app && swift build`. Expected: succeeds.
- [ ] **Step 2: See it.** Run the app from the worktree the way `docs/dev-tools.md` says, with `dev-app.sh start --appearance dark`, against a runner that has a thread tracking trackmyprop #683. Capture the app window only (by window id). Expected: a purple merge icon on that row, and no change to other rows. Delete the screenshot afterwards unless it's for Christian.
- [ ] **Step 3: Commit** `PR status: sidebar badge`.

### Task 7: The Pull requests section in Highlights

**Files:**
- Create: `app/Sources/Threadbear/Views/PullRequestsSection.swift`: `struct PullRequestsSection: View { let thread: ThreadSummary }`.
  - Fetches `[PRDetail]` with `.task(id: thread.prs)` through `app.client(for: thread.id)?.threadPRs`. It falls back to `thread.prs` (no checks list) while loading, or if the runner doesn't know `threads.prs` (`RPCError.methodNotFound`).
  - Renders a `SectionHeading(title: "Pull requests", …)` with its own fold key, then one card per PR:
    - The header row: icon in its tone colour, the title on one line, and `repo #N · Open/Draft/Merged/Closed` underneath. A click opens the PR with `app.open`, the way link highlights do.
    - Checks: `Checks · X of Y passed` (from `checks`). Folded unless `checks.state == .failing`. Unfolded, one `PaneRow` per check, ordered failed, running, passed, skipped, with the icon in its colour, `workflow` as detail, `seconds` as trailing ("1m 4s"), and a click to `url`.
    - `PRBadge.reviewLine` as a row, when not nil.
    - "Merge conflicts with <baseRef>" in red, when `conflicts`.
    - "Checked 40s ago" (`RelativeTime`) in faint type.
    - A ••• menu with Open on GitHub, Copy link, and, only when checks fail, **Fix failing checks**. That sends the thread: "This pull request's checks are failing: <url>. Look with `gh pr checks <url>` and `gh run view <run-id> --log-failed`, find the cause, fix it, and push. Tell me if a failure isn't from this branch's changes." Send it through the same model call the composer uses (`AppModel+ThreadActions.swift`).
- Modify: `app/Sources/Threadbear/Views/HighlightsView.swift`:
  - Insert `if !thread.prs.isEmpty { PullRequestsSection(thread: thread) }` just above the `Pinned` section (line 144).
  - Where `sections` is built (line 28), drop `.pr` links whose url is in `thread.prs`, so a PR isn't listed twice.

- [ ] **Step 1: Write failing test** in `PullRequestsTests`: `testTrackedPRsLeaveLinks`. Build `HighlightSections` from highlights holding a tracked and an untracked PR URL, filtered the way the view does through a small `public static func withoutTracked(_:prs:)` in `PRBadge.swift`. Only the untracked one stays in `links`.
- [ ] **Step 2: Run** `swift test --filter PullRequestsTests`. Expected: FAIL, then implement and PASS.
- [ ] **Step 3: Implement** the section and the two hooks. Build with `swift build`.
- [ ] **Step 4: See it**, as in Task 6, on the #683 thread with the pane open. Expected: a card with "Merged", "Checks · 12 of 13 passed", and the failed check listed first.
- [ ] **Step 5: Commit** `PR status: Pull requests in Highlights`.

### Task 8: Tidy, full check and landing

**Files:**
- Modify: `~/.threadbear/patches/github-pr.ts` (outside the repo, not committed). Delete the `panels` entry. Keep the three actions.
- Modify: `docs/pr-status-design/README.md` only if something built differs from it.

- [ ] **Step 1: Run the whole suite**: `./check.sh` from the worktree root. Expected: all green. Fix anything this work broke.
- [ ] **Step 2: Real check.**
  - Open a scratch PR on a repo of Christian's from a thread, with a check that runs for at least 30 s.
  - Watch the row go amber, then green.
  - Make the check fail and watch it go red, with Fix failing checks in the menu.
  - Merge it and watch it go purple.
  - Close the scratch PR and delete its branch afterwards.
- [ ] **Step 3: Remove the patch panel** and confirm with `show_panel patches` that the patch still loads.
- [ ] **Step 4: Merge.** In `~/threadbear`, `git merge --no-ff pr-status`. His runner and app follow that `main` and pick it up within about five minutes. Ask Christian before pushing it to `origin` (his public fork).
- [ ] **Step 5: Offer cleanup**: remove the worktree `~/threadbear-threads/pr-status`, the `pr-status` branch, and the worktree's `app/.build`. Ask first (CLAUDE.md).
