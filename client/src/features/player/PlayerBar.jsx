// =========================================================
// PlayerBar — trình điều khiển phát (UC04 bước 12): phát/tạm dừng, tua ±10s,
// điểm trước/sau. Hiển thị "đang nghe gì" + nhãn nguồn (người thật / TTS / chỉ đường).
// Audio TTS không tua được -> thanh tiến độ chạy ước lượng, ẩn nút tua.
// =========================================================
import Icon from '../../components/Icon.jsx';
import { formatTime } from '../../lib/format.js';
import './player-transport-a.css';

const ROLE_LABEL = { place: 'Đang nghe', hint: 'Gợi ý đi tiếp', nav: 'Chỉ đường' };

export default function PlayerBar({ audio, engine, hideTitle = false }) {
  const { state, toggle, seek } = audio;
  const { currentPlace, currentRole, prev, next, canPrev, canNext } = engine;

  const playing = state.status === 'playing';
  const loading = state.status === 'loading';
  const hasTrack = !!state.trackId || !!currentPlace;
  const title = state.title || currentPlace?.name || 'Chưa phát điểm nào';
  const roleLabel = ROLE_LABEL[currentRole] || 'Trình phát';

  const dur = state.duration || 0;
  const cur = Math.min(state.currentTime || 0, dur || Infinity);
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

  return (
    <section className="player" aria-label="Trình phát audio">
      <div className="player__meta">
        <span className={`chip ${currentRole ? 'chip--live' : ''}`}>
          {currentRole === 'nav' ? <Icon name="navigation" size={13} /> : <Icon name="headphones" size={13} />}
          {roleLabel}
        </span>
        {state.usingTts ? (
          <span className="chip" title={state.fellBack ? 'File audio lỗi — đang đọc bằng giọng máy' : 'Giọng đọc máy'}>
            Giọng máy{state.fellBack ? ' (dự phòng)' : ''}
          </span>
        ) : null}
        {state.status === 'error' ? (
          <span className="chip" style={{ color: 'var(--danger)' }}>
            <Icon name="alert-triangle" size={13} /> Không phát được — xem văn bản bên dưới
          </span>
        ) : null}
      </div>

      {hideTitle ? null : (
        <div className="player__title" title={title}>
          {title}
        </div>
      )}

      {state.status === 'error' ? <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={20} /><div><b>Không thể phát âm thanh</b><p>Bạn vẫn có thể đọc nội dung và xem ảnh của điểm dừng.</p><button className="btn btn--primary btn--sm" onClick={audio.retry}>Thử lại âm thanh</button></div></div> : null}
      {/* Thanh tiến độ */}
      {state.canSeek ? (
        <div className="scrub">
          <span className="scrub__t">{formatTime(cur)}</span>
          <input
            className="scrub__range"
            type="range"
            min={0}
            max={dur || 0}
            step={0.1}
            value={cur}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Tua audio"
            style={{ '--pct': `${pct}%` }}
          />
          <span className="scrub__t">{formatTime(dur)}</span>
        </div>
      ) : (
        <div className={`scrub scrub--indet ${playing ? 'is-playing' : ''}`} aria-hidden="true">
          <span className="scrub__t">--:--</span>
          <div className="scrub__track">
            <div className="scrub__bar" />
          </div>
          <span className="scrub__t">{playing ? '•••' : ''}</span>
        </div>
      )}

      {/* Nút điều khiển */}
      <div className="player__controls">
        <button className="iconbtn player-transport-a" onClick={prev} disabled={!canPrev} aria-label="Điểm trước">
          <Icon name="skip-back" size={20} /><span>Điểm trước</span>
        </button>
        <button
          className="iconbtn player-transport-a"
          onClick={() => seek((state.currentTime || 0) - 15)}
          disabled={!state.canSeek}
          aria-label="Tua lùi 15 giây"
        >
          <Icon name="rewind" size={20} /><span>Lùi 15s</span>
        </button>

        <button
          className="player__play"
          onClick={toggle}
          disabled={!hasTrack || loading || state.status === 'error'}
          aria-busy={loading}
          aria-label={playing ? 'Tạm dừng' : 'Phát'}
        >
          {loading ? (
            <Icon name="loader" size={26} className="spin" />
          ) : playing ? (
            <Icon name="pause" size={26} />
          ) : (
            <Icon name="play" size={26} />
          )}
        </button>

        <button
          className="iconbtn player-transport-a"
          onClick={() => seek((state.currentTime || 0) + 15)}
          disabled={!state.canSeek}
          aria-label="Tua tới 15 giây"
        >
          <Icon name="forward" size={20} /><span>Tiến 15s</span>
        </button>
        <button className="iconbtn player-transport-a" onClick={next} disabled={!canNext} aria-label="Điểm kế tiếp">
          <Icon name="skip-forward" size={20} /><span>Điểm sau</span>
        </button>
      </div>
    </section>
  );
}
