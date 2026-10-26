import type { CSSProperties } from 'react';

export type Item = {
  id: string;
  sha: string;
  name: string;
  w: number;
  h: number;
  /** 原始画布尺寸（w/h 是裁掉白边后的内容尺寸） */
  cw?: number;
  ch?: number;
  cropL?: number;
  cropT?: number;
  cropR?: number;
  cropB?: number;
  trimmed?: boolean;
  /** 动图标记：GIF 多帧 / 动态 WebP / APNG（主进程解析字节得出） */
  animated?: boolean;
  size: number;
  addedAt: number;
  usedAt: number;
  category: string;
  subcategory: string;
  tags: string[];
  source: string;
  sourceUrl: string;
  favorite: boolean;
  ext: string;
  hasThumb: boolean;
  fname?: string;
  deletedAt?: number;
  simScore?: number;
};

export type ScanGroup = {
  name: string;
  count: number;
  abs: string;
  subs: { name: string; count: number; abs: string }[];
  directFiles: number;
};
export type ScanResult = { groups: ScanGroup[]; loose: number; total: number; error: string };
export type AttachGroup =
  | { name: string; count: number; abs: string; subs: { name: string; count: number; abs: string }[] }
  | { loose: true };

export type Stats = {
  total: number;
  inbox: number;
  fav: number;
  week: number;
  size: number;
  trash?: number;
  trashSize?: number;
  root: string;
};

export type View = 'all' | 'inbox' | 'fav' | 'recent' | 'trash';

export type Tree = [string, string[]][];

export type PaletteColor = { hex: string; l: number; a: number; b: number; pct: number };

export type Toast = { msg: string; undo?: () => void } | null;

export type ClipInfo = { file: string; width: number; height: number; dataUrl: string };

export type Sort = 'new' | 'old' | 'name' | 'size';

export type Prefs = { railViews?: View[]; railCats?: string[] };

export type ColorHit = { hex: string; dist: number; pct: number };

export const DEFAULT_VIEWS: View[] = ['all', 'inbox', 'fav', 'recent'];

export const EMPTY_STATS: Stats = { total: 0, inbox: 0, fav: 0, week: 0, size: 0, trash: 0, trashSize: 0, root: '' };

declare global {
  interface Window {
    api: {
      win: {
        minimize(): Promise<void>;
        toggleMax(): Promise<boolean>;
        close(): Promise<void>;
        isMax(): Promise<boolean>;
        resizeBy(edge: string, dx: number, dy: number): void;
        onState(cb: (s: { maximized: boolean }) => void): () => void;
      };
      lib: {
        info(): Promise<{ root: string; stats: Stats; tree: Tree }>;        list(opts: any): Promise<Item[]>;
        stats(): Promise<Stats>;
        counts(): Promise<Record<string, number>>;
        importDialog(opts?: { category?: string; subcategory?: string }): Promise<{ added: number; dup: number; failed: number; total: number } | null>;
        importPaths(payload: string[] | { paths: string[]; category?: string; subcategory?: string }): Promise<any>;
        importFile(payload: { file: string; category?: string; subcategory?: string }): Promise<any>;
        cats(): Promise<Tree>;
        saveCats(list: Tree): Promise<Tree>;
        renameCat(p: { from: string; to: string }): Promise<number>;
        dropCat(name: string): Promise<number>;
        removeMany(ids: string[]): Promise<{ n: number; stats: Stats }>;
        restoreMany(ids: string[]): Promise<{ n: number; stats: Stats }>;
        purgeMany(ids: string[]): Promise<{ n: number; stats: Stats }>;
        purgeAll(): Promise<{ n: number; stats: Stats }>;
        similar(p: { id: string; limit?: number }): Promise<(Item & { simScore: number })[]>;
        pickColor(p: { id: string; x: number; y: number }): Promise<{ hex: string; x: number; y: number } | null>;
        setCategoryMany(p: { ids: string[]; category: string; subcategory?: string }): Promise<number>;
        toggleFavMany(p: { ids: string[]; value: boolean }): Promise<number>;
        setTags(p: { id: string; tags: string[] }): Promise<{ id: string; tags: string[] } | null>;
        setCategory(p: { id: string; category: string; subcategory?: string }): Promise<any>;
        toggleFav(id: string): Promise<any>;
        remove(id: string): Promise<any>;
        reveal(id: string): Promise<boolean>;
        openRoot(): Promise<void>;
        pickRoot(): Promise<string | null>;
        applyRoot(p: { root: string; migrate: boolean }): Promise<{ root: string; stats: Stats }>;
        scanRoot(dir: string): Promise<ScanResult>;
        attachScan(p: { root: string; groups: AttachGroup[] }): Promise<any>;
        trimMany(ids: string[]): Promise<{ n: number; changed: number }>;
        rename(id: string, name: string): Promise<{ item?: Item; error?: string }>;
        getPrefs(): Promise<Prefs>;
        setPrefs(patch: Partial<Prefs>): Promise<Prefs>;
        copyImage(id: string): Promise<boolean>;
        colors(id: string): Promise<PaletteColor[]>;
        searchColors(opts: { colors: (string | { hex: string; weight?: number })[]; threshold?: number; limit?: number; category?: string | null }): Promise<(Item & { colorScore: number; matched: { hex: string; dist: number; pct: number }[] })[]>;
        dragOut(id: string): void;
        pathForFile(file: File): string;
      };
      pin: {
        open(id: string): Promise<boolean>;
        close(): Promise<void>;
        setOpacity(v: number): void;
        setIgnore(v: boolean): void;
      };
      bridge: {
        info(): Promise<{ port: number; token: string; extDir: string }>;
        openExt(): Promise<void>;
      };
      on: {
        importProgress(cb: (p: { done: number; total: number; added: number }) => void): () => void;
        importDone(cb: (p: any) => void): () => void;
        clipImage(cb: (c: ClipInfo) => void): () => void;
        focusSearch(cb: () => void): () => void;
        saveClip(cb: () => void): () => void;
        librarySwitched(cb: (p: { root: string; stats: Stats }) => void): () => void;
      };
    };
  }
}

export const thumbUrl = (it: Item) =>
  it.hasThumb ? `refimg://thumb/${it.sha}` : `refimg://orig/${it.sha}`;
export const origUrl = (it: Item) => `refimg://orig/${it.sha}`;

/* ---------- 动图 / 白边裁剪共享工具（卡片、灯箱、检查器预览共用） ---------- */

export type CropBox = {
  cl: number; ct: number; cr: number; cb: number;
  cropped: boolean;
  /** 原始画布尺寸 */
  W: number; H: number;
};

/** 把裁剪元数据整理成各处都能用的形态 */
export function cropOf(it: Item): CropBox {
  const cl = Math.max(0, it.cropL || 0), ct = Math.max(0, it.cropT || 0);
  const cr = Math.max(0, it.cropR || 0), cb = Math.max(0, it.cropB || 0);
  return {
    cl, ct, cr, cb,
    cropped: cl + ct + cr + cb > 0,
    W: it.cw || it.w, H: it.ch || it.h
  };
}

/**
 * 裁白边显示的内层原图样式：外层容器按内容比例占位（overflow hidden），
 * 内层 img 用负偏移把白边推出视口。未裁剪返回 null。
 * 灯箱与检查器预览共用，保证两处裁剪表现一致。
 */
export function cropImgStyle(it: Item): CSSProperties | null {
  const { cl, ct, cropped, W, H } = cropOf(it);
  if (!cropped) return null;
  const fx = it.w / Math.max(1, W), fy = it.h / Math.max(1, H);
  return {
    position: 'absolute',
    left: `${-(cl / Math.max(1, it.w)) * 100}%`,
    top: `${-(ct / Math.max(1, it.h)) * 100}%`,
    width: `${(1 / fx) * 100}%`,
    height: `${(1 / fy) * 100}%`,
    objectFit: 'fill'
  };
}

/** 动图角标文案：GIF 显示「GIF」，动态 WebP / APNG 显示「动」，静态图返回 null */
export function animLabel(it: Item): string | null {
  if (!it.animated) return null;
  return it.ext === '.gif' ? 'GIF' : '动';
}

export const fmtSize = (n: number) => {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
};

export const fmtDate = (t: number) => {
  if (!t) return '—';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};
