// Định tuyến client.
//   /                   — trang chủ
//   /login              — đăng nhập / đăng ký (UC01)
//   /tour/:id           — trình nghe tour (UC04)
//   /explore            — khám phá địa điểm lẻ (UC07)
//   /itineraries        — lịch trình của tôi (UC07, cần đăng nhập)
//   /itineraries/:id    — chỉnh sửa lịch trình (UC07, cần đăng nhập)
//   /shared/:token      — xem lịch trình được chia sẻ (UC07/A4, công khai)
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './features/home/HomePage.jsx';
import TourPlayerPage from './features/player/TourPlayerPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import ExplorePage from './features/explore/ExplorePage.jsx';
import ItinerariesPage from './features/itineraries/ItinerariesPage.jsx';
import ItineraryEditorPage from './features/itineraries/ItineraryEditorPage.jsx';
import SharedItineraryPage from './features/itineraries/SharedItineraryPage.jsx';
import RequireAuth from './auth/RequireAuth.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tour/:tourId" element={<TourPlayerPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/itineraries" element={<RequireAuth><ItinerariesPage /></RequireAuth>} />
        <Route path="/itineraries/:id" element={<RequireAuth><ItineraryEditorPage /></RequireAuth>} />
        <Route path="/shared/:token" element={<SharedItineraryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
