import { useEffect, useRef, useState } from 'react';
import type { Line } from '../engine/shell';

interface Props {
  lines: Line[];
  prompt: string;
  words: string[];
  onRun: (cmd: string) => void;
  draft: { text: string; key: number };
}

export function Terminal({ lines, prompt, words, onRun, draft }: Props) {
  const [value, setValue] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (!draft.key) return;
    setValue(draft.text);
    input.current?.focus();
  }, [draft]);

  const submit = () => {
    const cmd = value.trim();
    setValue('');
    setPos(-1);
    if (cmd) setHist((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]));
    onRun(cmd);
  };

  const complete = () => {
    const m = /(\S*)$/.exec(value)!;
    const stem = m[1];
    if (!stem) return;
    const hits = [...new Set(words)].filter((w) => w.startsWith(stem) && w !== stem);
    if (!hits.length) return;
    let common = hits[0];
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    const add = hits.length === 1 ? hits[0] + ' ' : common;
    setValue(value.slice(0, value.length - stem.length) + add);
  };

  return (
    <div className="terminal" onClick={() => window.getSelection()?.isCollapsed && input.current?.focus()}>
      <div className="term-bar">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span>terminal</span>
      </div>
      <div className="term-body" ref={scroll}>
        {lines.map((l, i) =>
          l.kind === 'cmd' ? (
            <div key={i} className="ln ln-cmd">
              <span className="prompt">{l.text.split('\u0000')[0]}</span>
              {l.text.split('\u0000')[1]}
            </div>
          ) : (
            <div key={i} className={`ln ln-${l.kind}`}>
              {l.kind === 'explain' ? '▸ ' : ''}
              {l.text}
            </div>
          ),
        )}
        <div className="ln ln-input">
          <span className="prompt">{prompt}</span>
          <input
            ref={input}
            value={value}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Command"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Tab') {
                e.preventDefault();
                complete();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!hist.length) return;
                const p = pos < 0 ? hist.length - 1 : Math.max(0, pos - 1);
                setPos(p);
                setValue(hist[p]);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (pos < 0) return;
                const p = pos + 1;
                if (p >= hist.length) {
                  setPos(-1);
                  setValue('');
                } else {
                  setPos(p);
                  setValue(hist[p]);
                }
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault();
                onRun('clear');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
