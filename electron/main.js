'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut,
  clipboard, dialog, shell, screen, protocol, net, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { store, TREE } = require('./store');

const ASSETS = path.join(__dirname, '..', 'assets');
const isDev = !!process.env.VITE_DEV;

if (process.env.RC_NOGPU === '1') {
  try { app.disableHardwareAcceleration(); } catch { }
}

let win = null;
let tray = null;
let quitting = false;
let clipTimer = null;
let clipPaused = false;
let lastClipHash = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'refimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  const def = { width: 1360, height: 880, x: undefined, y: undefined, maximized: false };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const b = d.workArea;
      return s.x !== undefined && s.x + 120 > b.x && s.x < b.x + b.width - 120 &&
        s.y + 80 > b.y && s.y < b.y + b.height - 80;
    });
    if (!visible) { s.x = undefined; s.y = undefined; }
    return { ...def, ...s };
  } catch { return def; }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
  const s = { ...b, maximized: win.isMaximized() };
  try { fs.writeFileSync(stateFile(), JSON.stringify(s)); } catch { }
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    thickFrame: false,
    show: false,
    backgroundColor: '#eef0ea',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  if (st.maximized) win.maximize();

  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => { win.show(); });
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.on('resize', () => win.webContents.send('win:state', { maximized: win.isMaximized() }));

  win.on('close', (e) => {
    saveState();
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('RefCollector · 参考图收集器');
  const menu = Menu.buildFromTemplate([
    { label: '打开收集器', click: showWindow },
    { type: 'separator' },
    { label: '暂停 / 恢复剪贴板监听', click: () => { clipPaused = !clipPaused; } },
    { label: '打开库目录', click: () => shell.openPath(store.root) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
}

let backfilling = false;
async function startPaletteBackfill() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (;;) {
      const n = await store.backfillPalettes({ limit: 8 });
      if (!n) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch (e) {
    console.error('palette backfill failed', e);
  } finally {
    backfilling = false;
  }
}

function startClipWatch() {  clipTimer = setInterval(() => {
    if (clipPaused || !win || win.isDestroyed()) return;
    try {
      const img = clipboard.readImage();
      if (!img || img.isEmpty()) return;
      const png = img.toPNG();
      const hash = require('crypto').createHash('sha1').update(png).digest('hex');
      if (hash === lastClipHash) return;
      lastClipHash = hash;
      const dir = path.join(app.getPath('userData'), 'clip');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, hash + '.png');
      if (!fs.existsSync(file)) fs.writeFileSync(file, png);
      const { width, height } = img.getSize();
      win.webContents.send('clip:image', { file, width, height, dataUrl: img.resize({ width: 220 }).toDataURL() });
    } catch { }
  }, 700);
}

app.requestSingleInstanceLock();
app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  await store.init();
  if (process.env.RC_SEED) {
    try { await store.importPaths([process.env.RC_SEED]); } catch (e) { console.error('seed failed', e); }
  }

  protocol.handle('refimg', async (req) => {
    try {
      const u = new URL(req.url);
      const kind = u.hostname;
      const sha = decodeURIComponent(u.pathname.replace(/^\//, ''));
      let file = null;
      if (kind === 'thumb') file = store.resolveThumb(sha);
      else {
        const it = store.getBySha(sha);
        if (it) file = store.itemFile(it);
      }
      if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  createWindow();
  buildTray();
  startClipWatch();
  startPaletteBackfill();

  if (process.env.RC_SHOT) {
    const target = process.env.RC_SHOT;
    const shoot = () => {
      setTimeout(async () => {
        try {
          if (process.env.RC_SHOT_JS) {
            const r = await win.webContents.executeJavaScript(process.env.RC_SHOT_JS, true);
            if (r !== undefined) console.log('JS_RESULT', JSON.stringify(r));
            await new Promise(r2 => setTimeout(r2, 900));
          }
          let img;
          if (process.env.RC_SHOT_RECT) {
            const [x, y, width, height] = process.env.RC_SHOT_RECT.split(',').map(Number);
            img = await win.webContents.capturePage({ x, y, width, height });
          } else {
            img = await win.webContents.capturePage();
          }
          fs.writeFileSync(target, img.toPNG());
          console.log('SHOT_SAVED', target);
        } catch (e) { console.error('shot failed', e); }
        quitting = true;
        app.exit(0);
      }, 2600);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', shoot);
    else shoot();
  }

  globalShortcut.register('Alt+Space', () => {
    showWindow();
    if (win && !win.webContents.isLoading()) win.webContents.send('ui:focus-search');
  });
  globalShortcut.register('Control+Shift+S', () => {
    if (win) win.webContents.send('ui:save-clip');
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { quitting = true; store.flush(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (clipTimer) clearInterval(clipTimer); });
app.on('window-all-closed', () => { });

ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('win:toggle-max', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
  return w.isMaximized();
});
ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
ipcMain.handle('win:is-max', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isMaximized());

ipcMain.on('win:resize-by', (e, { edge, dx, dy }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isMaximized()) return;
  const b = w.getBounds();
  let { x, y, width, height } = b;
  const MIN_W = 960, MIN_H = 640;
  if (edge.includes('e')) width = Math.max(MIN_W, width + dx);
  if (edge.includes('s')) height = Math.max(MIN_H, height + dy);
  if (edge.includes('w')) {
    const nw = Math.max(MIN_W, width - dx);
    x = x + (width - nw); width = nw;
  }
  if (edge.includes('n')) {
    const nh = Math.max(MIN_H, height - dy);
    y = y + (height - nh); height = nh;
  }
  w.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
});

ipcMain.handle('lib:info', () => ({
  root: store.root,
  stats: store.stats(),
  tree: TREE
}));

ipcMain.handle('lib:list', (e, opts) => {
  const items = store.list(opts || {});
  return items.map(it => ({
    id: it.id, sha: it.sha, name: it.name, w: it.w, h: it.h, size: it.size,
    addedAt: it.addedAt, usedAt: it.usedAt, category: it.category,
    subcategory: it.subcategory, tags: it.tags, source: it.source,
    sourceUrl: it.sourceUrl, favorite: it.favorite, ext: it.ext, hasThumb: it.hasThumb
  }));
});

ipcMain.handle('lib:import-dialog', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, {
    title: '导入参考图',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return runImport(e.sender, r.filePaths);
});

async function runImport(sender, paths) {
  const res = await store.importPaths(paths, (p) => {
    if (!sender.isDestroyed()) sender.send('import:progress', p);
  });
  if (!sender.isDestroyed()) sender.send('import:done', { ...res, stats: store.stats() });
  return res;
}

ipcMain.handle('lib:import-paths', async (e, paths) => runImport(e.sender, paths));

ipcMain.handle('lib:import-file', async (e, { file, category, subcategory }) => {
  const ok = await store.importOne(file, { category, subcategory, name: path.basename(file) });
  store.save();
  if (!e.sender.isDestroyed()) e.sender.send('import:done', { added: ok === true ? 1 : 0, dup: ok === 'dup' ? 1 : 0, failed: 0, total: 1, stats: store.stats() });
  return ok;
});

ipcMain.handle('lib:set-category', (e, { id, category, subcategory }) => {
  const it = store.setCategory(id, category, subcategory);
  return it ? { id: it.id, category: it.category, subcategory: it.subcategory } : null;
});

ipcMain.handle('lib:toggle-fav', (e, id) => {
  const it = store.toggleFav(id);
  return it ? { id: it.id, favorite: it.favorite } : null;
});

ipcMain.handle('lib:remove', async (e, id) => {
  const ok = await store.remove(id);
  return { ok, stats: store.stats() };
});

ipcMain.handle('lib:reveal', (e, id) => {
  const it = store.getById(id);
  if (!it) return false;
  shell.showItemInFolder(store.itemFile(it));
  return true;
});

ipcMain.handle('lib:open-root', () => shell.openPath(store.root));

ipcMain.handle('lib:choose-root', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, { title: '选择库目录', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const root = await store.setRoot(r.filePaths[0]);
  return { root, stats: store.stats() };
});

ipcMain.handle('lib:copy-image', async (e, id) => {
  const it = store.getById(id);
  if (!it) return false;
  const p = store.itemFile(it);
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return false;
  clipboard.writeImage(img);
  store.touch(id);
  return true;
});

ipcMain.on('lib:drag-out', (e, id) => {
  const it = store.getById(id);
  if (!it) return;
  const file = store.itemFile(it);
  if (!fs.existsSync(file)) return;
  let icon = nativeImage.createFromPath(store.thumbPath(it.sha));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  icon = icon.resize({ width: 96 });
  store.touch(id);
  e.sender.startDrag({ file, icon });
});

ipcMain.handle('lib:stats', () => store.stats());

ipcMain.handle('lib:counts', () => store.counts());

ipcMain.handle('lib:colors', (e, id) => store.colors(id));

ipcMain.handle('lib:search-colors', (e, opts) => store.searchByColors(opts || {}));
