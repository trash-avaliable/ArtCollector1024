import React, { forwardRef } from 'react';
import { thumbUrl, type Item } from '../types';

export const Toolbar = forwardRef<HTMLInputElement, {
  query: string; setQuery: (v: string) => void;
  tree: [string, string[]][]; counts: Record<string, number>;
  category: string | null; setCategory: (c: string | null) => void;
  dropCat: string | null; setDropCat: (c: string | null) => void;
  onDropOnCategory: (c: string) => void;
  onImport: () => void;
}>(function Toolbar(p, ref) {
  const { query, setQuery, tree, counts, category, setCategory, dropCat, setDropCat, onDropOnCategory, onImport } = p;
  return (
    <div className="toolbar">
      <div className="searchrow">
        <label className="searchbox">
          <svg width="14" height="14" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
          <input
            ref={ref}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索名字 / 拼音 / 首字母 / 分类，例：shoubu、sb、手部"
            spellCheck={false}
          />
          {query && <span className="kbd" onClick={() => setQuery('')} style={{ cursor: 'default' }}>清除</span>}
          {!query && <span className="kbd">ALT+SPACE</span>}
        </label>
        <button className="btn-import" onClick={onImport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.4" stroke="currentColor">
            <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
          </svg>
          导入图片
        </button>
      </div>
      <div className="chips">
        <button className={'chip' + (category === null ? ' on' : '')} onClick={() => setCategory(null)}>
          全部<span className="n">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
        </button>
        {tree.map(([cat]) => (
          <button
            key={cat}
            className={'chip' + (category === cat ? ' on' : '') + (dropCat === cat ? ' drop' : '')}
            onClick={() => setCategory(category === cat ? null : cat)}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropCat !== cat) setDropCat(cat); }}
            onDragLeave={() => setDropCat(null)}
            onDrop={e => { e.preventDefault(); setDropCat(null); onDropOnCategory(cat); }}
          >
            {cat}{counts[cat] ? <span className="n">{counts[cat]}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
});

export const Card = React.memo(function Card({
  it, idx, selected, dragging, onSelect, onOpen, onDragOut, onDragStart, onDragEnd
}: {
  it: Item; idx: number; selected: boolean; dragging: boolean;
  onSelect: (id: string) => void; onOpen: (id: string) => void;
  onDragOut: (id: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
}) {
  return (
    <article
      className={'card' + (selected ? ' sel' : '') + (dragging ? ' dragging' : '')}
      style={{ animationDelay: Math.min(idx * 60, 540) + 'ms' }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(it.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(it.id)}
      onDoubleClick={() => onOpen(it.id)}
    >
      <div className="frame">
        <img src={thumbUrl(it)} alt={it.name} loading="lazy" draggable={false} />
        <div className="shade" />
        <div
          className="pull"
          title="拖到 Photoshop / SAI 窗口即可插入"
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDragOut(it.id); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12h12M12 6l6 6-6 6M20 4v16" />
          </svg>
          拖入画布
        </div>
      </div>
      <div className="calib" />
      <div className="meta">
        <span className="idx">#{String(idx + 1).padStart(3, '0')}</span>
        <span className="nm" title={it.name}>{it.name}</span>
        <span className="cat">{it.subcategory || it.category}</span>
        <i className={'dot' + (it.favorite ? ' fav' : '')} />
      </div>
    </article>
  );
});

export function EmptyState({ query, onImport }: { query: string; onImport: () => void }) {
  return (
    <div className="empty">
      <div className="frame"><i /></div>
      <div className="t">{query ? 'NO MATCH' : '0 ITEMS'}</div>
      <div className="h">{query ? '换个关键词，或按拼音首字母试试' : '把图片拖进来，或点右下角导入'}</div>
      {!query && (
        <button className="btn-import" onClick={onImport} style={{ height: 44 }}>
          选择图片 / 文件夹
        </button>
      )}
    </div>
  );
}
