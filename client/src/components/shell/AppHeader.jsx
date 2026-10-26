// =========================================================
// AppHeader — tiêu đề màn dùng chung: [← quay lại] Tiêu đề [1 hành động phải].
// Quay lại theo lịch sử trong app; mở thẳng bằng link (không có lịch sử) thì về
// `backTo` thay vì thoát khỏi app.
// =========================================================
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon.jsx';

/** navigate(-1) nếu có trang trước trong app, không thì về fallback. */
export function useBack(fallback = '/') {
  const navigate = useNavigate();
  return useCallback(() => {
    // React Router lưu chỉ số lịch sử ở history.state.idx (0 = trang đầu tiên).
    const idx = window.history.state?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}

/**
 * @param {{ title: React.ReactNode, subtitle?: React.ReactNode, backTo?: string,
 *           action?: React.ReactNode, large?: boolean }} props
 * backTo: có thì hiện nút quay lại (fallback khi không có lịch sử).
 * large : tiêu đề lớn cho màn gốc của một tab (không có nút quay lại).
 */
export default function AppHeader({ title, subtitle, backTo, action, large = false }) {
  const back = useBack(backTo ?? '/');
  return (
    <header className={`appheader ${large ? 'appheader--large' : ''}`}>
      {backTo !== undefined ? (
        <button className="iconbtn appheader__back" onClick={back} aria-label="Quay lại">
          <Icon name="arrow-left" size={20} />
        </button>
      ) : null}
      <div className="appheader__titles">
        <h1 className="appheader__title">{title}</h1>
        {subtitle ? <p className="appheader__subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="appheader__action">{action}</div> : null}
    </header>
  );
}
