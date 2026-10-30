import { useEffect, useState } from 'react';
import { TOPO_LAYERS } from '../lib/topo';

/**
 * 动态流动等高线地形背景（RTM-S29，终末地效果，只挂在 stage）。
 *
 * - 4 层不规则同心等高线 SVG（路径由 lib/topo.ts 纯函数确定性生成，节点预算 ≤400）
 * - 漂移动画在 styles.css（topoDrift1..4：只动 transform，75~130s，GPU 合成）
 * - 颜色/浓度随主题 token（--topo-line / --topo-line-2）
 * - 窗口失焦暂停：visibilitychange → .paused（animation-play-state: paused）
 * - prefers-reduced-motion 与设置「减少动效」在 CSS 层双保险压掉
 * - pointer-events:none、z-index 0，位于 stage 内容之下，不挡交互
 */
export function TopoBackground() {
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden');

  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <div className={'topo' + (paused ? ' paused' : '')} aria-hidden="true">
      {TOPO_LAYERS.map((layer, li) => (
        <svg key={li} className={`topo-${li + 1}`} viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
          {layer.groups.map((paths, gi) => (
            <g key={gi}>
              {paths.map((d, pi) => (
                <path key={pi} d={d} className={layer.accent === gi ? 'acc' : undefined} />
              ))}
            </g>
          ))}
        </svg>
      ))}
    </div>
  );
}
