const estadoSseEl = document.getElementById('estado-sse');
const cantidadParticipantesEl = document.getElementById('cantidad-participantes');
const rankingEl = document.getElementById('ranking');

function renderizarPantalla(datos) {
  cantidadParticipantesEl.textContent = String(datos.cantidadParticipantes);
  rankingEl.innerHTML = '';

  if (!datos.ranking || datos.ranking.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'vacio';
    vacio.textContent = 'Todavía no hay productos en el ranking.';
    rankingEl.appendChild(vacio);
    return;
  }

  datos.ranking.forEach((producto, indice) => {
    const fila = document.createElement('article');
    fila.className = 'producto';

    const pos = document.createElement('div');
    pos.className = 'posicion';
    pos.textContent = `#${indice + 1}`;

    const img = document.createElement('img');
    img.src = producto.imagen;
    img.alt = producto.titulo;
    img.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'producto-info';

    const titulo = document.createElement('h3');
    titulo.textContent = `${producto.titulo} (ID ${producto.id})`;

    const meta = document.createElement('div');
    meta.className = 'producto-meta';

    const precio = document.createElement('span');
    precio.className = 'precio';
    precio.textContent = `$${producto.precio.toFixed(2)}`;

    const detalle = document.createElement('span');
    detalle.textContent = ` · Propuesto por ${producto.propuestoPor}`;

    meta.append(precio, detalle);
    info.append(titulo, meta);

    const acciones = document.createElement('div');
    acciones.className = 'producto-acciones';

    const badge = document.createElement('span');
    badge.className = 'votos-badge';
    badge.textContent = `${producto.cantidadVotos} ${producto.cantidadVotos === 1 ? 'voto' : 'votos'}`;
    acciones.appendChild(badge);

    fila.append(pos, img, info, acciones);
    rankingEl.appendChild(fila);
  });
}

const fuente = new EventSource('/eventos');

fuente.addEventListener('open', () => {
  estadoSseEl.textContent = 'En vivo (SSE)';
  estadoSseEl.className = 'estado-conexion conectado';
});

fuente.addEventListener('error', () => {
  estadoSseEl.textContent = 'Reconectando...';
  estadoSseEl.className = 'estado-conexion reconectando';
});

function manejarEvento(evento) {
  try {
    const datos = JSON.parse(evento.data);
    renderizarPantalla(datos);
  } catch {
    // Ignorar payloads malformados
  }
}

fuente.addEventListener('estado', manejarEvento);
fuente.addEventListener('actualizacion', manejarEvento);
