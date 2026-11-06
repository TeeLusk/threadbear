# PR status in the sidebar and the side pane

Christian, 2026-11-06. This is for Christian's copy only, not for Mike's
Threadbear.

## Why

Christian ships trackmyprop through pull requests that Threadbear threads
open. To see where a PR stands he goes to github.com: is it merged, are
the checks green, has a reviewer asked for changes, how many approvals
does it still need. He wants that inside Threadbear, the way other agent
apps show it: a glance at the sidebar tells him which threads' PRs need
him, and the thread's side pane shows the whole PR without opening GitHub.

This is the first of three pieces. The other two come later, each with
its own design: trackmyprop's GitHub issues inside Threadbear, then
reviewing PRs (diffs and comments) inside Threadbear. Build this one so
those two can sit on top of it, but build neither.

## Goals

1. **Sidebar badge.** A thread that has a PR shows a small PR icon on its
   row, coloured by where its PRs stand, with a count when it has more
   than one (reference: a "4" beside the icon for a thread with four
   PRs). Threads with no PR look exactly as they do now.
2. **Pull requests in the side pane.** The thread's Highlights pane gets
   a "Pull requests" section: one card per PR with its title, `repo #N`,
   state, each check, and the review stage.
3. **Kept up to date by itself.** The badge and the cards change within
   about a minute of something happening on GitHub, with nobody pressing
   anything.
4. **GitHub's colours** (Christian's words: merged is purple, failed is
   red, open is green, green CI is green) and **Hugeicons** for the
   icons, so it reads like GitHub's own UI.

## Non-goals

- The iPhone app and the website. They read a Convex mirror of the
  summary, not the summary. Mac app only.
- Notifications or moving a thread to Needs you when CI fails.
- Diffs, review comments, replying or approving (piece 3).
- GitHub issues (piece 2).
- Offering this to Mike. Docs that only matter to Mike's version
  (`docs/forking.md`, `docs/guide.md`) don't need to change.
- GitHub Enterprise or other hosts. github.com only.

## Anti-goals (it fails even if it works)

- **Clutter.** A row with no PR doesn't change. The badge is one small
  icon and at most a number, no text like "Open" or "2/3 checks".
- **Lying.** A stale colour is worse than none. If it can't reach GitHub
  (no `gh`, logged out, offline), it shows what it last knew. It never
  shows something it doesn't know: a PR it has never fetched gets a grey
  icon.
- **Burning the rate limit or the battery.** No polling for archived
  threads, merged or closed PRs, or when nothing is open.
- **Merge pain.** Christian's copy pulls in Mike's updates. Keep the
  change to Mike's files as small as possible: new code goes in new
  files, and existing files only get small hooks (a field, a call, a
  view in a slot). The sidebar row (`SidebarView.swift`) and
  `runner.ts` change often upstream, so touch them the least.

## How it works

### Which PRs belong to a thread

- PRs the thread **created**: the URL `gh pr create` printed. This is
  already recognised in `runner/src/highlights.ts` (`PR_URL_G` on the
  result of a pending `gh pr create` call).
- PRs the thread **pushed to**: after a `git push` the thread ran (also
  already recognised in highlights.ts, which marks commits `pushed`), ask
  GitHub for an open PR whose head is the branch just pushed, in the
  folder's repo. If there is one, it belongs to the thread too. This
  catches a thread that fixes an existing PR.
- PRs the thread **pinned** with the `pin` tool.
- Not: PRs that were only mentioned or linked. Those stay in Links as
  today.

Today highlights are only worked out when a client opens the pane
(`catchUpHighlights`), so the sidebar never knows about them. This needs
a way to recognise the three cases above **as events arrive**, for every
thread, and store the result on the thread's record (`rec.prs`). The
recognisers should share code with highlights.ts rather than copy it.
Older threads get their PRs filled in the first time their highlights
catch up. They don't have to appear on day one.

### Asking GitHub

- Through the user's logged-in `gh` (`gh api graphql`), never a token
  Threadbear keeps itself. If `gh` isn't installed or logged in, the
  feature is quietly off. Say so once in the runner log, not in the UI.
- **One batched GraphQL query** for every PR that needs a look, using
  aliases (`pr0: repository(owner,name){ pullRequest(number) {...} }`).
- Fields per PR: `state`, `isDraft`, `merged`, `title`, `url`,
  `headRefName`, `baseRefName`, `mergeable`, `reviewDecision`,
  `latestReviews` (author and state), `reviewRequests` (who's still
  asked), and the head commit's `statusCheckRollup` contexts (CheckRun:
  name, status, conclusion, detailsUrl, workflow name, started and
  completed times; StatusContext: context, state, targetUrl).
- **Approvals needed** ("1 of 2 approvals"): the base branch's
  `branchProtectionRule.requiredApprovingReviewCount` when GitHub returns
  it (it may not without admin rights, or under rulesets). Without it,
  show the review decision on its own ("Waiting for review",
  "Approved", "Changes requested").
- **When to look.**
  - At once when a thread gets a new PR (created, pushed to, pinned) and
    after any `git push` from a thread that has an open PR.
  - Every 30 seconds while any non-archived thread has an open PR whose
    checks are running.
  - Every 60 seconds while any non-archived thread has an open PR, so a
    review or a merge on GitHub shows within the minute the goal promises.
  - Not at all otherwise.
  - A merged or closed PR gets one last look, then is final.
  - When the runner starts, open PRs get a look in the first round.
- Copy the polling pattern of `runner/src/upstream.ts` (`Upstream`: a
  self-rescheduling `setTimeout` on an injectable `Clock`, `start()` and
  `stop()` wired in `main.ts`) and make the `gh` call injectable, so tests
  use `FakeClock` and a fake GitHub.
- A failed look keeps the last known status and tries again on the next
  round.

### What the summary carries

`ThreadSummary` gains an optional `prs` (protocol first: add it to
`docs/protocol.md`, then the runner, then the app, as the repo's rules
say). It's sent with the summary, so a change goes out as
`thread.updated` like any other field. Sketch, the names are the
builder's call:

```ts
type ThreadPr = {
  url: string
  repo: string            // "trackmyprop/trackmyprop"
  number: number
  title: string
  state: "open" | "draft" | "merged" | "closed"
  checks?: { state: "passing" | "failing" | "running" | "none"; passed: number; total: number }
  review?: { decision: "approved" | "changes" | "waiting" | "none"; approvals: number; required?: number }
  conflicts?: true
  checkedAt?: string      // last successful look; absent: never fetched
}
```

The list of individual checks and reviews is too much to send on every
summary. The side pane fetches it on demand with a new request
(`threads.prs` or similar), answered from the last look, not by asking
GitHub again.

Both sides tolerate it missing and tolerate unknown values, so an app
and a runner of different ages still work.

### The sidebar badge

- Placed at the trailing end of the row's **title line** (in the
  reference it sits just after the title, before the unread dot). Hidden
  while the row's hover buttons show, like the trailing status is.
- The icon is the Hugeicons pull-request shape for open and draft, the
  merge shape for merged, and the closed-PR shape for closed. The count
  follows in the faint sidebar meta type when there are 2 or more.
- **One colour for the thread**, from its PR that most needs attention,
  in this order:
  1. Red: an open PR with failing checks, merge conflicts or changes
     requested.
  2. Amber: an open PR whose checks are running.
  3. Green: an open PR (checks passing or none).
  4. Grey: a draft, or a PR never fetched.
  5. Purple: all merged.
  6. Red, dimmed: all closed without merging (when nothing above
     applies).
- A tooltip says it in words, e.g. "2 pull requests: #683 checks
  failing, #681 merged".
- Colours are GitHub Primer's, light and dark:

  | Meaning | Light | Dark |
  |---|---|---|
  | Open / passing | `#1F883D` | `#3FB950` |
  | Merged | `#8250DF` | `#A371F7` |
  | Closed / failing | `#CF222E` | `#F85149` |
  | Running | `#9A6700` | `#D29922` |
  | Draft / unknown | `#59636E` | `#9198A1` |

### The side pane

- A **"Pull requests"** section at the top of Highlights, above Pinned.
  PRs move out of Links into it.
- One card per PR, newest first:
  - Header: state icon in its colour, the title (one line, truncated),
    and `repo #N · Open/Draft/Merged/Closed` in grey underneath. A click
    opens the PR the way links open today (`app.open`).
  - Checks: a line like "Checks · 11 of 12 passed", folded by default
    unless any failed. Unfolded: one row per check with a tick, cross or
    spinner in its colour, the name, its workflow, how long it took, and
    a click to its run. Failed first, then running, passed, skipped.
  - Review: "Approved", "1 of 2 approvals", "Changes requested by
    @name" or "Waiting for review from @name", with avatar-free text.
  - "Merge conflicts with main" in red when GitHub says so.
  - A ••• menu: Open on GitHub, Copy link, and **Fix failing checks**
    (only when checks fail: sends the thread the same prompt as the
    existing patch's chip, with this PR's URL in it, since a thread can
    have several PRs).
  - "Checked 40s ago" in faint type at the foot, so a stale card says it
    is stale.
- Visual reference: Christian's screenshot of a "Changes" list. Each row
  is a purple PR icon, the title, then `trackmyprop #683` in grey, then
  a ••• button.

### Icons

Hugeicons, stroke-rounded, from the **free** set
(`@hugeicons/core-free-icons`, MIT): it has every shape this needs
(`GitPullRequest`, `GitPullRequestDraft`, `GitPullRequestClosed`,
`GitMerge`, `CheckmarkCircle02`, `CancelCircle`, `Loading03`). Christian
offered his Pro key, but his fork is public, and putting Pro artwork in
it would publish paid icons; the free set is the same family and style.
*(Designer's call.)* Copy only the SVGs used and keep their path data in
code as template images, the way `ProviderLogo.swift` keeps its SVGs,
with a comment naming the icon and the licence. No npm dependency, no
new resource folder.

### On/off

Optional `prStatus: false` in `runner.json` turns it off. It's on by
default when `gh` is logged in. `docs/on-your-mac.md` gets a row for the
new GitHub calls: what's asked, how often, and that it goes through
`gh`.

### The earlier patch

`~/.threadbear/patches/github-pr.ts` (made the same day, a rail panel
and chips for the current branch's PR) stays. Its chips (Fix failing
checks, Address review, Resolve conflicts) are still useful. Remove its
"Pull request" rail panel once the side pane section works, since it
would show the same thing twice.

## Testing

- Runner unit tests (`node --test test/unit/<name>.test.ts` in
  `runner/`): which PRs a thread gets from created, pushed and pinned
  events; the polling rhythm with `FakeClock` (fast while running, slow
  while open, stops when merged, nothing for archived); a failed look
  keeping the last status; the GraphQL answer turned into `ThreadPr`.
- App tests (`swift test --filter …` in `app/`): the colour and count a
  set of PRs gives, and decoding a summary with and without `prs`.
- Mike's check hosts (`check.sh`) are Mike's machines. How whole suites
  run in this copy: see "Landing".
- Real check: a scratch PR on a repo of Christian's, watched in the app
  through open, checks running, failing, passing, merged.

## Landing

The work is on the `pr-status` branch in the worktree
`~/threadbear-threads/pr-status`. Christian's installed runner and app
follow the `main` of `~/threadbear` and rebuild themselves within about
five minutes of it changing (`docs/dev-tools.md`); the runner's deploy
runs its typecheck and unit tests first and refuses a failing build.
Runner and app halves can land together; the protocol doc goes in the
same merge.

Whole suites run on this Mac (Christian, 2026-11-06): `./check.sh` from
the worktree's root. His `runner.json` names no check host, so it runs
here. Run it once, before the merge into `main`, not after every step.
While working, run single test files as AGENTS.md says.

## Left to the builder

- Names, file layout, and how the event recogniser hooks into the
  runner's event stream (keep the hook small).
- The exact GraphQL query and how many PRs go in one batch.
- Whether `checks.total` counts skipped checks (GitHub doesn't in its
  "x of y" line).
- Spacing, sizes and animation of the badge and cards, within the
  sidebar's and pane's existing metrics (`SidebarMetrics`, `PaneRow`,
  `TypeScale`).
