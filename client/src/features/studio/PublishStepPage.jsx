// =========================================================
// PublishStepPage — bước cuối của Studio: "Sẵn sàng xuất bản?" (UC09 A3 + UC13).
// Checklist + Xem thử như khách + Xuất bản / Gỡ xuống (PublishPanel).
// =========================================================
import PublishPanel from './PublishPanel.jsx';
import { useStudioTour } from './StudioTourLayout.jsx';

export default function PublishStepPage() {
  const { tour, refresh, setTour } = useStudioTour();
  return (
    <div className="studio-step studio__main--narrow">
      <PublishPanel
        tourId={tour.id}
        status={tour.status}
        refreshKey={tour.updatedAt}
        onStatusChange={(t) => {
          setTour(t);
          refresh();
        }}
      />
      <p className="muted small">
        Xuất bản xong, khách tìm thấy tour ở Khám phá và nghe ngay. Sửa nội dung sau khi xuất bản sẽ đưa tour về Nháp —
        bạn chỉ cần xuất bản lại.
      </p>
    </div>
  );
}
