/**
 * 橡皮筋框选的几何命中（RTM-S9）：从 Stage.tsx 抽出的纯函数，便于单测。
 * box 为拖拽矩形（任意对角顺序），rect 为候选卡片的外接矩形。
 */
export function boxHitsRect(
  box: { x0: number; y0: number; x1: number; y1: number },
  r: { left: number; top: number; right: number; bottom: number }
): boolean {
  const lx = Math.min(box.x0, box.x1);
  const rx = Math.max(box.x0, box.x1);
  const ty = Math.min(box.y0, box.y1);
  const by = Math.max(box.y0, box.y1);
  return r.left < rx && r.right > lx && r.top < by && r.bottom > ty;
}
