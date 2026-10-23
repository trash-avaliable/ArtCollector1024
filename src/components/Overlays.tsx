import { useEffect, useRef, useState } from 'react';
import { origUrl, type ClipInfo, type Item, type Toast } from '../types';

export function Lightbox({ item, onClose }: { item: Item; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <img
        src={origUrl(item)}
        alt={item.name}
        style={{ transform: `scale(${zoom})` }}
        onClick={e => e.stopPropagation()}
        onWheel={e => {
          e.preventDefault();
          setZoom(z => Math.min(6, Math.max(0.2, z - e.deltaY * 0.0015)));
        }}
      />
      <div className="hud" onClick={e => e.stopPropagation()}>
        <b>{item.name}</b>
        <span>{item.w}×{item.h}</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span style={{ marginLeft: 'auto' }}>滚轮缩放 · 0 复位 · ESC 关闭</span>
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
