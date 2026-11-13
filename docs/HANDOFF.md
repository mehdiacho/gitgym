# GitGym handoff

Learn git by practising: browser terminal running a simulated git, live commit graph, working/staging/commit boxes animated as you type.

## State (2026-11-13)
- Engine in src/engine: init, status, add, commit (-a, --amend), log, diff, show, branch, switch, checkout, merge (ff, 3-way, conflicts, --abort), rebase (aborts on conflict), cherry-pick, revert, reset, restore, rm, tag, stash. Shell: ls, cat, touch, echo >/>>, rm, clear, help, && chains.
- 13 lessons + sandbox in src/lessons.ts; goals are sticky. npm test replays every lesson hint list and checks it solves the lesson (22 tests pass).
- UI verified in the browser: commit/branch/merge flow and the conflict lesson up to the merge state.

## Not done
- Private repo mehdiacho/gitgym not created yet (blocked on approval); nothing pushed.
- Deploy: npm run build:portfolio, then from a worktree of X:\Projects\portfolio off main: node scripts/add-project.mjs gitgym <dist> --repo mehdiacho/gitgym --build "npm run build:portfolio", PR, merge.
- Finish browser check of conflict resolve + commit, and the phone layout.
- Ideas: ghost merge-in-progress node, keep-ours/theirs buttons, rebase that pauses on conflict, fake remote for push/pull.
