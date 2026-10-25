// Định tuyến client.
//   /            — trang chủ
//   /login       — đăng nhập / đăng ký (UC01)
//   /tour/:id    — trình nghe tour (UC04)
// Các màn lịch trình cá nhân (UC07/UC08) bổ sung ở feature branch kế tiếp.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './features/home/HomePage.jsx';
import TourPlayerPage from './features/player/TourPlayerPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tour/:tourId" element={<TourPlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
