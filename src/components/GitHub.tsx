import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { Repo, Tree } from '../engine/repo';

interface Props {
  repo: Repo;
  /** Bumps on each deploy so the browser frame can play its "deploying" beat. */
  deployKey: number;
  onEnablePages: () => void;
}

const siteUrl = (repo: Repo) => {
  const m = repo.remote?.url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  return m ? `${m[1]}.github.io/${m[2]}` : 'you.github.io/site';
};

/** Inline style.css into the page and switch off links and scripts, so it renders safely inside the frame. */
function pageFor(tree: Tree, path: string): string {
  let html = tree[path] ?? '<p>404: there is no ' + path + ' in this deploy.</p>';
  const css = Object.entries(tree)
    .filter(([p]) => p.endsWith('.css'))
    .map(([, v]) => v)
    .join('\n');
  html = html.replace(/<link[^>]*stylesheet[^>]*>/gi, '');
  const base = `<style>body{font-family:system-ui,sans-serif;margin:16px;line-height:1.5}a{pointer-events:none}</style><style>${css}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
}

export function GitHub({ repo, deployKey, onEnablePages }: Props) {
  const remote = repo.remote;
  const live = remote?.deploys[remote.deploys.length - 1];
  const tree = live ? repo.commits[live.id]?.tree ?? {} : {};
  const pages = Object.keys(tree).filter((p) => p.endsWith('.html')).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  const [tab, setTab] = useState('index.html');
  const [deploying, setDeploying] = useState(false);
  useEffect(() => {
    if (!deployKey) return;
    setDeploying(true);
    const t = setTimeout(() => setDeploying(false), 1100);
    return () => clearTimeout(t);
  }, [deployKey]);
  const current = pages.includes(tab) ? tab : pages[0];
  const doc = useMemo(() => (current ? pageFor(tree, current) : ''), [tree, current]);

  if (!remote) {
    return (
      <div className="gh gh-off">
        <span className="gh-cloud" aria-hidden>
          ☁
        </span>
        <div>
          <strong>Not connected to GitHub yet.</strong>
          <p className="muted">
            Your project only lives on this computer. Chapter 3 links it to a GitHub repo with <code>git remote add</code>, then <code>git push</code> sends your trail up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gh">
      <div className="gh-repo" data-github>
        <div className="gh-title">
          <span className="gh-cloud" aria-hidden>
            ☁
          </span>
          <div>
            <strong>{remote.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}</strong>
            <span className="muted"> · {remote.name}</span>
          </div>
        </div>
        <div className="gh-rows">
          <div>
            <h4>Branches</h4>
            {Object.keys(remote.branches).length ? (
              Object.entries(remote.branches).map(([b, id]) => (
                <div key={b} className="gh-row">
                  <span className="stop-ref stop-ref-branch">{b}</span>
                  <code>{id}</code>
                  <span className="muted">{repo.commits[id]?.message}</span>
                </div>
              ))
            ) : (
              <p className="muted">Empty: nothing pushed yet.</p>
            )}
          </div>
          {Object.keys(remote.tags).length > 0 && (
            <div>
              <h4>Releases</h4>
              {Object.entries(remote.tags).map(([t, id]) => (
                <div key={t} className="gh-row">
                  <span className="stop-ref stop-ref-tag">◆ {t}</span>
                  <code>{id}</code>
                </div>
              ))}
            </div>
          )}
          <div>
            <h4>Settings → Pages</h4>
            {remote.pages ? (
              <p className="muted">
                Publishing from <span className="stop-ref stop-ref-branch">{remote.pages.branch}</span>. Every push to it redeploys the site.
              </p>
            ) : (
              <div className="gh-pages-off">
                <p className="muted">GitHub Pages is off. Turn it on and GitHub serves the files on main as a website.</p>
                <button className="primary" onClick={onEnablePages} disabled={!remote.branches.main}>
                  Deploy from main
                </button>
                {!remote.branches.main && <p className="muted">Push main first, so there is something to publish.</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {live && (
        <div className="browser">
          <div className="browser-bar">
            <span className="dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="url">https://{siteUrl(repo)}/{current === 'index.html' ? '' : current}</span>
            <span className="stop-live">deploy #{live.n}</span>
          </div>
          {pages.length > 1 && (
            <div className="browser-tabs">
              {pages.map((p) => (
                <button key={p} className={p === current ? 'on' : ''} onClick={() => setTab(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          <div className="browser-view">
            {current ? <iframe title="Your live site" sandbox="" srcDoc={doc} /> : <p className="muted pad">This deploy has no .html file, so the site is blank.</p>}
            <AnimatePresence>
              {deploying && (
                <motion.div className="deploying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: 'easeInOut' }} />
                  Deploying {live.id}…
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
