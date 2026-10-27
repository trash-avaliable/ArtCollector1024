import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { isCollapsed, railSections, type CollapseState, type RailSectionDef } from '../lib/layout-registry';
import type { Note, Stats, Tree, View, Workset } from '../types';

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

const CHEV_L = 'M14 6l-6 6 6 6';
const CHEV_R = 'M10 6l6 6-6 6';

type DragRef = { kind: 'view' | 'cat'; key: string };

export function Rail({
  view, setView, stats, tree, counts, category, setCategory, sub, setSub,
  railViews, railCats, onReorder, dropCat, setDropCat, onDropOnCategory, onDropOnSub,
  onAddCat, onRenameCat, onDropCat,
  worksets, wsFilter, onPickWorkset, onAddWorkset, onRenameWorkset, onDeleteWorkset, onDropOnWorkset,
  notes, activeNoteId, onPickNote, onAddNote, onRenameNote, onDeleteNote, onPinNote,
  railMini, onToggleRailMini, sectionCollapsed, onToggleSection
}: {
  view: View; setView: (v: View) => void; stats: Stats; tree: Tree;
  counts: Record<string, number>; category: string | null; setCategory: (c: string | null) => void;
  sub: string | null; setSub: (s: string | null) => void;
  railViews: View[]; railCats: string[];
  onReorder: (kind: 'view' | 'cat', from: string, to: string) => void;
  dropCat: string | null; setDropCat: (c: string | null) => void;
  onDropOnCategory: (c: string) => void;
  onDropOnSub: (c: string, s: string) => void;
  onAddCat: (name: string) => void;
  onRenameCat: (from: string, to: string) => void;
  onDropCat: (name: string) => void;
  worksets: Workset[]; wsFilter: string | null;
  onPickWorkset: (id: string | null) => void;
  onAddWorkset: (name: string) => void;
  onRenameWorkset: (id: string, name: string) => void;
  onDeleteWorkset: (id: string) => void;
  onDropOnWorkset: (id: string) => void;
  /** 笔记分区：置顶优先的笔记列表 + 左栏点进笔记视图 */
  notes: Note[]; activeNoteId: string | null;
  onPickNote: (id: string) => void;
  onAddNote: (title: string) => void;
  onRenameNote: (id: string, title: string) => void;
  onDeleteNote: (id: string) => void;
  onPinNote: (id: string) => void;
  /** 左栏整体是否折叠成 56px 图标轨（prefs.railMini） */
  railMini: boolean;
  onToggleRailMini: () => void;
  /** 各分区折叠状态（prefs.railCollapsed，经 normalizeCollapse 洗过） */
  sectionCollapsed: CollapseState;
  onToggleSection: (id: string) => void;
}) {
  const dragRef = useRef<DragRef | null>(null);
  const [drag, setDrag] = useState<DragRef | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [wsAdding, setWsAdding] = useState(false);
  const [wsNewName, setWsNewName] = useState('');
  const [editWs, setEditWs] = useState<string | null>(null);
  const [wsDraft, setWsDraft] = useState('');
  const [dropWs, setDropWs] = useState<string | null>(null);
  const [noteAdding, setNoteAdding] = useState(false);
  const [noteNewName, setNoteNewName] = useState('');
  const [editNote, setEditNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const views = (railViews.length ? railViews : NAV.map(n => n.key)).filter(k => k !== 'trash');
  const cats = railCats.length ? railCats : tree.map(([c]) => c);
  const sections = railSections.list();

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

  const commitWsAdd = () => {
    const v = wsNewName.trim();
    if (v) onAddWorkset(v);
    setWsNewName('');
    setWsAdding(false);
  };

  const commitNoteAdd = () => {
    const v = noteNewName.trim();
    if (v) onAddNote(v);
    setNoteNewName('');
    setNoteAdding(false);
  };

  /** 分区头上的 ＋：折叠状态先展开分区再进输入态 */
  const startAdd = (sec: RailSectionDef, setter: (v: boolean) => void) => {
    if (isCollapsed(sectionCollapsed, sec)) onToggleSection(sec.id);
    setter(true);
  };

  /* ---------- 三个分区的内容体（结构原样平移，只换了外壳） ---------- */
  const sectionBody = (id: string): ReactNode => {
    if (id === 'views') {
      return (
        <>
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
        </>
      );
    }
    if (id === 'categories') {
      return (
        <>
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
        </>
      );
    }
    if (id === 'boards') {
      return (
        <>
          {wsAdding && (
            <div className="catadd">
              <input
                autoFocus
                value={wsNewName}
                placeholder="新画板名称"
                onChange={e => setWsNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitWsAdd();
                  if (e.key === 'Escape') { setWsAdding(false); setWsNewName(''); }
                }}
                onBlur={commitWsAdd}
              />
            </div>
          )}
          <div className="boards">
            {worksets.map(w => (
              <div
                key={w.id}
                className={'cat ws' + (wsFilter === w.id ? ' on' : '') + (dropWs === w.id ? ' drop' : '')}
                onClick={() => { if (editWs !== w.id) onPickWorkset(wsFilter === w.id ? null : w.id); }}
                title={`画板「${w.name}」· ${w.count} 张 · 把图拖到这里加入`}
                onDragOver={e => {
                  if (Array.from(e.dataTransfer.types).includes('text/plain')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropWs !== w.id) setDropWs(w.id);
                  }
                }}
                onDragLeave={() => setDropWs(d => (d === w.id ? null : d))}
                onDrop={e => {
                  if (Array.from(e.dataTransfer.types).includes('text/plain')) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropWs(null);
                    onDropOnWorkset(w.id);
                  }
                }}
              >
                {editWs === w.id ? (
                  <input
                    className="catrename"
                    autoFocus
                    value={wsDraft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setWsDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { onRenameWorkset(w.id, wsDraft.trim() || w.name); setEditWs(null); }
                      if (e.key === 'Escape') setEditWs(null);
                    }}
                    onBlur={() => setEditWs(null)}
                  />
                ) : (
                  <>
                    <span className="nm">{w.name}</span>
                    <i className="cnt">{w.count || ''}</i>
                    <span className="cattools">
                      <button title="改名" onClick={e => { e.stopPropagation(); setEditWs(w.id); setWsDraft(w.name); }}>✎</button>
                      <button title="删除画板（不影响图片）" onClick={e => { e.stopPropagation(); onDeleteWorkset(w.id); }}>×</button>
                    </span>
                  </>
                )}
              </div>
            ))}
            {!worksets.length && !wsAdding && (
              <div className="ws-none">还没有画板，点上面 ＋ 新建</div>
            )}
          </div>
        </>
      );
    }
    if (id === 'notes') {
      return (
        <>
          {noteAdding && (
            <div className="catadd">
              <input
                autoFocus
                value={noteNewName}
                placeholder="新笔记标题"
                onChange={e => setNoteNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitNoteAdd();
                  if (e.key === 'Escape') { setNoteAdding(false); setNoteNewName(''); }
                }}
                onBlur={commitNoteAdd}
              />
            </div>
          )}
          <div className="boards notelist">
            {notes.map(n => (
              <div
                key={n.id}
                className={'cat note' + (activeNoteId === n.id ? ' on' : '')}
                onClick={() => { if (editNote !== n.id) onPickNote(n.id); }}
                title={n.pinned ? `📌 置顶笔记「${n.title}」· ${n.assetCount} 张插图` : `笔记「${n.title}」· ${n.assetCount} 张插图`}
              >
                {editNote === n.id ? (
                  <input
                    className="catrename"
                    autoFocus
                    value={noteDraft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { onRenameNote(n.id, noteDraft.trim() || n.title); setEditNote(null); }
                      if (e.key === 'Escape') setEditNote(null);
                    }}
                    onBlur={() => setEditNote(null)}
                  />
                ) : (
                  <>
                    <span className="nm">
                      {n.pinned && <i className="pinmark" title="置顶">📌</i>}
                      {n.title}
                    </span>
                    <i className="cnt">{n.assetCount || ''}</i>
                    <span className="cattools">
                      <button
                        title={n.pinned ? '取消置顶' : '置顶'}
                        onClick={e => { e.stopPropagation(); onPinNote(n.id); }}
                      >📌</button>
                      <button title="改名" onClick={e => { e.stopPropagation(); setEditNote(n.id); setNoteDraft(n.title); }}>✎</button>
                      <button title="删除笔记（图片不受影响）" onClick={e => { e.stopPropagation(); onDeleteNote(n.id); }}>×</button>
                    </span>
                  </>
                )}
              </div>
            ))}
            {!notes.length && !noteAdding && (
              <div className="ws-none">还没有笔记，点上面 ＋ 新建</div>
            )}
          </div>
        </>
      );
    }
    // EXTENSION-RAIL-SECTION: 新注册的分区在这里补一个渲染分支（见 layout-registry.ts 顶部说明）。
    return null;
  };

  /* ---------- 图标轨态：点图标 = 展开左栏 + 展开对应分区 ---------- */
  const activeSection = activeNoteId ? 'notes' : wsFilter ? 'boards' : category ? 'categories' : 'views';

  return (
    <nav className={'rail' + (railMini ? ' mini' : '')} aria-label="素材库导航">
      <div className="railhead">
        <button
          className="railfold"
          onClick={onToggleRailMini}
          title={railMini ? '展开左栏' : '收起左栏为图标轨'}
          aria-label={railMini ? '展开左栏' : '收起左栏为图标轨'}
        >
          <Ico d={railMini ? CHEV_R : CHEV_L} size={13} />
        </button>
        <span className="microlbl">LIB / 素材库</span>
      </div>

      {railMini ? (
        <div className="railicons">
          {sections.map(s => (
            <button
              key={s.id}
              className={'railicon' + (activeSection === s.id ? ' on' : '')}
              title={`${s.en} / ${s.cn}`}
              aria-label={`展开左栏并定位到${s.cn}`}
              onClick={() => {
                onToggleRailMini();
                if (isCollapsed(sectionCollapsed, s)) onToggleSection(s.id);
              }}
            >
              <Ico d={s.icon} />
            </button>
          ))}
          <div className="icontip">REFCOLLECTOR RAIL</div>
        </div>
      ) : (
        <div className="railbody">
          {sections.map(sec => {
            const folded = isCollapsed(sectionCollapsed, sec);
            return (
              <section key={sec.id} className="rsec" data-sec={sec.id}>
                <div className="rsec-h">
                  <button
                    className="rsec-fold"
                    onClick={() => onToggleSection(sec.id)}
                    title={folded ? `展开${sec.cn}` : `收起${sec.cn}`}
                    aria-expanded={!folded}
                  >
                    <span>{sec.en} / {sec.cn}</span>
                    <i className={'rsec-caret' + (folded ? '' : ' open')}>▸</i>
                  </button>
                  {sec.id === 'categories' && (
                    <button className="railadd" onClick={() => startAdd(sec, setAdding)} title="新建分类">＋</button>
                  )}
                  {sec.id === 'boards' && (
                    <button className="railadd" onClick={() => startAdd(sec, setWsAdding)} title="新建画板（跨分类临时组图）">＋</button>
                  )}
                  {sec.id === 'notes' && (
                    <button className="railadd" onClick={() => startAdd(sec, setNoteAdding)} title="新建笔记">＋</button>
                  )}
                </div>
                {!folded && <div className="rsec-b">{sectionBody(sec.id)}</div>}
              </section>
            );
          })}
        </div>
      )}
    </nav>
  );
}
