'use strict';
/* 临时调试脚本：quantized vs fp16 视觉模型 A/B + 通道顺序对照，跑完即删 */
const { app } = require('electron');
const fs = require('fs');

app.whenReady().then(async () => {
  try {
    const ort = require('onnxruntime-node');
    const { ClipTokenizer, preprocessImage } = require('../electron/clip');
    const { TREE } = require('../electron/tools');
    const tk = await ClipTokenizer.load('D:/download/wbAI/save/test/.rc-models');

    const norm = (v) => { let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s) || 1; const o = Float32Array.from(v); for (let i = 0; i < o.length; i++) o[i] /= n; return o; };
    const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

    const sessions = {};
    for (const tag of ['quantized', 'fp16']) {
      sessions[tag] = {
        text: await ort.InferenceSession.create(`D:/download/wbAI/save/test/.rc-models/text_model_${tag === 'fp16' ? 'fp16' : 'quantized'}.onnx`, { executionProviders: ['cpu'] }),
        vision: await ort.InferenceSession.create(`D:/download/wbAI/save/test/.rc-models/vision_model_${tag === 'fp16' ? 'fp16' : 'quantized'}.onnx`, { executionProviders: ['cpu'] })
      };
    }

    const embText = async (tag, t) => {
      const ids = tk.encode(t);
      const out = await sessions[tag].text.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, 77]) });
      return norm(Float32Array.from(out.text_embeds.data));
    };

    // 语义打包的通用版：variant=rgb | bgr
    const embedImageV = async (tag, buf, variant = 'rgb') => {
      const px = preprocessImage(buf); // RGB CHW
      let data = px;
      if (variant === 'bgr') {
        data = px.slice();
        const plane = 224 * 224;
        for (let i = 0; i < plane; i++) { const t = data[i]; data[i] = data[2 * plane + i]; data[2 * plane + i] = t; }
      }
      const out = await sessions[tag].vision.run({ pixel_values: new ort.Tensor('float32', data, [1, 3, 224, 224]) });
      return norm(Float32Array.from(out.image_embeds.data));
    };

    // 类文本 embedding（两边都用同代模型）
    const catVec = {};
    for (const tag of ['quantized', 'fp16']) {
      catVec[tag] = {};
      for (const [cat, subs] of TREE) {
        const prompts = require('../electron/clip').PROMPTS[cat] || ['a random miscellaneous picture with no clear subject'];
        let acc = null;
        for (const p of prompts) {
          const v = await embText(tag, p);
          if (!acc) acc = Float32Array.from(v); else for (let i = 0; i < acc.length; i++) acc[i] += v[i];
        }
        catVec[tag][cat] = norm(acc);
      }
    }

    const dir = 'D:/download/wbAI/save/test/.rc-smoke-imgs/';
    const report = async (name, buf) => {
      for (const tag of ['quantized', 'fp16']) {
        for (const variant of ['rgb', 'bgr']) {
          const v = await embedImageV(tag, buf, variant);
          const scores = Object.entries(catVec[tag]).map(([c, tv]) => ({ c, s: dot(v, tv) })).sort((a, b) => b.s - a.s);
          const spread = (scores[0].s - scores[2].s).toFixed(4);
          console.log(name, tag, variant, 'top3:', scores.slice(0, 3).map((x) => `${x.c}:${x.s.toFixed(4)}`).join(' '), ' spread:', spread);
        }
      }
    };
    for (const f of ['h1.png', 's2.png', 'p3.png']) await report(f, fs.readFileSync(dir + f));

    // 红圆控制（归一化后的真余弦）
    const { nativeImage } = require('electron');
    const N = 224;
    const bmp = Buffer.alloc(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const inC = (x - N / 2) ** 2 + (y - N / 2) ** 2 < (N / 3) ** 2;
      bmp[i] = inC ? 30 : 255; bmp[i + 1] = inC ? 40 : 255; bmp[i + 2] = inC ? 220 : 255; bmp[i + 3] = 255;
    }
    const redPng = nativeImage.createFromBitmap(bmp, { width: N, height: N }).toPNG();
    for (const tag of ['quantized', 'fp16']) {
      const v = await embedImageV(tag, redPng, 'rgb');
      const t1 = await embText(tag, 'a red circle on a white background');
      const t2 = await embText(tag, 'a blue circle on a dark background');
      console.log('RED-CIRCLE', tag, 'red:', dot(v, t1).toFixed(4), 'blue:', dot(v, t2).toFixed(4));
    }
  } catch (e) {
    console.error('DEBUG FAIL', e);
  }
  app.exit(0);
});
