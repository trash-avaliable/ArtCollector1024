import { useEffect, useRef, useState } from 'react';

export type Opt = { value: string; label: string; hint?: string };

export function Select({
  value, options, onChange, placeholder = '请选择', align = 'left', size = 'md'
}: {
  value: string | null;
  options: Opt[];
  onChange: (v: string) => void;
  placeholder?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cur = options.find(o => o.value === value);

  return (
    <div className={'sel ' + size + (open ? ' open' : '')} ref={ref}>
      <button type="button" className="sel-btn" onClick={() => setOpen(o => !o)}>
        <span className={cur ? '' : 'ph'}>{cur ? cur.label : placeholder}</span>
        {cur?.hint && <i className="hint">{cur.hint}</i>}
        <i className="car" />
      </button>
      {open && (
        <div className={'sel-pop ' + align}>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={'sel-item' + (o.value === value ? ' on' : '')}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.hint && <i>{o.hint}</i>}
            </button>
          ))}
          {!options.length && <div className="sel-empty">没有可选项</div>}
        </div>
      )}
    </div>
  );
}
