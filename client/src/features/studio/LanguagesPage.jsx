// =========================================================
// LanguagesPage (UC12) — đa ngôn ngữ & giọng đọc TTS cho tour.
//   - Chọn ngôn ngữ phụ + giọng TTS → Lưu (tự dịch text gốc + render TTS,
//     GIỮ bản dịch đã chỉnh tay). Gỡ ngôn ngữ sẽ xoá bản dịch của nó.
//   - Theo từng điểm: xem/sửa bản dịch (A2, text gốc sửa ở UC10), nghe thử TTS (A1).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader from './StudioHeader.jsx';
import { langLabel } from '../../lib/format.js';
import { LANGUAGE_OPTIONS } from '../../lib/tours.js';
import {
  TTS_GENDER_OPTIONS, TEXT_SOURCE_LABELS,
  getLanguageConfig, setTourLanguages, previewTts, updateTranslation,
} from '../../lib/studio.js';

// Nghe thử: audio thật nếu là http(s); nếu là placeholder tts:// hoặc lỗi thì
// đọc text bằng Web Speech (khớp adapter TTS giả ở dev).
function playPreview(url, text, lang) {
  if (url && /^https?:/i.test(url)) {
    try {
      new Audio(url).play();
      return;
    } catch {
      /* rơi xuống Web Speech */
    }
  }
  if (text && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

export default function LanguagesPage() {
  const { id } = useParams();
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
      setNotice('Đã lưu ngôn ngữ & giọng đọc — đã dịch và tạo giọng đọc cho các điểm.');
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
    } catch (e) {
      setRowError((s) => ({ ...s, [key]: e.message || 'Lưu bản dịch thất bại' }));
    } finally {
      setRowBusy((s) => ({ ...s, [key]: undefined }));
    }
  }

  async function onPreview(placeId, lang) {
    const key = `${placeId}:${lang}`;
    setRowBusy((s) => ({ ...s, [key]: 'preview' }));
    setRowError((s) => ({ ...s, [key]: '' }));
    try {
      const res = await previewTts(id, placeId, lang);
      playPreview(res.url, drafts[key], lang);
    } catch (e) {
      setRowError((s) => ({ ...s, [key]: e.message || 'Không tạo được bản nghe thử' }));
    } finally {
      setRowBusy((s) => ({ ...s, [key]: undefined }));
    }
  }

  if (loadError && !config) {
    return (
      <div className="screen studio">
        <StudioHeader title="Ngôn ngữ & giọng đọc" backTo={`/studio/tours/${id}`} />
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
      <div className="screen studio">
        <StudioHeader title="Ngôn ngữ & giọng đọc" backTo={`/studio/tours/${id}`} />
        <main className="studio__main"><p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p></main>
      </div>
    );
  }

  const source = config.sourceLanguage;
  const secondaryOptions = LANGUAGE_OPTIONS.filter((o) => o.value !== source);
  const hasTranslations = config.places.some((p) => p.translations.length > 0);

  return (
    <div className="screen studio">
      <StudioHeader title="Ngôn ngữ & giọng đọc" backTo={`/studio/tours/${id}`} subtitle="Ngôn ngữ phụ, giọng TTS, bản dịch từng điểm" />

      <main className="studio__main">
        {/* Cấu hình ngôn ngữ + giọng */}
        <section className="studio-section">
          <h2 className="studio__h2"><Icon name="languages" size={16} /> Ngôn ngữ & giọng đọc</h2>
          <p className="muted small">
            Ngôn ngữ gốc: <b>{langLabel(source)}</b>. Chọn thêm ngôn ngữ phụ để hệ thống tự dịch &amp; tạo giọng đọc TTS.
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
              <label className="field__label" htmlFor="lp-region">Vùng miền (tuỳ chọn)</label>
              <input id="lp-region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}
                maxLength={50} placeholder="Ví dụ: miền Bắc" />
            </div>
          </div>

          <p className="muted small">Lưu sẽ dịch lại các bản <i>tự động</i> và tạo giọng đọc — bản bạn đã chỉnh tay được giữ nguyên.</p>
          {saveError ? (
            <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={18} className="alert__icon" /><div>{saveError}</div></div>
          ) : null}
          <div className="studio-form__actions">
            <button className="btn btn--primary" onClick={onSaveLanguages} disabled={saving}>
              {saving ? <Icon name="loader" size={18} className="spin" /> : <Icon name="check-circle" size={18} />}
              {saving ? 'Đang dịch & tạo giọng đọc…' : 'Lưu & tạo bản dịch'}
            </button>
          </div>
        </section>

        {notice ? (
          <div className="alert studio-notice" role="status"><Icon name="check-circle" size={18} className="alert__icon" /><div>{notice}</div></div>
        ) : null}

        {/* Bản dịch theo điểm */}
        <section className="studio-section">
          <h2 className="studio__h2"><Icon name="list" size={16} /> Bản dịch theo điểm</h2>
          {config.places.length === 0 ? (
            <p className="muted small">Tour chưa có điểm dừng. <Link className="linkbtn" to={`/studio/tours/${id}/places`}>Thêm điểm dừng</Link> trước.</p>
          ) : !hasTranslations ? (
            <p className="muted small">Lưu cấu hình ngôn ngữ ở trên để tạo bản dịch cho từng điểm.</p>
          ) : (
            <ul className="tx-list">
              {config.places.map((p) => (
                <li key={p.placeId} className="tx-place">
                  <h3 className="tx-place__name">{p.name}</h3>
                  {config.languages.map((l) => {
                    const key = `${p.placeId}:${l.languageCode}`;
                    const tx = p.translations.find((t) => t.languageCode === l.languageCode);
                    if (!tx) return null;
                    const isSource = l.isSource;
                    return (
                      <div key={l.languageCode} className="tx-row">
                        <div className="tx-row__head">
                          <span className="tx-row__lang">{langLabel(l.languageCode)}</span>
                          <span className="chip">{TEXT_SOURCE_LABELS[tx.textSource] || tx.textSource}</span>
                        </div>
                        <textarea
                          className="input studio-form__textarea tx-row__text"
                          value={drafts[key] ?? tx.text}
                          readOnly={isSource}
                          rows={3}
                          maxLength={5000}
                          onChange={(e) => setDrafts((s) => ({ ...s, [key]: e.target.value }))}
                          aria-label={`Bản dịch ${langLabel(l.languageCode)} của ${p.name}`}
                        />
                        {rowError[key] ? <span className="field__err">{rowError[key]}</span> : null}
                        <div className="tx-row__actions">
                          <button className="btn btn--ghost btn--sm" onClick={() => onPreview(p.placeId, l.languageCode)} disabled={!!rowBusy[key]}>
                            {rowBusy[key] === 'preview' ? <Icon name="loader" size={16} className="spin" /> : <Icon name="volume" size={16} />} Nghe thử
                          </button>
                          {isSource ? (
                            <span className="muted small">Sửa nội dung gốc ở <Link className="linkbtn" to={`/studio/tours/${id}/places`}>Quản lý điểm</Link></span>
                          ) : (
                            <button className="btn btn--primary btn--sm" onClick={() => onSaveTranslation(p.placeId, l.languageCode)} disabled={!!rowBusy[key]}>
                              {rowBusy[key] === 'save' ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check-circle" size={16} />} Lưu bản dịch
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="muted small"><Link className="linkbtn" to={`/studio/tours/${id}`}>← Về trình chỉnh sửa tour</Link></p>
      </main>
    </div>
  );
}
