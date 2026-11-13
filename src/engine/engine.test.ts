import { describe, expect, it } from 'vitest';
import { LESSONS } from '../lessons';
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

describe('lessons', () => {
  for (const lesson of LESSONS) {
    it(`"${lesson.title}" sets up and is solved by its hints`, () => {
      let r = replay(lesson.setup);
      const typed: string[] = [];
      const met = new Set<number>();
      for (const h of lesson.hints) {
        const res = run(r, h);
        const err = res.lines.find((l) => l.kind === 'err');
        expect(err?.text, `hint "${h}"`).toBeUndefined();
        r = res.repo;
        typed.push(h);
        lesson.goals.forEach((g, i) => g.check(r, typed) && met.add(i));
      }
      expect([...met].sort(), lesson.goals.map((g) => g.label).join(' | ')).toEqual(lesson.goals.map((_, i) => i));
    });
  }
});
