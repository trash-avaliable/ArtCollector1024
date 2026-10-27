'use strict';

const D65 = { x: 0.95047, y: 1, z: 1.08883 };

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function rgbToLab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65.x;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / D65.y;
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / D65.z;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };
  const x = inv(fx) * D65.x;
  const y = inv(fy) * D65.y;
  const z = inv(fz) * D65.z;
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const bb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bb)];
}

function deltaE76(l1, a1, b1, l2, a2, b2) {
  const dl = l1 - l2, da = a1 - a2, db = b1 - b2;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// buffer: raw BGRA pixels (Electron getBitmap / canvas ImageData with swapped channels)
function pixelsToLabSamples(buf, width, height) {
  const out = [];
  // 调用方传入的 w/h 可能比实际缓冲区多算一行/列（裁剪框四舍五入误差），
  // 读越界会拿到 undefined → Lab 变 NaN → 写库撞 NOT NULL，这里按缓冲区实际大小截断
  const n = Math.min(width * height, Math.floor(buf.length / 4));
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const a = buf[i + 3];
    if (a < 96) continue;
    const b = buf[i], g = buf[i + 1], r = buf[i + 2];
    const lab = rgbToLab(r, g, b);
    out.push({ r, g, bl: b, l: lab[0], a: lab[1], b: lab[2] });
  }
  return out;
}

function kmeans(samples, k, rand) {
  if (!samples.length) return [];
  k = Math.min(k, samples.length);
  const centers = [];
  const first = samples[Math.floor(rand() * samples.length)];
  centers.push([first.l, first.a, first.b]);

  while (centers.length < k) {
    let total = 0;
    const dists = samples.map((s) => {
      let best = Infinity;
      for (const c of centers) best = Math.min(best, deltaE76(s.l, s.a, s.b, c[0], c[1], c[2]));
      const d = best * best;
      total += d;
      return d;
    });
    if (total <= 0) break;
    let pick = rand() * total;
    let idx = 0;
    for (; idx < dists.length; idx++) {
      pick -= dists[idx];
      if (pick <= 0) break;
    }
    const s = samples[Math.min(idx, samples.length - 1)];
    centers.push([s.l, s.a, s.b]);
  }

  const assign = new Int32Array(samples.length).fill(-1);
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE76(s.l, s.a, s.b, centers[c][0], centers[c][1], centers[c][2]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = centers.map(() => ({ n: 0, l: 0, a: 0, b: 0, r: 0, g: 0, bl: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], acc = sums[assign[i]];
      acc.n++; acc.l += s.l; acc.a += s.a; acc.b += s.b; acc.r += s.r; acc.g += s.g; acc.bl += s.bl;
    }
    for (let c = 0; c < centers.length; c++) {
      if (!sums[c].n) continue;
      centers[c] = [sums[c].l / sums[c].n, sums[c].a / sums[c].n, sums[c].b / sums[c].n];
    }
    if (!moved && iter > 0) break;
  }

  const clusters = centers.map((c, i) => ({ i, n: 0, l: c[0], a: c[1], b: c[2], r: 0, g: 0, bl: 0 }));
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], cl = clusters[assign[i]];
    if (!cl) continue;
    cl.n++; cl.r += s.r; cl.g += s.g; cl.bl += s.bl;
  }
  return clusters.filter((c) => c.n > 0).map((c) => ({
    r: Math.round(c.r / c.n),
    g: Math.round(c.g / c.n),
    b: Math.round(c.bl / c.n),
    l: c.l, a: c.a, b2: c.b,
    n: c.n
  }));
}

function mergeSimilar(clusters, maxDelta) {
  const sorted = clusters.slice().sort((a, b) => b.n - a.n);
  const kept = [];
  for (const c of sorted) {
    let merged = false;
    for (const k of kept) {
      if (deltaE76(c.l, c.a, c.b2, k.l, k.a, k.b2) < maxDelta) {
        const total = k.n + c.n;
        k.r = Math.round((k.r * k.n + c.r * c.n) / total);
        k.g = Math.round((k.g * k.n + c.g * c.n) / total);
        k.b = Math.round((k.b * k.n + c.b * c.n) / total);
        k.l = (k.l * k.n + c.l * c.n) / total;
        k.a = (k.a * k.n + c.a * c.n) / total;
        k.b2 = (k.b2 * k.n + c.b2 * c.n) / total;
        k.n = total;
        merged = true;
        break;
      }
    }
    if (!merged) kept.push({ ...c });
  }
  return kept;
}

function paletteFromBGRA(buf, width, height, opts = {}) {
  const k = opts.k || 6;
  const max = opts.max || 8;
  const samples = pixelsToLabSamples(buf, width, height);
  if (!samples.length) return [];
  const rand = mulberry32(opts.seed || 0xC0FFEE);
  const clusters = mergeSimilar(kmeans(samples, k, rand), 6);
  const total = samples.length;
  return clusters
    .map((c) => ({
      hex: toHex(c.r, c.g, c.b),
      l: +c.l.toFixed(2),
      a: +c.a.toFixed(2),
      b: +c.b2.toFixed(2),
      pct: +((c.n / total) * 100).toFixed(2)
    }))
    .filter((c) => c.pct >= 0.5)
    .sort((x, y) => y.pct - x.pct)
    .slice(0, max);
}

module.exports = {
  rgbToLab, labToRgb, deltaE76, hexToRgb, hexToLab, toHex,
  paletteFromBGRA, pixelsToLabSamples
};
