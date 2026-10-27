import { useEffect, useRef, useState } from 'react';
import type { CrawlIntent, CrawlerProgress, CrawlerSummary, Prefs } from '../types';
import type { FullPrefs } from '../lib/settings-core';

/**
 * 采集面板：对话式 NL 输入 → agent 解析回显 / 反问补全 → 参数确认 → 进度 → 汇总。
 * 解析逻辑在主进程 electron/intent.js（crawler:parse IPC），这里只做对话与参数编排。
 */

type Msg = { from: 'user' | 'agent'; text: string; tone?: 'info' | 'ok' | 'warn' };

const MISSING_ASK: Record<string, string> = {
  url: '从哪个页面开始？贴一个具体网址（例如图集 / 画师作品页的链接）',
  count: '想要多少张？（比如 30 张）',
  keyword: '想找什么主题或角色？我会把它加进文件名，方便搜索'
};

const GUARDRAIL_LINES = [
  '只抓取页面上公开可见的内容，需要登录的页面一概不碰',
  '自动读取并遵守站点的 robots.txt（Disallow 的页面不采）',
  '诚实标识身份：UA 固定为 RefCollector/0.6 (personal reference collector)',
  '不携带任何 Cookie / 登录凭据，不尝试绕过访问控制',
  '不猜测拼接「更高质量」的地址，只下载页面里原样出现的链接',
  '同一域名请求间隔 ≥1.5 秒；连续 3 次 403/401 自动停止',
  '每张图都会归档来源页面 URL，随时可溯源'
];

const fmtField = (p: { url: string | null; count: number | null; keyword: string | null }) =>
  [
    p.url ? `起始 ${p.url}` : null,
    p.keyword ? `关键词「${p.keyword}」` : null,
    p.count ? `上限 ${p.count} 张` : null
  ].filter(Boolean).join(' · ');

export function CrawlerPanel({
  open, prefs, onSetPrefs, onDone, onClose
}: {
  open: boolean;
  prefs: FullPrefs;
  onSetPrefs: (patch: Partial<Prefs>) => Promise<void> | void;
  onDone: (s: CrawlerSummary) => void;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [params, setParams] = useState({ url: '', keyword: '', count: '', sameOnly: true });
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<CrawlerProgress | null>(null);
  const [agreed, setAgreed] = useState(false);   // 勾选框本身
  const logRef = useRef<HTMLDivElement>(null);

  const confirmed = !!prefs.crawler?.confirmed;

  // 每次打开重置对话，带一条开场白
  useEffect(() => {
    if (!open) return;
    setMsgs([{
      from: 'agent',
      text: '告诉我想要什么，例如：「我想要 https://… 某某角色的 30 张图片」。缺了要素我会追问。'
    }]);
    setDraft(''); setProg(null); setRunning(false); setThinking(false);
  }, [open]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [msgs, prog, thinking]);

  // 运行中的实时进度（crawler:progress 事件由主进程 WebCrawler 每步发出）
  useEffect(() => {
    if (!open) return;
    return window.api.on.crawlerProgress(p => setProg(p));
  }, [open]);

  /** 把解析结果并入参数（只覆盖解析出来的字段），返回合并后的值 */
  const mergeIntent = (intent: CrawlIntent, cur = params) => {
    const next = { ...cur };
    if (intent.url) next.url = intent.url;
    if (intent.keyword) next.keyword = intent.keyword;
    if (intent.count) next.count = String(intent.count);
    return next;
  };

  const askFor = (p: { url: string; keyword: string; count: string }): string[] => {
    const missing: string[] = [];
    if (!p.url.trim()) missing.push('url');
    if (!p.keyword.trim()) missing.push('keyword');
    if (!(Number(p.count) > 0)) missing.push('count');
    return missing;
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking || running) return;
    setDraft('');
    setMsgs(m => [...m, { from: 'user', text }]);
    setThinking(true);
    try {
      const intent = await window.api.crawler.parse(text);
      const next = mergeIntent(intent);
      setParams(next);
      const missing = askFor(next);
      const head = intent.url || intent.count || intent.keyword
        ? `解析到：${fmtField(intent) || '（这句里没认出要素）'}\n`
        : '';
      const tail = missing.length
        ? (head ? '还差这些：\n' : '还差这些：\n') + missing.map(k => `· ${MISSING_ASK[k]}`).join('\n')
        : '要素齐了。下面的参数确认无误就可以「开始采集」。';
      setMsgs(m => [...m, { from: 'agent', text: (head + tail).trim(), tone: missing.length ? 'warn' : 'ok' }]);
    } catch (err: any) {
      setMsgs(m => [...m, { from: 'agent', text: '解析失败了：' + (err?.message || err), tone: 'warn' }]);
    } finally {
      setThinking(false);
    }
  };

  const start = async () => {
    const missing = askFor(params);
    if (missing.length || running) return;
    setRunning(true);
    setProg(null);
    try {
      const r = await window.api.crawler.start({
        url: params.url.trim(),
        keyword: params.keyword.trim(),
        count: Math.max(1, Math.floor(Number(params.count) || 0))
      });
      if ('error' in r && r.error) {
        setMsgs(m => [...m, { from: 'agent', text: '没能开始：' + r.error, tone: 'warn' }]);
        return;
      }
      const s = r as CrawlerSummary;
      setProg(s);
      setMsgs(m => [...m, {
        from: 'agent',
        tone: s.imported > 0 ? 'ok' : 'warn',
        text: s.reason
          ? `已停止：${s.reason}。入库 ${s.imported} 张，跳过 ${s.skipped}，失败 ${s.failed}。`
          : `采集完成：入库 ${s.imported} 张（重复 ${s.dup}，跳过 ${s.skipped}，失败 ${s.failed}），看了 ${s.pages} 个页面。`
      }]);
      onDone(s);
    } catch (err: any) {
      setMsgs(m => [...m, { from: 'agent', text: '采集出错：' + (err?.message || err), tone: 'warn' }]);
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => { window.api.crawler.cancel(); };

  const close = () => {
    if (running) cancel();      // 面板收起 = 停止采集，不留后台任务
    onClose();
  };

  if (!open) return null;

  const counters = [
    ['found', '已发现'], ['downloaded', '已下载'], ['imported', '已入库'], ['skipped', '已跳过']
  ] as const;
  const target = Math.max(1, Number(params.count) || 1);
  const pct = prog ? Math.min(100, Math.round(((prog.imported || 0) / target) * 100)) : 0;
  const missing = askFor(params);

  return (
    <div className="modal-veil" onClick={close}>
      <div className="crawlpanel" onClick={e => e.stopPropagation()}>
        <div className="chead">
          <span className="ct">网页采集</span>
          <span className="csub">合规护栏已内置 · 每张图归档来源 URL</span>
          <button className="cclose" onClick={close} title={running ? '停止采集并关闭' : '关闭'}>×</button>
        </div>

        {/* 合规首用确认：未确认时挡住一切操作 */}
        {!confirmed && (
          <div className="cgate" data-testid="crawler-gate">
            <div className="cgt">第一次使用，先读这段约定</div>
            <ul className="cgl">
              {GUARDRAIL_LINES.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <label className="cgchk">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>我已阅读并同意：仅用于个人参考收集，遵守上述护栏，尊重站点版权与 robots.txt。</span>
            </label>
            <button
              className="cgok"
              disabled={!agreed}
              onClick={() => onSetPrefs({ crawler: { ...prefs.crawler, confirmed: true } })}
            >同意并开始使用</button>
          </div>
        )}

        <div className="cchat" ref={logRef}>
          {msgs.map((m, i) => (
            <div key={i} className={'crow ' + m.from}>
              <div className={'cbubble' + (m.tone === 'warn' ? ' warn' : m.tone === 'ok' ? ' ok' : '')}>{m.text}</div>
            </div>
          ))}
          {thinking && <div className="crow agent"><div className="cbubble typing">解析中…</div></div>}
        </div>

        <div className="cask">
          <input
            className="cinput"
            value={draft}
            placeholder={running ? '采集中…' : '例：我想要 https://example.com/gallery 某某角色的 30 张图片'}
            spellCheck={false}
            disabled={!confirmed || running}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(draft); }}
          />
          <button className="csend" disabled={!confirmed || running || !draft.trim() || thinking} onClick={() => send(draft)}>发送</button>
        </div>

        <div className="cparams">
          <div className="cprowandctl">
            <div className="cprog" data-on={running || !!prog ? '1' : '0'}>
              <div className="cbar"><i style={{ width: pct + '%' }} /></div>
              <div className="ccounts">
                {counters.map(([k, label]) => (
                  <span className="ccnt" key={k} data-k={k}>{label} <b>{prog?.[k] ?? 0}</b></span>
                ))}
                <span className="ccnt">页面 <b>{prog?.pages ?? 0}</b></span>
              </div>
              {prog?.current && <div className="ccur" title={prog.current}>{prog.message || prog.current}</div>}
            </div>
            {running
              ? <button className="ccancel" onClick={cancel}>取消</button>
              : <button className="cstart" disabled={!confirmed || !!missing.length} onClick={start} title={missing.length ? '还缺：' + missing.map(k => MISSING_ASK[k].split('？')[0]).join(' / ') : '开始采集'}>开始采集</button>}
          </div>

          <div className="cgrid">
            <label className="cfield cfull">
              <span>起始 URL</span>
              <input value={params.url} disabled={running} spellCheck={false}
                placeholder="https://…（具体页面）"
                onChange={e => setParams(p => ({ ...p, url: e.target.value }))} />
            </label>
            <label className="cfield">
              <span>关键词</span>
              <input value={params.keyword} disabled={running} spellCheck={false}
                placeholder="角色 / 主题"
                onChange={e => setParams(p => ({ ...p, keyword: e.target.value }))} />
            </label>
            <label className="cfield">
              <span>数量上限</span>
              <input type="number" min={1} max={prefs.crawler?.maxPerTask || 200} value={params.count} disabled={running}
                onChange={e => setParams(p => ({ ...p, count: e.target.value }))} />
            </label>
            <label className="cfield cfull cchk">
              <input type="checkbox" checked={params.sameOnly}
                onChange={e => {
                  const v = e.target.checked;
                  setParams(p => ({ ...p, sameOnly: v }));
                  onSetPrefs({ crawler: { ...prefs.crawler, sameDomainOnly: v } });
                }} />
              <span>仅采集起始站同域内容（推荐；跨域需在设置里加白名单）</span>
            </label>
          </div>
          {missing.length > 0 && !running && (
            <div className="cmiss">还缺：{missing.map(k => MISSING_ASK[k].split('？')[0]).join('；')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
