'use strict';
/* 冒烟测试：detectTrim / makeThumb(crop) / trimItems。跑法：
   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe scripts/test-trim.js */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');

app.whenReady().then(async () => {
  const { makeImageOps } = require('../electron/store');
  const ops = makeImageOps();

  // 1) 用真实库里有白边的那张图测 detectTrim
  const src = 'C:/Users/Administrator/Pictures/RefCollector/files';
  let probe = null;
  for (const d1 of fs.readdirSync(src)) {
    for (const d2 of fs.readdirSync(path.join(src, d1))) {
      for (const f of fs.readdirSync(path.join(src, d1, d2))) {
        const p = path.join(src, d1, d2, f);
        const buf = fs.readFileSync(p);
        const t = ops.detectTrim(buf);
        if (t) { probe = { p, buf, t }; break; }
      }
      if (probe) break;
    }
    if (probe) break;
  }
  if (probe) {
    console.log('detectTrim OK:', path.basename(probe.p), JSON.stringify(probe.t));
    // 2) 裁剪缩略图：比例应符合内容比例
    const dest = path.join(__dirname, '.tmp-thumb.jpg');
    const ok = ops.makeThumb(probe.buf, dest, { left: probe.t.left, top: probe.t.top, width: probe.t.width, height: probe.t.height });
    const { nativeImage } = require('electron');
    const tim = nativeImage.createFromPath(dest);
    console.log('cropped thumb:', ok, tim.getSize());
    fs.rmSync(dest, { force: true });
    // 无裁剪参数时保持原行为
    const dest2 = path.join(__dirname, '.tmp-thumb2.jpg');
    ops.makeThumb(probe.buf, dest2, undefined);
    console.log('plain thumb:', nativeImage.createFromPath(dest2).getSize());
    fs.rmSync(dest2, { force: true });
  } else {
    console.log('detectTrim: 没找到带白边的图（可能是库空了）');
  }

  // 3) trimItems：临时库 + 一张带白边的图
  if (probe) {
    const tmp = path.join(__dirname, '.tmp-lib');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(path.join(tmp, 'files'), { recursive: true });
    const { openDatabase } = require('../electron/db');
    const { db } = openDatabase(tmp);
    const { LibraryTools } = require('../electron/tools');
    const tools = new LibraryTools(db, tmp, ops);
    const r = await tools.importOne(probe.p, { category: '测试' });
    console.log('importOne with auto-trim:', r);
    const it = tools.getById(tools.list({})[0].id);
    console.log('stored: w/h=', it.w, 'x', it.h, 'cw/ch=', it.cw, 'x', it.ch, 'crop=', it.cropL, it.cropT, it.cropR, it.cropB, 'trimmed=', it.trimmed);
    // 把裁剪框清掉再用 trimItems 恢复，验证批量修复路径
    db.prepare('UPDATE assets SET crop_l=-1, crop_t=-1, crop_r=-1, crop_b=-1').run();
    const tr = await tools.trimItems([it.id]);
    console.log('trimItems:', JSON.stringify(tr));
    const it2 = tools.getById(it.id);
    console.log('after trimItems: crop=', it2.cropL, it2.cropT, it2.cropR, it2.cropB);
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  app.exit(0);
}).catch(e => { console.error('FAIL', e); app.exit(1); });
