'use strict';
/* 库目录迁移到 D:\RefCollector（一次性脚本，migrate=复制 files/thumbs/db，C 盘原库保留不动）
   跑法：env -u ELECTRON_RUN_AS_NODE RC_NOGPU=1 ./node_modules/electron/dist/electron.exe scripts/migrate-root-d.js */
const { app } = require('electron');

app.whenReady().then(async () => {
  const path = require('path');
  const { store } = require(path.join(__dirname, '..', 'electron', 'store'));
  await store.init();  // 读写真实 %APPDATA%/refcollector/config.json（无 RC_* 覆盖）
  const before = store.stats();
  console.log('BEFORE root=', store.root, 'total=', before.total);

  const target = 'D:/RefCollector';
  if (store.root === target) { console.log('ALREADY_ON_D'); app.exit(0); return; }

  const r = await store.setRoot(target, { migrate: true });
  const after = store.stats();
  console.log('AFTER root=', r, 'total=', after.total, 'size=', (after.size / 1048576).toFixed(1) + 'MB');
  console.log('MIGRATE_OK');
  app.exit(0);
}).catch(e => { console.error('MIGRATE_FAIL', e); app.exit(1); });
