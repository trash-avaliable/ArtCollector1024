import { useEffect, useRef, useState } from 'react';
import { animLabel, cropImgStyle, cropOf, origUrl, type ClipInfo, type Item, type Toast } from '../types';

export function Lightbox({
  item, onClose, onNav
}: {
  item: Item; onClose: () => void; onNav: (dir: -1 | 1) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [pick, setPick] = useState<{ hex: string; x: number; y: number } | null>(null);
  const [altDown, setAltDown] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); setPick(null); }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '0') { setZoom(1); setPos({ x: 0, y: 0 }); }
      if (e.key === 'ArrowLeft') onNav(-1);
      if (e.key === 'ArrowRight') onNav(1);
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(6, z * 1.15));
      if (e.key === '-') setZoom(z => Math.max(0.2, z / 1.15));
      if (e.key === 'Alt') { e.preventDefault(); setAltDown(true); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltDown(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [onClose, onNav]);

  const doPick = async (clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // img 元素始终是完整原图（含白边），按比例映射回原始像素
    const rx = (clientX - r.left) / r.width;
    const ry = (clientY - r.top) / r.height;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;
    const W = item.cw || item.w, H = item.ch || item.h;
    const c = await window.api.lib.pickColor({ id: item.id, x: rx * W, y: ry * H });
    if (c) setPick(c);
  };

  // 裁白边显示：外层容器只露出内容区，内层原图用负偏移把白边推出视口
  // （裁剪计算收在 types.ts 的 cropOf / cropImgStyle，检查器预览共用同一份逻辑）
  const crop = cropOf(item);
  const cropStyle = cropImgStyle(item);
  const anim = animLabel(item);
  const W = crop.W, H = crop.H;

  return (
    <div className="lightbox" onClick={onClose}>
      <div
        className={'lbstage' + (altDown ? ' picking' : '')}
        style={crop.cropped ? {
          aspectRatio: `${item.w} / ${item.h}`,
          width: `min(92vw, calc(86vh * ${item.w / Math.max(1, item.h)}))`
        } : undefined}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.stopPropagation(); setZoom(1); setPos({ x: 0, y: 0 }); }}
        onWheel={e => {
          e.preventDefault();
          setZoom(z => Math.min(6, Math.max(0.2, z - e.deltaY * 0.0015)));
        }}
      >
        <img
          ref={imgRef}
          src={origUrl(item)}
          alt={item.name}
          style={{ ...(cropStyle || {}), transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` }}
          draggable={false}
          onClick={e => {
            e.stopPropagation();
            if (e.altKey) doPick(e.clientX, e.clientY);
          }}
          onPointerDown={e => {
            if (e.altKey || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
          }}
          onPointerMove={e => {
            const d = drag.current;
            if (!d) return;
            setPos({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        />
      </div>

      <button className="lbnav prev" onClick={e => { e.stopPropagation(); onNav(-1); }} title="上一张 ←">‹</button>
      <button className="lbnav next" onClick={e => { e.stopPropagation(); onNav(1); }} title="下一张 →">›</button>

      {pick && (
        <div className="pickhud" onClick={e => e.stopPropagation()}>
          <i style={{ background: pick.hex }} />
          <b>{pick.hex}</b>
          <button onClick={() => navigator.clipboard?.writeText(pick.hex)}>复制</button>
          <button className="x" onClick={() => setPick(null)}>×</button>
        </div>
      )}

      <div className="hud" onClick={e => e.stopPropagation()}>
        {anim && <span className="animchip" title="动图：灯箱里直接播放">{anim}</span>}
        <b>{item.name}</b>
        <span>{item.w}×{item.h}</span>
        {crop.cropped && <span>已裁白边（原图 {W}×{H}）</span>}
        <span>{Math.round(zoom * 100)}%</span>
        <span style={{ marginLeft: 'auto' }}>拖拽平移 · 滚轮缩放 · Alt 点图取色 · ← → 切换 · 0 复位 · ESC 关闭</span>
      </div>
    </div>
  );
}

export function ToastBar({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="toast">
      <span className="msg">{toast.msg}</span>
      {toast.undo && <button onClick={() => { toast.undo!(); onClose(); }}>撤销</button>}
    </div>
  );
}

export function ClipCard({ clip, onSave, onIgnore }: { clip: ClipInfo; onSave: () => void; onIgnore: () => void }) {
  return (
    <div className="clipcard">
      <div className="hd"><i />检测到剪贴板图片</div>
      <img src={clip.dataUrl} alt="clipboard" />
      <div className="ft">
        <button className="save" onClick={onSave}>存下</button>
        <button onClick={onIgnore}>忽略</button>
      </div>
    </div>
  );
}

export function DropVeil() {
  return (
    <div className="dropveil">
      <div className="inner">
        <div className="big">DROP TO COLLECT</div>
        <div className="sub">松手即入库 · 自动分类 · 重复图自动跳过</div>
      </div>
    </div>
  );
}

export function Ghost({ x, y, count }: { x: number; y: number; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="ghost" ref={ref} style={{ left: x, top: y }}>
      <div className="gm">×{count} 张 · 松手改判</div>
    </div>
  );
}
