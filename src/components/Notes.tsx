import { useEffect, useState } from 'react';
import { animLabel, thumbUrl, type Item, type Note } from '../types';
import { useDebounced } from './Chrome';

const fmtClock = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * stage 笔记视图：左列笔记列表（搜索按拼音/子串，主进程 note:search），右侧编辑器。
 * 标题与正文自动保存（防抖 800ms）；「关联图片」区搜库内图点击添加，
 * 已关联图 chips 网格可移除、点缩略图开灯箱。
 */
export function NoteView({
  notes, activeId, assets, onPick, onCreate, onPatch, onDelete, onPin, onLink, onUnlink, onOpenAsset
}: {
  notes: Note[];
  activeId: string | null;
  assets: Item[];
  onPick: (id: string) => void;
  onCreate: (title: string) => void;
  onPatch: (id: string, patch: { title?: string; content?: string }) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onLink: (assetId: string) => void;
  onUnlink: (assetId: string) => void;
  onOpenAsset: (id: string) => void;
}) {
  /* ---- 左列：搜索 + 列表 ---- */
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 180);
  const [hits, setHits] = useState<Note[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let alive = true;
    const kw = dq.trim();
    if (!kw) { setHits(null); return; }
    window.api.note.search(kw)
      .then(r => { if (alive) setHits(r || []); })
      .catch(() => { });
    return () => { alive = false; };
  }, [dq]);

  const list = hits ?? notes;
  const active = notes.find(n => n.id === activeId) || null;

  const commitAdd = () => {
    const v = draft.trim();
    if (v) onCreate(v);
    setDraft('');
    setAdding(false);
  };

  /* ---- 右侧编辑器：本地草稿 + 800ms 防抖自动保存 ---- */
  const [title, setTitle] = useState(active?.title || '');
  const [content, setContent] = useState(active?.content || '');
  const [savedAt, setSavedAt] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // 换笔记：草稿重置为目标笔记内容，保存指示灯清零
    setTitle(active?.title || '');
    setContent(active?.content || '');
    setSavedAt(0);
    setPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    if (title === active.title && content === active.content) { setPending(false); return; }
    setPending(true);
    const t = setTimeout(() => {
      const patch: { title?: string; content?: string } = {};
      const t2 = title.trim();
      if (t2 && t2 !== active.title) patch.title = t2;
      if (content !== active.content) patch.content = content;
      if (!Object.keys(patch).length) { setPending(false); return; }
      onPatch(active.id, patch);
      setPending(false);
      setSavedAt(Date.now());
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, active?.id, active?.title, active?.content]);

  /* ---- 关联图片：搜库内图（复用 lib:list 的拼音搜索）→ 点击添加 ---- */
  const [aq, setAq] = useState('');
  const daq = useDebounced(aq, 180);
  const [pool, setPool] = useState<Item[]>([]);

  useEffect(() => {
    let alive = true;
    if (!active) { setPool([]); return; }
    window.api.lib.list({ query: daq.trim(), sort: 'new' })
      .then(r => { if (alive) setPool((r || []).slice(0, 24)); })
      .catch(() => { });
    return () => { alive = false; };
  }, [daq, active?.id]);

  const linkedIds = new Set(assets.map(a => a.id));
  const candidates = pool.filter(it => !linkedIds.has(it.id));

  return (
    <div className="noteview">
      {/* 左列：笔记列表 */}
      <aside className="nv-side">
        <div className="nv-sidehead">
          <span className="nv-title-lbl">NOTES / 笔记</span>
          <button className="nv-add" title="新建笔记" onClick={() => setAdding(true)}>＋</button>
        </div>
        <div className="nv-search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="1.6">
            <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" />
          </svg>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索标题 / 正文 / 拼音 / 首字母"
            spellCheck={false}
          />
          {q && <button className="nv-clear" onClick={() => setQ('')}>×</button>}
        </div>
        {adding && (
          <div className="catadd">
            <input
              autoFocus
              value={draft}
              placeholder="新笔记标题，回车创建"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitAdd();
                if (e.key === 'Escape') { setAdding(false); setDraft(''); }
              }}
              onBlur={commitAdd}
            />
          </div>
        )}
        <div className="nv-list">
          {list.map(n => (
            <div
              key={n.id}
              className={'nvrow' + (n.id === activeId ? ' on' : '')}
              onClick={() => onPick(n.id)}
              title={n.pinned ? `📌 ${n.title}` : n.title}
            >
              <span className="nvt">
                {n.pinned && <i className="pinmark">📌</i>}
                {n.title}
              </span>
              <span className="nvm">
                {n.assetCount > 0 && <i className="nvimgn">{n.assetCount} 图</i>}
                <button
                  className="nvpin"
                  title={n.pinned ? '取消置顶' : '置顶'}
                  onClick={e => { e.stopPropagation(); onPin(n.id); }}
                >📌</button>
                <button
                  className="nvdel"
                  title="删除笔记（图片不受影响）"
                  onClick={e => { e.stopPropagation(); onDelete(n.id); }}
                >×</button>
              </span>
            </div>
          ))}
          {!list.length && (
            <div className="nv-empty">{dq.trim() ? '没搜到匹配的笔记' : '还没有笔记，点上方 ＋ 新建'}</div>
          )}
        </div>
      </aside>

      {/* 右侧：编辑器 */}
      <section className="nv-edit">
        {!active ? (
          <div className="nv-none">
            <div className="t">NO NOTE</div>
            <div className="h">{notes.length ? '从左侧选一条笔记' : '左侧 ＋ 新建第一条笔记，给参考图配上文字'}</div>
          </div>
        ) : (
          <>
            <input
              className="nv-headline"
              value={title}
              placeholder="笔记标题"
              onChange={e => setTitle(e.target.value)}
              spellCheck={false}
            />
            <div className="nv-status">
              <span>更新 {fmtClock(active.updatedAt)}</span>
              {pending && <span>保存中…</span>}
              {!pending && savedAt > 0 && <span className="ok">已保存 {fmtClock(savedAt)}</span>}
            </div>
            <textarea
              className="nv-body"
              value={content}
              placeholder="给这批参考图记点笔记：思路、要点、待办…（停顿 0.8 秒自动保存）"
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
            />

            <div className="nv-assets">
              <div className="nv-ah">
                <b>关联图片</b>
                <span>{assets.length} 张 · 删笔记不会动这些图</span>
              </div>

              {assets.length > 0 && (
                <div className="nvgrid">
                  {assets.map(it => (
                    <figure className="nvchip" key={it.id} title={`${it.name} · 点击看大图`}>
                      <button className="nvthumb" onClick={() => onOpenAsset(it.id)}>
                        <img src={thumbUrl(it)} alt={it.name} loading="lazy" draggable={false} />
                        {animLabel(it) && <span className="animchip">{animLabel(it)}</span>}
                      </button>
                      <button
                        className="nvx"
                        title="从笔记移除（图片留在库里）"
                        onClick={() => onUnlink(it.id)}
                      >×</button>
                      <figcaption>{it.name}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {!assets.length && <div className="nv-dim">还没关联图片，在下面搜索库里的图点一下就加进来。</div>}

              <div className="nv-finder">
                <div className="nv-ah">
                  <b>添加插图</b>
                  <span>搜库名 / 拼音 / 首字母</span>
                </div>
                <div className="nv-search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="1.6">
                    <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" />
                  </svg>
                  <input
                    value={aq}
                    onChange={e => setAq(e.target.value)}
                    placeholder="例：shoubu、sb、手部"
                    spellCheck={false}
                  />
                  {aq && <button className="nv-clear" onClick={() => setAq('')}>×</button>}
                </div>
                {candidates.length > 0 && (
                  <div className="nvres">
                    {candidates.map(it => (
                      <button
                        key={it.id}
                        className="nvresitem"
                        title={`关联「${it.name}」`}
                        onClick={() => onLink(it.id)}
                      >
                        <img src={thumbUrl(it)} alt={it.name} loading="lazy" draggable={false} />
                        <span>{it.name}</span>
                        <i>＋</i>
                      </button>
                    ))}
                  </div>
                )}
                {daq.trim() && !candidates.length && (
                  <div className="nv-dim">库里没搜到可添加的图（已关联的不重复出现）。</div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
