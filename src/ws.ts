import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { type ClienteCatalogo, procesarPropuesta } from './catalogo.js';
import { interpretarMensaje, type MensajeServidor } from './contrato.js';
import type { EstadoListaRegalo } from './estado.js';
import type { GestorSse } from './sse.js';

export type OpcionesWs = {
  server: HttpServer;
  estado: EstadoListaRegalo;
  catalogo: ClienteCatalogo;
  sse: GestorSse;
  heartbeatMs: number;
};

const MAX_PAYLOAD_BYTES = 16 * 1024;

export function configurarWebSocket(opciones: OpcionesWs): WebSocketServer {
  const { server, estado, catalogo, sse, heartbeatMs } = opciones;
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

  // Relaciona cada conexión WebSocket con su identificador interno de sesión
  const sesionesPorSocket = new Map<WebSocket, string>();
  const socketsUnidos = new Set<WebSocket>();
  const vivos = new WeakSet<WebSocket>();

  function enviar(socket: WebSocket, mensaje: MensajeServidor): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(mensaje));
    }
  }

  function enviarATodosUnidos(mensaje: MensajeServidor): void {
    for (const cliente of socketsUnidos) {
      enviar(cliente, mensaje);
    }
  }

  function notificarPantalla(): void {
    sse.publicarActualizacion(estado.obtenerDatosPantalla());
  }

  // Heartbeat periódico ping/pong para detectar conexiones muertas silenciosamente
  const latido = setInterval(() => {
    for (const socket of wss.clients) {
      if (!vivos.has(socket)) {
        socket.terminate(); // dispara el evento 'close' y libera todo lo asociado
        continue;
      }
      vivos.delete(socket);
      socket.ping();
    }
  }, heartbeatMs);
  latido.unref();

  wss.on('close', () => {
    clearInterval(latido);
  });

  wss.on('connection', (socket) => {
    const sesionId = randomUUID();
    sesionesPorSocket.set(socket, sesionId);
    vivos.add(socket);

    socket.on('pong', () => {
      vivos.add(socket);
    });

    // Oyente obligatorio: sin él, un error de protocolo o maxPayload termina el proceso
    socket.on('error', (error) => {
      console.warn('Error en conexión WebSocket:', error.message);
    });

    // Todo await dentro de un manejador async va en try/catch porque ws ignora la promesa devuelta
    socket.on('message', async (datos: RawData) => {
      try {
        const interpretado = interpretarMensaje(datos);
        if (!interpretado.ok) {
          enviar(socket, { tipo: 'error', motivo: interpretado.motivo });
          return;
        }

        const mensaje = interpretado.mensaje;

        switch (mensaje.tipo) {
          case 'unirse': {
            const resultado = estado.unirse(sesionId, mensaje.nombre);
            if (!resultado.ok) {
              enviar(socket, { tipo: 'error', motivo: resultado.motivo });
              return;
            }

            socketsUnidos.add(socket);

            // Primero el estado completo para quien entra, luego presencia a todos y a la pantalla
            enviar(socket, {
              tipo: 'estado_inicial',
              yo: resultado.participante.nombre,
              productos: resultado.productos,
              participantes: resultado.participantes,
            });
            enviarATodosUnidos({
              tipo: 'participantes',
              nombres: resultado.participantes,
            });
            notificarPantalla();
            break;
          }

          case 'proponer': {
            if (!socketsUnidos.has(socket)) {
              enviar(socket, { tipo: 'error', motivo: 'Primero tenés que unirte con un nombre' });
              return;
            }

            const resultado = await procesarPropuesta(estado, catalogo, sesionId, mensaje.productoIds);
            if (!resultado.ok) {
              enviar(socket, { tipo: 'error', motivo: resultado.motivo });
              return;
            }

            if (resultado.cambioLista) {
              enviarATodosUnidos({
                tipo: 'lista_actualizada',
                productos: estado.obtenerProductosOrdenados(),
              });
              notificarPantalla();
            }

            // Los fallos (si los hubo) se informan únicamente a quien propuso
            enviar(socket, {
              tipo: 'resultado_propuesta',
              agregados: resultado.agregados,
              fallidos: resultado.fallidos,
            });
            break;
          }

          case 'votar': {
            const resultado = estado.votar(sesionId, mensaje.productoId);
            if (!resultado.ok) {
              enviar(socket, { tipo: 'error', motivo: resultado.motivo });
              return;
            }
            enviarATodosUnidos({ tipo: 'lista_actualizada', productos: resultado.productos });
            notificarPantalla();
            break;
          }

          case 'quitar_voto': {
            const resultado = estado.quitarVoto(sesionId, mensaje.productoId);
            if (!resultado.ok) {
              enviar(socket, { tipo: 'error', motivo: resultado.motivo });
              return;
            }
            enviarATodosUnidos({ tipo: 'lista_actualizada', productos: resultado.productos });
            notificarPantalla();
            break;
          }

          case 'quitar_producto': {
            const resultado = estado.quitarProducto(sesionId, mensaje.productoId);
            if (!resultado.ok) {
              enviar(socket, { tipo: 'error', motivo: resultado.motivo });
              return;
            }
            enviarATodosUnidos({ tipo: 'lista_actualizada', productos: resultado.productos });
            notificarPantalla();
            break;
          }
        }
      } catch (error) {
        console.error('Error inesperado procesando mensaje WebSocket:', error);
        enviar(socket, { tipo: 'error', motivo: 'Error interno procesando el mensaje' });
      }
    });

    // 'close' llega siempre (pestaña cerrada, red cortada o terminate por heartbeat)
    socket.on('close', () => {
      const id = sesionesPorSocket.get(socket);
      sesionesPorSocket.delete(socket);
      socketsUnidos.delete(socket);

      if (!id) {
        return;
      }

      const { salio, participantes } = estado.salir(id);
      if (salio) {
        enviarATodosUnidos({ tipo: 'participantes', nombres: participantes });
        notificarPantalla();
      }
    });
  });

  return wss;
}
