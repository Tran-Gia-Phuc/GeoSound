// =========================================================
// TourCreatePage (UC09 bước 4–8) — tạo tour mới (mặc định trạng thái "Nháp").
// Chỉ hỏi tên + ngôn ngữ gốc + thành phố, tạo xong vào thẳng bước Điểm dừng.
// =========================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StudioHeader from './StudioHeader.jsx';
import TourForm from './TourForm.jsx';
import { createTour } from '../../lib/studio.js';
import { langLabel } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import './tour-create-a.css';

export default function TourCreatePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(values, destination) {
    setBusy(true);
    setError('');
    try {
      const tour = await createTour(values);
      navigate(destination === 'library' ? '/studio' : '/studio/tours/' + tour.id + '/places', { replace:true });
    } catch (e) {
      setError(e.message || 'Không tạo được tour');
      setBusy(false);
    }
  }

  return (
    <div className="screen studio tour-create-a">
      <StudioHeader title="Tạo tour mới" backTo="/studio" subtitle="Thông tin cơ bản · Lưu bản nháp và thêm điểm dừng" />
      <main className="studio__main studio__main--narrow">
        <TourForm
          secondarySubmit="Lưu nháp & thoát"
          renderPreview={(values)=><aside className="tour-create-a__preview" aria-label="Xem trước bản nháp"><h2>Xem trước tour</h2>{values.coverImageUrl ? <img src={values.coverImageUrl} alt="Ảnh bìa bản nháp" /> : <div className="tour-create-a__placeholder"><Icon name="image" size={40} /></div>}<span className="chip">Bản nháp</span><h3>{values.title || 'Tên tour của bạn'}</h3><p className="muted">{values.city || 'Thành phố chưa chọn'} · {langLabel(values.originalLanguage)}</p><p>{values.description || 'Mô tả tour sẽ hiển thị tại đây.'}</p><p className="muted small">Điểm dừng và lộ trình được bổ sung ở bước tiếp theo. Bản xem trước này chưa công khai.</p></aside>}
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
