import { fmtDate, fmtSize, thumbUrl, type Item, type Stats, type Tree } from '../types';

export function Dock({
  stats, count, label, selected, tree, busy, onImport, onOpenRoot,
  onFav, onCopy, onReveal, onRemove, onCategory, onDragOut
}: {
  stats: Stats; count: number; label: string; selected: Item | null; tree: Tree; busy: string;
  onImport: () => void; onOpenRoot: () => void; onFav: (id: string) => void;
  onCopy: (id: string) => void; onReveal: (id: string) => void; onRemove: (id: string) => void;
  onCategory: (id: string, cat: string) => void; onDragOut: (id: string) => void;
}) {
  return (
    <aside className="dock">
      <div className="dock-scroll">
        <div className="eyebrow">Archive / 档案</div>
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

        {selected ? (
          <div className="detail">
            <div className="thumb"><img src={thumbUrl(selected)} alt={selected.name} /></div>
            <div className="nm">{selected.name}</div>
            <div className="kv">
              <span>{selected.w}×{selected.h}</span>
              <span>{fmtSize(selected.size)}</span>
              <span>{selected.ext.replace('.', '').toUpperCase()}</span>
              <span>{fmtDate(selected.addedAt)}</span>
            </div>
            <div className="kv" style={{ color: 'rgba(255,255,255,.7)' }}>
              <span>{selected.category}{selected.subcategory ? ' / ' + selected.subcategory : ''}</span>
            </div>
            <div className="act">
              <button className={selected.favorite ? 'on' : ''} onClick={() => onFav(selected.id)}>收藏</button>
              <button onClick={() => onCopy(selected.id)}>复制图</button>
              <button onClick={() => onDragOut(selected.id)}>拖出</button>
            </div>
            <div className="act">
              <button onClick={() => onReveal(selected.id)}>定位文件</button>
              <button onClick={() => onRemove(selected.id)}>移出库</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>改判分类</div>
              <select
                value={selected.category}
                onChange={e => onCategory(selected.id, e.target.value)}
                style={{
                  width: '100%', height: 34, background: 'rgba(255,255,255,.06)', color: '#fff',
                  border: '1px solid rgba(255,255,255,.24)', padding: '0 8px', fontSize: 12
                }}
              >
                {tree.map(([cat]) => <option key={cat} value={cat} style={{ color: '#111' }}>{cat}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="detail" style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, lineHeight: 1.8 }}>
            选中一张图，这里显示原图信息、来源与快捷操作。<br />
            把卡片拖到上方分类条即可改判；拖「拖入画布」到 PS / SAI 直接插入。
          </div>
        )}
      </div>

      <div className="dock-foot">
        {busy && <div className="numsub" style={{ color: '#fffa00', marginBottom: 8 }}>{busy}</div>}
        <button className="btn-primary" onClick={onImport}>
          <span className="t">导入参考图</span>
          <span className="k">CTRL+O</span>
        </button>
        <button className="btn-ghost" onClick={onOpenRoot}>
          <span className="t">打开库目录</span>
          <span className="k">FOLDER</span>
        </button>
      </div>
    </aside>
  );
}
