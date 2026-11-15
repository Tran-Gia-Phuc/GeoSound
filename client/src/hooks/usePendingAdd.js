// "Thêm vào lịch trình" sống qua bước đăng nhập (UC07, quyết định D4):
// khách chưa đăng nhập bấm ＋ → /login?next=<màn hiện tại>?addPlace=<id>&addName=<tên>
// → đăng nhập xong quay lại màn đó → hook này trả về địa điểm đang chờ để màn tự
// mở lại sheet "Thêm vào…", rồi xoá tham số khỏi URL.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

/** URL quay lại sau khi đăng nhập, kèm địa điểm đang chờ thêm. */
export function nextWithPendingAdd(pathname, search, place) {
  const sp = new URLSearchParams(search);
  sp.set('addPlace', place.placeId);
  sp.set('addName', place.name);
  return `${pathname}?${sp.toString()}`;
}

/** @returns {[{ placeId: string, name: string } | null, () => void]} */
export function usePendingAdd() {
  const [sp, setSp] = useSearchParams();
  const { authenticated } = useAuth();
  const placeId = sp.get('addPlace');
  const name = sp.get('addName');

  const pending = useMemo(
    () => (authenticated && placeId ? { placeId, name: name || 'địa điểm' } : null),
    [authenticated, placeId, name],
  );

  const clear = useCallback(
    () =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('addPlace');
          n.delete('addName');
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );

  return [pending, clear];
}
