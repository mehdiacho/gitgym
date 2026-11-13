import { AnimatePresence, motion } from 'motion/react';
import { ancestors, headId, headLabel, type Repo } from '../engine/repo';

interface Props {
  repo: Repo;
  /** A commit whose card is still in flight: shown as an empty slot until it lands. */
  landing: string | null;
  onPick: (id: string) => void;
}

/** What a commit did to each file, compared with its first parent. */
export function changesOf(repo: Repo, id: string) {
  const c = repo.commits[id];
  const before = c.parents[0] ? repo.commits[c.parents[0]].tree : {};
  const out: { path: string; kind: 'A' | 'M' | 'D' }[] = [];
  for (const p of [...new Set([...Object.keys(before), ...Object.keys(c.tree)])].sort()) {
    if (before[p] === c.tree[p]) continue;
    out.push({ path: p, kind: before[p] === undefined ? 'A' : c.tree[p] === undefined ? 'D' : 'M' });
  }
  return out;
}

/**
 * The trail: every commit behind where you are now, newest on top, each one
 * carrying its message and the files it changed.
 */
export function Trail({ repo, landing, onPick }: Props) {
  const head = headId(repo);
  const ids = head ? [...ancestors(repo, head)].sort((a, b) => repo.commits[b].seq - repo.commits[a].seq) : [];
  const onGitHub = new Set<string>();
  for (const tip of Object.values(repo.remote?.branches ?? {})) ancestors(repo, tip).forEach((x) => onGitHub.add(x));
  const live = repo.remote?.deploys[repo.remote.deploys.length - 1]?.id;
  const labels = new Map<string, { text: string; kind: 'branch' | 'tag' | 'remote' }[]>();
  const add = (id: string | null | undefined, text: string, kind: 'branch' | 'tag' | 'remote') => {
    if (!id) return;
    labels.set(id, [...(labels.get(id) ?? []), { text, kind }]);
  };
  for (const b of repo.branchOrder) add(repo.branches[b], b, 'branch');
  for (const [t, id] of Object.entries(repo.tracking)) add(id, t, 'remote');
  for (const [t, id] of Object.entries(repo.tags)) add(id, t, 'tag');

  return (
    <section className="trail" aria-label="Commit trail">
      <header className="trail-head">
        <h2>Trail</h2>
        <span className="muted">{ids.length ? `${ids.length} stop${ids.length === 1 ? '' : 's'} behind ${headLabel(repo)}` : 'empty'}</span>
      </header>
      <div className="trail-list">
        {!ids.length && <p className="trail-empty">Each commit lands here with its message and the files it changed. Newest on top.</p>}
        <AnimatePresence initial={false}>
          {ids.map((id, i) => {
            const c = repo.commits[id];
            const ch = changesOf(repo, id);
            return (
              <motion.button
                layout="position"
                key={id}
                data-trail={id}
                className={`stop${c.parents.length > 1 ? ' stop-merge' : ''}${i === 0 ? ' stop-top' : ''}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: landing === id ? 0 : 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => onPick(id)}
                title="Open this commit"
              >
                <span className="stop-rail" aria-hidden>
                  <i />
                </span>
                <span className="stop-body">
                  <span className="stop-msg">{c.message}</span>
                  <span className="stop-meta">
                    <code>{id}</code>
                    {(labels.get(id) ?? []).map((l) => (
                      <span key={l.kind + l.text} className={`stop-ref stop-ref-${l.kind}`}>
                        {l.kind === 'tag' ? '◆ ' : ''}
                        {l.text}
                      </span>
                    ))}
                    {onGitHub.has(id) && (
                      <span className="stop-cloud" title="This commit is on GitHub">
                        on GitHub
                      </span>
                    )}
                    {live === id && <span className="stop-live">live</span>}
                  </span>
                  <span className="stop-files">
                    {c.parents.length > 1 ? (
                      <span className="sf sf-merge">joins {c.parents.length} lines</span>
                    ) : (
                      ch.slice(0, 4).map((f) => (
                        <span key={f.path} className={`sf sf-${f.kind}`}>
                          {f.kind === 'A' ? '+' : f.kind === 'D' ? '−' : '~'}
                          {f.path}
                        </span>
                      ))
                    )}
                    {c.parents.length < 2 && ch.length > 4 && <span className="sf">+{ch.length - 4} more</span>}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
