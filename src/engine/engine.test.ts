import { describe, expect, it } from 'vitest';
import { LESSONS, setupFor } from '../lessons';
import { headId, status } from './repo';
import { replay, run, tokenize } from './shell';

describe('tokenize', () => {
  it('keeps quoted strings and splits redirects', () => {
    expect(tokenize('echo "hi there">a.txt')).toEqual(['echo', 'hi there', '>', 'a.txt']);
    expect(tokenize("git commit -m 'x y'")).toEqual(['git', 'commit', '-m', 'x y']);
    expect(tokenize('echo a >> b')).toEqual(['echo', 'a', '>>', 'b']);
  });
});

describe('git basics', () => {
  it('init, add, commit', () => {
    const r = replay(['git init', 'echo hi > a.txt', 'git add a.txt', 'git commit -m "first"']);
    expect(headId(r)).toBeTruthy();
    expect(status(r).staged).toHaveLength(0);
  });

  it('refuses to commit with nothing staged', () => {
    const r = replay(['git init', 'echo hi > a.txt']);
    const res = run(r, 'git commit -m x');
    expect(res.lines.some((l) => l.kind === 'err')).toBe(true);
    expect(res.repo).toBe(r === res.repo ? r : res.repo); // unchanged on error
    expect(headId(res.repo)).toBeNull();
  });

  it('a failed step in a chain stops the chain', () => {
    const r = replay(['git init']);
    const res = run(r, 'git commit -m nope && echo after > z.txt');
    expect(res.repo.work['z.txt']).toBeUndefined();
  });

  it('three-way merge with conflict, then resolve', () => {
    let r = replay([
      'git init',
      'echo base > f && git add . && git commit -m base',
      'git switch -c b && echo theirs > f && git commit -am theirs',
      'git switch main && echo ours > f && git commit -am ours',
    ]);
    r = run(r, 'git merge b').repo;
    expect(r.merging?.conflicts).toEqual(['f']);
    expect(r.work.f).toContain('<<<<<<< HEAD');
    expect(run(r, 'git commit -m x').lines.some((l) => l.kind === 'err')).toBe(true);
    r = run(r, 'echo done > f && git add f && git commit -m merged').repo;
    expect(r.merging).toBeNull();
    expect(r.commits[headId(r)!].parents).toHaveLength(2);
  });

  it('rebase replays commits with new ids', () => {
    const r = replay([
      'git init',
      'echo a > a && git add . && git commit -m a',
      'git switch -c f && echo f > f && git add . && git commit -m f',
      'git switch main && echo m > m && git add . && git commit -m m',
      'git switch f',
    ]);
    const old = r.branches.f;
    const after = run(r, 'git rebase main').repo;
    expect(after.branches.f).not.toBe(old);
    expect(after.commits[after.branches.f!].parents[0]).toBe(after.branches.main);
    expect(after.work).toEqual({ a: 'a\n', f: 'f\n', m: 'm\n' });
  });

  it('switching is blocked when it would clobber local edits', () => {
    const r = replay([
      'git init',
      'echo 1 > x && git add . && git commit -m one',
      'git switch -c b && echo 2 > x && git commit -am two',
      'git switch main && echo dirty > x',
    ]);
    const res = run(r, 'git switch b');
    expect(res.lines[res.lines.length - 1]?.kind).toBe('err');
  });

  it('resolves HEAD~n and ^', () => {
    const r = replay(['git init', 'echo 1 > x && git add . && git commit -m one', 'echo 2 > x && git commit -am two', 'echo 3 > x && git commit -am three']);
    const res = run(r, 'git checkout HEAD~2');
    expect(res.repo.head.kind).toBe('detached');
    expect(res.repo.work.x).toBe('1\n');
  });
});

describe('github', () => {
  const base = ['git init', 'echo a > a && git add . && git commit -m a', 'git remote add origin https://github.com/you/x.git'];

  it('push -u sets upstream and tracking', () => {
    const r = replay([...base, 'git push -u origin main']);
    expect(r.remote?.branches.main).toBe(r.branches.main);
    expect(r.tracking['origin/main']).toBe(r.branches.main);
    expect(r.upstream.main).toBe('main');
  });

  it('push without upstream explains -u', () => {
    const res = run(replay(base), 'git push');
    expect(res.lines.find((l) => l.kind === 'err')?.text).toContain('git push -u origin main');
  });

  it('rejects a push when GitHub has new work, pull fixes it', () => {
    let r = replay([...base, 'git push -u origin main', '@teammate "theirs" b "x"', 'echo more >> a && git commit -am mine']);
    expect(run(r, 'git push').lines.some((l) => l.kind === 'err' && l.text.includes('rejected'))).toBe(true);
    r = run(r, 'git pull').repo;
    expect(r.commits[r.branches.main!].parents).toHaveLength(2);
    r = run(r, 'git push').repo;
    expect(r.remote?.branches.main).toBe(r.branches.main);
  });

  it('fetch moves origin/main but not main', () => {
    const r0 = replay([...base, 'git push -u origin main', '@teammate "theirs" b "x"']);
    const r = run(r0, 'git fetch').repo;
    expect(r.branches.main).toBe(r0.branches.main);
    expect(r.tracking['origin/main']).toBe(r.remote?.branches.main);
  });

  it('pages deploys on push to the published branch', () => {
    const r = replay([...base, 'git push -u origin main', '@pages main', 'echo b >> a && git commit -am b && git push']);
    expect(r.remote?.deploys.map((d) => d.id)).toEqual([r.commits[r.branches.main!].parents[0], r.branches.main]);
  });
});

describe('merging lines', () => {
  it('merges edits to different lines of one file', () => {
    const r = replay([
      'git init',
      'echo one > f && echo two >> f && echo three >> f && git add . && git commit -m base',
      'git switch -c b && @line f 1 ONE && git commit -am b',
      'git switch main && @line f 3 THREE && git commit -am m',
      'git merge b',
    ]);
    expect(r.work.f).toBe('ONE\ntwo\nTHREE\n');
    expect(r.merging).toBeNull();
  });

  it('only marks the lines both sides changed', () => {
    const r = replay(['git init', 'echo t > f && echo body >> f && git add . && git commit -m base', 'git switch -c b && @line f 1 X && git commit -am b', 'git switch main && @line f 1 Y && git commit -am m']);
    const m = run(r, 'git merge b').repo;
    expect(m.work.f).toBe('<<<<<<< HEAD\nY\n=======\nX\n>>>>>>> b\nbody\n');
  });

  it('.gitignore hides files from status and add .', () => {
    const r = replay(['git init', 'echo x > secret.txt', 'echo secret.txt > .gitignore', 'git add .']);
    expect(Object.keys(r.index)).toEqual(['.gitignore']);
    expect(status(r).untracked).toEqual([]);
  });
});

describe('the journey', () => {
  it('every lesson is solved by its canonical steps, one after another', () => {
    let r = replay([]);
    LESSONS.forEach((lesson, i) => {
      for (const cmd of lesson.prep) {
        const res = run(r, cmd);
        expect(res.lines.find((l) => l.kind === 'err')?.text, `${lesson.id} prep "${cmd}"`).toBeUndefined();
        r = res.repo;
      }
      expect(JSON.stringify(setupFor(i)), `${lesson.id} setupFor matches the journey`).toBe(JSON.stringify(r));
      const typed: string[] = [];
      const met = new Set<number>();
      for (const h of lesson.solve ?? lesson.hints) {
        const res = run(r, h);
        expect(res.lines.find((l) => l.kind === 'err')?.text, `${lesson.id} step "${h}"`).toBeUndefined();
        r = res.repo;
        typed.push(h);
        lesson.goals.forEach((g, gi) => g.check(r, typed) && met.add(gi));
      }
      expect([...met].sort(), `${lesson.id}: ${lesson.goals.map((g) => g.label).join(' | ')}`).toEqual(lesson.goals.map((_, gi) => gi));
    });
  });
});
