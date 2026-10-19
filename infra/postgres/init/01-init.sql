-- =========================================================
-- GeoSound — khởi tạo Postgres (chỉ chạy lần đầu, DEV LOCAL).
-- Container postgis/postgis tự chạy mọi file trong thư mục này
-- theo thứ tự tên khi database được tạo lần đầu.
--
-- Với Supabase (DB chung): chạy nội dung file này 1 lần bằng tay
-- trên SQL editor của Supabase.
-- =========================================================

-- 1) Bật PostGIS ngay từ đầu (query không gian: GPS trong polygon, tour gần tôi)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2) Schema-per-service: mỗi service sở hữu đúng 1 schema.
--    Service KHÔNG đụng bảng của service khác (chỉ qua API/event).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS tour;
CREATE SCHEMA IF NOT EXISTS moderation;
CREATE SCHEMA IF NOT EXISTS media;
CREATE SCHEMA IF NOT EXISTS notification;
