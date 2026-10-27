// =========================================================
// ItinerariesPage (UC07) — "Lịch trình của tôi": danh sách + tạo mới.
// Chưa đăng nhập: giải thích + mời đăng nhập ngay trong tab (không bị đá sang
// màn đăng nhập khi chỉ chạm vào tab).
// Mỗi lịch trình mở trình chỉnh sửa (/itineraries/:id).
// =========================================================
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatDistance, formatMinutes } from '../../lib/format.js';
import './itinerary-library-a.css';
import { listMyItineraries, createItinerary, deleteItinerary, renameItinerary } from '../../lib/itineraries.js';

export default function ItinerariesPage() {
  const navigate = useNavigate();
  const { authenticated } = useAuth();
  const [list, setList] = useState(null); // null = đang tải
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // { id, name }

  async function load() {
    setError('');
    try {
      setList(await listMyItineraries());
    } catch (e) {
      setError(e.message || 'Không tải được danh sách');
      setList([]);
    }
  }
  useEffect(() => {
    if (!authenticated) return;
    load();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setCreating(true);
    setError('');
    try {
      const it = await createItinerary(v);
      navigate(`/itineraries/${it.id}`);
    } catch (err) {
      setError(err.message || 'Không tạo được lịch trình');
    } finally {
      setCreating(false);
    }
  };

  async function onRename(e) {
    e.preventDefault();
    if (renameBusy || !renameDraft.trim()) return;
    setRenameBusy(true);setError('');
    try {
      const saved = await renameItinerary(renaming, renameDraft.trim());
      setList((current)=>current.map((item)=>item.id === renaming ? { ...item, name:saved.name, updatedAt:saved.updatedAt || item.updatedAt } : item));
      setRenaming(null);
    } catch (err) { setError(err.message || 'Chưa đổi được tên. Bản nhập vẫn được giữ.'); }
    finally { setRenameBusy(false); }
  }

  const onDelete = async () => {
    const { id } = confirmDel;
    setConfirmDel(null);
    try {
      await deleteItinerary(id);
      setList((l) => l.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.message || 'Không xoá được');
    }
  };

  return (
    <div className="screen itin itinerary-library-a">
      <AppHeader title="Lịch trình của tôi" subtitle="Tự lên kế hoạch chuyến đi từ các địa điểm bạn quan tâm." large />

      {!authenticated ? (
        <section className="card account-guest">
          <Icon name="route" size={32} />
          <div>
            <b>Tự lên lịch trình cho chuyến đi</b>
            <p className="muted small">
              Gom các địa điểm bạn thích từ nhiều tour, sắp xếp thứ tự, rồi đi theo bằng GPS. Đăng nhập để lưu lịch trình.
            </p>
          </div>
          <div className="row">
            <Link className="btn btn--primary" to="/login?next=%2Fitineraries">Đăng nhập</Link>
            <Link className="btn btn--ghost" to="/?tab=places"><Icon name="search" size={18} /> Khám phá địa điểm</Link>
          </div>
        </section>
      ) : (
      <main className="itin__main">
        {list ? <div className="itinerary-library-a__overview" aria-label="Tổng quan lịch trình"><Icon name="route" size={32} /><div><b>{list.length} lịch trình</b><p className="muted small">Những hành trình do bạn sắp xếp và lưu lại.</p></div><Link to="/?tab=places" className="btn btn--ghost">Khám phá địa điểm</Link></div> : null}

        <form className="itin__create" onSubmit={onCreate}>
          <label htmlFor="itin-name" className="sr-only">Tên lịch trình mới</label>
          <input
            id="itin-name"
            className="input"
            placeholder="Tên lịch trình mới, ví dụ: Hội An 1 ngày…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <button className="btn btn--primary" type="submit" disabled={!name.trim() || creating}>
            {creating ? <Icon name="loader" size={18} className="spin" /> : <Icon name="plus" size={18} />}
            Tạo lịch trình
          </button>
        </form>

        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        {list === null ? (
          <p className="muted itin__loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
        ) : list.length === 0 ? (
          <div className="emptybox itin__empty">
            <Icon name="route" size={40} />
            <h2>Chưa có lịch trình nào</h2>
            <p>Tạo lịch trình đầu tiên, rồi thêm địa điểm từ mục Khám phá.</p>
            <Link to="/?tab=places" className="btn btn--ghost"><Icon name="search" size={18} /> Khám phá địa điểm</Link>
          </div>
        ) : (
          <ul className="itin__list">
            {list.map((it) => (
              <li key={it.id} className="itin-card">
                {renaming === it.id ? <form className="itinerary-library-a__rename" onSubmit={onRename}>
                  <label htmlFor={'rename-' + it.id}>Đổi tên lịch trình</label>
                  <input className="input" id={'rename-' + it.id} value={renameDraft} maxLength={120} onChange={(e)=>setRenameDraft(e.target.value)} autoFocus disabled={renameBusy} />
                  <div className="row"><button className="btn btn--primary" disabled={renameBusy || !renameDraft.trim()} type="submit">{renameBusy ? 'Đang lưu…' : 'Lưu tên'}</button><button className="btn" type="button" disabled={renameBusy} onClick={()=>setRenaming(null)}>Hủy</button></div>
                </form> : <Link to={'/itineraries/' + it.id} className="itin-card__main">
                  {it.coverImageUrl ? <img className="itinerary-library-a__cover" src={it.coverImageUrl} alt="" loading="lazy" /> : null}
                  <span className="itin-card__title">{it.name}</span>
                  <span className="itin-card__meta">
                    <span><Icon name="map-pin" size={14} /> {it.placeCount} điểm</span>
                    {it.distanceMeters ? <span><Icon name="route" size={14} /> {formatDistance(it.distanceMeters)}</span> : null}
                    {it.walkingMinutes ? <span><Icon name="clock" size={14} /> {formatMinutes(it.walkingMinutes)}</span> : null}
                    {it.shareToken ? <span className="chip chip--live"><Icon name="share" size={13} /> Đã chia sẻ</span> : null}
                  </span>
                  {it.previewPlaces?.length ? (
                    <span className="itin-card__preview">{it.previewPlaces.join(' · ')}</span>
                  ) : (
                    <span className="itin-card__preview muted">Chưa có điểm nào</span>
                  )}
                  {it.updatedAt ? <time className="muted small" dateTime={it.updatedAt}>Cập nhật {new Date(it.updatedAt).toLocaleDateString('vi-VN')}</time> : null}
                </Link>}
                <button className="iconbtn" aria-label={'Đổi tên ' + it.name} disabled={renameBusy} onClick={()=>{setRenaming(it.id);setRenameDraft(it.name);}}><Icon name="edit" size={18} /></button>
                <button
                  className="iconbtn itin-card__del"
                  onClick={() => setConfirmDel({ id: it.id, name: it.name })}
                  aria-label={`Xoá lịch trình ${it.name}`}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      )}
      <ConfirmDialog
        open={!!confirmDel}
        title={`Xoá lịch trình “${confirmDel?.name ?? ''}”?`}
        message="Lịch trình và các điểm trong đó sẽ bị xoá. Liên kết chia sẻ (nếu có) cũng ngừng hoạt động."
        confirmLabel="Xoá lịch trình"
        danger
        onConfirm={onDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
