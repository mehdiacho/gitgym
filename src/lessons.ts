// The lesson ladder. Each lesson starts from a repo built by replaying `setup`
// commands, and is complete when every goal's check passes.
import { ancestors, headId, headTree, isAncestor, reachable, status, type Repo } from './engine/repo';

export interface Goal {
  label: string;
  check: (r: Repo, typed: string[]) => boolean;
}

export interface Lesson {
  id: string;
  chapter: string;
  title: string;
  /** Short paragraphs. `code` spans are written in backticks. */
  intro: string[];
  setup: string[];
  goals: Goal[];
  hints: string[];
  /** Shown once all goals pass. Goals are sticky: once met they stay ticked. */
  outro: string;
}

const commitsOn = (r: Repo, branch: string) => {
  const tip = r.branches[branch];
  return tip ? ancestors(r, tip).size : 0;
};
const used = (typed: string[], re: RegExp) => typed.some((t) => re.test(t));
const onBranch = (r: Repo, name: string) => r.head.kind === 'branch' && r.head.name === name;
const hasMerge = (r: Repo, branch: string) => {
  const tip = r.branches[branch];
  return !!tip && [...ancestors(r, tip)].some((id) => r.commits[id].parents.length > 1);
};
const orphans = (r: Repo) => Object.keys(r.commits).length - reachable(r).size;

export const LESSONS: Lesson[] = [
  {
    id: 'first-commit',
    chapter: 'Basics',
    title: 'Your first commit',
    intro: [
      'A git repository is a folder with a memory. Every commit is a snapshot of your files that you can return to.',
      'Saving a snapshot takes three moves: change a file, **stage** it with `git add`, then **commit** the staging area. Watch the three boxes below as you go.',
    ],
    setup: [],
    goals: [
      { label: 'Turn this folder into a repository', check: (r) => r.initialized },
      { label: 'Create a file (try `echo "hello" > notes.txt`)', check: (r) => Object.keys(r.work).length > 0 },
      { label: 'Stage it', check: (r) => Object.keys(r.index).length > 0 },
      { label: 'Commit it', check: (r) => !!headId(r) },
    ],
    hints: ['git init', 'echo "hello" > notes.txt', 'git add notes.txt', 'git commit -m "Add notes"'],
    outro: 'That dot in the graph is your commit. The `main` label points at it, and `HEAD` points at `main`: that is how git knows where you are.',
  },
  {
    id: 'staging',
    chapter: 'Basics',
    title: 'Staging is a choice',
    intro: [
      'You changed two files, but they are about different things. Good commits hold one idea each.',
      'Stage and commit **only** `recipe.txt`, then commit `shopping.txt` separately. `git status` tells you what is where.',
    ],
    setup: [
      'git init',
      'echo "Pancakes" > recipe.txt',
      'echo "eggs" > shopping.txt',
      'git add . && git commit -m "Start recipe and list"',
      'echo "Mix flour, eggs, milk" >> recipe.txt',
      'echo "milk" >> shopping.txt',
    ],
    goals: [
      {
        label: 'Make a commit that changes recipe.txt but not shopping.txt',
        check: (r) =>
          Object.values(r.commits).some((c) => {
            const p = c.parents[0] ? r.commits[c.parents[0]].tree : {};
            return c.tree['recipe.txt'] !== p['recipe.txt'] && c.tree['shopping.txt'] === p['shopping.txt'];
          }),
      },
      { label: 'Then commit shopping.txt on its own', check: (r) => commitsOn(r, 'main') >= 3 && status(r).unstaged.length === 0 },
      { label: 'Finish with a clean working tree', check: (r) => { const s = status(r); return !s.staged.length && !s.unstaged.length && !s.untracked.length; } },
    ],
    hints: ['git status', 'git add recipe.txt', 'git commit -m "Write the method"', 'git add shopping.txt && git commit -m "Need milk"'],
    outro: 'The staging area is a draft of your next commit. You decide what goes in.',
  },
  {
    id: 'history',
    chapter: 'Basics',
    title: 'Reading history',
    intro: [
      'This repo already has a few commits. `git log --oneline` lists them, newest first, with their short ids.',
      'Find out what the second commit changed with `git show <id>`, then see what you have changed since the last commit with `git diff`.',
    ],
    setup: [
      'git init',
      'echo "# Trip" > plan.md && git add . && git commit -m "Start trip plan"',
      'echo "Day 1: Gaborone" >> plan.md && git commit -am "Add day 1"',
      'echo "Day 2: Maun" >> plan.md && git commit -am "Add day 2"',
      'echo "Day 3: Okavango" >> plan.md',
    ],
    goals: [
      { label: 'List the history', check: (_r, t) => used(t, /^git log/) },
      { label: 'Look inside a commit with git show', check: (_r, t) => used(t, /^git show/) },
      { label: 'See your unstaged change with git diff', check: (_r, t) => used(t, /^git diff\s*$/) },
      { label: 'Commit day 3', check: (r) => commitsOn(r, 'main') >= 4 },
    ],
    hints: ['git log --oneline', 'git show HEAD~1', 'git diff', 'git commit -am "Add day 3"'],
    outro: '`HEAD~1` means "one commit before HEAD". You can name any commit by its id, a branch, or a path back from HEAD.',
  },
  {
    id: 'branches',
    chapter: 'Branching',
    title: 'Branches are just labels',
    intro: [
      'A branch is a movable label on a commit, nothing more. Making one is instant and free.',
      'Create a branch called `feature`, switch onto it, and make a commit there. Watch which label moves.',
    ],
    setup: ['git init', 'echo "v1" > app.txt && git add . && git commit -m "First version"', 'echo "fix" >> app.txt && git commit -am "Small fix"'],
    goals: [
      { label: 'Create a branch called feature', check: (r) => 'feature' in r.branches },
      { label: 'Switch to it (HEAD moves to feature)', check: (r) => onBranch(r, 'feature') },
      { label: 'Commit on feature: only feature moves forward', check: (r) => commitsOn(r, 'feature') > commitsOn(r, 'main') },
    ],
    hints: ['git branch feature', 'git switch feature', 'echo "new idea" >> app.txt', 'git commit -am "Try new idea"'],
    outro: '`main` stayed put while `feature` moved. `git switch -c name` creates and switches in one go.',
  },
  {
    id: 'fast-forward',
    chapter: 'Branching',
    title: 'Fast-forward merge',
    intro: [
      'You finished work on `feature`. Nothing happened on `main` meanwhile, so merging is easy: git just slides `main` forward.',
      'Switch to `main` and merge `feature` into it. Then delete the `feature` label.',
    ],
    setup: [
      'git init',
      'echo "home page" > site.txt && git add . && git commit -m "Home page"',
      'git switch -c feature',
      'echo "about page" >> site.txt && git commit -am "About page"',
      'echo "contact page" >> site.txt && git commit -am "Contact page"',
    ],
    goals: [
      { label: 'Be on main', check: (r) => onBranch(r, 'main') },
      { label: 'main includes the contact page', check: (r) => (r.branches.main ? r.commits[r.branches.main].tree['site.txt']?.includes('contact') : false) ?? false },
      { label: 'No merge commit was needed', check: (r) => !!r.branches.main && commitsOn(r, 'main') === 3 && !hasMerge(r, 'main') },
      { label: 'Delete the feature branch', check: (r) => !('feature' in r.branches) },
    ],
    hints: ['git switch main', 'git merge feature', 'git branch -d feature'],
    outro: 'Fast-forward: no new commit, just a label moving. Deleting a merged branch loses nothing.',
  },
  {
    id: 'three-way',
    chapter: 'Branching',
    title: 'When histories diverge',
    intro: [
      'This time both `main` and `feature` got new commits after they split. The graph shows a fork.',
      'Merge `feature` into `main`. Git will make a **merge commit** with two parents to join the lines.',
    ],
    setup: [
      'git init',
      'echo "# Readme" > README.md && git add . && git commit -m "Readme"',
      'git switch -c feature',
      'echo "login form" > login.txt && git add . && git commit -m "Add login form"',
      'git switch main',
      'echo "Install: npm i" >> README.md && git commit -am "Install notes"',
    ],
    goals: [
      { label: 'Be on main', check: (r) => onBranch(r, 'main') },
      { label: 'Merge feature into main with a merge commit', check: (r) => hasMerge(r, 'main') },
      { label: 'main has both login.txt and the install notes', check: (r) => !!r.branches.main && 'login.txt' in r.commits[r.branches.main].tree && r.commits[r.branches.main].tree['README.md']?.includes('Install') },
    ],
    hints: ['git merge feature', 'git log --oneline --all'],
    outro: 'The merge commit points back at both tips. Different files changed, so git combined them on its own.',
  },
  {
    id: 'conflict',
    chapter: 'Branching',
    title: 'Resolving a conflict',
    intro: [
      'Both branches changed the **same line** of `colors.txt`. Git cannot guess which you want, so it stops and asks.',
      'Merge `blue`, open `colors.txt` (click it in the Working folder box, or overwrite it with `echo`), keep the line you want, then `git add` and `git commit`.',
    ],
    setup: [
      'git init',
      'echo "theme: green" > colors.txt && git add . && git commit -m "Green theme"',
      'git switch -c blue',
      'echo "theme: blue" > colors.txt && git commit -am "Make it blue"',
      'git switch main',
      'echo "theme: red" > colors.txt && git commit -am "Make it red"',
    ],
    goals: [
      { label: 'Start the merge and hit the conflict', check: (r) => !!r.merging },
      { label: 'Remove the conflict markers from colors.txt', check: (r) => (r.work['colors.txt'] !== undefined && !/^(<<<<<<<|=======|>>>>>>>)/m.test(r.work['colors.txt'])) && (!!r.merging || hasMerge(r, 'main')) },
      { label: 'Finish the merge with a commit', check: (r) => hasMerge(r, 'main') && !r.merging },
    ],
    hints: ['git merge blue', 'cat colors.txt', 'echo "theme: purple" > colors.txt', 'git add colors.txt', 'git commit -m "Merge blue, settle on purple"'],
    outro: 'A conflict is just git asking a question. You answer by editing the file and committing. `git merge --abort` backs out if you change your mind.',
  },
  {
    id: 'detached',
    chapter: 'Moving around',
    title: 'Time travel (detached HEAD)',
    intro: [
      'You can check out any old commit to look around. HEAD then points at a commit instead of a branch: **detached HEAD**.',
      'Go back to the commit "Version 1", look at `poem.txt`, then return to `main`.',
    ],
    setup: [
      'git init',
      'echo "Roses are red" > poem.txt && git add . && git commit -m "Version 1"',
      'echo "Violets are blue" >> poem.txt && git commit -am "Version 2"',
      'echo "Git is neat" >> poem.txt && git commit -am "Version 3"',
    ],
    goals: [
      { label: 'Detach HEAD at "Version 1"', check: (r) => r.head.kind === 'detached' && r.commits[r.head.id].message === 'Version 1' },
      { label: 'Read poem.txt while you are there', check: (_r, t) => used(t, /^cat poem/) },
      { label: 'Come back to main', check: (r, t) => onBranch(r, 'main') && used(t, /(checkout|switch)/) },
    ],
    hints: ['git log --oneline', 'git checkout HEAD~2', 'cat poem.txt', 'git switch main'],
    outro: 'Nothing was lost: the newer commits were there all along, and `main` still pointed at them.',
  },
  {
    id: 'reset',
    chapter: 'Undoing',
    title: 'Undo with reset',
    intro: [
      'The last two commits on `main` were a mistake. `git reset` moves the branch label back.',
      'Use `git reset --hard HEAD~2`. The two commits fade in the graph: no branch reaches them any more. (`--soft` would keep the changes staged; plain `reset` keeps them in your files.)',
    ],
    setup: [
      'git init',
      'echo "good" > work.txt && git add . && git commit -m "Good work"',
      'echo "oops" >> work.txt && git commit -am "Oops"',
      'echo "worse" >> work.txt && git commit -am "Worse"',
    ],
    goals: [
      { label: 'Move main back to "Good work"', check: (r) => !!r.branches.main && r.commits[r.branches.main].message === 'Good work' },
      { label: 'work.txt no longer has the mistakes', check: (r) => r.work['work.txt'] === 'good\n' },
    ],
    hints: ['git log --oneline', 'git reset --hard HEAD~2', 'cat work.txt'],
    outro: 'reset rewrites where a branch points. Fine for local work, but never reset commits you already shared: use revert for those.',
  },
  {
    id: 'revert',
    chapter: 'Undoing',
    title: 'Safe undo with revert',
    intro: [
      'This history is shared with teammates, so rewriting it is off the table. `git revert` adds a **new** commit that undoes an old one.',
      'Revert the commit "Add bug".',
    ],
    setup: [
      'git init',
      'echo "feature A" > app.txt && git add . && git commit -m "Feature A"',
      'echo "bug" > bug.txt && git add . && git commit -m "Add bug"',
      'echo "feature B" >> app.txt && git commit -am "Feature B"',
    ],
    goals: [
      { label: 'Add a commit that undoes "Add bug"', check: (r) => !!r.branches.main && Object.values(r.commits).some((c) => c.message === 'Revert "Add bug"') && !('bug.txt' in headTree(r)) },
      { label: 'Keep all the old commits on main', check: (r) => commitsOn(r, 'main') >= 4 },
    ],
    hints: ['git log --oneline', 'git revert HEAD~1'],
    outro: 'History grew instead of shrinking, so nobody else is surprised.',
  },
  {
    id: 'rebase',
    chapter: 'Rewriting',
    title: 'Linear history with rebase',
    intro: [
      '`main` moved on while you worked on `feature`. Instead of a merge commit, `git rebase main` replays your commits on top of the new `main`.',
      'Rebase `feature` onto `main`. Watch the copies appear with new ids while the originals fade.',
    ],
    setup: [
      'git init',
      'echo "base" > base.txt && git add . && git commit -m "Base"',
      'git switch -c feature',
      'echo "f1" > f.txt && git add . && git commit -m "Feature part 1"',
      'echo "f2" >> f.txt && git commit -am "Feature part 2"',
      'git switch main',
      'echo "hotfix" > fix.txt && git add . && git commit -m "Hotfix"',
      'git switch feature',
    ],
    goals: [
      { label: 'feature now sits on top of main', check: (r) => !!r.branches.feature && !!r.branches.main && isAncestor(r, r.branches.main, r.branches.feature) && !hasMerge(r, 'feature') },
      { label: 'Fast-forward main to feature', check: (r) => !!r.branches.main && r.branches.main === r.branches.feature && !hasMerge(r, 'main') },
    ],
    hints: ['git rebase main', 'git switch main', 'git merge feature'],
    outro: 'One straight line, no merge commit. The old feature commits are orphans now: still there for a while, but unreachable.',
  },
  {
    id: 'cherry-pick',
    chapter: 'Rewriting',
    title: 'Cherry-pick one commit',
    intro: [
      'There is a useful fix buried on the `experiment` branch, next to work you do not want.',
      'On `main`, copy just the commit "Fix typo" with `git cherry-pick <id>`.',
    ],
    setup: [
      'git init',
      'echo "Helo world" > hello.txt && git add . && git commit -m "Hello"',
      'git switch -c experiment',
      'echo "wild idea" > wild.txt && git add . && git commit -m "Wild idea"',
      'echo "Hello world" > hello.txt && git commit -am "Fix typo"',
      'echo "wilder" >> wild.txt && git commit -am "Wilder idea"',
      'git switch main',
    ],
    goals: [
      { label: 'main has the typo fix', check: (r) => !!r.branches.main && r.commits[r.branches.main].tree['hello.txt'] === 'Hello world\n' },
      { label: '...and none of the wild ideas', check: (r) => !!r.branches.main && !('wild.txt' in r.commits[r.branches.main].tree) },
    ],
    hints: ['git log --oneline --all', 'git cherry-pick experiment~1'],
    outro: 'Cherry-pick copies a change, it does not move it. The original is still on experiment.',
  },
  {
    id: 'stash',
    chapter: 'Rewriting',
    title: 'Stash it for later',
    intro: [
      'You are halfway through an edit when an urgent fix comes in on `main`. Your changes are not ready to commit.',
      '`git stash` your work, switch to `main` and commit a fix to `urgent.txt`, then come back to `feature` and `git stash pop`.',
    ],
    setup: [
      'git init',
      'echo "v1" > app.txt && git add . && git commit -m "v1"',
      'git switch -c feature',
      'echo "half-done thing" >> app.txt',
    ],
    goals: [
      { label: 'Stash the half-done edit', check: (r) => r.stash.length > 0 },
      { label: 'Commit urgent.txt on main', check: (r) => !!r.branches.main && 'urgent.txt' in r.commits[r.branches.main].tree },
      { label: 'Back on feature with your edit restored', check: (r) => onBranch(r, 'feature') && (r.work['app.txt'] ?? '').includes('half-done') && r.stash.length === 0 },
    ],
    hints: ['git stash', 'git switch main', 'echo "patched" > urgent.txt && git add . && git commit -m "Urgent fix"', 'git switch feature', 'git stash pop'],
    outro: 'The stash is a shelf for unfinished work. It is easy to forget things there, so pop it soon.',
  },
  {
    id: 'sandbox',
    chapter: 'Free play',
    title: 'Sandbox',
    intro: ['No goals, no rules. An empty folder and every command GitGym knows. Try to break things.'],
    setup: [],
    goals: [],
    hints: ['help'],
    outro: '',
  },
];

export { orphans };
