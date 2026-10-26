// =========================================================
// PlacesManagerPage (UC10) — quản lý điểm dừng của một tour:
//   - Bản đồ hiển thị các điểm; khi thêm/sửa có thể chạm bản đồ để đặt toạ độ.
//   - Danh sách điểm: sắp xếp lên/xuống (A2, thay kéo-thả = a11y), sửa (A3), xoá.
//   - Thêm điểm (bước 5–11) với mô tả bắt buộc; E2 vùng cấm trả lỗi từ server.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader from './StudioHeader.jsx';
import PlaceForm from './PlaceForm.jsx';
import TourMap from '../player/TourMap.jsx';
import { PLACE_TYPE_LABELS, listPlaces, addPlace, updatePlace, deletePlace, reorderPlaces } from '../../lib/studio.js';

export default function PlacesManagerPage() {
  const { id } = useParams();
  const [places, setPlaces] = useState(null); // null = đang tải
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | <placeId>
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState(null); // { lat, lng, nonce }
  const nonce = useRef(0);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setPlaces(await listPlaces(id));
    } catch (e) {
      setLoadError(e.message || 'Không tải được danh sách điểm');
      setPlaces([]);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const editingPlace = typeof editing === 'string' && editing !== 'new'
    ? places?.find((p) => p.id === editing)
    : null;

  function openForm(target) {
    setFormError('');
    setPick(null);
    setPicking(false);
    setEditing(target);
  }
  function closeForm() {
    setEditing(null);
    setPicking(false);
    setPick(null);
    setFormError('');
  }

  const onSimPick = (c) => {
    nonce.current += 1;
    setPick({ lat: c.lat, lng: c.lng, nonce: nonce.current });
    setPicking(false);
  };

  async function onSubmit(values) {
    setBusy(true);
    setFormError('');
    try {
      if (editing === 'new') {
        // tạo: bỏ audioUrl rỗng, bỏ images rỗng
        const payload = { name: values.name, type: values.type, description: values.description, lat: values.lat, lng: values.lng };
        if (values.images.length) payload.images = values.images;
        if (values.audioUrl) payload.audioUrl = values.audioUrl;
        await addPlace(id, payload);
      } else {
        // sửa: chỉ gửi trường thay đổi; audio rỗng + trước có → null để gỡ
        const patch = {};
        const cur = editingPlace;
        if (values.name !== cur.name) patch.name = values.name;
        if (values.type !== cur.type) patch.type = values.type;
        if (values.description !== cur.description) patch.description = values.description;
        if (values.lat !== cur.lat) patch.lat = values.lat;
        if (values.lng !== cur.lng) patch.lng = values.lng;
        if (JSON.stringify(values.images) !== JSON.stringify((cur.images || []).map((i) => (i.caption ? { url: i.url, caption: i.caption } : { url: i.url }))))
          patch.images = values.images;
        if (values.audioUrl) {
          if (values.audioUrl !== cur.audioUrl) patch.audioUrl = values.audioUrl;
        } else if (cur.audioUrl) {
          patch.audioUrl = null;
        }
        if (Object.keys(patch).length === 0) {
          closeForm();
          return;
        }
        await updatePlace(id, editing, patch);
      }
      await load();
      closeForm();
    } catch (e) {
      setFormError(e.message || 'Lưu điểm thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(placeId, name) {
    if (!window.confirm(`Xoá địa điểm “${name}”?`)) return;
    setListBusy(true);
    try {
      await deletePlace(id, placeId);
      await load();
    } catch (e) {
      setLoadError(e.message || 'Không xoá được điểm');
    } finally {
      setListBusy(false);
    }
  }

  async function move(index, dir) {
    const j = index + dir;
    if (j < 0 || j >= places.length) return;
    const order = places.map((p) => p.id);
    [order[index], order[j]] = [order[j], order[index]];
    setListBusy(true);
    try {
      setPlaces(await reorderPlaces(id, order));
    } catch (e) {
      setLoadError(e.message || 'Không sắp xếp được');
    } finally {
      setListBusy(false);
    }
  }

  // Tour giả để tái dùng TourMap (chỉ cần places + điểm đang chọn trên bản đồ).
  const mapTour = { places: places ?? [] };
  const pendingPos = pick ? { lat: pick.lat, lng: pick.lng } : null;

  return (
    <div className="screen studio">
      <StudioHeader title="Điểm dừng" backTo={`/studio/tours/${id}`} subtitle="Thêm & sắp xếp các điểm trên tour" />

      <main className="studio__main">
        {loadError ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{loadError}</div>
          </div>
        ) : null}

        <div className="studio-map">
          <TourMap
            tour={mapTour}
            activePlaceId={editingPlace?.id}
            simulate={picking}
            onSimPick={onSimPick}
            userPos={pendingPos}
            recenterNonce={pick?.nonce}
          />
          {picking ? (
            <div className="studio-map__hint" role="status">
              <Icon name="crosshair" size={16} /> Chạm vào bản đồ để chọn toạ độ
            </div>
          ) : null}
        </div>

        {editing ? (
          <section className="studio-panel">
            <h2 className="studio__h2">{editing === 'new' ? 'Thêm điểm dừng' : 'Sửa điểm dừng'}</h2>
            <PlaceForm
              key={editing}
              initial={editingPlace || undefined}
              pick={pick}
              picking={picking}
              onRequestPick={() => setPicking((v) => !v)}
              serverError={formError}
              busy={busy}
              onSubmit={onSubmit}
              onCancel={closeForm}
            />
          </section>
        ) : (
          <>
            <div className="studio__pagehead">
              <p className="muted">
                {places === null ? 'Đang tải…' : `${places.length} điểm`}
              </p>
              <button className="btn btn--primary" onClick={() => openForm('new')}>
                <Icon name="plus" size={18} /> Thêm điểm
              </button>
            </div>

            {places === null ? (
              <p className="muted studio__loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
            ) : places.length === 0 ? (
              <div className="emptybox studio__empty">
                <Icon name="map-pin" size={40} />
                <h2>Chưa có điểm nào</h2>
                <p>Thêm điểm dừng đầu tiên — đặt tên, mô tả và chọn vị trí trên bản đồ.</p>
                <button className="btn btn--primary" onClick={() => openForm('new')}>
                  <Icon name="plus" size={18} /> Thêm điểm
                </button>
              </div>
            ) : (
              <ol className="stops studio-stops">
                {places.map((p, i) => (
                  <li key={p.id} className="stop">
                    <span className="stop__seq">{i + 1}</span>
                    <button className="stop__main" onClick={() => openForm(p.id)}>
                      <span className="stop__name">{p.name}</span>
                      <span className="stop__leg muted small">
                        {PLACE_TYPE_LABELS[p.type] || p.type}
                        {' · '}
                        {p.audioSource === 'human' ? (
                          <><Icon name="volume" size={12} /> Audio người thật</>
                        ) : (
                          <><Icon name="languages" size={12} /> Giọng máy</>
                        )}
                      </span>
                    </button>
                    <div className="stop__actions">
                      <button className="iconbtn iconbtn--sm" onClick={() => move(i, -1)} disabled={i === 0 || listBusy} aria-label="Lên trên">
                        <Icon name="chevron-up" size={16} />
                      </button>
                      <button className="iconbtn iconbtn--sm" onClick={() => move(i, 1)} disabled={i === places.length - 1 || listBusy} aria-label="Xuống dưới">
                        <Icon name="chevron-down" size={16} />
                      </button>
                      <button className="iconbtn iconbtn--sm" onClick={() => openForm(p.id)} aria-label={`Sửa ${p.name}`}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button className="iconbtn iconbtn--sm iconbtn--danger" onClick={() => onDelete(p.id, p.name)} disabled={listBusy} aria-label={`Xoá ${p.name}`}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <p className="muted small">
              <Link className="linkbtn" to={`/studio/tours/${id}`}>← Về trình chỉnh sửa tour</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
