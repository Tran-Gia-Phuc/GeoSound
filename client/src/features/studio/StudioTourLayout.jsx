// =========================================================
// StudioTourLayout — khung chung cho mọi bước soạn MỘT tour (UC09–UC13):
//   ← Tên tour [trạng thái]
//   ①Thông tin ✓ ②Điểm dừng (3) ✓ ③Vùng kích hoạt ✓ ④Ngôn ngữ ⑤Xuất bản
// Stepper cho biết đã xong gì / còn thiếu gì / nên làm gì tiếp (thay cho "hub"
// 4 ô ngang hàng trước đây). ✓ / ! lấy theo dữ liệu thật (readiness của máy chủ).
// Các bước dùng useStudioTour() để đọc tour và báo làm mới sau khi sửa.
// =========================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { StatusChip } from './StudioHeader.jsx';
import { getMyTour, getPublishReadiness, statusMeta } from '../../lib/studio.js';

const StudioTourContext = createContext(null);

/** @returns {{ tour, readiness, refresh: () => Promise<void>, setTour: (t) => void }} */
export function useStudioTour() {
  const ctx = useContext(StudioTourContext);
  if (!ctx) throw new Error('useStudioTour phải nằm trong StudioTourLayout');
  return ctx;
}

const check = (readiness, key) => readiness?.checks?.find((c) => c.key === key);

function buildSteps(tour, readiness) {
  const placeCount = readiness?.placeCount ?? 0;
  const placesOk = !!check(readiness, 'places')?.ok && !!check(readiness, 'placeDescriptions')?.ok;
  const infoOk = !!check(readiness, 'title')?.ok && !!check(readiness, 'language')?.ok;
  const isPublic = tour?.status === 'public';
  return [
    { to: '', end: true, label: 'Thông tin', state: infoOk ? 'done' : 'todo' },
    {
      to: 'places',
      label: placeCount ? `Điểm dừng (${placeCount})` : 'Điểm dừng',
      state: placesOk ? 'done' : readiness ? 'todo' : 'idle',
    },
    // Vùng kích hoạt luôn có mặc định khi tour có điểm — bước này để tuỳ chỉnh.
    { to: 'route', label: 'Vùng kích hoạt', state: placeCount ? 'done' : 'idle' },
    { to: 'languages', label: 'Ngôn ngữ', state: 'optional' },
    { to: 'publish', label: isPublic ? 'Đã xuất bản' : 'Xuất bản', state: isPublic ? 'done' : readiness?.ready ? 'ready' : 'idle' },
  ];
}

const STEP_ICON = { done: 'check-circle', todo: 'alert-triangle', ready: 'navigation' };

export default function StudioTourLayout() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const [tour, setTour] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([getMyTour(id), getPublishReadiness(id).catch(() => null)]);
      setTour(t);
      setReadiness(r);
      setError('');
    } catch (e) {
      setError(e.message || 'Không tải được tour');
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Điện thoại: cuộn stepper để bước đang mở luôn nằm trong tầm nhìn.
  useEffect(() => {
    document.querySelector('.stepper__step.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname, tour]);

  const value = useMemo(
    () => ({ tour, readiness, refresh, setTour: (t) => setTour((cur) => ({ ...cur, ...t })) }),
    [tour, readiness, refresh],
  );

  if (error && !tour) {
    return (
      <div className="screen studio">
        <AppHeader title="Tour của tôi" backTo="/studio" />
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
        </div>
      </div>
    );
  }
  if (!tour) {
    return (
      <div className="screen studio">
        <p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p>
      </div>
    );
  }

  const steps = buildSteps(tour, readiness);

  return (
    <StudioTourContext.Provider value={value}>
      <div className="screen studio">
        <AppHeader
          title={tour.title}
          backTo="/studio"
          action={<StatusChip meta={statusMeta(tour.status)} />}
        />
        <nav className="stepper" aria-label="Các bước soạn tour">
          <ol>
            {steps.map((s, i) => (
              <li key={s.to || 'info'}>
                <NavLink
                  to={s.to ? `/studio/tours/${id}/${s.to}` : `/studio/tours/${id}`}
                  end={s.end}
                  className={({ isActive }) => `stepper__step stepper__step--${s.state} ${isActive ? 'is-active' : ''}`}
                >
                  <span className="stepper__num" aria-hidden="true">
                    {STEP_ICON[s.state] ? <Icon name={STEP_ICON[s.state]} size={14} /> : i + 1}
                  </span>
                  <span className="stepper__label">
                    {s.label}
                    {s.state === 'optional' ? <span className="stepper__hint">tuỳ chọn</span> : null}
                  </span>
                  <span className="sr-only">
                    {s.state === 'done' ? ' — đã xong' : s.state === 'todo' ? ' — còn thiếu' : s.state === 'ready' ? ' — sẵn sàng' : ''}
                  </span>
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <Outlet />
      </div>
    </StudioTourContext.Provider>
  );
}
