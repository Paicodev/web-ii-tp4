import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import type { MensajeServidor } from '../src/contrato.js';
import { crearAplicacion } from '../src/server.js';

type ClienteWs = {
  ws: WebSocket;
  mensajes: MensajeServidor[];
  esperarMensaje: (
    predicado: (m: MensajeServidor) => boolean,
    timeoutMs?: number
  ) => Promise<MensajeServidor>;
};

function abrirClienteWs(url: string, opciones?: { autoPong?: boolean }): Promise<ClienteWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opciones);
    const mensajes: MensajeServidor[] = [];
    const oyentes: Array<(m: MensajeServidor) => void> = [];

    ws.on('message', (datos) => {
      const parsed = JSON.parse(datos.toString()) as MensajeServidor;
      mensajes.push(parsed);
      for (const fn of [...oyentes]) {
        fn(parsed);
      }
    });

    const esperarMensaje: ClienteWs['esperarMensaje'] = (predicado, timeoutMs = 2000) => {
      const existente = mensajes.find(predicado);
      if (existente) {
        return Promise.resolve(existente);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const idx = oyentes.indexOf(onMsg);
          if (idx >= 0) oyentes.splice(idx, 1);
          rej(new Error('Tiempo agotado esperando mensaje WebSocket'));
        }, timeoutMs);

        const onMsg = (m: MensajeServidor) => {
          if (predicado(m)) {
            clearTimeout(timer);
            const idx = oyentes.indexOf(onMsg);
            if (idx >= 0) oyentes.splice(idx, 1);
            res(m);
          }
        };
        oyentes.push(onMsg);
      });
    };

    ws.on('open', () => resolve({ ws, mensajes, esperarMensaje }));
    ws.on('error', reject);
  });
}

describe('tiempo real: WebSocket, SSE, no bloqueo y heartbeat ping/pong', () => {
  it('sincroniza 3 participantes + pantalla SSE sin bloquear ante catálogo lento', async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/products/1')) {
        return new Response(
          JSON.stringify({ id: 1, title: 'Cafetera', price: 45, thumbnail: 'https://img/1.png' }),
          { status: 200 }
        );
      }
      if (url.endsWith('/products/2')) {
        // Simula catálogo lento (250ms) para verificar no bloqueo
        await new Promise((r) => setTimeout(r, 250));
        return new Response(
          JSON.stringify({ id: 2, title: 'Parlante', price: 80, thumbnail: 'https://img/2.png' }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    };

    const app = crearAplicacion(
      {
        port: 0,
        host: '127.0.0.1',
        catalogBaseUrl: 'https://catalogo.test',
        catalogTimeoutMs: 2000,
        catalogDelayMs: 0,
        wsHeartbeatMs: 30_000,
      },
      { fetchImpl: fetchMock }
    );

    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const { port } = app.server.address() as AddressInfo;
    const baseHttp = `http://127.0.0.1:${port}`;
    const baseWs = `ws://127.0.0.1:${port}`;

    // Abrir pantalla SSE
    const sseAbort = new AbortController();
    const sseResp = await fetch(`${baseHttp}/eventos`, { signal: sseAbort.signal });
    assert.equal(sseResp.status, 200);
    assert.ok(sseResp.headers.get('content-type')?.includes('text/event-stream'));

    const eventosSse: Array<{ evento: string; datos: { ranking: unknown[]; cantidadParticipantes: number } }> = [];
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const lectorSse = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const partes = buffer.split('\n\n');
          buffer = partes.pop() ?? '';
          for (const bloque of partes) {
            const lineas = bloque.split('\n');
            const ev = lineas.find((l) => l.startsWith('event:'))?.slice(6).trim();
            const data = lineas.find((l) => l.startsWith('data:'))?.slice(5).trim();
            if (ev && data) {
              eventosSse.push({ evento: ev, datos: JSON.parse(data) });
            }
          }
        }
      } catch {
        // Cancelado al cerrar el test
      }
    })();

    const ana = await abrirClienteWs(baseWs);
    const bruno = await abrirClienteWs(baseWs);

    // 1. Mensaje inválido solo responde error a quien lo envió
    ana.ws.send('esto no es JSON');
    const err = await ana.esperarMensaje((m) => m.tipo === 'error');
    assert.equal(err.tipo, 'error');
    assert.equal(bruno.mensajes.length, 0);

    // 2. Entran Ana y Bruno
    ana.ws.send(JSON.stringify({ tipo: 'unirse', nombre: 'Ana' }));
    bruno.ws.send(JSON.stringify({ tipo: 'unirse', nombre: 'Bruno' }));
    await ana.esperarMensaje((m) => m.tipo === 'participantes' && m.nombres.length === 2);

    // 3. Propuesta con fallo parcial [1, 999]
    ana.ws.send(JSON.stringify({ tipo: 'proponer', productoIds: [1, 999] }));
    const resProp = await ana.esperarMensaje((m) => m.tipo === 'resultado_propuesta');
    assert.equal(resProp.tipo, 'resultado_propuesta');
    if (resProp.tipo === 'resultado_propuesta') {
      assert.equal(resProp.agregados.length, 1);
      assert.equal(resProp.fallidos.length, 1);
      assert.equal(resProp.fallidos[0]?.codigo, 'NO_EXISTE');
    }
    await bruno.esperarMensaje((m) => m.tipo === 'lista_actualizada' && m.productos.length === 1);
    assert.equal(
      bruno.mensajes.some((m) => m.tipo === 'resultado_propuesta'),
      false
    );

    // 4. Entrada tardía: Carla recibe lista y conectados completos sin esperar cambios
    const carla = await abrirClienteWs(baseWs);
    carla.ws.send(JSON.stringify({ tipo: 'unirse', nombre: 'Carla' }));
    const inicialCarla = await carla.esperarMensaje((m) => m.tipo === 'estado_inicial');
    if (inicialCarla.tipo === 'estado_inicial') {
      assert.equal(inicialCarla.productos.length, 1);
      assert.equal(inicialCarla.participantes.length, 3);
    }

    // 5. Sin bloqueos: Ana propone #2 (lento 250ms) y mientras tanto Bruno y Carla votan #1 a la vez
    const inicioNoBloqueo = performance.now();
    ana.ws.send(JSON.stringify({ tipo: 'proponer', productoIds: [2] }));
    bruno.ws.send(JSON.stringify({ tipo: 'votar', productoId: 1 }));
    carla.ws.send(JSON.stringify({ tipo: 'votar', productoId: 1 }));

    await bruno.esperarMensaje(
      (m) => m.tipo === 'lista_actualizada' && m.productos[0]?.cantidadVotos === 2
    );
    const tiempoVotos = performance.now() - inicioNoBloqueo;
    assert.ok(tiempoVotos < 180, `los votos no deben esperar al catálogo lento (tardó ${Math.round(tiempoVotos)}ms)`);

    // Luego llega el producto #2
    await carla.esperarMensaje((m) => m.tipo === 'lista_actualizada' && m.productos.length === 2);

    // 6. Cierre de pestaña: Carla cierra y los demás + pantalla ven 2 participantes
    carla.ws.close();
    await ana.esperarMensaje(
      (m) => m.tipo === 'participantes' && m.nombres.length === 2 && !m.nombres.includes('Carla')
    );

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(eventosSse[0]?.evento, 'estado');
    const ultimoSse = eventosSse.at(-1);
    assert.equal(ultimoSse?.evento, 'actualizacion');
    assert.equal(ultimoSse?.datos.cantidadParticipantes, 2);
    assert.equal(ultimoSse?.datos.ranking.length, 2);

    sseAbort.abort();
    await lectorSse;
    ana.ws.close();
    bruno.ws.close();
    await app.cerrar();
  });

  it('detecta y elimina una conexión muerta cuando no responde pong al heartbeat', async () => {
    const app = crearAplicacion({
      port: 0,
      host: '127.0.0.1',
      catalogBaseUrl: 'https://catalogo.test',
      catalogTimeoutMs: 1000,
      catalogDelayMs: 0,
      wsHeartbeatMs: 60,
    });

    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const { port } = app.server.address() as AddressInfo;
    const baseWs = `ws://127.0.0.1:${port}`;

    const sano = await abrirClienteWs(baseWs); // autoPong = true (por defecto)
    const mudo = await abrirClienteWs(baseWs, { autoPong: false }); // simula red cortada sin pong

    sano.ws.send(JSON.stringify({ tipo: 'unirse', nombre: 'Sano' }));
    mudo.ws.send(JSON.stringify({ tipo: 'unirse', nombre: 'Mudo' }));

    await sano.esperarMensaje((m) => m.tipo === 'participantes' && m.nombres.length === 2);

    // Esperar a que realmente se cierre el socket 'mudo' tras no responder el ping del heartbeat
    const cierreMudo = new Promise<void>((resolve) => {
      mudo.ws.once('close', () => resolve());
    });

    const cantidadMensajesAntes = sano.mensajes.length;
    await cierreMudo;

    // Verificar que 'sano' recibió un mensaje NUEVO de participantes sin 'Mudo'
    const esperaNuevoParticipantes = new Promise<MensajeServidor>((resolve, reject) => {
      const revisar = () => {
        const nuevos = sano.mensajes.slice(cantidadMensajesAntes);
        const encontrado = nuevos.find(
          (m) => m.tipo === 'participantes' && m.nombres.length === 1 && m.nombres[0] === 'Sano'
        );
        if (encontrado) {
          resolve(encontrado);
          return true;
        }
        return false;
      };
      if (revisar()) return;
      const timer = setTimeout(() => reject(new Error('No llegó actualización de salida por heartbeat')), 1000);
      const onMsg = () => {
        if (revisar()) {
          clearTimeout(timer);
          sano.ws.off('message', onMsg);
        }
      };
      sano.ws.on('message', onMsg);
    });

    const cierreDetectado = await esperaNuevoParticipantes;
    assert.equal(cierreDetectado.tipo, 'participantes');
    assert.equal(mudo.ws.readyState, WebSocket.CLOSED);

    sano.ws.close();
    await app.cerrar();
  });
});
