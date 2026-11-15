// =========================================================
// useGeolocation — theo dõi GPS thực (UC04 bước 2,5; E1, E2).
// Chỉ bắt đầu watch sau cử chỉ người dùng (nút "Bắt đầu tour") để thỏa
// chính sách quyền của trình duyệt. Báo trạng thái quyền + độ chính xác.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const LOW_ACCURACY_M = 50; // > ngưỡng này -> cảnh báo GPS yếu (E2)

export function useGeolocation() {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [permission, setPermission] = useState(supported ? 'prompt' : 'unsupported');
  const [position, setPosition] = useState(null); // {lat,lng,accuracy,heading,speed,ts}
  const [error, setError] = useState(null);
  const watchId = useRef(null);

  // Theo dõi thay đổi quyền (nếu Permissions API khả dụng).
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let status;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setPermission('unsupported');
      return;
    }
    setError(null);
    stop();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPermission('granted');
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        setPosition({
          lat: latitude,
          lng: longitude,
          accuracy,
          heading: Number.isFinite(heading) ? heading : null,
          speed: Number.isFinite(speed) ? speed : null,
          ts: pos.timestamp,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setPermission('denied'); // E1
          setError({ code: 'denied', message: 'Bạn đã từ chối quyền vị trí' });
        } else {
          // POSITION_UNAVAILABLE / TIMEOUT -> GPS yếu (E2)
          setError({ code: 'unavailable', message: 'Không lấy được vị trí GPS' });
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }, [supported, stop]);

  useEffect(() => stop, [stop]);

  const lowAccuracy = !!position && Number.isFinite(position.accuracy) && position.accuracy > LOW_ACCURACY_M;

  return { supported, permission, position, error, lowAccuracy, start, stop };
}
