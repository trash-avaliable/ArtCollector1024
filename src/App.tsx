import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ResizeHandles, StatusBar, TitleBar, useDebounced } from './components/Chrome';
import { BatchBar, EmptyState, Masonry, Toolbar } from './components/Stage';
import { Rail } from './components/Rail';
import { Dock } from './components/Dock';
import { ClipCard, DropVeil, Lightbox, ToastBar } from './components/Overlays';
import { EMPTY_STATS, DEFAULT_VIEWS, type ClipInfo, type Item, type Prefs, type ScanGroup, type ScanResult, type Sort, type Stats, type Toast, type Tree, type View } from './types';

const idsOf = (s: Set<string>): string[] => {
  const out: string[] = [];
  s.forEach(v => out.push(v));
  return out;
};

const VIEW_LABEL: Record<View, string> = {
  all: '全部素材', inbox: '待分类', fav: '收藏', recent: '最近浏览', trash: '回收站'
};

export default function App() {
  const [root, setRoot] = useState('');
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [tree, setTree] = useState<Tree>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [view, setView] = useState<View>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [sim, setSim] = useState<{ id: string; name: string } | null>(null);
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
  const [confirmPurge, setConfirmPurge] = useState<{ ids: string[]; all?: boolean } | null>(null);
  const [confirmCat, setConfirmCat] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [bridge, setBridge] = useState<{ port: number; token: string; extDir: string } | null>(null);
  const [scan, setScan] = useState<{ root: string; result: ScanResult | null; picked: Set<string>; loose: boolean } | null>(null);

  useEffect(() => {
    if (!settings) return;
    window.api.bridge.info().then(setBridge).catch(() => { });
  }, [settings]);

  const searchRef = useRef<HTMLInputElement>(null);
  const fileOverTimer = useRef<any>(null);

  const refresh = useCallback(async (opts?: { view?: View; category?: string | null; sub?: string | null; query?: string; sort?: Sort }) => {
    const v = opts?.view ?? view;
    const c = opts?.category === undefined ? category : opts.category;
    const s2 = opts?.sub === undefined ? sub : opts.sub;
    const q = opts?.query ?? dq;
    const s = opts?.sort ?? sort;
    const [cnt, st] = await Promise.all([window.api.lib.counts(), window.api.lib.stats()]);
    if (sim) {
      const list = await window.api.lib.similar({ id: sim.id, limit: 60 });
      setItems(list);
    } else if (colorFilter) {
      const list = await window.api.lib.searchColors({ colors: [colorFilter], threshold: 18, limit: 300, category: c });
      setItems(list);
    } else {
      const list = await window.api.lib.list({ view: v, category: c, subcategory: s2, query: q, sort: s });
      setItems(list);
    }
    setCounts(cnt || {});
    setStats(st);
  }, [view, category, sub, dq, sort, colorFilter, sim]);

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

  useEffect(() => { refresh(); }, [view, category, sub, dq, sort, colorFilter, sim]);

  useEffect(() => {
    if (!tree.length) return;
    const all = tree.map(([c]) => c);
    setRailCats(prev => {
      const kept = prev.filter(c => all.includes(c));
      const added = all.filter(c => !kept.includes(c));
      return kept.length ? [...kept, ...added] : all;
    });
  }, [tree]);

  const doImport = async () => {
    setBusy('选择中…');
    const r = await window.api.lib.importDialog(category ? { category, subcategory: sub || undefined } : undefined);
    if (!r) setBusy('');
  };

  const importTo = async (cat: string) => {
    setBusy('选择中…');
    const r = await window.api.lib.importDialog({ category: cat });
    if (!r) setBusy('');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); doImport(); }
      if (e.key === 'Escape') {
        if (selectedIds.size) { setSelectedIds(new Set()); setLastId(null); return; }
        setLightboxId(null); setClip(null);
        setConfirmDel(null); setConfirmPurge(null); setConfirmCat(null); setSettings(false);
      }
      if (e.key === 'F2' && selectedIds.size === 1 && !typing) { e.preventDefault(); setEditSignal(n => n + 1); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size && !typing) {
        e.preventDefault();
        const ids = idsOf(selectedIds);
        if (view === 'trash') setConfirmPurge({ ids });
        else setConfirmDel(ids);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault();
        setSelectedIds(new Set(items.map(i => i.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, items, view, category, sub]);

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
    setSub(null);
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
    if (category === name) { setCategory(null); setSub(null); }
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

  const onBoxSelect = (ids: string[], additive: boolean) => {
    setSelectedIds(prev => {
      if (!ids.length) return additive ? prev : new Set<string>();
      const next = additive ? new Set(prev) : new Set<string>();
      ids.forEach(id => next.add(id));
      return next;
    });
    if (ids.length) setLastId(ids[ids.length - 1]);
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
    setToast({
      msg: `已移到回收站 ${r.n} 张`,
      undo: async () => {
        await window.api.lib.restoreMany(ids);
        await refresh();
      }
    });
  };

  const doRestore = async (ids: string[]) => {
    const r = await window.api.lib.restoreMany(ids);
    clearSel();
    await refresh();
    setToast({ msg: `已恢复 ${r.n} 张` });
  };

  const doPurge = async (ids: string[], all = false) => {
    setConfirmPurge(null);
    const r = all ? await window.api.lib.purgeAll() : await window.api.lib.purgeMany(ids);
    clearSel();
    await refresh();
    setToast({ msg: `已彻底删除 ${r.n} 张（磁盘文件同步删除）` });
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

  const onDropOnSub = async (cat: string, s: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const prev = items.find(i => i.id === id);
    await window.api.lib.setCategory({ id, category: cat, subcategory: s });
    await refresh();
    setToast({
      msg: `已移到「${cat} / ${s}」`,
      undo: async () => {
        await window.api.lib.setCategory({ id, category: prev?.category || '待分类', subcategory: prev?.subcategory });
        await refresh();
      }
    });
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

  const changeSubCategory = async (id: string, cat: string, s: string) => {
    await window.api.lib.setCategory({ id, category: cat, subcategory: s });
    await refresh();
    setToast({ msg: `子类改为「${s || '未分类'}」` });
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

  /* ---------- 扫描接入：换目录时把新目录里的图片按文件夹接进库 ---------- */
  const startScan = async (root: string) => {
    setAskRoot(null);
    setScan({ root, result: null, picked: new Set(), loose: false });
    const r = await window.api.lib.scanRoot(root);
    setScan(prev => prev && prev.root === root
      ? { ...prev, result: r, picked: new Set(r.groups.map(g => g.name)), loose: r.loose > 0 }
      : prev);
  };

  const runAttach = async () => {
    if (!scan?.result) return;
    const pickedGroups: ScanGroup[] = scan.result.groups.filter(g => scan.picked.has(g.name));
    const loose = scan.loose && scan.result.loose > 0;
    if (!pickedGroups.length && !loose) { setScan(null); return; }
    setScan(null);
    setBusy('正在切换并接入…');
    try {
      // 文件夹名 = 分类、二级文件夹 = 子分类：先补进分类树
      const existing = new Map(tree);
      let next: Tree = [...tree];
      for (const g of pickedGroups) {
        const subs = [...(existing.get(g.name)?.[1] || [])];
        for (const s of g.subs) if (!subs.includes(s.name)) subs.push(s.name);
        next = next.some(([c]) => c === g.name)
          ? next.map(([c, ss]) => (c === g.name ? [c, subs] : [c, ss]))
          : [...next, [g.name, subs]];
      }
      if (next !== tree) {
        await window.api.lib.saveCats(next);
        setTree(next);
        setRailCats(prev => {
          const add = next.map(([c]) => c).filter(c => !prev.includes(c));
          return add.length ? [...prev, ...add] : prev;
        });
      }
      const groups: any[] = pickedGroups.map(g => ({ name: g.name, count: g.count, abs: g.abs, subs: g.subs }));
      if (loose) groups.push({ loose: true });
      await window.api.lib.attachScan({ root: scan.root, groups });
      await refresh();
      setToast({ msg: `已接入 ${groups.length ? groups.length + ' 个文件夹' : ''}${loose ? (groups.length > 1 ? ' + ' : '') + '根目录散图' : ''}` });
    } catch (err: any) {
      setToast({ msg: '接入失败：' + (err?.message || err) });
    }
    setBusy('');
  };

  const doTrim = async () => {
    const ids = idsOf(selectedIds);
    setBusy('正在裁白边…');
    const r = await window.api.lib.trimMany(ids);
    setBusy('');
    clearSel();
    await refresh();
    setToast({ msg: r.changed ? `已裁掉 ${r.changed} 张的白边（原图文件没动）` : '这几张没有可裁的白边' });
  };

  const selected = items.find(i => i.id === selectedIds.values().next().value) || null;
  const lightboxItem = items.find(i => i.id === lightboxId) || null;
  const cats = tree.map(([c]) => c);
  

  const navLightbox = (dir: -1 | 1) => {
    if (!lightboxId) return;
    const i = items.findIndex(x => x.id === lightboxId);
    if (i < 0) return;
    const n = items[(i + dir + items.length) % items.length];
    if (n) setLightboxId(n.id);
  };

  const crumb = useMemo(() => {
    const parts = ['库'];
    if (sim) {
      parts.push(`相似于「${sim.name}」`);
    } else {
      if (colorFilter) parts.push(`颜色 ${colorFilter}`);
      if (category) parts.push(sub ? `${category} / ${sub}` : category);
      else parts.push(VIEW_LABEL[view]);
    }
    if (dq) parts.push(`搜索「${dq}」`);
    parts.push(`${items.length} 项`);
    return parts.join('  /  ');
  }, [category, sub, view, dq, items.length, colorFilter, sim]);

  const fadeKey = `${view}|${category}|${sub}|${dq}|${sort}|${colorFilter}|${sim?.id || ''}`;

  return (
    <div className="win" data-ark-theme="endfield" data-ark-depth="complex">
      <TitleBar crumb={crumb} maximized={maximized} onSettings={() => setSettings(true)} />
      <div className="app" data-dock={selected ? 'open' : 'idle'}>
        <Rail
          view={view}
          setView={v => { setView(v); setCategory(null); setSub(null); setSim(null); setColorFilter(null); clearSel(); }}
          stats={stats}
          tree={tree}
          counts={counts}
          category={category}
          setCategory={c => { setCategory(c); setSub(null); setSim(null); clearSel(); }}
          sub={sub}
          setSub={setSub}
          railViews={railViews}
          railCats={railCats}
          onReorder={onReorder}
          dropCat={dropCat}
          setDropCat={setDropCat}
          onDropOnCategory={onDropOnCategory}
          onDropOnSub={onDropOnSub}
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
            sub={sub}
            cats={cats}
            setCategory={c => { setCategory(c); setSub(null); setSim(null); clearSel(); }}
            colorFilter={colorFilter}
            onClearColor={() => setColorFilter(null)}
            simLabel={sim ? sim.name : null}
            onClearSim={() => setSim(null)}
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
                onBoxSelect={onBoxSelect}
              />
            )}
          </div>
          <BatchBar
            count={selectedIds.size}
            cats={cats}
            mode={view === 'trash' ? 'trash' : 'normal'}
            onCategory={batchCategory}
            onFav={batchFav}
            onDragOut={() => { const id = idsOf(selectedIds)[0]; if (id) window.api.lib.dragOut(id); }}
            onDelete={() => setConfirmDel(idsOf(selectedIds))}
            onClear={clearSel}
            onRestore={() => doRestore(idsOf(selectedIds))}
            onPurge={() => setConfirmPurge({ ids: idsOf(selectedIds) })}
            onPurgeAll={() => setConfirmPurge({ ids: [], all: true })}
            onTrim={doTrim}
          />
        </main>

        <Dock
          stats={stats}
          count={items.length}
          label={category ? `${category}${sub ? ' / ' + sub : ''} / FILTERED` : VIEW_LABEL[view]}
          selected={selected}
          cats={cats}
          tree={tree}
          busy={busy}
          editSignal={editSignal}
          onFav={async id => { await window.api.lib.toggleFav(id); await refresh(); }}
          onCopy={async id => { const ok = await window.api.lib.copyImage(id); if (ok) setToast({ msg: '已复制到剪贴板，可 Ctrl+V 贴进画布' }); }}
          onReveal={id => window.api.lib.reveal(id)}
          onRemove={id => setConfirmDel([id])}
          onCategory={changeCategory}
          onSubCategory={changeSubCategory}
          onDragOut={id => window.api.lib.dragOut(id)}
          onRename={renameItem}
          onTags={setTags}
          onColorClick={hex => { setSim(null); setColorFilter(hex); }}
          onSimilar={id => { const it = items.find(i => i.id === id); setSim({ id, name: it?.name || '' }); setColorFilter(null); setCategory(null); setSub(null); clearSel(); }}
          onPin={id => window.api.pin.open(id)}
        />
      </div>

      <StatusBar root={root} total={stats.total} busy={busy} />
      <ResizeHandles />

      {fileOver && <DropVeil />}
      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxId(null)} onNav={navLightbox} />}
      {clip && <ClipCard clip={clip} onSave={saveClip} onIgnore={() => setClip(null)} />}
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {settings && (
        <div className="modal-veil" onClick={() => setSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">库设置</div>
            <div className="mp" title={root}>{root || '未初始化'}</div>
            <div className="mh">
              当前库占用 {stats.total} 张图{stats.trash ? `，回收站里还有 ${stats.trash} 张` : ''}。换目录时可以连同素材一起搬过去。
            </div>
            <div className="bridgebox">
              <div className="bh">浏览器扩展 · 右键存图</div>
              <div className="brow"><span>端口</span><b>{bridge?.port ?? '—'}</b></div>
              <div className="brow">
                <span>令牌</span>
                <b className="tk">{bridge?.token ?? '—'}</b>
                <button
                  onClick={() => bridge && navigator.clipboard?.writeText(bridge.token)}
                  title="复制令牌，填到扩展设置里"
                >复制</button>
              </div>
              <div className="brow">
                <span>目录</span>
                <b className="tk" title={bridge?.extDir}>{bridge?.extDir ?? '—'}</b>
                <button onClick={() => window.api.bridge.openExt()}>打开</button>
              </div>
              <div className="btip">
                chrome://extensions → 开「开发者模式」→「加载已解压的扩展程序」→ 选上面这个目录，再把令牌粘到扩展设置页。
              </div>
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
            <div className="mt">移出 {confirmDel.length} 张图片</div>
            <div className="mh">
              会移到<b>回收站</b>，原图还在盘上，随时可以恢复。想彻底删掉就去回收站里清空。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmDel(null)}>取消</button>
              <button className="primary" onClick={() => doDelete(confirmDel)}>移到回收站</button>
            </div>
          </div>
        </div>
      )}

      {confirmPurge && (
        <div className="modal-veil" onClick={() => setConfirmPurge(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">{confirmPurge.all ? '清空回收站' : `彻底删除 ${confirmPurge.ids.length} 张`}</div>
            <div className="mh">
              这次是<b>真删</b>：数据库记录、原图、缩略图一起删掉，<b>不可恢复</b>。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmPurge(null)}>取消</button>
              <button className="primary danger" onClick={() => doPurge(confirmPurge.ids, confirmPurge.all)}>
                {confirmPurge.all ? '清空' : '彻底删除'}
              </button>
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
              <button onClick={() => startScan(askRoot)} title="扫描这个目录里的图片文件夹，按文件夹名建分类接入">
                扫描并接入…
              </button>
              <button className="primary" onClick={() => applyRoot(true)}>复制并切换</button>
            </div>
          </div>
        </div>
      )}

      {scan && (
        <div className="modal-veil" onClick={() => setScan(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="mt">扫描并接入新目录</div>
            <div className="mp" title={scan.root}>{scan.root}</div>
            {!scan.result && <div className="mh">正在扫描这个目录里的图片…</div>}
            {scan.result?.error && <div className="mh">{scan.result.error}</div>}
            {scan.result && !scan.result.total && (
              <div className="mh">这个目录下没找到图片文件（子目录最多往下看 3 层）。</div>
            )}
            {scan.result && scan.result.total > 0 && (
              <>
                <div className="mh">
                  共找到 <b>{scan.result.total}</b> 张图。勾选要接入的文件夹，导入后<b>文件夹名 = 分类</b>、
                  二级文件夹 = 子分类；重复图会自动跳过，原图留在原地不移动。
                </div>
                <div className="scanlist">
                  {scan.result.groups.map(g => (
                    <label key={g.name} className="scanrow">
                      <input
                        type="checkbox"
                        checked={scan.picked.has(g.name)}
                        onChange={() => setScan(prev => {
                          if (!prev) return prev;
                          const p = new Set(prev.picked);
                          if (p.has(g.name)) p.delete(g.name); else p.add(g.name);
                          return { ...prev, picked: p };
                        })}
                      />
                      <span className="snm" title={g.abs}>{g.name}</span>
                      <span className="ssubs">{g.subs.length ? `${g.subs.length} 个子文件夹` : ''}</span>
                      <b className="scnt">{g.count} 张</b>
                    </label>
                  ))}
                  {scan.result.loose > 0 && (
                    <label className="scanrow">
                      <input
                        type="checkbox"
                        checked={scan.loose}
                        onChange={() => setScan(prev => prev ? { ...prev, loose: !prev.loose } : prev)}
                      />
                      <span className="snm">（根目录散落的图片）</span>
                      <span className="ssubs" />
                      <b className="scnt">{scan.result.loose} 张</b>
                    </label>
                  )}
                </div>
              </>
            )}
            <div className="mb">
              <button onClick={() => setScan(null)}>取消</button>
              <button
                className="primary"
                disabled={!scan.result || (scan.result.total === 0) || (!scan.picked.size && !scan.loose)}
                onClick={runAttach}
              >接入所选</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
