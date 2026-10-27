'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMax: () => ipcRenderer.invoke('win:toggle-max'),
    close: () => ipcRenderer.invoke('win:close'),
    isMax: () => ipcRenderer.invoke('win:is-max'),
    resizeBy: (edge, dx, dy) => ipcRenderer.send('win:resize-by', { edge, dx, dy }),
    onState: (cb) => on('win:state', cb)
  },
  lib: {
    info: () => ipcRenderer.invoke('lib:info'),
    list: (opts) => ipcRenderer.invoke('lib:list', opts),
    stats: () => ipcRenderer.invoke('lib:stats'),
    counts: () => ipcRenderer.invoke('lib:counts'),
    importDialog: (opts) => ipcRenderer.invoke('lib:import-dialog', opts),
    importPaths: (payload) => ipcRenderer.invoke('lib:import-paths', payload),
    importFile: (payload) => ipcRenderer.invoke('lib:import-file', payload),
    cats: () => ipcRenderer.invoke('lib:cats'),
    saveCats: (list) => ipcRenderer.invoke('lib:save-cats', list),
    renameCat: (payload) => ipcRenderer.invoke('lib:rename-cat', payload),
    dropCat: (name) => ipcRenderer.invoke('lib:drop-cat', name),
    removeMany: (ids) => ipcRenderer.invoke('lib:remove-many', ids),
    restoreMany: (ids) => ipcRenderer.invoke('lib:restore-many', ids),
    purgeMany: (ids) => ipcRenderer.invoke('lib:purge-many', ids),
    purgeAll: () => ipcRenderer.invoke('lib:purge-all'),
    similar: (payload) => ipcRenderer.invoke('lib:similar', payload),
    pickColor: (payload) => ipcRenderer.invoke('lib:pick-color', payload),
    setCategoryMany: (payload) => ipcRenderer.invoke('lib:set-category-many', payload),
    toggleFavMany: (payload) => ipcRenderer.invoke('lib:toggle-fav-many', payload),
    setTags: (payload) => ipcRenderer.invoke('lib:set-tags', payload),
    setCategory: (payload) => ipcRenderer.invoke('lib:set-category', payload),
    toggleFav: (id) => ipcRenderer.invoke('lib:toggle-fav', id),
    remove: (id) => ipcRenderer.invoke('lib:remove', id),
    reveal: (id) => ipcRenderer.invoke('lib:reveal', id),
    openRoot: () => ipcRenderer.invoke('lib:open-root'),
    pickRoot: () => ipcRenderer.invoke('lib:pick-root'),
    applyRoot: (payload) => ipcRenderer.invoke('lib:apply-root', payload),
    scanRoot: (dir) => ipcRenderer.invoke('lib:scan-root', dir),
    attachScan: (payload) => ipcRenderer.invoke('lib:attach-scan', payload),
    trimMany: (ids) => ipcRenderer.invoke('lib:trim-items', ids),
    rename: (id, name) => ipcRenderer.invoke('lib:rename', { id, name }),
    getPrefs: () => ipcRenderer.invoke('ui:get-prefs'),
    setPrefs: (patch) => ipcRenderer.invoke('ui:set-prefs', patch),
    hotkeysCurrent: () => ipcRenderer.invoke('hotkeys:current'),
    getLoginItem: () => ipcRenderer.invoke('app:get-login-item'),
    setLoginItem: (open) => ipcRenderer.invoke('app:set-login-item', open),
    openLogs: () => ipcRenderer.invoke('lib:open-logs'),
    version: () => ipcRenderer.invoke('app:version'),
    copyImage: (id) => ipcRenderer.invoke('lib:copy-image', id),
    colors: (id) => ipcRenderer.invoke('lib:colors', id),
    searchColors: (opts) => ipcRenderer.invoke('lib:search-colors', opts),
    dragOut: (id) => ipcRenderer.send('lib:drag-out', id),
    sendToPs: (id) => ipcRenderer.invoke('lib:send-to-ps', id),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    }
  },
  pin: {
    open: (id) => ipcRenderer.invoke('pin:open', id),
    close: () => ipcRenderer.send('pin:close'),
    setOpacity: (v) => ipcRenderer.send('pin:opacity', v),
    setIgnore: (v) => ipcRenderer.send('pin:ignore', v)
  },
  workset: {
    list: () => ipcRenderer.invoke('workset:list'),
    create: (name) => ipcRenderer.invoke('workset:create', name),
    rename: (id, name) => ipcRenderer.invoke('workset:rename', { id, name }),
    delete: (id) => ipcRenderer.invoke('workset:delete', id),
    addItems: (id, ids) => ipcRenderer.invoke('workset:add-items', { id, ids }),
    removeItems: (id, ids) => ipcRenderer.invoke('workset:remove-items', { id, ids }),
    items: (id) => ipcRenderer.invoke('workset:items', id),
    forAsset: (assetId) => ipcRenderer.invoke('workset:for-asset', assetId)
  },
  note: {
    list: () => ipcRenderer.invoke('note:list'),
    get: (id) => ipcRenderer.invoke('note:get', id),
    create: (title) => ipcRenderer.invoke('note:create', title),
    update: (payload) => ipcRenderer.invoke('note:update', payload),
    delete: (id) => ipcRenderer.invoke('note:delete', id),
    pin: (id) => ipcRenderer.invoke('note:pin', id),
    link: (id, ids) => ipcRenderer.invoke('note:link', { id, ids }),
    unlink: (id, ids) => ipcRenderer.invoke('note:unlink', { id, ids }),
    assets: (id) => ipcRenderer.invoke('note:assets', id),
    forAsset: (assetId) => ipcRenderer.invoke('note:for-asset', assetId),
    search: (query) => ipcRenderer.invoke('note:search', query)
  },
  // 置顶窗自己的极简入口（pin.html 只用到这两个）
  pinWin: {
    close: () => ipcRenderer.send('pin:close')
  },
  bridge: {
    info: () => ipcRenderer.invoke('bridge:info'),
    openExt: () => ipcRenderer.invoke('bridge:open-ext')
  },
  clip: {
    classify: (ids) => ipcRenderer.invoke('clip:classify', ids),
    status: () => ipcRenderer.invoke('clip:status')
  },
  crawler: {
    parse: (text) => ipcRenderer.invoke('crawler:parse', text),
    start: (task) => ipcRenderer.invoke('crawler:start', task),
    cancel: () => ipcRenderer.send('crawler:cancel'),
    guardrails: () => ipcRenderer.invoke('crawler:guardrails')
  },
  on: {
    importProgress: (cb) => on('import:progress', cb),
    importDone: (cb) => on('import:done', cb),
    clipImage: (cb) => on('clip:image', cb),
    clipProgress: (cb) => on('clip:progress', cb),
    crawlerProgress: (cb) => on('crawler:progress', cb),
    focusSearch: (cb) => on('ui:focus-search', cb),
    saveClip: (cb) => on('ui:save-clip', cb),
    librarySwitched: (cb) => on('library:switched', cb),
    hotkeysState: (cb) => on('hotkeys:state', cb)
  }
});
