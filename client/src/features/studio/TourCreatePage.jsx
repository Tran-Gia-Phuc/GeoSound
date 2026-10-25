// =========================================================
// TourCreatePage (UC09 bước 4–8) — tạo tour mới (mặc định trạng thái "Nháp").
// Tạo xong chuyển tới trình chỉnh sửa để thêm điểm, route, ngôn ngữ…
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
      navigate(`/studio/tours/${tour.id}`, { replace: true });
    } catch (e) {
      setError(e.message || 'Không tạo được tour');
      setBusy(false);
    }
  }

  return (
    <div className="screen studio">
      <StudioHeader title="Tạo tour mới" backTo="/studio" subtitle="Đặt tên & ngôn ngữ gốc để bắt đầu" />
      <main className="studio__main studio__main--narrow">
        <TourForm
          submitLabel="Tạo tour"
          busy={busy}
          serverError={error}
          onSubmit={onSubmit}
          onCancel={() => navigate('/studio')}
        />
      </main>
    </div>
  );
}
