export type Item = {
  id: string;
  sha: string;
  name: string;
  w: number;
  h: number;
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
};

export type Stats = {
  total: number;
  inbox: number;
  fav: number;
  week: number;
  size: number;
  root: string;
};

export type View = 'all' | 'inbox' | 'fav' | 'recent';

export type Tree = [string, string[]][];

export type PaletteColor = { hex: string; l: number; a: number; b: number; pct: number };

export type Toast = { msg: string; undo?: () => void } | null;

export type ClipInfo = { file: string; width: number; height: number; dataUrl: string };

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
        info(): Promise<{ root: string; stats: Stats; tree: Tree }>;
        list(opts: any): Promise<Item[]>;
        stats(): Promise<Stats>;
        counts(): Promise<Record<string, number>>;
        importDialog(): Promise<{ added: number; dup: number; failed: number; total: number } | null>;
        importPaths(paths: string[]): Promise<any>;
        importFile(payload: { file: string; category?: string; subcategory?: string }): Promise<any>;
        setCategory(p: { id: string; category: string; subcategory?: string }): Promise<any>;
        toggleFav(id: string): Promise<any>;
        remove(id: string): Promise<any>;
        reveal(id: string): Promise<boolean>;
        openRoot(): Promise<void>;
        chooseRoot(): Promise<any>;
        copyImage(id: string): Promise<boolean>;
        colors(id: string): Promise<PaletteColor[]>;
        searchColors(opts: { colors: (string | { hex: string; weight?: number })[]; threshold?: number; limit?: number; category?: string | null }): Promise<(Item & { colorScore: number; matched: { hex: string; dist: number; pct: number }[] })[]>;
        dragOut(id: string): void;
        pathForFile(file: File): string;
      };
      on: {
        importProgress(cb: (p: { done: number; total: number; added: number }) => void): () => void;
        importDone(cb: (p: any) => void): () => void;
        clipImage(cb: (c: ClipInfo) => void): () => void;
        focusSearch(cb: () => void): () => void;
        saveClip(cb: () => void): () => void;
      };
    };
  }
}

export const thumbUrl = (it: Item) =>
  it.hasThumb ? `refimg://thumb/${it.sha}` : `refimg://orig/${it.sha}`;
export const origUrl = (it: Item) => `refimg://orig/${it.sha}`;

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
