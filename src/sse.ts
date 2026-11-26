import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatosPantalla } from './contrato.js';

export class GestorSse {
  private readonly conexiones = new Set<ServerResponse>();
  private secuenciaEvento = 0;
  private readonly intervaloKeepAlive: NodeJS.Timeout;

  constructor(keepAliveMs = 25_000) {
    this.intervaloKeepAlive = setInterval(() => {
      this.enviarKeepAlive();
    }, keepAliveMs);
    this.intervaloKeepAlive.unref();
  }

  suscribir(req: IncomingMessage, res: ServerResponse, estadoActual: DatosPantalla): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    // Tiempo de espera sugerido al navegador antes de reconectar automáticamente
    res.write('retry: 3000\n\n');

    this.conexiones.add(res);

    // Regla clave de SSE: enviar primero el estado actual para no dejar la pantalla vacía
    this.escribirEvento(res, 'estado', estadoActual);

    const limpiar = () => {
      this.conexiones.delete(res);
    };

    req.on('close', limpiar);
    res.on('close', limpiar);
    res.on('error', limpiar);
  }

  publicarActualizacion(datos: DatosPantalla): void {
    const id = ++this.secuenciaEvento;
    const trama = this.formatearEvento('actualizacion', id, datos);

    for (const res of this.conexiones) {
      if (res.writableEnded || res.destroyed) {
        this.conexiones.delete(res);
        continue;
      }
      res.write(trama);
    }
  }

  cantidadSuscriptores(): number {
    return this.conexiones.size;
  }

  cerrar(): void {
    clearInterval(this.intervaloKeepAlive);
    for (const res of this.conexiones) {
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
    this.conexiones.clear();
  }

  private escribirEvento(res: ServerResponse, evento: 'estado' | 'actualizacion', datos: DatosPantalla): void {
    if (res.writableEnded || res.destroyed) {
      this.conexiones.delete(res);
      return;
    }
    const id = ++this.secuenciaEvento;
    res.write(this.formatearEvento(evento, id, datos));
  }

  private formatearEvento(evento: 'estado' | 'actualizacion', id: number, datos: DatosPantalla): string {
    return `event: ${evento}\nid: ${id}\ndata: ${JSON.stringify(datos)}\n\n`;
  }

  private enviarKeepAlive(): void {
    for (const res of this.conexiones) {
      if (res.writableEnded || res.destroyed) {
        this.conexiones.delete(res);
        continue;
      }
      res.write(': keep-alive\n\n');
    }
  }
}
