// =========================================================
// RouteConfigPage (UC11) — cấu hình lộ trình & vùng kích hoạt của tour.
//   - Lộ trình (path): tạo nhanh theo thứ tự điểm dừng; xem trên bản đồ.
//   - Vùng kích hoạt từng điểm: vùng TRÒN quanh điểm (chỉnh bán kính), bật/tắt,
//     độ ưu tiên khi chồng lấn, gợi ý "đi tiếp" (text/audio). Vùng đa giác đã lưu
//     được giữ nguyên.
//   - Audio chỉ đường (nav): nhãn + audio + vùng tròn riêng (chọn tâm trên bản đồ).
// Lưu TOÀN BỘ cấu hình một lần (PUT) — bước 8.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader from './StudioHeader.jsx';
import TourMap from '../player/TourMap.jsx';
import { getRouteConfig, saveRouteConfig, listPlaces } from '../../lib/studio.js';

const DEFAULT_RADIUS = 50;
const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function RouteConfigPage() {
  const { id } = useParams();
  const [places, setPlaces] = useState(null);
  const [path, setPath] = useState([]);
  const [triggers, setTriggers] = useState({}); // placeId -> { enabled, radius, priority, hintText, hintAudio, poly }
  const [navAudios, setNavAudios] = useState([]); // { key, id?, label, audioUrl, lat, lng, radius, poly? }
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null); // navAudio key đang chọn tâm, hoặc null
  const keySeq = useRef(0);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [cfg, pls] = await Promise.all([getRouteConfig(id), listPlaces(id)]);
      setPlaces(pls);
      setPath(cfg.path || []);
      const byPlace = new Map((cfg.triggers || []).map((t) => [t.placeId, t]));
      const tState = {};
      for (const p of pls) {
        const t = byPlace.get(p.id);
        tState[p.id] = {
          enabled: !!t,
          radius: t?.zone?.shape === 'circle' ? t.zone.radiusMeters : DEFAULT_RADIUS,
          priority: t?.priority ?? 0,
          hintText: t?.nextHint?.text ?? '',
          hintAudio: t?.nextHint?.audioUrl ?? '',
          poly: t?.zone?.shape === 'polygon' ? t.zone.geometry : null,
        };
        if (!t) tState[p.id].enabled = true; // mặc định bật vùng kích hoạt cho mọi điểm
      }
      setTriggers(tState);
      setNavAudios(
        (cfg.navAudios || []).map((n) => ({
          key: `n${(keySeq.current += 1)}`,
          id: n.id,
          label: n.label || '',
          audioUrl: n.audioUrl || '',
          lat: n.zone?.shape === 'circle' ? String(n.zone.center.lat) : '',
          lng: n.zone?.shape === 'circle' ? String(n.zone.center.lng) : '',
          radius: n.zone?.shape === 'circle' ? n.zone.radiusMeters : DEFAULT_RADIUS,
          poly: n.zone?.shape === 'polygon' ? n.zone.geometry : null,
        })),
      );
    } catch (e) {
      setLoadError(e.message || 'Không tải được cấu hình route');
      setPlaces([]);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const placeById = useCallback((pid) => places?.find((p) => p.id === pid), [places]);
  const setTrig = (pid, patch) => setTriggers((s) => ({ ...s, [pid]: { ...s[pid], ...patch } }));
  const setNav = (key, patch) => setNavAudios((s) => s.map((n) => (n.key === key ? { ...n, ...patch } : n)));

  const generatePath = () => {
    const pts = (places || [])
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ lat: p.lat, lng: p.lng }));
    setPath(pts);
    setNotice('');
  };

  const addNav = () =>
    setNavAudios((s) => [
      ...s,
      { key: `n${(keySeq.current += 1)}`, label: '', audioUrl: '', lat: '', lng: '', radius: DEFAULT_RADIUS, poly: null },
    ]);
  const removeNav = (key) => setNavAudios((s) => s.filter((n) => n.key !== key));

  const onSimPick = (c) => {
    if (!picking) return;
    setNav(picking, { lat: c.lat.toFixed(6), lng: c.lng.toFixed(6) });
    setPicking(null);
  };

  // ---- Dựng cấu hình để lưu + để xem trước trên bản đồ ----
  function buildZoneForPlace(pid) {
    const t = triggers[pid];
    if (t?.poly) return { shape: 'polygon', geometry: t.poly };
    const p = placeById(pid);
    if (!p) return null;
    return { shape: 'circle', center: { lat: p.lat, lng: p.lng }, radiusMeters: Number(t.radius) || DEFAULT_RADIUS };
  }
  function buildNavZone(n) {
    if (n.poly) return { shape: 'polygon', geometry: n.poly };
    const lat = Number(n.lat);
    const lng = Number(n.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { shape: 'circle', center: { lat, lng }, radiusMeters: Number(n.radius) || DEFAULT_RADIUS };
  }

  const previewTriggers = (places || [])
    .filter((p) => triggers[p.id]?.enabled)
    .map((p) => ({ placeId: p.id, zone: buildZoneForPlace(p.id) }))
    .filter((t) => t.zone);
  const previewNav = navAudios.map((n, i) => ({ id: n.id || `nav${i}`, zone: buildNavZone(n) })).filter((n) => n.zone);
  const mapTour = { places: places || [], route: { path, triggers: previewTriggers, navAudios: previewNav } };

  function validateAndBuild() {
    for (const p of places || []) {
      const t = triggers[p.id];
      if (!t?.enabled) continue;
      if (!t.poly) {
        const r = Number(t.radius);
        if (!Number.isFinite(r) || r <= 0) return { error: `Bán kính vùng kích hoạt của “${p.name}” phải lớn hơn 0` };
      }
      const pr = Number(t.priority);
      if (!Number.isInteger(pr) || pr < 0 || pr > 1000) return { error: `Độ ưu tiên của “${p.name}” phải là số nguyên 0–1000` };
      if (t.hintAudio.trim() && !isHttpUrl(t.hintAudio.trim())) return { error: `URL audio gợi ý của “${p.name}” không hợp lệ` };
    }
    for (const n of navAudios) {
      const filled = n.label.trim() || n.audioUrl.trim() || n.lat || n.lng;
      if (!filled) continue;
      if (!n.label.trim()) return { error: 'Audio chỉ đường cần có nhãn' };
      if (!isHttpUrl(n.audioUrl.trim())) return { error: `Audio chỉ đường “${n.label}” cần URL hợp lệ` };
      if (!buildNavZone(n)) return { error: `Audio chỉ đường “${n.label}” cần chọn tâm vùng kích hoạt` };
    }

    const outTriggers = [];
    for (const p of places || []) {
      const t = triggers[p.id];
      if (!t?.enabled) continue;
      const zone = buildZoneForPlace(p.id);
      if (!zone) continue;
      const trig = { placeId: p.id, zone, priority: Number(t.priority) || 0 };
      const text = t.hintText.trim();
      const audio = t.hintAudio.trim();
      if (text || audio) trig.nextHint = { ...(text ? { text } : {}), ...(audio ? { audioUrl: audio } : {}) };
      outTriggers.push(trig);
    }
    const outNav = [];
    for (const n of navAudios) {
      if (!n.label.trim() || !n.audioUrl.trim()) continue;
      const zone = buildNavZone(n);
      if (!zone) continue;
      outNav.push({ ...(n.id ? { id: n.id } : {}), label: n.label.trim(), audioUrl: n.audioUrl.trim(), zone });
    }
    return { config: { path, triggers: outTriggers, navAudios: outNav } };
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
      setNotice('Đã lưu cấu hình route & vùng kích hoạt.');
    } catch (e) {
      setSaveError(e.message || 'Lưu cấu hình thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (places === null && !loadError) {
    return (
      <div className="screen studio">
        <StudioHeader title="Route & vùng kích hoạt" backTo={`/studio/tours/${id}`} />
        <main className="studio__main"><p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p></main>
      </div>
    );
  }

  return (
    <div className="screen studio">
      <StudioHeader title="Route & vùng kích hoạt" backTo={`/studio/tours/${id}`} subtitle="Lộ trình, vùng tự phát audio, audio chỉ đường" />

      <main className="studio__main">
        {loadError ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{loadError}</div>
          </div>
        ) : null}

        {(places || []).length === 0 ? (
          <div className="emptybox studio__empty">
            <Icon name="route" size={40} />
            <h2>Chưa có điểm dừng</h2>
            <p>Hãy thêm điểm dừng trước, rồi quay lại cấu hình route & vùng kích hoạt.</p>
            <Link to={`/studio/tours/${id}/places`} className="btn btn--primary"><Icon name="map-pin" size={18} /> Quản lý điểm dừng</Link>
          </div>
        ) : (
          <>
            <div className="studio-map">
              <TourMap
                tour={mapTour}
                simulate={!!picking}
                onSimPick={onSimPick}
              />
              {picking ? (
                <div className="studio-map__hint" role="status"><Icon name="crosshair" size={16} /> Chạm bản đồ để đặt tâm audio chỉ đường</div>
              ) : null}
            </div>

            {/* Lộ trình */}
            <section className="studio-section">
              <div className="studio-section__head">
                <h2 className="studio__h2"><Icon name="route" size={16} /> Lộ trình</h2>
                <span className="muted small">{path.length} điểm trên đường</span>
              </div>
              <p className="muted small">Lộ trình là đường nối các điểm hiển thị trên bản đồ (cần có để xem thử tour).</p>
              <div className="studio-section__actions">
                <button className="btn btn--ghost btn--sm" onClick={generatePath}><Icon name="route" size={16} /> Tạo theo thứ tự điểm dừng</button>
                {path.length ? <button className="btn btn--sm" onClick={() => setPath([])}><Icon name="x" size={16} /> Xoá lộ trình</button> : null}
              </div>
            </section>

            {/* Vùng kích hoạt từng điểm */}
            <section className="studio-section">
              <h2 className="studio__h2"><Icon name="map-pin" size={16} /> Vùng kích hoạt theo điểm</h2>
              <p className="muted small">Khi khách vào vùng của một điểm, audio điểm đó tự phát. Vùng tròn lấy tâm tại vị trí điểm.</p>
              <ul className="trigger-list">
                {places.map((p, i) => {
                  const t = triggers[p.id] || {};
                  return (
                    <li key={p.id} className={`trigger ${t.enabled ? '' : 'trigger--off'}`}>
                      <div className="trigger__head">
                        <label className="trigger__toggle">
                          <input type="checkbox" checked={!!t.enabled} onChange={(e) => setTrig(p.id, { enabled: e.target.checked })} />
                          <span className="trigger__name">{i + 1}. {p.name}</span>
                        </label>
                        {t.poly ? <span className="chip">Vùng đa giác</span> : null}
                      </div>
                      {t.enabled ? (
                        <div className="trigger__body">
                          {!t.poly ? (
                            <div className="field trigger__radius">
                              <label className="field__label small" htmlFor={`r-${p.id}`}>Bán kính (m): <b>{t.radius}</b></label>
                              <div className="trigger__radiusrow">
                                <input type="range" min="10" max="500" step="5" value={t.radius}
                                  onChange={(e) => setTrig(p.id, { radius: Number(e.target.value) })} aria-label={`Bán kính vùng ${p.name}`} />
                                <input id={`r-${p.id}`} className="input trigger__radiusnum" value={t.radius} inputMode="numeric"
                                  onChange={(e) => setTrig(p.id, { radius: e.target.value })} />
                              </div>
                            </div>
                          ) : (
                            <p className="muted small">Giữ nguyên vùng đa giác đã lưu. <button className="linkbtn" onClick={() => setTrig(p.id, { poly: null })}>Chuyển sang vùng tròn</button></p>
                          )}
                          <div className="field trigger__prio">
                            <label className="field__label small" htmlFor={`pr-${p.id}`}>Độ ưu tiên (khi chồng vùng)</label>
                            <input id={`pr-${p.id}`} className="input" value={t.priority} inputMode="numeric"
                              onChange={(e) => setTrig(p.id, { priority: e.target.value })} />
                          </div>
                          <details className="trigger__hint">
                            <summary>Gợi ý “đi tiếp” (tuỳ chọn)</summary>
                            <div className="field">
                              <label className="field__label small" htmlFor={`ht-${p.id}`}>Lời nhắc</label>
                              <input id={`ht-${p.id}`} className="input" value={t.hintText} maxLength={500}
                                onChange={(e) => setTrig(p.id, { hintText: e.target.value })} placeholder="Ví dụ: Rẽ trái đến điểm tiếp theo" />
                            </div>
                            <div className="field">
                              <label className="field__label small" htmlFor={`ha-${p.id}`}>Audio gợi ý (URL)</label>
                              <input id={`ha-${p.id}`} className="input" value={t.hintAudio}
                                onChange={(e) => setTrig(p.id, { hintAudio: e.target.value })} placeholder="https://… (tuỳ chọn)" />
                            </div>
                          </details>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Audio chỉ đường */}
            <section className="studio-section">
              <div className="studio-section__head">
                <h2 className="studio__h2"><Icon name="navigation" size={16} /> Audio chỉ đường</h2>
              </div>
              <p className="muted small">Audio phát tại ngã rẽ/đoạn nối, có vùng kích hoạt riêng. Tuỳ chọn.</p>
              {navAudios.map((n) => (
                <div key={n.key} className="navaudio">
                  <div className="field">
                    <label className="field__label small">Nhãn</label>
                    <input className="input" value={n.label} maxLength={200}
                      onChange={(e) => setNav(n.key, { label: e.target.value })} placeholder="Ví dụ: Ngã tư Trần Phú" />
                  </div>
                  <div className="field">
                    <label className="field__label small">Audio (URL)</label>
                    <input className="input" value={n.audioUrl}
                      onChange={(e) => setNav(n.key, { audioUrl: e.target.value })} placeholder="https://… (.mp3)" />
                  </div>
                  {!n.poly ? (
                    <div className="navaudio__zone">
                      <div className="studio-form__row">
                        <div className="field">
                          <label className="field__label small">Vĩ độ</label>
                          <input className="input" value={n.lat} inputMode="decimal" onChange={(e) => setNav(n.key, { lat: e.target.value })} />
                        </div>
                        <div className="field">
                          <label className="field__label small">Kinh độ</label>
                          <input className="input" value={n.lng} inputMode="decimal" onChange={(e) => setNav(n.key, { lng: e.target.value })} />
                        </div>
                      </div>
                      <div className="navaudio__zonerow">
                        <button type="button" className={`btn btn--ghost btn--sm ${picking === n.key ? 'is-active' : ''}`}
                          onClick={() => setPicking((k) => (k === n.key ? null : n.key))}>
                          <Icon name="crosshair" size={16} /> {picking === n.key ? 'Chạm bản đồ…' : 'Chọn tâm trên bản đồ'}
                        </button>
                        <label className="field__label small navaudio__radius">Bán kính (m)
                          <input className="input" value={n.radius} inputMode="numeric" onChange={(e) => setNav(n.key, { radius: e.target.value })} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <p className="muted small">Giữ nguyên vùng đa giác đã lưu. <button className="linkbtn" onClick={() => setNav(n.key, { poly: null })}>Chuyển sang vùng tròn</button></p>
                  )}
                  <button type="button" className="btn btn--sm btn--danger navaudio__del" onClick={() => removeNav(n.key)}>
                    <Icon name="trash" size={16} /> Xoá
                  </button>
                </div>
              ))}
              <button className="btn btn--ghost btn--sm" onClick={addNav}><Icon name="plus" size={16} /> Thêm audio chỉ đường</button>
            </section>

            {saveError ? (
              <div className="alert alert--warn" role="alert">
                <Icon name="alert-triangle" size={18} className="alert__icon" />
                <div>{saveError}</div>
              </div>
            ) : null}
            {notice ? (
              <div className="alert studio-notice" role="status">
                <Icon name="check-circle" size={18} className="alert__icon" />
                <div>{notice}</div>
              </div>
            ) : null}

            <div className="studio-form__actions studio-save">
              <Link className="btn" to={`/studio/tours/${id}`}>Xong</Link>
              <button className="btn btn--primary" onClick={onSave} disabled={busy}>
                {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="check-circle" size={18} />}
                Lưu cấu hình
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
