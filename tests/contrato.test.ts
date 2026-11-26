import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  interpretarMensaje,
  MAX_LARGO_NOMBRE,
  MAX_PRODUCTOS_POR_PROPUESTA,
} from '../src/contrato.js';

describe('contrato: interpretarMensaje', () => {
  it('rechaza texto que no es JSON válido', () => {
    const res = interpretarMensaje('esto no es JSON');
    assert.equal(res.ok, false);
  });

  it('rechaza valores JSON que no son objetos planos', () => {
    for (const entrada of ['null', '[]', '123', '"texto"', 'true']) {
      const res = interpretarMensaje(entrada);
      assert.equal(res.ok, false, `debería rechazar ${entrada}`);
    }
  });

  it('rechaza mensajes sin campo tipo o con tipo desconocido', () => {
    assert.equal(interpretarMensaje(JSON.stringify({ nombre: 'Ana' })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'inventado' })).ok, false);
  });

  it('valida el mensaje unirse (vacío, largo máximo, caracteres de control y trim)', () => {
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: '' })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: '   ' })).ok, false);
    assert.equal(
      interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: 'a'.repeat(MAX_LARGO_NOMBRE + 1) })).ok,
      false
    );
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: 'Ana\nBot' })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: 42 })).ok, false);

    const valido = interpretarMensaje(JSON.stringify({ tipo: 'unirse', nombre: '  Ana  ' }));
    assert.deepEqual(valido, { ok: true, mensaje: { tipo: 'unirse', nombre: 'Ana' } });
  });

  it('valida el mensaje proponer (entre 1 y 10 enteros positivos)', () => {
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: [] })).ok, false);
    assert.equal(
      interpretarMensaje(
        JSON.stringify({
          tipo: 'proponer',
          productoIds: Array.from({ length: MAX_PRODUCTOS_POR_PROPUESTA + 1 }, (_, i) => i + 1),
        })
      ).ok,
      false
    );
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: [0] })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: [-5] })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: [1.5] })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: ['1'] })).ok, false);
    assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'proponer', productoIds: '1,2' })).ok, false);

    const valido = interpretarMensaje(Buffer.from(JSON.stringify({ tipo: 'proponer', productoIds: [1, 2, 10] })));
    assert.deepEqual(valido, { ok: true, mensaje: { tipo: 'proponer', productoIds: [1, 2, 10] } });
  });

  it('valida votar, quitar_voto y quitar_producto', () => {
    for (const tipo of ['votar', 'quitar_voto', 'quitar_producto'] as const) {
      assert.equal(interpretarMensaje(JSON.stringify({ tipo })).ok, false);
      assert.equal(interpretarMensaje(JSON.stringify({ tipo, productoId: 0 })).ok, false);
      assert.equal(interpretarMensaje(JSON.stringify({ tipo, productoId: -1 })).ok, false);
      assert.equal(interpretarMensaje(JSON.stringify({ tipo, productoId: 2.3 })).ok, false);
      assert.equal(interpretarMensaje(JSON.stringify({ tipo, productoId: '5' })).ok, false);

      const valido = interpretarMensaje(JSON.stringify({ tipo, productoId: 5 }));
      assert.deepEqual(valido, { ok: true, mensaje: { tipo, productoId: 5 } });
    }
  });
});
