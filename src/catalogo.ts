import type { FalloPropuesta, ProductoEnLista } from './contrato.js';
import type { DatosProductoCatalogo, EstadoListaRegalo } from './estado.js';

export class ErrorHttp extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`El catálogo respondió con estado HTTP ${status}`);
    this.name = 'ErrorHttp';
    this.status = status;
  }
}

export class ErrorFormatoCatalogo extends Error {
  constructor(detalle: string) {
    super(`Respuesta inválida del catálogo: ${detalle}`);
    this.name = 'ErrorFormatoCatalogo';
  }
}

export type OpcionesCatalogo = {
  baseUrl: string;
  timeoutMs: number;
  delayMs: number;
  fetchImpl?: typeof fetch;
};

export type ResultadoProcesarPropuesta =
  | {
      ok: true;
      agregados: ProductoEnLista[];
      fallidos: FalloPropuesta[];
      cambioLista: boolean;
    }
  | { ok: false; motivo: string };

function extraerDatosProducto(cuerpo: unknown, idEsperado: number): DatosProductoCatalogo {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    throw new ErrorFormatoCatalogo('el cuerpo no es un objeto JSON');
  }

  const obj = cuerpo as Record<string, unknown>;
  const id = typeof obj.id === 'number' && Number.isInteger(obj.id) && obj.id > 0 ? obj.id : idEsperado;

  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    throw new ErrorFormatoCatalogo('falta el campo "title"');
  }

  if (typeof obj.price !== 'number' || !Number.isFinite(obj.price) || obj.price < 0) {
    throw new ErrorFormatoCatalogo('el campo "price" es inválido');
  }

  let imagen = '';
  if (typeof obj.thumbnail === 'string' && obj.thumbnail.trim() !== '') {
    imagen = obj.thumbnail.trim();
  } else if (Array.isArray(obj.images)) {
    const primeraImagen = obj.images.find((item) => typeof item === 'string' && item.trim() !== '');
    if (typeof primeraImagen === 'string') {
      imagen = primeraImagen.trim();
    }
  }

  if (imagen === '') {
    throw new ErrorFormatoCatalogo('falta una imagen válida ("thumbnail" o "images")');
  }

  return {
    id,
    titulo: obj.title.trim(),
    precio: obj.price,
    imagen,
  };
}

export function clasificarErrorCatalogo(productoId: number, error: unknown): FalloPropuesta {
  if (error instanceof ErrorHttp && error.status === 404) {
    return {
      productoId,
      codigo: 'NO_EXISTE',
      motivo: `El producto #${productoId} no existe en el catálogo`,
    };
  }

  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return {
      productoId,
      codigo: 'TIMEOUT',
      motivo: `El catálogo no respondió a tiempo para el producto #${productoId}`,
    };
  }

  return {
    productoId,
    codigo: 'CATALOGO_NO_DISPONIBLE',
    motivo: `El catálogo no está disponible para consultar el producto #${productoId}`,
  };
}

export class ClienteCatalogo {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly delayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opciones: OpcionesCatalogo) {
    this.baseUrl = opciones.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opciones.timeoutMs;
    this.delayMs = opciones.delayMs;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
  }

  construirUrlProducto(productoId: number): string {
    const url = new URL(`${this.baseUrl}/products/${productoId}`);
    if (this.delayMs > 0) {
      url.searchParams.set('delay', String(this.delayMs));
    }
    return url.toString();
  }

  async obtenerProducto(productoId: number, cancelacion?: AbortSignal): Promise<DatosProductoCatalogo> {
    const senales: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
    if (cancelacion) {
      senales.push(cancelacion);
    }

    const respuesta = await this.fetchImpl(this.construirUrlProducto(productoId), {
      signal: senales.length === 1 ? senales[0]! : AbortSignal.any(senales),
    });

    // fetch no rechaza en 404/500/503: hay que revisar respuesta.ok manualmente
    if (!respuesta.ok) {
      throw new ErrorHttp(respuesta.status);
    }

    const cuerpo: unknown = await respuesta.json();
    return extraerDatosProducto(cuerpo, productoId);
  }
}

export async function procesarPropuesta(
  estado: EstadoListaRegalo,
  catalogo: ClienteCatalogo,
  sesionId: string,
  productoIds: number[]
): Promise<ResultadoProcesarPropuesta> {
  if (!estado.obtenerParticipante(sesionId)) {
    return { ok: false, motivo: 'Primero tenés que unirte con un nombre' };
  }

  const fallidos: FalloPropuesta[] = [];
  const idsAConsultar: number[] = [];
  const vistosEnPropuesta = new Set<number>();

  // Filtro previo para evitar consultas innecesarias a DummyJSON
  for (const productoId of productoIds) {
    if (estado.tieneProducto(productoId) || vistosEnPropuesta.has(productoId)) {
      fallidos.push({
        productoId,
        codigo: 'YA_EN_LISTA',
        motivo: `El producto #${productoId} ya está en la lista`,
      });
      continue;
    }
    vistosEnPropuesta.add(productoId);
    idsAConsultar.push(productoId);
  }

  if (idsAConsultar.length === 0) {
    return { ok: true, agregados: [], fallidos, cambioLista: false };
  }

  // Consultas concurrentes: todas viajan a la vez y toleran fallos parciales
  const resultados = await Promise.allSettled(
    idsAConsultar.map((id) => catalogo.obtenerProducto(id))
  );

  // Después del await: verificación e inserción en bloque sincrónico (sin await en el medio)
  if (!estado.obtenerParticipante(sesionId)) {
    return { ok: false, motivo: 'La sesión se desconectó antes de completar la propuesta' };
  }

  const agregados: ProductoEnLista[] = [];

  resultados.forEach((resultado, indice) => {
    const productoId = idsAConsultar[indice]!;

    if (resultado.status === 'rejected') {
      fallidos.push(clasificarErrorCatalogo(productoId, resultado.reason));
      return;
    }

    const insercion = estado.agregarProducto(sesionId, resultado.value);
    if (insercion.ok) {
      agregados.push(insercion.producto);
    } else if (insercion.codigo === 'YA_EN_LISTA') {
      fallidos.push({
        productoId,
        codigo: 'YA_EN_LISTA',
        motivo: `El producto #${productoId} ya está en la lista`,
      });
    }
  });

  return {
    ok: true,
    agregados,
    fallidos,
    cambioLista: agregados.length > 0,
  };
}
