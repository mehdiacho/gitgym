import { AnimatePresence, motion } from 'motion/react';
import { headId, headTree, status, type Repo } from '../engine/repo';

interface Props {
  repo: Repo;
  flash: { kind: 'stage' | 'unstage' | 'commit' | null; key: number };
  onOpen: (path: string) => void;
}

type Badge = { text: string; tone: 'new' | 'mod' | 'del' | 'clash' | 'clean'; title: string };

const chip = { type: 'spring', stiffness: 380, damping: 30 } as const;

export function Areas({ repo, flash, onOpen }: Props) {
  if (!repo.initialized) {
    const files = Object.keys(repo.work).sort();
    return (
      <div className="areas areas-single">
        <Box title="Folder" sub="not tracked by git yet" tone="work" pulse={false}>
          <Chips paths={files} badge={() => null} onOpen={onOpen} from={0} />
        </Box>
      </div>
    );
  }

  const s = status(repo);
  const head = headTree(repo);
  const id = headId(repo);
  const conflicts = new Set(s.conflicts);
  const untracked = new Set(s.untracked);
  const unstaged = new Map(s.unstaged.map((u) => [u.path, u.change]));
  const staged = new Map(s.staged.map((u) => [u.path, u.change]));

  const workFiles = [...new Set([...Object.keys(repo.work), ...s.unstaged.filter((u) => u.change === 'deleted').map((u) => u.path)])].sort();
  const workBadge = (p: string): Badge | null => {
    if (conflicts.has(p)) return { text: '!', tone: 'clash', title: 'conflict: edit this file' };
    if (untracked.has(p)) return { text: 'U', tone: 'new', title: 'untracked: git has never seen it' };
    const u = unstaged.get(p);
    if (u === 'modified') return { text: 'M', tone: 'mod', title: 'modified, not staged' };
    if (u === 'deleted') return { text: 'D', tone: 'del', title: 'deleted, not staged' };
    return null;
  };
  const stagedFiles = [...staged.keys()];
  const carried = Object.keys(repo.index).filter((p) => !staged.has(p)).length;
  const stagedBadge = (p: string): Badge => {
    const c = staged.get(p)!;
    return c === 'new'
      ? { text: 'A', tone: 'new', title: 'new file, staged' }
      : c === 'deleted'
        ? { text: 'D', tone: 'del', title: 'deletion staged' }
        : { text: 'M', tone: 'mod', title: 'change staged' };
  };
  const committed = Object.keys(head).sort();

  return (
    <div className="areas">
      <Box title="Working folder" sub="your files, as they are now" tone="work" pulse={flash.kind === 'unstage'} pulseKey={flash.key}>
        <Chips paths={workFiles} badge={workBadge} onOpen={onOpen} from={1} deleted={(p) => unstaged.get(p) === 'deleted'} />
      </Box>
      <Arrow label="git add" back="git restore --staged" />
      <Box
        title="Staging area"
        sub={stagedFiles.length ? 'goes into the next commit' : 'nothing staged'}
        tone="stage"
        pulse={flash.kind === 'stage'}
        pulseKey={flash.key}
        foot={carried ? `+ ${carried} unchanged file${carried === 1 ? '' : 's'} carried over` : undefined}
      >
        <Chips paths={stagedFiles} badge={stagedBadge} onOpen={onOpen} from={-1} deleted={(p) => staged.get(p) === 'deleted'} />
      </Box>
      <Arrow label="git commit" />
      <Box
        title="Last commit"
        sub={id ? `HEAD → ${id} · ${repo.commits[id].message}` : 'no commits yet'}
        tone="repo"
        pulse={flash.kind === 'commit'}
        pulseKey={flash.key}
      >
        <Chips paths={committed} badge={() => null} onOpen={onOpen} from={-1} muted />
      </Box>
    </div>
  );
}

function Box(props: {
  title: string;
  sub: string;
  tone: string;
  pulse: boolean;
  pulseKey?: number;
  foot?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`area area-${props.tone}`}>
      {props.pulse && (
        <motion.span
          key={props.pulseKey}
          className="area-flash"
          initial={{ opacity: 0.55 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
        />
      )}
      <header>
        <h3>{props.title}</h3>
        <p title={props.sub}>{props.sub}</p>
      </header>
      {props.children}
      {props.foot && <footer>{props.foot}</footer>}
    </section>
  );
}

function Chips(props: {
  paths: string[];
  badge: (p: string) => Badge | null;
  onOpen: (p: string) => void;
  /** -1: slide in from the left (previous box), 1: from the right */
  from: number;
  muted?: boolean;
  deleted?: (p: string) => boolean;
}) {
  if (!props.paths.length) return <div className="chips-empty">empty</div>;
  return (
    <ul className="chips">
      <AnimatePresence initial={false} mode="popLayout">
        {props.paths.map((p) => {
          const b = props.badge(p);
          const del = props.deleted?.(p);
          return (
            <motion.li
              key={p}
              layout
              initial={{ opacity: 0, x: props.from * -46, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 46, scale: 0.9 }}
              transition={chip}
            >
              <button
                className={`chip${props.muted ? ' chip-muted' : ''}${b ? ` tone-${b.tone}` : ''}${del ? ' chip-del' : ''}`}
                onClick={() => props.onOpen(p)}
                title={b?.title ?? 'click to view'}
              >
                <span className="chip-name">{p}</span>
                {b && <span className="badge">{b.text}</span>}
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function Arrow({ label, back }: { label: string; back?: string }) {
  return (
    <div className="arrow" aria-hidden>
      <span className="arrow-fwd">{label} →</span>
      {back && <span className="arrow-back">← {back}</span>}
    </div>
  );
}
