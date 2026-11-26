import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EstadoListaRegalo } from '../src/estado.js';

function productoMock(id: number) {
  return {
    id,
    titulo: `Producto ${id}`,
    precio: id * 10,
    imagen: `https://example.com/${id}.jpg`,
  };
}

describe('estado: EstadoListaRegalo', () => {
  it('rechaza nombres duplicados sin distinguir mayúsculas y libera el nombre al salir', () => {
    const estado = new EstadoListaRegalo();

    const r1 = estado.unirse('s1', 'Ana');
    assert.equal(r1.ok, true);

    const rDup = estado.unirse('s2', 'ana');
    assert.equal(rDup.ok, false);

    const rMismaSesion = estado.unirse('s1', 'Otra');
    assert.equal(rMismaSesion.ok, false);

    estado.salir('s1');
    const rLibre = estado.unirse('s2', 'ANA');
    assert.equal(rLibre.ok, true);
    assert.deepEqual(estado.obtenerParticipantes(), ['ANA']);
  });

  it('exige estar unido antes de agregar, votar o quitar productos', () => {
    const estado = new EstadoListaRegalo();

    assert.equal(estado.agregarProducto('sin-sesion', productoMock(1)).ok, false);
    assert.equal(estado.votar('sin-sesion', 1).ok, false);
    assert.equal(estado.quitarVoto('sin-sesion', 1).ok, false);
    assert.equal(estado.quitarProducto('sin-sesion', 1).ok, false);
  });

  it('permite votar una sola vez, retirar el voto y ordena por cantidad de votos', () => {
    const estado = new EstadoListaRegalo();
    estado.unirse('s1', 'Ana');
    estado.unirse('s2', 'Bruno');

    estado.agregarProducto('s1', productoMock(1));
    estado.agregarProducto('s1', productoMock(2));

    // Producto 2 recibe 2 votos y pasa al primer lugar
    assert.equal(estado.votar('s1', 2).ok, true);
    assert.equal(estado.votar('s1', 2).ok, false); // voto duplicado rechazado
    assert.equal(estado.votar('s2', 2).ok, true);
    assert.equal(estado.votar('s1', 1).ok, true);

    const ordenados = estado.obtenerProductosOrdenados();
    assert.equal(ordenados[0]?.id, 2);
    assert.equal(ordenados[0]?.cantidadVotos, 2);
    assert.equal(ordenados[1]?.id, 1);
    assert.equal(ordenados[1]?.cantidadVotos, 1);

    // Retirar voto de producto 2 (ambos quedan con 1 voto; desempate por orden de llegada -> #1 primero)
    assert.equal(estado.quitarVoto('s2', 2).ok, true);
    assert.equal(estado.quitarVoto('s2', 2).ok, false); // ya no tenía voto

    const trasRetiro = estado.obtenerProductosOrdenados();
    assert.equal(trasRetiro[0]?.id, 1);
    assert.equal(trasRetiro[1]?.id, 2);
  });

  it('solo permite quitar un producto al autor, o a cualquiera si el autor se desconectó', () => {
    const estado = new EstadoListaRegalo();
    estado.unirse('s1', 'Ana');
    estado.unirse('s2', 'Bruno');

    estado.agregarProducto('s1', productoMock(1));
    estado.agregarProducto('s1', productoMock(2));

    // Bruno no puede quitar un producto de Ana mientras Ana está conectada
    assert.equal(estado.quitarProducto('s2', 1).ok, false);

    // Ana sí puede quitar su propio producto
    assert.equal(estado.quitarProducto('s1', 1).ok, true);
    assert.equal(estado.tieneProducto(1), false);

    // Si Ana se desconecta, Bruno ahora sí puede quitar el producto #2
    estado.salir('s1');
    assert.equal(estado.quitarProducto('s2', 2).ok, true);
    assert.equal(estado.tieneProducto(2), false);
  });
});
