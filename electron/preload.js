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
    rename: (id, name) => ipcRenderer.invoke('lib:rename', { id, name }),
    getPrefs: () => ipcRenderer.invoke('ui:get-prefs'),
    setPrefs: (patch) => ipcRenderer.invoke('ui:set-prefs', patch),
    copyImage: (id) => ipcRenderer.invoke('lib:copy-image', id),
    colors: (id) => ipcRenderer.invoke('lib:colors', id),
    searchColors: (opts) => ipcRenderer.invoke('lib:search-colors', opts),
    dragOut: (id) => ipcRenderer.send('lib:drag-out', id),
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
  // 置顶窗自己的极简入口（pin.html 只用到这两个）
  pinWin: {
    close: () => ipcRenderer.send('pin:close')
  },
  bridge: {
    info: () => ipcRenderer.invoke('bridge:info'),
    openExt: () => ipcRenderer.invoke('bridge:open-ext')
  },
  on: {
    importProgress: (cb) => on('import:progress', cb),
    importDone: (cb) => on('import:done', cb),
    clipImage: (cb) => on('clip:image', cb),
    focusSearch: (cb) => on('ui:focus-search', cb),
    saveClip: (cb) => on('ui:save-clip', cb),
    librarySwitched: (cb) => on('library:switched', cb)
  }
});
