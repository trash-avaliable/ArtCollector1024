import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animLabel, cropImgStyle, cropOf, fmtDate, fmtSize, origUrl, thumbUrl, type ColorHit, type Item, type Note, type Stats, type Tree, type Workset } from '../types';
import { dockTabs } from '../lib/layout-registry';
import { Select } from './Select';

/**
 * 检查器顶部预览框：静态图显示裁剪后的缩略图，动图直接播原始文件。
 * 动图带白边裁剪时，套用与灯箱一致的「外层容器 + 内层原图负偏移」逻辑
 * （cropImgStyle），动画照播、白边照样被裁掉。
 */
function Pv({ item }: { item: Item }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.id]);

  const anim = animLabel(item);
  const crop = cropOf(item);

  // 裁剪的动图：先按内容宽高比把「舞台」装进 16/10 的预览框，再在舞台里做负偏移裁剪
  let stage: { w: number; h: number } | null = null;
  if (item.animated && crop.cropped && box.w > 0 && box.h > 0) {
    const r = item.w / Math.max(1, item.h);
    let w = box.w, h = w / r;
    if (h > box.h) { h = box.h; w = h * r; }
    stage = { w: Math.round(w), h: Math.round(h) };
  }

  return (
    <div className="pv" ref={boxRef} title={item.animated ? '动图 · 检查器里直接播放' : undefined}>
      {item.animated ? (
        stage ? (
          <div className="pvfit" style={{ width: stage.w, height: stage.h }}>
            <img src={origUrl(item)} alt={item.name} style={cropImgStyle(item) || undefined} />
          </div>
        ) : (
          <img src={origUrl(item)} alt={item.name} />
        )
      ) : (
        <img src={thumbUrl(item)} alt={item.name} />
      )}
      {anim && <span className="animchip">{anim}</span>}
    </div>
  );
}

/**
 * 检查器「笔记」Tab：当前选中图关联的笔记列表（可从笔记里移除该图），
 * +「新建笔记并关联此图」。noteRev 变化（增删改关联）时重查。
 */
function NotePane({
  selected, noteRev, onUnlink, onCreateAndLink, onOpenNote
}: {
  selected: Item;
  noteRev: number;
  onUnlink: (noteId: string, assetId: string) => void;
  onCreateAndLink: (assetId: string) => void;
  onOpenNote: (noteId: string) => void;
}) {
  const [list, setList] = useState<Note[]>([]);

  useEffect(() => {
    let alive = true;
    window.api.note.forAsset(selected.id)
      .then(r => { if (alive) setList(r || []); })
      .catch(() => { });
    return () => { alive = false; };
  }, [selected.id, noteRev]);

  return (
    <div className="dbody notetab">
      <div className="pvname" title={selected.name}>{selected.name}</div>
      <div className="dim">这张图被以下笔记引用为插图</div>

      <div className="sect">
        <div className="sh"><span>LINKED NOTES / 关联笔记</span><em>{list.length} 条</em></div>
        {list.length ? (
          <div className="ntlist">
            {list.map(n => (
              <div className="ntrow" key={n.id} title="点击打开这条笔记">
                <button className="ntmain" onClick={() => onOpenNote(n.id)}>
                  {n.pinned && <i className="pinmark">📌</i>}
                  <span className="ntt">{n.title}</span>
                  <i className="ntc">{n.assetCount} 图</i>
                </button>
                <button
                  className="ntx"
                  title="从这条笔记里移除本图（笔记与图片都保留）"
                  onClick={() => onUnlink(n.id, selected.id)}
                >×</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="dim">还没有笔记引用这张图。</div>
        )}
      </div>

      <div className="sect">
        <div className="sh"><span>NEW / 新建</span></div>
        <button
          className="ntnew"
          title="建一条新笔记，并把当前这张图关联进去当插图"
          onClick={() => onCreateAndLink(selected.id)}
        >
          ＋ 新建笔记并关联此图
        </button>
        <div className="hint">笔记标题会带上图片名，方便回头找。</div>
      </div>
    </div>
  );
}

export function Dock({
  stats, count, label, selected, cats, tree, busy, editSignal, worksets,
  onFav, onCopy, onReveal, onRemove, onCategory, onSubCategory, onDragOut, onRename,
  onTags, onColorClick, onSimilar, onPin, onAddToWorkset, onRemoveFromWorkset, onSendToPs,
  noteRev, onUnlinkNote, onCreateNoteForAsset, onOpenNote,
  dockTab, onTab
}: {
  stats: Stats; count: number; label: string; selected: Item | null; cats: string[]; tree: Tree; busy: string;
  editSignal: number; worksets: Workset[];
  onFav: (id: string) => void; onCopy: (id: string) => void; onReveal: (id: string) => void;
  onRemove: (id: string) => void; onCategory: (id: string, cat: string) => void;
  onSubCategory: (id: string, cat: string, sub: string) => void;
  onDragOut: (id: string) => void; onRename: (id: string, name: string) => Promise<string | null>;
  onTags: (id: string, tags: string[]) => void;
  onColorClick: (hex: string) => void;
  onSimilar: (id: string) => void;
  onPin: (id: string) => void;
  onAddToWorkset: (id: string, wsId: string) => void;
  onRemoveFromWorkset: (id: string, wsId: string) => void;
  onSendToPs: (id: string) => void;
  /** 笔记关联关系的版本号：任何增删改后 App 侧 +1，本 Tab 跟着重查 */
  noteRev: number;
  onUnlinkNote: (noteId: string, assetId: string) => void;
  onCreateNoteForAsset: (assetId: string) => void;
  onOpenNote: (noteId: string) => void;
  /** 当前激活的 Dock Tab（prefs.dockTab，已过 sanitizeDockTab 校验） */
  dockTab: string;
  onTab: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [palette, setPalette] = useState<ColorHit[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [assetWs, setAssetWs] = useState<Workset[]>([]);
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

  // 这张图在哪些画板里：画板列表一变（加/删/改）就跟着刷
  useEffect(() => {
    let alive = true;
    if (!selected) { setAssetWs([]); return; }
    window.api.workset.forAsset(selected.id)
      .then(list => { if (alive) setAssetWs(list || []); })
      .catch(() => { });
    return () => { alive = false; };
  }, [selected?.id, worksets]);

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

  /* EXTENSION-DOCK-TAB: 右栏面板按注册制渲染成 Tab。
     检查器全部内容（预览 / BOARDS / 直送 PS 按钮组）在第一个 Tab，笔记 Tab（NOTES）
     展示当前图关联的笔记；再加新 Tab 时在这里补一个 id 分支返回对应面板。
     激活态存 prefs.dockTab。 */
  const tabPane = (id: string) => {
    if (id === 'notes') {
      return selected
        ? <NotePane
            selected={selected}
            noteRev={noteRev}
            onUnlink={onUnlinkNote}
            onCreateAndLink={onCreateNoteForAsset}
            onOpenNote={onOpenNote}
          />
        : (
          <div className="dbody">
            <div className="numsub">NOTES / 笔记</div>
            <div className="rule" />
            <div className="tip">选中一张图，这里显示引用它的笔记；也可以一键新建笔记并把它关联进去。</div>
          </div>
        );
    }
    if (id !== 'inspector') return null;
    return (
      <>
        <div className="dbody">
        {selected ? (
          <>
            {/* 缩略图预览已移除：检查器直接看信息 */}
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
              <div><span>FMT</span><b title={selected.animated ? '动图' : undefined}>{selected.ext.replace('.', '').toUpperCase()}{selected.animated ? ' · 动' : ''}</b></div>
              <div><span>ADDED</span><b>{fmtDate(selected.addedAt)}</b></div>
            </div>

            <div className="sect">
              <div className="sh"><span>CLASSIFICATION / 分类</span><em>两级都可改</em></div>
              <div className="cat2">
                <Select
                  value={selected.category}
                  options={cats.map(c => ({ value: c, label: c }))}
                  onChange={v => onCategory(selected.id, v)}
                  placeholder="未分类"
                />
                <Select
                  value={selected.subcategory || ''}
                  options={(tree.find(([c]) => c === selected.category)?.[1] || []).map(s => ({ value: s, label: s }))}
                  onChange={v => onSubCategory(selected.id, selected.category, v)}
                  placeholder="子类"
                  size="sm"
                />
              </div>
              {selected.clipCat && selected.clipCat !== selected.category && (
                <div className="clipchip" title={`CLIP 余弦分 ${typeof selected.clipScore === 'number' && selected.clipScore >= 0 ? selected.clipScore.toFixed(3) : '—'}，点采用即改分类`}>
                  <span>AI 建议：{selected.clipCat}</span>
                  <button onClick={() => onCategory(selected.id, selected.clipCat as string)}>采用</button>
                </div>
              )}
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
              <div className="sh"><span>BOARDS / 画板</span><em>跨分类组图</em></div>
              {assetWs.length ? (
                <div className="taglist">
                  {assetWs.map(w => (
                    <span className="tg" key={w.id} title={`已加入画板「${w.name}」`}>
                      {w.name}
                      <button title="移出该画板（图片保留）" onClick={() => onRemoveFromWorkset(selected.id, w.id)}>×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="dim">还没加入任何画板</div>
              )}
              <div className="cat2 wsops">
                <Select
                  value={null}
                  placeholder="加入画板…"
                  options={worksets.map(w => ({ value: w.id, label: w.name, hint: String(w.count || '') }))}
                  onChange={v => onAddToWorkset(selected.id, v)}
                  size="sm"
                />
                <Select
                  value={null}
                  placeholder="移出画板…"
                  options={assetWs.map(w => ({ value: w.id, label: w.name }))}
                  onChange={v => onRemoveFromWorkset(selected.id, v)}
                  size="sm"
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
              <button onClick={() => onSimilar(selected.id)}>相似图</button>
              <button onClick={() => onPin(selected.id)} title="开一个置顶小窗当参考">置顶</button>
              <button className="danger" onClick={() => onRemove(selected.id)}>移出库</button>
            </div>
            <div className="sendrow">
              <button
                className="sendps"
                disabled={!!busy}
                title="免拖拽：把这张图作为新图层，直接贴进 Photoshop 当前打开的画布"
                onClick={() => onSendToPs(selected.id)}
              >
                直送 PS <span className="k">TO LAYER</span>
              </button>
              <button
                className="dragout"
                title="按住不放，拖到 Photoshop / SAI 窗口里插入原图"
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onDragOut(selected.id);
                }}
              >
                拖入画布 <span className="k">DRAG TO PS / SAI</span>
              </button>
            </div>
          </>
        )}
      </div>
    </>
    );
  };

  const tabs = dockTabs.list();

  return (
    <aside className="dock">
      <div className="docktabs" role="tablist" aria-label="右栏面板">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === dockTab}
            className={'docktab' + (t.id === dockTab ? ' on' : '')}
            title={t.cn}
            onClick={() => onTab(t.id)}
          >
            <span>{t.en}</span>
            <span className="tcn">{t.cn}</span>
          </button>
        ))}
        <span className="tabcnt">{count}</span>
      </div>
      {tabPane(dockTab)}
    </aside>
  );
}
