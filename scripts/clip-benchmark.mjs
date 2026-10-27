/**
 * CLIP 零样本分类基准测试：跑完整管线（nativeImage 预处理 → 图像 embedding → 与文本 embedding 余弦 → top-1）。
 *
 * 用法（需要 Electron 运行时，预处理用的是 nativeImage）：
 *   npm run bench:clip        # = electron scripts/clip-benchmark.mjs
 *
 * 基准集：scripts/clip-benchmark-gen.py 生成（10 类 × 10 张，默认 <仓库>/../.rc-clip-bench）。
 * 输出：每分类准确率 + 混淆明细 + 总体准确率；总体 < 0.90 时进程退出码为 1（门禁）。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = process.env.RC_MODELS || path.resolve(REPO, '..', '.rc-models');
const BENCH_DIR = process.env.RC_BENCH || path.resolve(REPO, '..', '.rc-clip-bench');
const THRESHOLD = Number(process.env.RC_CLIP_THRESHOLD || 0.22);
const GATE = 0.90;

if (!process.versions.electron) {
  console.error('请在 Electron 运行时下执行：npm run bench:clip（预处理依赖 nativeImage）');
  process.exit(2);
}
const { app } = await import('electron');
const { ClipEngine, DEFAULT_THRESHOLD } = require('../electron/clip.js');
const { TREE } = require('../electron/tools.js');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);
const pad = (s, n) => String(s).padEnd(n, ' ');
const padL = (s, n) => String(s).padStart(n, ' ');

app.whenReady().then(async () => {
  const t0 = Date.now();
  try {
    if (!fs.existsSync(BENCH_DIR)) {
      console.error(`基准集不存在：${BENCH_DIR}\n先用 scripts/clip-benchmark-gen.py 生成。`);
      app.exit(2);
      return;
    }
    const eng = new ClipEngine({ modelsDir: MODELS_DIR, threshold: DEFAULT_THRESHOLD });
    await eng.ensureReady((p) => {
      if (p.stage === 'download') console.log(`下载模型 ${p.file} …`);
    });
    await eng.ensureTextEmb(TREE);
    const cats = [...eng.textEmb.keys()];
    console.log(`模型就绪（${Date.now() - t0}ms），候选分类 ${cats.length} 个：${cats.join(' / ')}`);
    console.log('');

    // 收集样本
    const samples = [];
    for (const entry of fs.readdirSync(BENCH_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(BENCH_DIR, entry.name);
      for (const f of fs.readdirSync(dir)) {
        if (!IMG_EXT.has(path.extname(f).toLowerCase())) continue;
        samples.push({ gold: entry.name, file: path.join(dir, f) });
      }
    }
    if (!samples.length) {
      console.error('基准集里没有图片');
      app.exit(2);
      return;
    }

    // 逐张跑分类
    const stat = new Map(cats.map((c) => [c, { total: 0, ok: 0, sumScore: 0 }]));
    const confusion = new Map();
    const detail = process.env.RC_BENCH_DETAIL === '1';
    let adopted = 0;
    for (const s of samples) {
      const buf = fs.readFileSync(s.file);
      let pred = '(error)', score = -1;
      try {
        const vec = await eng.embedImage(buf);
        const best = eng.bestMatch(vec);
        pred = best.cat;
        score = best.score;
        if (score >= THRESHOLD) adopted++;
      } catch (e) {
        pred = '(error)';
      }
      if (detail) {
        const mark = pred === s.gold ? '✓' : '✗';
        console.log(`${mark} ${pad(path.basename(s.gold || ''), 0)}${s.gold} / ${path.basename(s.file)}  → ${pred} ${score >= 0 ? score.toFixed(4) : ''}`);
      }
      const st = stat.get(s.gold) || { total: 0, ok: 0, sumScore: 0 };
      st.total++;
      if (pred === s.gold) { st.ok++; st.sumScore += score; }
      else {
        const key = `${s.gold} → ${pred}`;
        confusion.set(key, (confusion.get(key) || 0) + 1);
      }
      stat.set(s.gold, st);
    }

    // 报表
    const nameW = Math.max(10, ...cats.map((c) => c.length)) + 2;
    console.log(`${pad('分类', nameW)}${padL('正确', 6)}${padL('总数', 6)}${padL('准确率', 9)}${padL('均分', 8)}`);
    console.log('-'.repeat(nameW + 30));
    let okSum = 0;
    for (const c of cats) {
      const st = stat.get(c);
      if (!st || !st.total) continue;
      okSum += st.ok;
      const acc = st.ok / st.total;
      const mean = st.ok ? st.sumScore / st.ok : NaN;
      console.log(`${pad(c, nameW)}${padL(st.ok, 6)}${padL(st.total, 6)}${padL((acc * 100).toFixed(1) + '%', 9)}${padL(Number.isFinite(mean) ? mean.toFixed(4) : '—', 8)}`);
    }
    const overall = okSum / samples.length;
    console.log('-'.repeat(nameW + 30));
    console.log(`${pad('总体', nameW)}${padL(okSum, 6)}${padL(samples.length, 6)}${padL((overall * 100).toFixed(1) + '%', 9)}`);
    console.log('');
    console.log(`阈值 ${THRESHOLD} 采纳率：${adopted}/${samples.length}（${((adopted / samples.length) * 100).toFixed(1)}%）`);

    const confEntries = [...confusion.entries()].sort((a, b) => b[1] - a[1]);
    if (confEntries.length) {
      console.log('');
      console.log('混淆明细（真实 → 误判为：次数）：');
      for (const [k, n] of confEntries) console.log(`  ${k}: ${n}`);
    }

    console.log('');
    console.log(`总耗时 ${(Date.now() - t0) / 1000 | 0}s · 总体准确率 ${(overall * 100).toFixed(1)}% · 门禁 ${GATE * 100}%`);
    if (overall < GATE) {
      console.error(`未达标：总体准确率 ${(overall * 100).toFixed(1)}% < ${GATE * 100}%`);
      app.exit(1);
    } else {
      app.exit(0);
    }
  } catch (e) {
    console.error('BENCH FAIL', e);
    app.exit(2);
  }
});
