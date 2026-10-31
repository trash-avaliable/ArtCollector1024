import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ActivityBar, ResizeHandles, StatusBar, TitleBar, useDebounced } from './components/Chrome';
import { BatchBar, EmptyState, Masonry, Toolbar } from './components/Stage';
import { Rail } from './components/Rail';
import { Dock } from './components/Dock';
import { ClipCard, DropVeil, Lightbox, ToastBar } from './components/Overlays';
import { CrawlerPanel } from './components/Crawler';
import { NoteView } from './components/Notes';
import { Settings } from './components/Settings';
import { fullPrefs, matchesAppKey, THEME_FAMILY, THEMES, type FullPrefs, type ThemeId } from './lib/settings-core';
import { CommandPalette } from './components/CommandPalette';
import { TopoBackground } from './components/TopoBackground';
import { GuideDrawer, GuideFab } from './components/Guide';
import {
  commands, dockTabs, railSections, sanitizeDockTab,
  pluginCommandEntries,
  type CommandEntry
} from './lib/layout-registry';
import {
  EMPTY_STATS, DEFAULT_VIEWS, type ClipInfo, type Item, type Note, type Prefs, type PluginInfo,
  type ScanGroup, type ScanResult, type Sort, type Stats, type Toast, type Tree, type View, type Workset
} from './types';

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
  const [worksets, setWorksets] = useState<Workset[]>([]);
  const [wsFilter, setWsFilter] = useState<string | null>(null);
  /* ---------- 笔记（RTM-S24）：左栏分区 + stage 笔记视图 + 检查器笔记 Tab ---------- */
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteAssets, setNoteAssets] = useState<Item[]>([]);
  const [noteRev, setNoteRev] = useState(0);
  const [confirmNote, setConfirmNote] = useState<Note | null>(null);
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
  const [confirmWs, setConfirmWs] = useState<Workset | null>(null);
  const [settings, setSettings] = useState(false);
  const [capture, setCapture] = useState(false);
  const [bridge, setBridge] = useState<{ port: number; token: string; extDir: string } | null>(null);
  const [prefsFull, setPrefsFull] = useState<FullPrefs>(fullPrefs(undefined));
  const [hotkeys, setHotkeys] = useState<{ bindings: Record<string, string>; registered: Record<string, boolean> } | null>(null);
  const [version, setVersion] = useState('');
  const [scan, setScan] = useState<{ root: string; result: ScanResult | null; picked: Set<string>; loose: boolean } | null>(null);
  /* ---------- 插件系统（RTM-S28）：设置页列表 + 命令面板动态条目 + toast/openAsset 事件 ---------- */
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  /* ---------- 布局重构新增状态：左栏分区/图标轨、右栏 Tab/收起、命令面板、问询抽屉 ---------- */
  const [railOpen, setRailOpen] = useState(false);
  /** 面板一次只显示一个分区（四个功能不再堆成一条长列表） */
  const [railSection, setRailSection] = useState<string>(() => railSections.ids()[0] || 'views');
  const [dockHidden, setDockHidden] = useState(false);
  /** 没有选中图时，用户仍可主动打开检查器看库概览 */
  const [statsOpen, setStatsOpen] = useState(false);
  const [dockTab, setDockTab] = useState<string>(() => sanitizeDockTab(null, dockTabs));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    window.api.bridge.info().then(setBridge).catch(() => { });
    window.api.lib.hotkeysCurrent().then(setHotkeys).catch(() => { });
    window.api.lib.version().then(setVersion).catch(() => { });
  }, [settings]);

  const searchRef = useRef<HTMLInputElement>(null);
  const fileOverTimer = useRef<any>(null);

  const loadWorksets = useCallback(async () => {
    try { setWorksets(await window.api.workset.list() || []); } catch { }
  }, []);

  /* ---------- 笔记（RTM-S24）---------- */
  const loadNotes = useCallback(async () => {
    try { setNotes(await window.api.note.list() || []); } catch { }
    setNoteRev(v => v + 1); // 检查器笔记 Tab 的重查信号
  }, []);

  const loadNoteAssets = useCallback(async (id: string | null) => {
    if (!id) { setNoteAssets([]); return; }
    try { setNoteAssets(await window.api.note.assets(id) || []); } catch { setNoteAssets([]); }
  }, []);

  /** 进/出笔记视图：笔记和分类/画板是两套视图，进笔记时清掉竖向筛选 */
  const pickNote = useCallback((id: string | null) => {
    setActiveNoteId(id);
    setCategory(null);
    setSub(null);
    setSim(null);
    setColorFilter(null);
    setWsFilter(null);
    clearSel();
    if (id) loadNoteAssets(id); else setNoteAssets([]);
  }, [loadNoteAssets]);

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
    } else if (wsFilter) {
      // 画板视图：只看该板成员（main 侧已裁成与 lib:list 一致的字段）
      const list = await window.api.workset.items(wsFilter);
      setItems(list);
    } else {
      const list = await window.api.lib.list({ view: v, category: c, subcategory: s2, query: q, sort: s });
      setItems(list);
    }
    setCounts(cnt || {});
    setStats(st);
    // 画板计数跟着库存变动（删图会 CASCADE 掉成员关系）
    await loadWorksets();
  }, [view, category, sub, dq, sort, colorFilter, sim, wsFilter, loadWorksets]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    (async () => {
      const [info, prefs] = await Promise.all([window.api.lib.info(), window.api.lib.getPrefs()]);
      setPrefsFull(fullPrefs(prefs));
      window.api.lib.hotkeysCurrent().then(setHotkeys).catch(() => { });
      window.api.lib.version().then(setVersion).catch(() => { });
      window.api.plugins.list().then(setPlugins).catch(() => { });
      setRoot(info.root);
      setStats(info.stats);
      setTree(info.tree);
      if (prefs?.railViews?.length) setRailViews(prefs.railViews);
      if (prefs?.railCats?.length) setRailCats(prefs.railCats);
      else setRailCats(info.tree.map(([c]) => c));
      // 布局偏好：dock 收起 / 激活 Tab（key 跟 railViews 同族，存 config.json prefs）
      setDockHidden(!!prefs?.dockHidden);
      setDockTab(sanitizeDockTab(prefs?.dockTab, dockTabs));
      await loadNotes();
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
    const offHk = window.api.on.hotkeysState(setHotkeys);
    const off6 = window.api.on.librarySwitched(async (p) => {
      setRoot(p.root);
      setStats(p.stats);
      setSelectedIds(new Set());
      setActiveNoteId(null); // 笔记跟着库走：换库后退出笔记视图再重载列表
      setNoteAssets([]);
      await loadNotes();
      await refreshRef.current();
    });
    const off7 = window.api.on.clipProgress(p => {
      if (p.stage === 'download') setBusy(`下载 CLIP 模型 ${p.done}/${p.total}…`);
      else setBusy(`AI 分类 ${p.done}/${p.total} · 采纳 ${p.adopted}`);
    });
    /* 插件事件（RTM-S28）：toast 直接提示；openAsset 先刷新再开灯箱 */
    const offP1 = window.api.on.pluginToast(p => setToast({ msg: `[插件] ${p.msg}` }));
    const offP2 = window.api.on.pluginOpenAsset(async p => {
      await refreshRef.current();
      setLightboxId(p.id);
    });
    return () => { off1(); off2(); off3(); off4(); off5(); offHk(); off6(); off7(); offP1(); offP2(); };
  }, []);
  useEffect(() => { refresh(); }, [view, category, sub, dq, sort, colorFilter, sim, wsFilter]);

  // 选中图片时自动亮出检查器：dock 收起/停在笔记 Tab 都是浏览态，点图 = 要看这张图（RTM-S21 反馈修复）
  // 只在「无选中 → 有选中」跃迁时触发一次：用户选中后再手动收起，保持收起不被弹回
  const dockHiddenRef = useRef(dockHidden);
  const dockTabRef = useRef(dockTab);
  const prevSelCount = useRef(0);
  useEffect(() => { dockHiddenRef.current = dockHidden; }, [dockHidden]);
  useEffect(() => { dockTabRef.current = dockTab; }, [dockTab]);
  useEffect(() => {
    const grew = selectedIds.size > 0 && prevSelCount.current === 0;
    prevSelCount.current = selectedIds.size;
    if (!grew) return;
    if (dockHiddenRef.current) {
      setDockHidden(false);
      window.api.lib.setPrefs({ dockHidden: false } as Partial<Prefs>);
    }
    if (dockTabRef.current !== 'inspector') {
      setDockTab('inspector');
      window.api.lib.setPrefs({ dockTab: 'inspector' } as Partial<Prefs>);
    }
  }, [selectedIds]);

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
      // 命令面板：快捷键可在设置里改（appKeys.palette，默认 Control+K）
      if (matchesAppKey(e, prefsFull.appKeys?.palette)) { e.preventDefault(); setCmdOpen(o => !o); return; }
      if (matchesAppKey(e, prefsFull.appKeys?.import)) { e.preventDefault(); doImport(); }
      if (e.key === 'Escape') {
        // 逐层退出：命令面板 → 问询抽屉 → 选择 → 各弹层
        if (cmdOpen) { setCmdOpen(false); return; }
        if (guideOpen) { setGuideOpen(false); return; }
        if (capture) { setCapture(false); return; }   // 采集面板关闭时自己会顺带取消运行中的任务
        if (activeNoteId) { setActiveNoteId(null); setNoteAssets([]); return; } // 笔记视图也是一层
        if (railOpen) { setRailOpen(false); return; }                          // 素材库滑出面板
        if (selectedIds.size) { setSelectedIds(new Set()); setLastId(null); return; }
        if (statsOpen) { setStatsOpen(false); return; }                        // 库概览面板
        setLightboxId(null); setClip(null);
        setConfirmDel(null); setConfirmPurge(null); setConfirmCat(null); setConfirmWs(null); setConfirmNote(null); setSettings(false);
        setWsFilter(null); // 画板视图也是一层过滤：Esc 逐层退出
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
  }, [selectedIds, items, view, category, sub, prefsFull, cmdOpen, guideOpen, capture, activeNoteId, railOpen, statsOpen]);

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

  /* ---------- 画板（工作集）---------- */
  /** 进/出画板视图：画板和分类是两套过滤，进画板时清掉竖向筛选 */
  const selectBoard = (id: string | null) => {
    setWsFilter(id);
    setCategory(null);
    setSub(null);
    setSim(null);
    setColorFilter(null);
    clearSel();
  };

  const addBoard = async (name: string) => {
    const r = await window.api.workset.create(name);
    if ('error' in r) { setToast({ msg: r.error }); return; }
    setWsFilter(r.id);
    await refresh();
    setToast({ msg: `已新建画板「${r.name}」，把图拖到左栏画板上即可加入` });
  };

  const renameBoard = async (id: string, name: string) => {
    const r = await window.api.workset.rename(id, name);
    if ('error' in r) { setToast({ msg: r.error }); return; }
    await refresh();
    setToast({ msg: `画板已改名为「${r.name}」` });
  };

  const deleteBoard = async (id: string) => {
    const ws = worksets.find(w => w.id === id);
    setConfirmWs(null);
    const r = await window.api.workset.delete(id);
    if (!r.ok) { setToast({ msg: r.error || '删除失败' }); return; }
    if (wsFilter === id) setWsFilter(null);
    await refresh();
    setToast({ msg: `已删除画板「${ws?.name || ''}」，板里 ${ws?.count ?? 0} 张图都还在库里` });
  };

  /** 加图进画板（批量条 / 检查器 / 拖拽共用）：幂等，重复加入不报错 */
  const addToBoard = async (ids: string[], wsId: string) => {
    if (!ids.length || !wsId) return;
    const ws = worksets.find(w => w.id === wsId);
    const r = await window.api.workset.addItems(wsId, ids);
    if (r.error) { setToast({ msg: r.error }); return; }
    await refresh();
    setToast({ msg: r.added ? `${r.added} 张已加入画板「${ws?.name || ''}」` : `选中的图都已经在「${ws?.name || ''}」里了` });
  };

  const removeFromBoard = async (ids: string[], wsId: string) => {
    if (!ids.length || !wsId) return;
    const ws = worksets.find(w => w.id === wsId);
    const r = await window.api.workset.removeItems(wsId, ids);
    if (r.error) { setToast({ msg: r.error }); return; }
    clearSel();
    await refresh();
    setToast({ msg: `已从「${ws?.name || ''}」移出 ${r.removed} 张（图片还在库里）` });
  };

  /** 瀑布流卡片拖到左栏画板上 = 加入该画板 */
  const onDropOnWorkset = async (wsId: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    if (!items.some(i => i.id === id && !i.deletedAt)) return;
    const ws = worksets.find(w => w.id === wsId);
    const r = await window.api.workset.addItems(wsId, [id]);
    if (r.error) { setToast({ msg: r.error }); return; }
    await refresh();
    setToast({ msg: r.added ? `已加入画板「${ws?.name || ''}」` : `这张图已经在「${ws?.name || ''}」里了` });
  };

  /* ---------- 笔记（RTM-S24）：删笔记不动图，删图 CASCADE 清关联 ---------- */
  const addNote = async (title: string) => {
    const r = await window.api.note.create(title);
    if (r?.error) { setToast({ msg: r.error }); return; }
    await loadNotes();
    if (r?.id) { setActiveNoteId(r.id); loadNoteAssets(r.id); }
    setToast({ msg: `已新建笔记「${r?.title || title}」` });
  };

  /** 自动保存共用：title / content 可只改其一 */
  const patchNote = async (id: string, patch: { title?: string; content?: string }) => {
    const r = await window.api.note.update({ id, ...patch });
    if (r?.error) { setToast({ msg: r.error }); return; }
    await loadNotes();
  };

  const deleteNote = async (id: string) => {
    setConfirmNote(null);
    const r = await window.api.note.delete(id);
    if (!r.ok) { setToast({ msg: r.error || '删除失败' }); return; }
    if (activeNoteId === id) { setActiveNoteId(null); setNoteAssets([]); }
    await loadNotes();
    setToast({ msg: `已删除笔记「${notes.find(n => n.id === id)?.title || ''}」，图片都不受影响` });
  };

  const pinNote = async (id: string) => {
    await window.api.note.pin(id);
    await loadNotes();
  };

  const linkToActiveNote = async (assetId: string) => {
    if (!activeNoteId) return;
    const r = await window.api.note.link(activeNoteId, [assetId]);
    if (r.error) { setToast({ msg: r.error }); return; }
    await loadNoteAssets(activeNoteId);
    await loadNotes();
    setToast({ msg: r.added ? '已关联进笔记' : '这张图已经关联过了' });
  };

  const unlinkFromActiveNote = async (assetId: string) => {
    if (!activeNoteId) return;
    await window.api.note.unlink(activeNoteId, [assetId]);
    await loadNoteAssets(activeNoteId);
    await loadNotes();
    setToast({ msg: '已从笔记移除（图片还在库里）' });
  };

  /** 检查器笔记 Tab：从笔记里移除当前图 */
  const unlinkNotePair = async (noteId: string, assetId: string) => {
    const r = await window.api.note.unlink(noteId, [assetId]);
    if (r.error) { setToast({ msg: r.error }); return; }
    await loadNotes();
    if (activeNoteId === noteId) await loadNoteAssets(noteId);
    setToast({ msg: '已从笔记移除该图（笔记与图片都保留）' });
  };

  /** 检查器笔记 Tab：新建笔记并关联此图 */
  const createNoteForAsset = async (assetId: string) => {
    const nm = items.find(i => i.id === assetId)?.name || '图片';
    const stem = nm.replace(/\.[a-z0-9]+$/i, '');
    const r = await window.api.note.create(`关于「${stem}」`);
    if (r?.error) { setToast({ msg: r.error }); return; }
    if (!r?.id) return;
    await window.api.note.link(r.id, [assetId]);
    await loadNotes();
    setToast({ msg: `已新建笔记「${r.title}」并关联此图` });
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

  /* ---------- 导航：左栏 / 命令面板共用同一套跳转（换筛选就清选择） ---------- */
  const gotoView = (v: View) => { setView(v); setCategory(null); setSub(null); setSim(null); setColorFilter(null); setWsFilter(null); clearSel(); };
  const gotoCategory = (c: string | null) => { setCategory(c); setSub(null); setSim(null); setColorFilter(null); setWsFilter(null); clearSel(); };

  /* 画布优先：从面板里点了导航就收回面板，让图墙重新吃满 */
  useEffect(() => { setRailOpen(false); }, [view, category, sub, wsFilter, activeNoteId]);

  /* ---------- 布局偏好写穿 prefs（StrictMode 下副作用不进 setState updater） ---------- */
  /* 画布优先：素材库是滑出面板，默认收起，靠 activity bar 唤起 */
  const toggleRail = () => setRailOpen(o => !o);
  const closeRail = () => setRailOpen(false);
  /** 分区入口（命令面板）：开面板并切到该分区 */
  const openSection = (id: string) => {
    if (railSections.has(id)) setRailSection(id);
    setRailOpen(true);
  };
  /** activity bar 点分区：同一分区再点收起，不同分区直接换页 */
  const toggleSection = (id: string) => {
    if (!railSections.has(id)) return;
    if (railOpen && railSection === id) setRailOpen(false);
    else { setRailSection(id); setRailOpen(true); }
  };
  const pickDockTab = (id: string) => {
    setDockTab(id);
    window.api.lib.setPrefs({ dockTab: id } as Partial<Prefs>);
  };

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

  const onSetPrefs = async (patch: Partial<Prefs>) => {
    const saved = await window.api.lib.setPrefs(patch);
    setPrefsFull(fullPrefs(saved));
  };

  /* ---------- 主题切换（设置 → 外观 / 命令面板）：写 prefs.ui.theme，根元素 data-theme 即时生效 ---------- */
  const theme: ThemeId = prefsFull.ui.theme;
  const setTheme = (id: ThemeId) => {
    if (id === theme) return;
    void onSetPrefs({ ui: { ...prefsFull.ui, theme: id } });
  };

  // 根元素之外（body 背景 / 原生滚动条 / 原生控件）也要吃到主题变量
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 主题切换瞬间：根元素挂一次性 .theme-swap，色彩 300ms 平滑过渡（非跳变），320ms 后摘除
  const themeSwapTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('theme-swap');
    window.clearTimeout(themeSwapTimer.current);
    themeSwapTimer.current = window.setTimeout(() => el.classList.remove('theme-swap'), 340);
    return () => window.clearTimeout(themeSwapTimer.current);
  }, [theme]);

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

  /* ---------- CLIP 零样本 AI 分类：主进程跑模型，达标才写库，检查器里可看到建议 ---------- */
  const runClip = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy('AI 分类启动中…');
    const r = await window.api.clip.classify(ids);
    setBusy('');
    await refresh();
    if (r?.error) { setToast({ msg: 'AI 分类失败：' + r.error }); return; }
    const skipped = r.total - r.adopted;
    setToast({
      msg: `AI 分类完成：${r.adopted}/${r.total} 张达阈值写入了建议`
        + (skipped ? `，${skipped} 张分数不够没写` : '')
    });
  };

  const clipInbox = async () => {
    // “全部待分类”以库里为准（不受当前搜索影响）
    const all = await window.api.lib.list({ view: 'inbox', sort: 'new' });
    await runClip(all.map(i => i.id));
  };

  const selected = items.find(i => i.id === selectedIds.values().next().value) || null;
  /** 检查器浮层可见性：有选中或用户主动看库概览，且没被手动收起 */
  const inspectorVisible = !dockHidden && (!!selected || statsOpen);
  /* 标题栏 / 命令面板共用的检查器开关：开则浮层滑出，关则画布吃满 */
  const toggleDockHidden = () => {
    if (inspectorVisible) {
      setStatsOpen(false);
      setDockHidden(true);
      window.api.lib.setPrefs({ dockHidden: true } as Partial<Prefs>);
      return;
    }
    setDockHidden(false);
    if (!selected) setStatsOpen(true);
    window.api.lib.setPrefs({ dockHidden: false } as Partial<Prefs>);
  };
  const openInspector = () => {
    setDockHidden(false);
    if (!selected) setStatsOpen(true);
    window.api.lib.setPrefs({ dockHidden: false } as Partial<Prefs>);
  };
  const lightboxPool = activeNoteId ? noteAssets : items;
  const lightboxItem = lightboxPool.find(i => i.id === lightboxId) || null;
  const cats = tree.map(([c]) => c);
  

  const navLightbox = (dir: -1 | 1) => {
    if (!lightboxId) return;
    const i = lightboxPool.findIndex(x => x.id === lightboxId);
    if (i < 0) return;
    const n = lightboxPool[(i + dir + lightboxPool.length) % lightboxPool.length];
    if (n) setLightboxId(n.id);
  };

  const wsName = useMemo(() => worksets.find(w => w.id === wsFilter)?.name || null, [worksets, wsFilter]);
  const activeNote = useMemo(() => notes.find(n => n.id === activeNoteId) || null, [notes, activeNoteId]);

  const crumb = useMemo(() => {
    if (activeNote) return ['库', `笔记「${activeNote.title}」`, `${notes.length} 条笔记`].join('  /  ');
    const parts = ['库'];
    if (sim) {
      parts.push(`相似于「${sim.name}」`);
    } else if (wsName) {
      parts.push(`画板「${wsName}」`);
    } else {
      if (colorFilter) parts.push(`颜色 ${colorFilter}`);
      if (category) parts.push(sub ? `${category} / ${sub}` : category);
      else parts.push(VIEW_LABEL[view]);
    }
    if (dq) parts.push(`搜索「${dq}」`);
    parts.push(`${items.length} 项`);
    return parts.join('  /  ');
  }, [activeNote, notes.length, category, sub, view, dq, items.length, colorFilter, sim, wsName]);

  const fadeKey = `${view}|${category}|${sub}|${dq}|${sort}|${colorFilter}|${sim?.id || ''}`;
  // 首屏保留交错进入动画；之后任何筛选切换都不再重播（重挂载时不闪骨架）
  const bootKeyRef = useRef<string | null>(null);
  if (bootKeyRef.current === null) bootKeyRef.current = fadeKey;
  const animateIn = fadeKey === bootKeyRef.current;

  /* ---------- 命令面板（Ctrl+K）：静态注册 + 动态（分类 / 画板） ---------- */
  // EXTENSION-COMMAND: 动作映射表。未来功能的命令（网页采集 / 问询…）
  // 在 layout-registry.ts 的 commands 里注册 def，再在这里补一个同 id 的 handler 即可
  // （笔记 act.notes 已照此接入）；动态条目（分类 / 画板）不进注册表，按当前库内容在下面即时拼装。
  const commandHandlers: Record<string, () => void> = {
    'view.all': () => gotoView('all'),
    'view.inbox': () => gotoView('inbox'),
    'view.fav': () => gotoView('fav'),
    'view.recent': () => gotoView('recent'),
    'view.trash': () => gotoView('trash'),
    'act.import': doImport,
    'act.capture': () => setCapture(true),
    'act.notes': () => pickNote(notes[0]?.id || null),
    'act.settings': () => setSettings(true),
    'layout.rail': toggleRail,
    'layout.section.views': () => openSection('views'),
    'layout.section.categories': () => openSection('categories'),
    'layout.section.boards': () => openSection('boards'),
    'layout.section.notes': () => openSection('notes'),
    'layout.dock-hidden': toggleDockHidden,
    'layout.guide': () => setGuideOpen(true)
  };
  /* 五条「切换主题」命令（RTM-S29）：layout.theme.<id> 与 layout-registry 注册一一对应 */
  for (const t of THEMES) commandHandlers[`layout.theme.${t.id}`] = () => setTheme(t.id);
  /* ---------- 插件命令（RTM-S28）：主进程跑插件 run()，完成后刷新库（import 类命令会改库存） ---------- */
  const runPluginCommand = async (pluginId: string, cmdId: string) => {
    try {
      const r = await window.api.plugins.runCommand(pluginId, cmdId);
      if (r && !r.ok) setToast({ msg: `插件命令失败：${r.error || '未知错误'}` });
      else await refreshRef.current();
    } catch (err: any) {
      setToast({ msg: '插件命令失败：' + (err?.message || err) });
    }
  };
  /** 设置页启停开关：主进程写 prefs.plugins.enabled 并加载/卸载沙盒，返回最新列表 */
  const togglePlugin = async (id: string, enabled: boolean) => {
    try { setPlugins(await window.api.plugins.setEnabled(id, enabled) || []); }
    catch { setToast({ msg: '插件启停失败' }); }
  };

  const commandEntries: CommandEntry[] = (() => {
    const list: CommandEntry[] = commands.list().map(def => ({
      def,
      run: () => { const h = commandHandlers[def.id]; if (h) h(); }
    }));
    tree.forEach(([c]) => list.push({
      def: { id: `cat.${c}`, title: `跳转：分类「${c}」`, group: 'category', keywords: [c], order: 30 },
      run: () => gotoCategory(c)
    }));
    worksets.forEach(w => list.push({
      def: { id: `ws.${w.id}`, title: `跳转：画板「${w.name}」`, group: 'board', keywords: [w.name], order: 40 },
      run: () => selectBoard(w.id)
    }));
    // 插件命令（RTM-S28）：id = plugin.<pid>.<cmdId>，只挂已加载且启用的插件
    pluginCommandEntries(
      plugins.filter(p => p.loaded && !p.disabled).map(p => ({
        pluginId: p.id, pluginName: p.name, commands: p.commands
      })),
      (pid, cmdId) => { void runPluginCommand(pid, cmdId); }
    ).forEach(e => list.push(e));
    return list;
  })();
  const runCommand = (entry: CommandEntry) => { setCmdOpen(false); entry.run(); };

  return (
    <div
      className="win"
      data-theme={theme}
      data-ark-theme={THEME_FAMILY[theme]}
      data-ark-depth="complex"
      data-density={prefsFull.ui.density}
      data-reduce={prefsFull.ui.reducedMotion ? '1' : '0'}
      data-dockhide={inspectorVisible ? '0' : '1'}
    >
      <TitleBar
        crumb={crumb}
        maximized={maximized}
        onSettings={() => setSettings(true)}
        dockHidden={!inspectorVisible}
        onToggleDock={toggleDockHidden}
      />
      <div
        className="app"
        data-rail={railOpen ? 'open' : 'closed'}
        data-dock={inspectorVisible ? 'open' : 'closed'}
      >
        <ActivityBar
          open={railOpen}
          activeSection={railSection}
          sections={railSections.list()}
          onToggleLib={toggleRail}
          onPickSection={toggleSection}
          onCommand={() => setCmdOpen(true)}
        />
        <div className={'veil-panel' + (railOpen ? ' on' : '')} onClick={closeRail} aria-hidden="true" />
        <div className={'railwrap' + (railOpen ? ' open' : '')} data-sec={railSection}>
        <Rail
          view={view}
          setView={v => gotoView(v)}
          stats={stats}
          tree={tree}
          counts={counts}
          category={category}
          setCategory={gotoCategory}
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
          worksets={worksets}
          wsFilter={wsFilter}
          onPickWorkset={selectBoard}
          onAddWorkset={addBoard}
          onRenameWorkset={renameBoard}
          onDeleteWorkset={id => setConfirmWs(worksets.find(w => w.id === id) || null)}
          onDropOnWorkset={onDropOnWorkset}
          notes={notes}
          activeNoteId={activeNoteId}
          onPickNote={pickNote}
          onAddNote={addNote}
          onRenameNote={(id, title) => patchNote(id, { title })}
          onDeleteNote={id => setConfirmNote(notes.find(n => n.id === id) || null)}
          onPinNote={pinNote}
          onClose={closeRail}
          activeSection={railSection}
          onPickSection={setRailSection}
          dragging={!!draggingId}
        />
        </div>

        <main className="stage">
          <TopoBackground />
          {busy && <div className="scan" />}
          {activeNoteId ? (
            /* 笔记视图（RTM-S24）：左列笔记列表 + 右侧编辑器 + 关联图片，点缩略图开灯箱 */
            <NoteView
              notes={notes}
              activeId={activeNoteId}
              assets={noteAssets}
              onPick={pickNote}
              onCreate={addNote}
              onPatch={patchNote}
              onDelete={id => setConfirmNote(notes.find(n => n.id === id) || null)}
              onPin={pinNote}
              onLink={linkToActiveNote}
              onUnlink={unlinkFromActiveNote}
              onOpenAsset={setLightboxId}
              onBack={() => { setActiveNoteId(null); setNoteAssets([]); }}
            />
          ) : (
            <>
              <Toolbar
                ref={searchRef}
                query={query}
                setQuery={setQuery}
                sort={sort}
                setSort={setSort}
                category={category}
                sub={sub}
                cats={cats}
                setCategory={c => { setCategory(c); setSub(null); setSim(null); setColorFilter(null); setWsFilter(null); clearSel(); }}
                colorFilter={colorFilter}
                onClearColor={() => setColorFilter(null)}
                simLabel={sim ? sim.name : null}
                onClearSim={() => setSim(null)}
                worksetLabel={wsName}
                onClearWorkset={() => selectBoard(null)}
                onImport={doImport}
                onImportTo={importTo}
                onCapture={() => setCapture(true)}
                onClipInbox={view === 'inbox' && !category && !sim && !colorFilter && stats.inbox > 0 ? clipInbox : undefined}
              />
              <div className="gridwrap">
                {items.length === 0 ? (
                  <EmptyState query={dq} onImport={doImport} />
                ) : (
                  <Masonry
                    items={items}
                    fadeKey={fadeKey}
                    animateIn={animateIn}
                    selectedIds={selectedIds}
                    draggingId={draggingId}
                    onSelect={onSelect}
                    onOpen={setLightboxId}
                    onDragOut={id => window.api.lib.dragOut(id)}
                    onDragStart={id => { setDraggingId(id); setRailOpen(true); }}
                    onDragEnd={() => { setDraggingId(null); setDropCat(null); setRailOpen(false); }}
                    onBoxSelect={onBoxSelect}
                  />
                )}
              </div>
            </>
          )}
          <BatchBar
            count={selectedIds.size}
            cats={cats}
            worksets={worksets}
            mode={view === 'trash' ? 'trash' : 'normal'}
            wsActive={!!wsFilter}
            onCategory={batchCategory}
            onAddToWorkset={wsId => addToBoard(idsOf(selectedIds), wsId)}
            onRemoveFromWorkset={() => wsFilter && removeFromBoard(idsOf(selectedIds), wsFilter)}
            onFav={batchFav}
            onDragOut={() => { const id = idsOf(selectedIds)[0]; if (id) window.api.lib.dragOut(id); }}
            onDelete={() => setConfirmDel(idsOf(selectedIds))}
            onClear={clearSel}
            onRestore={() => doRestore(idsOf(selectedIds))}
            onPurge={() => setConfirmPurge({ ids: idsOf(selectedIds) })}
            onPurgeAll={() => setConfirmPurge({ ids: [], all: true })}
            onTrim={doTrim}
            onClip={() => runClip(idsOf(selectedIds))}
          />
        </main>

        <Dock
          stats={stats}
          count={items.length}
          label={wsName ? `画板「${wsName}」/ BOARD` : category ? `${category}${sub ? ' / ' + sub : ''} / FILTERED` : VIEW_LABEL[view]}
          selected={selected}
          cats={cats}
          tree={tree}
          busy={busy}
          editSignal={editSignal}
          worksets={worksets}
          dockTab={dockTab}
          onTab={pickDockTab}
          onFav={async id => { await window.api.lib.toggleFav(id); await refresh(); }}
          onCopy={async id => { const ok = await window.api.lib.copyImage(id); if (ok) setToast({ msg: '已复制到剪贴板，可 Ctrl+V 贴进画布' }); }}
          onReveal={id => window.api.lib.reveal(id)}
          onRemove={id => setConfirmDel([id])}
          onCategory={changeCategory}
          onSubCategory={changeSubCategory}
          onDragOut={id => window.api.lib.dragOut(id)}
          onSendToPs={async id => {
            setBusy('正在送入 PS…');
            try {
              const r = await window.api.lib.sendToPs(id);
              if (r?.ok) setToast({ msg: '已贴进 PS 当前画布（新图层）' });
              else if (r?.copied) setToast({ msg: 'PS 未响应，已复制图片，到 PS 里 Ctrl+V' });
              else setToast({ msg: 'PS 没连上，图片复制也失败了，试试「拖入画布」' });
            } catch (err: any) {
              setToast({ msg: '送入 PS 失败：' + (err?.message || err) });
            } finally {
              setBusy('');
            }
          }}
          onRename={renameItem}
          onTags={setTags}
          onColorClick={hex => { setSim(null); setColorFilter(hex); setWsFilter(null); }}
          onSimilar={id => { const it = items.find(i => i.id === id); setSim({ id, name: it?.name || '' }); setColorFilter(null); setCategory(null); setSub(null); setWsFilter(null); clearSel(); }}
          onPin={id => window.api.pin.open(id)}
          onAddToWorkset={(id, wsId) => addToBoard([id], wsId)}
          onRemoveFromWorkset={(id, wsId) => removeFromBoard([id], wsId)}
          noteRev={noteRev}
          onUnlinkNote={unlinkNotePair}
          onCreateNoteForAsset={createNoteForAsset}
          onOpenNote={pickNote}
          open={inspectorVisible}
          onClose={toggleDockHidden}
        />
        {!inspectorVisible && (
          <button className="inspector-tab" onClick={openInspector} title="打开检查器（库概览）" aria-label="打开检查器">
            <span className="it-l">INSPECTOR</span>
            <b>{stats.total}</b>
            <span className="it-c">ITEMS</span>
          </button>
        )}
      </div>

      <StatusBar root={root} total={stats.total} busy={busy} />
      <ResizeHandles />

      {/* 问询 agent 落位：FAB + 抽屉骨架（只留位，不实现问答） */}
      <GuideFab open={guideOpen} onToggle={() => setGuideOpen(o => !o)} />
      <GuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* 网页采集 agent：对话式补全 + 合规护栏，入库后 refresh 复用 import:done 的刷新模式 */}
      <CrawlerPanel
        open={capture}
        prefs={prefsFull}
        onSetPrefs={onSetPrefs}
        onDone={async (s) => {
          await refreshRef.current();
          setToast({ msg: s.imported ? `采集入库 ${s.imported} 张（来源 URL 已归档）` : '这次没采到可入库的图' });
        }}
        onClose={() => setCapture(false)}
      />

      {/* 命令面板：未来功能的统一入口 */}
      <CommandPalette open={cmdOpen} entries={commandEntries} onClose={() => setCmdOpen(false)} onRun={runCommand} />

      {fileOver && <DropVeil />}
      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxId(null)} onNav={navLightbox} />}
      {clip && <ClipCard clip={clip} onSave={saveClip} onIgnore={() => setClip(null)} />}
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {settings && (
        <Settings
          root={root}
          stats={stats}
          bridge={bridge}
          prefs={prefsFull}
          hotkeys={hotkeys}
          version={version}
          plugins={plugins}
          onTogglePlugin={togglePlugin}
          onSetPrefs={onSetPrefs}
          onPickRoot={pickRoot}
          onOpenRoot={() => window.api.lib.openRoot()}
          onOpenExt={() => window.api.bridge.openExt()}
          onOpenLogs={() => window.api.lib.openLogs()}
          onClose={() => setSettings(false)}
        />
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

      {confirmWs && (
        <div className="modal-veil" onClick={() => setConfirmWs(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">删除画板「{confirmWs.name}」</div>
            <div className="mh">
              画板是临时的横向分组：删掉的只是这个<b>分组关系</b>，板里的 {confirmWs.count} 张图<b>不受影响</b>，还在库里和原分类中。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmWs(null)}>取消</button>
              <button className="primary danger" onClick={() => deleteBoard(confirmWs.id)}>删除画板</button>
            </div>
          </div>
        </div>
      )}

      {confirmNote && (
        <div className="modal-veil" onClick={() => setConfirmNote(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">删除笔记「{confirmNote.title}」</div>
            <div className="mh">
              笔记的<b>正文与 {confirmNote.assetCount} 条图片关联</b>会一并清除；
              关联的图片<b>不受影响</b>，还好好在库里。
            </div>
            <div className="mb">
              <button onClick={() => setConfirmNote(null)}>取消</button>
              <button className="primary danger" onClick={() => deleteNote(confirmNote.id)}>删除笔记</button>
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
