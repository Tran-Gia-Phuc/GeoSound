// Định tuyến client. UC04 = trình nghe tour (/tour/:tourId).
// Các màn khác (UC02 tìm/chi tiết, UC03 offline…) bổ sung sau.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './features/home/HomePage.jsx';
import TourPlayerPage from './features/player/TourPlayerPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tour/:tourId" element={<TourPlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
