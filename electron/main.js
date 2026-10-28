'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut,
  clipboard, dialog, shell, screen, protocol, net, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { store, TREE, IMAGE_EXT } = require('./store');
const { startBridge, PORT: BRIDGE_PORT } = require('./bridge');
const { buildSendToPsScript, encodePsCommand, decideSendToPs } = require('./ps-bridge');
const { ClipEngine } = require('./clip');
const { WebCrawler } = require('./crawler');
const { parseIntent, CRAWLER_UA } = require('./intent');

const ASSETS = path.join(__dirname, '..', 'assets');
// 扩展必须放在 asar 外（用户要在资源管理器里选中它加载），打包后落在 resources/extension
const EXT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'extension')
  : path.join(__dirname, '..', 'extension');
// CLIP 模型目录：开发时放工作副本外的共用目录（多份工作副本共享，避免重复下 85MB+），
// 打包后放 userData，绝不进安装包
const CLIP_MODELS_DIR = process.env.RC_MODELS
  || (app.isPackaged ? path.join(app.getPath('userData'), 'models') : path.join(path.dirname(app.getAppPath()), '.rc-models'));
const clipEngine = new ClipEngine({ modelsDir: CLIP_MODELS_DIR });
const isDev = !!process.env.VITE_DEV;
const logger = require('./logger');
const LOGGER = { dir: '' };

// 测试钩子：冒烟测试用独立 userData（隔离 config.json 里的分类树与令牌），绝不碰真实配置
if (process.env.RC_USER_DATA) {
  try { app.setPath('userData', path.resolve(process.env.RC_USER_DATA)); } catch { }
}

if (process.env.RC_NOGPU === '1') {
  try { app.disableHardwareAcceleration(); } catch { }
}

// 测试隔离钩子：Windows 上 Electron 的 userData 走系统「漫游 AppData」known-folder，
// 不吃 APPDATA 环境变量——冒烟测试必须显式传 RC_USERDATA 才不会碰用户真实配置
// （config.json / window-state.json / clip 全部随之隔离）。
if (process.env.RC_USERDATA) {
  try { app.setPath('userData', process.env.RC_USERDATA); } catch (e) { console.error('rc: set userData failed', e); }
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

/** 16 寸笔记本上别把整块屏幕占满：按工作区比例取尺寸并居中 */
function fitToWorkArea() {
  const b = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, Math.max(980, Math.round(b.width * 0.82)));
  const height = Math.min(820, Math.max(620, Math.round(b.height * 0.8)));
  return {
    width,
    height,
    x: Math.round(b.x + (b.width - width) / 2),
    y: Math.round(b.y + (b.height - height) / 2)
  };
}

function loadState() {
  const def = { ...fitToWorkArea(), maximized: false };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const b = d.workArea;
      return s.x !== undefined && s.x + 120 > b.x && s.x < b.x + b.width - 120 &&
        s.y + 80 > b.y && s.y < b.y + b.height - 80;
    });
    if (!visible) return def;
    // 历史尺寸可能比当前工作区还高（换了笔记本 / 改了缩放），压回工作区内
    const cur = screen.getDisplayMatching({ x: s.x || 0, y: s.y || 0, width: s.width || 0, height: s.height || 0 });
    const b = cur.workArea;
    const maxW = b.width - 24;
    const maxH = b.height - 24;
    if (s.width > maxW) s.width = maxW;
    if (s.height > maxH) s.height = maxH;
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
    minWidth: 900,
    minHeight: 560,
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
    if (!quitting && store.getPrefs().general?.closeToTray !== false) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  // 空白自愈：加载完成后 4 秒界面仍是空的（渲染进程被 DB/配置锁卡住等）→ 自动重载一次并记日志
  let blankReloads = 0;
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        if (win.isDestroyed() || win.webContents.isLoading() || blankReloads >= 2) return;
        const ok = await win.webContents.executeJavaScript("!!document.querySelector('.win')", true).catch(() => false);
        if (!ok) {
          blankReloads++;
          LOGGER.E && LOGGER.E('空白界面自动恢复 #' + blankReloads + '，已自动重载');
          win.webContents.reload();
        }
      } catch { }
    }, 4000);
  });

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

/* ---------------- 置顶参考窗 ---------------- */
let pinWin = null;
let pinIgnore = false;

function setPinIgnore(v) {
  pinIgnore = !!v;
  if (pinWin && !pinWin.isDestroyed()) {
    pinWin.setIgnoreMouseEvents(pinIgnore, { forward: true });
  }
}

function openPin(id) {
  const it = store.getById(id);
  if (!it) return false;
  if (pinWin && !pinWin.isDestroyed()) { pinWin.destroy(); pinWin = null; }
  const b = screen.getPrimaryDisplay().workArea;
  const width = Math.min(480, Math.round(b.width * 0.32));
  const height = Math.min(660, Math.round(b.height * 0.72));
  pinWin = new BrowserWindow({
    width,
    height,
    x: b.x + b.width - width - 40,
    y: b.y + Math.round((b.height - height) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  pinWin.setAlwaysOnTop(true, 'screen-saver');
  pinIgnore = false;
  pinWin.loadFile(path.join(__dirname, '..', 'pin.html'), {
    query: { sha: it.sha, name: it.name }
  });
  pinWin.on('closed', () => { pinWin = null; pinIgnore = false; });
  pinWin.webContents.on('context-menu', () => {
    if (!pinWin || pinWin.isDestroyed()) return;
    Menu.buildFromTemplate([
      {
        label: '不透明度',
        submenu: [1, 0.92, 0.8, 0.65, 0.45, 0.25].map(v => ({
          label: Math.round(v * 100) + '%',
          click: () => { if (pinWin && !pinWin.isDestroyed()) pinWin.setOpacity(v); }
        }))
      },
      {
        label: '鼠标穿透（Ctrl+Shift+P 取消）',
        type: 'checkbox',
        checked: pinIgnore,
        click: (mi) => setPinIgnore(mi.checked)
      },
      { type: 'separator' },
      { label: '关闭置顶窗', click: () => { if (pinWin && !pinWin.isDestroyed()) pinWin.close(); } }
    ]).popup({ window: pinWin });
  });
  return true;
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
    {
      label: '更换库目录…',
      click: async () => {
        const r = await dialog.showOpenDialog(win || undefined, {
          title: '选择新的库目录（现有素材会复制过去）',
          properties: ['openDirectory', 'createDirectory']
        });
        if (r.canceled || !r.filePaths.length) return;
        await store.setRoot(r.filePaths[0], { migrate: true });
        if (win && !win.isDestroyed()) win.webContents.send('library:switched', { root: store.root });
      }
    },
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

let animBackfilling = false;
async function startAnimatedBackfill() {
  if (animBackfilling) return;
  animBackfilling = true;
  try {
    for (;;) {
      const n = await store.backfillAnimated({ limit: 32 });
      if (!n) break;
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (e) {
    console.error('animated backfill failed', e);
  } finally {
    animBackfilling = false;
  }
}

/* ---- 改判学习 kNN：给没有 embedding 的非回收站图逐批补算（仿 startAnimatedBackfill）----
 * 模型没就绪就静默跳过（绝不触发下载），启动后和每次导入完成后都会再试；
 * classifyIds 已顺手落库的图不在队列里，这里只兜底历史图和解码失败重试的图。 */
let embBackfilling = false;
async function startEmbedBackfill() {
  if (embBackfilling || !clipEngine.modelsReady()) return;
  embBackfilling = true;
  try {
    await clipEngine.ensureReady();
    for (;;) {
      const n = await store.backfillEmbeddings({
        limit: 16,
        embed: (buf) => clipEngine.embedImage(buf)
      });
      if (!n) break;
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (e) {
    console.error('embed backfill failed', e);
  } finally {
    embBackfilling = false;
  }
}

function startClipWatch() {  clipTimer = setInterval(async () => {
    if (clipPaused || !win || win.isDestroyed()) return;
    try {
      // Electron 45：clipboard.read() 返回 ClipboardItem[]，图片走 image/png Blob
      const items = await clipboard.read();
      const pngItem = items.find(i => i.types.includes('image/png'));
      if (!pngItem) return;
      const blob = await pngItem.getType('image/png');
      const png = Buffer.from(await blob.arrayBuffer());
      if (!png.length) return;
      const hash = require('crypto').createHash('sha1').update(png).digest('hex');
      if (hash === lastClipHash) return;
      lastClipHash = hash;
      const dir = path.join(app.getPath('userData'), 'clip');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, hash + '.png');
      if (!fs.existsSync(file)) fs.writeFileSync(file, png);
      const img = nativeImage.createFromBuffer(png);
      const { width, height } = img.getSize();
      win.webContents.send('clip:image', { file, width, height, dataUrl: img.resize({ width: 220 }).toDataURL() });
    } catch { }
  }, 700);
}

// 单实例：第二个实例必须立刻退出（否则托盘/窗口出现两份），首个实例收到 second-instance 唤醒窗口
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();
app.on('second-instance', showWindow);

/* ---- 全局热键：读 prefs（设置页可改），冲突的键位自动跳过 ---- */
let hotkeyState = {};
function applyHotkeys() {
  const { normalizeAccelerator } = require('./hotkey-util');
  const hk = { ...require('./hotkey-util').DEFAULT_HOTKEYS, ...(store.getPrefs().hotkeys || {}) };
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => {
    const norm = normalizeAccelerator(acc);
    if (!norm) return false;
    try { return globalShortcut.register(norm, fn); } catch { return false; }
  };
  hotkeyState = {
    wake: reg(hk.wake, () => {
      showWindow();
      if (win && !win.webContents.isLoading()) win.webContents.send('ui:focus-search');
    }),
    saveClip: reg(hk.saveClip, () => { if (win) win.webContents.send('ui:save-clip'); }),
    // 置顶窗开了鼠标穿透后点不到它，用快捷键收回
    pinIgnore: reg(hk.pinIgnore, () => setPinIgnore(!pinIgnore))
  };
  if (win && !win.isDestroyed()) win.webContents.send('hotkeys:state', { bindings: hk, registered: hotkeyState });
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;   // 第二实例：什么都不初始化，等 quit 生效
  Object.assign(LOGGER, logger.install(app, ipcMain));
  await store.init();
  store.ensureBridgeToken();
  startBridge({
    store,
    onImported: (r) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('import:done', {
        added: r.ok ? 1 : 0,
        dup: r.dup ? 1 : 0,
        failed: r.ok || r.dup ? 0 : 1,
        total: 1,
        stats: store.stats()
      });
    }
  });
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
  startAnimatedBackfill();
  startEmbedBackfill();

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

  applyHotkeys();

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
  const MIN_W = 900, MIN_H = 560;
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
  tree: store.getCats() || TREE
}));

/** toItem 的结果裁成 renderer 需要的普通对象（lib:list 与画板视图共用，保证字段一致） */
const plainItem = (it) => ({
  id: it.id, sha: it.sha, name: it.name, w: it.w, h: it.h, size: it.size,
  addedAt: it.addedAt, usedAt: it.usedAt, category: it.category,
  subcategory: it.subcategory, tags: it.tags, source: it.source,
  sourceUrl: it.sourceUrl, favorite: it.favorite, ext: it.ext,
  hasThumb: it.hasThumb, deletedAt: it.deletedAt, simScore: it.simScore,
  animated: it.animated,
  // 白边裁剪元数据：灯箱与检查器预览的裁剪显示都靠它（此前漏传，裁剪显示不生效）
  cw: it.cw, ch: it.ch, trimmed: it.trimmed,
  cropL: it.cropL, cropT: it.cropT, cropR: it.cropR, cropB: it.cropB,
  // CLIP 建议字段（AI 分类结果，检查器建议 chip 用）
  clipCat: it.clipCat || '', clipScore: (typeof it.clipScore === 'number' ? it.clipScore : -1)
});
ipcMain.handle('lib:list', (e, opts) => store.list(opts || {}).map(plainItem));

ipcMain.handle('lib:import-dialog', async (e, opts) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const label = opts && opts.category
    ? `导入到「${opts.category}${opts.subcategory ? ' / ' + opts.subcategory : ''}」`
    : '导入参考图';
  const r = await dialog.showOpenDialog(w, {
    title: label,
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const meta = {};
  if (opts && opts.category) meta.category = opts.category;
  if (opts && opts.subcategory) meta.subcategory = opts.subcategory;
  return runImport(e.sender, r.filePaths, meta);
});

async function runImport(sender, paths, meta = {}) {
  const res = await store.importPaths(paths, (p) => {
    if (!sender.isDestroyed()) sender.send('import:progress', p);
  }, meta);
  if (!sender.isDestroyed()) sender.send('import:done', { ...res, stats: store.stats() });
  startEmbedBackfill();   // 新图还没有 embedding，导入完让后台补上（模型没就绪会静默跳过）
  return res;
}

ipcMain.handle('lib:import-paths', async (e, payload) => {
  const paths = Array.isArray(payload) ? payload : payload.paths;
  const meta = Array.isArray(payload)
    ? {}
    : { category: payload.category, subcategory: payload.subcategory };
  return runImport(e.sender, paths, meta || {});
});

/* ---- 分类自定义 ---- */
ipcMain.handle('lib:cats', () => store.getCats() || TREE);
ipcMain.handle('lib:save-cats', (e, list) => store.setCats(list));
ipcMain.handle('lib:rename-cat', (e, { from, to }) => store.renameCategory(from, to));
ipcMain.handle('lib:drop-cat', (e, name) => store.dropCategory(name));

/* ---- 画板（工作集）---- */
ipcMain.handle('workset:list', () => store.worksets());
ipcMain.handle('workset:create', (e, name) => store.createWorkset(name));
ipcMain.handle('workset:rename', (e, { id, name }) => store.renameWorkset(id, name));
ipcMain.handle('workset:delete', (e, id) => store.deleteWorkset(id));
ipcMain.handle('workset:add-items', (e, { id, ids }) => store.addWorksetItems(id, ids));
ipcMain.handle('workset:remove-items', (e, { id, ids }) => store.removeWorksetItems(id, ids));
ipcMain.handle('workset:items', (e, id) => store.worksetItems(id).map(plainItem));
ipcMain.handle('workset:for-asset', (e, assetId) => store.worksetsFor(assetId));

/* ---- 笔记：给参考图配文字，可独立存在，也可关联库内图片当插图 ---- */
ipcMain.handle('note:list', () => store.noteList());
ipcMain.handle('note:get', (e, id) => store.noteGet(id));
ipcMain.handle('note:create', (e, title) => store.noteCreate(title));
ipcMain.handle('note:update', (e, { id, title, content }) => store.noteUpdate(id, { title, content }));
ipcMain.handle('note:delete', (e, id) => store.noteDelete(id));
ipcMain.handle('note:pin', (e, id) => store.notePin(id));
ipcMain.handle('note:link', (e, { id, ids }) => store.noteLink(id, ids));
ipcMain.handle('note:unlink', (e, { id, ids }) => store.noteUnlink(id, ids));
ipcMain.handle('note:assets', (e, id) => store.noteAssets(id).map(plainItem));
ipcMain.handle('note:for-asset', (e, assetId) => store.notesForAsset(assetId));
ipcMain.handle('note:search', (e, query) => store.noteSearch(query));

/* ---- 多选批量 ---- */
ipcMain.handle('lib:remove-many', (e, ids) => ({ n: store.removeMany(ids), stats: store.stats() }));
ipcMain.handle('lib:restore-many', (e, ids) => ({ n: store.restoreMany(ids), stats: store.stats() }));
ipcMain.handle('lib:purge-many', async (e, ids) => ({ n: await store.purgeMany(ids), stats: store.stats() }));
ipcMain.handle('lib:purge-all', async () => ({ n: await store.purgeAll(), stats: store.stats() }));
ipcMain.handle('lib:similar', (e, { id, limit }) => store.similar(id, limit || 24));
ipcMain.handle('lib:set-category-many', (e, { ids, category, subcategory }) => store.setCategoryMany(ids, category, subcategory || ''));
ipcMain.handle('lib:toggle-fav-many', (e, { ids, value }) => store.toggleFavMany(ids, value));

/* ---- CLIP 零样本 AI 分类：算 embedding → 余弦 top-1 → ≥0.22 才写库，进度走 clip:progress ---- */
let clipClassifyRunning = false;
ipcMain.handle('clip:classify', async (e, ids) => {
  const sender = e.sender;
  const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string');
  if (!list.length) return { total: 0, adopted: 0, items: [] };
  if (clipClassifyRunning) return { error: 'AI 分类正在进行中，请等这批跑完' };
  clipClassifyRunning = true;
  try {
    // 传当前分类树（config 里用户自定义过的优先），engine 会按树缓存文本 embedding；
    // getTree 给采纳校验用实时树——分类跑一半用户删了分类，也不能把建议写进孤儿分类
    const tree = store.getCats() || TREE;
    return await clipEngine.classifyIds(store.tools, list, tree, {
      getTree: () => store.getCats() || TREE,
      onProgress: (p) => {
        if (!sender.isDestroyed()) sender.send('clip:progress', p);
      }
    });
  } catch (err) {
    console.error('clip classify failed', err);
    return { error: (err && err.message) || String(err) };
  } finally {
    clipClassifyRunning = false;
  }
});
ipcMain.handle('clip:status', () => ({
  modelsDir: CLIP_MODELS_DIR,
  modelsReady: clipEngine.modelsReady()
}));

ipcMain.handle('lib:set-tags', (e, { id, tags }) => {
  const it = store.setTags(id, tags);
  return it ? { id: it.id, tags: it.tags } : null;
});

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
  const ok = store.remove(id);
  return { ok, stats: store.stats() };
});

/* 大图里 Alt 点图取色：在主进程裁 1px 读 BGRA，避免 canvas 被自定义协议污染 */
ipcMain.handle('lib:pick-color', (e, { id, x, y }) => {
  const it = store.getById(id);
  if (!it) return null;
  const img = nativeImage.createFromPath(store.itemFile(it));
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  const one = img.crop({ x: px, y: py, width: 1, height: 1 });
  const bmp = one.toBitmap ? one.toBitmap() : one.getBitmap();
  if (!bmp || bmp.length < 4) return null;
  const b = bmp[0], g = bmp[1], r = bmp[2];
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  return { hex, x: px, y: py };
});

ipcMain.handle('lib:reveal', (e, id) => {
  const it = store.getById(id);
  if (!it) return false;
  shell.showItemInFolder(store.itemFile(it));
  return true;
});

ipcMain.handle('lib:open-root', () => shell.openPath(store.root));

ipcMain.handle('lib:pick-root', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, {
    title: '选择库目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('lib:apply-root', async (e, { root: next, migrate }) => {
  const root = await store.setRoot(next, { migrate: !!migrate });
  const payload = { root, stats: store.stats() };
  if (!e.sender.isDestroyed()) e.sender.send('library:switched', payload);
  return payload;
});

/* ---- 白边裁剪 ---- */
ipcMain.handle('lib:trim-items', async (e, ids) => {
  const sender = e.sender;
  const r = await store.trimItems(ids, (done, total) => {
    if (!sender.isDestroyed()) sender.send('import:progress', { done, total, added: 0 });
  });
  if (!sender.isDestroyed()) sender.send('import:done', { added: 0, dup: 0, failed: 0, total: 0, stats: store.stats() });
  return r;
});

/* ---- 换库目录前扫描：看看新目录里有哪些图片文件夹可以接入 ---- */
ipcMain.handle('lib:scan-root', async (e, dir) => {
  // 扫描逻辑抽到 electron/scan.js（纯 fs，可脱离 Electron 单测——RTM-S14）
  const { scanRoot } = require('./scan');
  return scanRoot(dir);
});

/* 按扫描结果接入：切换库目录 → 文件夹名 = 分类、二级文件夹 = 子分类，导入选中的部分 */
ipcMain.handle('lib:attach-scan', async (e, { root, groups }) => {
  const sender = e.sender;
  await store.setRoot(root, { migrate: false });
  let added = 0, dup = 0, failed = 0, total = 0;
  const acc = (p) => { added += p.added || 0; dup += p.dup || 0; failed += p.failed || 0; };
  const looseGroup = groups.find(g => g.loose);
  for (const g of groups) {
    if (g.loose) continue;
    if ((g.subs || []).length) {
      // 有子文件夹：直属图片进主分类，子文件夹各成子分类
      const direct = [];
      try {
        for (const en of fs.readdirSync(g.abs, { withFileTypes: true })) {
          if (en.isFile() && IMAGE_EXT.has(path.extname(en.name).toLowerCase())) direct.push(path.join(g.abs, en.name));
        }
      } catch { }
      if (direct.length) {
        acc(await store.importPaths(direct, (p) => {
          if (!sender.isDestroyed()) sender.send('import:progress', { done: total + p.done, total: total + (p.total || 0), added: added });
        }, { category: g.name }));
      }
      for (const s of g.subs) {
        acc(await store.importPaths([s.abs], (p) => {
          if (!sender.isDestroyed()) sender.send('import:progress', { done: total + p.done, total: total + (p.total || 0), added: added });
        }, { category: g.name, subcategory: s.name }));
      }
    } else {
      acc(await store.importPaths([g.abs], (p) => {
        if (!sender.isDestroyed()) sender.send('import:progress', { done: total + p.done, total: total + (p.total || 0), added: added });
      }, { category: g.name }));
    }
    total += g.count;
  }
  if (looseGroup) {
    // 根目录散图 → 待分类（只导根目录直属文件，不递归）
    const looseFiles = [];
    try {
      for (const en of fs.readdirSync(root, { withFileTypes: true })) {
        if (en.isFile() && IMAGE_EXT.has(path.extname(en.name).toLowerCase())) looseFiles.push(path.join(root, en.name));
      }
    } catch { }
    if (looseFiles.length) {
      acc(await store.importPaths(looseFiles, (p) => {
        if (!sender.isDestroyed()) sender.send('import:progress', { done: total + p.done, total: total + (p.total || 0), added: added });
      }, { category: '待分类' }));
    }
  }
  const payload = { root: store.root, stats: store.stats(), added, dup, failed, total };
  if (!sender.isDestroyed()) sender.send('import:done', payload);
  if (!sender.isDestroyed()) sender.send('library:switched', { root: store.root, stats: store.stats() });
  return payload;
});

ipcMain.handle('lib:rename', (e, { id, name }) => store.rename(id, name));

ipcMain.handle('ui:get-prefs', () => store.getPrefs());
ipcMain.handle('ui:set-prefs', (e, patch) => {
  const r = store.setPrefs(patch);
  if (patch && patch.hotkeys) applyHotkeys();
  return r;
});
ipcMain.handle('hotkeys:current', () => ({ bindings: { ...require('./hotkey-util').DEFAULT_HOTKEYS, ...(store.getPrefs().hotkeys || {}) }, registered: hotkeyState }));

/* Electron 45 起 clipboard 模块换成 W3C 风格异步 API（read/write + ClipboardItem），
   旧的 writeImage / readImage 已移除：统一走这里，图片按 image/png Blob 写入 */
async function copyImageToClipboard(img) {
  if (!img || img.isEmpty()) return false;
  const { ClipboardItem } = require('electron');
  const blob = new Blob([img.toPNG()], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}

ipcMain.handle('lib:copy-image', async (e, id) => {
  const it = store.getById(id);
  if (!it) return false;
  const img = nativeImage.createFromPath(store.itemFile(it));
  const ok = await copyImageToClipboard(img);
  if (ok) store.touch(id);
  return ok;
});

ipcMain.on('lib:drag-out', (e, id) => {
  const it = store.getById(id);
  if (!it) return;
  const file = store.itemFile(it);
  if (!fs.existsSync(file)) return;
  // 自动化测试钩子：RC_NODRAG=1 时只记账（used_at）不进入 startDrag 的
  // DoDragDrop 模态循环——没有真实鼠标的释放事件它永不返回
  if (process.env.RC_NODRAG === '1') {
    store.touch(id);
    try { store.save(); } catch { }
    return;
  }
  let icon = nativeImage.createFromPath(store.thumbPath(it.sha));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  icon = icon.resize({ width: 96 });
  // Windows 上 startDrag 的 icon 不能是空图，兜底再查一次
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  store.touch(id);
  try {
    e.sender.startDrag({ file, icon });
  } catch (err) {
    console.error('startDrag failed', err, 'file=', file);
  }
});

/* ---- 直送 Photoshop：图作为新图层贴进当前活动画布（PowerShell COM + DoJavaScript） ---- */
const PS_EXE = (() => {
  const cand = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(cand) ? cand : 'powershell.exe';
})();

/**
 * 跑一段 PowerShell。脚本用 -EncodedCommand（UTF-16LE base64）传入，
 * 避开命令行里中文 / 空格 / 引号的所有转义坑。超时强杀，永不挂死。
 */
function runPowerShell(script, timeoutMs) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      encodePsCommand(script)];
    let stdout = '', stderr = '', settled = false;
    let child;
    try {
      child = spawn(PS_EXE, args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, timedOut: false, stdout: '', stderr: String(err?.message || err) });
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { }
      resolve({ ok: false, timedOut: true, stdout, stderr: stderr || 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ ok: false, timedOut: false, stdout, stderr: String(err?.message || err) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ ok: code === 0 && stdout.includes('RC_PS_OK'), timedOut: false, stdout, stderr });
    });
  });
}

ipcMain.handle('lib:send-to-ps', async (e, id) => {
  const it = store.getById(id);
  if (!it) return { ok: false, psAvailable: false, copied: false, reason: 'not-found' };
  const file = store.itemFile(it);
  if (!fs.existsSync(file)) return { ok: false, psAvailable: false, copied: false, reason: 'file-missing' };
  store.touch(id);
  // RC_DISABLE_PS=1：自动化测试钩子，跳过真实 COM 调用，直接走降级分支
  const r = process.env.RC_DISABLE_PS === '1'
    ? { ok: false, timedOut: false, stdout: '', stderr: 'rc: ps disabled for test (RC_DISABLE_PS)' }
    : await runPowerShell(buildSendToPsScript(file), 10000);
  if (r.ok) return decideSendToPs(r, false);
  // 降级：PS 连不上（没装 / COM 创建失败 / 没开画布 / 忙碌超时）→ 复制原图，去 PS 里 Ctrl+V
  let copied = false;
  try {
    copied = await copyImageToClipboard(nativeImage.createFromPath(file));
  } catch { }
  return decideSendToPs(r, copied);
});

ipcMain.handle('lib:stats', () => store.stats());

/* ---- 浏览器扩展桥接 ---- */
ipcMain.handle('bridge:info', () => ({
  port: BRIDGE_PORT,
  token: store.ensureBridgeToken(),
  extDir: EXT_DIR
}));
ipcMain.handle('bridge:open-ext', () => shell.openPath(EXT_DIR));
ipcMain.handle('app:get-login-item', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('app:set-login-item', (_e, open) => {
  app.setLoginItemSettings({ openAtLogin: !!open, path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('lib:open-logs', () => shell.openPath(LOGGER.dir));
ipcMain.handle('app:version', () => app.getVersion());

/* ---- 置顶参考窗 ---- */
ipcMain.handle('pin:open', (e, id) => openPin(id));
ipcMain.on('pin:close', () => { if (pinWin && !pinWin.isDestroyed()) pinWin.close(); });
ipcMain.on('pin:opacity', (e, v) => {
  const n = Math.max(0.1, Math.min(1, Number(v) || 1));
  if (pinWin && !pinWin.isDestroyed()) pinWin.setOpacity(n);
});
ipcMain.on('pin:ignore', (e, v) => setPinIgnore(v));

ipcMain.handle('lib:counts', () => store.counts());

ipcMain.handle('lib:colors', (e, id) => store.colors(id));

ipcMain.handle('lib:search-colors', (e, opts) => store.searchByColors(opts || {}));

/* ---- 内置网页采集 agent（NL 意图 + 反问补全 + 合规护栏） ---- */
const webCrawler = new WebCrawler({
  store,
  getPrefs: () => store.getPrefs(),
  onProgress: (p) => {
    if (win && !win.isDestroyed()) win.webContents.send('crawler:progress', p);
  }
});

/** NL 意图解析（纯函数 electron/intent.js）：渲染进程不复制这份逻辑 */
ipcMain.handle('crawler:parse', (e, text) => parseIntent(text));

ipcMain.handle('crawler:start', (e, task) => {
  // 合规首用确认是硬闸：未确认 prefs.crawler.confirmed 一律拒跑（面板另有引导）
  if (!store.getPrefs().crawler?.confirmed) return { error: '需要先确认采集合规说明' };
  return webCrawler.run(task || {});
});
ipcMain.on('crawler:cancel', () => webCrawler.cancel());
ipcMain.handle('crawler:guardrails', () => ({ ua: CRAWLER_UA }));

