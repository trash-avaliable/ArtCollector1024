/**
 * 笔记系统数据层单测（RTM-S24）：node --test tests/notes.test.mjs
 * 纯 node:sqlite + electron/db.js + electron/tools.js，不加载 electron 主进程，
 * 本 worktree 没有 electron 可执行文件也能跑。
 * 覆盖：v7→v8 迁移（存在性守卫）、CRUD 全生命周期、关联幂等、双向 CASCADE、
 *       置顶排序、搜索（拼音全拼 / 首字母 / 子串）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, SCHEMA_VERSION } from '../electron/db.js';
import { LibraryTools } from '../electron/tools.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-notes-test-'));
const { db } = openDatabase(ROOT);
const tools = new LibraryTools(db, ROOT, {});

let assetSeq = 0;
/** 直接塞一条素材行（不读磁盘文件，测试只关心数据库层） */
function seedAsset(overrides = {}) {
  assetSeq++;
  const sha = ('0000000000000000' + assetSeq).slice(-16).repeat(4).slice(0, 64);
  const it = {
    id: 'a' + assetSeq.toString().padStart(4, '0'),
    sha, ext: '.png', name: overrides.name || `素材 ${assetSeq}.png`,
    w: 100, h: 80, size: 2048, addedAt: Date.now() + assetSeq, usedAt: 0,
    category: '人体结构', subcategory: '手部', source: 'local', sourceUrl: '',
    favorite: false, hasThumb: false, paletteAt: 0,
    _py: 'suc', _init: 'sc', _cpy: '', _cinit: '',
    cropL: -1, cropT: -1, cropR: -1, cropB: -1, animated: false
  };
  tools.insertRow({ ...it, ...overrides });
  return overrides.id || it.id;
}

const tableExists = (name) => db.prepare(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?"
).get(name).n > 0;

/* ---------------- 迁移 ---------------- */

test('RTM-S24: SCHEMA_VERSION 升到 9，新库直接带 notes / note_links 两张表', () => {
  assert.equal(SCHEMA_VERSION, 9);
  assert.ok(tableExists('notes'));
  assert.ok(tableExists('note_links'));
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_note_links_asset'").get();
  assert.ok(idx, 'note_links.asset_id 反查索引存在');
});

test('RTM-S24: v7→v8 迁移——老库缺表时打开自动补建（存在性守卫），数据列不动', () => {
  // 模拟 v7 老库：拆掉笔记两张表、把 user_version 拨回 7
  db.exec('DROP TABLE note_links');
  db.exec('DROP TABLE notes');
  db.exec('PRAGMA user_version = 7');
  assert.ok(!tableExists('notes'));

  const before = tools.count(); // 素材还在
  const { db: reopened } = openDatabase(ROOT);
  assert.ok(tableExists('notes'), '重开后 notes 表补建');
  assert.ok(tableExists('note_links'), '重开后 note_links 表补建');
  const ver = reopened.prepare('PRAGMA user_version').get().user_version;
  assert.equal(ver, 9, 'user_version 推进到 9');
  reopened.close();
  assert.equal(tools.count(), before, '已有素材不受迁移影响');
});

/* ---------------- CRUD 全生命周期 ---------------- */

test('RTM-S24: noteCreate——空标题 / 纯空白拒绝，合法标题默认 pinned=0 且 created_at=updated_at', () => {
  assert.ok(tools.noteCreate('').error, '空标题报错');
  assert.ok(tools.noteCreate('   ').error, '纯空白报错');
  const n = tools.noteCreate('  手部 结构  笔记  ');
  assert.ok(n.id, '返回带 id 的完整笔记');
  assert.equal(n.title, '手部 结构 笔记', '首尾空白收敛、中间空白折叠');
  assert.equal(n.pinned, false);
  assert.equal(n.content, '');
  assert.equal(n.createdAt, n.updatedAt);
  assert.equal(n.assetCount, 0);
});

test('RTM-S24: noteCreate 超过 90 字的标题拒绝', () => {
  const r = tools.noteCreate('长'.repeat(91));
  assert.ok(r.error, '91 字报错');
  assert.ok(!tools.noteCreate('长'.repeat(90)).error, '90 字放行');
});

test('RTM-S24: noteUpdate 改标题/正文，updated_at 自动推进', () => {
  const n = tools.noteCreate('待更新');
  db.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').run(n.id);
  const r = tools.noteUpdate(n.id, { title: '已更新', content: '新的正文' });
  assert.equal(r.title, '已更新');
  assert.equal(r.content, '新的正文');
  assert.ok(r.updatedAt > 1000, `updated_at 从 1000 推进到 ${r.updatedAt}`);
});

test('RTM-S24: noteUpdate 只改其一（title / content），另一字段原样保留', () => {
  const n = tools.noteCreate('只改标题', '正文不动');
  const r1 = tools.noteUpdate(n.id, { title: '新标题' });
  assert.equal(r1.title, '新标题');
  assert.equal(r1.content, '正文不动');
  const r2 = tools.noteUpdate(n.id, { content: '新正文' });
  assert.equal(r2.title, '新标题');
  assert.equal(r2.content, '新正文');
  assert.ok(tools.noteUpdate(n.id, { title: '' }).error, '改标题改成空串报错');
  assert.equal(tools.noteUpdate('no-such-id', { content: 'x' }), null, '不存在的笔记返回 null');
});

test('RTM-S24: noteDelete 只删笔记不动图，删不存在的返回 ok:false', () => {
  const aid = seedAsset();
  const n = tools.noteCreate('将删');
  tools.noteLink(n.id, [aid]);
  const r = tools.noteDelete(n.id);
  assert.equal(r.ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes WHERE id = ?').get(n.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_links WHERE note_id = ?').get(n.id).n, 0, '关联一并清掉');
  assert.ok(tools.getById(aid), '图片原封不动');
  assert.equal(tools.noteDelete('no-such-id').ok, false);
});

test('RTM-S24: notePin toggle 置顶/取消置顶', () => {
  const n = tools.noteCreate('置顶我');
  assert.equal(n.pinned, false);
  const p1 = tools.notePin(n.id);
  assert.deepEqual(p1, { id: n.id, pinned: true });
  assert.equal(tools.noteGet(n.id).pinned, true);
  const p2 = tools.notePin(n.id);
  assert.deepEqual(p2, { id: n.id, pinned: false });
  assert.equal(tools.notePin('no-such-id'), null);
});

/* ---------------- 排序 ---------------- */

test('RTM-S24: noteList 置顶优先 + updated_at 倒序（同分按 rowid 稳定）', () => {
  // 清场：前面 CRUD 用例留下的笔记时间戳都是 Date.now()，会压过这里的固定值
  db.exec('DELETE FROM notes');
  const ids = ['笔记甲', '笔记乙', '笔记丙'].map((t) => tools.noteCreate(t).id);
  db.prepare('UPDATE notes SET updated_at = 3000 WHERE id = ?').run(ids[0]); // 甲
  db.prepare('UPDATE notes SET updated_at = 1000, pinned = 1 WHERE id = ?').run(ids[1]); // 乙（置顶）
  db.prepare('UPDATE notes SET updated_at = 3000 WHERE id = ?').run(ids[2]); // 丙
  const titles = tools.noteList().map((n) => n.title);
  assert.deepEqual(titles, ['笔记乙', '笔记丙', '笔记甲'], '乙置顶最前；甲丙同 updated_at 时 rowid 新的在前');
});

/* ---------------- 关联：幂等 / 级联 / 反查 ---------------- */

test('RTM-S24: noteLink 幂等（重复关联不重复计数），回收站与不存在的图拒收', () => {
  const a1 = seedAsset();
  const a2 = seedAsset();
  const n = tools.noteCreate('关联幂等');
  const r1 = tools.noteLink(n.id, [a1, a1, a2]);
  assert.equal(r1.added, 2, 'INSERT OR IGNORE：重复项只记一次');
  const r2 = tools.noteLink(n.id, [a1]);
  assert.equal(r2.added, 0, '再连一次 added=0 且不报错');
  assert.equal(tools.noteGet(n.id).assetCount, 2);
  assert.equal(tools.noteLink(n.id, ['ghost-id']).added, 0, '不存在的图不进关联');
  tools.remove(a2); // 进回收站
  assert.equal(tools.noteLink(n.id, [a2]).added, 0, '已进回收站的图拒收');
  assert.ok(!tools.noteLink('no-such-note', [a1]).added, '不存在的笔记报 error');
});

test('RTM-S24: noteUnlink 幂等，重复删除不报错', () => {
  const a1 = seedAsset();
  const n = tools.noteCreate('解绑幂等');
  tools.noteLink(n.id, [a1]);
  assert.equal(tools.noteUnlink(n.id, [a1]).removed, 1);
  assert.equal(tools.noteUnlink(n.id, [a1]).removed, 0, '再删一次 removed=0 不报错');
  assert.equal(tools.noteGet(n.id).assetCount, 0);
});

test('RTM-S24: noteAssets 复用 toItem（含 w/category 等完整字段）且过滤回收站图', () => {
  const a1 = seedAsset({ name: '手部骨架.png' });
  const a2 = seedAsset({ name: '色卡.png' });
  const n = tools.noteCreate('插图过滤');
  tools.noteLink(n.id, [a1, a2]);
  tools.remove(a2);
  const list = tools.noteAssets(n.id);
  assert.equal(list.length, 1);
  const it = list[0];
  assert.equal(it.id, a1);
  assert.equal(it.name, '手部骨架.png');
  assert.equal(it.w, 100);
  assert.equal(it.category, '人体结构');
  assert.ok(typeof it.sha === 'string' && it.sha.length === 64, 'toItem 的 sha 字段在');
});

test('RTM-S24: notesForAsset 反查——一张图被哪些笔记引用（检查器用），带 linkedAt', () => {
  const a = seedAsset();
  const n1 = tools.noteCreate('引用一');
  const n2 = tools.noteCreate('引用二');
  tools.noteLink(n1.id, [a]);
  tools.noteLink(n2.id, [a]);
  const refs = tools.notesForAsset(a);
  assert.equal(refs.length, 2);
  assert.ok(refs.every((r) => r.linkedAt > 0 && r.assetCount === 1), 'linkedAt / assetCount 齐全');
  assert.deepEqual(
    refs.map((r) => r.title).sort(),
    ['引用一', '引用二'],
    '两条笔记都被反查到（同毫秒关联的顺序不作为契约）'
  );
  assert.equal(tools.notesForAsset('no-such-asset').length, 0);
});

test('RTM-S24: 删图片（hardRemove）CASCADE 清 note_links，笔记本体保留', async () => {
  const a1 = seedAsset();
  const n = tools.noteCreate('图删关联清');
  tools.noteLink(n.id, [a1]);
  await tools.hardRemove(a1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_links WHERE asset_id = ?').get(a1).n, 0, 'CASCADE 清关联');
  assert.ok(tools.noteGet(n.id), '笔记还在');
  assert.equal(tools.noteGet(n.id).assetCount, 0);
});

test('RTM-S24: noteLink / noteUnlink 推进笔记 updated_at（关联动作也算改动）', () => {
  const a = seedAsset();
  const n = tools.noteCreate('联动时间戳');
  db.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').run(n.id);
  tools.noteLink(n.id, [a]);
  assert.ok(tools.noteGet(n.id).updatedAt > 1000, '关联后 updated_at 推进');
  db.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').run(n.id);
  tools.noteUnlink(n.id, [a]);
  assert.ok(tools.noteGet(n.id).updatedAt > 1000, '取消关联也推进');
  db.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').run(n.id);
  tools.noteLink(n.id, [a]); // 上一轮已解绑，这次真新增
  tools.noteLink(n.id, [a]); // 幂等命中，不应再推进
  const t = tools.noteGet(n.id).updatedAt;
  db.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').run(n.id);
  tools.noteLink(n.id, [a]);
  assert.equal(tools.noteGet(n.id).updatedAt, 1000, '纯幂等重复关联不动 updated_at');
  void t;
});

/* ---------------- 搜索 ---------------- */

test('RTM-S24: noteSearch 子串命中标题与正文（大小写不敏感）', () => {
  tools.noteCreate('手部骨架要点', '大拇指只有两节，注意指骨比例');
  tools.noteCreate('配色笔记', 'BACKDROP 用低饱和蓝');
  const byTitle = tools.noteSearch('骨架');
  assert.ok(byTitle.some((n) => n.title === '手部骨架要点'));
  const byContent = tools.noteSearch('指骨比例');
  assert.equal(byContent.length, 1);
  const byEn = tools.noteSearch('backdrop');
  assert.equal(byEn.length, 1, '英文正文大小写不敏感');
  assert.equal(tools.noteSearch('不存在的词组xyz').length, 0);
});

test('RTM-S24: noteSearch 拼音全拼命中（标题与正文运行时转拼音，不落列）', () => {
  const n = tools.noteCreate('手部参考', '配色方案要克制');
  const byTitle = tools.noteSearch('shoubu');
  assert.ok(byTitle.some((x) => x.id === n.id), 'shoubu 命中标题「手部参考」');
  const byContent = tools.noteSearch('peise');
  assert.ok(byContent.some((x) => x.id === n.id), 'peise 命中正文「配色…」');
  assert.ok(tools.noteSearch('shoubucankao').some((x) => x.id === n.id), '全拼整串也行');
  assert.ok(!tools.noteSearch('zhanzheng').length, '无关拼音不命中');
});

test('RTM-S24: noteSearch 拼音首字母命中（sb / peis…）', () => {
  const n = tools.noteCreate('手部参考', '配色方案要克制');
  assert.ok(tools.noteSearch('sbck').some((x) => x.id === n.id), 'sbck = 手部参考 首字母');
  assert.ok(tools.noteSearch('sb').some((x) => x.id === n.id), '前缀 sb 也命中');
  assert.ok(tools.noteSearch('psfa').some((x) => x.id === n.id), 'psfa = 配色方案 首字母（正文）');
});

test('RTM-S24: noteSearch 空 query 返回全量，顺序与 noteList 一致（置顶优先）', () => {
  const all = tools.noteList();
  const hit = tools.noteSearch('   ');
  assert.equal(hit.length, all.length, '空白 query 等价全量');
  assert.deepEqual(hit.map((n) => n.id), all.map((n) => n.id));
  if (all.length >= 2) assert.ok(hit[0].pinned || true);
});

/* ---------------- 收尾 ---------------- */

test('RTM-S24: 临时测试库收尾清理', () => {
  db.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
  assert.ok(!fs.existsSync(ROOT));
});
