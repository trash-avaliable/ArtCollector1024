import { useEffect, useState } from 'react';
import { railSections } from '../lib/layout-registry';

export function TitleBar({ crumb, maximized, onSettings, dockHidden, onToggleDock }: {
  crumb: string; maximized: boolean; onSettings: () => void;
  /** 右栏收起态与切换钮（stage 一键吃满宽度） */
  dockHidden: boolean; onToggleDock: () => void;
}) {
  return (
    <div className="titlebar">
      <div className="brand">
        <i className="sq" />
        <span className="nm">REFCOLLECTOR</span>
      </div>
      <div className="crumb" title={crumb}>{crumb}</div>
      <div className="wctl">
        <button
          className={dockHidden ? 'tb-dock on' : 'tb-dock'}
          onClick={onToggleDock}
          title={dockHidden ? '显示检查器栏' : '收起检查器栏（stage 吃满宽度）'}
          aria-label={dockHidden ? '显示检查器栏' : '收起检查器栏'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.4">
            <rect x="3" y="4" width="18" height="16" />
            <path d="M15 4v16" />
          </svg>
        </button>
        <button onClick={onSettings} title="库设置">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.4">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
          </svg>
        </button>
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

export function StatusBar({ root, total, busy }: { root: string; total: number; busy: string }) {
  return (
    <footer className="status">
      <div className="st"><i className={root ? '' : 'off'} />{root ? '本地库已连接' : '库未就绪'}</div>
      <div className="sep" />
      <div className="mono">索引 <b>{total}</b> 项</div>
      <div className="path" title={root}>{root}</div>
      <div className="right">
        {busy && <div className="mono busy">{busy}</div>}
        <div className="mono"><b>ALT+SPACE</b> 唤起</div>
        <div className="mono"><b>双击</b> 大图</div>
        <div className="mono"><b>F2</b> 重命名</div>
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

/**
 * 悬浮工具胶囊：画布优先壳层的常驻入口。
 * 素材库面板收起时贴在画布左缘（悬浮），展开时让位给面板（整体左移淡出）。
 */
export function ToolCapsule({ open, active, onToggle, onSection, onCommand, onSettings }: {
  open: boolean; active: string; onToggle: () => void;
  onSection: (id: string) => void; onCommand: () => void; onSettings: () => void;
}) {
  return (
    <div className={'capsule' + (open ? ' away' : '')} role="toolbar" aria-label="快捷工具">
      <button
        className={'cap-btn cap-lib' + (open ? ' on' : '')}
        onClick={onToggle}
        title={open ? '收起素材库' : '展开素材库'}
        aria-label="素材库面板"
      >
        <svg width="15" height="15" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" /><path d="M9 4v16" /></svg>
      </button>
      <i className="cap-sep" />
      {railSections.list().map(s => (
        <button
          key={s.id}
          className={'cap-btn' + (active === s.id ? ' on' : '')}
          onClick={() => onSection(s.id)}
          title={`${s.en} / ${s.cn}`}
          aria-label={`${s.cn}面板`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24"><path d={s.icon} /></svg>
        </button>
      ))}
      <i className="cap-sep" />
      <button className="cap-btn" onClick={onCommand} title="命令面板（Ctrl+K）" aria-label="命令面板">
        <svg width="15" height="15" viewBox="0 0 24 24"><path d="M5 7l5 5-5 5M13 17h6" /></svg>
      </button>
      <button className="cap-btn" onClick={onSettings} title="库设置" aria-label="库设置">
        <svg width="15" height="15" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
        </svg>
      </button>
    </div>
  );
}
