'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../electron/db');
const { LibraryTools } = require('../electron/tools');
const { paletteFromBGRA } = require('../electron/palette');

const demoJson = path.join(__dirname, '..', 'demo-library', 'library.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-smoke-'));
const { db } = openDatabase(root);
const tools = new LibraryTools(db, root, {});

const migrated = tools.migrateFromJson(demoJson);
console.log('migrated:', migrated, 'count:', tools.count());
console.log('stats:', tools.stats());
console.log('query city:', tools.list({ query: 'city' }).map((i) => i.name));
console.log('query beijing:', tools.list({ query: 'beijing' }).map((i) => i.name));
console.log('inbox:', tools.list({ view: 'inbox' }).length);

const all = tools.list();
const first = all[0];
tools.insertColors(first.id, [{ hex: '#112233', l: 12.6, a: 1.2, b: -13.5, pct: 100 }]);
console.log('color hit:', tools.searchByColors({ colors: ['#112233'], threshold: 10 }).map((i) => i.name));
console.log('color miss:', tools.searchByColors({ colors: ['#FF0000'], threshold: 10 }).length);

console.log('setTags:', tools.setTags(first.id, ['测试', '测试', 'color']).tags);
console.log('setCategory:', tools.setCategory(first.id, '灵感碎片', '情绪板'));
console.log('fav:', tools.toggleFav(first.id));
console.log('counts:', tools.counts());

const w = 8, h = 8;
const buf = Buffer.alloc(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const red = i % 2 === 0;
  buf[i * 4] = 0;
  buf[i * 4 + 1] = red ? 0 : 255;
  buf[i * 4 + 2] = red ? 255 : 0;
  buf[i * 4 + 3] = 255;
}
console.log('palette:', paletteFromBGRA(buf, w, h));

tools.remove(first.id);
console.log('after remove:', tools.count());

db.close();
fs.rmSync(root, { recursive: true, force: true });
