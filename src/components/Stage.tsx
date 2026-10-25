import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl, type Item, type Sort } from '../types';
import { Select } from './Select';

const SORTS = [
  { value: 'new', label: '最近添加' },
  { value: 'old', label: '最早添加' },
  { value: 'name', label: '按名字' },
  { value: 'size', label: '按体积' }
];

export const Toolbar = forwardRef<HTMLInputElement, {
  query: string; setQuery: (v: string) => void;
  sort: Sort; setSort: (s: Sort) => void;
  category: string | null; cats: string[]; setCategory: (c: string | null) => void;
  colorFilter: string | null; onClearColor: () => void;
  onImport: () => void; onImportTo: (cat: string) => void;
}>(function Toolbar(p, ref) {
  const { query, setQuery, sort, setSort, category, cats, setCategory, colorFilter, onClearColor, onImport, onImportTo } = p;
  const [menu, setMenu] = useState(false);
  const mref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (!mref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  return (
    <div className="toolbar">
      <label className="searchbox">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" />
        </svg>
        <input
          ref={ref}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索名字 / 拼音 / 首字母 / 分类，例：shoubu、sb、手部"
          spellCheck={false}
        />
        {query
          ? <button className="kbd" onClick={() => setQuery('')}>清除</button>
          : <span className="kbd">ALT+SPACE</span>}
      </label>

      <div className="filterrow">
        {category && (
          <button className="fchip" onClick={() => setCategory(null)} title="清除分类筛选">
            分类：{category} <i>×</i>
          </button>
        )}
        {colorFilter && (
          <button className="fchip color" onClick={onClearColor} title="清除颜色筛选">
            <i className="sw" style={{ background: colorFilter }} />
            颜色 {colorFilter} <i>×</i>
          </button>
        )}
      </div>

      <div className="tb-right">
        <Select
          value={sort}
          options={SORTS}
          onChange={v => setSort(v as Sort)}
          size="md"
        />

        <div className="importwrap" ref={mref}>
          <button className="btn-import" onClick={onImport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" stroke="currentColor">
              <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
            </svg>
            导入
          </button>
          <button className="importmore" onClick={() => setMenu(m => !m)} title="导入到指定分类">▾</button>
          {menu && (
            <div className="importmenu">
              <button onClick={() => { setMenu(false); onImport(); }}>导入到「待分类」</button>
              <div className="imlbl">导入到分类</div>
              {cats.map(c => (
                <button key={c} onClick={() => { setMenu(false); onImportTo(c); }}>{c}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ---------------- 交错瀑布流 ---------------- */

function useWidth(ref: React.RefObject<HTMLDivElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(es => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function Masonry({
  items, fadeKey, selectedIds, draggingId, onSelect, onOpen, onDragOut, onDragStart, onDragEnd
}: {
  items: Item[]; fadeKey: string; selectedIds: Set<string>; draggingId: string | null;
  onSelect: (id: string, e: React.MouseEvent) => void; onOpen: (id: string) => void;
  onDragOut: (id: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);

  const colCount = width >= 1180 ? 4 : width >= 640 ? 3 : width >= 420 ? 2 : 1;

  const columns = useMemo(() => {
    const buckets: Item[][] = Array.from({ length: colCount }, () => []);
    const heights = new Array(colCount).fill(0);
    for (const it of items) {
      let k = 0;
      for (let i = 1; i < colCount; i++) if (heights[i] < heights[k] - 0.001) k = i;
      buckets[k].push(it);
      const ratio = it.w > 0 && it.h > 0 ? it.h / it.w : 1.25;
      heights[k] += Math.min(ratio, 3) + 0.22;
    }
    return buckets;
  }, [items, colCount]);

  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, i) => m.set(it.id, i));
    return m;
  }, [items]);

  return (
    <div className="masonry" ref={ref} key={fadeKey} data-cols={colCount}>
      {columns.map((col, ci) => (
        <div className="mcol" key={ci}>
          {col.map((it, ri) => (
            <Card
              key={it.id}
              it={it}
              idx={indexOf.get(it.id) ?? 0}
              delay={Math.min(ri * 30 + ci * 15, 200)}
              selected={selectedIds.has(it.id)}
              dragging={draggingId === it.id}
              onSelect={onSelect}
              onOpen={onOpen}
              onDragOut={onDragOut}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export const Card = React.memo(function Card({
  it, idx, delay, selected, dragging, onSelect, onOpen, onDragOut, onDragStart, onDragEnd
}: {
  it: Item; idx: number; delay: number; selected: boolean; dragging: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void; onOpen: (id: string) => void;
  onDragOut: (id: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
}) {
  return (
    <article
      className={'card' + (selected ? ' sel' : '') + (dragging ? ' dragging' : '')}
      style={{ animationDelay: delay + 'ms' }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(it.id);
      }}
      onDragEnd={onDragEnd}
      onClick={e => onSelect(it.id, e)}
      onDoubleClick={() => onOpen(it.id)}
    >
      <div className="frame">
        <img src={thumbUrl(it)} alt={it.name} loading="lazy" draggable={false} />
        <div
          className="pull"
          title="按住拖到 Photoshop / SAI 窗口即可插入原图"
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDragOut(it.id); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12h12M12 6l6 6-6 6M20 4v16" />
          </svg>
          拖入画布
        </div>
      </div>
      <div className="info">
        <div className="r1">
          <span className="fn" title={it.name}>{it.name}</span>
          <i className={'star' + (it.favorite ? ' on' : '')} title={it.favorite ? '已收藏' : '未收藏'}>★</i>
        </div>
        <div className="r2">
          <span className="tag">{it.subcategory || it.category}</span>
          <i className="idx">#{String(idx + 1).padStart(3, '0')}</i>
        </div>
      </div>
    </article>
  );
});

export function BatchBar({
  count, cats, onCategory, onFav, onDragOut, onDelete, onClear
}: {
  count: number; cats: string[];
  onCategory: (c: string) => void; onFav: () => void; onDragOut: () => void;
  onDelete: () => void; onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="batchbar">
      <div className="bcount"><b>{count}</b> 张已选</div>
      <div className="bsep" />
      <Select
        value={null}
        placeholder="改分类到…"
        options={cats.map(c => ({ value: c, label: c }))}
        onChange={onCategory}
        size="sm"
      />
      <button onClick={onFav}>收藏</button>
      <button onClick={onDragOut}>拖出</button>
      <button className="danger" onClick={onDelete}>删除</button>
      <button className="bclose" onClick={onClear}>取消选择</button>
    </div>
  );
}

export function EmptyState({ query, onImport }: { query: string; onImport: () => void }) {
  return (
    <div className="empty">
      <div className="frame"><i /></div>
      <div className="t">{query ? 'NO MATCH' : '0 ITEMS'}</div>
      <div className="h">{query ? '换个关键词，或按拼音首字母试试' : '把图片拖进来，或点右上角导入'}</div>
      {!query && <button className="btn-import" onClick={onImport} style={{ height: 40 }}>选择图片 / 文件夹</button>}
    </div>
  );
}
