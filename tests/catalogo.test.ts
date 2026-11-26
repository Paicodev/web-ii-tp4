import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ClienteCatalogo, procesarPropuesta } from '../src/catalogo.js';
import { EstadoListaRegalo } from '../src/estado.js';

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });
}

describe('catalogo: consultas concurrentes, fallos parciales y carreras', () => {
  it('incluye ?delay= solo cuando delayMs > 0', () => {
    const sinDelay = new ClienteCatalogo({
      baseUrl: 'https://dummyjson.com/',
      timeoutMs: 5000,
      delayMs: 0,
    });
    assert.equal(sinDelay.construirUrlProducto(7), 'https://dummyjson.com/products/7');

    const conDelay = new ClienteCatalogo({
      baseUrl: 'https://dummyjson.com',
      timeoutMs: 5000,
      delayMs: 3000,
    });
    assert.equal(conDelay.construirUrlProducto(7), 'https://dummyjson.com/products/7?delay=3000');
  });

  it('consulta múltiples productos en simultáneo y maneja fallos parciales', async () => {
    const estado = new EstadoListaRegalo();
    estado.unirse('s1', 'Ana');

    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/products/1') || url.endsWith('/products/2')) {
        const id = url.endsWith('/1') ? 1 : 2;
        await esperar(80, init?.signal ?? undefined);
        return new Response(
          JSON.stringify({ id, title: `Item ${id}`, price: 15.5, thumbnail: `https://img/${id}.png` }),
          { status: 200 }
        );
      }
      if (url.endsWith('/products/999')) {
        await esperar(40, init?.signal ?? undefined);
        return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
      }
      if (url.endsWith('/products/500')) {
        await esperar(600, init?.signal ?? undefined); // dispara TimeoutError (timeoutMs = 120)
        return new Response('{}', { status: 200 });
      }
      if (url.endsWith('/products/503')) {
        return new Response('Unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({ id: 77, title: '' }), { status: 200 }); // formato inválido
    };

    const catalogo = new ClienteCatalogo({
      baseUrl: 'https://catalogo.test',
      timeoutMs: 120,
      delayMs: 0,
      fetchImpl: fetchMock,
    });

    const inicio = performance.now();
    const res = await procesarPropuesta(estado, catalogo, 's1', [1, 2, 999, 500, 503, 77]);
    const duracionMs = performance.now() - inicio;

    assert.equal(res.ok, true);
    if (!res.ok) return;

    // Si fuera secuencial (80+80+40+120 = 320ms+), tardaría mucho más
    assert.ok(duracionMs < 280, `debería ejecutarse en simultáneo (tardó ${Math.round(duracionMs)}ms)`);

    assert.deepEqual(
      res.agregados.map((p) => p.id),
      [1, 2]
    );

    const porId = new Map(res.fallidos.map((f) => [f.productoId, f.codigo]));
    assert.equal(porId.get(999), 'NO_EXISTE');
    assert.equal(porId.get(500), 'TIMEOUT');
    assert.equal(porId.get(503), 'CATALOGO_NO_DISPONIBLE');
    assert.equal(porId.get(77), 'CATALOGO_NO_DISPONIBLE');
  });

  it('evita duplicados cuando dos participantes proponen el mismo producto a la vez', async () => {
    const estado = new EstadoListaRegalo();
    estado.unirse('s1', 'Ana');
    estado.unirse('s2', 'Bruno');

    let llamadas = 0;
    const fetchMock: typeof fetch = async (_input, init) => {
      llamadas += 1;
      await esperar(50, init?.signal ?? undefined);
      return new Response(
        JSON.stringify({ id: 10, title: 'Auriculares', price: 99, thumbnail: 'https://img/10.png' }),
        { status: 200 }
      );
    };

    const catalogo = new ClienteCatalogo({
      baseUrl: 'https://catalogo.test',
      timeoutMs: 2000,
      delayMs: 0,
      fetchImpl: fetchMock,
    });

    const [r1, r2] = await Promise.all([
      procesarPropuesta(estado, catalogo, 's1', [10]),
      procesarPropuesta(estado, catalogo, 's2', [10]),
    ]);

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;

    assert.equal(llamadas, 2);
    assert.equal(r1.agregados.length + r2.agregados.length, 1);
    assert.equal(r1.fallidos.length + r2.fallidos.length, 1);
    assert.equal((r1.fallidos[0] ?? r2.fallidos[0])?.codigo, 'YA_EN_LISTA');
    assert.equal(estado.obtenerProductosOrdenados().length, 1);
  });

  it('deduplica IDs repetidos dentro de una misma propuesta sin doble consulta HTTP', async () => {
    const estado = new EstadoListaRegalo();
    estado.unirse('s1', 'Ana');

    let llamadas = 0;
    const fetchMock: typeof fetch = async () => {
      llamadas += 1;
      return new Response(
        JSON.stringify({ id: 5, title: 'Teclado', price: 50, thumbnail: 'https://img/5.png' }),
        { status: 200 }
      );
    };

    const catalogo = new ClienteCatalogo({
      baseUrl: 'https://catalogo.test',
      timeoutMs: 2000,
      delayMs: 0,
      fetchImpl: fetchMock,
    });

    const res = await procesarPropuesta(estado, catalogo, 's1', [5, 5]);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(llamadas, 1);
    assert.equal(res.agregados.length, 1);
    assert.equal(res.fallidos.length, 1);
    assert.equal(res.fallidos[0]?.codigo, 'YA_EN_LISTA');
  });
});
