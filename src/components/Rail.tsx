import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { railSections } from '../lib/layout-registry';
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

type DragRef = { kind: 'view' | 'cat'; key: string };

/** 图墙卡片拖拽带 text/plain，左栏内部排序带 RAIL_MIME——靠这个区分两种拖拽 */
const hasCard = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('text/plain');

export function Rail({
  view, setView, stats, tree, counts, category, setCategory, sub, setSub,
  railViews, railCats, onReorder, dropCat, setDropCat, onDropOnCategory, onDropOnSub,
  onAddCat, onRenameCat, onDropCat,
  worksets, wsFilter, onPickWorkset, onAddWorkset, onRenameWorkset, onDeleteWorkset, onDropOnWorkset,
  notes, activeNoteId, onPickNote, onAddNote, onRenameNote, onDeleteNote, onPinNote,
  onClose, activeSection, onPickSection, dragging
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
  /** 素材库滑出面板的关闭按钮（点遮罩 / Esc 也走同一出口） */
  onClose: () => void;
  /** 当前分区：面板一次只渲染一个分区的完整功能 */
  activeSection: string;
  onPickSection: (id: string) => void;
  /** 图墙卡片拖拽中：面板切到「放置面板」，分类 + 画板同屏可放 */
  dragging: boolean;
}) {
  const dragRef = useRef<DragRef | null>(null);
  const [drag, setDrag] = useState<DragRef | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [catQuery, setCatQuery] = useState('');
  const [wsAdding, setWsAdding] = useState(false);
  const [wsNewName, setWsNewName] = useState('');
  const [editWs, setEditWs] = useState<string | null>(null);
  const [wsDraft, setWsDraft] = useState('');
  const [noteAdding, setNoteAdding] = useState(false);
  const [noteNewName, setNoteNewName] = useState('');
  const [editNote, setEditNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const views = (railViews.length ? railViews : NAV.map(n => n.key)).filter(k => k !== 'trash');
  const cats = railCats.length ? railCats : tree.map(([c]) => c);
  const sections = railSections.list();
  const active = sections.find(s => s.id === activeSection) || sections[0];

  const catNeedle = catQuery.trim().toLowerCase();
  const shownCats = catNeedle ? cats.filter(c => c.toLowerCase().includes(catNeedle)) : cats;

  const tabCount = (id: string) =>
    id === 'categories' ? cats.length
      : id === 'boards' ? worksets.length
        : id === 'notes' ? notes.length
          : stats.inbox || 0;

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
      if (Array.from(e.dataTransfer.types).includes(RAIL_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
        return;
      }
      if (kind === 'cat' && hasCard(e)) {
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
      const src = dragRef.current;
      if (Array.from(e.dataTransfer.types).includes(RAIL_MIME) && src) {
        e.preventDefault();
        e.stopPropagation();
        onReorder(src.kind, src.key, key);
      } else if (kind === 'cat' && hasCard(e)) {
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

  /** 卡片拖到分类 / 子类 / 画板行：整行高亮，松开即放入 */
  const cardDropProps = (key: string, put: () => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasCard(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropCat !== key) setDropCat(key);
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation();
      if (dropCat === key) setDropCat(null);
    },
    onDrop: (e: DragEvent) => {
      if (!hasCard(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropCat(null);
      put();
    }
  });

  /* ---------- 分区内容：一次只渲染当前分区 ---------- */
  const sectionBody = (id: string): ReactNode => {
    if (id === 'views') {
      const tileCount = (k: View) =>
        k === 'all' ? stats.total : k === 'inbox' ? stats.inbox : k === 'fav' ? stats.fav : null;
      return (
        <>
          <div className="vboard">
            {views.map(k => {
              const meta = NAV.find(n => n.key === k);
              if (!meta) return null;
              const n = tileCount(k);
              return (
                <button
                  key={k}
                  className={'vtile' + (view === k && !category ? ' on' : '') + (over === k ? ' over' : '') + (drag?.key === k ? ' dragging' : '')}
                  onClick={() => { setView(k); setSub(null); }}
                  title={meta.label}
                  {...railDragProps('view', k)}
                >
                  <i className="vico"><Ico d={meta.icon} size={17} /></i>
                  <span className="vnm">{meta.label}</span>
                  {n !== null && <i className="vcnt">{n}</i>}
                  {k === 'inbox' && n !== null && n > 0 && <i className="alertdot" />}
                </button>
              );
            })}
          </div>
          <button
            className={'vtile trash' + (view === 'trash' ? ' on' : '')}
            onClick={() => { setView('trash'); setCategory(null); setSub(null); }}
            title="回收站：删掉的图还在这里，可以恢复"
          >
            <i className="vico"><Ico d={NAV[4].icon} size={15} /></i>
            <span className="vnm">回收站</span>
            <i className="vcnt">{stats.trash || ''}</i>
          </button>
        </>
      );
    }
    if (id === 'categories') {
      return (
        <>
          {cats.length > 6 && (
            <label className="railsearch">
              <input
                value={catQuery}
                placeholder="筛选分类"
                onChange={e => setCatQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setCatQuery(''); }}
              />
              <i>{catNeedle ? `${shownCats.length}/${cats.length}` : cats.length}</i>
            </label>
          )}
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
            {shownCats.map(c => {
              const subs = tree.find(([n]) => n === c)?.[1] || [];
              const isOpen = open.has(c);
              const on = category === c && !sub;
              return (
                <div className="catblock" key={c}>
                  <div
                    className={'cat' + (on ? ' on' : '') + (over === c ? ' over' : '')
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
                          {...cardDropProps(c + '/' + s, () => onDropOnSub(c, s))}
                        >
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!shownCats.length && (
              <div className="ws-none">{catNeedle ? '没有匹配的分类' : '还没有分类，点上面 ＋ 新建'}</div>
            )}
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
                className={'cat ws' + (wsFilter === w.id ? ' on' : '') + (dropCat === w.id ? ' drop' : '')}
                onClick={() => { if (editWs !== w.id) onPickWorkset(wsFilter === w.id ? null : w.id); }}
                title={`画板「${w.name}」· ${w.count} 张 · 把图拖到这里加入`}
                {...cardDropProps(w.id, () => onDropOnWorkset(w.id))}
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

  /** 每个分区自带一条动作带：新建入口跟着内容走，不再缩在分区头的小箭头旁 */
  const sectionAction = (id: string): ReactNode => {
    if (id === 'categories') return <button className="railadd-lg" onClick={() => setAdding(true)}>＋ 新建分类</button>;
    if (id === 'boards') return <button className="railadd-lg" onClick={() => setWsAdding(true)}>＋ 新建画板</button>;
    if (id === 'notes') return <button className="railadd-lg" onClick={() => setNoteAdding(true)}>＋ 新建笔记</button>;
    return null;
  };

  /* ---------- 拖拽放置面板：卡片拖拽时分类 + 画板同屏，两个去处都够得着 ---------- */
  const dropPanel = (
    <>
      <div className="dropnote">拖到分类或画板，松开即放入</div>
      <div className="dropttl">分类<i className="dropttl-n">{cats.length}</i></div>
      <div className="cats dropcats">
        {cats.map(c => {
          const subs = tree.find(([n]) => n === c)?.[1] || [];
          return (
            <div className="catblock" key={c}>
              <div className={'cat' + (dropCat === c ? ' drop' : '')} {...cardDropProps(c, () => onDropOnCategory(c))}>
                <span className="nm">{c}</span>
                <i className="cnt">{counts[c] || ''}</i>
              </div>
              {subs.length > 0 && (
                <div className="subs">
                  {subs.map(s => (
                    <div
                      key={s}
                      className={'catsub' + (dropCat === c + '/' + s ? ' drop' : '')}
                      {...cardDropProps(c + '/' + s, () => onDropOnSub(c, s))}
                    >
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!cats.length && <div className="ws-none">还没有分类</div>}
      </div>
      <div className="dropttl">画板<i className="dropttl-n">{worksets.length}</i></div>
      <div className="boards dropboards">
        {worksets.map(w => (
          <div
            key={w.id}
            className={'cat ws' + (dropCat === w.id ? ' drop' : '')}
            {...cardDropProps(w.id, () => onDropOnWorkset(w.id))}
          >
            <span className="nm">{w.name}</span>
            <i className="cnt">{w.count || ''}</i>
          </div>
        ))}
        {!worksets.length && <div className="ws-none">还没有画板</div>}
      </div>
    </>
  );

  return (
    <nav className={'rail' + (dragging ? ' dropping' : '')} aria-label="素材库导航">
      <div className="railhead">
        <span className="railttl">LIB<span className="railttl-sep"> / </span>{active?.cn}</span>
        <button className="railclose" onClick={onClose} title="关闭素材库（Esc）" aria-label="关闭素材库">×</button>
      </div>

      {dragging ? (
        <div className="dropbar"><i className="alertdot" />放置模式</div>
      ) : (
        <div className="railsw" role="tablist" aria-label="素材库分区">
          {sections.map(sec => {
            const n = tabCount(sec.id);
            return (
              <button
                key={sec.id}
                role="tab"
                aria-selected={sec.id === active?.id}
                className={'railsw-btn' + (sec.id === active?.id ? ' on' : '')}
                data-sec-tab={sec.id}
                onClick={() => onPickSection(sec.id)}
                title={`${sec.en} / ${sec.cn}`}
              >
                <i className="ico"><Ico d={sec.icon} size={14} /></i>
                <span className="lb">{sec.cn}{n > 0 && <i className="cnt">{n}</i>}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="railbody">
        {dragging ? dropPanel : (
          <section className="rsec" data-sec={active?.id} key={active?.id}>
            {sectionAction(active?.id || '')}
            {sectionBody(active?.id || '')}
          </section>
        )}
      </div>
    </nav>
  );
}
