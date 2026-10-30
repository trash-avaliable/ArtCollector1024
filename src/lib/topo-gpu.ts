/**
 * GPU 等高线背景（topolines 库）的主题映射与降级决策（RTM-S29 顶层升级）。
 *
 * 参考站 topolines.idlee.xyz/playground 同款：WebGL 噪声等高线（有机、密集、地图感），
 * 替代原 4 层 SVG 同心椭圆；旧 SVG 实现保留为无 WebGL / RC_NOGPU 的兜底（见 topo.ts）。
 *
 * 约束：本模块纯数据 + 纯函数，禁止 import React / DOM 运行时——
 * node:test（tests/topo-gpu.test.mjs）直接加载它做映射表与联动数学断言。
 * ThemeId 仅 type-only 引入（编译期擦除，不产生运行时依赖）。
 */

import type { ThemeId } from './settings-core';

/**
 * 每主题的等高线基色（RGB 三元组），与 styles.css 各主题块 --topo-line 的色值一一对应。
 * alpha 不放这里：topolines 的 parseColor 只取 RGB，透明度走独立 opacity 通道
 * （由 TOPO_TOKEN_ALPHA 经 clampTopoOpacity 推导）。exa 是唯一深色主题，线色最亮。
 */
export const TOPO_LINE_RGB: Record<ThemeId, readonly [number, number, number]> = {
  'endfield-light': [111, 116, 106],  /* styles.css: rgba(111, 116, 106, .2) */
  ark: [16, 22, 24],                  /* styles.css: rgba(16, 22, 24, .16) */
  exa: [155, 161, 192],               /* styles.css: rgba(155, 161, 192, .16) */
  popucom: [90, 90, 90],              /* styles.css: rgba(90, 90, 90, .16) */
  corporate: [10, 10, 10]             /* styles.css: rgba(10, 10, 10, .14) */
};

/** styles.css --topo-line 的 alpha 原值（改 styles.css 时同步维护这张表） */
export const TOPO_TOKEN_ALPHA: Record<ThemeId, number> = {
  'endfield-light': 0.20,
  ark: 0.16,
  exa: 0.16,
  popucom: 0.16,
  corporate: 0.14
};

/** 唯一深色主题：深底上等高线加两档密度才压得住黑 */
const DARK_THEMES: readonly ThemeId[] = ['exa'];

export function isDarkTheme(t: ThemeId): boolean {
  return DARK_THEMES.includes(t);
}

/** 主题基密度：浅色 10、深色 12（topolines levels 有效域 ~9-13） */
export function deriveLevels(t: ThemeId): number {
  return isDarkTheme(t) ? 12 : 10;
}

/** 线宽联动数学：levels 越高线越细（-0.05/档，基线 1.1），保两位小数避免浮点尾巴 */
export function deriveLineWidth(levels: number): number {
  return +(1.1 - (levels - 10) * 0.05).toFixed(2);
}

/** 透明度带：token alpha 收进 [0.10, 0.18]（性能与「不压内容」红线） */
export function clampTopoOpacity(alpha: number): number {
  return Math.min(0.18, Math.max(0.1, alpha));
}

/** 主题漂速：全部压在慢速带 [0.008, 0.012]（约 7~10px/s，参考站默认 0.012） */
const THEME_SPEED: Record<ThemeId, number> = {
  'endfield-light': 0.012,
  ark: 0.01,
  exa: 0.008,
  popucom: 0.01,
  corporate: 0.008
};

/** 下发给 topolines <Topolines> 的 props 集（seed 恒定：主题切换走 setOptions 活更新，不重建 GL） */
export type TopoGpuProps = {
  seed: string;
  color: string;
  levels: number;
  lineWidth: number;
  opacity: number;
  speed: number;
  scale: number;
  maxDpr: number;
  warp: number;
  drift: [number, number];
};

/** 主题 → topolines props 总推导（纯函数；五主题全查见 tests/topo-gpu.test.mjs） */
export function topoGpuProps(t: ThemeId): TopoGpuProps {
  const [r, g, b] = TOPO_LINE_RGB[t];
  const levels = deriveLevels(t);
  return {
    seed: 'refcollector-topo',
    color: `rgb(${r}, ${g}, ${b})`,
    levels,
    lineWidth: deriveLineWidth(levels),
    opacity: clampTopoOpacity(TOPO_TOKEN_ALPHA[t]),
    speed: THEME_SPEED[t],
    scale: 1.2,
    maxDpr: 1.5,
    warp: 0.18,
    drift: [0.004, 0.002]
  };
}

/** 降级三态：
 *  - 'gpu'         topolines 动画（本机 WebGL1 + OES_standard_derivatives 可用）
 *  - 'gpu-static'  GPU 静帧（设置「减少动效」：speed 0，静止等高线仍显示）
 *  - 'svg'         旧 SVG 实现（RC_NOGPU=1 / WebGL 探测失败）
 *  prefers-reduced-motion 由 topolines 引擎内置处理（只画一帧不循环），这里只收设置开关。 */
export type TopoMode = 'gpu' | 'gpu-static' | 'svg';

export function decideTopoMode(input: {
  noGpu?: boolean | null;
  webglSupported?: boolean | null;
  reducedMotion?: boolean;
}): TopoMode {
  if (input.noGpu) return 'svg';
  if (input.webglSupported === false) return 'svg';
  if (input.reducedMotion) return 'gpu-static';
  return 'gpu';
}
