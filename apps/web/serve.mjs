import { createServer, request as upstreamRequest } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, 'dist');
const target = new URL(process.env.API_PROXY_TARGET ?? 'http://api:3001');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  const path = (request.url ?? '/').split('?')[0];
  // Never expose controller/metrics endpoints through the public entry point.
  if (path.startsWith('/api/')) {
    const headers = { ...request.headers, host: target.host };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    delete headers['forwarded'];
    delete headers['x-forwarded-for'];
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-proto'];
    const upstream = upstreamRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: request.url,
        method: request.method,
        headers,
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
        result.on('error', () => response.destroy());
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end('{"error":"upstream_unavailable"}');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
    return;
  }
  if (path.startsWith('/internal') || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const decoded = decodeURIComponent(path);
    let file = resolve(root, `.${decoded}`);
    if (!file.startsWith(root + sep) && file !== root) {
      response.writeHead(404).end();
      return;
    }
    let info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      // Only client-side routes fall back to index; missing assets are real 404s.
      if (extname(file) || decoded.startsWith('/assets/')) {
        response.writeHead(404).end();
        return;
      }
      file = resolve(root, 'index.html');
      info = await stat(file);
    }
    const immutable = file.startsWith(resolve(root, 'assets') + sep);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (request.method === 'HEAD') response.end();
    else
      createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
  } catch {
    response.writeHead(400).end();
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(5173, '0.0.0.0');
process.on('SIGTERM', () => {
  server.close();
  setTimeout(() => process.exit(0), 8000).unref();
});
