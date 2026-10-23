import { useCallback, useEffect, useRef, useState } from 'react';
import { Rail, ResizeHandles, StatusBar, TitleBar, useDebounced } from './components/Chrome';
import { Card, EmptyState, Toolbar } from './components/Stage';
import { Dock } from './components/Dock';
import { ClipCard, DropVeil, Lightbox, ToastBar } from './components/Overlays';
import type { ClipInfo, Item, Stats, Toast, Tree, View } from './types';

const EMPTY_STATS: Stats = { total: 0, inbox: 0, fav: 0, week: 0, size: 0, root: '' };

const VIEW_LABEL: Record<View, string> = {
  all: '全部素材 / ALL ITEMS',
  inbox: '待分类 / INBOX',
  fav: '收藏 / FAVORITES',
  recent: '最近使用 / RECENT'
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
  const dq = useDebounced(query, 200);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropCat, setDropCat] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [busy, setBusy] = useState('');
  const [fileOver, setFileOver] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileOverTimer = useRef<any>(null);

  const refresh = useCallback(async (opts?: { view?: View; category?: string | null; query?: string }) => {
    const v = opts?.view ?? view;
    const c = opts?.category === undefined ? category : opts.category;
    const q = opts?.query ?? dq;
    const [list, cnt, st] = await Promise.all([
      window.api.lib.list({ view: v, category: c, query: q }),
      window.api.lib.counts(),
      window.api.lib.stats()
    ]);
    setItems(list);
    setCounts(cnt || {});
    setStats(st);
  }, [view, category, dq]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    (async () => {
      const info = await window.api.lib.info();
      setRoot(info.root);
      setStats(info.stats);
      setTree(info.tree);
      await refreshRef.current();
      const isMax = await window.api.win.isMax();
      setMaximized(isMax);
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
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, []);

  useEffect(() => { refresh(); }, [view, category, dq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); doImport(); }
      if (e.key === 'Escape') { setLightboxId(null); setClip(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      if (paths.length) await window.api.lib.importPaths(paths);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', prevent);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', prevent);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const doImport = async () => {
    setBusy('选择中…');
    const r = await window.api.lib.importDialog();
    if (!r) setBusy('');
  };

  const onDropOnCategory = async (cat: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const prev = items.find(i => i.id === id);
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

  const saveClip = async () => {
    if (!clip) return;
    await window.api.lib.importFile({ file: clip.file });
    setClip(null);
    await refresh();
  };

  const selected = items.find(i => i.id === selectedId) || null;
  const lightboxItem = items.find(i => i.id === lightboxId) || null;

  return (
    <div className="win" data-ark-theme="endfield" data-ark-depth="complex">
      <TitleBar root={root} maximized={maximized} />
      <div className="app">
        <Rail view={view} setView={v => { setView(v); setCategory(null); }} stats={stats} />
        <main className="stage">
          <div className="scan" />
          <Toolbar
            ref={searchRef}
            query={query}
            setQuery={setQuery}
            tree={tree}
            counts={counts}
            category={category}
            setCategory={setCategory}
            dropCat={dropCat}
            setDropCat={setDropCat}
            onDropOnCategory={onDropOnCategory}
            onImport={doImport}
          />
          <div className="gridwrap">
            {items.length === 0 ? (
              <EmptyState query={dq} onImport={doImport} />
            ) : (
              <div className="grid">
                {items.map((it, i) => (
                  <Card
                    key={it.id}
                    it={it}
                    idx={i}
                    selected={selectedId === it.id}
                    dragging={draggingId === it.id}
                    onSelect={setSelectedId}
                    onOpen={setLightboxId}
                    onDragOut={id => window.api.lib.dragOut(id)}
                    onDragStart={setDraggingId}
                    onDragEnd={() => { setDraggingId(null); setDropCat(null); }}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
        <Dock
          stats={stats}
          count={items.length}
          label={category ? `${category} / FILTERED` : VIEW_LABEL[view]}
          selected={selected}
          tree={tree}
          busy={busy}
          onImport={doImport}
          onOpenRoot={() => window.api.lib.openRoot()}
          onFav={async id => { await window.api.lib.toggleFav(id); await refresh(); }}
          onCopy={async id => { const ok = await window.api.lib.copyImage(id); if (ok) setToast({ msg: '已复制到剪贴板，可 Ctrl+V 贴进画布' }); }}
          onReveal={id => window.api.lib.reveal(id)}
          onRemove={async id => {
            await window.api.lib.remove(id);
            setSelectedId(null);
            await refresh();
            setToast({ msg: '已移出库（文件已删除）' });
          }}
          onCategory={changeCategory}
          onDragOut={id => window.api.lib.dragOut(id)}
        />
      </div>
      <StatusBar root={root} total={stats.total} busy={busy} />
      <ResizeHandles />

      {fileOver && <DropVeil />}
      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxId(null)} />}
      {clip && <ClipCard clip={clip} onSave={saveClip} onIgnore={() => setClip(null)} />}
      <ToastBar toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
