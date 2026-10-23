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
    importDialog: () => ipcRenderer.invoke('lib:import-dialog'),
    importPaths: (paths) => ipcRenderer.invoke('lib:import-paths', paths),
    importFile: (payload) => ipcRenderer.invoke('lib:import-file', payload),
    setCategory: (payload) => ipcRenderer.invoke('lib:set-category', payload),
    toggleFav: (id) => ipcRenderer.invoke('lib:toggle-fav', id),
    remove: (id) => ipcRenderer.invoke('lib:remove', id),
    reveal: (id) => ipcRenderer.invoke('lib:reveal', id),
    openRoot: () => ipcRenderer.invoke('lib:open-root'),
    chooseRoot: () => ipcRenderer.invoke('lib:choose-root'),
    copyImage: (id) => ipcRenderer.invoke('lib:copy-image', id),
    colors: (id) => ipcRenderer.invoke('lib:colors', id),
    searchColors: (opts) => ipcRenderer.invoke('lib:search-colors', opts),
    dragOut: (id) => ipcRenderer.send('lib:drag-out', id),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    }
  },
  on: {
    importProgress: (cb) => on('import:progress', cb),
    importDone: (cb) => on('import:done', cb),
    clipImage: (cb) => on('clip:image', cb),
    focusSearch: (cb) => on('ui:focus-search', cb),
    saveClip: (cb) => on('ui:save-clip', cb)
  }
});
