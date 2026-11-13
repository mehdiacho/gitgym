# GitGym handoff

Learn Git by building one small website with it. A browser terminal runs a simulated git. On screen: a live commit graph, the working/staging/commit boxes, a trail of commits (each message flies onto it when you commit), and a simulated GitHub with Pages that renders the site you built.

## State (2026-11-13)
- Engine (src/engine): init, status, add, commit, log, diff, show, branch, switch, checkout, merge (ff, 3-way, line-level diff3 conflicts), rebase, cherry-pick, revert, reset, restore, rm, tag, stash, plus remote, push (-u, --force, --tags, rejected non-fast-forward), fetch, pull (--rebase). .gitignore is honoured. Shell: ls, cat, touch, echo >/>>, rm, edit/code/nano (opens the editor), clear, help, && chains.
- Hidden setup commands (not in help): @teammate, @pages, @line, @resolve.
- 19 lessons + free play in src/lessons.ts, one continuous project. setupFor(i) replays every earlier lesson's prep + solution; "Next lesson" carries the learner's own repo forward with continueInto(), falling back to setupFor() if the prep can't apply. Repo + lesson start snapshot persist in localStorage (gitgym:repo:v2). npm test has a journey test that replays all lessons and checks every goal (17 tests pass).
- UI: Trail.tsx (commit trail, data-trail ids), GitHub.tsx (remote, branches, releases, Pages settings, sandboxed iframe preview of the latest deploy with style.css inlined). Commit flight and push packets are fixed overlays in App.tsx. Editor has keep mine/theirs/both for conflicts.
- Browser-checked with headless Chrome: Pages lesson end to end (enable Pages, commit flight, push, redeploy, next lesson carries the repo), no console errors, no horizontal scroll at 390px.

## Not done
- Deploy: npm run build:portfolio, then from a worktree of X:\Projects\portfolio off main: node scripts/add-project.mjs gitgym <dist> --repo mehdiacho/gitgym --build "npm run build:portfolio", PR, merge with Mehdi's OK.
- Later: GitHub Actions lessons (a workflow that deploys, one that builds a release), rebase that pauses on conflict.
