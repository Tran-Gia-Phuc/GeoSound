// =========================================================
// PlacesManagerPage (UC10) — bước "Điểm dừng" của Studio, BẢN ĐỒ TRƯỚC:
//   - Thêm/sửa điểm: tìm địa chỉ hoặc chạm bản đồ để thả ghim, KÉO ghim để chỉnh;
//     form nằm cạnh bản đồ (desktop) / dưới bản đồ (điện thoại). Toạ độ thủ công
//     chỉ là phương án phụ trong form.
//   - E2 vùng cấm: vẽ vùng cấm màu đỏ trên bản đồ + gợi ý kéo ghim ra ngoài.
//   - Danh sách điểm: sắp xếp lên/xuống (A2, thay kéo-thả = a11y), sửa (A3), xoá
//     (xác nhận bằng ConfirmDialog).
//   - UC15 #137 (máy chủ bật kiểm duyệt): chip trạng thái quét AI của từng điểm (nội dung + ảnh),
//     tự cập nhật mỗi 5 s khi còn điểm đang quét; #113 chi tiết vùng cấm (tên, loại) khi lưu bị chặn.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import PlaceForm from './PlaceForm.jsx';
import PlaceModerationChip from './PlaceModerationChip.jsx';
import ForbiddenZoneDetails from './ForbiddenZoneDetails.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useVisiblePoll } from '../../hooks/useVisiblePoll.js';
import { POLL_INTERVAL_MS, errorText, isModerationMode } from '../../lib/submission.js';
import AddressSearch from './AddressSearch.jsx';
import { useStudioTour } from './StudioTourLayout.jsx';
import TourMap from '../player/TourMap.jsx';
import { PLACE_TYPE_LABELS, listPlaces, addPlace, updatePlace, deletePlace, reorderPlaces } from '../../lib/studio.js';

export default function PlacesManagerPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { refresh: refreshTour, readiness } = useStudioTour();
  const moderation = isModerationMode(readiness);
  const toast = useToast();
  const [places, setPlaces] = useState(null); // null = đang tải
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | <placeId>
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [pin, setPin] = useState(null); // { lat, lng } ghim đang đặt
  const [pick, setPick] = useState(null); // { lat, lng, nonce } bơm vào PlaceForm
  const [focus, setFocus] = useState(null); // { lat, lng, nonce } bay bản đồ tới
  const [blocked, setBlocked] = useState(null); // { name, type, geometry } vùng cấm vừa vướng
  const [confirmDel, setConfirmDel] = useState(null); // { id, name }
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

  // #137 — places being scanned by the AI: refresh the list every 5 s while the page is visible.
  const anyChecking = !!places?.some((p) => p.moderationStatus === 'checking');
  const { error: pollError, retry: retryPoll } = useVisiblePoll(
    async () => {
      const next = await listPlaces(id);
      setPlaces(next);
      if (!next.some((p) => p.moderationStatus === 'checking')) refreshTour();
    },
    { enabled: moderation && anyChecking, intervalMs: POLL_INTERVAL_MS },
  );

  const editingPlace = typeof editing === 'string' && editing !== 'new'
    ? places?.find((p) => p.id === editing)
    : null;

  // Đặt ghim (chạm bản đồ / kéo / tìm địa chỉ / gõ tay) → đồng bộ form + bản đồ.
  const placePin = useCallback((c, { fly = false, toForm = true } = {}) => {
    nonce.current += 1;
    setPin({ lat: c.lat, lng: c.lng });
    if (toForm) setPick({ lat: c.lat, lng: c.lng, nonce: nonce.current });
    if (fly) setFocus({ lat: c.lat, lng: c.lng, nonce: nonce.current });
    setBlocked(null);
  }, []);

  function openForm(target) {
    setFormError('');
    setBlocked(null);
    setEditing(target);
    const p = target !== 'new' ? places?.find((x) => x.id === target) : null;
    if (p) {
      nonce.current += 1;
      setPin({ lat: p.lat, lng: p.lng });
      setPick(null);
      setFocus({ lat: p.lat, lng: p.lng, nonce: nonce.current });
    } else {
      setPin(null);
      setPick(null);
    }
  }
  // Mở thẳng một điểm khi đến từ "Sửa điểm này" (Xem thử).
  useEffect(() => {
    const target = sp.get('edit');
    if (!target || !places?.some((p) => p.id === target)) return;
    openForm(target);
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      n.delete('edit');
      return n;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  function closeForm() {
    setEditing(null);
    setPin(null);
    setPick(null);
    setFormError('');
    setBlocked(null);
  }

  async function onSubmit(values) {
    setBusy(true);
    setFormError('');
    setBlocked(null);
    try {
      let saved = null;
      if (editing === 'new') {
        // tạo: bỏ audioUrl rỗng, bỏ images rỗng
        const payload = { name: values.name, type: values.type, description: values.description, lat: values.lat, lng: values.lng };
        if (values.images.length) payload.images = values.images;
        if (values.audioUrl) payload.audioUrl = values.audioUrl;
        saved = await addPlace(id, payload);
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
        saved = await updatePlace(id, editing, patch);
      }
      await load();
      refreshTour();
      closeForm();
      if (saved?.moderationStatus === 'checking') {
        toast.show('Đã lưu điểm. AI đang kiểm duyệt nội dung và ảnh của điểm này.');
      }
    } catch (e) {
      // E2 — vẽ vùng cấm để tác giả thấy phải dời ghim đi đâu.
      // #113 — tên + loại vùng cấm hiện trong form (ForbiddenZoneDetails).
      if (e.code === 'forbidden_zone') {
        setBlocked(e.zone ?? {});
        setFormError('');
      } else {
        setFormError(errorText(e, 'Lưu điểm thất bại'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    const target = confirmDel;
    setConfirmDel(null);
    setListBusy(true);
    try {
      await deletePlace(id, target.id);
      await load();
      refreshTour();
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

  // Khi đang sửa một điểm: ẩn ghim số của chính nó (đã có ghim kéo được).
  const mapPlaces = (places ?? []).filter((p) => p.id !== editing);
  const mapTour = { places: mapPlaces };

  return (
    <div className="studio-step placeseditor">
      {pollError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>Chưa cập nhật được kết quả quét AI: {errorText(pollError, 'lỗi không xác định')}</div>
          <button className="btn btn--sm" onClick={retryPoll}>Thử lại</button>
        </div>
      ) : null}
      {loadError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{loadError}</div>
        </div>
      ) : null}

      <div className="placeseditor__grid">
        <div className={`placeseditor__map ${editing ? 'is-editing' : ''}`}>
          <TourMap
            tour={mapTour}
            simulate={!!editing}
            onSimPick={(c) => placePin(c)}
            editPin={editing ? pin : null}
            onEditPinMove={(c) => placePin(c)}
            focus={focus}
            blockedZones={blocked?.geometry ? [blocked.geometry] : []}
            onSelectPlace={(pid) => !editing && openForm(pid)}
          />
          {editing ? (
            <>
              <AddressSearch onPick={(r) => placePin(r, { fly: true })} />
              <div className="studio-map__hint" role="status">
                <Icon name="crosshair" size={16} />
                {blocked
                  ? 'Trong vùng cấm (đỏ) — kéo ghim ra ngoài'
                  : pin
                    ? 'Kéo ghim để chỉnh vị trí'
                    : 'Chạm bản đồ hoặc tìm địa chỉ để đặt ghim'}
              </div>
            </>
          ) : null}
        </div>

        <div className="placeseditor__side">
          {editing ? (
            <section className="studio-panel">
              <div className="studio-panel__head">
                <h2 className="studio__h2">{editing === 'new' ? 'Thêm điểm dừng' : `Sửa “${editingPlace?.name ?? ''}”`}</h2>
                <button className="iconbtn iconbtn--sm" onClick={closeForm} aria-label="Đóng">
                  <Icon name="x" size={16} />
                </button>
              </div>
              {blocked ? (
                <ForbiddenZoneDetails zone={blocked} placeName={editingPlace?.name} onMap={!!blocked.geometry} />
              ) : null}
              <PlaceForm
                key={editing}
                moderation={moderation}
                initial={editingPlace || undefined}
                pick={pick}
                onManualCoords={(c) => placePin(c, { fly: true, toForm: false })}
                serverError={formError}
                busy={busy}
                onSubmit={onSubmit}
                onCancel={closeForm}
              />
            </section>
          ) : (
            <>
              <div className="studio__pagehead">
                <p className="muted">{places === null ? 'Đang tải…' : `${places.length} điểm`}</p>
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
                  <p>Bấm “Thêm điểm”, rồi chạm bản đồ hoặc tìm địa chỉ để đặt điểm dừng đầu tiên.</p>
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
                        {moderation || (p.moderationStatus && p.moderationStatus !== 'approved') ? (
                          <PlaceModerationChip status={p.moderationStatus} />
                        ) : null}
                        <span className="stop__leg muted small">
                          {PLACE_TYPE_LABELS[p.type] || p.type}
                          {' · '}
                          {p.audioSource === 'human' ? (
                            <><Icon name="volume" size={12} /> Audio người thật</>
                          ) : (
                            <><Icon name="languages" size={12} /> Giọng máy</>
                          )}
                          {p.images?.length ? <> · <Icon name="image" size={12} /> {p.images.length}</> : null}
                        </span>
                      </button>
                      <div className="stop__actions">
                        <button className="iconbtn iconbtn--sm" onClick={() => move(i, -1)} disabled={i === 0 || listBusy} aria-label={`Đưa ${p.name} lên trên`}>
                          <Icon name="chevron-up" size={16} />
                        </button>
                        <button className="iconbtn iconbtn--sm" onClick={() => move(i, 1)} disabled={i === places.length - 1 || listBusy} aria-label={`Đưa ${p.name} xuống dưới`}>
                          <Icon name="chevron-down" size={16} />
                        </button>
                        <button className="iconbtn iconbtn--sm iconbtn--danger" onClick={() => setConfirmDel({ id: p.id, name: p.name })} disabled={listBusy} aria-label={`Xoá ${p.name}`}>
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {places?.length ? (
                <div className="studio-nextstep">
                  <span className="muted small">Vùng kích hoạt 50 m quanh mỗi điểm đã được tạo sẵn.</span>
                  <Link className="btn btn--primary" to={`/studio/tours/${id}/publish`}>
                    Xem thử &amp; xuất bản <Icon name="chevron-left" size={16} className="flip" />
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title={`Xoá điểm “${confirmDel?.name ?? ''}”?`}
        message="Điểm dừng cùng ảnh, audio và bản dịch của nó sẽ bị xoá khỏi tour."
        confirmLabel="Xoá điểm"
        danger
        onConfirm={onDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
