import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { COMMAND_GROUP_LABEL, filterCommands, type CommandEntry } from '../lib/layout-registry';

/**
 * 全局命令面板（Ctrl+K）：未来功能的统一入口。
 * 条目来自 layout-registry.ts 的 commands 注册表 + App 拼装的动态条目（分类 / 画板）。
 * 风格：深色面板（--dock 渐变）+ 信号黄选中条，与 Select / importmenu 同族。
 */
export function CommandPalette({
  open, entries, onClose, onRun
}: {
  open: boolean;
  entries: CommandEntry[];
  onClose: () => void;
  onRun: (entry: CommandEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCommands(entries, query).slice(0, 50), [entries, query]);

  // 每次打开重置搜索态；关闭时不卸载内部状态也无妨（open=false 直接不渲染）
  useEffect(() => {
    if (open) { setQuery(''); setIdx(0); }
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => { setIdx(0); }, [query]);

  // 选中项始终滚进可视区（↑↓ 长列表时不跟丢）
  useEffect(() => {
    listRef.current?.querySelector('.cmditem.on')?.scrollIntoView({ block: 'nearest' });
  }, [idx, filtered.length]);

  if (!open) return null;

  const runAt = (i: number) => {
    const entry = filtered[i];
    if (entry) onRun(entry);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      runAt(idx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="cmdveil" onMouseDown={onClose}>
      <div className="cmdbar" role="dialog" aria-label="命令面板" onMouseDown={e => e.stopPropagation()}>
        <div className="cmdbox">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
            <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索命令：视图 / 分类 / 画板 / 导入 / 设置…"
            spellCheck={false}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmdlist" ref={listRef}>
          {filtered.map((entry, i) => (
            <button
              key={entry.def.id}
              className={'cmditem' + (i === idx ? ' on' : '')}
              onMouseEnter={() => setIdx(i)}
              onClick={() => runAt(i)}
            >
              <span className="cnm">{entry.def.title}</span>
              {entry.def.hint && <span className="chint">{entry.def.hint}</span>}
              <span className="cgrp">{COMMAND_GROUP_LABEL[entry.def.group]}</span>
            </button>
          ))}
          {!filtered.length && <div className="cmdempty">没有匹配的命令</div>}
        </div>
        <div className="cmdfoot">
          <span>↑↓ 选择</span><span>ENTER 执行</span><span>ESC 关闭</span>
          <span style={{ marginLeft: 'auto' }}>CTRL+K 开关</span>
        </div>
      </div>
    </div>
  );
}
