// A small shell: file commands plus a simulated `git`. Every command returns a
// new Repo and some output lines; nothing is mutated in place.
import {
  addCommit,
  ancestors,
  cloneRepo,
  emptyRepo,
  headId,
  headLabel,
  headTree,
  isAncestor,
  isClean,
  mergeBase,
  mergeTrees,
  moveHead,
  status,
  treeOf,
  type Repo,
  type Tree,
} from './repo';

export type LineKind = 'cmd' | 'out' | 'err' | 'explain' | 'ok';
export interface Line {
  kind: LineKind;
  text: string;
}

/** What visibly changed, so the UI can pulse the right thing. */
export type GitEvent =
  | { type: 'commit'; id: string }
  | { type: 'stage'; paths: string[] }
  | { type: 'unstage'; paths: string[] }
  | { type: 'move-head' }
  | { type: 'branch'; name: string }
  | { type: 'merge'; id: string | null }
  | { type: 'files' };

export interface RunResult {
  repo: Repo;
  lines: Line[];
  events: GitEvent[];
}

class GitError extends Error {}
const fail = (msg: string): never => {
  throw new GitError(msg);
};

/** Split a command line into words, honouring single and double quotes. */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else if (ch === '>' ) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
      if (input[i + 1] === '>') {
        out.push('>>');
        i++;
      } else out.push('>');
    } else {
      cur += ch;
    }
  }
  if (quote) fail('unterminated quote');
  if (has || cur) out.push(cur);
  return out;
}

/** Split on && so learners can chain steps the way they would in a real shell. */
function splitChain(input: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '&' && input[i + 1] === '&') {
      parts.push(cur);
      cur = '';
      i++;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

interface Ctx {
  repo: Repo;
  lines: Line[];
  events: GitEvent[];
}
const out = (c: Ctx, text: string) => c.lines.push({ kind: 'out', text });
const explain = (c: Ctx, text: string) => c.lines.push({ kind: 'explain', text });

export function run(repo: Repo, input: string): RunResult {
  const ctx: Ctx = { repo: cloneRepo(repo), lines: [], events: [] };
  for (const part of splitChain(input)) {
    const before = ctx.repo;
    try {
      exec(ctx, tokenize(part));
    } catch (e) {
      if (e instanceof GitError) {
        ctx.repo = before;
        ctx.lines.push({ kind: 'err', text: e.message });
        break;
      }
      throw e;
    }
  }
  return ctx;
}

const SHELL_HELP = `Files:  ls · cat <file> · touch <file> · echo "text" > <file> · echo "more" >> <file> · rm <file> · clear
Git:    init · status · add · commit · log · diff · branch · switch · checkout · merge · rebase
        reset · restore · revert · cherry-pick · tag · stash · rm
Tip:    chain steps with && · press ↑ for history · Tab completes`;

function exec(c: Ctx, argv: string[]) {
  if (!argv.length) return;
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'help':
      return out(c, SHELL_HELP);
    case 'ls': {
      const files = Object.keys(c.repo.work).sort();
      return out(c, files.length ? files.join('  ') : '(empty folder)');
    }
    case 'cat': {
      if (!args.length) fail('cat: which file?');
      for (const f of args) {
        const v = c.repo.work[f];
        if (v === undefined) fail(`cat: ${f}: No such file`);
        out(c, v.replace(/\n$/, ''));
      }
      return;
    }
    case 'touch': {
      if (!args.length) fail('touch: which file?');
      for (const f of args) if (c.repo.work[f] === undefined) c.repo.work[f] = '';
      c.events.push({ type: 'files' });
      return;
    }
    case 'echo': {
      const op = args.findIndex((a) => a === '>' || a === '>>');
      const text = (op >= 0 ? args.slice(0, op) : args).join(' ');
      if (op < 0) return out(c, text);
      const file = args[op + 1];
      if (!file) fail('echo: missing file after ' + args[op]);
      checkName(file);
      c.repo.work[file] = (args[op] === '>>' ? (c.repo.work[file] ?? '') : '') + text + '\n';
      c.events.push({ type: 'files' });
      return;
    }
    case 'rm': {
      if (!args.length) fail('rm: which file?');
      for (const f of args.filter((a) => !a.startsWith('-'))) {
        if (c.repo.work[f] === undefined) fail(`rm: ${f}: No such file`);
        delete c.repo.work[f];
      }
      c.events.push({ type: 'files' });
      return;
    }
    case 'clear':
      c.lines.push({ kind: 'out', text: '\u001bclear' });
      return;
    case 'git':
      return git(c, args);
    default:
      if (cmd.startsWith('git') && cmd.length > 3) fail(`${cmd}: command not found. Did you mean "git ${cmd.slice(3)}"?`);
      fail(`${cmd}: command not found. Type "help" to see what works here.`);
  }
}

function checkName(f: string) {
  if (!/^[\w.\-/]+$/.test(f) || f.startsWith('/') || f.includes('..')) fail(`"${f}" isn't a file name GitGym accepts (letters, digits, . - _ /)`);
  if (f === '.git' || f.startsWith('.git/')) fail("That's git's own folder. Leave it to git.");
}

// ---------------------------------------------------------------- git

function needRepo(r: Repo) {
  if (!r.initialized) fail('fatal: not a git repository (run "git init" first)');
}

const short = (id: string) => id.slice(0, 7);

/** Resolve a revision like main, HEAD~2, a1b2c3d, v1.0, feature^ into a commit id. */
export function resolve(r: Repo, rev: string): string {
  const m = /^([^~^]+)((?:[~^]\d*)*)$/.exec(rev);
  if (!m) fail(`fatal: bad revision '${rev}'`);
  const [, base, suffix] = m!;
  let id: string | null = null;
  if (base === 'HEAD' || base === '@') id = headId(r);
  else if (base in r.branches) id = r.branches[base];
  else if (base in r.tags) id = r.tags[base];
  else if (/^[0-9a-f]{4,}$/.test(base)) {
    const hits = Object.keys(r.commits).filter((k) => k.startsWith(base));
    if (hits.length > 1) fail(`error: short id ${base} is ambiguous`);
    id = hits[0] ?? null;
  }
  if (!id) fail(`fatal: '${rev}' doesn't name a commit here`);
  const ops = suffix.match(/[~^]\d*/g) ?? [];
  for (const op of ops) {
    const n = op.length > 1 ? Number(op.slice(1)) : 1;
    if (op[0] === '~') {
      for (let i = 0; i < n; i++) {
        const p = r.commits[id!].parents[0];
        if (!p) fail(`fatal: '${rev}' goes back past the first commit`);
        id = p;
      }
    } else {
      const p = r.commits[id!].parents[n - 1];
      if (!p) fail(`fatal: '${rev}': that commit has no parent ${n}`);
      id = p;
    }
  }
  return id!;
}

function flags(args: string[]) {
  const set = new Set<string>();
  const rest: string[] = [];
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') {
      values.m = args[++i] ?? fail('error: -m needs a message, like: git commit -m "Add notes"');
    } else if (/^-[a-zA-Z]{2,}$/.test(a)) {
      // -am "msg" style
      for (const ch of a.slice(1)) {
        if (ch === 'm') values.m = args[++i] ?? fail('error: -m needs a message');
        else set.add('-' + ch);
      }
    } else if (a.startsWith('-')) set.add(a);
    else rest.push(a);
  }
  return { set, rest, values };
}

function git(c: Ctx, args: string[]) {
  const [sub, ...rest] = args;
  if (!sub) return out(c, 'usage: git <command>. Try "git init", "git status" or type "help".');
  if (sub !== 'init' && sub !== 'help' && sub !== '--version') needRepo(c.repo);
  switch (sub) {
    case '--version':
      return out(c, 'git version 2.47.0 (GitGym simulation)');
    case 'help':
      return out(c, SHELL_HELP);
    case 'init':
      return gInit(c);
    case 'status':
      return gStatus(c);
    case 'add':
      return gAdd(c, rest);
    case 'commit':
      return gCommit(c, rest);
    case 'log':
      return gLog(c, rest);
    case 'branch':
      return gBranch(c, rest);
    case 'switch':
      return gSwitch(c, rest);
    case 'checkout':
      return gCheckout(c, rest);
    case 'merge':
      return gMerge(c, rest);
    case 'rebase':
      return gRebase(c, rest);
    case 'reset':
      return gReset(c, rest);
    case 'restore':
      return gRestore(c, rest);
    case 'revert':
      return gRevert(c, rest);
    case 'cherry-pick':
      return gCherryPick(c, rest);
    case 'tag':
      return gTag(c, rest);
    case 'stash':
      return gStash(c, rest);
    case 'rm':
      return gRm(c, rest);
    case 'diff':
      return gDiff(c, rest);
    case 'show':
      return gShow(c, rest);
    default:
      fail(`git: '${sub}' isn't a git command GitGym knows yet. Type "help" for the list.`);
  }
}

function gInit(c: Ctx) {
  if (c.repo.initialized) return out(c, 'Reinitialized existing Git repository in /gitgym/.git/');
  c.repo.initialized = true;
  c.repo.branches = { main: null };
  c.repo.branchOrder = ['main'];
  c.repo.head = { kind: 'branch', name: 'main' };
  out(c, 'Initialized empty Git repository in /gitgym/.git/');
  explain(c, 'Git now tracks this folder. You are on branch main, which has no commits yet.');
  c.events.push({ type: 'move-head' });
}

function gStatus(c: Ctx) {
  const r = c.repo;
  const s = status(r);
  const lines: string[] = [];
  lines.push(r.head.kind === 'branch' ? `On branch ${r.head.name}` : `HEAD detached at ${short(r.head.id)}`);
  if (!headId(r)) lines.push('', 'No commits yet');
  if (r.merging) {
    lines.push(s.conflicts.length ? 'You have unmerged paths.' : 'All conflicts fixed but you are still merging.');
    lines.push(s.conflicts.length ? '  (fix conflicts and run "git commit")' : '  (use "git commit" to conclude merge)');
  }
  if (s.conflicts.length) {
    lines.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
    for (const p of s.conflicts) lines.push(`\tboth modified:   ${p}`);
  }
  if (s.staged.length) {
    lines.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
    for (const f of s.staged) lines.push(`\t${(f.change === 'new' ? 'new file' : f.change) + ':'}`.padEnd(14) + `   ${f.path}`);
  }
  if (s.unstaged.length) {
    lines.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to stage)');
    for (const f of s.unstaged) lines.push(`\t${f.change}:   ${f.path}`);
  }
  if (s.untracked.length) {
    lines.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
    for (const p of s.untracked) lines.push(`\t${p}`);
  }
  if (!s.staged.length && !s.unstaged.length && !s.untracked.length && !s.conflicts.length) {
    lines.push(headId(r) ? 'nothing to commit, working tree clean' : '', headId(r) ? '' : 'nothing to commit (create/copy files and use "git add" to track)');
  }
  out(c, lines.filter((l, i, a) => !(l === '' && (i === a.length - 1 || a[i - 1] === ''))).join('\n'));
}

function expandPaths(r: Repo, specs: string[], all: boolean): string[] {
  const pool = new Set([...Object.keys(r.work), ...Object.keys(r.index)]);
  if (all) return [...pool].sort();
  const outp = new Set<string>();
  for (const s of specs) {
    if (s === '.' || s === '*') pool.forEach((p) => outp.add(p));
    else if (s.endsWith('/')) [...pool].filter((p) => p.startsWith(s)).forEach((p) => outp.add(p));
    else if (s.includes('*')) {
      const re = new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const hits = [...pool].filter((p) => re.test(p));
      if (!hits.length) fail(`fatal: pathspec '${s}' did not match any files`);
      hits.forEach((p) => outp.add(p));
    } else if (pool.has(s)) outp.add(s);
    else if ([...pool].some((p) => p.startsWith(s + '/'))) [...pool].filter((p) => p.startsWith(s + '/')).forEach((p) => outp.add(p));
    else fail(`fatal: pathspec '${s}' did not match any files`);
  }
  return [...outp].sort();
}

function gAdd(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const all = set.has('-A') || set.has('--all');
  if (!rest.length && !all) fail('Nothing specified, nothing added.\nhint: try "git add <file>" or "git add ." for everything');
  const r = c.repo;
  const paths = expandPaths(r, rest, all);
  const changed: string[] = [];
  for (const p of paths) {
    const w = r.work[p];
    if (r.index[p] !== w) changed.push(p);
    if (w === undefined) delete r.index[p];
    else r.index[p] = w;
    if (r.merging?.conflicts.includes(p)) {
      if (w !== undefined && /^(<<<<<<<|=======|>>>>>>>)/m.test(w)) {
        c.lines.push({ kind: 'err', text: `warning: ${p} still has conflict markers (<<<<<<<). Staged anyway, but you probably want to edit it first.` });
      }
      r.merging.conflicts = r.merging.conflicts.filter((x) => x !== p);
      changed.includes(p) || changed.push(p);
    }
  }
  if (changed.length) {
    explain(c, `Staged ${listNames(changed)}. ${changed.length === 1 ? 'It' : 'They'} will go into the next commit, exactly as ${changed.length === 1 ? 'it is' : 'they are'} right now.`);
    c.events.push({ type: 'stage', paths: changed });
  } else explain(c, 'Nothing changed: those files were already staged as they are.');
  if (r.merging && !r.merging.conflicts.length && changed.length) explain(c, 'All conflicts resolved. Run git commit to finish the merge.');
}

const listNames = (ps: string[]) => (ps.length <= 3 ? ps.join(', ') : `${ps.slice(0, 2).join(', ')} and ${ps.length - 2} more`);

function gCommit(c: Ctx, args: string[]) {
  const { set, values } = flags(args);
  const r = c.repo;
  if (set.has('-a') || set.has('--all')) {
    for (const p of Object.keys({ ...r.index })) {
      if (r.work[p] === undefined) delete r.index[p];
      else r.index[p] = r.work[p];
    }
    if (r.merging) r.merging.conflicts = r.merging.conflicts.filter((p) => r.index[p] === undefined);
  }
  if (r.merging?.conflicts.length) {
    fail(`error: Committing is not possible because you have unmerged files.\nhint: fix ${listNames(r.merging.conflicts)}, then "git add" them`);
  }
  const amend = set.has('--amend');
  const parent = headId(r);
  if (amend && !parent) fail('fatal: there is no commit to amend yet');
  const base = amend ? treeOf(r, r.commits[parent!].parents[0] ?? null) : headTree(r);
  const same = JSON.stringify(sorted(r.index)) === JSON.stringify(sorted(amend ? treeOf(r, parent) : base));
  if (same && !r.merging && !amend && !set.has('--allow-empty')) {
    const s = status(r);
    fail(
      s.unstaged.length || s.untracked.length
        ? 'nothing added to commit, but there are changes in the working folder.\nhint: stage them first with "git add <file>"'
        : 'nothing to commit, working tree clean',
    );
  }
  let message = values.m ?? (r.merging ? r.merging.message : amend ? r.commits[parent!].message : undefined);
  if (!message) fail('error: GitGym has no text editor, so give the message inline: git commit -m "Describe the change"');
  message = message!;
  const parents = amend ? [...r.commits[parent!].parents] : parent ? [parent] : [];
  if (r.merging) parents.push(r.merging.theirs);
  const id = addCommit(r, parents, message, r.index);
  moveHead(r, id);
  const where = r.head.kind === 'branch' ? r.head.name : 'detached HEAD';
  out(c, `[${where}${parent ? '' : ' (root-commit)'} ${id}] ${message}`);
  if (r.merging) explain(c, `Merge commit ${id} has two parents: it joins the two lines of history.`);
  else if (amend) explain(c, `Replaced ${short(parent!)} with a new commit ${id}. The old one is no longer on any branch (faded in the graph).`);
  else
    explain(
      c,
      `Saved a snapshot of the staging area as commit ${id}${r.head.kind === 'branch' ? `, and moved ${r.head.name} forward to it` : ''}.${r.head.kind === 'detached' ? ' You are detached, so no branch points here: make one with "git switch -c <name>" to keep it.' : ''}`,
    );
  r.merging = null;
  c.events.push({ type: 'commit', id });
}

const sorted = (t: Tree) => Object.fromEntries(Object.entries(t).sort(([a], [b]) => a.localeCompare(b)));

function gLog(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  const starts = set.has('--all') ? [...Object.values(r.branches), headId(r)].filter(Boolean) as string[] : [rest[0] ? resolve(r, rest[0]) : headId(r)].filter(Boolean) as string[];
  if (!starts.length) fail(`fatal: your current branch '${headLabel(r)}' does not have any commits yet`);
  const seen = new Set<string>();
  for (const s of starts) ancestors(r, s).forEach((x) => seen.add(x));
  const list = [...seen].map((id) => r.commits[id]).sort((a, b) => b.seq - a.seq);
  const lines: string[] = [];
  for (const cm of list) {
    const decor = decorations(r, cm.id);
    if (set.has('--oneline')) lines.push(`${cm.id}${decor ? ` (${decor})` : ''} ${cm.message}`);
    else {
      lines.push(`commit ${cm.id}${decor ? ` (${decor})` : ''}`);
      if (cm.parents.length > 1) lines.push(`Merge: ${cm.parents.map(short).join(' ')}`);
      lines.push('', `    ${cm.message}`, '');
    }
  }
  out(c, lines.join('\n').trimEnd());
}

function decorations(r: Repo, id: string): string {
  const d: string[] = [];
  if (r.head.kind === 'detached' && r.head.id === id) d.push('HEAD');
  for (const b of r.branchOrder) {
    if (r.branches[b] !== id) continue;
    d.push(r.head.kind === 'branch' && r.head.name === b ? `HEAD -> ${b}` : b);
  }
  for (const [t, tid] of Object.entries(r.tags)) if (tid === id) d.push(`tag: ${t}`);
  return d.join(', ');
}

function validBranchName(name: string) {
  if (!/^[A-Za-z0-9][\w.\-/]*$/.test(name) || name.endsWith('/') || name.includes('..') || name === 'HEAD')
    fail(`fatal: '${name}' is not a valid branch name`);
}

function createBranch(c: Ctx, name: string, at: string | null) {
  const r = c.repo;
  validBranchName(name);
  if (name in r.branches) fail(`fatal: a branch named '${name}' already exists`);
  if (!at) fail(`fatal: not a valid object name: '${headLabel(r)}'.\nhint: make a first commit before creating branches`);
  r.branches[name] = at;
  r.branchOrder.push(name);
  c.events.push({ type: 'branch', name });
}

function gBranch(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (set.has('-d') || set.has('-D') || set.has('--delete')) {
    if (!rest.length) fail('fatal: branch name required');
    for (const name of rest) {
      if (!(name in r.branches)) fail(`error: branch '${name}' not found`);
      if (r.head.kind === 'branch' && r.head.name === name) fail(`error: cannot delete branch '${name}' while you are on it. Switch away first.`);
      const tip = r.branches[name];
      const here = headId(r);
      if (!set.has('-D') && tip && (!here || !isAncestor(r, tip, here)))
        fail(`error: the branch '${name}' is not fully merged.\nhint: its commits would be lost. Use "git branch -D ${name}" if you're sure.`);
      delete r.branches[name];
      r.branchOrder = r.branchOrder.filter((b) => b !== name);
      out(c, `Deleted branch ${name} (was ${tip ? short(tip) : 'unborn'}).`);
      explain(c, 'Only the label is gone. Commits that no other branch reaches fade out in the graph.');
    }
    c.events.push({ type: 'move-head' });
    return;
  }
  if (set.has('-m') || set.has('-M')) {
    // handled by flags as message; unsupported here
  }
  if (!rest.length) {
    const lines = r.branchOrder.map((b) => `${r.head.kind === 'branch' && r.head.name === b ? '* ' : '  '}${b}`);
    if (r.head.kind === 'detached') lines.unshift(`* (HEAD detached at ${short(r.head.id)})`);
    return out(c, lines.join('\n') || '(no branches yet)');
  }
  const [name, start] = rest;
  createBranch(c, name, start ? resolve(r, start) : headId(r));
  explain(c, `Made a new label "${name}" pointing at ${short(r.branches[name]!)}. You are still on ${headLabel(r)}: use "git switch ${name}" to move onto it.`);
}

/** Move HEAD to a commit, carrying uncommitted changes across when they don't collide. */
function moveTo(c: Ctx, target: string, head: Repo['head']) {
  const r = c.repo;
  if (r.merging) fail('error: you are in the middle of a merge. Finish it with git commit, or run git merge --abort.');
  const from = headTree(r);
  const to = treeOf(r, target);
  const paths = new Set([...Object.keys(from), ...Object.keys(to), ...Object.keys(r.index), ...Object.keys(r.work)]);
  const blocked: string[] = [];
  const nextIndex: Tree = { ...to };
  const nextWork: Tree = { ...to };
  for (const p of paths) {
    const localIdx = r.index[p] !== from[p];
    const localWork = r.work[p] !== from[p];
    const differs = from[p] !== to[p];
    if ((localIdx || localWork) && differs) {
      // untracked file that matches target is fine
      if (r.work[p] === to[p] && r.index[p] === undefined && from[p] === undefined) continue;
      blocked.push(p);
      continue;
    }
    if (localIdx) {
      if (r.index[p] === undefined) delete nextIndex[p];
      else nextIndex[p] = r.index[p];
    }
    if (localWork) {
      if (r.work[p] === undefined) delete nextWork[p];
      else nextWork[p] = r.work[p];
    }
  }
  if (blocked.length)
    fail(
      `error: Your local changes to ${listNames(blocked)} would be overwritten.\nhint: commit them, or "git stash" them, before you switch.`,
    );
  r.index = nextIndex;
  r.work = nextWork;
  r.head = head;
  c.events.push({ type: 'move-head' });
}

function gSwitch(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (set.has('-c') || set.has('-C') || set.has('--create')) {
    const [name, start] = rest;
    if (!name) fail('fatal: missing branch name, like: git switch -c feature');
    const at = start ? resolve(r, start) : headId(r);
    if (!at) {
      // Unborn: just rename where HEAD will go.
      validBranchName(name);
      r.branches[name] = null;
      r.branchOrder.push(name);
      r.head = { kind: 'branch', name };
      out(c, `Switched to a new branch '${name}'`);
      return;
    }
    createBranch(c, name, at);
    moveTo(c, at, { kind: 'branch', name });
    out(c, `Switched to a new branch '${name}'`);
    explain(c, `Created ${name} at ${short(at)} and moved HEAD onto it. New commits will now move ${name}.`);
    return;
  }
  if (set.has('--detach') || set.has('-d')) {
    const id = resolve(r, rest[0] ?? 'HEAD');
    moveTo(c, id, { kind: 'detached', id });
    out(c, `HEAD is now at ${short(id)} ${r.commits[id].message}`);
    explain(c, 'HEAD now points straight at a commit, not at a branch ("detached").');
    return;
  }
  const name = rest[0];
  if (!name) fail('fatal: missing branch name, like: git switch main');
  if (name === '-') fail('GitGym does not track "previous branch" yet; name it instead.');
  if (!(name in r.branches)) {
    if (/^[0-9a-f]{4,}$/.test(name) || /[~^]/.test(name) || name in r.tags)
      fail(`fatal: a branch is expected, got '${name}'.\nhint: to look at a commit, use "git switch --detach ${name}" or "git checkout ${name}"`);
    fail(`fatal: invalid reference: ${name}\nhint: create it with "git switch -c ${name}"`);
  }
  switchBranch(c, name);
}

function switchBranch(c: Ctx, name: string) {
  const r = c.repo;
  if (r.head.kind === 'branch' && r.head.name === name) return out(c, `Already on '${name}'`);
  const tip = r.branches[name];
  if (!tip) {
    r.head = { kind: 'branch', name };
    return out(c, `Switched to branch '${name}'`);
  }
  moveTo(c, tip, { kind: 'branch', name });
  out(c, `Switched to branch '${name}'`);
  explain(c, `HEAD now points at ${name}. Your folder shows the files as of ${short(tip)}.`);
}

function gCheckout(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (set.has('-b') || set.has('-B')) return gSwitch(c, ['-c', ...rest]);
  const dash = args.indexOf('--');
  if (dash >= 0 || (rest.length && rest.every((p) => p in r.work || p in r.index) && !(rest[0] in r.branches))) {
    const files = dash >= 0 ? args.slice(dash + 1) : rest;
    return gRestore(c, files);
  }
  const target = rest[0];
  if (!target) fail('usage: git checkout <branch> | git checkout -b <new-branch> | git checkout -- <file>');
  if (target in r.branches) return switchBranch(c, target);
  const id = resolve(r, target);
  moveTo(c, id, { kind: 'detached', id });
  out(c, `Note: switching to '${target}'.\n\nYou are in 'detached HEAD' state. You can look around and make experimental\ncommits; to keep them, create a branch with: git switch -c <new-branch>\n\nHEAD is now at ${short(id)} ${r.commits[id].message}`);
  explain(c, `HEAD points straight at commit ${short(id)} now, not at a branch. Your folder shows that moment in history.`);
}

function gMerge(c: Ctx, args: string[]) {
  const { set, rest, values } = flags(args);
  const r = c.repo;
  if (set.has('--abort')) {
    if (!r.merging) fail('fatal: there is no merge to abort');
    r.merging = null;
    r.index = { ...headTree(r) };
    r.work = { ...headTree(r) };
    out(c, 'Merge aborted.');
    explain(c, 'Back to exactly how things were before the merge.');
    c.events.push({ type: 'files' });
    return;
  }
  if (r.merging) fail('error: you are already merging. Resolve the conflicts and commit, or run git merge --abort.');
  const name = rest[0];
  if (!name) fail('fatal: merge which branch? like: git merge feature');
  const theirs = resolve(r, name);
  const ours = headId(r);
  if (!ours) fail('fatal: make a first commit before merging');
  if (!isClean(r)) fail('error: you have uncommitted changes. Commit or stash them before merging.');
  if (isAncestor(r, theirs, ours!)) return out(c, 'Already up to date.');
  if (isAncestor(r, ours!, theirs) && !set.has('--no-ff')) {
    moveHead(r, theirs);
    r.index = { ...treeOf(r, theirs) };
    r.work = { ...treeOf(r, theirs) };
    out(c, `Updating ${short(ours!)}..${short(theirs)}\nFast-forward`);
    explain(
      c,
      `${headLabel(r)} had no commits of its own since ${name} branched off, so git just slid the ${headLabel(r)} label forward to ${short(theirs)}. No merge commit needed.`,
    );
    c.events.push({ type: 'merge', id: null });
    return;
  }
  const base = mergeBase(r, ours!, theirs);
  const res = mergeTrees(treeOf(r, base), treeOf(r, ours!), treeOf(r, theirs), 'HEAD', name);
  const message = values.m ?? `Merge branch '${name}'${r.head.kind === 'branch' && r.head.name !== 'main' ? ` into ${r.head.name}` : ''}`;
  r.index = { ...res.tree };
  r.work = { ...res.tree };
  if (res.conflicts.length) {
    r.merging = { theirs, message, conflicts: res.conflicts };
    for (const p of res.conflicts) out(c, `CONFLICT (content): Merge conflict in ${p}`);
    out(c, 'Automatic merge failed; fix conflicts and then commit the result.');
    explain(
      c,
      `Both sides changed ${listNames(res.conflicts)} since ${base ? short(base) : 'the start'}. Open the file, keep what you want, delete the <<<<<<< ======= >>>>>>> lines, then git add and git commit.`,
    );
    c.events.push({ type: 'files' });
    return;
  }
  const id = addCommit(r, [ours!, theirs], message, res.tree);
  moveHead(r, id);
  out(c, `Merge made by the 'ort' strategy.`);
  explain(c, `Both branches had new work, so git combined them in a merge commit ${id} with two parents.`);
  c.events.push({ type: 'merge', id }, { type: 'commit', id });
}

/** Re-apply the change a commit made onto `onto`. Returns the new tree or the conflicting paths. */
function applyCommit(r: Repo, commit: string, onto: string | null) {
  const c = r.commits[commit];
  const parent = c.parents[0] ?? null;
  return mergeTrees(treeOf(r, parent), treeOf(r, onto), c.tree, 'HEAD', short(commit));
}

function gRebase(c: Ctx, args: string[]) {
  const { rest } = flags(args);
  const r = c.repo;
  if (r.head.kind !== 'branch') fail('error: GitGym only rebases a branch. Switch to one first.');
  const branch = (r.head as { name: string }).name;
  const upstream = rest[0];
  if (!upstream) fail('fatal: rebase onto what? like: git rebase main');
  const onto = resolve(r, upstream);
  const ours = headId(r);
  if (!ours) fail('fatal: nothing to rebase yet');
  if (!isClean(r)) fail('error: cannot rebase: you have uncommitted changes. Commit or stash them first.');
  if (isAncestor(r, onto, ours!)) return out(c, `Current branch ${branch} is up to date.`);
  if (isAncestor(r, ours!, onto)) {
    moveHead(r, onto);
    r.index = { ...treeOf(r, onto) };
    r.work = { ...treeOf(r, onto) };
    out(c, `Successfully rebased and updated refs/heads/${branch}.`);
    explain(c, `${branch} had nothing of its own, so it simply moved up to ${upstream}.`);
    c.events.push({ type: 'move-head' });
    return;
  }
  const mine = ancestors(r, ours!);
  const theirs = ancestors(r, onto);
  const todo = [...mine].filter((id) => !theirs.has(id)).map((id) => r.commits[id]).filter((cm) => cm.parents.length < 2).sort((a, b) => a.seq - b.seq);
  let cur = onto;
  const made: string[] = [];
  for (const cm of todo) {
    const res = applyCommit(r, cm.id, cur);
    if (res.conflicts.length)
      fail(
        `CONFLICT while replaying ${cm.id} "${cm.message}" in ${listNames(res.conflicts)}.\nGitGym can't pause a rebase mid-way yet, so it was cancelled and nothing changed.\nhint: try "git merge ${upstream}" for this one.`,
      );
    cur = addCommit(r, [cur], cm.message, res.tree);
    made.push(cur);
  }
  moveHead(r, cur);
  r.index = { ...treeOf(r, cur) };
  r.work = { ...treeOf(r, cur) };
  out(c, `Successfully rebased and updated refs/heads/${branch}.`);
  explain(
    c,
    `Replayed ${todo.length} commit${todo.length === 1 ? '' : 's'} on top of ${upstream}. They got new ids (${made.join(', ')}); the originals fade out because nothing points at them now.`,
  );
  c.events.push({ type: 'commit', id: cur });
}

function gCherryPick(c: Ctx, args: string[]) {
  const { rest } = flags(args);
  const r = c.repo;
  if (!rest.length) fail('fatal: cherry-pick which commit?');
  if (!isClean(r)) fail('error: commit or stash your changes before cherry-picking.');
  for (const rev of rest) {
    const id = resolve(r, rev);
    if (r.commits[id].parents.length > 1) fail(`error: ${short(id)} is a merge commit; GitGym can't cherry-pick those.`);
    const res = applyCommit(r, id, headId(r));
    if (res.conflicts.length) fail(`error: could not apply ${short(id)}: conflict in ${listNames(res.conflicts)}. Nothing was changed.`);
    const nid = addCommit(r, headId(r) ? [headId(r)!] : [], r.commits[id].message, res.tree);
    moveHead(r, nid);
    r.index = { ...res.tree };
    r.work = { ...res.tree };
    out(c, `[${headLabel(r)} ${nid}] ${r.commits[id].message}`);
    explain(c, `Copied the change from ${short(id)} onto ${headLabel(r)} as a new commit ${nid}. Same change, new id.`);
    c.events.push({ type: 'commit', id: nid });
  }
}

function gRevert(c: Ctx, args: string[]) {
  const { rest } = flags(args);
  const r = c.repo;
  if (!rest.length) fail('fatal: revert which commit? like: git revert HEAD');
  if (!isClean(r)) fail('error: commit or stash your changes before reverting.');
  const id = resolve(r, rest[0]);
  const cm = r.commits[id];
  if (cm.parents.length > 1) fail('error: reverting merge commits needs -m, which GitGym does not support yet.');
  const res = mergeTrees(cm.tree, headTree(r), treeOf(r, cm.parents[0] ?? null), 'HEAD', `parent of ${short(id)}`);
  if (res.conflicts.length) fail(`error: could not revert ${short(id)}: later commits changed the same lines in ${listNames(res.conflicts)}.`);
  const nid = addCommit(r, [headId(r)!], `Revert "${cm.message}"`, res.tree);
  moveHead(r, nid);
  r.index = { ...res.tree };
  r.work = { ...res.tree };
  out(c, `[${headLabel(r)} ${nid}] Revert "${cm.message}"`);
  explain(c, `Added a new commit that undoes ${short(id)}. History is untouched, which is why revert is safe on shared branches.`);
  c.events.push({ type: 'commit', id: nid });
}

function gReset(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  const mode = set.has('--hard') ? 'hard' : set.has('--soft') ? 'soft' : 'mixed';
  // `git reset <file>` / `git reset HEAD <file>`: unstage
  const fileArgs = rest.filter((a) => a in r.index || a in r.work || a in headTree(r));
  const looksLikeFiles = fileArgs.length && fileArgs.length === rest.filter((a) => a !== 'HEAD').length && !rest.some((a) => a !== 'HEAD' && !fileArgs.includes(a));
  if (looksLikeFiles && mode === 'mixed') return gRestore(c, ['--staged', ...fileArgs]);
  const target = resolve(r, rest[0] ?? 'HEAD');
  const before = headId(r);
  const untracked = Object.fromEntries(status(r).untracked.map((p) => [p, r.work[p]]));
  moveHead(r, target);
  if (mode !== 'soft') r.index = { ...treeOf(r, target) };
  if (mode === 'hard') {
    // untracked files survive a hard reset
    r.work = { ...untracked, ...treeOf(r, target) };
  }
  r.merging = null;
  const label = headLabel(r);
  if (mode === 'hard') out(c, `HEAD is now at ${short(target)} ${r.commits[target].message}`);
  else if (status(r).unstaged.length) out(c, 'Unstaged changes after reset:\n' + status(r).unstaged.map((u) => `M\t${u.path}`).join('\n'));
  const moved = before !== target;
  explain(
    c,
    (moved ? `Moved ${label} from ${before ? short(before) : '-'} to ${short(target)}. ` : '') +
      (mode === 'soft'
        ? 'Staging area and files are untouched: the undone changes are staged, ready to re-commit.'
        : mode === 'mixed'
          ? 'Staging area now matches that commit; your files still have the changes (unstaged).'
          : 'Staging area AND your files now match that commit. Uncommitted work is gone.') +
      (moved && before && !reachableAfter(r, before) ? ' Commits left behind fade in the graph: no branch reaches them now.' : ''),
  );
  c.events.push({ type: 'move-head' });
}

function reachableAfter(r: Repo, id: string) {
  return [...Object.values(r.branches), ...Object.values(r.tags), headId(r)].some((t) => t && isAncestor(r, id, t));
}

function gRestore(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (!rest.length) fail('fatal: restore which file? like: git restore notes.txt');
  const staged = set.has('--staged') || set.has('-S');
  const head = headTree(r);
  const paths = expandPaths(r, rest.filter((p) => p !== 'HEAD'), false);
  for (const p of paths) {
    if (staged) {
      if (head[p] === undefined) delete r.index[p];
      else r.index[p] = head[p];
    } else {
      if (r.index[p] === undefined) fail(`error: pathspec '${p}' is not tracked, so there's no saved version to restore`);
      r.work[p] = r.index[p];
    }
  }
  if (staged) {
    explain(c, `Unstaged ${listNames(paths)}. The changes are still in your files, just not lined up for the next commit.`);
    c.events.push({ type: 'unstage', paths });
  } else {
    explain(c, `Threw away the unstaged edits to ${listNames(paths)}: ${paths.length === 1 ? 'it' : 'they'} now match the staging area.`);
    c.events.push({ type: 'files' });
  }
}

function gRm(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (!rest.length) fail('usage: git rm <file>');
  for (const p of rest) {
    if (r.index[p] === undefined) fail(`fatal: pathspec '${p}' did not match any tracked files`);
    delete r.index[p];
    if (!set.has('--cached')) delete r.work[p];
    out(c, `rm '${p}'`);
  }
  explain(c, set.has('--cached') ? 'Stopped tracking it, but kept the file in your folder.' : 'Deleted the file and staged the deletion.');
  c.events.push({ type: 'stage', paths: rest });
}

function gTag(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  if (set.has('-d')) {
    for (const t of rest) {
      if (!(t in r.tags)) fail(`error: tag '${t}' not found.`);
      delete r.tags[t];
      out(c, `Deleted tag '${t}'`);
    }
    return;
  }
  if (!rest.length) return out(c, Object.keys(r.tags).sort().join('\n'));
  const [name, rev] = rest;
  if (name in r.tags) fail(`fatal: tag '${name}' already exists`);
  validBranchName(name);
  r.tags[name] = resolve(r, rev ?? 'HEAD');
  explain(c, `Tagged ${short(r.tags[name])} as ${name}. Unlike a branch, a tag never moves.`);
  c.events.push({ type: 'branch', name });
}

function gStash(c: Ctx, args: string[]) {
  const [sub = 'push', ...rest] = args;
  const r = c.repo;
  const head = headTree(r);
  if (sub === 'list') return out(c, r.stash.map((s, i) => `stash@{${i}}: ${s.message}`).join('\n'));
  if (sub === 'drop') {
    if (!r.stash.length) fail('No stash entries found.');
    r.stash.shift();
    return out(c, 'Dropped stash@{0}');
  }
  if (sub === 'pop' || sub === 'apply') {
    const s = r.stash[0];
    if (!s) fail('No stash entries found.');
    const base = treeOf(r, s.base);
    const blocked: string[] = [];
    for (const p of new Set([...Object.keys(s.work), ...Object.keys(base), ...Object.keys(s.index)])) {
      const changedInStash = s.work[p] !== base[p] || s.index[p] !== base[p];
      if (!changedInStash) continue;
      if (r.work[p] !== head[p] || r.index[p] !== head[p]) blocked.push(p);
    }
    if (blocked.length) fail(`error: your local changes to ${listNames(blocked)} would be overwritten. Commit or stash them first.`);
    for (const p of new Set([...Object.keys(s.work), ...Object.keys(base)])) {
      if (s.work[p] === base[p]) continue;
      if (s.work[p] === undefined) delete r.work[p];
      else r.work[p] = s.work[p];
    }
    for (const p of new Set([...Object.keys(s.index), ...Object.keys(base)])) {
      if (s.index[p] === base[p]) continue;
      if (s.index[p] === undefined) delete r.index[p];
      else r.index[p] = s.index[p];
    }
    if (sub === 'pop') r.stash.shift();
    out(c, sub === 'pop' ? 'Restored your stashed changes and dropped the stash.' : 'Applied stash@{0}.');
    explain(c, 'Your parked changes are back in the folder.');
    c.events.push({ type: 'files' });
    return;
  }
  if (sub !== 'push' && sub !== 'save' && !sub.startsWith('-')) fail(`error: unknown stash command '${sub}'. Try: git stash, git stash pop, git stash list`);
  const st = status(r);
  if (!st.staged.length && !st.unstaged.length) fail('No local changes to save' + (st.untracked.length ? ' (untracked files are not stashed; git add them first)' : ''));
  const { values } = flags(rest);
  const msg = values.m ?? `WIP on ${headLabel(r)}: ${headId(r) ? `${short(headId(r)!)} ${r.commits[headId(r)!].message}` : ''}`;
  r.stash.unshift({ base: headId(r), index: { ...r.index }, work: { ...r.work }, message: msg });
  const untracked = Object.fromEntries(st.untracked.map((p) => [p, r.work[p]]));
  r.index = { ...head };
  r.work = { ...head, ...untracked };
  out(c, `Saved working directory and index state ${msg}`);
  explain(c, 'Parked your uncommitted changes on the stash shelf. The folder is clean again; "git stash pop" brings them back.');
  c.events.push({ type: 'files' });
}

function lineDiff(a: string, b: string): string[] {
  const A = a.split('\n');
  const B = b.split('\n');
  if (A[A.length - 1] === '') A.pop();
  if (B[B.length - 1] === '') B.pop();
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const outp: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && A[i] === B[j]) {
      outp.push(' ' + A[i]);
      i++;
      j++;
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) outp.push('+' + B[j++]);
    else outp.push('-' + A[i++]);
  }
  return outp;
}

export function diffTrees(from: Tree, to: Tree): string {
  const lines: string[] = [];
  for (const p of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
    if (from[p] === to[p]) continue;
    lines.push(`diff --git a/${p} b/${p}`);
    if (from[p] === undefined) lines.push('new file');
    if (to[p] === undefined) lines.push('deleted file');
    lines.push(`--- ${from[p] === undefined ? '/dev/null' : 'a/' + p}`, `+++ ${to[p] === undefined ? '/dev/null' : 'b/' + p}`);
    lines.push(...lineDiff(from[p] ?? '', to[p] ?? ''));
  }
  return lines.join('\n');
}

function gDiff(c: Ctx, args: string[]) {
  const { set, rest } = flags(args);
  const r = c.repo;
  let text: string;
  if (rest.length >= 2) text = diffTrees(treeOf(r, resolve(r, rest[0])), treeOf(r, resolve(r, rest[1])));
  else if (rest.length === 1) text = diffTrees(treeOf(r, resolve(r, rest[0])), r.work);
  else if (set.has('--staged') || set.has('--cached')) text = diffTrees(headTree(r), r.index);
  else {
    // unstaged: index vs work, tracked files only
    const work = Object.fromEntries(Object.entries(r.work).filter(([p]) => p in r.index));
    text = diffTrees(r.index, work);
  }
  out(c, text || '(no differences)');
  if (!rest.length && !text) explain(c, set.has('--staged') ? 'Nothing is staged that differs from the last commit.' : 'git diff shows unstaged edits only. Try "git diff --staged" for what is staged.');
}

function gShow(c: Ctx, args: string[]) {
  const r = c.repo;
  const id = resolve(r, args.find((a) => !a.startsWith('-')) ?? 'HEAD');
  const cm = r.commits[id];
  out(c, `commit ${id}\n\n    ${cm.message}\n\n${diffTrees(treeOf(r, cm.parents[0] ?? null), cm.tree)}`);
}

/** Build a repo by replaying commands silently. Used by lesson setups. */
export function replay(commands: string[]): Repo {
  let r = emptyRepo();
  for (const cmd of commands) {
    const res = run(r, cmd);
    const err = res.lines.find((l) => l.kind === 'err');
    if (err) throw new Error(`setup step "${cmd}" failed: ${err.text}`);
    r = res.repo;
  }
  return r;
}

/** Words to offer for Tab completion. */
export function completions(r: Repo): string[] {
  return [
    ...Object.keys(r.work),
    ...Object.keys(r.branches),
    ...Object.keys(r.tags),
    'init', 'status', 'add', 'commit', 'log', 'branch', 'switch', 'checkout', 'merge', 'rebase', 'reset', 'restore',
    'revert', 'cherry-pick', 'stash', 'diff', 'show', 'tag', '--oneline', '--all', '--staged', '--hard', '--soft', '--abort', 'HEAD',
  ];
}
