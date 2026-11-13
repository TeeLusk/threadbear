---
id: ciRuns
name: GitHub Actions runs in Highlights
title: GitHub Actions runs in Highlights: the workflow runs a thread's pushes and `gh workflow run` set off, with their status and a link
added: 2026-11-12
on: false
reminder: a55bcdda
---

## What it does

When a thread pushes a commit to GitHub, starts a workflow with `gh workflow run`, or re-runs one with `gh run rerun`, its Highlights get a Runs section: each GitHub Actions run that set off, with its workflow, branch and commit, whether it's queued, running, passed or failed, and a link to the run on github.com. Threadbear asks the `gh` command you're logged into (`gh run list`, `gh run view`), never your token. It asks 5 seconds after the push, then every 15 seconds to 2 minutes, only while a run is queued or running, and stops once they've all finished, after 3 minutes with no runs, or after 2 hours. It never asks for an archived thread. Without `gh`, or logged out, the section stays empty.

## Lives in

`runner/src/ci-runs.ts`, `runner/src/runner/ci-runs.ts`; `dispatchOf`, `pushedRepo` and the commit's `repo` and `pushedAt` in `runner/src/highlights.ts`; the `ciRunsEvent` call in `emit` (`runner.ts`) and `kickCiRuns` in `highlights` (`runner/highlights.ts`); app `HighlightsView.swift` (the Runs section) and `runs` in `ThreadHighlights` (`Models.swift`)

## Taking it out

Self-contained: delete the two files and those calls; the app draws no Runs section without the field.
