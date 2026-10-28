import React, { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animLabel, thumbUrl, type Item, type Sort, type Workset } from '../types';
import { cardAspectRatio } from '../lib/aspect';
import { boxHitsRect } from '../lib/boxhit';
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
  category: string | null; sub: string | null; cats: string[]; setCategory: (c: string | null) => void;
  colorFilter: string | null; onClearColor: () => void;
  simLabel?: string | null; onClearSim?: () => void;
  worksetLabel?: string | null; onClearWorkset?: () => void;
  onImport: () => void; onImportTo: (cat: string) => void;
  onCapture?: () => void;
  onClipInbox?: () => void;
}>(function Toolbar(p, ref) {
  const { query, setQuery, sort, setSort, category, sub, cats, setCategory, colorFilter, onClearColor, onImport, onImportTo, onCapture, simLabel, onClearSim, worksetLabel, onClearWorkset, onClipInbox } = p;
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
        {simLabel && (
          <button className="fchip sim" onClick={onClearSim} title="退出相似图">
            相似于：{simLabel} <i>×</i>
          </button>
        )}
        {worksetLabel && (
          <button className="fchip ws" onClick={onClearWorkset} title="退出画板视图">
            画板：{worksetLabel} <i>×</i>
          </button>
        )}
        {category && (
          <button className="fchip" onClick={() => setCategory(null)} title="清除分类筛选">
            分类：{category}{sub ? ` / ${sub}` : ''} <i>×</i>
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
        {onCapture && (
          <button className="btn-capture" onClick={onCapture} title="内置网页采集 agent：一句话描述想要什么，缺要素会反问；遵守 robots.txt、诚实 UA、不带 Cookie">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 2.6 2.8 15.4 0 18M12 3c-2.8 2.6-2.8 15.4 0 18" />
            </svg>
            采集
          </button>
        )}
        {onClipInbox && (
          <button className="btn-clip-inbox" onClick={onClipInbox} title="对当前待分类的图逐张跑 CLIP 零样本分类，达标才写库">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="4" y="4" width="16" height="16" /><path d="M9 4v4M15 4v4M4 9h16M9 13l2 3 4-5" />
            </svg>
            AI 分类全部待分类
          </button>
        )}
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
  // 观察父级 .gridwrap 而不是自己：masonry 带 key，换筛选时会重建，
  // 观察自己会在卸载瞬间收到 0 宽回调，列数被压成 1 列。
  useLayoutEffect(() => {
    const el = ref.current?.parentElement || ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(es => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

export function Masonry({
  items, fadeKey, animateIn, selectedIds, draggingId, onSelect, onOpen, onDragOut, onDragStart, onDragEnd, onBoxSelect
}: {
  items: Item[]; fadeKey: string; animateIn?: boolean; selectedIds: Set<string>; draggingId: string | null;
  onSelect: (id: string, e: React.MouseEvent) => void; onOpen: (id: string) => void;
  onDragOut: (id: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
  onBoxSelect: (ids: string[], additive: boolean) => void;
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

  /* ---- 橡皮筋框选 ---- */
  const [box, setBox] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);
  const startRef = useRef<{ x: number; y: number; add: boolean; moved: boolean } | null>(null);

  const pushBox = (b: Box | null) => { boxRef.current = b; setBox(b); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.card') || t.closest('button')) return;
    startRef.current = { x: e.clientX, y: e.clientY, add: e.ctrlKey || e.metaKey || e.shiftKey, moved: false };
    pushBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) return;
    s.moved = true;
    pushBox({ x0: s.x, y0: s.y, x1: e.clientX, y1: e.clientY });
  };

  const onPointerUp = () => {
    const s = startRef.current;
    // 用 ref 而不是 state：快速甩动时 pointerup 可能早于 React 提交，读 state 会拿到起点
    const b = boxRef.current;
    startRef.current = null;
    pushBox(null);
    if (!s) return;
    if (!s.moved) { onBoxSelect([], s.add); return; }  // 空白处点一下 = 取消选择
    if (!b || !ref.current) return;
    const hit: string[] = [];
    ref.current.querySelectorAll<HTMLElement>('[data-id]').forEach(el => {
      const r = el.getBoundingClientRect();
      // 几何命中抽成纯函数（RTM-S9），box 任意对角顺序都成立
      if (boxHitsRect(b, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })) {
        const id = el.dataset.id;
        if (id) hit.push(id);
      }
    });
    onBoxSelect(hit, s.add);
  };

  const rect = box ? {
    left: Math.min(box.x0, box.x1),
    top: Math.min(box.y0, box.y1),
    width: Math.abs(box.x1 - box.x0),
    height: Math.abs(box.y1 - box.y0)
  } : null;

  return (
    <>
      <div
        className="masonry"
        ref={ref}
        key={fadeKey}
        data-cols={colCount}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {columns.map((col, ci) => (
          <div className="mcol" key={ci}>
            {col.map((it, ri) => (
              <Card
                key={it.id}
                it={it}
                idx={indexOf.get(it.id) ?? 0}
                delay={animateIn ? Math.min(ri * 30 + ci * 15, 200) : 0}
                animate={animateIn !== false}
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
      {rect && rect.width > 2 && createPortal(
        <div className="rubber" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />,
        document.body
      )}
    </>
  );
}

export const Card = React.memo(function Card({
  it, idx, delay, animate, selected, dragging, onSelect, onOpen, onDragOut, onDragStart, onDragEnd
}: {
  it: Item; idx: number; delay: number; animate: boolean; selected: boolean; dragging: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void; onOpen: (id: string) => void;
  onDragOut: (id: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
}) {
  // 占位比例：it.w/it.h 已是裁白边后的内容尺寸（缩略图同比例），解码前预留高度用
  const ratio = cardAspectRatio(it);
  return (
    <article
      className={'card' + (animate ? '' : ' still') + (selected ? ' sel' : '') + (dragging ? ' dragging' : '') + (it.deletedAt ? ' gone' : '')}
      data-id={it.id}
      style={animate ? { animationDelay: delay + 'ms' } : undefined}
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
      <div className="frame" style={{ aspectRatio: ratio }}>
        <img src={thumbUrl(it)} alt={it.name} loading="lazy" decoding="async" draggable={false} />
        {animLabel(it) && <span className="animchip">{animLabel(it)}</span>}
        <div
          className="pull"
          title="按住拖到 Photoshop / SAI 窗口即可插入原图"
          onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation(); onDragOut(it.id);
          }}
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
          {typeof it.simScore === 'number' && <span className="sim">≈{Math.round(it.simScore * 100)}%</span>}
          <i className="idx">#{String(idx + 1).padStart(3, '0')}</i>
        </div>
      </div>
    </article>
  );
});

export function BatchBar({
  count, cats, worksets, mode, wsActive,
  onCategory, onAddToWorkset, onRemoveFromWorkset,
  onFav, onDragOut, onDelete, onClear, onRestore, onPurge, onPurgeAll, onTrim, onClip
}: {
  count: number; cats: string[]; worksets: Workset[]; mode: 'normal' | 'trash'; wsActive: boolean;
  onCategory: (c: string) => void; onAddToWorkset: (wsId: string) => void; onRemoveFromWorkset: () => void;
  onFav: () => void; onDragOut: () => void;
  onDelete: () => void; onClear: () => void;
  onRestore: () => void; onPurge: () => void; onPurgeAll: () => void;
  onTrim: () => void; onClip?: () => void;
}) {
  if (!count) return null;
  return (
    <div className="batchbar" data-mode={mode}>
      <div className="bcount"><b>{count}</b> 张已选</div>
      <div className="bsep" />
      {mode === 'trash' ? (
        <>
          <button className="primary" onClick={onRestore}>恢复</button>
          <button className="danger" onClick={onPurge}>彻底删除</button>
          <button onClick={onPurgeAll}>清空回收站</button>
        </>
      ) : (
        <>
          <button className="primary" onClick={onClip} title="用 CLIP 模型零样本分类选中的图：每张算图像 embedding，与分类的文本 embedding 比余弦，top-1 且分数达标才写库">
            AI 分类
          </button>
          <Select
            value={null}
            placeholder="改分类到…"
            options={cats.map(c => ({ value: c, label: c }))}
            onChange={onCategory}
            size="sm"
          />
          <Select
            value={null}
            placeholder="加入画板…"
            options={worksets.map(w => ({ value: w.id, label: w.name, hint: String(w.count || '') }))}
            onChange={onAddToWorkset}
            size="sm"
          />
          {wsActive && <button onClick={onRemoveFromWorkset} title="把选中的图从当前画板移出（图片保留在库里）">移出画板</button>}
          <button onClick={onFav}>收藏</button>
          <button
            title="按住不放，拖到 Photoshop / SAI 窗口里插入原图"
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              onDragOut();
            }}
          >拖出</button>
          <button onClick={onTrim} title="自动检测并裁掉图片四周的白边，原图文件不动">裁白边</button>
          <button className="danger" onClick={onDelete}>删除</button>
        </>
      )}
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
