// =========================================================
// StudioHeader — tiêu đề màn khu Studio (UC09–UC13). Dùng AppHeader chung; tài
// khoản & giao diện sáng/tối đã chuyển vào tab Tài khoản.
// =========================================================
import AppHeader from '../../components/shell/AppHeader.jsx';

/**
 * @param {{ title?: string, backTo?: string, subtitle?: React.ReactNode }} props
 * Không có title → không hiện (màn tự có tiêu đề riêng).
 */
export default function StudioHeader({ title, backTo, subtitle }) {
  if (!title) return null;
  return <AppHeader title={title} backTo={backTo} subtitle={subtitle} />;
}

/** Chip trạng thái tour dùng chung (UC09 danh sách + trình chỉnh sửa). */
export function StatusChip({ meta }) {
  return <span className={`statuschip statuschip--${meta.tone}`}>{meta.label}</span>;
}
