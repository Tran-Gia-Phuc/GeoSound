// =========================================================
// StudioToursPage (UC09 bước 1–2) — "Tour của tôi": danh sách tour người đóng
// góp đã tạo, kèm trạng thái, TIẾN ĐỘ (n/4 bước) và nút làm bước tiếp theo
// ("Thêm điểm dừng", "Xuất bản", "Xem bản công khai"); nút tạo tour mới.
// =========================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader, { StatusChip } from './StudioHeader.jsx';
import { langLabel } from '../../lib/format.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';
import { listMyTours, statusMeta } from '../../lib/studio.js';
import './studio-library-a.css';

// Bước tiếp theo của một tour (số điểm lấy từ danh sách, không gọi thêm API).
function nextAction(t) {
  if (!t.placeCount) return { to: `/studio/tours/${t.id}/places`, label: 'Thêm điểm dừng', icon: 'map-pin', primary: true };
  if (t.status === 'public') return { to: `/tour/${t.id}`, label: 'Xem bản công khai', icon: 'headphones' };
  if (['hidden', 'restricted'].includes(t.status)) return { to: `/studio/tours/${t.id}`, label: 'Xem chi tiết', icon: 'info' };
  return { to: `/studio/tours/${t.id}/publish`, label: 'Xem thử & xuất bản', icon: 'navigation', primary: true };
}

// Thông tin ✓ (đã tạo) · Điểm dừng · Vùng kích hoạt (tự sinh khi có điểm) · Xuất bản.
function progressOf(t) {
  const done = 1 + (t.placeCount ? 2 : 0) + (t.status === 'public' ? 1 : 0);
  return { done, total: 4 };
}

export default function StudioToursPage() {
  const [list, setList] = useState(null); // null = đang tải
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setError('');
    try {
      setList(await listMyTours());
    } catch (e) {
      setError(e.message || 'Không tải được danh sách tour');
      setList([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const statuses = [...new Set((list || []).map((t)=>t.status))];
  const filtered = (list || []).filter((t)=>(!status || t.status === status) && [t.title,t.city,t.description].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')));
  return (
    <div className="screen studio studio-library-a">
      <StudioHeader />

      <main className="studio__main">
        <div className="studio__pagehead">
          <div>
            <h1 className="studio__h1">Tour của tôi</h1>
            <p className="muted">Tạo và quản lý các tour audio bạn đóng góp.</p>
          </div>
          <Link to="/studio/tours/new" className="btn btn--primary">
            <Icon name="plus" size={18} /> Tạo tour
          </Link>
        </div>

        {list ? <>
          <div className="studio-library-a__summary" aria-label="Tổng quan tour của tôi">{[
            { value:'', label:'Tất cả', count:list.length },
            { value:'draft', label:'Bản nháp', count:list.filter((t)=>t.status === 'draft').length },
            { value:'public', label:'Đang công khai', count:list.filter((t)=>t.status === 'public').length },
          ].map((item)=><button key={item.value} className={'studio-library-a__stat ' + (status === item.value ? 'is-active' : '')} aria-pressed={status === item.value} onClick={()=>setStatus(item.value)}><span>{item.label}</span><b>{item.count}</b></button>)}</div>
          <section className="studio-library-a__filters" aria-label="Lọc tour của tôi"><label className="sr-only" htmlFor="studio-a-search">Tìm tour của tôi</label><input id="studio-a-search" type="search" className="input" placeholder="Tìm tên tour, thành phố hoặc mô tả…" value={search} onChange={(e)=>setSearch(e.target.value)} /><label className="sr-only" htmlFor="studio-a-status">Trạng thái tour</label><select id="studio-a-status" className="input" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">Tất cả trạng thái</option>{statuses.map((value)=><option key={value} value={value}>{statusMeta(value).label}</option>)}</select></section>
          <p className="muted small" role="status">{filtered.length}/{list.length} tour</p>
        </> : null}
        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div><button className="btn btn--sm" onClick={load}>Thử lại danh sách</button>
          </div>
        ) : null}

        {list === null ? (
          <p className="muted studio__loading">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        ) : list.length === 0 && error ? <p className="muted">Chưa tải được tour của bạn.</p> : list.length === 0 ? (
          <div className="emptybox studio__empty">
            <Icon name="map-pin" size={40} />
            <h2>Chưa có tour nào</h2>
            <p>Bắt đầu bằng cách tạo tour đầu tiên — đặt tên và chọn ngôn ngữ gốc.</p>
            <Link to="/studio/tours/new" className="btn btn--primary">
              <Icon name="plus" size={18} /> Tạo tour
            </Link>
          </div>
        ) : (
          <>
          {!filtered.length ? <div className="emptybox"><Icon name="search" size={36} /><h2>Không có tour khớp bộ lọc</h2><button className="btn" onClick={()=>{setSearch('');setStatus('');}}>Xóa bộ lọc</button></div> : null}
          <ul className="studio-cards">
            {filtered.map((t) => {
              const next = nextAction(t);
              const p = progressOf(t);
              return (
              <li key={t.id} className="studio-cardwrap">
                <Link to={`/studio/tours/${t.id}`} className="studio-card">
                  <span
                    className="studio-card__cover"
                    style={t.coverImageUrl ? { backgroundImage: `url(${t.coverImageUrl})` } : undefined}
                    aria-hidden="true"
                  >
                    {!t.coverImageUrl ? <Icon name="image" size={24} /> : null}
                  </span>
                  <span className="studio-card__body">
                    <span className="studio-card__titlerow">
                      <span className="studio-card__title">{t.title}</span>
                      <StatusChip meta={statusMeta(t.status)} />
                      {t.updatedAt ? <time className="studio-library-a__updated muted small" dateTime={t.updatedAt}>{new Date(t.updatedAt).toLocaleDateString('vi-VN')}</time> : null}
                    </span>
                    <span className="studio-card__meta muted small">
                      <span><Icon name="languages" size={13} /> {langLabel(t.originalLanguage)}</span>
                      <span><Icon name="route" size={13} /> {TOUR_TYPE_LABELS[t.type] || t.type}</span>
                      {t.city ? <span><Icon name="map-pin" size={13} /> {t.city}</span> : null}
                      <span><Icon name="list" size={13} /> {t.placeCount ?? 0} điểm</span>
                    </span>
                    <span className="studio-card__progress" aria-label={`Đã xong ${p.done}/${p.total} bước`}>
                      <span className="studio-card__bar"><span style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                      <span className="muted small">{p.done}/{p.total}</span>
                    </span>
                  </span>
                  <Icon name="chevron-left" size={18} className="studio-card__chev" />
                </Link>
                <Link to={next.to} className={`btn btn--sm ${next.primary ? 'btn--primary' : 'btn--ghost'} studio-card__next`}>
                  <Icon name={next.icon} size={16} /> {next.label}
                </Link>
              </li>
              );
            })}
          </ul>
          </>
        )}
      </main>
    </div>
  );
}
