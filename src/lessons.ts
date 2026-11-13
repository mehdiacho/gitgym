// The journey. Every lesson continues the same project: a small personal
// website that grows from one file to a live GitHub Pages site.
//
// A lesson's starting repo is built by replaying, from an empty folder, every
// earlier lesson's `prep` and solution, then this lesson's own `prep`. So you
// can jump to any lesson and still find the project as it would be by then.
import { ancestors, headId, isAncestor, reachable, status, type Repo } from './engine/repo';
import { replay, run } from './engine/shell';

export interface Goal {
  label: string;
  check: (r: Repo, typed: string[]) => boolean;
}

export interface Lesson {
  id: string;
  chapter: string;
  title: string;
  /** Short paragraphs. `code` spans in backticks, **bold** in double stars. */
  intro: string[];
  /** Things that happen to the project before you start: files you wrote, a teammate's push. */
  prep: string[];
  goals: Goal[];
  /** Shown to the learner one at a time. A hint starting with @pages is a click in the GitHub panel. */
  hints: string[];
  /** The canonical solution when it differs from the hints (for example when a hint is meant to fail). */
  solve?: string[];
  /** Shown once all goals pass. Goals are sticky: once met they stay ticked. */
  outro: string;
}

const SITE = 'https://github.com/you/my-site.git';

const used = (typed: string[], re: RegExp) => typed.some((t) => re.test(t));
const onBranch = (r: Repo, name: string) => r.head.kind === 'branch' && r.head.name === name;
const on = (r: Repo, branch: string) => {
  const tip = r.branches[branch];
  return tip ? [...ancestors(r, tip)].map((id) => r.commits[id]) : [];
};
const mainHas = (r: Repo, re: RegExp) => on(r, 'main').some((c) => re.test(c.message));
const githubHas = (r: Repo, re: RegExp) => {
  const tip = r.remote?.branches.main;
  return !!tip && [...ancestors(r, tip)].some((id) => re.test(r.commits[id].message));
};
const changed = (r: Repo, id: string, path: string) => {
  const c = r.commits[id];
  const p = c.parents[0] ? r.commits[c.parents[0]].tree : {};
  return c.tree[path] !== p[path];
};
const clean = (r: Repo) => {
  const s = status(r);
  return !s.staged.length && !s.unstaged.length && !s.untracked.length && !s.conflicts.length;
};
const pushed = (r: Repo) => !!r.branches.main && r.remote?.branches.main === r.branches.main;

export const LESSONS: Lesson[] = [
  // ------------------------------------------------------------------ 1
  {
    id: 'first-commit',
    chapter: '1 · Start your site',
    title: 'Your first commit',
    intro: [
      'You are going to build a small website, and git will remember every step of it. This is one project for the whole course: what you do here is still there in the last lesson.',
      'There is already an `index.html` in the folder. Make the folder a repository, **stage** the file with `git add`, then **commit** it. Watch your message fly onto the trail on the right.',
    ],
    prep: ['echo "<h1>My site</h1>" > index.html'],
    goals: [
      { label: 'Turn this folder into a repository', check: (r) => r.initialized },
      { label: 'Stage `index.html`', check: (r) => 'index.html' in r.index },
      { label: 'Commit it with a message', check: (r) => !!headId(r) },
    ],
    hints: ['git init', 'git add index.html', 'git commit -m "Add home page"'],
    outro: 'That commit is the first stop on your trail. The `main` label points at it, and `HEAD` points at `main`: that is how git knows where you are.',
  },
  {
    id: 'staging',
    chapter: '1 · Start your site',
    title: 'One idea per commit',
    intro: [
      'You added a stylesheet and wrote a welcome line, and you jotted a private note in `notes.txt`.',
      'Good commits hold one idea each. Commit `style.css` **on its own**, then the change to `index.html`. Leave `notes.txt` out. `git status` tells you what is where.',
    ],
    prep: ['echo "body { font-family: sans-serif; }" > style.css', 'echo "<p>Welcome to my corner of the web.</p>" >> index.html', 'echo "todo: buy a domain" > notes.txt'],
    goals: [
      { label: 'Commit `style.css` without the `index.html` change', check: (r) => on(r, 'main').some((c) => changed(r, c.id, 'style.css') && !changed(r, c.id, 'index.html')) },
      { label: 'Then commit the welcome line', check: (r) => on(r, 'main').some((c) => /corner of the web/.test(c.tree['index.html'] ?? '')) },
      { label: 'Keep `notes.txt` out of every commit', check: (r) => on(r, 'main').length >= 3 && on(r, 'main').every((c) => !('notes.txt' in c.tree)) },
    ],
    hints: ['git status', 'git add style.css', 'git commit -m "Add stylesheet"', 'git commit -am "Add a welcome line"'],
    outro: '`git commit -a` stages every file git already tracks, which is why `notes.txt`, still untracked, stayed out.',
  },
  {
    id: 'gitignore',
    chapter: '1 · Start your site',
    title: 'Ignore what isn’t the site',
    intro: [
      '`notes.txt` will nag you in `git status` forever. A `.gitignore` file lists things git should pretend not to see.',
      'Create `.gitignore` containing `notes.txt` and commit it. Then `git status` should come back clean.',
    ],
    prep: [],
    goals: [
      { label: 'Create a `.gitignore` that names `notes.txt`', check: (r) => /notes\.txt/.test(r.work['.gitignore'] ?? '') },
      { label: 'Commit it', check: (r) => on(r, 'main').some((c) => /notes\.txt/.test(c.tree['.gitignore'] ?? '')) },
      { label: 'End with a clean status', check: (r) => clean(r) && 'notes.txt' in r.work },
    ],
    hints: ['echo "notes.txt" > .gitignore', 'git add .gitignore', 'git commit -m "Ignore my notes"', 'git status'],
    outro: 'The note is still in your folder, git just leaves it alone. Real projects ignore build output, secrets and editor files the same way.',
  },
  {
    id: 'history',
    chapter: '1 · Start your site',
    title: 'Follow the trail',
    intro: [
      'Every commit you made is on the trail. `git log --oneline` prints it, newest first. `git show <id>` opens one up. Click any stop on the trail or dot in the graph to do the same.',
      'You also just added a line to `index.html`. `git diff` shows exactly what changed since the last commit. Look, then commit it.',
    ],
    prep: ['echo "<p>I like trains.</p>" >> index.html'],
    goals: [
      { label: 'List the history with `git log`', check: (_r, t) => used(t, /^git log/) },
      { label: 'See your unstaged change with `git diff`', check: (_r, t) => used(t, /^git diff\s*$/) },
      { label: 'Commit the new line', check: (r) => on(r, 'main').some((c) => /trains/.test(c.tree['index.html'] ?? '')) },
    ],
    hints: ['git log --oneline', 'git diff', 'git commit -am "Say what I like"'],
    outro: 'Lines starting with `+` were added, `-` removed. `HEAD~1` means "one before HEAD": try `git show HEAD~1` any time.',
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'branches',
    chapter: '2 · Branches',
    title: 'Try an idea on a branch',
    intro: [
      'You want to try a dark theme without risking the site. A branch is a movable label on a commit: making one is instant.',
      'Create and switch to `dark-mode`, add a dark background to `style.css`, and commit it there. Watch which label moves.',
    ],
    prep: [],
    goals: [
      { label: 'Be on a branch called `dark-mode`', check: (r) => onBranch(r, 'dark-mode') },
      { label: 'Commit on it', check: (r) => !!r.branches['dark-mode'] && r.branches['dark-mode'] !== r.branches.main && !isAncestor(r, r.branches['dark-mode']!, r.branches.main!) },
    ],
    hints: ['git switch -c dark-mode', 'echo "body { background: #111; color: #eee; }" >> style.css', 'git commit -am "Try a dark theme"'],
    outro: 'Only `dark-mode` moved. `main` still points where it was, so the live version of your site is untouched.',
  },
  {
    id: 'fast-forward',
    chapter: '2 · Branches',
    title: 'Bring the idea home',
    intro: [
      'You like the dark theme. Go back to `main` and merge `dark-mode` into it.',
      'Since `main` has not moved since you branched, git can just slide `main` forward. That is a **fast-forward**: no new commit. Then delete the finished branch.',
    ],
    prep: [],
    goals: [
      { label: 'Switch back to `main`', check: (r) => onBranch(r, 'main') },
      { label: 'Merge `dark-mode` into it', check: (r) => mainHas(r, /dark theme/i) },
      { label: 'Delete the `dark-mode` branch', check: (r) => !('dark-mode' in r.branches) && mainHas(r, /dark theme/i) },
    ],
    hints: ['git switch main', 'git merge dark-mode', 'git branch -d dark-mode'],
    outro: 'Deleting a merged branch only removes the label. The commit lives on in `main`.',
  },
  {
    id: 'three-way',
    chapter: '2 · Branches',
    title: 'Two things at once',
    intro: [
      'Start an About page on a branch called `about`. Before you merge it, go back to `main` and add a footer there too.',
      'Now both lines of history have new work, so a fast-forward is impossible. `git merge about` makes a **merge commit** with two parents.',
    ],
    prep: [],
    goals: [
      { label: 'Commit `about.html` on a branch called `about`', check: (r) => on(r, 'about').some((c) => 'about.html' in c.tree) },
      { label: 'Commit a footer on `main`', check: (r) => on(r, 'main').some((c) => /footer/i.test(c.tree['index.html'] ?? '') && !('about.html' in c.tree)) },
      { label: 'Merge `about` into `main`', check: (r) => on(r, 'main').some((c) => c.parents.length > 1 && 'about.html' in c.tree) },
    ],
    hints: [
      'git switch -c about',
      'echo "<h1>About me</h1>" > about.html',
      'git add about.html',
      'git commit -m "Add about page"',
      'git switch main',
      'echo "<footer>Made with git</footer>" >> index.html',
      'git commit -am "Add footer"',
      'git merge about',
    ],
    outro: 'The merge commit joins the two lines. Git combined them by itself because they touched different files.',
  },
  {
    id: 'conflict',
    chapter: '2 · Branches',
    title: 'Settle a conflict',
    intro: [
      'Earlier you tried two titles: a friendlier one on branch `new-title`, and a shorter one straight on `main`. Both changed the same line.',
      'Merge `new-title`. Git cannot choose for you, so it marks the clash inside `index.html`. Open it (`edit index.html`, or click it), keep the title you want, delete the marker lines, then `git add` and `git commit`.',
    ],
    prep: [
      'git switch -c new-title',
      '@line index.html 1 "<h1>Hello, glad you are here</h1>"',
      'git commit -am "Friendlier title"',
      'git switch main',
      '@line index.html 1 "<h1>My little corner</h1>"',
      'git commit -am "Shorter title"',
    ],
    goals: [
      { label: 'Merge `new-title` and hit the conflict', check: (r, t) => !!r.merging || used(t, /^git merge new-title/) },
      {
        label: 'Fix `index.html` so no conflict markers are left, and `git add` it',
        check: (r, t) => used(t, /^git merge new-title/) && !r.merging?.conflicts.length && !/^(<<<<<<<|=======|>>>>>>>)/m.test(r.work['index.html'] ?? ''),
      },
      { label: 'Commit the merge', check: (r) => on(r, 'main').some((c) => c.parents.length > 1 && c.parents.includes(r.branches['new-title'] ?? '')) },
    ],
    hints: ['git merge new-title', 'edit index.html', 'git add index.html', 'git commit -m "Merge the friendlier title"'],
    solve: ['git merge new-title', '@resolve index.html theirs', 'git add index.html', 'git commit -m "Merge the friendlier title"'],
    outro: 'Conflicts look scary but are just git asking a question. Only the lines both sides changed were marked; the rest merged by itself.',
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'push',
    chapter: '3 · GitHub',
    title: 'Put it on GitHub',
    intro: [
      'So far everything lives in this folder. There is an empty repository waiting for you on GitHub at `you/my-site`.',
      'Tell git where it is with `git remote add origin <url>`, then upload `main` with `git push -u origin main`. The `-u` links your `main` to GitHub’s, so later you can just type `git push`.',
    ],
    prep: [],
    goals: [
      { label: 'Add a remote called `origin`', check: (r) => r.remote?.name === 'origin' },
      { label: 'Push `main` to GitHub', check: (r) => !!r.remote?.branches.main },
      { label: 'Link it with `-u` so `git push` knows where to go', check: (r) => r.upstream.main === 'main' },
    ],
    hints: [`git remote add origin ${SITE}`, 'git push -u origin main'],
    outro: 'See `origin/main` in the graph? That label is your memory of where GitHub’s `main` is. It moves when you push, fetch or pull.',
  },
  {
    id: 'pages',
    chapter: '3 · GitHub',
    title: 'Go live with GitHub Pages',
    intro: [
      'GitHub Pages turns a branch into a website. In the GitHub panel, open **Settings → Pages** and publish from `main`. Your site appears in the browser frame.',
      'Then make a change, commit, and `git push`. Every push to `main` redeploys the site.',
    ],
    prep: [],
    goals: [
      { label: 'Switch on Pages for `main`', check: (r) => r.remote?.pages?.branch === 'main' },
      { label: 'Commit a change and push it', check: (r) => (r.remote?.deploys.length ?? 0) >= 2 },
      { label: 'See the live site show your latest commit', check: (r) => !!r.remote && r.remote.deploys[r.remote.deploys.length - 1]?.id === r.branches.main },
    ],
    hints: ['@pages main', 'echo "<p>Now live on GitHub Pages!</p>" >> index.html', 'git commit -am "Announce the site"', 'git push'],
    outro: 'That is a real deploy flow: commit, push, live. Later you will automate the build step with a workflow.',
  },
  {
    id: 'pull',
    chapter: '3 · GitHub',
    title: 'A teammate pushed',
    intro: [
      'Your friend Sam has joined and pushed a contact link straight to GitHub. Your folder doesn’t know yet.',
      '`git fetch` downloads it and moves `origin/main`, without touching your work. `git status` then says you are behind. `git pull` brings it into your `main`.',
    ],
    prep: ['@teammate "Add a contact link" index.html "<a href=\'mailto:hi@example.com\'>Say hi</a>"'],
    goals: [
      { label: 'Fetch, and see `origin/main` move ahead', check: (r) => !!r.tracking['origin/main'] && r.tracking['origin/main'] === r.remote?.branches.main },
      { label: 'Bring Sam’s commit into your `main`', check: (r) => mainHas(r, /contact link/i) },
    ],
    hints: ['git fetch', 'git status', 'git pull'],
    outro: 'pull = fetch + merge. Fetching first lets you look before you change anything.',
  },
  {
    id: 'rejected',
    chapter: '3 · GitHub',
    title: 'Pull before you push',
    intro: [
      'You committed a new line while Sam pushed a style tweak. Try `git push`: GitHub refuses, because it has a commit you don’t.',
      'Pull to merge Sam’s work into yours, then push again. Never reach for `--force` on a shared branch.',
    ],
    prep: ['@teammate "Soften the footer" style.css "footer { opacity: .7; }"', 'echo "<p>Currently learning git.</p>" >> index.html', 'git commit -am "Say what I am learning"'],
    goals: [
      { label: 'Pull Sam’s change', check: (r) => mainHas(r, /soften the footer/i) },
      { label: 'Push, so GitHub has both commits', check: (r) => githubHas(r, /soften the footer/i) && githubHas(r, /learning/i) },
    ],
    hints: ['git push', 'git pull', 'git push'],
    solve: ['git pull', 'git push'],
    outro: 'Rejected pushes protect other people’s work. Pull, check the site still looks right, push.',
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'revert',
    chapter: '4 · Undo safely',
    title: 'Undo a pushed mistake',
    intro: [
      'Oops: you pushed a flashing sale banner to the live site. Since `main` is shared, don’t rewrite history.',
      '`git revert HEAD` adds a new commit that undoes the last one. Push it and the site is fixed.',
    ],
    prep: ['echo "<marquee>SALE SALE SALE</marquee>" >> index.html', 'git commit -am "Add a sale banner"', 'git push'],
    goals: [
      { label: 'Revert the banner commit', check: (r) => mainHas(r, /^Revert "Add a sale banner"/) && !/marquee/.test(r.work['index.html'] ?? '') },
      { label: 'Push the fix', check: (r) => githubHas(r, /^Revert "Add a sale banner"/) },
    ],
    hints: ['git revert HEAD', 'git push'],
    outro: 'Both commits stay on the trail: the mistake and its undo. Everyone else can pull that safely.',
  },
  {
    id: 'reset',
    chapter: '4 · Undo safely',
    title: 'Tidy commits before you push',
    intro: [
      'You made two scrappy "wip" commits while styling links. They are not pushed yet, so you may rewrite them.',
      '`git reset --soft HEAD~2` moves `main` back two commits but keeps the changes staged. Commit them again as one, then push.',
    ],
    prep: ['echo "a { color: hotpink; }" >> style.css', 'git commit -am "wip"', 'echo "a:hover { color: orange; }" >> style.css', 'git commit -am "wip again"'],
    goals: [
      { label: 'Undo the two wip commits, keeping the changes', check: (r) => !mainHas(r, /^wip/) && /hover/.test(r.index['style.css'] ?? '') },
      { label: 'Commit them as one', check: (r) => on(r, 'main').some((c) => changed(r, c.id, 'style.css') && /hover/.test(c.tree['style.css'] ?? '') && !/^wip/.test(c.message)) },
      { label: 'Push it', check: (r) => pushed(r) && !githubHas(r, /^wip/) && githubHas(r, /./) && /hover/.test(r.commits[r.remote!.branches.main].tree['style.css'] ?? '') },
    ],
    hints: ['git reset --soft HEAD~2', 'git status', 'git commit -m "Style the links"', 'git push'],
    outro: 'The old wip commits fade out in the graph: nothing points at them. Rewrite only what you haven’t pushed.',
  },
  {
    id: 'stash',
    chapter: '4 · Undo safely',
    title: 'Park half-done work',
    intro: [
      'You are halfway through a paragraph when Sam pushes bigger headings. `git pull` won’t run with uncommitted edits.',
      '`git stash` parks your edits on a shelf, `git pull` updates, and `git stash pop` puts your edits back on top.',
    ],
    prep: ['echo "<p>Draft: my favourite trains are</p>" >> index.html', '@teammate "Bigger headings" style.css "h1 { font-size: 3rem; }"'],
    goals: [
      { label: 'Stash your draft', check: (r, t) => r.stash.length > 0 || used(t, /^git stash(\s+(push|save).*)?$/) },
      { label: 'Pull Sam’s headings', check: (r) => mainHas(r, /bigger headings/i) },
      { label: 'Get your draft back', check: (r) => /Draft:/.test(r.work['index.html'] ?? '') && mainHas(r, /bigger headings/i) && !r.stash.length },
    ],
    hints: ['git stash', 'git pull', 'git stash pop'],
    outro: 'The draft is back as an uncommitted change, now on top of Sam’s work. Finish it whenever you like.',
  },
  {
    id: 'rebase',
    chapter: '4 · Undo safely',
    title: 'Rebase a branch',
    intro: [
      'First, commit your draft. Then: you started a blog on branch `blog` a while ago, and `main` has moved on since.',
      'From `blog`, `git rebase main` replays your blog commit on top of today’s `main`, giving a straight line. Then fast-forward `main` to it and push.',
    ],
    prep: [
      'git commit -am "Write about trains"',
      'git switch -c blog HEAD~3',
      'echo "<h1>Blog</h1>" > blog.html',
      'git add blog.html',
      'git commit -m "Start a blog"',
    ],
    goals: [
      { label: 'Rebase `blog` onto `main`', check: (r) => !!r.branches.blog && !!r.branches.main && isAncestor(r, r.branches.main!, r.branches.blog!) && on(r, 'blog').every((c) => c.parents.length < 2 || isAncestor(r, c.id, r.branches.main!)) },
      { label: 'Fast-forward `main` to include the blog', check: (r) => on(r, 'main').some((c) => 'blog.html' in c.tree) },
      { label: 'Push', check: (r) => pushed(r) && on(r, 'main').some((c) => 'blog.html' in c.tree) },
    ],
    hints: ['git rebase main', 'git switch main', 'git merge blog', 'git push'],
    outro: 'Rebasing gave the blog commit a new id and a new parent. The original fades out: it is no longer on any branch.',
  },
  {
    id: 'time-travel',
    chapter: '4 · Undo safely',
    title: 'Visit an old version',
    intro: [
      'Curious what the site looked like at the very start? `git checkout <id>` puts that snapshot in your folder.',
      'You’ll be in "detached HEAD": HEAD points at a commit, not a branch. Look around, then `git switch main` to come back.',
    ],
    prep: [],
    goals: [
      { label: 'Check out an older commit', check: (r, t) => r.head.kind === 'detached' || used(t, /^git (checkout|switch --detach) /) },
      { label: 'Come back to `main`', check: (r, t) => onBranch(r, 'main') && used(t, /^git (checkout|switch --detach) /) },
    ],
    hints: ['git log --oneline', 'git checkout HEAD~6', 'cat index.html', 'git switch main'],
    outro: 'Nothing is ever lost while a branch or tag reaches it. That is the trail doing its job.',
  },
  {
    id: 'release',
    chapter: '4 · Undo safely',
    title: 'Tag a release',
    intro: [
      'The site is in good shape. Mark this moment as version 1.0 with a tag: a label that never moves.',
      'Tags stay local until you push them. `git push origin v1.0` publishes it, and GitHub lists it under Releases.',
    ],
    prep: [],
    goals: [
      { label: 'Tag the current commit `v1.0`', check: (r) => !!r.tags['v1.0'] },
      { label: 'Push the tag to GitHub', check: (r) => !!r.remote?.tags['v1.0'] },
    ],
    hints: ['git tag v1.0', 'git push origin v1.0'],
    outro: 'Your first release. Next up in GitGym: workflows that build and release for you on every push.',
  },
  {
    id: 'sandbox',
    chapter: 'Free play',
    title: 'Keep building',
    intro: ['No goals: it is your site now. Branch, break things, merge, push, redeploy. Everything you know works here.'],
    prep: [],
    goals: [],
    hints: [],
    outro: '',
  },
];

/** The repo a lesson starts from if you jump straight to it. */
export function setupFor(index: number): Repo {
  const cmds: string[] = [];
  LESSONS.slice(0, index).forEach((l) => cmds.push(...l.prep, ...(l.solve ?? l.hints)));
  cmds.push(...LESSONS[index].prep);
  return replay(cmds.filter((c) => !/^(cat|git (log|status|diff|show))\b/.test(c) && c !== 'edit index.html'));
}

/** Run a lesson's prep on the learner's own repo. Returns null if it can't apply cleanly. */
export function continueInto(repo: Repo, lesson: Lesson): Repo | null {
  let r = repo;
  for (const cmd of lesson.prep) {
    const res = run(r, cmd);
    if (res.lines.some((l) => l.kind === 'err')) return null;
    r = res.repo;
  }
  return r;
}

export const orphanCount = (r: Repo) => Object.keys(r.commits).length - reachable(r).size;
