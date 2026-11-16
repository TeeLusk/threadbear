# Add-ons in Tyler's copy

What this copy has that Mike's releases don't: things Tyler built, and
things brought in from other people's forks. Each line says where it lives,
so one can be taken out. A thread that brings in one of Mike's releases, or
adds or ports a feature, keeps this list up to date.

Last checked: 15 Nov 2026, after bringing in Mike's release 2026-11-16.

## Built by Tyler

| Add-on | What it does | Where |
| --- | --- | --- |
| Lend a Chrome tab with @ | Typing @ in the message box (or the new thread box) picks one of your open Chrome tabs, with favicons, for the thread to work in | runner, Swift app, GPUI app (7a73d3a7, 6d0bdbc2, cf9f0583, cc839729) |
| Annotated page into the message box | A page you mark up in Chrome lands in the thread's message box | Swift app, GPUI app (ec905fbc, fe834e99) |
| Top inbox thread on cmd+i | Jumps to the thread at the top of the inbox, with a hint by the inbox heading | Swift app, GPUI app (c2ffdb1a, d13eee32, 4c026dce, f1e55647) |
| Buttons on list panel rows | A patch's list panel rows can carry buttons that run actions | runner `panels.runItemAction`, both apps (015a6927, 19667c96, 6504d94b) |
| Claude in Chrome for threads | Claude sessions start with Claude in Chrome on | runner (56c5697e) |
| PlanetScale dashboard panel | A built-in panel for PlanetScale | runner (d6bb1919) |
| Patches see the thread's projects | Patch functions get the projects a thread is in | runner (36ff7d4d) |
| Staged app build hard to miss | Makes it obvious when a new app build is waiting | Swift app (e2de1ad7) |
| No local checks in auto-update | The runner's follow-main update skips running checks on this Mac | runner (8cf6ed00) |
| Cache pings as an experiment | Keeps waiting threads' prompt cache warm, off by default, only in the Mac's hours | experiment `cacheKeepAlive` (826a62b3) |
| GPUI ports of the add-ons below | Pull request badge and card, html panels, long thread card, green and yellow rows | GPUI app (ed92cbb4, 3f65a764, 498919f8, e6e72fc0) |

## Brought in from other forks

| Add-on | From | What it does | Where |
| --- | --- | --- | --- |
| Pull request status | chrisgoingturbo | A badge in the sidebar and a Pull requests card in Highlights, with checks and reviews, polled from GitHub with `gh` | runner PR tracker, `threads.prs`, apps (7e2c59b7 to 8bf5ecb4) |
| Long thread card | David Clark | Suggests compacting, or continuing in a new thread, once a thread gets long | runner long-threads, `threads.continueFresh` (17bfd321) |
| Keep the prompt cache warm | David Clark | Pings waiting Claude threads so their cache doesn't expire (now the `cacheKeepAlive` experiment) | runner (1953330e) |
| html panels | David Clark | A patch can write a page per thread and show it as a panel | runner patches (14d7ba50) |
| GitHub Actions runs in Highlights | Ville Lahdenvuo-Malta | Runs your pushes set off, following reruns too | experiment `ciRuns` (927bd160, 1c5e6045) |
| Green and yellow rows | Ville Lahdenvuo-Malta | List panel rows can show ready or blocked | runner, apps (e1ac83da) |
| Panel layouts per project | Ville Lahdenvuo-Malta | Where panels sit can differ per project | apps (a9d7d15b) |
| Queued jobs | Ville Lahdenvuo-Malta | A job waiting on a lock shows as Queued | runner (a7cc21fe) |
| Worktrees from origin, land as a PR | elie-h | Thread worktrees start from GitHub's main, and a patch can make `tb land` push and open a PR | runner `tb land`, worktrees (6f34d59e) |
| Runner on a Linux server | Josh Gantt | Ship the runner to a Linux box from the Mac, no checkout there | runner deploy (9e962aed) |
| Older git | sm-agx2 | Runner tests and following main work on git 2.34; a `tb land` fix | runner (14ba3858, ad0ab215) |

## Patches

| Patch | Where | Note |
| --- | --- | --- |
| cloudflare, dev, github, processes | `~/.threadbear/patches` | Tyler's own, for every folder |
| app-store, checks | `.threadbear/patches` | Mike's, part of the repo |

Commits are on main; `git log --no-merges <Mike's release>..main` lists
everything here that his release doesn't have.
