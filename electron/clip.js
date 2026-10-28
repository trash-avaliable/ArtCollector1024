'use strict';
/**
 * CLIP 零样本视觉分类（Xenova/clip-vit-base-patch32 量化 ONNX）。
 *
 * - 纯 JS 的 CLIP BPE tokenizer（读 vocab.json + merges.txt，即 GPT-2 那套）
 * - 图像预处理：短边缩到 224 → 中心裁 224×224 → CLIP mean/std 归一化（nativeImage 解码）
 * - 文本 embedding：每个分类 3-5 条英文 prompt，类内取平均后归一化，进程内缓存
 * - 余弦 top-1，≥ 阈值才采纳；模型缺失时从 hf-mirror 下载到共用目录，不打进安装包
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MODEL_BASE = 'https://hf-mirror.com/Xenova/clip-vit-base-patch32/resolve/main';
const FILES = [
  { file: 'text_model_quantized.onnx', url: MODEL_BASE + '/onnx/text_model_quantized.onnx' },
  { file: 'vision_model_quantized.onnx', url: MODEL_BASE + '/onnx/vision_model_quantized.onnx' },
  { file: 'vocab.json', url: MODEL_BASE + '/vocab.json' },
  { file: 'merges.txt', url: MODEL_BASE + '/merges.txt' }
];

const SOT = 49406;
const EOT = 49407;
const CTX = 77;          // CLIP 文本上下文长度
const SIDE = 224;        // 图像输入边长
const DEFAULT_THRESHOLD = 0.22;

/* ---------------- 每个分类的英文 prompt（键 = electron/tools.js TREE 里的分类名） ---------------- */
/* 经 scripts/clip-benchmark.mjs（100 张合成基准图）实测调优，总体准确率见最终报告 */
const PROMPTS = {
  '人体结构': [
    'a line drawing of an open human hand showing five fingers',
    'an anatomy sketch of an open palm, fingers and knuckles',
    'a close-up pencil sketch of a human hand, anatomy practice',
    'a black and white anatomy sketch of human body parts on paper',
    'a foot anatomy sketch with ankle bones and toes',
    'a human skull anatomy drawing with jaw and teeth',
    'a study of human hand bones and finger joints'
  ],
  '动态与透视': [
    'a stick figure runner sprinting with speed lines',
    'a dynamic action figure pose with movement arcs',
    'a running character silhouette with motion trails',
    'a perspective construction of a floor with a vanishing point',
    'a one point perspective grid for drawing',
    'a jumping figure with speed lines, movement study'
  ],
  '线条练习': [
    'a page of pencil hatching and cross hatching exercises',
    'an abstract line drill sheet with parallel strokes and spirals',
    'a pen control practice sheet with wavy and zigzag lines',
    'random pencil doodle strokes and hatching, abstract practice',
    'abstract mark making practice: dots, dashes and contour lines',
    'rows of repeated stroke drills on sketch paper'
  ],
  '色彩与光影': [
    'a color palette swatch sheet with rows of colored squares',
    'a color chart with many colored squares in rows',
    'a shaded sphere study showing light, shadow and highlight',
    'a value scale with gray squares from dark to light',
    'a ball with light and shadow, rendering practice',
    'a grid of color swatches for artist reference'
  ],
  '美术风格': [
    'a pixel art sprite made of visible square blocks',
    'an 8-bit style pixel character with chunky pixels',
    'a pixelated game asset with a limited palette',
    'a retro pixel art illustration with big blocky pixels',
    'a video game pixel art icon',
    'a pixel art landscape made of square tiles'
  ],
  '教程与拆解': [
    'a step by step drawing tutorial with numbered panels',
    'four numbered boxes showing how to draw step by step',
    'a worksheet with numbered steps and arrows',
    'a how to draw tutorial with progressive stages in boxes',
    'a drawing lesson sheet with stages in frames and step numbers'
  ],
  '服饰与道具': [
    'a flat lay fashion template of a t-shirt with collar and seams',
    'a fashion flat sketch of garments: t-shirt, hoodie, skirt',
    'a tailor sketch of clothes with stitching and seam lines',
    'a clothing pattern drawing of a dress with a belt',
    'a concept design of a sword and shield weapon props',
    'a fantasy weapon design of a sword with hilt and guard',
    'a potion bottle and fantasy props concept art'
  ],
  '场景与背景': [
    'a landscape painting with mountains, sky and clouds',
    'a scenery background with hills, sun and trees',
    'an outdoor nature scene with sea, sky and horizon',
    'a wide environment background with mountains at sunset',
    'a cartoon landscape background with meadow and clouds',
    'a city skyline background with buildings at dusk'
  ],
  '表情与情绪': [
    'colorful cartoon smiley faces with different emotions',
    'a happy face, an angry face and a crying face together',
    'a grid of colorful emotive cartoon faces',
    'a character emotion chart with surprised and angry expressions',
    'a set of round yellow emoji faces with feelings'
  ],
  '灵感碎片': [
    'a collage poster of many overlapping colorful photos',
    'a scrapbook collage with taped pictures',
    'an art collage of layered cutouts and clippings',
    'many pictures glued together on a board',
    'a mood board with overlapping polaroid photos and tape'
  ],
  '待分类': [
    'a random miscellaneous picture with no clear subject',
    'an unclear random snapshot of ordinary things',
    'a plain picture without any notable content'
  ]
};
const FALLBACK_PROMPTS = ['a random miscellaneous picture with no clear subject'];

// 分类树里的自定义分类（不在上表）：
// - 英文名（用户自建的 "Hands" / "Scene" 之类）直接拼成 prompt，子分类名也一起用
// - 中文名没有可用的英文翻译，落到通用 prompt，余弦普遍低于阈值 → 不采纳（宁缺毋滥）
function promptsFor(cat, subs = []) {
  if (PROMPTS[cat]) return PROMPTS[cat];
  const name = String(cat || '').trim().toLowerCase();
  if (name && /^[a-z0-9][a-z0-9 ,&'()-]*$/i.test(name)) {
    const out = [
      `a reference image of ${name}`,
      `a drawing or photo of ${name}`,
      `an art reference about ${name}`
    ];
    for (const s of subs.filter(Boolean).slice(0, 4)) {
      out.push(`a reference image of ${String(s).trim().toLowerCase()}`);
    }
    return out;
  }
  return FALLBACK_PROMPTS;
}

/* ---------------- CLIP BPE tokenizer（GPT-2 字节级 BPE） ---------------- */

const BYTES_TO_UNICODE = (() => {
  const printable = [];
  for (let b = 33; b < 127; b++) printable.push(b);
  for (let b = 161; b < 173; b++) printable.push(b);
  for (let b = 174; b < 256; b++) printable.push(b);
  const cs = printable.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!printable.includes(b)) { printable.push(b); cs.push(256 + n); n++; }
  }
  const map = new Map();
  for (let i = 0; i < printable.length; i++) map.set(printable[i], String.fromCodePoint(cs[i]));
  return map;
})();

const PRETOKEN_RE = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

class ClipTokenizer {
  constructor(vocab, merges) {
    // vocab.json: token 字符串 → id；merges.txt: 每行 "a b"，行号即合并优先级
    this.vocab = vocab instanceof Map ? vocab : new Map(Object.entries(vocab));
    this.ranks = new Map();
    for (let i = 0; i < merges.length; i++) this.ranks.set(merges[i], i);
    this.cache = new Map();
  }

  static async load(dir) {
    const [vocab, mergesText] = await Promise.all([
      fsp.readFile(path.join(dir, 'vocab.json'), 'utf8'),
      fsp.readFile(path.join(dir, 'merges.txt'), 'utf8')
    ]);
    const merges = mergesText.split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#version') && l.includes(' '))
      .map((l) => l.split(' ', 2).join(' '));
    return new ClipTokenizer(JSON.parse(vocab), merges);
  }

  byteEncode(str) {
    const out = [];
    for (const b of Buffer.from(str, 'utf8')) out.push(BYTES_TO_UNICODE.get(b) || '');
    return out.join('');
  }

  /** GPT-2 标准 BPE：词尾字符带 </w>，每轮合并秩最小的相邻对 */
  bpe(token) {
    if (this.cache.has(token)) return this.cache.get(token);
    const chars = Array.from(token);
    const word = chars.slice(0, -1).concat([chars[chars.length - 1] + '</w>']);
    if (word.length <= 1) {
      this.cache.set(token, word);
      return word;
    }
    let parts = word;
    for (;;) {
      let bestRank = -1, bestPair = null;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(parts[i] + ' ' + parts[i + 1]);
        if (r !== undefined && (bestRank < 0 || r < bestRank)) { bestRank = r; bestPair = [parts[i], parts[i + 1]]; }
      }
      if (!bestPair) break;
      const merged = [];
      for (let i = 0; i < parts.length;) {
        if (i < parts.length - 1 && parts[i] === bestPair[0] && parts[i + 1] === bestPair[1]) {
          merged.push(parts[i] + parts[i + 1]);
          i += 2;
        } else {
          merged.push(parts[i]);
          i++;
        }
      }
      parts = merged;
      if (parts.length === 1) break;
    }
    this.cache.set(token, parts);
    return parts;
  }

  /** 编码成 [SOT, ..., EOT, 0...]，定长 CTX */
  encode(text) {
    const clean = String(text || '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const ids = [SOT];
    for (const m of clean.matchAll(PRETOKEN_RE)) {
      const tok = m[0];
      if (tok === '<|startoftext|>') { ids.push(SOT); continue; }
      if (tok === '<|endoftext|>') { ids.push(EOT); continue; }
      const bytes = this.byteEncode(tok);
      for (const sub of this.bpe(bytes)) {
        const id = this.vocab.get(sub);
        if (id !== undefined) ids.push(id);
      }
      if (ids.length >= CTX - 1) break;
    }
    ids.push(EOT);
    if (ids.length > CTX) { ids.length = CTX - 1; ids.push(EOT); }
    while (ids.length < CTX) ids.push(0);
    return ids;
  }
}

/* ---------------- 图像预处理：nativeImage → 224×224 CHW float32 ---------------- */

function preprocessImage(buf) {
  // 惰性 require：让 tokenizer 可以在纯 node 环境里单测
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width: W, height: H } = img.getSize();
  if (!W || !H) return null;
  // 短边缩到 224（保持长宽比），再中心裁 224×224
  let rw, rh;
  if (W >= H) { rh = SIDE; rw = Math.max(SIDE, Math.round((W * SIDE) / H)); }
  else { rw = SIDE; rh = Math.max(SIDE, Math.round((H * SIDE) / W)); }
  let cur = img;
  if (rw !== W || rh !== H) {
    cur = img.resize({ width: rw, height: rh, quality: 'good' });
    if (cur.isEmpty()) return null;
    const s2 = cur.getSize();
    rw = s2.width; rh = s2.height;
  }
  const x0 = Math.max(0, Math.floor((rw - SIDE) / 2));
  const y0 = Math.max(0, Math.floor((rh - SIDE) / 2));
  const crop = cur.crop({ x: x0, y: y0, width: Math.min(SIDE, rw), height: Math.min(SIDE, rh) });
  if (crop.isEmpty()) return null;
  const size = crop.getSize();
  if (size.width !== SIDE || size.height !== SIDE) {
    const fixed = crop.resize({ width: SIDE, height: SIDE, quality: 'good' });
    if (fixed.isEmpty()) return null;
    return packPixels(fixed.toBitmap ? fixed.toBitmap() : fixed.getBitmap());
  }
  return packPixels(crop.toBitmap ? crop.toBitmap() : crop.getBitmap());
}

/** BGRA 位图 → CHW RGB float32，CLIP mean/std 归一化（bmp 为 224×224 的原始 BGRA Buffer） */
function packPixels(bmp) {
  const out = new Float32Array(3 * SIDE * SIDE);
  const MEAN = [0.48145466, 0.4578275, 0.40821073];
  const STD = [0.26862954, 0.26130258, 0.27577711];
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const b = bmp[i * 4], g = bmp[i * 4 + 1], r = bmp[i * 4 + 2];
    out[i] = (r / 255 - MEAN[0]) / STD[0];
    out[plane + i] = (g / 255 - MEAN[1]) / STD[1];
    out[2 * plane + i] = (b / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

/* ---------------- 模型下载 ---------------- */

async function downloadModels(dir, onDownload) {
  await fsp.mkdir(dir, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(dir, f.file);
    let st = null;
    try { st = await fsp.stat(dest); } catch { }
    if (st && st.size > 0) continue;
    if (onDownload) onDownload({ stage: 'download', file: f.file, done: 0, total: 1 });
    const res = await fetch(f.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`下载 ${f.file} 失败：HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const part = dest + '.part';
    await fsp.writeFile(part, Buffer.from(ab));
    await fsp.rename(part, dest);
    if (onDownload) onDownload({ stage: 'download', file: f.file, done: 1, total: 1, size: ab.byteLength });
  }
}

/* ---------------- 引擎 ---------------- */

function l2norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= n;
  return vec;
}

/** 采纳判定：top-1 余弦分 ≥ 阈值才写库，否则丢弃（宁缺毋滥） */
function adoptDecision(score, threshold = DEFAULT_THRESHOLD) {
  return typeof score === 'number' && Number.isFinite(score) && score >= threshold;
}

/* ---------------- 改判学习 kNN（方案 B） ---------------- */

const KNN_K = 5;              // 投票取相似度最高的 k 张
const KNN_SAMPLE_LIMIT = 200; // 每分类参与投票的样本上限（最近 200 张带 embedding 的库内图）
const KNN_WEIGHT = 0.5;       // 最终分 = 0.5*prompt + 0.5*kNN
const INBOX_CAT = '待分类';   // 收件箱不算学习样本：堆在这里的图既非手动归类也非采纳过，
                              // 让它们投票会把「待分类」越喂越肥，AI 永远出不了建议

/** 余弦相似度：内部各自除以模长，入参不必预先归一化；任一模长为 0 返回 NaN */
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return NaN;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 混合 prompt 余弦分与 kNN 投票分——改判学习的打分口径：
 * - 无 kNN（knnScore 为 null/undefined/NaN）：原样返回 prompt 分，纯 prompt 路径分毫不差
 * - 有 kNN：0.5*prompt + 0.5*kNN
 * - prompt 非法但有 kNN：退化用 kNN；两者都非法：-1
 */
function blendScores(promptScore, knnScore) {
  const p = typeof promptScore === 'number' && Number.isFinite(promptScore) ? promptScore : null;
  const k = typeof knnScore === 'number' && Number.isFinite(knnScore) ? knnScore : null;
  if (k === null) return p === null ? -1 : p;
  if (p === null) return k;
  return KNN_WEIGHT * p + KNN_WEIGHT * k;
}

/**
 * kNN 投票：新图向量 vec 与样本库 samples 逐一算余弦，取最高的 k 个的均值。
 * - samples 为空 / 没有同维样本 → null（调用方按纯 prompt 分处理，kNN 不介入）
 * - 维度不符的样本跳过，不炸整个投票
 * - 样本是 CLIP embedding（已归一化），这里仍按真余弦算，模长差异不偏置结果
 */
function knnVote(vec, samples, k = KNN_K) {
  if (!vec || !Array.isArray(samples) || !samples.length) return null;
  const sims = [];
  for (const s of samples) {
    if (!s || s.length !== vec.length) continue;
    const c = cosine(vec, s);
    if (Number.isFinite(c)) sims.push(c);
  }
  if (!sims.length) return null;
  sims.sort((a, b) => b - a);
  const kk = Math.max(1, Math.min(Number.isFinite(k) && k > 0 ? Math.floor(k) : KNN_K, sims.length));
  let sum = 0;
  for (let i = 0; i < kk; i++) sum += sims[i];
  return sum / kk;
}

class ClipEngine {
  constructor({ modelsDir, threshold = DEFAULT_THRESHOLD } = {}) {
    this.modelsDir = modelsDir;
    this.threshold = threshold;
    this.tokenizer = null;
    this.textSession = null;
    this.visionSession = null;
    this.textEmb = null;      // Map<分类名, Float32Array(512)>
    this.treeSig = '';
    this._ready = null;
  }

  /** 模型文件是否齐（不触发下载） */
  modelsReady() {
    return FILES.every((f) => { try { return fs.statSync(path.join(this.modelsDir, f.file)).size > 0; } catch { return false; } });
  }

  /** 加载会话 + tokenizer；模型缺失时先下载 */
  async ensureReady(onDownload) {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      if (!this.modelsReady()) await downloadModels(this.modelsDir, onDownload);
      if (!this.textSession) {
        const ort = require('onnxruntime-node');
        const opt = { executionProviders: ['cpu'] };
        this.ort = ort;
        this.textSession = await ort.InferenceSession.create(path.join(this.modelsDir, 'text_model_quantized.onnx'), opt);
        this.visionSession = await ort.InferenceSession.create(path.join(this.modelsDir, 'vision_model_quantized.onnx'), opt);
      }
      if (!this.tokenizer) this.tokenizer = await ClipTokenizer.load(this.modelsDir);
    })();
    try {
      await this._ready;
    } catch (e) {
      this._ready = null;   // 允许下次重试
      throw e;
    }
    return this._ready;
  }

  /** 文本 → 512 维 embedding（text_embeds 已带 projection） */
  async embedText(text) {
    const ids = this.tokenizer.encode(text);
    const input = new this.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, CTX]);
    const out = await this.textSession.run({ input_ids: input });
    const t = out.text_embeds || out[Object.keys(out)[0]];
    return Float32Array.from(t.data);
  }

  /** 图像 buffer → 512 维 embedding（image_embeds 已带 projection），L2 归一化 */
  async embedImage(buf) {
    const px = preprocessImage(buf);
    if (!px) throw new Error('图片解码失败');
    const input = new this.ort.Tensor('float32', px, [1, 3, SIDE, SIDE]);
    const out = await this.visionSession.run({ pixel_values: input });
    const t = out.image_embeds || out[Object.keys(out)[0]];
    return l2norm(Float32Array.from(t.data));
  }

  /**
   * 为分类树构建文本 embedding：每类多条 prompt 取平均后归一化。
   * 树没变就直接用缓存。
   */
  async ensureTextEmb(tree) {
    const sig = JSON.stringify(tree);
    if (this.textEmb && this.treeSig === sig) return this.textEmb;
    const map = new Map();
    for (const [cat, subs] of tree) {
      const prompts = promptsFor(cat, subs);
      let acc = null;
      for (const p of prompts) {
        // 逐条 L2 归一化再平均：raw text_embeds 的模长不一（2.8~3.5），不归一化会偏 weighting
        const v = l2norm(Float32Array.from(await this.embedText(p)));
        if (!acc) acc = v;
        else for (let i = 0; i < acc.length; i++) acc[i] += v[i];
      }
      if (acc) map.set(cat, l2norm(acc));
    }
    this.textEmb = map;
    this.treeSig = sig;
    return map;
  }

  bestMatch(imgVec) {
    let cat = '', score = -1;
    for (const [c, tv] of this.textEmb) {
      let dot = 0;
      for (let i = 0; i < imgVec.length; i++) dot += imgVec[i] * tv[i];
      if (dot > score) { score = dot; cat = c; }
    }
    return { cat, score };
  }

  /**
   * 批量分类（改判学习版）：
   * 1. 每张图算 embedding → 顺手 upsert asset_embed（无论采纳与否，embedding 是 kNN 的地基）
   * 2. 打分 = prompt 余弦分；该分类下若有带 embedding 的库内图（用户手动归类过/之前采纳过，
   *    最近 200 张），再算 kNN top-5 均值，最终分 = 0.5*prompt + 0.5*kNN（blendScores）
   * 3. top-1 且 ≥ 阈值才采纳；采纳前校验目标分类还在当前分类树里（getTree 取实时树），
   *    不在 → 跳过并标 stale:true，防止把建议写到已被删除的孤儿分类上（方案 A）
   * onProgress({ done, total, adopted, current }) 每张回调一次。
   * 返回 { total, adopted, items: [{ id, name, cat, score, knn, adopted, stale, error? }] }
   */
  async classifyIds(tools, ids, tree, { onProgress, getTree } = {}) {
    await this.ensureReady(onProgress);
    if (!Array.isArray(tree) || !tree.length) throw new Error('没有可用的分类树');
    await this.ensureTextEmb(tree);

    // 每分类的 kNN 样本一次取齐（最近 200 张带 embedding 的图）；引擎/库没有 embedding 能力就全空 = 纯 prompt
    const samplesByCat = new Map();
    const canEmbed = typeof tools.embedSamples === 'function';
    for (const [cat] of tree) {
      let rows = [];
      if (canEmbed && cat !== INBOX_CAT) {
        try { rows = tools.embedSamples(cat, KNN_SAMPLE_LIMIT) || []; } catch { rows = []; }
      }
      samplesByCat.set(cat, rows);
    }
    const canPersist = typeof tools.upsertEmbedding === 'function';

    const results = [];
    let adopted = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const it = tools.getById(id);
      let entry = { id, name: it ? it.name : id, cat: '', score: -1, knn: null, adopted: false, stale: false };
      if (it) {
        try {
          const buf = await fsp.readFile(tools.itemFile(it));
          const imgVec = await this.embedImage(buf);
          // 顺手落库：新图无论采纳与否都存，后台不用再为它补算
          if (canPersist) { try { tools.upsertEmbedding(id, imgVec); } catch { } }

          // 混合打分：prompt 余弦 + kNN 投票（把「正在分类的这张自己」从样本里剔掉，防自匹配刷分）
          let bestCat = '', bestScore = -1, bestKnn = null;
          for (const [cat, tv] of this.textEmb) {
            let dot = 0;
            for (let j = 0; j < imgVec.length; j++) dot += imgVec[j] * tv[j];
            let knn = null;
            const rows = samplesByCat.get(cat);
            if (rows && rows.length) {
              const vecs = [];
              for (const r of rows) if (r.id !== id) vecs.push(r.vec);
              knn = knnVote(imgVec, vecs);
            }
            const s = blendScores(dot, knn);
            if (s > bestScore) { bestScore = s; bestCat = cat; bestKnn = knn; }
          }
          entry.cat = bestCat;
          entry.score = +bestScore.toFixed(4);
          entry.knn = bestKnn === null ? null : +bestKnn.toFixed(4);

          if (adoptDecision(bestScore, this.threshold)) {
            // 方案 A 采纳校验：目标必须是当前分类树里的活分类（运行中用户删分类也不写孤儿建议）
            const liveTree = typeof getTree === 'function' ? getTree() : tree;
            const alive = Array.isArray(liveTree) && liveTree.some(([c]) => c === bestCat);
            if (!alive) {
              entry.stale = true;
            } else {
              tools.setClip(id, bestCat, entry.score);
              entry.adopted = true;
              adopted++;
            }
          }
        } catch (e) {
          entry.error = e.message || String(e);
        }
      } else {
        entry.error = '素材不存在';
      }
      results.push(entry);
      if (onProgress) onProgress({ done: i + 1, total: ids.length, adopted, current: entry });
    }
    return { total: ids.length, adopted, items: results };
  }
}

module.exports = { ClipEngine, ClipTokenizer, preprocessImage, downloadModels, PROMPTS, packPixels, l2norm, adoptDecision, blendScores, knnVote, cosine, DEFAULT_THRESHOLD, KNN_K, KNN_SAMPLE_LIMIT, KNN_WEIGHT, INBOX_CAT };
