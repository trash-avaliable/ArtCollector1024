// GPU 等高线背景（topolines 库）测试：主题映射表 / props 联动数学 / 降级决策三态 / 依赖与 Electron 通路。
// node --test tests/topo-gpu.test.mjs（或 npm test）
// 契约（RTM-S29 顶层升级）：
// - GPU 路径 = topolines（WebGL1 + OES_standard_derivatives 噪声等高线），颜色/密度随五主题
// - 旧 SVG 路径（lib/topo.ts + .topo）保留为无 WebGL / RC_NOGPU=1 的兜底，不删除
// - 降级三态：gpu / gpu-static（设置「减少动效」speed 0 静帧）/ svg
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TOPO_LINE_RGB, TOPO_TOKEN_ALPHA, topoGpuProps, decideTopoMode,
  deriveLevels, deriveLineWidth, clampTopoOpacity, isDarkTheme
} from '../src/lib/topo-gpu.ts';
import { THEME_IDS } from '../src/lib/settings-core.ts';

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CSS = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const TSX = fs.readFileSync(new URL('../src/components/TopoBackground.tsx', import.meta.url), 'utf8');
const TYPES = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const MAIN_JS = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const PRELOAD_JS = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');

/* ---------------- 解析 CSS：按大括号配平取出声明块（与 theme.test.mjs 同法） ---------------- */

function extractBlock(css, startMarker) {
  const i = css.indexOf(startMarker);
  assert.ok(i >= 0, `找不到块 ${startMarker}`);
  const open = css.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) break; }
  }
  return css.slice(open + 1, j);
}

function varsOf(block) {
  const map = new Map();
  let depth = 0;
  for (const line of block.split('\n')) {
    const opens = (line.match(/{/g) || []).length, closes = (line.match(/}/g) || []).length;
    if (depth === 0) {
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);/);
      if (m) map.set(m[1], m[2].trim());
    }
    depth += opens - closes;
  }
  return map;
}

const THEME_VARS = {
  'endfield-light': varsOf(extractBlock(CSS, ':root {')),
  ark: varsOf(extractBlock(CSS, '[data-theme="ark"] {')),
  exa: varsOf(extractBlock(CSS, '[data-theme="exa"] {')),
  popucom: varsOf(extractBlock(CSS, '[data-theme="popucom"] {')),
  corporate: varsOf(extractBlock(CSS, '[data-theme="corporate"] {'))
};

/** 感知亮度（Rec.709）——验证「exa 深底上线更亮」用 */
const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/* ---------------- 1. 依赖存在性 ---------------- */

test('RTM-S29: topo-gpu 依赖——topolines 进 dependencies（^0.3，MIT 零依赖），react 入口在包内', () => {
  assert.ok(PKG.dependencies.topolines, 'topolines 必须在 dependencies（运行时渲染路径）');
  assert.match(PKG.dependencies.topolines, /\^0\.3\.\d+/);
  assert.ok(!PKG.devDependencies?.topolines, '不得放 devDependencies');
  assert.ok(!PKG.devDependencies?.react, '不得动 react 依赖位置');
  assert.equal(PKG.version, '0.9.0', '版本号不得变动');
  assert.ok(
    fs.existsSync(new URL('../node_modules/topolines/dist/react.js', import.meta.url)),
    'node_modules/topolines 的 react 入口缺失（先 npm i topolines）'
  );
});

/* ---------------- 2. 主题→颜色映射表（五主题全查，与 CSS token 逐组对账） ---------------- */

test('RTM-S29: topo-gpu 主题→颜色映射表——五主题 RGB 与 styles.css --topo-line 色值逐组一致', () => {
  for (const id of THEME_IDS) {
    const v = THEME_VARS[id].get('--topo-line');
    assert.ok(v, `主题 ${id} 缺 --topo-line token`);
    const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    assert.ok(m, `${id} 的 --topo-line 不是 rgba() 形式: ${v}`);
    assert.deepEqual(
      [...TOPO_LINE_RGB[id]], [Number(m[1]), Number(m[2]), Number(m[3])],
      `${id} 的 GPU 线色表与 CSS token 不一致`
    );
  }
});

test('RTM-S29: topo-gpu 主题→alpha 映射表——TOPO_TOKEN_ALPHA 与 styles.css --topo-line 的 alpha 一致', () => {
  for (const id of THEME_IDS) {
    const m = THEME_VARS[id].get('--topo-line')?.match(/,\s*([\d.]+)\s*\)/);
    assert.ok(m, `${id} 缺 alpha 段`);
    assert.equal(TOPO_TOKEN_ALPHA[id], Number(m[1]), `${id} 的 token alpha 表与 CSS 不一致`);
  }
});

test('RTM-S29: topo-gpu color 串——五主题均为合法 rgb() 格式，exa（唯一深色）线色感知亮度最高', () => {
  for (const id of THEME_IDS) {
    const p = topoGpuProps(id);
    const [r, g, b] = TOPO_LINE_RGB[id];
    assert.equal(p.color, `rgb(${r}, ${g}, ${b})`, `${id} 的 color 串不符合 rgb() 约定`);
  }
  for (const id of THEME_IDS) {
    if (id === 'exa') continue;
    assert.ok(luma(TOPO_LINE_RGB.exa) > luma(TOPO_LINE_RGB[id]), `${id} 比 exa 还亮是不对的`);
  }
});

/* ---------------- 3. props 推导纯函数（联动数学） ---------------- */

test('RTM-S29: topo-gpu props 推导——五主题全查 levels/lineWidth/opacity/speed/scale/maxDpr 合法域', () => {
  assert.deepEqual([...THEME_IDS], ['endfield-light', 'ark', 'exa', 'popucom', 'corporate']);
  for (const id of THEME_IDS) {
    const p = topoGpuProps(id);
    assert.ok(p.levels >= 9 && p.levels <= 13, `${id} levels=${p.levels} 越界 [9,13]`);
    assert.ok(p.lineWidth >= 0.8 && p.lineWidth <= 1.3, `${id} lineWidth=${p.lineWidth} 越界`);
    assert.ok(p.opacity >= 0.1 && p.opacity <= 0.18, `${id} opacity=${p.opacity} 越界 [0.10,0.18]`);
    assert.ok(p.speed >= 0.008 && p.speed <= 0.012, `${id} speed=${p.speed} 越界慢速带`);
    assert.equal(p.scale, 1.2, `${id} scale 应为 1.2`);
    assert.equal(p.maxDpr, 1.5, `${id} maxDpr 性能上限 1.5`);
    assert.equal(p.warp, 0.18, `${id} warp 应取有机地形默认 0.18`);
    assert.equal(typeof p.seed, 'string', `${id} seed 必须是字符串`);
    assert.ok(p.seed.length > 0, `${id} seed 必须非空`);
  }
});

test('RTM-S29: topo-gpu 联动数学——exa 深底加两档密度（levels 12）→ 线宽同步降到 1.0', () => {
  assert.equal(isDarkTheme('exa'), true);
  assert.equal(isDarkTheme('endfield-light'), false);
  assert.equal(deriveLevels('exa'), 12, '深色主题 levels 12');
  assert.equal(deriveLevels('endfield-light'), 10, '浅色主题 levels 10');
  assert.equal(topoGpuProps('exa').lineWidth, 1);
  assert.equal(topoGpuProps('endfield-light').lineWidth, 1.1);
  assert.equal(topoGpuProps('exa').levels, 12);
  assert.ok(topoGpuProps('exa').lineWidth < topoGpuProps('ark').lineWidth, '更密的线必须更细');
});

test('RTM-S29: topo-gpu 联动数学——线宽公式 1.1-(levels-10)*0.05 逐点一致且随密度单调递减', () => {
  for (let levels = 9; levels <= 13; levels++) {
    assert.equal(deriveLineWidth(levels), +(1.1 - (levels - 10) * 0.05).toFixed(2), `levels=${levels}`);
  }
  assert.ok(deriveLineWidth(13) < deriveLineWidth(12), '密度越高线越细');
  assert.ok(deriveLineWidth(12) < deriveLineWidth(9), '密度越高线越细（跨档）');
});

test('RTM-S29: topo-gpu 联动数学——opacity = token alpha 收进 [0.10,0.18]（endfield 0.20 压到 0.18）', () => {
  assert.equal(clampTopoOpacity(0.2), 0.18);
  assert.equal(clampTopoOpacity(0.16), 0.16);
  assert.equal(clampTopoOpacity(0.14), 0.14);
  assert.equal(clampTopoOpacity(0.05), 0.1);
  assert.equal(clampTopoOpacity(0.5), 0.18);
  assert.equal(topoGpuProps('endfield-light').opacity, 0.18);
  assert.equal(topoGpuProps('corporate').opacity, 0.14);
  for (const id of THEME_IDS) {
    assert.ok(topoGpuProps(id).opacity <= 0.18, `${id} 透明度不得压过内容红线`);
  }
});

test('RTM-S29: topo-gpu 慢速带——五主题 speed ∈ [0.008,0.012]（约 7~10px/s，不抢内容戏）', () => {
  for (const id of THEME_IDS) {
    const s = topoGpuProps(id).speed;
    assert.ok(s >= 0.008 && s <= 0.012, `${id} speed=${s} 越界`);
  }
  assert.ok(topoGpuProps('exa').speed <= topoGpuProps('endfield-light').speed, '深色主题漂速不快于默认浅色');
});

test('RTM-S29: topo-gpu seed 恒定——五主题同 seed，主题切换走 setOptions 活更新不重建 GL 上下文', () => {
  const seeds = new Set(THEME_IDS.map(id => topoGpuProps(id).seed));
  assert.equal(seeds.size, 1, 'seed 必须与主题无关（换主题零闪烁、零重建）');
  assert.equal(typeof [...seeds][0], 'string');
});

/* ---------------- 4. 降级决策三态 ---------------- */

test('RTM-S29: topo-gpu 降级决策——RC_NOGPU / WebGL 失败 → svg；reduce → gpu-static；正常 → gpu', () => {
  assert.equal(decideTopoMode({ noGpu: false, webglSupported: true, reducedMotion: false }), 'gpu');
  assert.equal(decideTopoMode({}), 'gpu', '未知能力按可用处理（组件内 fallback 再兜一层）');
  assert.equal(decideTopoMode({ noGpu: true, webglSupported: true }), 'svg', 'RC_NOGPU=1 强制 SVG');
  assert.equal(decideTopoMode({ webglSupported: false }), 'svg', 'WebGL 探测失败走 SVG');
  assert.equal(decideTopoMode({ webglSupported: null }), 'gpu');
  assert.equal(decideTopoMode({ webglSupported: true, reducedMotion: true }), 'gpu-static', 'reduce → 静帧非隐藏');
  assert.equal(decideTopoMode({ noGpu: true, reducedMotion: true }), 'svg', 'noGpu 优先于 reduce');
  assert.equal(decideTopoMode({ webglSupported: false, reducedMotion: true }), 'svg', '无 WebGL 优先于 reduce');
});

/* ---------------- 5. 组件与 Electron 通路（源码契约） ---------------- */

test('RTM-S29: topo-gpu 组件降级链——fallback prop 接旧 SVG 实现 + isSupported 探测 + 三态决策', () => {
  assert.match(TSX, /import \{ Topolines, type TopolinesHandle \} from 'topolines\/react'/);
  assert.match(TSX, /import \{ isSupported \} from 'topolines'/);
  assert.match(TSX, /decideTopoMode\(\{ noGpu, webglSupported: webglOk, reducedMotion: reduced \}\)/);
  assert.match(TSX, /fallback=\{<TopoSvg paused=\{paused\} \/>\}/, 'fallback prop 必须接到旧 SVG 实现');
  assert.match(TSX, /from '\.\.\/lib\/topo'/, 'SVG 路径继续吃 lib/topo.ts 的 TOPO_LAYERS');
  assert.match(TSX, /aria-hidden="true"/, '装饰背景必须 aria-hidden');
  assert.match(TSX, /'topo' \+ \(paused \? ' paused' : ''\)/, 'SVG 路径保留 .paused 暂停类契约');
  assert.match(TSX, /visibilitychange/, 'SVG 路径保留失焦暂停监听');
});

test('RTM-S29: topo-gpu 组件静帧与主题联动——gpu-static 下 speed 0 + pause，恢复 play；主题经 MutationObserver 跟进', () => {
  assert.match(TSX, /speed=\{mode === 'gpu-static' \? 0 : p\.speed\}/, '静帧 speed 0');
  assert.match(TSX, /mode === 'gpu-static'\) handleRef\.current\?\.pause\(\)/, '静帧停 rAF 循环');
  assert.match(TSX, /else handleRef\.current\?\.play\(\)/, '离开静帧恢复动画');
  assert.match(TSX, /MutationObserver/, 'data-theme 变化必须被观察（主题切换 props 即时更新）');
  assert.match(TSX, /attributeFilter: \['data-theme', 'data-reduce'\]/);
  assert.match(TSX, /interactive=\{false\}/, '背景不跟鼠标（避免抢交互戏）');
  assert.match(TSX, /scrollPan=\{\[0, 0\]\}/, '背景不吃滚动位移');
});

test('RTM-S29: topo-gpu Electron 通路——main 下发 --rc-nogpu，preload 暴露 api.env.noGpu，types 有声明', () => {
  assert.match(
    MAIN_JS,
    /additionalArguments: \['--rc-nogpu=' \+ \(process\.env\.RC_NOGPU === '1' \? '1' : '0'\)\]/,
    'main 必须把 RC_NOGPU 下发到渲染层 argv'
  );
  assert.match(
    PRELOAD_JS,
    /noGpu: \(\) => process\.argv\.includes\('--rc-nogpu=1'\)/,
    'preload 必须暴露同步 noGpu 读取'
  );
  assert.match(TYPES, /noGpu\(\): boolean/, 'window.api.env.noGpu 必须有类型声明');
});

test('RTM-S29: topo-gpu CSS——.topo-gpu 零交互且在内容之下；SVG 兜底的 reduce 双保险不回退', () => {
  assert.match(
    CSS,
    /\.topo-gpu \{ position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; \}/,
    'GPU 宿主与 .topo 同位：零交互、内容之下'
  );
  const media = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(media, /\.topo \{ display: none; \}/, 'prefers-reduced-motion 下 SVG 兜底仍完全静止');
  assert.match(CSS, /\.win\[data-reduce="1"\] \.topo \{ display: none; \}/, '设置「减少动效」下 SVG 兜底仍完全静止');
});
