import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Areas } from './components/Areas';
import { GitHub } from './components/GitHub';
import { Graph } from './components/Graph';
import { Terminal } from './components/Terminal';
import { Trail } from './components/Trail';
import { cloneRepo, headLabel, type Repo } from './engine/repo';
import { completions, diffTrees, run, type GitEvent, type Line } from './engine/shell';
import { continueInto, LESSONS, setupFor, type Lesson } from './lessons';

const STORE = 'gitgym:v1';
const REPO_STORE = 'gitgym:repo:v2';
interface Saved {
  done: string[];
  current: string;
}
interface SavedRepo {
  lesson: string;
  repo: Repo;
  start: Repo;
}
const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null; /* private mode or bad data */
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked or full: progress just won't persist */
  }
};
const load = (): Saved => {
  const s = read(STORE) as Saved | null;
  if (s && Array.isArray(s.done) && typeof s.current === 'string') return s;
  return { done: [], current: LESSONS[0].id };
};
const isRepo = (r: unknown): r is Repo => {
  const x = r as Repo | null;
  return !!x && typeof x === 'object' && typeof x.commits === 'object' && typeof x.branches === 'object' && Array.isArray(x.branchOrder)
    && typeof x.work === 'object' && typeof x.index === 'object' && typeof x.tracking === 'object' && typeof x.upstream === 'object'
    && 'remote' in x && !!x.head && Array.isArray(x.stash);
};
const loadRepo = (lesson: string): SavedRepo | null => {
  const s = read(REPO_STORE) as SavedRepo | null;
  return s && s.lesson === lesson && isRepo(s.repo) && isRepo(s.start) ? s : null;
};

function welcome(lesson: Lesson, carried: boolean): Line[] {
  const lines: Line[] = [{ kind: 'out', text: `GitGym · ${lesson.chapter} · ${lesson.title}` }];
  if (carried) lines.push({ kind: 'explain', text: 'Same project as before: everything you did so far is still here. Look at the trail, or start with "git status".' });
  else lines.push({ kind: 'explain', text: LESSONS.indexOf(lesson) ? 'The project is ready, built up to this point. Start with "git status" or "git log --oneline".' : 'Type "help" any time for the commands that work here.' });
  return lines;
}

/** The hint text the learner sees. Hints that are clicks rather than commands get a description. */
const hintLabel = (h: string) => (h.startsWith('@pages') ? 'GitHub panel → Settings → Pages → Deploy from main' : h);

type Flash = { kind: 'stage' | 'unstage' | 'commit' | null; key: number };
type Box = { x: number; y: number; w: number; h: number };
type Flight = { id: string; message: string; from: Box; key: number };
type Packet = { id: string; from: Box; to: Box; delay: number; key: string };

const boxOf = (el: Element | null): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function App() {
  const [saved, setSaved] = useState<Saved>(load);
  const lesson = LESSONS.find((l) => l.id === saved.current) ?? LESSONS[0];
  const idx = LESSONS.indexOf(lesson);
  const [boot] = useState(() => loadRepo(lesson.id));
  const [startRepo, setStartRepo] = useState<Repo>(() => boot?.start ?? setupFor(idx));
  const [repo, setRepo] = useState<Repo>(() => boot?.repo ?? startRepo);
  const [lines, setLines] = useState<Line[]>(() => welcome(lesson, !!boot));
  const [typed, setTyped] = useState<string[]>([]);
  const [met, setMet] = useState<Set<number>>(new Set());
  const [hintsShown, setHintsShown] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>({ kind: null, key: 0 });
  const [draft, setDraft] = useState({ text: '', key: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landing, setLanding] = useState<string | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [deployKey, setDeployKey] = useState(0);

  useEffect(() => write(STORE, saved), [saved]);
  useEffect(() => write(REPO_STORE, { lesson: lesson.id, repo, start: startRepo }), [lesson.id, repo, startRepo]);

  /** Open a lesson. `carry` keeps the learner's own project and applies the lesson's setup on top. */
  const start = useCallback((l: Lesson, carry: Repo | null) => {
    const i = LESSONS.indexOf(l);
    const carried = carry ? continueInto(carry, l) : null;
    const r = carried ?? setupFor(i);
    setSaved((s) => ({ ...s, current: l.id }));
    setStartRepo(r);
    setRepo(r);
    setLines(welcome(l, !!carried));
    setTyped([]);
    setMet(new Set());
    setHintsShown(0);
    setPulse(null);
    setOpen(null);
    setInspect(null);
    setMenu(false);
    setFlight(null);
    setLanding(null);
    setPackets([]);
  }, []);

  const reset = () => {
    setRepo(startRepo);
    setLines(welcome(lesson, false));
    setTyped([]);
    setMet(new Set());
    setPulse(null);
    setLanding(null);
    setFlight(null);
  };

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

  const react = (events: GitEvent[], r: Repo) => {
    const calm = reduced();
    for (const e of events) {
      if (e.type === 'commit') {
        setPulse(e.id);
        setFlash((f) => ({ kind: 'commit', key: f.key + 1 }));
        const from = boxOf(document.querySelector('.ln-input'));
        if (from && !calm && r.commits[e.id]) {
          setLanding(e.id);
          setFlight((f) => ({ id: e.id, message: r.commits[e.id].message, from, key: (f?.key ?? 0) + 1 }));
        }
      } else if (e.type === 'stage') setFlash((f) => ({ kind: 'stage', key: f.key + 1 }));
      else if (e.type === 'unstage') setFlash((f) => ({ kind: 'unstage', key: f.key + 1 }));
      else if (e.type === 'deploy') setDeployKey((k) => k + 1);
      else if (e.type === 'open') setOpen(e.path);
      else if (e.type === 'push' && !calm) {
        // Read positions after this render, once the trail shows the ☁ badges.
        requestAnimationFrame(() => {
          const to = boxOf(document.querySelector('[data-github]'));
          if (!to) return;
          const ps: Packet[] = [];
          e.ids.slice(0, 6).forEach((id, n) => {
            const from = boxOf(document.querySelector(`[data-trail="${id}"]`));
            if (from) ps.push({ id, from, to, delay: n * 0.08, key: `${id}-${Date.now()}` });
          });
          setPackets(ps);
        });
      }
    }
  };

  const where = repo.head.kind === 'detached' ? 'HEAD ' + repo.head.id : headLabel(repo);
  const prompt = `~/my-site${repo.initialized ? ` (${where}${repo.merging ? '|MERGING' : ''})` : ''} $ `;

  const onRun = (cmd: string) => {
    const echo: Line = { kind: 'cmd', text: prompt + '\u0000' + cmd };
    if (!cmd) return setLines((ls) => [...ls, echo]);
    const res = run(repo, cmd);
    if (res.lines.some((l) => l.text === '\u001bclear')) setLines([]);
    else setLines((ls) => [...ls, echo, ...res.lines].slice(-400));
    const t = [...typed, cmd];
    setTyped(t);
    setRepo(res.repo);
    react(res.events, res.repo);
    check(res.repo, t);
  };

  /** A click in the GitHub panel: runs the hidden command without echoing it as typed. */
  const enablePages = () => {
    const res = run(repo, '@pages main');
    setLines((ls) => [...ls, { kind: 'explain', text: 'You switched on GitHub Pages in the repo settings. GitHub now builds a website from main.' }, ...res.lines]);
    const t = [...typed, '@pages main'];
    setTyped(t);
    setRepo(res.repo);
    react(res.events, res.repo);
    check(res.repo, t);
  };

  const pickHint = (h: string) => (h.startsWith('@pages') ? enablePages() : setDraft((d) => ({ text: h, key: d.key + 1 })));

  const saveFile = (path: string, text: string) => {
    const r = cloneRepo(repo);
    r.work[path] = text.endsWith('\n') || !text ? text : text + '\n';
    setRepo(r);
    setLines((ls) => [...ls, { kind: 'explain', text: `You edited ${path} in the editor. Git sees it as changed until you stage it.` }]);
    check(r, typed);
    setOpen(null);
  };

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
        <span className="tagline">build one website with git, and watch every step happen</span>
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
                <button key={l.id} className={`lesson-link${l.id === lesson.id ? ' active' : ''}`} onClick={() => l.id !== lesson.id && start(l, null)}>
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
            <button className="ghost-btn" onClick={reset} title="Put the project back how it was when this lesson started">
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
              <button key={i} className={`hint${h.startsWith('@') ? ' hint-click' : ''}`} onClick={() => pickHint(h)} title={h.startsWith('@') ? 'Do it for me' : 'Put it in the terminal'}>
                {hintLabel(h)}
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
                  <button className="primary" onClick={() => start(nextLesson, repo)}>
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

        <section className="panel">
          <h2>GitHub</h2>
          <GitHub repo={repo} deployKey={deployKey} onEnablePages={enablePages} />
        </section>
      </main>

      <aside className="term-col">
        <Trail repo={repo} landing={landing} onPick={setInspect} />
        <Terminal lines={lines} prompt={prompt} words={completions(repo)} onRun={onRun} draft={draft} />
      </aside>

      {flight && (
        <CommitFlight
          key={flight.key}
          flight={flight}
          onDone={() => {
            setLanding(null);
            setFlight(null);
          }}
        />
      )}
      <div className="packets" aria-hidden>
        {packets.map((p) => (
          <motion.span
            key={p.key}
            className="packet"
            initial={{ x: p.from.x + 14, y: p.from.y + p.from.h / 2, opacity: 0, scale: 0.6 }}
            animate={{ x: p.to.x + p.to.w / 2, y: p.to.y + 18, opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 0.5] }}
            transition={{ duration: 0.75, delay: p.delay, ease: 'easeInOut' }}
            onAnimationComplete={() => setPackets((ps) => ps.filter((x) => x.key !== p.key))}
          />
        ))}
      </div>

      <AnimatePresence>
        {open && <Editor key={'e' + open} path={open} repo={repo} onSave={saveFile} onClose={() => setOpen(null)} />}
        {inspect && repo.commits[inspect] && <Inspect key={'i' + inspect} id={inspect} repo={repo} onClose={() => setInspect(null)} />}
      </AnimatePresence>
    </div>
  );
}

/**
 * The commit message, lifted off the terminal line and carried to its stop on
 * the trail. The real card stays invisible until this lands on top of it.
 */
function CommitFlight({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [to, setTo] = useState<Box | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const target = document.querySelector(`[data-trail="${flight.id}"]`);
    target?.scrollIntoView({ block: 'nearest' });
    const b = boxOf(target);
    if (b) setTo(b);
    else done.current();
  }, [flight.id]);
  if (!to) return null;
  const { from } = flight;
  return (
    <motion.div
      className="flight"
      initial={{ x: from.x + 24, y: from.y - 6, width: Math.min(from.w - 48, 360), opacity: 0, scale: 0.9 }}
      animate={{
        x: [from.x + 24, from.x + 24, to.x],
        y: [from.y - 6, from.y - 40, to.y],
        width: [Math.min(from.w - 48, 360), Math.min(from.w - 48, 360), to.w],
        opacity: [0, 1, 1],
        scale: [0.9, 1.04, 1],
      }}
      transition={{ duration: 0.9, times: [0, 0.25, 1], ease: 'easeInOut' }}
      onAnimationComplete={() => done.current()}
    >
      <span className="flight-msg">{flight.message}</span>
      <code>{flight.id}</code>
    </motion.div>
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
  const settle = (side: 'ours' | 'theirs' | 'both') =>
    setText((s) => s.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, (_m, o: string, th: string) => (side === 'ours' ? o : side === 'both' ? o + th : th)));
  return (
    <Modal title={<code>{path}</code>} onClose={onClose}>
      {!exists && <p className="muted">This file is deleted in your folder. Saving brings it back.</p>}
      {conflicted && (
        <p className="warn">
          Conflict markers: keep the lines you want and delete the <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code> and{' '}
          <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> lines. Or settle every block at once:
        </p>
      )}
      {conflicted && (
        <div className="settle">
          <button className="ghost-btn" onClick={() => settle('ours')}>Keep mine (HEAD)</button>
          <button className="ghost-btn" onClick={() => settle('theirs')}>Keep theirs</button>
          <button className="ghost-btn" onClick={() => settle('both')}>Keep both</button>
        </div>
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
