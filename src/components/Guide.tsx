/**
 * 问询 agent：右下角悬浮方角按钮 + 右侧滑出对话抽屉。
 * 检索式 RAG 离线问答——引擎在 src/lib/guide-engine.ts（tokenize + 加权评分 + 阈值门禁），
 * 知识库在 src/lib/guide-kb.ts（40 条功能条目，全部核对自仓库实现）。
 * LLM API 接入预留：消息已按 role 抽象，后续把 ask() 换成流式接口即可，UI 不用动。
 * FAB 位置跟随右栏宽度（dock 开 376 / 脊柱 72 / 收起 16），由 .win 的
 * data-dock / data-dockhide 属性驱动，永远不压住 dock 上的动作按钮。
 */

import { useEffect, useRef, useState } from 'react';
import { GUIDE_KB, GUIDE_RECOMMENDED, findEntry, type GuideEntry } from '../lib/guide-kb';
import { ask } from '../lib/guide-engine';

const SPARKLE = 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z';

export function GuideFab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className={'guide-fab' + (open ? ' on' : '')}
      onClick={onToggle}
      title="问询助手（离线知识库检索）"
      aria-label="问询助手"
      aria-expanded={open}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinejoin="miter">
        <path d={SPARKLE} />
      </svg>
    </button>
  );
}

/* ---------------- 对话消息模型（LLM 接入预留：role + 文本/回答卡片 + 追问 chips） ---------------- */

type GuideChip = { q: string };
type GuideMsg = {
  role: 'user' | 'agent';
  /** user 气泡文本 / agent 纯文本（不确定分支） */
  text?: string;
  /** agent 回答卡片（确定分支） */
  entry?: GuideEntry;
  /** 不确定分支标记：文案区分，命中不足时如实说「没把握」 */
  lowConfidence?: boolean;
  /** 气泡下方的可点击追问 chips */
  chips?: GuideChip[];
};

const WELCOME_MSG: GuideMsg = {
  role: 'agent',
  text: '我是问询助手。回答全部来自本地知识库（40 条功能说明，完全离线）。\n点下面的问题，或直接输入你的疑问。',
  chips: GUIDE_RECOMMENDED.map(q => ({ q })),
};

const UNCERTAIN_WITH_HINTS = '这个问题我还没把握（知识库里没有足够匹配的条目）。换一种问法试试：';
const UNCERTAIN_EMPTY = '知识库里没找到相关内容。可以先从这些问题开始：';

export function GuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<GuideMsg[]>([WELCOME_MSG]);
  const [draft, setDraft] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 新消息 / 开抽屉都滚到底部，保证最新回答可见
  useEffect(() => {
    if (!open) return;
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [msgs, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /** 发问：问句进对话流，检索引擎同步出答案（离线、无网络等待） */
  const send = (raw: string) => {
    const text = (raw || '').trim();
    if (!text) return;
    const a = ask(GUIDE_KB, text);
    const next: GuideMsg[] = [...msgs, { role: 'user', text }];
    if (a.confident && a.best) {
      // 确定分支：回答卡片（标题 / 正文 / 步骤）+ 相关条目 chips（点击即追问）
      const rel = a.best.related.map(findEntry).filter((e): e is GuideEntry => !!e);
      next.push({ role: 'agent', entry: a.best, chips: rel.map(e => ({ q: e.title })) });
    } else {
      // 不确定分支：如实说没把握，给 2-3 个候选问法；全未命中时兜底推荐问题
      const hints = a.candidates.length ? a.candidates : fallbackPicks();
      next.push({
        role: 'agent',
        lowConfidence: true,
        text: a.candidates.length ? UNCERTAIN_WITH_HINTS : UNCERTAIN_EMPTY,
        chips: hints.map(e => ({ q: e.title })),
      });
    }
    setMsgs(next);
    setDraft('');
  };

  /** 全未命中时兜底的推荐问题：逐条跑推荐问句取确定命中的前 3 条 */
  const fallbackPicks = (): GuideEntry[] => {
    const out: GuideEntry[] = [];
    for (const q of GUIDE_RECOMMENDED) {
      const hit = ask(GUIDE_KB, q);
      if (hit.best && !out.some(e => e.id === hit.best!.id)) out.push(hit.best);
      if (out.length >= 3) break;
    }
    return out;
  };

  return (
    <>
      {open && <div className="guideveil" onClick={onClose} aria-hidden="true" />}
      <aside className={'guidedrawer' + (open ? ' open' : '')} role="dialog" aria-label="问询助手" aria-hidden={!open}>
        <div className="ghead">
          <div className="glft">
            <span><b>ASK</b> / 问询助手</span>
            <span className="gsub">离线知识库检索 · LLM API 接入预留</span>
          </div>
          <button onClick={onClose} title="关闭" aria-label="关闭问询助手">×</button>
        </div>

        {/* EXTENSION-GUIDE-DRAWER: 对话流（用户气泡右深色 / agent 回答卡片浅色带信号黄左边条，全直角）。
            打开/关闭信号已由 open 提供，ESC 关闭已在 App 的全局按键链里接好，无需再绑一份。 */}
        <div className="gchat" ref={chatRef}>
          {msgs.map((m, i) => (
            <div key={i} className={'grow ' + m.role}>
              {m.role === 'user' ? (
                <div className="gbubble">{m.text}</div>
              ) : (
                <div className={'gbubble' + (m.lowConfidence ? ' low' : '')}>
                  {m.entry ? (
                    <>
                      <div className="gatitle">{m.entry.title}</div>
                      <div className="gatext">{m.entry.body}</div>
                      {m.entry.steps && m.entry.steps.length > 0 && (
                        <ol className="gasteps">
                          {m.entry.steps.map((s, j) => <li key={j}>{s}</li>)}
                        </ol>
                      )}
                    </>
                  ) : (
                    <div className="gatext">{m.text}</div>
                  )}
                  {m.chips && m.chips.length > 0 && (
                    <div className="gchips">
                      {m.chips.map((c, j) => (
                        <button key={j} className="gchip" onClick={() => send(c.q)}>{c.q}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="gask">
          <input
            ref={inputRef}
            value={draft}
            placeholder="问一个功能问题，例：怎么删图"
            spellCheck={false}
            aria-label="问询输入框"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(draft); }}
          />
          <button className="gsend" disabled={!draft.trim()} onClick={() => send(draft)}>发送</button>
        </div>
      </aside>
    </>
  );
}
