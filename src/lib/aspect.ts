/**
 * 瀑布流占位计算的纯函数层：不依赖 DOM / electron，方便 node:test 单测。
 * Card 的 .frame 用 cardAspectRatio(it) 预留高度，img 解码前布局不塌陷。
 */

export type AspectInput = {
  /** 内容尺寸（裁白边后）——渲染端 lib:list 的 Item 契约就是它 */
  w?: number;
  h?: number;
  /** 原始画布尺寸（electron 侧原始行：w/h 是画布、裁剪偏移另带） */
  cw?: number;
  ch?: number;
  cropL?: number;
  cropT?: number;
  cropR?: number;
  cropB?: number;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 内容（裁白边后）尺寸：
 * - 优先用 w/h（渲染端契约：已是裁后内容尺寸，裁剪元数据不重复叠算）；
 * - w/h 缺失时（electron 侧原始行）用 cw/ch 减去四周裁剪偏移推出，最小压到 1。
 */
export function contentSize(it: AspectInput | null | undefined): { w: number; h: number } {
  if (!it) return { w: 0, h: 0 };
  const w = num(it.w), h = num(it.h);
  if (w > 0 && h > 0) return { w, h };
  const cw = num(it.cw), ch = num(it.ch);
  if (cw > 0 && ch > 0) {
    const cutL = Math.max(0, num(it.cropL)), cutR = Math.max(0, num(it.cropR));
    const cutT = Math.max(0, num(it.cropT)), cutB = Math.max(0, num(it.cropB));
    return {
      w: Math.max(1, cw - cutL - cutR),
      h: Math.max(1, ch - cutT - cutB)
    };
  }
  return { w: 0, h: 0 };
}

/** 卡片 .frame 的占位宽高比（w ÷ h）；拿不到有效尺寸时退回 4:5 */
export function cardAspectRatio(it: AspectInput | null | undefined): number {
  const { w, h } = contentSize(it);
  if (w <= 0 || h <= 0) return 4 / 5;
  return w / h;
}

/** 给定卡片列宽时 .frame 的占位高度（px）；列宽无效返回 0（布局层自行兜底） */
export function framePlaceholderHeight(it: AspectInput | null | undefined, columnWidth: number): number {
  const col = num(columnWidth);
  if (!(col > 0)) return 0;
  return col / cardAspectRatio(it);
}
