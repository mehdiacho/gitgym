import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Areas } from './components/Areas';
import { Graph } from './components/Graph';
import { Terminal } from './components/Terminal';
import { cloneRepo, headLabel, type Repo } from './engine/repo';
import { completions, diffTrees, replay, run, type GitEvent, type Line } from './engine/shell';
import { LESSONS, type Lesson } from './lessons';

const STORE = 'gitgym:v1';
interface Saved {
  done: string[];
  current: string;
}
const load = (): Saved => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? '');
    if (Array.isArray(s.done) && typeof s.current === 'string') return s;
  } catch {
    /* first visit, private mode, or bad data */
  }
  return { done: [], current: LESSONS[0].id };
};
const save = (s: Saved) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage blocked: progress just won't persist */
  }
};

function welcome(lesson: Lesson): Line[] {
  return [
    { kind: 'out', text: `GitGym · ${lesson.title}` },
    {
      kind: 'explain',
      text: lesson.setup.length ? 'The repo is ready. Start with "git status" or "git log --oneline".' : 'Type "help" any time for the commands that work here.',
    },
  ];
}

type Flash = { kind: 'stage' | 'unstage' | 'commit' | null; key: number };

export default function App() {
  const [saved, setSaved] = useState<Saved>(load);
  const lesson = LESSONS.find((l) => l.id === saved.current) ?? LESSONS[0];
  const [repo, setRepo] = useState<Repo>(() => replay(lesson.setup));
  const [lines, setLines] = useState<Line[]>(() => welcome(lesson));
  const [typed, setTyped] = useState<string[]>([]);
  const [met, setMet] = useState<Set<number>>(new Set());
  const [hintsShown, setHintsShown] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>({ kind: null, key: 0 });
  const [draft, setDraft] = useState({ text: '', key: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => save(saved), [saved]);

  const start = useCallback((l: Lesson) => {
    setSaved((s) => ({ ...s, current: l.id }));
    setRepo(replay(l.setup));
    setLines(welcome(l));
    setTyped([]);
    setMet(new Set());
    setHintsShown(0);
    setPulse(null);
    setOpen(null);
    setInspect(null);
    setMenu(false);
  }, []);

  // Goals are sticky: once ticked, they stay ticked.
  const check = (r: Repo, t: string[]) => {
    setMet((prev) => {
      const next = new Set(prev);
      lesson.goals.forEach((g, i) => {
        try {
          if (g.check(r, t)) next.add(i);
        } catch {
          /* a goal that can't evaluate yet is simply not met */
        }
      });
      return next.size === prev.size ? prev : next;
    });
  };

  const complete = lesson.goals.length > 0 && met.size === lesson.goals.length;
  useEffect(() => {
    if (complete && !saved.done.includes(lesson.id)) setSaved((s) => ({ ...s, done: [...s.done, lesson.id] }));
  }, [complete, lesson.id, saved.done]);

  const react = (events: GitEvent[]) => {
    for (const e of events) {
      if (e.type === 'commit') {
        setPulse(e.id);
        setFlash((f) => ({ kind: 'commit', key: f.key + 1 }));
      } else if (e.type === 'stage') setFlash((f) => ({ kind: 'stage', key: f.key + 1 }));
      else if (e.type === 'unstage') setFlash((f) => ({ kind: 'unstage', key: f.key + 1 }));
    }
  };

  const where = repo.head.kind === 'detached' ? 'HEAD ' + repo.head.id : headLabel(repo);
  const prompt = `~/gitgym${repo.initialized ? ` (${where}${repo.merging ? '|MERGING' : ''})` : ''} $ `;

  const onRun = (cmd: string) => {
    const echo: Line = { kind: 'cmd', text: prompt + '\u0000' + cmd };
    if (!cmd) return setLines((ls) => [...ls, echo]);
    const res = run(repo, cmd);
    if (res.lines.some((l) => l.text === '\u001bclear')) setLines([]);
    else setLines((ls) => [...ls, echo, ...res.lines].slice(-400));
    const t = [...typed, cmd];
    setTyped(t);
    setRepo(res.repo);
    react(res.events);
    check(res.repo, t);
  };

  const saveFile = (path: string, text: string) => {
    const r = cloneRepo(repo);
    r.work[path] = text.endsWith('\n') || !text ? text : text + '\n';
    setRepo(r);
    setLines((ls) => [...ls, { kind: 'explain', text: `You edited ${path} in the editor. Git sees it as changed until you stage it.` }]);
    check(r, typed);
    setOpen(null);
  };

  const idx = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[idx + 1];
  const chapters = useMemo(() => [...new Set(LESSONS.map((l) => l.chapter))], []);

  return (
    <div className="app">
      <header className="top">
        <button className="menu-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Lessons">
          ☰
        </button>
        <div className="brand">
          <svg className="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <circle cx="6" cy="6" r="2.6" />
            <circle cx="6" cy="18" r="2.6" />
            <circle cx="18" cy="9" r="2.6" />
            <path d="M6 8.6v6.8M18 11.6c0 3-4 3.4-9.6 5.4" />
          </svg>
          GitGym
        </div>
        <span className="tagline">learn git by doing it, and watching it happen</span>
        <span className="progress">
          {saved.done.length}/{LESSONS.filter((l) => l.goals.length).length} lessons
        </span>
      </header>

      <nav className={`lessons${menu ? ' open' : ''}`}>
        {chapters.map((ch) => (
          <div key={ch} className="chapter">
            <h4>{ch}</h4>
            {LESSONS.filter((l) => l.chapter === ch).map((l) => {
              const done = saved.done.includes(l.id);
              return (
                <button key={l.id} className={`lesson-link${l.id === lesson.id ? ' active' : ''}`} onClick={() => start(l)}>
                  <span className={`tick${done ? ' done' : ''}`}>{done ? '✓' : l.goals.length ? LESSONS.indexOf(l) + 1 : '∞'}</span>
                  {l.title}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="stage">
        <section className="brief">
          <div className="brief-head">
            <span className="chapter-tag">{lesson.chapter}</span>
            <h1>{lesson.title}</h1>
            <button className="ghost-btn" onClick={() => start(lesson)} title="Start this lesson over">
              ↺ Reset
            </button>
          </div>
          {lesson.intro.map((p, i) => (
            <p key={i}>
              <Rich text={p} />
            </p>
          ))}
          {lesson.goals.length > 0 && (
            <ul className="goals">
              {lesson.goals.map((g, i) => (
                <li key={i} className={met.has(i) ? 'met' : ''}>
                  <motion.span className="goal-box" animate={met.has(i) ? { scale: [1, 1.35, 1] } : { scale: 1 }} transition={{ duration: 0.35 }}>
                    {met.has(i) ? '✓' : ''}
                  </motion.span>
                  <span>
                    <Rich text={g.label} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="hints">
            {lesson.hints.slice(0, hintsShown).map((h, i) => (
              <button key={i} className="hint" onClick={() => setDraft((d) => ({ text: h, key: d.key + 1 }))} title="Put it in the terminal">
                {h}
              </button>
            ))}
            {hintsShown < lesson.hints.length && (
              <button className="ghost-btn" onClick={() => setHintsShown((n) => n + 1)}>
                {hintsShown ? 'Next hint' : 'Stuck? Show a hint'}
              </button>
            )}
          </div>
          <AnimatePresence>
            {complete && (
              <motion.div className="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p>
                  <strong>Done.</strong> <Rich text={lesson.outro} />
                </p>
                {nextLesson && (
                  <button className="primary" onClick={() => start(nextLesson)}>
                    Next: {nextLesson.title} →
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="panel graph-panel">
          <h2>Commit graph</h2>
          <Graph repo={repo} pulse={pulse} onPick={setInspect} />
        </section>

        <section className="panel">
          <h2>Where your changes are</h2>
          <Areas repo={repo} flash={flash} onOpen={setOpen} />
        </section>
      </main>

      <aside className="term-col">
        <Terminal lines={lines} prompt={prompt} words={completions(repo)} onRun={onRun} draft={draft} />
      </aside>

      <AnimatePresence>
        {open && <Editor key={'e' + open} path={open} repo={repo} onSave={saveFile} onClose={() => setOpen(null)} />}
        {inspect && repo.commits[inspect] && <Inspect key={'i' + inspect} id={inspect} repo={repo} onClose={() => setInspect(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
      )}
    </>
  );
}

function Modal({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div className="modal" role="dialog" aria-modal initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8 }}>
        <header>
          <h3>{title}</h3>
          <button className="ghost-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Editor({ path, repo, onSave, onClose }: { path: string; repo: Repo; onSave: (p: string, t: string) => void; onClose: () => void }) {
  const exists = repo.work[path] !== undefined;
  const [text, setText] = useState(repo.work[path] ?? repo.index[path] ?? '');
  const conflicted = /^(<<<<<<<|=======|>>>>>>>)/m.test(text);
  return (
    <Modal title={<code>{path}</code>} onClose={onClose}>
      {!exists && <p className="muted">This file is deleted in your folder. Saving brings it back.</p>}
      {conflicted && (
        <p className="warn">
          Conflict markers: keep the lines you want and delete the <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code> and{' '}
          <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> lines.
        </p>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={10} autoFocus />
      <div className="modal-actions">
        <button className="ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" onClick={() => onSave(path, text)}>
          Save file
        </button>
      </div>
    </Modal>
  );
}

function Inspect({ id, repo, onClose }: { id: string; repo: Repo; onClose: () => void }) {
  const c = repo.commits[id];
  const d = diffTrees(c.parents[0] ? repo.commits[c.parents[0]].tree : {}, c.tree);
  return (
    <Modal
      title={
        <>
          <code>{id}</code> {c.message}
        </>
      }
      onClose={onClose}
    >
      <p className="muted">
        {c.parents.length === 0 ? 'The first commit.' : c.parents.length > 1 ? `Merge commit with parents ${c.parents.join(' and ')}.` : `Parent: ${c.parents[0]}.`}{' '}
        Files in this snapshot: {Object.keys(c.tree).join(', ') || 'none'}.
      </p>
      <pre className="diff">
        {d.split('\n').map((l, i) => (
          <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>
            {l || ' '}
          </div>
        ))}
      </pre>
    </Modal>
  );
}
