const estadoWsEl = document.getElementById('estado-ws');
const bannerErrorEl = document.getElementById('banner-error');
const vistaIngresoEl = document.getElementById('vista-ingreso');
const vistaAppEl = document.getElementById('vista-app');
const formIngresoEl = document.getElementById('form-ingreso');
const inputNombreEl = document.getElementById('input-nombre');
const btnEntrarEl = document.getElementById('btn-entrar');
const cantidadParticipantesEl = document.getElementById('cantidad-participantes');
const listaParticipantesEl = document.getElementById('lista-participantes');
const formProponerEl = document.getElementById('form-proponer');
const inputIdsEl = document.getElementById('input-ids');
const bannerPendienteEl = document.getElementById('banner-pendiente');
const bannerResultadoEl = document.getElementById('banner-resultado');
const listaProductosEl = document.getElementById('lista-productos');

let miNombre = null;
let productosActuales = [];
let participantesActuales = [];
let propuestasEnCurso = 0;

const protocoloWs = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocoloWs}//${location.host}`);

function enviarMensaje(objeto) {
  if (socket.readyState !== WebSocket.OPEN) {
    mostrarError('La conexión con el servidor está cerrada');
    return false;
  }
  socket.send(JSON.stringify(objeto));
  return true;
}

function mostrarError(texto) {
  bannerErrorEl.textContent = texto;
  bannerErrorEl.classList.remove('oculto');
}

function ocultarError() {
  bannerErrorEl.textContent = '';
  bannerErrorEl.classList.add('oculto');
}

function actualizarIndicadorPendiente() {
  if (propuestasEnCurso > 0) {
    const sufijo = propuestasEnCurso === 1 ? 'propuesta en curso' : `${propuestasEnCurso} propuestas en curso`;
    bannerPendienteEl.textContent = `Consultando catálogo (${sufijo})... Podés seguir votando normalmente.`;
    bannerPendienteEl.classList.remove('oculto');
  } else {
    bannerPendienteEl.textContent = '';
    bannerPendienteEl.classList.add('oculto');
  }
}

function mostrarResultadoPropuesta(agregados, fallidos) {
  bannerResultadoEl.innerHTML = '';
  bannerResultadoEl.classList.remove('oculto', 'ok', 'info', 'error');

  if (fallidos.length === 0) {
    bannerResultadoEl.classList.add('ok');
    const titulos = agregados.map((p) => `#${p.id} ${p.titulo}`).join(', ');
    bannerResultadoEl.textContent = `Se agregaron ${agregados.length} producto(s): ${titulos}`;
    return;
  }

  bannerResultadoEl.classList.add(agregados.length > 0 ? 'info' : 'error');

  const resumen = document.createElement('div');
  resumen.textContent =
    agregados.length > 0
      ? `Propuesta parcial: ${agregados.length} agregado(s) y ${fallidos.length} con error.`
      : `No se pudo agregar ningún producto (${fallidos.length} error/es).`;
  bannerResultadoEl.appendChild(resumen);

  const ul = document.createElement('ul');
  for (const fallo of fallidos) {
    const li = document.createElement('li');
    li.textContent = `[${fallo.codigo}] Producto #${fallo.productoId}: ${fallo.motivo}`;
    ul.appendChild(li);
  }
  bannerResultadoEl.appendChild(ul);
}

function renderizarParticipantes() {
  cantidadParticipantesEl.textContent = String(participantesActuales.length);
  listaParticipantesEl.innerHTML = '';

  for (const nombre of participantesActuales) {
    const chip = document.createElement('span');
    chip.className = nombre === miNombre ? 'chip yo' : 'chip';
    chip.textContent = nombre === miNombre ? `${nombre} (vos)` : nombre;
    listaParticipantesEl.appendChild(chip);
  }
}

function renderizarProductos() {
  listaProductosEl.innerHTML = '';

  if (productosActuales.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'vacio';
    vacio.textContent = 'Todavía no hay productos propuestos.';
    listaProductosEl.appendChild(vacio);
    return;
  }

  const miNombreNorm = miNombre ? miNombre.toLowerCase() : '';

  productosActuales.forEach((producto, indice) => {
    const yaVote = producto.votos.some((v) => v.toLowerCase() === miNombreNorm);

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
    const votantesTexto = producto.votos.length > 0 ? ` · Votaron: ${producto.votos.join(', ')}` : '';
    detalle.textContent = ` · Propuesto por ${producto.propuestoPor}${votantesTexto}`;

    meta.append(precio, detalle);
    info.append(titulo, meta);

    const acciones = document.createElement('div');
    acciones.className = 'producto-acciones';

    const badge = document.createElement('span');
    badge.className = 'votos-badge';
    badge.textContent = `${producto.cantidadVotos} ${producto.cantidadVotos === 1 ? 'voto' : 'votos'}`;

    const botones = document.createElement('div');
    botones.className = 'botones-fila';

    const btnVotar = document.createElement('button');
    btnVotar.type = 'button';
    btnVotar.className = yaVote ? 'secundario' : '';
    btnVotar.textContent = yaVote ? 'Quitar voto' : 'Votar';
    btnVotar.addEventListener('click', () => {
      ocultarError();
      enviarMensaje({
        tipo: yaVote ? 'quitar_voto' : 'votar',
        productoId: producto.id,
      });
    });

    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'peligro';
    btnQuitar.textContent = 'Quitar';
    btnQuitar.addEventListener('click', () => {
      ocultarError();
      enviarMensaje({
        tipo: 'quitar_producto',
        productoId: producto.id,
      });
    });

    botones.append(btnVotar, btnQuitar);
    acciones.append(badge, botones);

    fila.append(pos, img, info, acciones);
    listaProductosEl.appendChild(fila);
  });
}

socket.addEventListener('open', () => {
  estadoWsEl.textContent = 'Conectado (WebSocket)';
  estadoWsEl.className = 'estado-conexion conectado';
  btnEntrarEl.disabled = false;
  inputNombreEl.focus();
});

socket.addEventListener('close', () => {
  estadoWsEl.textContent = 'Desconectado';
  estadoWsEl.className = 'estado-conexion desconectado';
  btnEntrarEl.disabled = true;
  propuestasEnCurso = 0;
  actualizarIndicadorPendiente();
  mostrarError('Se cerró la conexión con el servidor. Recargá la página para volver a entrar.');
});

socket.addEventListener('message', (evento) => {
  let mensaje;
  try {
    mensaje = JSON.parse(evento.data);
  } catch {
    return;
  }

  switch (mensaje.tipo) {
    case 'estado_inicial':
      ocultarError();
      miNombre = mensaje.yo;
      productosActuales = mensaje.productos;
      participantesActuales = mensaje.participantes;
      vistaIngresoEl.classList.add('oculto');
      vistaAppEl.classList.remove('oculto');
      renderizarParticipantes();
      renderizarProductos();
      break;

    case 'participantes':
      participantesActuales = mensaje.nombres;
      renderizarParticipantes();
      break;

    case 'lista_actualizada':
      productosActuales = mensaje.productos;
      renderizarProductos();
      break;

    case 'resultado_propuesta':
      if (propuestasEnCurso > 0) {
        propuestasEnCurso -= 1;
        actualizarIndicadorPendiente();
      }
      mostrarResultadoPropuesta(mensaje.agregados, mensaje.fallidos);
      break;

    case 'error':
      if (propuestasEnCurso > 0) {
        propuestasEnCurso -= 1;
        actualizarIndicadorPendiente();
      }
      mostrarError(mensaje.motivo);
      break;
  }
});

formIngresoEl.addEventListener('submit', (e) => {
  e.preventDefault();
  ocultarError();
  enviarMensaje({ tipo: 'unirse', nombre: inputNombreEl.value });
});

formProponerEl.addEventListener('submit', (e) => {
  e.preventDefault();
  ocultarError();

  const tokens = inputIdsEl.value
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    mostrarError('Ingresá al menos un ID numérico de producto');
    return;
  }

  const productoIds = tokens.map((t) => Number(t));
  if (productoIds.some((n) => !Number.isInteger(n) || n <= 0)) {
    mostrarError('Todos los IDs deben ser números enteros positivos (ej: 1, 2, 15)');
    return;
  }

  if (enviarMensaje({ tipo: 'proponer', productoIds })) {
    propuestasEnCurso += 1;
    actualizarIndicadorPendiente();
    inputIdsEl.value = '';
  }
});
