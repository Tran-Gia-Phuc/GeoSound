// =========================================================
// ModePicker — chọn cách nghe, dùng chung cho chi tiết tour (UC02→UC04) và
// lịch trình (UC07→UC08):  [🎧 Nghe thử]  [➤ Bắt đầu đi tour]
//   - Nghe thử     → trình phát ?mode=remote (chọn điểm thủ công, không cần GPS)
//   - Bắt đầu đi   → lần đầu: giải thích vì sao cần vị trí rồi mới để trình duyệt
//                    hỏi quyền; đã bị chặn / không hỗ trợ → gợi ý Nghe thử.
//                    → trình phát ?mode=gps
// =========================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import Modal from '../../components/Modal.jsx';

const EXPLAINED_KEY = 'geosound:gps-explained';

function wasExplained() {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {{ to: (mode: 'gps'|'remote') => string, disabled?: boolean,
 *           remoteLabel?: string, gpsLabel?: string, className?: string }} props
 */
export default function ModePicker({ to, disabled, remoteLabel = 'Nghe thử', gpsLabel = 'Bắt đầu đi tour', className = '' }) {
  const navigate = useNavigate();
  const [explain, setExplain] = useState(false);
  const [permission, setPermission] = useState('prompt'); // prompt | granted | denied | unsupported

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermission('unsupported');
      return;
    }
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => setPermission(p.state))
      .catch(() => {});
  }, []);

  const go = (mode) => navigate(to(mode));

  const onGps = () => {
    if (permission === 'granted' || (permission === 'prompt' && wasExplained())) {
      go('gps');
      return;
    }
    setExplain(true);
  };

  const accept = () => {
    try {
      localStorage.setItem(EXPLAINED_KEY, '1');
    } catch {
      /* no-op */
    }
    setExplain(false);
    go('gps');
  };

  const blocked = permission === 'denied' || permission === 'unsupported';

  return (
    <>
      <div className={`modepicker ${className}`}>
        <button className="btn btn--lg modepicker__remote" onClick={() => go('remote')} disabled={disabled}>
          <Icon name="headphones" size={18} /> {remoteLabel}
        </button>
        <button className="btn btn--primary btn--lg modepicker__gps" onClick={onGps} disabled={disabled}>
          <Icon name="navigation" size={18} /> {gpsLabel}
        </button>
      </div>

      <Modal open={explain} onClose={() => setExplain(false)} title={blocked ? 'Chưa dùng được vị trí' : 'Nghe tự động theo vị trí'} labelledBy="gps-explain-title">
        <div className="gpsexplain">
          <span className="gpsexplain__icon"><Icon name={blocked ? 'alert-triangle' : 'crosshair'} size={28} /></span>
          {blocked ? (
            <p>
              {permission === 'unsupported'
                ? 'Thiết bị này không hỗ trợ định vị.'
                : 'Trình duyệt đang chặn quyền vị trí cho GeoSound. Bạn có thể bật lại trong cài đặt trang web,'}{' '}
              hoặc nghe thử từng điểm ngay bây giờ — không cần GPS.
            </p>
          ) : (
            <p>
              Khi bạn đi tới mỗi điểm dừng, GeoSound tự phát phần thuyết minh của điểm đó. Để làm vậy, ứng dụng cần
              biết vị trí của bạn. Vị trí chỉ dùng trên máy bạn, không lưu lại.
            </p>
          )}
          <div className="gpsexplain__actions">
            {blocked ? null : (
              <button className="btn btn--primary btn--lg btn--block" onClick={accept}>
                <Icon name="navigation" size={18} /> Cho phép &amp; bắt đầu
              </button>
            )}
            <button
              className={`btn btn--lg btn--block ${blocked ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setExplain(false);
                go('remote');
              }}
            >
              <Icon name="headphones" size={18} /> Nghe thử từng điểm
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
