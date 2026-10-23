import React, { useEffect, useRef, useState } from 'react';
import type { Stats, View } from '../types';

const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={1.3}
    strokeLinecap="square" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);

export function TitleBar({ root, maximized }: { root: string; maximized: boolean }) {
  return (
    <div className="titlebar">
      <div className="brand">
        <i className="sq" />
        <span className="nm">REFCOLLECTOR</span>
        <span className="cn">参考图收集器</span>
      </div>
      <div className="pathline" title={root}>{root || '正在初始化库…'}</div>
      <div className="wctl">
        <button onClick={() => window.api.win.minimize()} title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" /></svg>
        </button>
        <button onClick={() => window.api.win.toggleMax()} title={maximized ? '还原' : '最大化'}>
          {maximized
            ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3.5 3.5h5v5h-5z" /><path d="M5 3.5V2h5v5H8.5" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5h7v7h-7z" /></svg>}
        </button>
        <button className="close" onClick={() => window.api.win.close()} title="收进托盘">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { key: 'inbox', label: '收件箱', icon: 'M3 4h18v10H3zM3 14l4-4M21 14l-4-4M8 20h8' },
  { key: 'fav', label: '收藏', icon: 'M12 3l3 6 6 1-4.5 4.2 1 6-5.5-3-5.5 3 1-6L3 10l6-1z' },
  { key: 'recent', label: '最近', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3.5 2' }
];

export function Rail({ view, setView, stats }: { view: View; setView: (v: View) => void; stats: Stats }) {
  const count = (k: View) => (k === 'inbox' ? stats.inbox : k === 'fav' ? stats.fav : 0);
  return (
    <nav className="rail">
      {NAV.map(n => (
        <button key={n.key} className={view === n.key ? 'on' : ''} onClick={() => setView(n.key)} title={n.label}>
          <Ico d={n.icon} />
          <span>{n.label}</span>
          {count(n.key) > 0 && <b className="badge">{count(n.key) > 99 ? '99+' : count(n.key)}</b>}
        </button>
      ))}
      <div className="spacer" />
      <button onClick={() => window.api.lib.openRoot()} title="打开库目录">
        <Ico d="M3 7h7l2 2h9v10H3z" />
        <span>库目录</span>
      </button>
    </nav>
  );
}

export function StatusBar({ root, total, busy }: { root: string; total: number; busy: string }) {
  return (
    <footer className="status">
      <div className="st"><i className={root ? '' : 'off'} />本地库{root ? '已连接' : '未就绪'}</div>
      <div className="sep" />
      <div className="mono">索引 <b>{total}</b> 项</div>
      <div className="sep" />
      <div className="mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{root}</div>
      <div className="right">
        {busy && <div className="mono" style={{ color: '#fffa00' }}>{busy}</div>}
        <div className="mono">ALT+SPACE 唤起</div>
        <div className="mono">双击卡片 大图</div>
        <div className="mono">拖「拖入画布」到 PS</div>
      </div>
    </footer>
  );
}

const EDGES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

export function ResizeHandles() {
  return (
    <>
      {EDGES.map(edge => (
        <div
          key={edge}
          className={'resize ' + edge}
          onPointerDown={(e) => {
            e.preventDefault();
            const el = e.currentTarget as HTMLElement;
            el.setPointerCapture(e.pointerId);
            let lx = e.screenX, ly = e.screenY;
            let dx = 0, dy = 0, raf = 0;
            const flush = () => {
              raf = 0;
              if (dx || dy) { window.api.win.resizeBy(edge, dx, dy); dx = 0; dy = 0; }
            };
            const move = (ev: PointerEvent) => {
              dx += ev.screenX - lx; dy += ev.screenY - ly;
              lx = ev.screenX; ly = ev.screenY;
              if (!raf) raf = requestAnimationFrame(flush);
            };
            const up = () => {
              if (raf) { cancelAnimationFrame(raf); flush(); }
              el.removeEventListener('pointermove', move);
              el.removeEventListener('pointerup', up);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
          }}
        />
      ))}
    </>
  );
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useFocusSearch(cb: () => void) {
  useEffect(() => window.api.on.focusSearch(cb), []);
}
