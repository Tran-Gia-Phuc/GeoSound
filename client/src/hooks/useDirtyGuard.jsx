// =========================================================
// useDirtyGuard — chống mất dữ liệu khi rời form chưa lưu:
//   - chuyển màn trong app (link, nút quay lại, tab) → hỏi bằng ConfirmDialog
//   - đóng tab / tải lại trang → hộp thoại "beforeunload" của trình duyệt
// Trả về phần tử hộp thoại để màn gắn vào JSX:
//   const guard = useDirtyGuard(dirty && !busy);  …  {guard}
// Cần data router (createBrowserRouter) để useBlocker hoạt động.
// =========================================================
import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export function useDirtyGuard(when, message = 'Các thay đổi chưa lưu sẽ mất nếu bạn rời khỏi đây.') {
  // Chỉ chặn khi rời sang màn KHÁC (đổi query ?… trên cùng màn thì không).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!when) return undefined;
    const onUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Rời đi mà không lưu?"
      message={message}
      confirmLabel="Rời đi"
      cancelLabel="Ở lại"
      danger
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  );
}
