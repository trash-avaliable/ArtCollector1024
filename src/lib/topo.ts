/**
 * 动态等高线地形背景的纯函数生成器（RTM-S29 终末地效果）。
 *
 * 设计意图：手绘感的「不规则同心曲线组」用参数化扰动生成——
 * r(θ) = R·(1 + Σ ai·sin(ki·θ + φi))，点列经 Catmull-Rom 转三次贝塞尔闭合。
 * 全部确定性（无随机）：同一份代码任何机器生成完全相同的路径，测试可断言。
 *
 * 约束：本模块纯数据 + 纯函数，禁止 import React / DOM——
 * node:test（tests/theme.test.mjs）直接加载它做节点预算与形状断言。
 */

type Pt = [number, number];

const TAU = Math.PI * 2;

/** 一条不规则闭合等高线：基圆 + 三频扰动（低频定形、高频去正圆感），纵向轻压扁 */
export function contourRing(
  cx: number, cy: number, radius: number, wob: number, phase: number, steps = 16
): string {
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * TAU;
    const r = radius * (1 + wob * (
      0.55 * Math.sin(3 * th + phase)
      + 0.3 * Math.sin(5 * th - phase * 1.7)
      + 0.15 * Math.sin(8 * th + phase * 0.6)
    ));
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th) * 0.86]);
  }
  /* 闭合 Catmull-Rom → 三次贝塞尔：控制点取相邻点切线，曲线过全部型值点 */
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}`
      + `, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + ' Z';
}

/** 一组同心等高线（一个「山头」）：半径递增、扰动渐小、相位漂移，中心轻微错位避免靶心感 */
export function contourGroup(
  cx: number, cy: number, rings: number, r0: number, step: number, phase: number
): string[] {
  const out: string[] = [];
  for (let i = 0; i < rings; i++) {
    const wob = Math.max(0.05, 0.34 - i * 0.045);
    out.push(contourRing(cx + i * 14, cy + i * 8, r0 + i * step, wob, phase + i * 0.35));
  }
  return out;
}

export type TopoLayer = {
  /** 若干「山头」同心组；渲染时每组一个 <g> */
  groups: string[][];
  /** accent 组的下标：该组描边用 --topo-line-2（信号色低透明度），其余用 --topo-line */
  accent?: number;
};

/**
 * 四层地形：每层 3 个山头（环数 3~5），viewBox 1200×900。
 * 层与层的漂移轨道（时长/方向）在 styles.css 的 topoDrift1..4 keyframes 里。
 */
export const TOPO_LAYERS: TopoLayer[] = [
  {
    groups: [
      contourGroup(240, 210, 5, 90, 46, 0.4),
      contourGroup(880, 640, 5, 70, 40, 2.1),
      contourGroup(1080, 140, 4, 56, 34, 4.2)
    ]
  },
  {
    accent: 1,
    groups: [
      contourGroup(620, 120, 5, 76, 44, 1.3),
      contourGroup(120, 720, 5, 84, 42, 3.4),
      contourGroup(760, 460, 4, 52, 30, 5.1)
    ]
  },
  {
    groups: [
      contourGroup(420, 640, 5, 96, 50, 2.8),
      contourGroup(1020, 380, 5, 66, 38, 0.9),
      contourGroup(60, 380, 3, 48, 30, 3.9)
    ]
  },
  {
    accent: 0,
    groups: [
      contourGroup(940, 820, 4, 74, 40, 1.8),
      contourGroup(300, 60, 4, 62, 36, 4.6),
      contourGroup(560, 860, 3, 50, 28, 0.2)
    ]
  }
];

/** 渲染节点预算（svg + g + path 总数）：性能红线 ≤ 400 */
export function topoNodeCount(layers: TopoLayer[] = TOPO_LAYERS): number {
  return layers.reduce(
    (sum, l) => sum + 1 + l.groups.length + l.groups.reduce((s, g) => s + g.length, 0),
    0
  );
}
