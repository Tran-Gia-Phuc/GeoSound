// =========================================================
// ItineraryEditorPage (UC07) — trình chỉnh sửa lịch trình: bản đồ + danh sách
// điểm (sắp xếp bằng nút lên/xuống — thay thế kéo-thả, đạt a11y "dragging
// movements"), thêm/xoá điểm, đổi tên, xem khoảng cách & thời gian, chia sẻ (A4),
// và "Đi theo lịch trình" (UC08).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import TourMap from '../player/TourMap.jsx';
import { formatDistance, formatMinutes } from '../../lib/format.js';
import {
  getItinerary, renameItinerary, removeItem, reorderItems, addItem,
} from '../../lib/itineraries.js';
import { useToast } from '../../components/Toast.jsx';
import ShareDialog from './ShareDialog.jsx';
import ModePicker from '../player/ModePicker.jsx';
import PlaceDetailSheet from '../discover/PlaceDetailSheet.jsx';
import { useBack } from '../../components/shell/AppHeader.jsx';
import './itinerary-editor-a.css';

export default function ItineraryEditorPage() {
  const { id } = useParams();
  const back = useBack('/itineraries');
  const toast = useToast();
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [detail, setDetail] = useState(null); // điểm đang xem nội dung (nghe thử)

  const load = useCallback(async () => {
    setError('');
    try {
      setView(await getItinerary(id));
    } catch (e) {
      setError(e.message || 'Không tải được lịch trình');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const places = view?.places ?? [];

  // Trả true nếu thành công (để quyết định có hiện "Hoàn tác" hay không).
  async function persist(fn) {
    setBusy(true);
    setError('');
    try {
      setView(await fn());
      return true;
    } catch (e) {
      setError(e.message || 'Thao tác thất bại');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= places.length) return;
    const ids = places.map((p) => p.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    persist(() => reorderItems(id, ids));
  };

  // Bỏ điểm ngay (không hỏi) + "Hoàn tác": thêm lại địa điểm rồi đưa về đúng vị trí cũ.
  const onRemove = async (item) => {
    const order = places.map((p) => p.id);
    const index = order.indexOf(item.id);
    if (!(await persist(() => removeItem(id, item.id)))) return;
    toast.show(`Đã bỏ “${item.name}” khỏi lịch trình`, {
      action: {
        label: 'Hoàn tác',
        onClick: () =>
          persist(async () => {
            const after = await addItem(id, item.placeId);
            const added = after.places.find((p) => !order.includes(p.id) && p.placeId === item.placeId);
            if (!added) return after;
            const restored = order.map((pid) => (pid === item.id ? added.id : pid));
            return index >= 0 ? reorderItems(id, restored) : after;
          }),
      },
    });
  };

  const startRename = () => {
    setNameDraft(view?.name || '');
    setEditingName(true);
  };
  const saveName = async (e) => {
    e.preventDefault();
    const v = nameDraft.trim();
    if (!v) return;
    const saved = await persist(async () => {
      await renameItinerary(id, v);
      return getItinerary(id);
    });
    if (saved) setEditingName(false);
  };

  if (error && !view) {
    return (
      <div className="screen screen--center">
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
        </div>
        <button className="btn btn--primary" onClick={load}>Thử lại lịch trình</button>
        <Link to="/itineraries" className="btn">Về danh sách</Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="screen screen--center">
        <p className="muted"><Icon name="loader" size={20} className="spin" /> Đang tải lịch trình…</p>
      </div>
    );
  }

  return (
    <div className="screen itin-edit itinerary-editor-a">
      <header className="itin__top">
        <button className="iconbtn" onClick={back} aria-label="Quay lại">
          <Icon name="arrow-left" size={18} />
        </button>
        {editingName ? (
          <form className="itin-edit__rename" onSubmit={saveName}>
            <input
              className="input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={120}
              autoFocus
              aria-label="Tên lịch trình"
            />
            <button className="btn btn--primary" type="submit" disabled={busy || !nameDraft.trim()}>Lưu</button>
            <button className="btn" type="button" onClick={() => setEditingName(false)} disabled={busy}>Huỷ</button>
          </form>
        ) : (
          <button className="itin-edit__title" onClick={startRename} title="Đổi tên">
            <span>{view.name}</span>
            <Icon name="edit" size={16} />
          </button>
        )}
        <button className="iconbtn" onClick={() => setShareOpen(true)} aria-label="Chia sẻ lịch trình">
          <Icon name="share" size={18} />
        </button>
      </header>

      <div className="itin-edit__map">
        <TourMap tour={view} activePlaceId={activeId} onSelectPlace={setActiveId} />
      </div>

      <div className="itin-edit__summary">
        <span><Icon name="map-pin" size={16} /> {view.placeCount} điểm</span>
        <span><Icon name="route" size={16} /> {formatDistance(view.distanceMeters)}</span>
        <span><Icon name="clock" size={16} /> {formatMinutes(view.walkingMinutes)}</span>
      </div>

      {error ? (
        <div className="alert alert--warn itin-edit__err" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
        </div>
      ) : null}

      <main className="itin-edit__list">
        <div className="itin-edit__listhead">
          <h2 className="detail__h2">Các điểm</h2>
          <Link className="btn btn--ghost btn--sm" to={`/?tab=places&addTo=${id}`} state={{ name: view.name }}>
            <Icon name="plus" size={16} /> Thêm địa điểm
          </Link>
        </div>
        {places.length === 0 ? (
          <div className="emptybox itin__empty">
            <Icon name="map-pin" size={36} />
            <h2>Lịch trình trống</h2>
            <p>Thêm địa điểm từ mục Khám phá, hoặc bấm ＋ ở điểm dừng của một tour.</p>
            <Link className="btn btn--primary" to={`/?tab=places&addTo=${id}`} state={{ name: view.name }}>
              <Icon name="search" size={18} /> Tìm địa điểm
            </Link>
          </div>
        ) : (
          <ol className="stops">
            {places.map((p, i) => (
              <li key={p.id} className={`stop ${activeId === p.id ? 'is-active' : ''}`}>
                <span className="stop__seq">{i + 1}</span>
                <button
                  className="stop__main"
                  onClick={() => {
                    setActiveId(p.id);
                    setDetail({
                      placeId: p.id,
                      name: p.name,
                      type: p.type,
                      images: p.images,
                      description: p.text,
                      audioUrl: p.audioUrl,
                      language: view.selectedLanguage,
                    });
                  }}
                >
                  <span className="stop__name">{p.name}</span>
                  {Number.isFinite(view.legMeters?.[i - 1]) && i > 0 ? (
                    <span className="stop__leg muted small">
                      <Icon name="route" size={12} /> {formatDistance(view.legMeters[i - 1])} từ điểm trước
                    </span>
                  ) : null}
                </button>
                <div className="stop__actions">
                  <button className="iconbtn iconbtn--sm" onClick={() => move(i, -1)} disabled={i === 0 || busy} aria-label="Lên trên">
                    <Icon name="chevron-up" size={16} />
                  </button>
                  <button className="iconbtn iconbtn--sm" onClick={() => move(i, 1)} disabled={i === places.length - 1 || busy} aria-label="Xuống dưới">
                    <Icon name="chevron-down" size={16} />
                  </button>
                  <button className="iconbtn iconbtn--sm iconbtn--danger" onClick={() => onRemove(p)} disabled={busy} aria-label={`Xoá ${p.name}`}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>

      {places.length ? (
        <footer className="itin-edit__bar">
          <ModePicker
            to={(mode) => `/itinerary/${id}/go?mode=${mode}`}
            gpsLabel="Đi theo lịch trình"
          />
        </footer>
      ) : null}

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} itinerary={view} onChanged={load} />
      <PlaceDetailSheet place={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
