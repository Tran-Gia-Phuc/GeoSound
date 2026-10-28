// =========================================================
// Chat routes (issue #188), behind CHATBOT_ENABLED (default false).
//   POST /api/chat          -> AI /chat          (Server-Sent Events)
//   GET  /api/chat/history  -> AI /chat/history
// The gateway adds `x-internal-token` from INTERNAL_SERVICE_TOKEN; a token sent
// by the client is never forwarded. The response is piped as it arrives (no
// buffering) so SSE tokens reach the browser as they are produced. Upstream
// 4xx/5xx JSON responses pass through unchanged.
// =========================================================
import { createProxyMiddleware } from 'http-proxy-middleware';

const TOKEN_HEADER = 'x-internal-token';

/**
 * Mount the chat routes on `app`. Does nothing when `enabled` is false, so the
 * paths fall through to the 404 handler like today.
 * @param {import('express').Express} app
 * @param {{ enabled: boolean, target: string, token?: string,
 *           limiter?: import('express').RequestHandler, log?: (msg: string) => void }} opts
 */
export function mountChat(app, { enabled, target, token = '', limiter, log = console.warn }) {
  if (!enabled) return false;

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    // /api/chat -> /chat, /api/chat/history?session_id=x -> /chat/history?session_id=x
    pathRewrite: (_p, req) => req.originalUrl.replace(/^\/api/, ''),
    on: {
      proxyReq: (proxyReq, req, res) => {
        proxyReq.removeHeader(TOKEN_HEADER);
        if (token) proxyReq.setHeader(TOKEN_HEADER, token);
        // Client went away (closed tab, aborted fetch): stop the upstream stream too.
        res.on('close', () => {
          if (!res.writableFinished) proxyReq.destroy();
        });
      },
      proxyRes: (proxyRes, _req, res) => {
        if (String(proxyRes.headers['content-type'] || '').startsWith('text/event-stream')) {
          proxyRes.headers['cache-control'] = 'no-cache';
          proxyRes.headers['x-accel-buffering'] = 'no';
          // Headers are copied right after this hook; send them before the first event.
          setImmediate(() => {
            if (!res.headersSent && !res.destroyed) res.flushHeaders();
          });
        }
      },
      error: (err, _req, res) => {
        log(`[gateway] chat proxy error: ${err.message}`);
        if (typeof res.status !== 'function') return; // socket, not a response
        if (res.headersSent) return res.end();
        res.status(503).json({ error: 'Chat service unavailable' });
      },
    },
  });

  const chain = limiter ? [limiter, proxy] : [proxy];
  app.post('/api/chat', ...chain);
  app.get('/api/chat/history', proxy);
  return true;
}
