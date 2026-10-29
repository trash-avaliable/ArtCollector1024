import { useEffect, useMemo, useRef, useState } from 'react';
import {
  eventToAccelerator, describeAccelerator, normalizeAccelerator, fullPrefs, PREF_DEFAULTS
} from '../lib/settings-core';
import type { Prefs, PluginInfo } from '../types';

type Full = ReturnType<typeof fullPrefs>;

const HotkeyRecorder = ({
  value, taken, onCommit
}: {
  value: string; taken: Record<string, string>; onCommit: (acc: string) => void;
}) => {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); setDraft(null); return; }
      const acc = eventToAccelerator(e);
      if (acc) setDraft(acc);
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setRecording(false); setDraft(null); }
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true); };
  }, [recording]);

  const shown = draft ?? value;
  const norm = normalizeAccelerator(shown);
  const clash = !!norm && Object.entries(taken).some(([, v]) =>
    v !== shown && !!v && normalizeAccelerator(v) === norm);

  if (recording) {
    return (
      <button ref={ref} className="hkrec recording" title="按下新组合键，Esc 取消">
        {draft ? `${describeAccelerator(draft)} —— 点「保存」生效` : '按下组合键…'}
      </button>
    );
  }
  return (
    <span className="hkrow">
      <button className="hkrec" onClick={() => { setDraft(null); setRecording(true); }} title="点击后按下新组合键">
        {describeAccelerator(value)}
      </button>
      {draft && (
        <>
          <button className="hkok" disabled={!!clash || !norm || norm === value}
            onClick={() => { onCommit(norm || value); setDraft(null); setRecording(false); }}>保存</button>
          <button className="hkcancel" onClick={() => { setDraft(null); setRecording(false); }}>取消</button>
        </>
      )}
      {clash && <i className="hkclash">与另一组热键冲突</i>}
    </span>
  );
};

const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="settoggle">
    <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

type NavItem = { key: string; label: string; icon: string; group: string; items: string[] };

const NAV: NavItem[] = [
  { key: 'general', label: '通用', icon: 'M4 6h16M4 12h16M4 18h10', group: '偏好', items: ['开机自启', '关闭到托盘', '剪贴板监听', '自动裁白边', '语言'] },
  { key: 'library', label: '库与存储', icon: 'M3 7h7l2 2h9v10H3z', group: '偏好', items: ['库目录', '切换目录', '扫描接入', '库统计'] },
  { key: 'ai', label: 'AI 与模型', icon: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', group: '偏好', items: ['AI 自动分类', '置信度阈值', '模型状态'] },
  { key: 'hotkeys', label: '快捷键', icon: 'M4 8h16M4 14h16M9 4v16M15 4v16', group: '偏好', items: ['全局热键', '唤起', '保存剪贴板', '应用内快捷键', '命令面板', '导入'] },
  { key: 'ui', label: '外观', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18z', group: '偏好', items: ['密度', '动效', '主题'] },
  { key: 'crawler', label: '采集与合规', icon: 'M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5', group: '采集', items: ['数量上限', '限速', '同域限制', '白名单', '合规确认'] },
  { key: 'extension', label: '扩展与桥接', icon: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z', group: '采集', items: ['浏览器扩展', '端口', '令牌', '加载目录'] },
  { key: 'plugins', label: '插件', icon: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z', group: '采集', items: ['已加载插件', '启用/禁用', '权限', '命令数', '沙盒'] },
  { key: 'logs', label: '日志与诊断', icon: 'M4 5h16v14H4zM8 9h8M8 13h5', group: '采集', items: ['错误日志', '打开日志', '版本'] }
];

export function Settings({
  root, stats, bridge, prefs, hotkeys, version, plugins,
  onSetPrefs, onPickRoot, onOpenRoot, onOpenExt, onOpenLogs, onTogglePlugin, onClose
}: {
  root: string; stats: { total: number; trash?: number }; bridge: { port: number; token: string; extDir: string } | null;
  prefs: Full; hotkeys: { bindings: Record<string, string>; registered: Record<string, boolean> } | null; version: string;
  plugins: PluginInfo[];
  onSetPrefs: (patch: Partial<Prefs>) => void;
  onPickRoot: () => void; onOpenRoot: () => void; onOpenExt: () => void; onOpenLogs: () => void;
  onTogglePlugin: (id: string, enabled: boolean) => void; onClose: () => void;
}) {
  const [active, setActive] = useState('general');
  const [query, setQuery] = useState('');

  const nav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.map(n => ({
      ...n,
      hit: q.split(/\s+/).some(w =>
        n.label.toLowerCase().includes(w) || n.items.some(i => i.toLowerCase().includes(w)))
    })).filter(n => (n as any).hit);
  }, [query]);

  const set = <K extends keyof Prefs>(k: K, patch: Partial<NonNullable<Prefs[K]>>) =>
    onSetPrefs({ [k]: { ...(prefs as any)[k], ...patch } } as unknown as Partial<Prefs>);

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  const pane = () => {
    switch (active) {
      case 'general': return (
        <>
          <div className="st">通用</div>
          <Toggle label="开机自动启动 RefCollector" on={prefs.general.launchAtLogin}
            onChange={v => onSetPrefs({ general: { ...prefs.general, launchAtLogin: v } })} />
          <Toggle label="关闭按钮最小化到托盘（关掉则直接退出）" on={prefs.general.closeToTray}
            onChange={v => set('general', { closeToTray: v })} />
          <Toggle label="剪贴板监听（检测到图片弹卡片）" on={prefs.general.clipWatch}
            onChange={v => set('general', { clipWatch: v })} />
          <Toggle label="导入时自动裁掉白边（原图不动，可逆）" on={prefs.general.autoTrim}
            onChange={v => set('general', { autoTrim: v })} />
          <div className="setrow">
            <span>语言</span>
            <b className="dimv">简体中文（后续版本提供更多）</b>
          </div>
        </>
      );
      case 'library': return (
        <>
          <div className="st">库与存储</div>
          <div className="setrow col">
            <span>当前库目录（{stats.total} 张图{stats.trash ? `，回收站 ${stats.trash}` : ''}）</span>
            <b className="pathv" title={root}>{root}</b>
            <div className="btnrow">
              <button onClick={onOpenRoot}>打开目录</button>
              <button className="primary" onClick={onPickRoot}>更换 / 迁移 / 扫描接入…</button>
            </div>
          </div>
          <div className="notebox">
            更换目录时可以「复制并切换」整体搬迁，也可以「扫描并接入」把新目录里已有的图片按文件夹归成分类；
            已在库里的图不会受影响。
          </div>
        </>
      );
      case 'ai': return (
        <>
          <div className="st">AI 与模型</div>
          <Toggle label="AI 视觉自动分类（CLIP 零样本）" on={prefs.clip.enabled}
            onChange={v => set('clip', { enabled: v })} />
          <div className="setrow col">
            <span>置信度阈值（低于此分数不自动归类，当前 {prefs.clip.threshold.toFixed(2)}）</span>
            <input type="range" min={0.1} max={0.5} step={0.01} value={prefs.clip.threshold}
              onChange={e => set('clip', { threshold: Number(e.target.value) })} />
          </div>
          <div className="notebox">
            模型为 CLIP ViT-B/32 量化版（约 85MB），首次使用时自动下载到本地模型目录，之后完全离线运行。
            基准测试：`npm run bench:clip`（要求总体准确率 ≥ 90%）。
          </div>
        </>
      );
      case 'hotkeys': {
        const taken = { ...hotkeys?.bindings, ...prefs.appKeys };
        return (
          <>
            <div className="st">快捷键</div>
            <div className="subh">全局热键（任何应用在前台都生效，点方块后按下新组合键）</div>
            {([['wake', '唤起主窗口并聚焦搜索'], ['saveClip', '把当前剪贴板图片存入库'], ['pinIgnore', '置顶参考窗取消鼠标穿透']] as const).map(([k, label]) => (
              <div className="setrow" key={k}>
                <span>{label}</span>
                <HotkeyRecorder
                  value={(hotkeys?.bindings?.[k]) || (prefs.hotkeys as any)?.[k] || (PREF_DEFAULTS.hotkeys as any)[k]}
                  taken={taken}
                  onCommit={acc => onSetPrefs({ hotkeys: { ...(prefs.hotkeys || {}), [k]: acc } })}
                />
                <i className={'hkstate' + (hotkeys?.registered?.[k] ? ' ok' : '')}>
                  {hotkeys?.registered?.[k] ? '已注册' : '未生效'}
                </i>
              </div>
            ))}
            <div className="subh">应用内快捷键（RefCollector 在前台时生效）</div>
            {([['import', '打开文件导入对话框'], ['palette', '打开命令面板']] as const).map(([k, label]) => (
              <div className="setrow" key={k}>
                <span>{label}</span>
                <HotkeyRecorder value={(prefs.appKeys as any)?.[k] || (PREF_DEFAULTS.appKeys as any)[k]}
                  taken={taken}
                  onCommit={acc => onSetPrefs({ appKeys: { ...(prefs.appKeys || {}), [k]: acc } })} />
              </div>
            ))}
            <div className="setrow"><span>重命名选中项</span><b className="dimv">F2（固定）</b></div>
            <div className="setrow"><span>删除选中项</span><b className="dimv">Delete / Backspace（固定）</b></div>
            <div className="setrow"><span>全选 / 取消选择</span><b className="dimv">Ctrl+A / Esc（固定）</b></div>
            <div className="setrow"><span>橡皮筋框选</span><b className="dimv">空白处拖动（固定）</b></div>
          </>
        );
      }
      case 'ui': return (
        <>
          <div className="st">外观</div>
          <div className="setrow">
            <span>瀑布流密度</span>
            <span className="seg">
              {(['cozy', 'compact'] as const).map(d => (
                <button key={d} className={prefs.ui.density === d ? 'on' : ''}
                  onClick={() => set('ui', { density: d })}>{d === 'cozy' ? '舒适' : '紧凑'}</button>
              ))}
            </span>
          </div>
          <Toggle label="减少动效（关闭入场动画与过渡）" on={prefs.ui.reducedMotion}
            onChange={v => set('ui', { reducedMotion: v })} />
          <div className="setrow col">
            <span>主题（即时生效，存 prefs.ui.theme）</span>
            <div className="themecards" role="radiogroup" aria-label="主题">
              {([
                ['endfield-light', 'Endfield 浅色', '素色纸面 · 墨黑铭牌 · 信号黄点缀，工业直角（默认）'],
                ['ide-dark', 'IDE 深色', '深底亮字 · 明度分层 · 细边框，参考 AI IDE']
              ] as const).map(([id, nm, dsc]) => (
                <button key={id} role="radio" aria-checked={prefs.ui.theme === id}
                  className={'themecard' + (prefs.ui.theme === id ? ' on' : '')}
                  onClick={() => set('ui', { theme: id })}>
                  <span className={'tp ' + (id === 'ide-dark' ? 'dp' : 'lp')} aria-hidden="true"><i /><i /><i /></span>
                  <span className="tnm">{nm}</span>
                  <span className="tdsc">{dsc}</span>
                  {prefs.ui.theme === id && <span className="tuse">使用中</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      );
      case 'crawler': return (
        <>
          <div className="st">采集与合规</div>
          <div className="notebox warn">
            内置合规护栏（不可关闭）：遵守 robots.txt、诚实 UA、不带登录凭据、不绕过访问控制、
            单域名限速、连续 403 自动停止、来源 URL 全部归档。
          </div>
          <div className="setrow col">
            <span>单任务数量上限（{prefs.crawler.maxPerTask} 张）</span>
            <input type="range" min={20} max={500} step={10} value={prefs.crawler.maxPerTask}
              onChange={e => set('crawler', { maxPerTask: Number(e.target.value) })} />
          </div>
          <div className="setrow col">
            <span>单域名请求间隔（{prefs.crawler.domainDelaySec} 秒，最低 1.5）</span>
            <input type="range" min={1.5} max={10} step={0.5} value={prefs.crawler.domainDelaySec}
              onChange={e => set('crawler', { domainDelaySec: Number(e.target.value) })} />
          </div>
          <Toggle label="仅采集起始站同域内容（推荐开启）" on={prefs.crawler.sameDomainOnly}
            onChange={v => set('crawler', { sameDomainOnly: v })} />
          <div className="setrow col">
            <span>跨域白名单（每行一个域名，需手动添加）</span>
            <textarea className="wlta" rows={3} value={prefs.crawler.whitelist}
              placeholder="example.com" spellCheck={false}
              onChange={e => set('crawler', { whitelist: e.target.value })} />
          </div>
          <div className="setrow">
            <span>首次使用合规确认</span>
            <b className={'dimv' + (prefs.crawler.confirmed ? '' : ' warnv')}>
              {prefs.crawler.confirmed ? '已确认' : '待确认（首次采集时勾选）'}
            </b>
          </div>
        </>
      );
      case 'extension': return (
        <>
          <div className="st">扩展与桥接</div>
          <div className="setrow"><span>本地接收端口</span><b className="dimv">{bridge?.port ?? '—'}</b></div>
          <div className="setrow">
            <span>令牌</span>
            <b className="tk">{bridge?.token ?? '—'}</b>
            <button onClick={() => copy(bridge?.token || '')}>复制</button>
          </div>
          <div className="setrow">
            <span>扩展目录</span>
            <b className="tk" title={bridge?.extDir}>{bridge?.extDir ?? '—'}</b>
            <button onClick={onOpenExt}>打开</button>
          </div>
          <div className="notebox">
            Chrome / Edge → chrome://extensions → 开发者模式 → 加载已解压的扩展程序 →
            选上面的目录，再把令牌粘进扩展设置页。之后网页图片右键即可一键入库。
          </div>
        </>
      );
      case 'plugins': return (
        <>
          <div className="st">插件</div>
          {!plugins.length && (
            <div className="notebox">
              还没有加载任何插件。内置插件放在安装目录的 plugins/ 里，用户插件放在
              userData/plugins/（每个插件一个文件夹：plugin.json + main.js）。
            </div>
          )}
          {plugins.map(p => (
            <div className="setrow col" key={p.id}>
              <div className="plughead">
                <span>
                  <b>{p.name}</b>
                  {p.version && <i className="dimv"> v{p.version}</i>}
                  <i className="dimv" title={p.dir}> · {p.source === 'builtin' ? '内置' : '用户'} · {p.commands.length} 条命令</i>
                  {p.error && <i className="hkclash"> {p.error}</i>}
                </span>
                {!p.rejected && (
                  <Toggle
                    label={p.disabled ? '已禁用' : '运行中'}
                    on={!p.disabled}
                    onChange={v => onTogglePlugin(p.id, v)}
                  />
                )}
              </div>
              {!p.rejected && (
                <div className="btnrow">
                  {p.permissions.map(perm => (
                    <b className="tk" key={perm} title={`沙盒权限：${perm}`}>{perm}</b>
                  ))}
                  <b className="dimv">
                    {p.commands.length
                      ? p.commands.map(c => `plugin.${p.id}.${c.id}`).join('、')
                      : '无命令'}
                  </b>
                </div>
              )}
            </div>
          ))}
          <div className="notebox">
            插件跑在 Node vm 沙盒里：<b>没有</b> require / 文件系统 / process / 网络访问，
            只注入上方列出的权限对应 API；每次执行有 5 秒超时保护，异常只记日志不会影响主程序。
            禁用插件会立即停止其命令执行（状态保存在 prefs.plugins.enabled）。详见 docs/PLUGINS.md。
          </div>
        </>
      );
      case 'logs': return (
        <>
          <div className="st">日志与诊断</div>
          <div className="setrow"><span>当前版本</span><b className="dimv">{version}</b></div>
          <div className="btnrow">
            <button onClick={onOpenLogs}>打开日志目录</button>
          </div>
          <div className="notebox">
            所有 IPC 报错、渲染进程异常、崩溃都会写入按天分文件的日志（rc-YYYY-MM-DD.log），
            提 bug 时把这个目录里的文件一起发。
          </div>
        </>
      );
      default: return null;
    }
  };

  const groups = [...new Set(nav.map(n => n.group))];

  return (
    <div className="setpage" role="dialog" aria-label="设置">
      <aside className="setnav">
        <div className="setnav-top">
          <button className="back" onClick={onClose}>← 返回应用</button>
          <label className="setsearch">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="1.6">
              <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" />
            </svg>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="搜索设置…" spellCheck={false} />
          </label>
        </div>
        {groups.map(g => (
          <div key={g} className="setgroup">
            <div className="setgrouplbl">{g}</div>
            {nav.filter(n => n.group === g).map(n => (
              <button key={n.key} className={'setnavitem' + (active === n.key ? ' on' : '')}
                onClick={() => { setActive(n.key); setQuery(''); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.5"><path d={n.icon} /></svg>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="setbody">{pane()}</main>
    </div>
  );
}
