// =========================================================
// RouteConfigPage (UC11) — bước "Vùng kích hoạt" của Studio. Mặc định đã có sẵn
// (lộ trình nối các điểm, vùng tròn 50 m); màn này để TUỲ CHỈNH ngay trên bản đồ:
//   - chọn một điểm (chạm ghim / danh sách) → kéo thanh bán kính, vòng tròn trên
//     bản đồ đổi theo; ưu tiên khi chồng vùng: Bình thường / Cao / Rất cao;
//     gợi ý "đi tiếp" (lời nhắc + audio tuỳ chọn). Vùng đa giác đã lưu được giữ.
//   - audio chỉ đường (ngã rẽ): chạm bản đồ đặt tâm (ghim kéo được), lời nhắc đọc
//     bằng giọng máy hoặc tải file audio.
//   - thanh Lưu dính đáy chỉ hiện khi có thay đổi; rời màn khi chưa lưu → hỏi lại.
// Lưu TOÀN BỘ cấu hình một lần (PUT) — bước 8.
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import FileDrop from '../../components/media/FileDrop.jsx';
import TourMap from '../player/TourMap.jsx';
import { useDirtyGuard } from '../../hooks/useDirtyGuard.jsx';
import { getRouteConfig, saveRouteConfig, listPlaces } from '../../lib/studio.js';

const DEFAULT_RADIUS = 50;
const PRIORITY_LEVELS = [
  { value: 0, label: 'Bình thường' },
  { value: 10, label: 'Cao' },
  { value: 20, label: 'Rất cao' },
];
// Giá trị ưu tiên cũ bất kỳ → mức gần nhất để hiển thị.
const levelOf = (p) => PRIORITY_LEVELS.reduce((best, l) => (Math.abs(l.value - p) < Math.abs(best.value - p) ? l : best));

function fromConfig(cfg, places) {
  const byPlace = new Map((cfg.triggers || []).map((t) => [t.placeId, t]));
  const triggers = {};
  for (const p of places) {
    const t = byPlace.get(p.id);
    triggers[p.id] = {
      radius: t?.zone?.shape === 'circle' ? t.zone.radiusMeters : DEFAULT_RADIUS,
      priority: t?.priority ?? 0,
      hintText: t?.nextHint?.text ?? '',
      hintAudio: t?.nextHint?.audioUrl ?? '',
      poly: t?.zone?.shape === 'polygon' ? t.zone.geometry : null,
    };
  }
  const navAudios = (cfg.navAudios || []).map((n, i) => ({
    key: `n${i}-${n.id || ''}`,
    id: n.id,
    label: n.label || '',
    text: n.text || '',
    audioUrl: n.audioUrl || '',
    lat: n.zone?.shape === 'circle' ? n.zone.center.lat : null,
    lng: n.zone?.shape === 'circle' ? n.zone.center.lng : null,
    radius: n.zone?.shape === 'circle' ? n.zone.radiusMeters : DEFAULT_RADIUS,
    poly: n.zone?.shape === 'polygon' ? n.zone.geometry : null,
  }));
  return { path: cfg.path || [], triggers, navAudios };
}

const orderPath = (places) =>
  places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => ({ lat: p.lat, lng: p.lng }));

export default function RouteConfigPage() {
  const { id } = useParams();
  const [places, setPlaces] = useState(null);
  const [state, setState] = useState(null); // { path, triggers, navAudios }
  const [baseline, setBaseline] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [selected, setSelected] = useState(null); // { kind:'place', id } | { kind:'nav', key }
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const keySeq = useRef(0);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [cfg, pls] = await Promise.all([getRouteConfig(id), listPlaces(id)]);
      const s = fromConfig(cfg, pls);
      setPlaces(pls);
      setState(s);
      setBaseline(JSON.stringify(s));
      setIsDefault(!!cfg.isDefault);
    } catch (e) {
      setLoadError(e.message || 'Không tải được cấu hình vùng kích hoạt');
      setPlaces([]);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = !!state && JSON.stringify(state) !== baseline;
  const guard = useDirtyGuard(dirty && !busy);

  const setTrig = (pid, patch) =>
    setState((s) => ({ ...s, triggers: { ...s.triggers, [pid]: { ...s.triggers[pid], ...patch } } }));
  const setNav = (key, patch) =>
    setState((s) => ({ ...s, navAudios: s.navAudios.map((n) => (n.key === key ? { ...n, ...patch } : n)) }));

  const addNav = () => {
    keySeq.current += 1;
    const key = `new${keySeq.current}`;
    setState((s) => ({
      ...s,
      navAudios: [...s.navAudios, { key, label: '', text: '', audioUrl: '', lat: null, lng: null, radius: 30, poly: null }],
    }));
    setSelected({ kind: 'nav', key });
  };
  const removeNav = (key) => {
    setState((s) => ({ ...s, navAudios: s.navAudios.filter((n) => n.key !== key) }));
    setSelected(null);
  };

  // ---- Dựng cấu hình (xem trước trên bản đồ + lưu) ----
  const placeById = useMemo(() => new Map((places || []).map((p) => [p.id, p])), [places]);
  const zoneFor = (pid) => {
    const t = state.triggers[pid];
    if (t?.poly) return { shape: 'polygon', geometry: t.poly };
    const p = placeById.get(pid);
    return { shape: 'circle', center: { lat: p.lat, lng: p.lng }, radiusMeters: Number(t?.radius) || DEFAULT_RADIUS };
  };
  const navZone = (n) => {
    if (n.poly) return { shape: 'polygon', geometry: n.poly };
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return null;
    return { shape: 'circle', center: { lat: n.lat, lng: n.lng }, radiusMeters: Number(n.radius) || DEFAULT_RADIUS };
  };

  function validateAndBuild() {
    const triggers = [];
    for (const p of places) {
      const t = state.triggers[p.id];
      if (!t.poly && !(Number(t.radius) > 0)) return { error: `Bán kính vùng của “${p.name}” phải lớn hơn 0` };
      const trig = { placeId: p.id, zone: zoneFor(p.id), priority: Number(t.priority) || 0 };
      const text = t.hintText.trim();
      const audio = t.hintAudio.trim();
      if (text || audio) trig.nextHint = { ...(text ? { text } : {}), ...(audio ? { audioUrl: audio } : {}) };
      triggers.push(trig);
    }
    const navAudios = [];
    for (const n of state.navAudios) {
      const zone = navZone(n);
      if (!n.label.trim()) return { error: 'Mỗi audio chỉ đường cần có nhãn (vd: Ngã tư Trần Phú)' };
      if (!zone) return { error: `Hãy chạm bản đồ để đặt vị trí cho “${n.label}”` };
      navAudios.push({
        ...(n.id ? { id: n.id } : {}),
        label: n.label.trim(),
        ...(n.audioUrl ? { audioUrl: n.audioUrl } : {}),
        ...(n.text.trim() ? { text: n.text.trim() } : {}),
        zone,
      });
    }
    return { config: { path: state.path, triggers, navAudios } };
  }

  async function onSave() {
    setSaveError('');
    setNotice('');
    const { error, config } = validateAndBuild();
    if (error) {
      setSaveError(error);
      return;
    }
    setBusy(true);
    try {
      await saveRouteConfig(id, config);
      setBaseline(JSON.stringify(state));
      setIsDefault(false);
      setNotice('Đã lưu vùng kích hoạt.');
    } catch (e) {
      setSaveError(e.message || 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (places === null || (!state && !loadError)) {
    return (
      <div className="studio-step">
        <p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p>
      </div>
    );
  }

  if (!places.length) {
    return (
      <div className="studio-step">
        {loadError ? <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={18} className="alert__icon" /><div>{loadError}</div></div> : null}
        <div className="emptybox studio__empty">
          <Icon name="route" size={40} />
          <h2>Chưa có điểm dừng</h2>
          <p>Vùng kích hoạt được tạo tự động khi bạn thêm điểm dừng.</p>
          <Link to={`/studio/tours/${id}/places`} className="btn btn--primary"><Icon name="map-pin" size={18} /> Thêm điểm dừng</Link>
        </div>
      </div>
    );
  }

  const selPlace = selected?.kind === 'place' ? placeById.get(selected.id) : null;
  const selTrig = selPlace ? state.triggers[selPlace.id] : null;
  const selNav = selected?.kind === 'nav' ? state.navAudios.find((n) => n.key === selected.key) : null;

  const mapTour = {
    places,
    route: {
      path: state.path,
      triggers: places.map((p) => ({ placeId: p.id, zone: zoneFor(p.id) })),
      navAudios: state.navAudios.map((n) => ({ id: n.key, zone: navZone(n) })).filter((n) => n.zone),
    },
  };

  return (
    <div className="studio-step zoneseditor">
      {isDefault ? (
        <div className="alert" role="status">
          <Icon name="info" size={18} className="alert__icon" />
          <div>Đang dùng mặc định: mỗi điểm có vùng tròn 50 m, lộ trình nối các điểm theo thứ tự. Chỉ cần chỉnh nếu muốn khác.</div>
        </div>
      ) : null}
      {loadError ? <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={18} className="alert__icon" /><div>{loadError}</div></div> : null}

      <div className="placeseditor__grid">
        <div className="placeseditor__map">
          <TourMap
            tour={mapTour}
            activePlaceId={selPlace?.id}
            onSelectPlace={(pid) => setSelected({ kind: 'place', id: pid })}
            simulate={!!selNav}
            onSimPick={(c) => selNav && setNav(selNav.key, { lat: c.lat, lng: c.lng, poly: null })}
            editPin={selNav && Number.isFinite(selNav.lat) ? { lat: selNav.lat, lng: selNav.lng } : null}
            onEditPinMove={(c) => selNav && setNav(selNav.key, { lat: c.lat, lng: c.lng, poly: null })}
          />
          <div className="studio-map__hint" role="status">
            <Icon name="crosshair" size={16} />
            {selNav
              ? Number.isFinite(selNav.lat) ? 'Kéo ghim để dời vị trí chỉ đường' : 'Chạm bản đồ để đặt vị trí chỉ đường'
              : selPlace ? 'Kéo thanh bán kính — vòng tròn đổi theo' : 'Chạm một điểm để chỉnh vùng của nó'}
          </div>
        </div>

        <div className="placeseditor__side">
          {selPlace ? (
            <section className="studio-panel zonepanel">
              <div className="studio-panel__head">
                <h2 className="studio__h2">{places.indexOf(selPlace) + 1}. {selPlace.name}</h2>
                <button className="iconbtn iconbtn--sm" onClick={() => setSelected(null)} aria-label="Đóng"><Icon name="x" size={16} /></button>
              </div>

              {selTrig.poly ? (
                <p className="muted small">
                  Điểm này dùng vùng đa giác đã lưu.{' '}
                  <button className="linkbtn" onClick={() => setTrig(selPlace.id, { poly: null, radius: DEFAULT_RADIUS })}>Chuyển sang vùng tròn</button>
                </p>
              ) : (
                <div className="field">
                  <label className="field__label" htmlFor="z-radius">Bán kính vùng tự phát: <b>{selTrig.radius} m</b></label>
                  <input id="z-radius" type="range" min="10" max="300" step="5" value={selTrig.radius}
                    onChange={(e) => setTrig(selPlace.id, { radius: Number(e.target.value) })} />
                  <span className="field__hint">Khách đi vào vòng tròn này thì audio của điểm tự phát. Nơi đông, nhiều điểm gần nhau nên để nhỏ (20–40 m).</span>
                </div>
              )}

              <div className="field">
                <span className="field__label" id="z-prio">Ưu tiên khi vùng chồng nhau</span>
                <div className="segmented" role="radiogroup" aria-labelledby="z-prio">
                  {PRIORITY_LEVELS.map((l) => {
                    const on = levelOf(selTrig.priority).value === l.value;
                    return (
                      <button key={l.value} type="button" role="radio" aria-checked={on}
                        className={`segmented__item ${on ? 'is-active' : ''}`}
                        onClick={() => setTrig(selPlace.id, { priority: l.value })}>
                        {l.label}
                      </button>
                    );
                  })}
                </div>
                <span className="field__hint">Đứng trong vùng của nhiều điểm cùng lúc, điểm ưu tiên cao hơn phát trước.</span>
              </div>

              <details className="zonepanel__hint" open={!!(selTrig.hintText || selTrig.hintAudio)}>
                <summary>Gợi ý “đi tiếp” sau khi nghe xong (tuỳ chọn)</summary>
                <div className="field">
                  <label className="field__label small" htmlFor="z-hint">Lời nhắc (giọng máy đọc nếu không có audio)</label>
                  <input id="z-hint" className="input" value={selTrig.hintText} maxLength={500}
                    onChange={(e) => setTrig(selPlace.id, { hintText: e.target.value })}
                    placeholder="Ví dụ: Đi thẳng 100 m, rẽ trái tới Hội quán Phúc Kiến" />
                </div>
                <FileDrop kind="audio" label="Audio gợi ý" value={selTrig.hintAudio}
                  onChange={(url) => setTrig(selPlace.id, { hintAudio: url })} />
              </details>

              {!selTrig.poly && selTrig.radius !== DEFAULT_RADIUS ? (
                <button className="btn btn--ghost btn--sm" onClick={() => setTrig(selPlace.id, { radius: DEFAULT_RADIUS })}>
                  Đặt lại 50 m
                </button>
              ) : null}
            </section>
          ) : selNav ? (
            <section className="studio-panel zonepanel">
              <div className="studio-panel__head">
                <h2 className="studio__h2">Audio chỉ đường</h2>
                <button className="iconbtn iconbtn--sm" onClick={() => setSelected(null)} aria-label="Đóng"><Icon name="x" size={16} /></button>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="n-label">Nhãn *</label>
                <input id="n-label" className="input" value={selNav.label} maxLength={200}
                  onChange={(e) => setNav(selNav.key, { label: e.target.value })} placeholder="Ví dụ: Ngã tư Trần Phú" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="n-text">Lời nhắc (giọng máy đọc)</label>
                <input id="n-text" className="input" value={selNav.text} maxLength={500}
                  onChange={(e) => setNav(selNav.key, { text: e.target.value })} placeholder="Ví dụ: Rẽ phải, đi tiếp về phía bờ sông" />
                <span className="field__hint">Để trống thì đọc nhãn. Có file audio thì phát file.</span>
              </div>
              <FileDrop kind="audio" label="Audio (tuỳ chọn)" value={selNav.audioUrl}
                onChange={(url) => setNav(selNav.key, { audioUrl: url })} />
              {!selNav.poly ? (
                <div className="field">
                  <label className="field__label" htmlFor="n-radius">Bán kính: <b>{selNav.radius} m</b></label>
                  <input id="n-radius" type="range" min="10" max="150" step="5" value={selNav.radius}
                    onChange={(e) => setNav(selNav.key, { radius: Number(e.target.value) })} />
                </div>
              ) : null}
              <p className={`place-form__coords ${Number.isFinite(selNav.lat) ? '' : 'place-form__coords--empty'}`}>
                <Icon name="map-pin" size={16} />
                {Number.isFinite(selNav.lat) ? `${selNav.lat.toFixed(5)}, ${selNav.lng.toFixed(5)}` : 'Chưa đặt vị trí — chạm bản đồ'}
              </p>
              <button className="btn btn--ghost btn--sm btn--dangertext" onClick={() => removeNav(selNav.key)}>
                <Icon name="trash" size={16} /> Xoá audio chỉ đường
              </button>
            </section>
          ) : (
            <>
              <section className="studio-section">
                <h2 className="studio__h2"><Icon name="map-pin" size={16} /> Vùng theo điểm</h2>
                <ul className="zonelist">
                  {places.map((p, i) => {
                    const t = state.triggers[p.id];
                    return (
                      <li key={p.id}>
                        <button className="zonelist__item" onClick={() => setSelected({ kind: 'place', id: p.id })}>
                          <span className="stop__seq">{i + 1}</span>
                          <span className="zonelist__name">{p.name}</span>
                          <span className="chip">{t.poly ? 'Đa giác' : `${t.radius} m`}</span>
                          {t.priority ? <span className="chip chip--ok">{levelOf(t.priority).label}</span> : null}
                          {t.hintText || t.hintAudio ? <Icon name="navigation" size={14} className="muted" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="studio-section">
                <div className="studio-section__head">
                  <h2 className="studio__h2"><Icon name="route" size={16} /> Lộ trình</h2>
                  <span className="muted small">{state.path.length} điểm trên đường</span>
                </div>
                <p className="muted small">Đường nối các điểm hiển thị trên bản đồ. Đổi thứ tự điểm thì bấm nối lại.</p>
                <button className="btn btn--ghost btn--sm" onClick={() => setState((s) => ({ ...s, path: orderPath(places) }))}>
                  <Icon name="route" size={16} /> Nối lại theo thứ tự điểm
                </button>
              </section>

              <section className="studio-section">
                <div className="studio-section__head">
                  <h2 className="studio__h2"><Icon name="navigation" size={16} /> Audio chỉ đường</h2>
                </div>
                <p className="muted small">Lời nhắc phát tại ngã rẽ / đoạn nối, có vùng riêng. Tuỳ chọn.</p>
                {state.navAudios.length ? (
                  <ul className="zonelist">
                    {state.navAudios.map((n) => (
                      <li key={n.key}>
                        <button className="zonelist__item" onClick={() => setSelected({ kind: 'nav', key: n.key })}>
                          <Icon name="navigation" size={16} />
                          <span className="zonelist__name">{n.label || 'Chưa đặt tên'}</span>
                          <span className="chip">{n.audioUrl ? 'Audio' : 'Giọng máy'}</span>
                          {!Number.isFinite(n.lat) && !n.poly ? <span className="chip">Chưa đặt vị trí</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button className="btn btn--ghost btn--sm" onClick={addNav}><Icon name="plus" size={16} /> Thêm chỉ đường</button>
              </section>
            </>
          )}
        </div>
      </div>

      {notice && !dirty ? (
        <div className="alert studio-notice" role="status"><Icon name="check-circle" size={18} className="alert__icon" /><div>{notice}</div></div>
      ) : null}

      {/* Thanh lưu dính đáy — chỉ hiện khi có thay đổi */}
      {dirty ? (
        <div className="savebar" role="region" aria-label="Lưu thay đổi">
          {saveError ? <span className="savebar__err" role="alert">{saveError}</span> : <span className="savebar__msg">Có thay đổi chưa lưu</span>}
          <button className="btn btn--ghost btn--sm" onClick={() => setState(JSON.parse(baseline))} disabled={busy}>Huỷ</button>
          <button className="btn btn--primary btn--sm" onClick={onSave} disabled={busy}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check-circle" size={16} />} Lưu
          </button>
        </div>
      ) : (
        <div className="studio-nextstep">
          <span className="muted small">Ngôn ngữ phụ là tuỳ chọn.</span>
          <Link className="btn btn--primary" to={`/studio/tours/${id}/publish`}>
            Tiếp: Xuất bản <Icon name="chevron-left" size={16} className="flip" />
          </Link>
        </div>
      )}
      {guard}
    </div>
  );
}
