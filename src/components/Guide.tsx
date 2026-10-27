/**
 * 问询 agent 落位（本任务只留位不实现）：
 * 右下角悬浮方角按钮 + 右侧滑出抽屉骨架（占位内容「问询助手即将上线」）。
 * FAB 位置跟随右栏宽度（dock 开 376 / 脊柱 72 / 收起 16），由 .win 的
 * data-dock / data-dockhide 属性驱动，永远不压住 dock 上的动作按钮。
 */

const SPARKLE = 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z';

export function GuideFab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className={'guide-fab' + (open ? ' on' : '')}
      onClick={onToggle}
      title="问询助手（即将上线）"
      aria-label="问询助手"
      aria-expanded={open}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinejoin="miter">
        <path d={SPARKLE} />
      </svg>
    </button>
  );
}

export function GuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    // EXTENSION-GUIDE-DRAWER: 问询 agent 的落位。
    // 未来接问答逻辑时：把 .gbody 的占位内容换成对话 UI（消息列表 + 输入框），
    // 并在这里加 onAsk / messages 等 props；打开/关闭信号已由 open 提供，
    // ESC 关闭已在 App 的全局按键链里接好，无需再绑一份。
    <>
      {open && <div className="guideveil" onClick={onClose} aria-hidden="true" />}
      <aside className={'guidedrawer' + (open ? ' open' : '')} role="dialog" aria-label="问询助手" aria-hidden={!open}>
        <div className="ghead">
          <span><b>ASK</b> / 问询助手</span>
          <button onClick={onClose} title="关闭" aria-label="关闭问询助手">×</button>
        </div>
        <div className="gbody">
          <div className="gmark">✦</div>
          <div className="gt">问询助手即将上线</div>
          <div className="gp">
            这里是未来的问询入口：选中图片直接问「这批手部参考怎么归档」，或让助手按画板整理素材。
            <span>上线前可以用 Ctrl+K 命令面板快速跳转。</span>
          </div>
          <div className="grule" />
          <div className="gp"><span>本区域为骨架占位，问答逻辑后续接入。</span></div>
        </div>
      </aside>
    </>
  );
}
