const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Set CORS and iframe headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve v2 at root
  if (pathname === '/' || pathname === '') {
    filePath = path.join(ROOT_DIR, 'v2', 'renderer', 'index.html');
  } else if (pathname === '/sample_btc_usdt_15m.csv') {
    filePath = path.join(ROOT_DIR, 'sample_btc_usdt_15m.csv');
  } else if (pathname.startsWith('/v2/')) {
    const subPath = pathname.slice(4);
    filePath = path.join(ROOT_DIR, 'v2', 'renderer', subPath);
  } else if (pathname.startsWith('/v1/')) {
    const subPath = pathname.slice(4);
    filePath = path.join(ROOT_DIR, 'renderer', subPath);
  } else {
    // Default fallback to v2/renderer
    filePath = path.join(ROOT_DIR, 'v2', 'renderer', pathname);
  }

  // Security check: prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    if (stats.isDirectory()) {
      const indexFile = path.join(resolvedPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(indexFile).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Directory listing disabled');
      }
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(resolvedPath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Market Replay server running at http://0.0.0.0:${PORT}/`);
  console.log(`Market Replay v2: http://0.0.0.0:${PORT}/v2/`);
  console.log(`Market Replay v1: http://0.0.0.0:${PORT}/v1/`);
});
