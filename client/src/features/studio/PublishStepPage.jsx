// =========================================================
// PublishStepPage — bước cuối của Studio: "Sẵn sàng xuất bản?" (UC09 A3 + UC13).
// Checklist + Xem thử như khách + Xuất bản / Gỡ xuống (PublishPanel).
// UC14: Truy cập hạn chế bằng mã (RestrictedAccessPanel).
// UC15: khi máy chủ bật kiểm duyệt, "Xuất bản" thành "Gửi duyệt" (AI rồi Admin duyệt).
// =========================================================
import PublishPanel from './PublishPanel.jsx';
import RestrictedAccessPanel from './RestrictedAccessPanel.jsx';
import { useStudioTour } from './StudioTourLayout.jsx';
import { isModerationMode } from '../../lib/submission.js';

export default function PublishStepPage() {
  const { tour, readiness, refresh, setTour } = useStudioTour();
  return (
    <div className="studio-step studio__main--narrow">
      <PublishPanel
        tour={tour}
        refreshKey={tour.updatedAt}
        onStatusChange={(t) => {
          setTour(t);
          refresh();
        }}
      />
      {isModerationMode(readiness) ? (
        <p className="muted small">
          Gửi duyệt: AI kiểm duyệt nội dung và vị trí, sau đó Admin phê duyệt thì tour mới hiện ở Khám phá. Sửa nội dung
          sau khi công khai sẽ đưa tour về Nháp — bạn cần gửi duyệt lại.
        </p>
      ) : (
        <p className="muted small">
          Xuất bản xong, khách tìm thấy tour ở Khám phá và nghe ngay. Sửa nội dung sau khi xuất bản sẽ đưa tour về Nháp —
          bạn chỉ cần xuất bản lại.
        </p>
      )}
      <RestrictedAccessPanel
        tourId={tour.id}
        status={tour.status}
        onChanged={(t) => {
          if (t) setTour(t);
          refresh();
        }}
      />
    </div>
  );
}
