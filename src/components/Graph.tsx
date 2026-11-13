import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Repo } from '../engine/repo';
import { layout } from '../graph/layout';

const LANE_VARS = ['--lane-0', '--lane-1', '--lane-2', '--lane-3', '--lane-4', '--lane-5'];
const laneColor = (l: number) => `var(${LANE_VARS[l % LANE_VARS.length]})`;
const spring = { type: 'spring', stiffness: 260, damping: 28 } as const;

interface Props {
  repo: Repo;
  pulse: string | null;
  onPick?: (id: string) => void;
}

export function Graph({ repo, pulse, onPick }: Props) {
  const L = useMemo(() => layout(repo), [repo]);
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  // keep the newest commit in view
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [L.width]);

  const byId = new Map(L.nodes.map((n) => [n.id, n]));
  const stacks = new Map<string, number>();
  const headNode = L.head.at ? byId.get(L.head.at) : undefined;
  const hovered = hover ? byId.get(hover) : undefined;
  // Labels sit above commits in the top lane and below them elsewhere, so they don't sit on lane curves.
  const labelY = (n: { y: number; lane: number }, k: number) => (n.lane === 0 ? n.y - 34 - k * 22 : n.y + 50 + k * 22);

  if (!repo.initialized) {
    return (
      <div className="graph graph-empty">
        <p>No repository yet.</p>
        <p className="muted">
          Type <code>git init</code> and the commit graph will grow here.
        </p>
      </div>
    );
  }

  if (!L.nodes.length) {
    return (
      <div className="graph graph-empty">
        <p>
          On branch <code>{repo.head.kind === 'branch' ? repo.head.name : ''}</code>, no commits yet.
        </p>
        <p className="muted">Your first commit will appear here as a dot.</p>
      </div>
    );
  }

  return (
    <div className="graph" ref={scroller}>
      <svg width={L.width} height={L.height + (L.laneCount > 1 ? 56 : 0)} role="img" aria-label="Commit graph">
        <AnimatePresence>
          {L.edges.map((e) => (
            <motion.path
              key={`${e.from}-${e.to}`}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: e.orphan ? 0.22 : 1, d: e.d }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              fill="none"
              style={{ stroke: laneColor(e.lane) }}
              strokeWidth={2.5}
              strokeDasharray={e.orphan ? '4 5' : undefined}
            />
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {L.nodes.map((n) => (
            <motion.g
              key={n.id}
              initial={{ x: n.x, y: n.y, scale: 0, opacity: 0 }}
              animate={{ x: n.x, y: n.y, scale: 1, opacity: n.orphan ? 0.3 : 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={spring}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(n.id)}
              style={{ cursor: onPick ? 'pointer' : 'default' }}
            >
              {pulse === n.id && (
                <motion.circle
                  r={12}
                  fill="none"
                  style={{ stroke: laneColor(n.lane) }}
                  strokeWidth={2}
                  initial={{ scale: 1, opacity: 0.9 }}
                  animate={{ scale: 2.6, opacity: 0 }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                />
              )}
              <circle r={n.merge ? 11 : 10} className="node" style={{ stroke: laneColor(n.lane) }} strokeWidth={3} />
              {n.merge && <circle r={4} style={{ fill: laneColor(n.lane) }} />}
              <text y={30} textAnchor="middle" className="node-id">
                {n.id.slice(0, 7)}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {L.refs.map((ref) => {
            const n = byId.get(ref.at)!;
            const k = stacks.get(ref.at) ?? 0;
            stacks.set(ref.at, k + 1);
            const w = ref.name.length * 7.4 + (ref.kind === 'tag' ? 26 : 18);
            return (
              <motion.g
                key={`${ref.kind}:${ref.name}`}
                initial={{ x: n.x - w / 2, y: labelY(n, k), opacity: 0 }}
                animate={{ x: n.x - w / 2, y: labelY(n, k), opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={spring}
              >
                <rect
                  width={w}
                  height={19}
                  y={-10}
                  rx={ref.kind === 'tag' ? 3 : 9.5}
                  className={ref.current ? 'ref ref-current' : ref.kind === 'tag' ? 'ref ref-tag' : 'ref'}
                  style={{ ['--c' as string]: laneColor(ref.lane) }}
                />
                <text x={w / 2} y={4} textAnchor="middle" className="ref-text">
                  {ref.kind === 'tag' ? '◆ ' : ''}
                  {ref.name}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {headNode && (
          <motion.g
            initial={false}
            animate={{
              x: headNode.x,
              y: labelY(headNode, stacks.get(headNode.id) ?? 0),
            }}
            transition={spring}
          >
            <rect x={-22} y={-10} width={44} height={19} rx={4} className="head-tag" />
            <text y={4} textAnchor="middle" className="head-text">
              HEAD
            </text>
          </motion.g>
        )}
      </svg>
      {hovered && (
        <div className="graph-tip" style={{ left: hovered.x, top: hovered.y + 42 }}>
          <b>{hovered.id}</b> {hovered.message}
          {hovered.orphan && <div className="muted">unreachable: no branch points here</div>}
        </div>
      )}
      <div className="graph-legend">
        <span>
          <i className="dot" /> commit
        </span>
        <span>
          <i className="pill" /> branch
        </span>
        <span>
          <i className="headkey" /> where you are
        </span>
        <span>
          <i className="ghost" /> unreachable
        </span>
      </div>
    </div>
  );
}
