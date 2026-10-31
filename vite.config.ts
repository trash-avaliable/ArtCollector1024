import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 只给正式产物注入 CSP：dev 下 Vite/react-refresh 会内联引导脚本，
 * 与严格 script-src 冲突；dev 只监听本机，产物才是分发面。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",    // React 的 style={{...}} 走行内样式
  "img-src 'self' refimg: data: blob:",  // 缩略图 / 原图走自定义协议
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
  // 别加 frame-ancestors：媒体只能经 HTTP 头下发，写进 meta 会被忽略并在控制台报错
].join('; ');

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('</head>', `    <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  </head>`)
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120'
  },
  server: { port: 5173, strictPort: true }
});
