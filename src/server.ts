import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { ClienteCatalogo } from './catalogo.js';
import { loadConfig, type AppConfig } from './config.js';
import { EstadoListaRegalo } from './estado.js';
import { GestorSse } from './sse.js';
import { configurarWebSocket } from './ws.js';

export type OpcionesServidor = {
  fetchImpl?: typeof fetch;
  keepAliveSseMs?: number;
};

export function crearAplicacion(config: AppConfig, opciones: OpcionesServidor = {}) {
  const estado = new EstadoListaRegalo();
  const catalogo = new ClienteCatalogo({
    baseUrl: config.catalogBaseUrl,
    timeoutMs: config.catalogTimeoutMs,
    delayMs: config.catalogDelayMs,
    ...(opciones.fetchImpl ? { fetchImpl: opciones.fetchImpl } : {}),
  });
  const sse = new GestorSse(opciones.keepAliveSseMs);

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
          participantesConectados: estado.obtenerParticipantes().length,
          productosEnLista: estado.obtenerProductosOrdenados().length,
          pantallasConectadas: sse.cantidadSuscriptores(),
        })
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/eventos') {
      sse.suscribir(req, res, estado.obtenerDatosPantalla());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
  });

  const wss = configurarWebSocket({
    server,
    estado,
    catalogo,
    sse,
    heartbeatMs: config.wsHeartbeatMs,
  });

  function cerrar(): Promise<void> {
    return new Promise((resolve) => {
      sse.cerrar();
      for (const cliente of wss.clients) {
        cliente.close(1001, 'Servidor apagándose');
      }
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return { server, wss, estado, sse, cerrar };
}

function esModuloPrincipal(): boolean {
  const entrada = process.argv[1];
  if (!entrada) {
    return false;
  }
  return import.meta.url === pathToFileURL(entrada).href;
}

if (esModuloPrincipal()) {
  const config = loadConfig();
  const app = crearAplicacion(config);

  app.server.listen(config.port, config.host, () => {
    console.log(`Servidor escuchando en http://localhost:${config.port}`);
    console.log(
      `Catálogo: ${config.catalogBaseUrl} | timeout: ${config.catalogTimeoutMs}ms | delay: ${config.catalogDelayMs}ms | heartbeat WS: ${config.wsHeartbeatMs}ms`
    );
  });

  let cerrando = false;
  const apagar = (signal: string) => {
    if (cerrando) {
      return;
    }
    cerrando = true;
    console.log(`Recibida señal ${signal}, cerrando servidor...`);
    void app.cerrar().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}
