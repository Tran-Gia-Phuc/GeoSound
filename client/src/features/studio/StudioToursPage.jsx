// =========================================================
// StudioToursPage (UC09 bước 1–2) — "Tour của tôi": danh sách tour người đóng
// góp đã tạo, kèm trạng thái; nút tạo tour mới; mỗi thẻ mở trình chỉnh sửa.
// =========================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader, { StatusChip } from './StudioHeader.jsx';
import { langLabel } from '../../lib/format.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';
import { listMyTours, statusMeta } from '../../lib/studio.js';

export default function StudioToursPage() {
  const [list, setList] = useState(null); // null = đang tải
  const [error, setError] = useState('');

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

  return (
    <div className="screen studio">
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

        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        {list === null ? (
          <p className="muted studio__loading">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        ) : list.length === 0 ? (
          <div className="emptybox studio__empty">
            <Icon name="map-pin" size={40} />
            <h2>Chưa có tour nào</h2>
            <p>Bắt đầu bằng cách tạo tour đầu tiên — đặt tên và chọn ngôn ngữ gốc.</p>
            <Link to="/studio/tours/new" className="btn btn--primary">
              <Icon name="plus" size={18} /> Tạo tour
            </Link>
          </div>
        ) : (
          <ul className="studio-cards">
            {list.map((t) => (
              <li key={t.id}>
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
                    </span>
                    <span className="studio-card__meta muted small">
                      <span><Icon name="languages" size={13} /> {langLabel(t.originalLanguage)}</span>
                      <span><Icon name="route" size={13} /> {TOUR_TYPE_LABELS[t.type] || t.type}</span>
                      {t.city ? <span><Icon name="map-pin" size={13} /> {t.city}</span> : null}
                    </span>
                  </span>
                  <Icon name="chevron-left" size={18} className="studio-card__chev" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
