// Lays the commit graph out left to right: x is time (creation order), y is a
// lane. Each branch claims a lane for the commits it reaches first, so lanes
// stay put as you work and the picture doesn't jump around.
import { headId, reachable, type Repo } from '../engine/repo';

export const COL = 72;
export const ROW = 64;
export const PAD_X = 48;
export const PAD_Y = 64;

export interface NodePos {
  id: string;
  x: number;
  y: number;
  lane: number;
  message: string;
  orphan: boolean;
  merge: boolean;
}
export interface Edge {
  from: string;
  to: string;
  d: string;
  lane: number;
  orphan: boolean;
}
export interface RefLabel {
  name: string;
  kind: 'branch' | 'tag';
  at: string;
  current: boolean;
  lane: number;
}
export interface Layout {
  nodes: NodePos[];
  edges: Edge[];
  refs: RefLabel[];
  head: { at: string | null; detached: boolean };
  width: number;
  height: number;
  laneCount: number;
}

export function layout(r: Repo): Layout {
  const all = Object.values(r.commits).sort((a, b) => a.seq - b.seq);
  const live = reachable(r);
  const lane = new Map<string, number>();
  let next = 0;

  const claim = (tip: string | null) => {
    let c = tip;
    let took = false;
    while (c && !lane.has(c)) {
      lane.set(c, next);
      took = true;
      c = r.commits[c].parents[0] ?? null;
    }
    if (took) next++;
  };
  // main (or whatever came first) gets the top lane
  for (const b of r.branchOrder) claim(r.branches[b] ?? null);
  claim(headId(r));
  for (const t of Object.values(r.tags)) claim(t);
  for (const s of r.stash) claim(s.base);
  // whatever is left is orphaned; newest first so each orphan chain gets one lane
  for (const c of [...all].reverse()) if (!lane.has(c.id)) claim(c.id);

  const col = new Map(all.map((c, i) => [c.id, i]));
  const pos = (id: string) => ({ x: PAD_X + col.get(id)! * COL, y: PAD_Y + lane.get(id)! * ROW });

  const nodes: NodePos[] = all.map((c) => ({
    id: c.id,
    ...pos(c.id),
    lane: lane.get(c.id)!,
    message: c.message,
    orphan: !live.has(c.id),
    merge: c.parents.length > 1,
  }));

  const edges: Edge[] = [];
  for (const c of all) {
    c.parents.forEach((p, i) => {
      const a = pos(p);
      const b = pos(c.id);
      let d: string;
      if (a.y === b.y) d = `M ${a.x} ${a.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${b.x} ${b.y}`;
      else {
        // bend near the child so parallel lanes read as lanes
        const mid = b.x - COL * 0.55;
        const sx = Math.max(a.x, mid - COL * 0.45);
        d = `M ${a.x} ${a.y} C ${sx + COL * 0.45} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
      }
      edges.push({ from: p, to: c.id, d, lane: i === 0 ? lane.get(c.id)! : lane.get(p)!, orphan: !live.has(c.id) });
    });
  }

  const refs: RefLabel[] = [];
  for (const b of r.branchOrder) {
    const at = r.branches[b];
    if (!at) continue;
    refs.push({ name: b, kind: 'branch', at, current: r.head.kind === 'branch' && r.head.name === b, lane: lane.get(at)! });
  }
  for (const [t, at] of Object.entries(r.tags)) refs.push({ name: t, kind: 'tag', at, current: false, lane: lane.get(at)! });

  const laneCount = Math.max(1, next);
  return {
    nodes,
    edges,
    refs,
    head: { at: headId(r), detached: r.head.kind === 'detached' },
    width: PAD_X * 2 + Math.max(0, all.length - 1) * COL + 160,
    height: PAD_Y + (laneCount - 1) * ROW + 48,
    laneCount,
  };
}
