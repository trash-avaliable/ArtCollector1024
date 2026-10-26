import { useRef, useState, type DragEvent } from 'react';
import type { Stats, Tree, View } from '../types';

const RAIL_MIME = 'application/x-rail';

export const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'all', label: '全部素材', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { key: 'inbox', label: '待分类', icon: 'M3 4h18v10H3zM3 14l4-4M21 14l-4-4M8 20h8' },
  { key: 'fav', label: '收藏', icon: 'M12 3l3 6 6 1-4.5 4.2 1 6-5.5-3-5.5 3 1-6L3 10l6-1z' },
  { key: 'recent', label: '最近浏览', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3.5 2' },
  { key: 'trash', label: '回收站', icon: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6' }
];

const Ico = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.4"
    strokeLinecap="square" strokeLinejoin="miter"><path d={d} /></svg>
);

type DragRef = { kind: 'view' | 'cat'; key: string };

export function Rail({
  view, setView, stats, tree, counts, category, setCategory, sub, setSub,
  railViews, railCats, onReorder, dropCat, setDropCat, onDropOnCategory, onDropOnSub,
  onOpenRoot, onAddCat, onRenameCat, onDropCat
}: {
  view: View; setView: (v: View) => void; stats: Stats; tree: Tree;
  counts: Record<string, number>; category: string | null; setCategory: (c: string | null) => void;
  sub: string | null; setSub: (s: string | null) => void;
  railViews: View[]; railCats: string[];
  onReorder: (kind: 'view' | 'cat', from: string, to: string) => void;
  dropCat: string | null; setDropCat: (c: string | null) => void;
  onDropOnCategory: (c: string) => void;
  onDropOnSub: (c: string, s: string) => void;
  onOpenRoot: () => void;
  onAddCat: (name: string) => void;
  onRenameCat: (from: string, to: string) => void;
  onDropCat: (name: string) => void;
}) {
  const dragRef = useRef<DragRef | null>(null);
  const [drag, setDrag] = useState<DragRef | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const views = (railViews.length ? railViews : NAV.map(n => n.key)).filter(k => k !== 'trash');
  const cats = railCats.length ? railCats : tree.map(([c]) => c);

  const toggleOpen = (c: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const railDragProps = (kind: 'view' | 'cat', key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(RAIL_MIME, key);
      dragRef.current = { kind, key };
      setDrag({ kind, key });
    },
    onDragOver: (e: DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes(RAIL_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
        return;
      }
      if (kind === 'cat' && types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropCat !== key) setDropCat(key);
      }
    },
    onDragLeave: () => {
      setOver(o => (o === key ? null : o));
      if (kind === 'cat' && dropCat === key) setDropCat(null);
    },
    onDrop: (e: DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      const src = dragRef.current;
      if (types.includes(RAIL_MIME) && src) {
        e.preventDefault();
        e.stopPropagation();
        onReorder(src.kind, src.key, key);
      } else if (kind === 'cat' && types.includes('text/plain')) {
        e.preventDefault();
        e.stopPropagation();
        setDropCat(null);
        onDropOnCategory(key);
      }
      setOver(null);
    },
    onDragEnd: () => {
      dragRef.current = null;
      setDrag(null);
      setOver(null);
      setDropCat(null);
    }
  });

  const commitAdd = () => {
    const v = newName.trim();
    if (v) onAddCat(v);
    setNewName('');
    setAdding(false);
  };

  return (
    <nav className="rail">
      <div className="raillbl">VIEW / 视图</div>
      {views.map(k => {
        const meta = NAV.find(n => n.key === k);
        if (!meta) return null;
        const n = k === 'all' ? stats.total : k === 'inbox' ? stats.inbox : k === 'fav' ? stats.fav : 0;
        return (
          <div
            key={k}
            className={'navitem' + (view === k && !category ? ' on' : '') + (over === k ? ' over' : '') + (drag?.key === k ? ' dragging' : '')}
            onClick={() => { setView(k); setSub(null); }}
            title={meta.label}
            {...railDragProps('view', k)}
          >
            <i className="ico"><Ico d={meta.icon} /></i>
            <span>{meta.label}</span>
            {k === 'inbox' && n > 0 && <i className="alertdot" />}
            <i className="cnt">{k === 'recent' ? '' : n}</i>
          </div>
        );
      })}

      <div
        className={'navitem trashitem' + (view === 'trash' ? ' on' : '')}
        onClick={() => { setView('trash'); setCategory(null); setSub(null); }}
        title="回收站：删掉的图还在这里，可以恢复"
      >
        <i className="ico"><Ico d={NAV[4].icon} /></i>
        <span>回收站</span>
        <i className="cnt">{stats.trash || ''}</i>
      </div>

      <div className="raildiv" />
      <div className="raillbl">
        <span>CATEGORY / 分类</span>
        <button className="railadd" onClick={() => setAdding(a => !a)} title="新建分类">＋</button>
      </div>

      {adding && (
        <div className="catadd">
          <input
            autoFocus
            value={newName}
            placeholder="新分类名称"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
            onBlur={commitAdd}
          />
        </div>
      )}

      <div className="cats">
        {cats.map(c => {
          const subs = tree.find(([n]) => n === c)?.[1] || [];
          const isOpen = open.has(c);
          const active = category === c && !sub;
          return (
            <div className="catblock" key={c}>
              <div
                className={'cat' + (active ? ' on' : '') + (over === c ? ' over' : '')
                  + (dropCat === c ? ' drop' : '') + (drag?.key === c ? ' dragging' : '')}
                onClick={() => { if (editing !== c) { setCategory(category === c && !sub ? null : c); setSub(null); } }}
                title={c}
                {...railDragProps('cat', c)}
              >
                {editing === c ? (
                  <input
                    className="catrename"
                    autoFocus
                    value={draft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { onRenameCat(c, draft.trim() || c); setEditing(null); }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <button
                      className={'caret' + (isOpen ? ' open' : '') + (subs.length ? '' : ' none')}
                      onClick={e => { e.stopPropagation(); if (subs.length) toggleOpen(c); }}
                      title={subs.length ? (isOpen ? '收起子类' : `展开 ${subs.length} 个子类`) : '没有子类'}
                    >▸</button>
                    <span className="nm">{c}</span>
                    <i className="cnt">{counts[c] || ''}</i>
                    <span className="cattools">
                      <button title="改名" onClick={e => { e.stopPropagation(); setEditing(c); setDraft(c); }}>✎</button>
                      <button title="删除分类（图不会删，退回待分类）" onClick={e => { e.stopPropagation(); onDropCat(c); }}>×</button>
                    </span>
                  </>
                )}
              </div>
              {isOpen && subs.length > 0 && (
                <div className="subs">
                  {subs.map(s => (
                    <div
                      key={s}
                      className={'catsub' + (category === c && sub === s ? ' on' : '') + (dropCat === c + '/' + s ? ' drop' : '')}
                      title={`只看「${c} / ${s}」`}
                      onClick={() => { setCategory(c); setSub(s); }}
                      onDragOver={e => {
                        if (Array.from(e.dataTransfer.types).includes('text/plain')) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropCat(c + '/' + s);
                        }
                      }}
                      onDragLeave={() => setDropCat(null)}
                      onDrop={e => {
                        if (Array.from(e.dataTransfer.types).includes('text/plain')) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropCat(null);
                          onDropOnSub(c, s);
                        }
                      }}
                    >
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="railfoot">
        <button className="railbtn" onClick={onOpenRoot} title="在资源管理器中打开库目录">
          <Ico d="M3 7h7l2 2h9v10H3z" />
          <span>打开库目录</span>
        </button>
      </div>
    </nav>
  );
}
