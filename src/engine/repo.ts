// The repository model GitGym simulates. Everything here is plain data so a
// whole repo can be cloned, compared, stored and replayed.

/** A snapshot of files: path -> contents. Directories are implied by paths. */
export type Tree = Record<string, string>;

export interface Commit {
  id: string;
  parents: string[];
  message: string;
  tree: Tree;
  /** Creation order. Used for layout and for "newest first" walks. */
  seq: number;
}

export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; id: string };

export interface StashEntry {
  base: string | null;
  index: Tree;
  work: Tree;
  message: string;
}

export interface MergeState {
  theirs: string;
  message: string;
  conflicts: string[];
}

/** The simulated GitHub side: a second set of refs that only push changes. */
export interface Remote {
  name: string;
  url: string;
  branches: Record<string, string>;
  tags: Record<string, string>;
  /** GitHub Pages: which branch it publishes, once switched on in Settings. */
  pages: { branch: string } | null;
  /** Every Pages deployment, oldest first. */
  deploys: { id: string; n: number }[];
}

export interface Repo {
  initialized: boolean;
  commits: Record<string, Commit>;
  /** Branch name -> commit id. null means the branch is unborn (no commits yet). */
  branches: Record<string, string | null>;
  /** Branch creation order, so the graph keeps its lanes stable. */
  branchOrder: string[];
  tags: Record<string, string>;
  head: Head;
  index: Tree;
  work: Tree;
  seq: number;
  merging: MergeState | null;
  stash: StashEntry[];
  remote: Remote | null;
  /** Remote-tracking refs like origin/main: what you last saw on GitHub. */
  tracking: Record<string, string>;
  /** Local branch -> the remote branch it pushes to and pulls from. */
  upstream: Record<string, string>;
}

export function emptyRepo(): Repo {
  return {
    initialized: false,
    commits: {},
    branches: {},
    branchOrder: [],
    tags: {},
    head: { kind: 'branch', name: 'main' },
    index: {},
    work: {},
    seq: 0,
    merging: null,
    stash: [],
    remote: null,
    tracking: {},
    upstream: {},
  };
}

export function cloneRepo(r: Repo): Repo {
  // Commits are immutable once made, so they can be shared.
  return {
    ...r,
    commits: { ...r.commits },
    branches: { ...r.branches },
    branchOrder: [...r.branchOrder],
    tags: { ...r.tags },
    head: { ...r.head },
    index: { ...r.index },
    work: { ...r.work },
    merging: r.merging ? { ...r.merging, conflicts: [...r.merging.conflicts] } : null,
    stash: [...r.stash],
    remote: r.remote
      ? { ...r.remote, branches: { ...r.remote.branches }, tags: { ...r.remote.tags }, pages: r.remote.pages && { ...r.remote.pages }, deploys: [...r.remote.deploys] }
      : null,
    tracking: { ...r.tracking },
    upstream: { ...r.upstream },
  };
}

export function headId(r: Repo): string | null {
  return r.head.kind === 'branch' ? (r.branches[r.head.name] ?? null) : r.head.id;
}

export function treeOf(r: Repo, id: string | null): Tree {
  return id ? r.commits[id].tree : {};
}

export function headTree(r: Repo): Tree {
  return treeOf(r, headId(r));
}

export function ancestors(r: Repo, id: string | null): Set<string> {
  const seen = new Set<string>();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...r.commits[c].parents);
  }
  return seen;
}

/** True if a is b or an ancestor of b. */
export function isAncestor(r: Repo, a: string, b: string): boolean {
  return ancestors(r, b).has(a);
}

export function mergeBase(r: Repo, a: string, b: string): string | null {
  const A = ancestors(r, a);
  let best: string | null = null;
  for (const c of ancestors(r, b)) {
    if (A.has(c) && (!best || r.commits[c].seq > r.commits[best].seq)) best = c;
  }
  return best;
}

/** Commits reachable from any branch, tag, HEAD or stash. */
export function reachable(r: Repo): Set<string> {
  const out = new Set<string>();
  const tips = [
    ...Object.values(r.branches),
    ...Object.values(r.tags),
    headId(r),
    ...r.stash.map((s) => s.base),
    r.merging?.theirs ?? null,
    ...Object.values(r.tracking),
    ...Object.values(r.remote?.branches ?? {}),
    ...Object.values(r.remote?.tags ?? {}),
  ];
  for (const t of tips) if (t) for (const c of ancestors(r, t)) out.add(c);
  return out;
}

export type FileState =
  | 'untracked'
  | 'modified'
  | 'deleted'
  | 'staged-new'
  | 'staged-modified'
  | 'staged-deleted'
  | 'clean'
  | 'conflict';

export interface StatusReport {
  staged: { path: string; change: 'new' | 'modified' | 'deleted' }[];
  unstaged: { path: string; change: 'modified' | 'deleted' }[];
  untracked: string[];
  conflicts: string[];
}

function globToRe(g: string): RegExp {
  return new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
}

/** True if .gitignore in the working folder says to leave this path alone. */
export function ignored(r: Repo, path: string): boolean {
  const rules = (r.work['.gitignore'] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return rules.some((rule) => {
    const dir = rule.endsWith('/');
    const pat = rule.replace(/^\//, '').replace(/\/$/, '');
    if (dir) return path.startsWith(pat + '/') || path.split('/').slice(0, -1).some((seg) => globToRe(pat).test(seg));
    const re = globToRe(pat);
    return re.test(path) || (!pat.includes('/') && re.test(path.split('/').pop()!));
  });
}

export function status(r: Repo): StatusReport {
  const head = headTree(r);
  const paths = new Set([...Object.keys(head), ...Object.keys(r.index), ...Object.keys(r.work)]);
  const report: StatusReport = { staged: [], unstaged: [], untracked: [], conflicts: [] };
  const conflicts = new Set(r.merging?.conflicts ?? []);
  for (const p of [...paths].sort()) {
    if (conflicts.has(p)) {
      report.conflicts.push(p);
      continue;
    }
    const h = head[p];
    const i = r.index[p];
    const w = r.work[p];
    if (i !== h) {
      report.staged.push({ path: p, change: h === undefined ? 'new' : i === undefined ? 'deleted' : 'modified' });
    }
    if (i === undefined && w !== undefined) {
      if (h === undefined || i !== h) {
        // Not in the index: untracked (or deleted-then-recreated, which git also shows as untracked).
        if (!ignored(r, p)) report.untracked.push(p);
      }
    } else if (i !== undefined && w !== i) {
      report.unstaged.push({ path: p, change: w === undefined ? 'deleted' : 'modified' });
    }
  }
  return report;
}

export function isClean(r: Repo): boolean {
  const s = status(r);
  return !s.staged.length && !s.unstaged.length && !s.conflicts.length;
}

/** Tiny deterministic hash, so the same lesson always produces the same ids. */
export function makeId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 7);
}

export function addCommit(r: Repo, parents: string[], message: string, tree: Tree): string {
  r.seq += 1;
  let id = makeId(`${r.seq}|${message}|${parents.join(',')}`);
  while (r.commits[id]) id = makeId(id + 'x');
  r.commits[id] = { id, parents, message, tree: { ...tree }, seq: r.seq };
  return id;
}

/** Move whatever HEAD points at to `id`. */
export function moveHead(r: Repo, id: string) {
  if (r.head.kind === 'branch') r.branches[r.head.name] = id;
  else r.head = { kind: 'detached', id };
}

/** Line-level three-way merge result for a set of trees. */
export interface MergeResult {
  tree: Tree;
  conflicts: string[];
}

const splitLines = (s: string) => {
  const a = s.split('\n');
  if (a[a.length - 1] === '') a.pop();
  return a;
};

/** For each line of `a`, the index of the matching line in `b` along a longest common subsequence, or -1. */
function lcsMap(a: string[], b: string[]): number[] {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) map[i++] = j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return map;
}

const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/** Line-level three-way merge (diff3 style). Only the lines both sides changed conflict. */
export function merge3(base: string, ours: string, theirs: string, oursLabel: string, theirsLabel: string): { text: string; conflict: boolean } {
  const B = splitLines(base);
  const O = splitLines(ours);
  const T = splitLines(theirs);
  const mo = lcsMap(B, O);
  const mt = lcsMap(B, T);
  const outLines: string[] = [];
  let conflict = false;
  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    let x = i;
    while (x < B.length && !(mo[x] >= j && mt[x] >= k)) x++;
    const jo = x < B.length ? mo[x] : O.length;
    const kt = x < B.length ? mt[x] : T.length;
    const b = B.slice(i, x);
    const o = O.slice(j, jo);
    const t = T.slice(k, kt);
    if (same(o, b)) outLines.push(...t);
    else if (same(t, b) || same(o, t)) outLines.push(...o);
    else {
      conflict = true;
      outLines.push(`<<<<<<< ${oursLabel}`, ...o, '=======', ...t, `>>>>>>> ${theirsLabel}`);
    }
    if (x >= B.length) break;
    outLines.push(B[x]);
    i = x + 1;
    j = jo + 1;
    k = kt + 1;
  }
  return { text: outLines.length ? outLines.join('\n') + '\n' : '', conflict };
}

export function mergeTrees(base: Tree, ours: Tree, theirs: Tree, oursLabel: string, theirsLabel: string): MergeResult {
  const out: Tree = {};
  const conflicts: string[] = [];
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const p of [...paths].sort()) {
    const b = base[p];
    const o = ours[p];
    const t = theirs[p];
    let v: string | undefined;
    if (o === t) v = o;
    else if (o === b) v = t;
    else if (t === b) v = o;
    else if (o !== undefined && t !== undefined) {
      // Both sides edited the file: merge line by line.
      const m = merge3(b ?? '', o, t, oursLabel, theirsLabel);
      v = m.text;
      if (m.conflict) conflicts.push(p);
    } else {
      // One side deleted the file, the other changed it.
      conflicts.push(p);
      v = `<<<<<<< ${oursLabel}\n${o ?? ''}${o && !o.endsWith('\n') ? '\n' : ''}=======\n${t ?? ''}${t && !t.endsWith('\n') ? '\n' : ''}>>>>>>> ${theirsLabel}\n`;
    }
    if (v !== undefined) out[p] = v;
  }
  return { tree: out, conflicts };
}

/** The branch HEAD is on, or the short id when detached. */
export function headLabel(r: Repo): string {
  return r.head.kind === 'branch' ? r.head.name : r.head.id;
}
