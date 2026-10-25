import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ResizeHandles, StatusBar, TitleBar, useDebounced } from './components/Chrome';
import { BatchBar, EmptyState, Masonry, Toolbar } from './components/Stage';
import { Rail } from './components/Rail';
import { Dock } from './components/Dock';
import { ClipCard, DropVeil, Lightbox, ToastBar } from './components/Overlays';
import { DEFAULT_VIEWS, type ClipInfo, type Item, type Prefs, type Sort, type Stats, type Toast, type Tree, type View } from './types';

const EMPTY_STATS: Stats = { total: 0, inbox: 0, fav: 0, week: 0, size: 0, root: '' };

const idsOf = (s: Set<string>): string[] => {
  const out: string[] = [];
  s.forEach(v => out.push(v));
  return out;
};

const VIEW_LABEL: Record<View, string> = {
  all: '全部素材', inbox: '待分类', fav: '收藏', recent: '最近浏览'
};

export default function App() {
  const [root, setRoot] = useState('');
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [tree, setTree] = useState<Tree>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [view, setView] = useState<View>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const dq = useDebounced(query, 180);

  const [railViews, setRailViews] = useState<View[]>(DEFAULT_VIEWS);
  const [railCats, setRailCats] = useState<string[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastId, setLastId] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropCat, setDropCat] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [busy, setBusy] = useState('');
  const [fileOver, setFileOver] = useState(false);
  const [editSignal, setEditSignal] = useState(0);
  const [askRoot, setAskRoot] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [confirmCat, setConfirmCat] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const fileOverTimer = useRef<any>(null);

  const refresh = useCallback(async (opts?: { view?: View; category?: string | null; query?: string; sort?: Sort }) => {
    const v = opts?.view ?? view;
    const c = opts?.category === undefined ? category : opts.category;
    const q = opts?.query ?? dq;
    const s = opts?.sort ?? sort;
    const [cnt, st] = await Promise.all([window.api.lib.counts(), window.api.lib.stats()]);
    if (colorFilter) {
      const list = await window.api.lib.searchColors({ colors: [colorFilter], threshold: 18, limit: 300, category: c });
      setItems(list);
    } else {
      const list = await window.api.lib.list({ view: v, category: c, query: q, sort: s });
      setItems(list);
    }
    setCounts(cnt || {});
    setStats(st);
  }, [view, category, dq, sort, colorFilter]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    (async () => {
      const [info, prefs] = await Promise.all([window.api.lib.info(), window.api.lib.getPrefs()]);
      setRoot(info.root);
      setStats(info.stats);
      setTree(info.tree);
      if (prefs?.railViews?.length) setRailViews(prefs.railViews);
      if (prefs?.railCats?.length) setRailCats(prefs.railCats);
      else setRailCats(info.tree.map(([c]) => c));
      await refreshRef.current();
      setMaximized(await window.api.win.isMax());
    })();

    const off1 = window.api.win.onState(s => setMaximized(s.maximized));
    const off2 = window.api.on.importProgress(p => setBusy(`导入中 ${p.done}/${p.total} · 新增 ${p.added}`));
    const off3 = window.api.on.importDone(async (p) => {
      setBusy('');
      await refreshRef.current();
      if (p?.total) {
        setToast({ msg: `导入完成：新增 ${p.added}，重复 ${p.dup}${p.failed ? `，失败 ${p.failed}` : ''}` });
      }
    });
    const off4 = window.api.on.clipImage(c => setClip(c));
    const off5 = window.api.on.focusSearch(() => searchRef.current?.focus());
    const off6 = window.api.on.librarySwitched(async (p) => {
      setRoot(p.root);
      setStats(p.stats);
      setSelectedIds(new Set());
      await refreshRef.current();
    });
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); };
  }, []);

  useEffect(() => { refresh(); }, [view, category, dq, sort, colorFilter]);

  useEffect(() => {
    if (!tree.length) return;
    const all = tree.map(([c]) => c);
    setRailCats(prev => {
      const kept = prev.filter(c => all.includes(c));
      const added = all.filter(c => !kept.includes(c));
      return kept.length ? [...kept, ...added] : all;
    });
  }, [tree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); doImport(); }
      if (e.key === 'Escape') {
        setLightboxId(null); setClip(null);
        setConfirmDel(null); setConfirmCat(null); setSettings(false);
      }
      if (e.key === 'F2' && selectedIds.size === 1 && !typing) { e.preventDefault(); setEditSignal(n => n + 1); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size && !typing) {
        e.preventDefault();
        setConfirmDel(Array.from(selectedIds));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault();
        setSelectedIds(new Set(items.map(i => i.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, items]);

  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        setFileOver(true);
        clearTimeout(fileOverTimer.current);
        fileOverTimer.current = setTimeout(() => setFileOver(false), 220);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setFileOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const paths = files.map(f => window.api.lib.pathForFile(f)).filter(Boolean);
      if (paths.length) await window.api.lib.importPaths({ paths, category: category || undefined });
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', prevent);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', prevent);
      window.removeEventListener('drop', onDrop);
    };
  }, [category]);

  const doImport = async () => {
    setBusy('选择中…');
    const r = await window.api.lib.importDialog(category ? { category } : undefined);
    if (!r) setBusy('');
  };

  const importTo = async (cat: string) => {
    setBusy('选择中…');
    const r = await window.api.lib.importDialog({ category: cat });
    if (!r) setBusy('');
  };

  const onReorder = (kind: 'view' | 'cat', from: string, to: string) => {
    const move = <T,>(arr: T[], a: T, b: T): T[] => {
      const i = arr.indexOf(a), j = arr.indexOf(b);
      if (i < 0 || j < 0 || i === j) return arr;
      const next = arr.slice();
      next.splice(i, 1);
      next.splice(j, 0, a);
      return next;
    };
    if (kind === 'view') {
      const next = move(railViews, from as View, to as View);
      setRailViews(next);
      window.api.lib.setPrefs({ railViews: next } as Partial<Prefs>);
    } else {
      const next = move(railCats, from, to);
      setRailCats(next);
      window.api.lib.setPrefs({ railCats: next } as Partial<Prefs>);
      const order = new Map(next.map((c, i) => [c, i]));
      const sorted: Tree = [...tree].sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999));
      setTree(sorted);
      window.api.lib.saveCats(sorted);
    }
  };

  /* ---------- 分类增删改 ---------- */
  const addCat = async (name: string) => {
    if (tree.some(([c]) => c === name)) { setToast({ msg: '已经有同名分类了' }); return; }
    const next: Tree = [...tree, [name, []]];
    setTree(next);
    setRailCats(prev => [...prev, name]);
    await window.api.lib.saveCats(next);
    setCategory(name);
    setToast({ msg: `已新建分类「${name}」` });
  };

  const renameCat = async (from: string, to: string) => {
    if (!to || from === to) return;
    if (tree.some(([c]) => c === to)) { setToast({ msg: '已经有同名分类了' }); return; }
    const next: Tree = tree.map(([c, subs]) => (c === from ? [to, subs] : [c, subs]));
    setTree(next);
    setRailCats(prev => prev.map(c => (c === from ? to : c)));
    await window.api.lib.saveCats(next);
    const n = await window.api.lib.renameCat({ from, to });
    if (category === from) setCategory(to);
    await refresh();
    setToast({ msg: `「${from}」改名为「${to}」，${n} 张图已同步` });
  };

  const deleteCat = async (name: string) => {
    const next: Tree = tree.filter(([c]) => c !== name);
    setTree(next);
    setRailCats(prev => prev.filter(c => c !== name));
    await window.api.lib.saveCats(next);
    const n = await window.api.lib.dropCat(name);
    if (category === name) setCategory(null);
    await refresh();
    setToast({ msg: `已删除分类「${name}」，${n} 张图退回待分类` });
  };

  /* ---------- 选择 ---------- */
  const onSelect = (id: string, e: ReactMouseEvent) => {
    const multi = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (range && lastId) {
        const a = items.findIndex(i => i.id === lastId);
        const b = items.findIndex(i => i.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(items[i].id);
          return next;
        }
      }
      if (multi) {
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
    setLastId(id);
  };

  const clearSel = () => { setSelectedIds(new Set()); setLastId(null); };

  const batchCategory = async (cat: string) => {
    const ids: string[] = idsOf(selectedIds);
    await window.api.lib.setCategoryMany({ ids, category: cat });
    await refresh();
    setToast({ msg: `${ids.length} 张已改判为「${cat}」` });
  };

  const batchFav = async () => {
    const ids: string[] = idsOf(selectedIds);
    const allFav = ids.every(id => items.find(i => i.id === id)?.favorite);
    await window.api.lib.toggleFavMany({ ids, value: !allFav });
    await refresh();
    setToast({ msg: allFav ? `已取消收藏 ${ids.length} 张` : `已收藏 ${ids.length} 张` });
  };

  const doDelete = async (ids: string[]) => {
    const r = await window.api.lib.removeMany(ids);
    setConfirmDel(null);
    clearSel();
    await refresh();
    setToast({ msg: `已删除 ${r.n} 张（含磁盘文件）` });
  };

  const onDropOnCategory = async (cat: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const prev = items.find(i => i.id === id);
    if (prev?.category === cat) return;
    const res = await window.api.lib.setCategory({ id, category: cat });
    if (res) {
      await refresh();
      setToast({
        msg: `已移到「${cat}」`,
        undo: async () => {
          await window.api.lib.setCategory({ id, category: prev?.category || '待分类', subcategory: prev?.subcategory });
          await refresh();
        }
      });
    }
  };

  const changeCategory = async (id: string, cat: string) => {
    const prev = items.find(i => i.id === id);
    await window.api.lib.setCategory({ id, category: cat });
    await refresh();
    setToast({
      msg: `已改判为「${cat}」`,
      undo: async () => {
        await window.api.lib.setCategory({ id, category: prev?.category || '待分类', subcategory: prev?.subcategory });
        await refresh();
      }
    });
  };

  const renameItem = async (id: string, name: string): Promise<string | null> => {
    const r = await window.api.lib.rename(id, name);
    if (r?.error) return r.error;
    await refresh();
    setToast({ msg: '已重命名（磁盘文件名同步修改）' });
    return null;
  };

  const setTags = async (id: string, tags: string[]) => {
    await window.api.lib.setTags({ id, tags });
    await refresh();
  };

  const saveClip = async () => {
    if (!clip) return;
    await window.api.lib.importFile({ file: clip.file, category: category || undefined });
    setClip(null);
    await refresh();
  };

  const pickRoot = async () => {
    const p = await window.api.lib.pickRoot();
    if (p) { setSettings(false); setAskRoot(p); }
  };

  const applyRoot = async (migrate: boolean) => {
    const p = askRoot;
    setAskRoot(null);
    if (!p) return;
    setBusy(migrate ? '正在复制素材…' : '正在切换…');
    const r = await window.api.lib.applyRoot({ root: p, migrate });
    setBusy('');
    setRoot(r.root);
    setStats(r.stats);
    await refresh();
    setToast({ msg: migrate ? '已迁移到新目录' : '已切换库目录' });
  };

  const selected = items.find(i => i.id === selectedIds.values().next().value) || null;
  const lightboxItem = items.find(i => i.id === lightboxId) || null;
  const cats = tree.map(([c]) => c);

  const crumb = useMemo(() => {
    const parts = ['库'];
    if (colorFilter) parts.push(`颜色 ${colorFilter}`);
    if (category) parts.push(category); else parts.push(VIEW_LABEL[view]);
    if (dq) parts.push(`搜索「${dq}」`);
    parts.push(`${items.length} 项`);
    return parts.join('  /  ');
  }, [category, view, dq, items.length, colorFilter]);

  const fadeKey = `${view}|${category}|${dq}|${sort}|${colorFilter}`;

  return (
    <div className="win" data-ark-theme="endfield" data-ark-depth="complex">
      <TitleBar crumb={crumb} maximized={maximized} onSettings={() => setSettings(true)} />
      <div className="app" data-dock={selected ? 'open' : 'idle'}>
        <Rail
          view={view}
          setView={v => { setView(v); setCategory(null); clearSel(); }}
          stats={stats}
          tree={tree}
          counts={counts}
          category={category}
          setCategory={c => { setCategory(c); clearSel(); }}
          railViews={railViews}
          railCats={railCats}
          onReorder={onReorder}
          dropCat={dropCat}
          setDropCat={setDropCat}
          onDropOnCategory={onDropOnCategory}
          onOpenRoot={() => window.api.lib.openRoot()}
          onAddCat={addCat}
          onRenameCat={renameCat}
          onDropCat={name => setConfirmCat(name)}
        />

        <main className="stage">
          {busy && <div className="scan" />}
          <Toolbar
            ref={searchRef}
            query={query}
            setQuery={setQuery}
            sort={sort}
            setSort={setSort}
            category={category}
            cats={cats}
            setCategory={c => { setCategory(c); clearSel(); }}
            colorFilter={colorFilter}
            onClearColor={() => setColorFilter(null)}
            onImport={doImport}
            onImportTo={importTo}
          />
          <div className="gridwrap">
            {items.length === 0 ? (
              <EmptyState query={dq} onImport={doImport} />
            ) : (
              <Masonry
                items={items}
                fadeKey={fadeKey}
                selectedIds={selectedIds}
                draggingId={draggingId}
                onSelect={onSelect}
                onOpen={setLightboxId}
                onDragOut={id => window.api.lib.dragOut(id)}
                onDragStart={setDraggingId}
                onDragEnd={() => { setDraggingId(null); setDropCat(null); }}
              />
            )}
          </div>
          <BatchBar
            count={selectedIds.size}
            cats={cats}
            onCategory={batchCategory}
            onFav={batchFav}
            onDragOut={() => { const id = idsOf(selectedIds)[0]; if (id) window.api.lib.dragOut(id); }}
            onDelete={() => setConfirmDel(Array.from(selectedIds))}
            onClear={clearSel}
          />
        </main>

        <Dock
          stats={stats}
          count={items.length}
          label={category ? `${category} / FILTERED` : VIEW_LABEL[view]}
          selected={selected}
          cats={cats}
          busy={busy}
          editSignal={editSignal}
          onFav={async id => { await window.api.lib.toggleFav(id); await refresh(); }}
          onCopy={async id => { const ok = await window.api.lib.copyImage(id); if (ok) setToast({ msg: '已复制到剪贴板，可 Ctrl+V 贴进画布' }); }}
          onReveal={id => window.api.lib.reveal(id)}
          onRemove={id => setConfirmDel([id])}
          onCategory={changeCategory}
          onDragOut={id => window.api.lib.dragOut(id)}
          onRename={renameItem}
          onTags={setTags}
          onColorClick={hex => setColorFilter(hex)}
        />
      </div>

      <StatusBar root={root} total={stats.total} busy={busy} />
      <ResizeHandles />

      {fileOver && <DropVeil />}
      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxId(null)} />}
      {clip && <ClipCard clip={clip} onSave={saveClip} onIgnore={() => setClip(null)} />}
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {settings && (
        <div className="modal-veil" onClick={() => setSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">库设置</div>
            <div className="mp" title={root}>{root || '未初始化'}</div>
            <div className="mh">
              当前库占用 {stats.total} 张图。换目录时可以连同素材一起搬过去。
            </div>
            <div className="mb">
              <button onClick={() => setSettings(false)}>关闭</button>
              <button onClick={() => window.api.lib.openRoot()}>打开目录</button>
              <button className="primary" onClick={pickRoot}>更换库目录</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-veil" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">删除 {confirmDel.length} 张图片</div>
            <div className="mh">
              会同时删除库里的文件与缩略图，<b>不可恢复</b>。只是不想在这里看到的话，可以改分类。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmDel(null)}>取消</button>
              <button className="primary danger" onClick={() => doDelete(confirmDel)}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {confirmCat && (
        <div className="modal-veil" onClick={() => setConfirmCat(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">删除分类「{confirmCat}」</div>
            <div className="mh">
              分类里的 {counts[confirmCat] || 0} 张图不会被删，会退回「待分类」。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmCat(null)}>取消</button>
              <button className="primary danger" onClick={() => { const n = confirmCat; setConfirmCat(null); deleteCat(n); }}>删除分类</button>
            </div>
          </div>
        </div>
      )}

      {askRoot && (
        <div className="modal-veil" onClick={() => setAskRoot(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">更换库目录</div>
            <div className="mp" title={askRoot}>{askRoot}</div>
            <div className="mh">
              要把现有素材一起复制到新目录吗？<br />
              <span>复制会占用额外磁盘空间，完成后可以手动删除旧目录。</span>
            </div>
            <div className="mb">
              <button onClick={() => setAskRoot(null)}>取消</button>
              <button onClick={() => applyRoot(false)}>只切换</button>
              <button className="primary" onClick={() => applyRoot(true)}>复制并切换</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
