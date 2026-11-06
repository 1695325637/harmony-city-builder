#!/usr/bin/env node
/**
 * HC-01 · S-06 浏览器预览静态服务（T-118 / 交付 C）
 *
 * 为什么需要 http：预览页是 ES module，`file://` 打开会被 CORS 拦；用 node:http 起本机
 * 静态服务即可，零依赖。
 *
 * 运行：node preview/serve.mjs          （默认 127.0.0.1:8123）
 *       PORT=9000 node preview/serve.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(here);
const port = Number(process.env.PORT ?? 8123);
const host = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://' + host + ':' + port);
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = normalize(join(root, rel));
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('[preview] 端口 ' + host + ':' + port + ' 已被占用。');
    console.error('[preview] 处理：换端口运行，例如  PORT=' + (port + 1) + ' node preview/serve.mjs');
    console.error('[preview] 或先关闭占用进程：  netstat -ano | findstr :' + port + '  然后  taskkill /PID <pid> /F');
    process.exit(2);
  }
  console.error('[preview] 静态服务启动失败：' + String(err && err.message));
  process.exit(2);
});

server.listen(port, host, () => {
  console.log('[preview] HC-01 S-06 占位渲染预览：http://' + host + ':' + port + '/');
  console.log('[preview] 提示：先运行 node preview/build.mjs 生成 dist/；本页为占位色块，非最终美术。');
  console.log('[preview] 档位直达：/?lod=L0 | /?lod=L1 | /?lod=L2（默认 L0 全图概览）');
});
