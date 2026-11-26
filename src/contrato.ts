export const MAX_LARGO_NOMBRE = 30;
export const MAX_PRODUCTOS_POR_PROPUESTA = 10;

export type ProductoEnLista = {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
  propuestoPor: string;
  votos: string[];
  cantidadVotos: number;
};

export type ProductoRanking = {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
  propuestoPor: string;
  cantidadVotos: number;
};

export type CodigoFalloProducto =
  | 'NO_EXISTE'
  | 'TIMEOUT'
  | 'YA_EN_LISTA'
  | 'CATALOGO_NO_DISPONIBLE';

export type FalloPropuesta = {
  productoId: number;
  codigo: CodigoFalloProducto;
  motivo: string;
};

export type DatosPantalla = {
  ranking: ProductoRanking[];
  cantidadParticipantes: number;
};

// Mensajes Cliente -> Servidor (WebSocket)
export type MensajeCliente =
  | { tipo: 'unirse'; nombre: string }
  | { tipo: 'proponer'; productoIds: number[] }
  | { tipo: 'votar'; productoId: number }
  | { tipo: 'quitar_voto'; productoId: number }
  | { tipo: 'quitar_producto'; productoId: number };

// Mensajes Servidor -> Cliente (WebSocket)
export type MensajeServidor =
  | {
      tipo: 'estado_inicial';
      yo: string;
      productos: ProductoEnLista[];
      participantes: string[];
    }
  | { tipo: 'lista_actualizada'; productos: ProductoEnLista[] }
  | { tipo: 'participantes'; nombres: string[] }
  | {
      tipo: 'resultado_propuesta';
      agregados: ProductoEnLista[];
      fallidos: FalloPropuesta[];
    }
  | { tipo: 'error'; motivo: string };

// Eventos Servidor -> Pantalla (Server-Sent Events)
export type EventoPantalla =
  | { evento: 'estado'; datos: DatosPantalla }
  | { evento: 'actualizacion'; datos: DatosPantalla };

export type ResultadoInterpretacion =
  | { ok: true; mensaje: MensajeCliente }
  | { ok: false; motivo: string };

export type DatosCrudosMensaje = string | Buffer | ArrayBuffer | Buffer[];

function convertirATexto(datos: DatosCrudosMensaje): string {
  if (typeof datos === 'string') {
    return datos;
  }
  if (Buffer.isBuffer(datos)) {
    return datos.toString('utf-8');
  }
  if (Array.isArray(datos)) {
    return Buffer.concat(datos).toString('utf-8');
  }
  return Buffer.from(datos).toString('utf-8');
}

function esEnteroPositivo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

export function validarNombre(valor: unknown): { ok: true; nombre: string } | { ok: false; motivo: string } {
  if (typeof valor !== 'string') {
    return { ok: false, motivo: 'El nombre debe ser un texto' };
  }

  const limpio = valor.trim();
  if (limpio.length === 0) {
    return { ok: false, motivo: 'El nombre no puede estar vacío' };
  }

  if (limpio.length > MAX_LARGO_NOMBRE) {
    return {
      ok: false,
      motivo: `El nombre no puede superar los ${MAX_LARGO_NOMBRE} caracteres`,
    };
  }

  if (/[\u0000-\u001F\u007F]/.test(limpio)) {
    return { ok: false, motivo: 'El nombre contiene caracteres no permitidos' };
  }

  return { ok: true, nombre: limpio };
}

export function interpretarMensaje(datos: DatosCrudosMensaje): ResultadoInterpretacion {
  let valor: unknown;
  try {
    valor = JSON.parse(convertirATexto(datos));
  } catch {
    return { ok: false, motivo: 'El mensaje debe ser un JSON válido' };
  }

  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return { ok: false, motivo: 'El mensaje debe ser un objeto JSON' };
  }

  const m = valor as Record<string, unknown>;
  if (typeof m.tipo !== 'string') {
    return { ok: false, motivo: 'Falta el campo "tipo" en el mensaje' };
  }

  switch (m.tipo) {
    case 'unirse': {
      const validacion = validarNombre(m.nombre);
      if (!validacion.ok) {
        return validacion;
      }
      return { ok: true, mensaje: { tipo: 'unirse', nombre: validacion.nombre } };
    }

    case 'proponer': {
      if (!Array.isArray(m.productoIds)) {
        return { ok: false, motivo: 'El campo "productoIds" debe ser un arreglo de IDs numéricos' };
      }
      if (m.productoIds.length === 0) {
        return { ok: false, motivo: 'Debés indicar al menos un ID de producto' };
      }
      if (m.productoIds.length > MAX_PRODUCTOS_POR_PROPUESTA) {
        return {
          ok: false,
          motivo: `Solo se pueden proponer hasta ${MAX_PRODUCTOS_POR_PROPUESTA} productos por vez`,
        };
      }
      if (!m.productoIds.every(esEnteroPositivo)) {
        return {
          ok: false,
          motivo: 'Todos los elementos de "productoIds" deben ser enteros positivos',
        };
      }
      return { ok: true, mensaje: { tipo: 'proponer', productoIds: [...m.productoIds] } };
    }

    case 'votar':
    case 'quitar_voto':
    case 'quitar_producto': {
      if (!esEnteroPositivo(m.productoId)) {
        return {
          ok: false,
          motivo: 'El campo "productoId" debe ser un número entero positivo',
        };
      }
      return { ok: true, mensaje: { tipo: m.tipo, productoId: m.productoId } };
    }

    default:
      return { ok: false, motivo: `Tipo de mensaje desconocido: "${m.tipo}"` };
  }
}
