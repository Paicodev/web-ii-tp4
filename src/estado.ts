import {
  type DatosPantalla,
  type ProductoEnLista,
  type ProductoRanking,
  validarNombre,
} from './contrato.js';

export type DatosProductoCatalogo = {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
};

export type Participante = {
  sesionId: string;
  nombre: string;
  nombreNormalizado: string;
};

type ProductoInterno = {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
  propuestoPor: string;
  propuestoPorNormalizado: string;
  votos: Map<string, string>; // nombreNormalizado -> nombreOriginal
  ordenLlegada: number;
};

export type ResultadoUnirse =
  | {
      ok: true;
      participante: Participante;
      productos: ProductoEnLista[];
      participantes: string[];
    }
  | { ok: false; motivo: string };

export type ResultadoAgregarProducto =
  | { ok: true; producto: ProductoEnLista }
  | { ok: false; codigo: 'NO_AUTENTICADO' | 'YA_EN_LISTA'; motivo: string };

export type ResultadoAccionLista =
  | { ok: true; productos: ProductoEnLista[] }
  | { ok: false; motivo: string };

function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase();
}

export class EstadoListaRegalo {
  private readonly participantesPorSesion = new Map<string, Participante>();
  private readonly sesionesPorNombre = new Map<string, string>();
  private readonly productos = new Map<number, ProductoInterno>();
  private secuenciaLlegada = 0;

  unirse(sesionId: string, nombreCrudo: string): ResultadoUnirse {
    if (this.participantesPorSesion.has(sesionId)) {
      return { ok: false, motivo: 'Ya te uniste a la lista en esta conexión' };
    }

    const validacion = validarNombre(nombreCrudo);
    if (!validacion.ok) {
      return validacion;
    }

    const nombreNormalizado = normalizarNombre(validacion.nombre);
    if (this.sesionesPorNombre.has(nombreNormalizado)) {
      return {
        ok: false,
        motivo: `Ya hay un participante conectado con el nombre "${validacion.nombre}"`,
      };
    }

    const participante: Participante = {
      sesionId,
      nombre: validacion.nombre,
      nombreNormalizado,
    };

    this.participantesPorSesion.set(sesionId, participante);
    this.sesionesPorNombre.set(nombreNormalizado, sesionId);

    return {
      ok: true,
      participante,
      productos: this.obtenerProductosOrdenados(),
      participantes: this.obtenerParticipantes(),
    };
  }

  salir(sesionId: string): { salio: boolean; participantes: string[] } {
    const participante = this.participantesPorSesion.get(sesionId);
    if (!participante) {
      return { salio: false, participantes: this.obtenerParticipantes() };
    }

    this.participantesPorSesion.delete(sesionId);
    this.sesionesPorNombre.delete(participante.nombreNormalizado);

    return { salio: true, participantes: this.obtenerParticipantes() };
  }

  obtenerParticipante(sesionId: string): Participante | undefined {
    return this.participantesPorSesion.get(sesionId);
  }

  tieneProducto(productoId: number): boolean {
    return this.productos.has(productoId);
  }

  // Comprobación y escritura en un mismo bloque sincrónico (sin await en el medio)
  // para evitar duplicados ante propuestas simultáneas.
  agregarProducto(sesionId: string, datos: DatosProductoCatalogo): ResultadoAgregarProducto {
    const participante = this.participantesPorSesion.get(sesionId);
    if (!participante) {
      return {
        ok: false,
        codigo: 'NO_AUTENTICADO',
        motivo: 'Primero tenés que unirte con un nombre',
      };
    }

    if (this.productos.has(datos.id)) {
      return {
        ok: false,
        codigo: 'YA_EN_LISTA',
        motivo: 'El producto ya está en la lista',
      };
    }

    const interno: ProductoInterno = {
      id: datos.id,
      titulo: datos.titulo,
      precio: datos.precio,
      imagen: datos.imagen,
      propuestoPor: participante.nombre,
      propuestoPorNormalizado: participante.nombreNormalizado,
      votos: new Map(),
      ordenLlegada: ++this.secuenciaLlegada,
    };

    this.productos.set(datos.id, interno);
    return { ok: true, producto: this.serializarProducto(interno) };
  }

  votar(sesionId: string, productoId: number): ResultadoAccionLista {
    const participante = this.participantesPorSesion.get(sesionId);
    if (!participante) {
      return { ok: false, motivo: 'Primero tenés que unirte con un nombre' };
    }

    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, motivo: `No existe el producto #${productoId} en la lista` };
    }

    if (producto.votos.has(participante.nombreNormalizado)) {
      return { ok: false, motivo: 'Ya votaste este producto' };
    }

    producto.votos.set(participante.nombreNormalizado, participante.nombre);
    return { ok: true, productos: this.obtenerProductosOrdenados() };
  }

  quitarVoto(sesionId: string, productoId: number): ResultadoAccionLista {
    const participante = this.participantesPorSesion.get(sesionId);
    if (!participante) {
      return { ok: false, motivo: 'Primero tenés que unirte con un nombre' };
    }

    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, motivo: `No existe el producto #${productoId} en la lista` };
    }

    if (!producto.votos.has(participante.nombreNormalizado)) {
      return { ok: false, motivo: 'No habías votado este producto' };
    }

    producto.votos.delete(participante.nombreNormalizado);
    return { ok: true, productos: this.obtenerProductosOrdenados() };
  }

  quitarProducto(sesionId: string, productoId: number): ResultadoAccionLista {
    const participante = this.participantesPorSesion.get(sesionId);
    if (!participante) {
      return { ok: false, motivo: 'Primero tenés que unirte con un nombre' };
    }

    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, motivo: `No existe el producto #${productoId} en la lista` };
    }

    const esAutor = producto.propuestoPorNormalizado === participante.nombreNormalizado;
    const autorConectado = this.sesionesPorNombre.has(producto.propuestoPorNormalizado);

    if (!esAutor && autorConectado) {
      return {
        ok: false,
        motivo: `Solo ${producto.propuestoPor} puede quitar este producto mientras siga conectado`,
      };
    }

    this.productos.delete(productoId);
    return { ok: true, productos: this.obtenerProductosOrdenados() };
  }

  obtenerParticipantes(): string[] {
    return [...this.participantesPorSesion.values()].map((p) => p.nombre);
  }

  obtenerProductosOrdenados(): ProductoEnLista[] {
    return [...this.productos.values()]
      .sort((a, b) => {
        const diffVotos = b.votos.size - a.votos.size;
        if (diffVotos !== 0) {
          return diffVotos;
        }
        return a.ordenLlegada - b.ordenLlegada;
      })
      .map((p) => this.serializarProducto(p));
  }

  obtenerDatosPantalla(): DatosPantalla {
    const ranking: ProductoRanking[] = this.obtenerProductosOrdenados().map((p) => ({
      id: p.id,
      titulo: p.titulo,
      precio: p.precio,
      imagen: p.imagen,
      propuestoPor: p.propuestoPor,
      cantidadVotos: p.cantidadVotos,
    }));

    return {
      ranking,
      cantidadParticipantes: this.participantesPorSesion.size,
    };
  }

  private serializarProducto(interno: ProductoInterno): ProductoEnLista {
    return {
      id: interno.id,
      titulo: interno.titulo,
      precio: interno.precio,
      imagen: interno.imagen,
      propuestoPor: interno.propuestoPor,
      votos: [...interno.votos.values()],
      cantidadVotos: interno.votos.size,
    };
  }
}
