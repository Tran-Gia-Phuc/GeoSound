// =========================================================
// LanguagesPage (UC12) — đa ngôn ngữ & giọng đọc TTS cho tour.
//   - Chọn ngôn ngữ phụ + giọng TTS → Lưu (tự dịch text gốc + render TTS,
//     GIỮ bản dịch đã chỉnh tay). Gỡ ngôn ngữ sẽ xoá bản dịch của nó.
//   - Bản dịch chia TAB theo ngôn ngữ phụ ("4/4 điểm đã dịch"); mỗi điểm một dòng:
//     bản gốc (thu gọn) ↔ bản dịch, trạng thái Máy dịch / Đã sửa / Chưa dịch,
//     nghe thử (A1), lưu khi có sửa (A2; text gốc sửa ở bước Điểm dừng).
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLanguagePreview, audioReadiness } from './language-preview.js';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { langLabel } from '../../lib/format.js';
import { LANGUAGE_OPTIONS } from '../../lib/tours.js';
import {
  TTS_GENDER_OPTIONS,
  getLanguageConfig, setTourLanguages, previewTts, updateTranslation,
} from '../../lib/studio.js';

export default function LanguagesPage() {
  const { id } = useParams();
  const player=useRef(null);
  if(!player.current)player.current=createLanguagePreview();
  const previewGeneration=useRef(0);
  useEffect(()=>()=>{previewGeneration.current += 1;player.current.cancel();},[]);
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [secondary, setSecondary] = useState([]);
  const [gender, setGender] = useState('female');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState({}); // `${placeId}:${lang}` -> text
  const [rowBusy, setRowBusy] = useState({}); // `${placeId}:${lang}` -> 'save' | 'preview'
  const [rowError, setRowError] = useState({});
  const [txTab, setTxTab] = useState(null); // ngôn ngữ đang xem bản dịch

  const hydrate = useCallback((cfg) => {
    setConfig(cfg);
    setSecondary(cfg.languages.filter((l) => !l.isSource).map((l) => l.languageCode));
    const v = cfg.voice;
    if (v) {
      setGender(v.gender || 'female');
      setRegion(v.region || '');
    }
    const d = {};
    for (const p of cfg.places) for (const t of p.translations) d[`${p.placeId}:${t.languageCode}`] = t.text;
    setDrafts(d);
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      hydrate(await getLanguageConfig(id));
    } catch (e) {
      setLoadError(e.message || 'Không tải được cấu hình ngôn ngữ');
    }
  }, [id, hydrate]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleLang = (code) =>
    setSecondary((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  async function onSaveLanguages() {
    setSaving(true);
    setSaveError('');
    setNotice('');
    try {
      const cfg = await setTourLanguages(id, {
        secondary,
        voice: { gender, ...(region.trim() ? { region: region.trim() } : {}) },
      });
      hydrate(cfg);
      setNotice('Đã lưu cấu hình ngôn ngữ. Tiến độ bản dịch và tệp âm thanh hiển thị theo dữ liệu đã lưu.');
    } catch (e) {
      setSaveError(e.message || 'Lưu cấu hình ngôn ngữ thất bại');
    } finally {
      setSaving(false);
    }
  }

  async function onSaveTranslation(placeId, lang) {
    const key = `${placeId}:${lang}`;
    const text = (drafts[key] || '').trim();
    if (!text) {
      setRowError((s) => ({ ...s, [key]: 'Bản dịch không được rỗng' }));
      return;
    }
    setRowBusy((s) => ({ ...s, [key]: 'save' }));
    setRowError((s) => ({ ...s, [key]: '' }));
    try {
      const tx = await updateTranslation(id, placeId, lang, text);
      setConfig((c) => ({
        ...c,
        places: c.places.map((p) =>
          p.placeId !== placeId
            ? p
            : { ...p, translations: p.translations.map((t) => (t.languageCode === lang ? tx : t)) },
        ),
      }));
      setNotice('Đã lưu bản dịch.');
      // Cập nhật tiến độ dịch của từng ngôn ngữ (khách chỉ thấy ngôn ngữ đã dịch xong).
      getLanguageConfig(id)
        .then((cfg) => setConfig((c) => ({ ...c, languages: cfg.languages })))
        .catch(() => {});
    } catch (e) {
      setRowError((s) => ({ ...s, [key]: e.message || 'Lưu bản dịch thất bại' }));
    } finally {
      setRowBusy((s) => ({ ...s, [key]: undefined }));
    }
  }

  async function onPreview(placeId, lang) {
    const key = `${placeId}:${lang}`;
    const generation=++previewGeneration.current;
    player.current.cancel();
    setRowBusy((s) => ({ ...s, [key]: 'preview' }));
    setRowError((s) => ({ ...s, [key]: '' }));
    try {
      const res = await previewTts(id, placeId, lang);
      if(generation !== previewGeneration.current)return;
      const saved = config.places.find((item)=>item.placeId === placeId)?.translations.find((t)=>t.languageCode === lang);
      player.current.play({url:res.url,text:saved?.text,lang,onError:(message)=>{if(generation === previewGeneration.current)setRowError((current)=>({...current,[key]:message}));}});
      setNotice(res.prerendered && /^https?:/i.test(res.url || '') ? 'Đang nghe tệp âm thanh đã tạo.' : 'Bản nghe thử không xác nhận tour đã sẵn sàng offline. Giọng trên thiết bị có thể khác cấu hình nam/nữ và vùng miền.');
    } catch (e) {
      if(generation === previewGeneration.current)setRowError((s) => ({ ...s, [key]: e.message || 'Không tạo được bản nghe thử' }));
    } finally {
      setRowBusy((s) => ({ ...s, [key]: undefined }));
    }
  }

  if (loadError && !config) {
    return (
      <div className="studio-step">
        <main className="studio__main">
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{loadError}</div>
          </div>
          <Link to={`/studio/tours/${id}`} className="btn">Về trình chỉnh sửa tour</Link>
        </main>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="studio-step">
        <main className="studio__main"><p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p></main>
      </div>
    );
  }

  const source = config.sourceLanguage;
  const secondaryOptions = LANGUAGE_OPTIONS.filter((o) => o.value !== source);
  const hasTranslations = config.places.some((p) => p.translations.length > 0);
  const secLangs = config.languages.filter((l) => !l.isSource);
  const activeLang = secLangs.some((l) => l.languageCode === txTab) ? txTab : secLangs[0]?.languageCode;
  const activeMeta = secLangs.find((l) => l.languageCode === activeLang);

  return (
    <div className="studio-step">

      <main className="studio__main">
        {/* Cấu hình ngôn ngữ + giọng */}
        <section className="studio-section">
          <h2 className="studio__h2"><Icon name="languages" size={16} /> Ngôn ngữ & giọng đọc</h2>
          <p className="muted small">
            Ngôn ngữ gốc: <b>{langLabel(source)}</b>. Thêm ngôn ngữ phụ để dịch nội dung và nghe thử.
          </p>

          <div className="field">
            <span className="field__label">Ngôn ngữ phụ</span>
            <div className="lang-chips">
              {secondaryOptions.map((o) => {
                const on = secondary.includes(o.value);
                return (
                  <button key={o.value} type="button" className={`chip lang-chip ${on ? 'lang-chip--on' : ''}`}
                    aria-pressed={on} onClick={() => toggleLang(o.value)}>
                    {on ? <Icon name="check-circle" size={14} /> : <Icon name="plus" size={14} />} {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="studio-form__row">
            <div className="field">
              <span className="field__label">Giọng đọc</span>
              <div className="lang-chips">
                {TTS_GENDER_OPTIONS.map((o) => (
                  <button key={o.value} type="button" className={`chip lang-chip ${gender === o.value ? 'lang-chip--on' : ''}`}
                    aria-pressed={gender === o.value} onClick={() => setGender(o.value)}>
                    <Icon name="volume" size={14} /> {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="lp-region">Giọng vùng miền</label>
              <select id="lp-region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Mặc định</option>
                {['Miền Bắc', 'Miền Trung', 'Miền Nam', ...(region && !['Miền Bắc', 'Miền Trung', 'Miền Nam'].includes(region) ? [region] : [])].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {config.languages.some((l) => !l.isSource) ? (
            <ul className="lang-status" aria-label="Tình trạng bản dịch">
              {config.languages.filter((l) => !l.isSource).map((l) => (
                <li key={l.languageCode} className={`lang-status__item ${l.ready ? 'is-ready' : 'is-pending'}`}>
                  <Icon name={l.ready ? 'check-circle' : 'info'} size={16} />
                  <b>{langLabel(l.languageCode)}</b>
                  <span className="muted small">
                    {l.ready
                      ? `Đã dịch ${l.translated}/${l.total} điểm — khách chọn được ngôn ngữ này`
                      : `Mới dịch ${l.translated}/${l.total} điểm — khách chưa thấy ngôn ngữ này. Sửa bản dịch bên dưới hoặc lưu lại để dịch tự động.`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="muted small">Lưu sẽ dịch các điểm mới hoặc vừa sửa mô tả. Bản bạn đã chỉnh tay được giữ nguyên. Tệp âm thanh được xác nhận riêng theo từng bản dịch.</p>
          {saveError ? (
            <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={18} className="alert__icon" /><div>{saveError}</div></div>
          ) : null}
          <div className="studio-form__actions">
            <button className="btn btn--primary" onClick={onSaveLanguages} disabled={saving}>
              {saving ? <Icon name="loader" size={18} className="spin" /> : <Icon name="check-circle" size={18} />}
              {saving ? 'Đang lưu & dịch…' : 'Lưu & tạo bản dịch'}
            </button>
          </div>
        </section>

        {notice ? (
          <div className="alert studio-notice" role="status"><Icon name="check-circle" size={18} className="alert__icon" /><div>{notice}</div></div>
        ) : null}

        {/* Bản dịch — mỗi ngôn ngữ phụ một tab */}
        <section className="studio-section">
          <h2 className="studio__h2"><Icon name="list" size={16} /> Bản dịch</h2>
          {config.places.length === 0 ? (
            <p className="muted small">Tour chưa có điểm dừng. <Link className="linkbtn" to={`/studio/tours/${id}/places`}>Thêm điểm dừng</Link> trước.</p>
          ) : !secLangs.length || !hasTranslations ? (
            <p className="muted small">Chọn ngôn ngữ phụ ở trên rồi bấm “Lưu &amp; tạo bản dịch” để có bản dịch từng điểm.</p>
          ) : (
            <>
              <div className="txtabs" role="tablist" aria-label="Ngôn ngữ bản dịch">
                {secLangs.map((l) => {
                  const on = l.languageCode === activeLang;
                  return (
                    <button
                      key={l.languageCode}
                      role="tab"
                      id={`txtab-${l.languageCode}`}
                      aria-selected={on}
                      aria-controls="txpanel"
                      className={`txtabs__tab ${on ? 'is-active' : ''}`}
                      onClick={() => setTxTab(l.languageCode)}
                    >
                      {langLabel(l.languageCode)}
                      <span className={`txtabs__count ${l.ready ? 'is-ready' : ''}`}>{l.translated}/{l.total}</span>
                    </button>
                  );
                })}
              </div>

              <div role="tabpanel" id="txpanel" aria-labelledby={`txtab-${activeLang}`}>
                <p className="muted small txpanel__status">
                  {activeMeta?.ready
                    ? `Đã dịch đủ ${activeMeta.total}/${activeMeta.total} điểm — khách chọn được ${langLabel(activeLang)}.`
                    : `Mới dịch ${activeMeta?.translated ?? 0}/${activeMeta?.total ?? 0} điểm — khách chưa thấy ${langLabel(activeLang)} cho tới khi đủ.`}
                </p>
                <ul className="tx-list">
                  {config.places.map((p, i) => {
                    const key = `${p.placeId}:${activeLang}`;
                    const src = p.translations.find((t) => t.languageCode === source);
                    const tx = p.translations.find((t) => t.languageCode === activeLang);
                    const draft = drafts[key] ?? tx?.text ?? '';
                    const real = tx && (tx.textSource === 'edited' || tx.text.trim() !== (src?.text ?? '').trim());
                    const status = !tx || !real ? { label: 'Chưa dịch', tone: 'warn' } : tx.textSource === 'edited' ? { label: 'Đã sửa', tone: 'ok' } : { label: 'Máy dịch', tone: '' };
                    const changed = !!tx && draft.trim() !== tx.text.trim();
                    return (
                      <li key={p.placeId} className="tx-row">
                        <div className="tx-row__head">
                          <span className="stop__seq">{i + 1}</span>
                          <span className="tx-row__lang">{p.name}</span>
                          <span className={`chip ${status.tone === 'ok' ? 'chip--ok' : status.tone === 'warn' ? 'chip--warn' : ''}`}>{status.label}</span>
                        </div>
                        {src?.text ? (
                          <details className="tx-row__src">
                            <summary>Bản gốc ({langLabel(source)})</summary>
                            <p>{src.text}</p>
                          </details>
                        ) : null}
                        {tx ? (
                          <>
                            <textarea
                              className="input studio-form__textarea tx-row__text"
                              value={draft}
                              rows={3}
                              maxLength={5000}
                              onChange={(e) => setDrafts((st) => ({ ...st, [key]: e.target.value }))}
                              aria-label={`Bản dịch ${langLabel(activeLang)} của ${p.name}`}
                            />
                            {changed ? <p className="muted small">Lưu bản dịch để nghe thử nội dung vừa sửa.</p> : null}
                            {rowError[key] ? <span className="field__err">{rowError[key]}</span> : null}
                            <p className="muted small">{audioReadiness(tx)}</p>
                            <div className="tx-row__actions">
                              <button className="btn btn--ghost btn--sm" onClick={() => onPreview(p.placeId, activeLang)} disabled={!!rowBusy[key] || changed} title={changed ? 'Lưu bản dịch trước khi nghe bản đã lưu' : undefined}>
                                {rowBusy[key] === 'preview' ? <Icon name="loader" size={16} className="spin" /> : <Icon name="volume" size={16} />} Nghe thử
                              </button>
                              {changed ? (
                                <button className="btn btn--primary btn--sm" onClick={() => onSaveTranslation(p.placeId, activeLang)} disabled={!!rowBusy[key]}>
                                  {rowBusy[key] === 'save' ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check-circle" size={16} />} Lưu bản dịch
                                </button>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <p className="muted small">Chưa có bản dịch — bấm “Lưu &amp; tạo bản dịch” ở trên.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </section>

        <div className="studio-nextstep">
          <span className="muted small">Ngôn ngữ phụ là tuỳ chọn — có thể xuất bản chỉ với ngôn ngữ gốc.</span>
          <Link className="btn btn--primary" to={`/studio/tours/${id}/publish`}>
            Tiếp: Xuất bản <Icon name="chevron-left" size={16} className="flip" />
          </Link>
        </div>
      </main>
    </div>
  );
}
