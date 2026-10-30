import { useEffect, useRef, useState } from 'react';
import { Topolines, type TopolinesHandle } from 'topolines/react';
import { isSupported } from 'topolines';
import { normalizeTheme, type ThemeId } from '../lib/settings-core';
import { decideTopoMode, topoGpuProps } from '../lib/topo-gpu';
import { TOPO_LAYERS } from '../lib/topo';

/**
 * stage 等高线背景（RTM-S29 顶层升级：topolines GPU 版 + 旧 SVG 双层降级）。
 *
 * - GPU 路径：topolines（MIT，零依赖）WebGL 噪声等高线，props 由 lib/topo-gpu.ts
 *   按主题推导；主题切换经 data-theme → MutationObserver 即时下 setOptions（不重建 GL）
 * - 降级三态（decideTopoMode）：
 *     'gpu'         本机 WebGL1 + OES_standard_derivatives 可用 → topolines 动画
 *     'gpu-static'  设置「减少动效」→ speed 0 静帧（等高线仍在，引擎只画一帧）
 *     'svg'         RC_NOGPU=1（main 经 additionalArguments 下发，api.env.noGpu）
 *                   或 WebGL 探测失败 → 渲染旧 SVG 实现（lib/topo.ts + styles.css 漂移）
 * - 顶层 fallback prop 再兜一层：组件内 field.ok === false（建上下文失败）时同样落到 SVG
 * - prefers-reduced-motion 由 topolines 引擎内置（只画一帧不循环），双保险在 CSS 层
 * - 失焦暂停：GPU 路径引擎内置 visibilitychange 停启；SVG 路径沿用 .paused 类
 * - pointer-events:none、z-index 0，位于 stage 内容之下，不挡交互
 */

/** 当前主题：App 把 data-theme 写在根元素（documentElement）与 .win 两处，读第一处 */
function readTheme(): ThemeId {
  try {
    const el = document.querySelector('[data-theme]');
    return normalizeTheme(el ? el.getAttribute('data-theme') : document.documentElement.dataset.theme);
  } catch {
    return 'endfield-light';
  }
}

/** 设置「减少动效」：App 把 data-reduce 写在 .win 根上 */
function readReduce(): boolean {
  try {
    return document.querySelector('[data-reduce]')?.getAttribute('data-reduce') === '1';
  } catch {
    return false;
  }
}

/** RC_NOGPU=1（主进程禁硬件加速）：main 经 webPreferences.additionalArguments 下发 */
function readNoGpu(): boolean {
  try {
    return !!window.api?.env?.noGpu?.();
  } catch {
    return false;
  }
}

/** 旧 SVG 等高线实现（无 WebGL / RC_NOGPU 兜底）：路径由 lib/topo.ts 纯函数生成，
 *  漂移动画在 styles.css（topoDrift1..4，只动 transform），失焦暂停走 .paused */
function TopoSvg({ paused }: { paused: boolean }) {
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

export function TopoBackground() {
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [reduced, setReduced] = useState<boolean>(readReduce);
  /* GPU 能力会话内不变：探测各做一次（isSupported 结果库内有缓存） */
  const [noGpu] = useState<boolean>(readNoGpu);
  const [webglOk] = useState<boolean>(() => {
    try { return isSupported(); } catch { return false; }
  });
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden');
  const handleRef = useRef<TopolinesHandle | null>(null);

  const mode = decideTopoMode({ noGpu, webglSupported: webglOk, reducedMotion: reduced });

  /* 失焦暂停：SVG 路径用 .paused 压掉 CSS 漂移动画；GPU 路径由引擎自带 visibilitychange 停启 */
  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* 主题 / 减少动效跟随：根元素 data-theme 与 .win[data-reduce] 属性变化即时跟。
     挂载后先补读一次真实值（首帧渲染时祖先属性可能尚未入 DOM），再持续观察。 */
  useEffect(() => {
    setTheme(readTheme());
    setReduced(readReduce());
    const mo = new MutationObserver(() => {
      setTheme(readTheme());
      setReduced(readReduce());
    });
    mo.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme', 'data-reduce']
    });
    return () => mo.disconnect();
  }, []);

  /* 静帧模式：speed 0 之外再把 rAF 循环停掉（画布保留首帧，零 GPU 占用）；
     reduce 关闭或主题变化离开静帧时恢复动画。play() 对运行中的场是幂等的。 */
  useEffect(() => {
    if (mode === 'gpu-static') handleRef.current?.pause();
    else handleRef.current?.play();
  }, [mode]);

  /* 静帧模式失焦→回焦：引擎的 visibilitychange 会重启循环（speed 0 空转），再压回去 */
  useEffect(() => {
    if (mode === 'gpu-static' && !paused) handleRef.current?.pause();
  }, [mode, paused]);

  if (mode === 'svg') return <TopoSvg paused={paused} />;

  const p = topoGpuProps(theme);
  return (
    <div className="topo-gpu" aria-hidden="true">
      <Topolines
        ref={handleRef}
        seed={p.seed}
        color={p.color}
        levels={p.levels}
        lineWidth={p.lineWidth}
        opacity={p.opacity}
        speed={mode === 'gpu-static' ? 0 : p.speed}
        scale={p.scale}
        maxDpr={p.maxDpr}
        warp={p.warp}
        drift={p.drift}
        scrollPan={[0, 0]}
        interactive={false}
        fallback={<TopoSvg paused={paused} />}
      />
    </div>
  );
}
