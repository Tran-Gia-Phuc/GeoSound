// =========================================================
// AuthContext — trạng thái phiên đăng nhập cho toàn app (UC01 phía client).
// Nguồn sự thật là token-store (localStorage); provider đồng bộ qua subscribe
// nên đăng nhập/đăng xuất ở bất kỳ đâu đều cập nhật mọi màn.
// =========================================================
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { readAuth, subscribe, isExpired } from '../lib/token-store.js';
import * as authApi from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readAuth());

  // Đồng bộ khi token-store đổi (đăng nhập/đăng xuất/refresh token).
  useEffect(() => subscribe(setAuth), []);

  const value = useMemo(() => {
    const user = auth?.user ?? null;
    // Phiên coi như hợp lệ khi còn access token chưa hết hạn HOẶC còn refresh token.
    const authenticated = !!auth?.accessToken && (!isExpired(auth.accessToken) || !!auth.refreshToken);
    return {
      user,
      authenticated,
      isTourist: user?.role === 'tourist',
      async login(creds) {
        const u = await authApi.login(creds);
        return u;
      },
      register: authApi.register,
      resendOtp: authApi.resendOtp,
      registerAndVerify: authApi.registerAndVerify,
      logout: authApi.logout,
    };
  }, [auth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}
