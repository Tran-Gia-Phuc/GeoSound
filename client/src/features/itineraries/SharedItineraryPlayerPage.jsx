// =========================================================
// SharedItineraryPlayerPage (UC08 trên lịch trình được chia sẻ) — bạn bè mở link
// chia sẻ rồi "Đi theo lịch trình này". Công khai, không cần đăng nhập. Tái dùng
// trình phát UC04 với nguồn dữ liệu là lịch trình chia sẻ (chỉ đọc).
// =========================================================
import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import TourPlayerPage from '../player/TourPlayerPage.jsx';
import { getSharedItinerary } from '../../lib/itineraries.js';

export default function SharedItineraryPlayerPage() {
  const { token } = useParams();
  const loadDetail = useCallback((lang) => getSharedItinerary(token, lang), [token]);
  return (
    <TourPlayerPage
      loadDetail={loadDetail}
      progressKey={`shared:${token}`}
      backTo={`/shared/${token}`}
      remember={false}
      modeLabels={{ gps: 'Đi theo lịch trình', remote: 'Nghe thử từng điểm' }}
    />
  );
}
