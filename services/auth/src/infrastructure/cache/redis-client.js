// Redis client (ioredis) dùng cho ChallengeStore (OTP + đăng ký tạm).
import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
