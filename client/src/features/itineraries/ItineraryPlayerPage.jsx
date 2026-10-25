// =========================================================
// ItineraryPlayerPage (UC08) — "Đi theo lịch trình cá nhân". Tái dùng NGUYÊN
// trình phát UC04 (TourPlayerPage), chỉ đổi NGUỒN dữ liệu sang lịch trình của
// mình. Trải nghiệm giống UC04: GPS tự phát khi tới gần (vùng tròn sinh ở
// build-itinerary-view), chọn điểm thủ công (A1), ưu tiên audio người thật → TTS.
// =========================================================
import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import TourPlayerPage from '../player/TourPlayerPage.jsx';
import { getItinerary } from '../../lib/itineraries.js';

export default function ItineraryPlayerPage() {
  const { id } = useParams();
  const loadDetail = useCallback((lang) => getItinerary(id, lang), [id]);
  return (
    <TourPlayerPage
      loadDetail={loadDetail}
      progressKey={`itin:${id}`}
      backTo={`/itineraries/${id}`}
      remember={false}
      modeLabels={{ gps: 'Đi theo lịch trình', remote: 'Nghe thử từng điểm' }}
    />
  );
}
