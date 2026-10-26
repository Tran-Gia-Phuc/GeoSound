// =========================================================
// TourCreatePage (UC09 bước 4–8) — tạo tour mới (mặc định trạng thái "Nháp").
// Chỉ hỏi tên + ngôn ngữ gốc + thành phố, tạo xong vào thẳng bước Điểm dừng.
// =========================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StudioHeader from './StudioHeader.jsx';
import TourForm from './TourForm.jsx';
import { createTour } from '../../lib/studio.js';

export default function TourCreatePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(values) {
    setBusy(true);
    setError('');
    try {
      const tour = await createTour(values);
      navigate(`/studio/tours/${tour.id}/places`, { replace: true });
    } catch (e) {
      setError(e.message || 'Không tạo được tour');
      setBusy(false);
    }
  }

  return (
    <div className="screen studio">
      <StudioHeader title="Tạo tour mới" backTo="/studio" subtitle="Bắt đầu bằng tên — chi tiết bổ sung sau" />
      <main className="studio__main studio__main--narrow">
        <TourForm
          compact
          submitLabel="Tạo & thêm điểm dừng"
          busy={busy}
          serverError={error}
          onSubmit={onSubmit}
          onCancel={() => navigate('/studio')}
        />
      </main>
    </div>
  );
}
