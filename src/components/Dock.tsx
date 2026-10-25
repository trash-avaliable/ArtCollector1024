import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtSize, type ColorHit, type Item, type Stats } from '../types';
import { Select } from './Select';

export function Dock({
  stats, count, label, selected, cats, busy, editSignal,
  onFav, onCopy, onReveal, onRemove, onCategory, onDragOut, onRename,
  onTags, onColorClick
}: {
  stats: Stats; count: number; label: string; selected: Item | null; cats: string[]; busy: string;
  editSignal: number;
  onFav: (id: string) => void; onCopy: (id: string) => void; onReveal: (id: string) => void;
  onRemove: (id: string) => void; onCategory: (id: string, cat: string) => void;
  onDragOut: (id: string) => void; onRename: (id: string, name: string) => Promise<string | null>;
  onTags: (id: string, tags: string[]) => void;
  onColorClick: (hex: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [palette, setPalette] = useState<ColorHit[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const stem = (name: string) => {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  };

  useEffect(() => { setEditing(false); setErr(null); setTagDraft(''); }, [selected?.id]);

  useEffect(() => {
    let alive = true;
    if (!selected) { setPalette([]); return; }
    window.api.lib.colors(selected.id).then(c => { if (alive) setPalette(c || []); }).catch(() => { });
    return () => { alive = false; };
  }, [selected?.id]);

  useEffect(() => {
    if (editSignal > 0 && selected) { setDraft(stem(selected.name)); setEditing(true); }
  }, [editSignal]);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const commit = async () => {
    if (!selected) return;
    const msg = await onRename(selected.id, draft);
    if (msg) { setErr(msg); return; }
    setErr(null);
    setEditing(false);
  };

  const addTag = () => {
    if (!selected) return;
    const v = tagDraft.trim();
    if (!v) return;
    if (!selected.tags.includes(v)) onTags(selected.id, [...selected.tags, v]);
    setTagDraft('');
  };

  /* 空闲态：不占版面，只留一条竖直脊柱报库体量（必须放在所有 hook 之后） */
  if (!selected) {
    return (
      <aside className="dock idle" title="点一张图，这里显示来源、标签、色板与操作">
        <div className="idlelabel">INSPECTOR</div>
        <div className="idletip">点一张图看详情</div>
        <div className="idlespine"><b>{count}</b> ITEMS</div>
      </aside>
    );
  }

  return (
    <aside className="dock">
      <div className="dhead">
        <div className="t">INSPECTOR / <b>检查器</b></div>
        <div className="cnt">{count}</div>
      </div>

      <div className="dbody">
        {selected ? (
          <>
            {editing ? (
              <div className="rename">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => { setDraft(e.target.value); setErr(null); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') { setEditing(false); setErr(null); }
                  }}
                  spellCheck={false}
                />
                <span className="ext">{selected.ext}</span>
                <button onClick={commit}>保存</button>
              </div>
            ) : (
              <div className="pvname" onClick={() => { setDraft(stem(selected.name)); setEditing(true); }} title="点击重命名">
                <span>{selected.name}</span>
                <i className="pen">✎</i>
              </div>
            )}
            {err && <div className="err">{err}</div>}
            {editing && <div className="hint">回车保存 · Esc 取消 · 同时改磁盘文件名</div>}

            <div className="sect">
              <div className="sh"><span>SOURCE / 来源</span></div>
              <div className="src">
                <b>{selected.source === 'clip' ? '剪贴板' : selected.source === 'local' ? '本地导入' : selected.source}</b>
                {selected.sourceUrl
                  ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer" title={selected.sourceUrl}>{selected.sourceUrl}</a>
                  : <span className="dim">无来源链接（本地文件）</span>}
              </div>
            </div>

            <div className="metarow">
              <div><span>SIZE</span><b>{selected.w}×{selected.h}</b></div>
              <div><span>FILE</span><b>{fmtSize(selected.size)}</b></div>
              <div><span>FMT</span><b>{selected.ext.replace('.', '').toUpperCase()}</b></div>
              <div><span>ADDED</span><b>{fmtDate(selected.addedAt)}</b></div>
            </div>

            <div className="sect">
              <div className="sh"><span>CLASSIFICATION / 分类</span><em>可改判</em></div>
              <Select
                value={selected.category}
                options={cats.map(c => ({ value: c, label: c }))}
                onChange={v => onCategory(selected.id, v)}
                placeholder="未分类"
              />
              {selected.subcategory && <div className="subcat">当前子类 · {selected.subcategory}</div>}
            </div>

            <div className="sect">
              <div className="sh"><span>TAGS / 标签</span><em>回车添加</em></div>
              <div className="taglist">
                {selected.tags.map(t => (
                  <span className="tg" key={t}>
                    {t}
                    <button onClick={() => onTags(selected.id, selected.tags.filter(x => x !== t))}>×</button>
                  </span>
                ))}
                <input
                  className="taginput"
                  value={tagDraft}
                  placeholder="+ 标签"
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                />
              </div>
            </div>

            <div className="sect">
              <div className="sh"><span>PALETTE / 色板</span><em>{palette.length ? '点色块按色搜索' : ''}</em></div>
              {palette.length ? (
                <>
                  <div className="pal">
                    {palette.map((c, i) => (
                      <button
                        key={c.hex + i}
                        className="pseg"
                        data-hex={c.hex}
                        style={{ background: c.hex, flexGrow: Math.max(c.pct, 4) }}
                        title={`${c.hex} · 占 ${Math.round(c.pct)}%，点击按此色搜索`}
                        onClick={() => onColorClick(c.hex)}
                      />
                    ))}
                  </div>
                  <div className="palhint">
                    <span>{palette.length} COLORS</span>
                    <span>{Math.round(palette[0]?.pct ?? 0)}% {palette[0]?.hex ?? ''}</span>
                  </div>
                </>
              ) : (
                <div className="dim">这张图还没有提取到色板</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="num">{String(count).padStart(2, '0')}</div>
            <div className="numsub">{label}</div>
            <div className="rule" />
            <div className="rows">
              <div className="row"><span>库内总数</span><b>{stats.total}</b></div>
              <div className="row"><span>待分类</span><b className={stats.inbox ? 'warn' : ''}>{stats.inbox}</b></div>
              <div className="row"><span>收藏</span><b>{stats.fav}</b></div>
              <div className="row"><span>本周新增</span><b>{stats.week}</b></div>
              <div className="row"><span>占用空间</span><b>{fmtSize(stats.size)}</b></div>
            </div>
            <div className="rule" />
            <div className="tip">
              点一张图看详情。Ctrl 点选多张、Shift 连选，选中后可批量改分类或删除。
            </div>
          </>
        )}
      </div>

      <div className="dfoot">
        {busy && <div className="busy">{busy}</div>}
        {selected && (
          <>
            <div className="acts">
              <button className={selected.favorite ? 'on' : ''} onClick={() => onFav(selected.id)}>
                {selected.favorite ? '取消收藏' : '收藏'}
              </button>
              <button onClick={() => onCopy(selected.id)}>复制图片</button>
              <button onClick={() => onReveal(selected.id)}>定位文件</button>
              <button className="danger" onClick={() => onRemove(selected.id)}>移出库</button>
            </div>
            <button className="dragout" onClick={() => onDragOut(selected.id)}>
              拖入画布 <span className="k">DRAG TO PS / SAI</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
