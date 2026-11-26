import http from 'node:http';
import { loadConfig } from './config.js';

const config = loadConfig();

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        catalogBaseUrl: config.catalogBaseUrl,
        catalogTimeoutMs: config.catalogTimeoutMs,
        catalogDelayMs: config.catalogDelayMs,
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

server.listen(config.port, config.host, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
  console.log(
    `Catálogo: ${config.catalogBaseUrl} | timeout: ${config.catalogTimeoutMs}ms | delay: ${config.catalogDelayMs}ms`
  );
});

function shutdown(signal: string): void {
  console.log(`Recibida señal ${signal}, cerrando servidor...`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
