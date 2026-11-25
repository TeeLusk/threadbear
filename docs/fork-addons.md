# Add-ons in Tyler's copy

What this copy has that Mike's releases don't. Each line says where it
lives, so one can be taken out. A thread that brings in one of Mike's
releases, or adds or ports a feature, keeps this list up to date.

Keep it short: each add-on is a clash to settle on every release. On
20 Nov 2026 Tyler cut it down rather than carry both his and Mike's ways of
doing the same thing (see "Taken out" below). Before adding one, check
whether Mike's release already does it.

Last checked: Mike's release 2026-11-25.

## Kept

| Add-on | What it does | Where |
| --- | --- | --- |
| Lend a Chrome tab with @ | Typing @ in the message box (or the new thread box) picks one of your open Chrome tabs, with favicons, for the thread to work in, through BrowserBear | runner, GPUI app (7a73d3a7) |
| Top inbox thread on cmd+i | Jumps to the thread at the top of the inbox | GPUI app (c2ffdb1a's desktop part, 4c026dce, f1e55647, a97e1863) |
| Buttons on list panel rows | A patch's list panel rows can carry buttons that run commands; the processes patch's Stop uses it | runner `panels.runItemAction`, GPUI app (015a6927, 19667c96) |
| Patches see the thread's projects | Patch functions get the projects a thread is in, with their folders; the dev patch uses it | runner (36ff7d4d) |
| Build-only bring-ins | Landing one of Mike's releases only typechecks and builds, no tests | `check.sh --build`, on by itself for a "Bring in Mike's release" merge (e002e4de) |
| BrowserBear for web pages | Agents are told to use BrowserBear rather than other browser tools | runner (e4320257) |
| Composer spelling menu fix | Spelling menu items go to the box that opened them | GPUI app (0b1cd5eb) |
| GPUI installed-build fix | Lets the @ tab picker build without the automation feature (Mike's check.sh now checks the installed build itself) | GPUI app (11270d9c's app.rs line) |
| No runner tests on self-update | The runner's self-update always skips its tests, not only for commits a landing tested: bring-ins are build-only, so Mike's way would run the full runner tests after each one (hours here) | runner `update.ts`, "Fork patch (TeeLusk)" (settled in 796b5f29) |

## Taken out on 20 Nov 2026

Reverted on main, so `git revert <revert commit>` brings one back.

| Add-on | Why |
| --- | --- |
| Pull request status (chrisgoingturbo) | Mike's `inlinePrs` experiment shows PR state on links and opens PRs in the pane |
| Long thread card (David Clark) | Was off (`contextNudge: false`); Mike's compact-when-cold is standard |
| Cache pings (David Clark) | Was off; compact-when-cold covers cold threads |
| html panels (David Clark) | No patch used them |
| GitHub Actions runs, `ciRuns` (Ville) | The github patch already lists CI runs |
| Green and yellow row tones (Ville) | Mike's `warning` and `working` tones |
| Queued jobs (Ville) | Clashed with Mike's rewrite of `tb land`'s waiting |
| Worktrees from origin, land as a PR (elie-h) | No patch used `land: "pr"`; Mike has `pushAfterLanding` |
| Runner on a Linux server (Josh Gantt) | Not used |
| Older git (sm-agx2) | This Mac has git 2.54 |
| Claude in Chrome for threads | Agents use BrowserBear |
| Staged app build banner, and the Swift app halves of the kept add-ons | The Swift app is frozen; Tyler uses the GPUI app |
| PlanetScale panel | Now Tyler's own patch, `~/.threadbear/patches/planetscale.ts` |

## Taken out on 22 Nov 2026

| Add-on | Why |
| --- | --- |
| Annotated page into the message box (ec905fbc) | Tyler never got it working from the panel |
| Panel layouts per project (Ville, a9d7d15b) | Only in the frozen Swift app; the GPUI app never had it |
| tb land fix (sm-agx2, ad0ab215) | Mike's own version of it is already on main |

## Taken out with Mike’s 25 Nov release

| Add-on | Why |
| --- | --- |
| `#` thread picker | Mike's picker inserts a titled thread link as a chip. |
| CEF 156.0.31 update | Mike's runtime and Rust bindings match the fork's pins. |

## Patches

| Patch | Where | Note |
| --- | --- | --- |
| cloudflare, dev, github, planetscale, processes | `~/.threadbear/patches` | Tyler's own, for every folder |
| app-store, checks | `.threadbear/patches` | Mike's, part of the repo |

Commits are on main; `git log --no-merges <Mike's release>..main` lists
everything here that his release doesn't have.
