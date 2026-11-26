# TP4 · Lista Compartida de Regalo Grupal en Tiempo Real

Aplicación backend en **Node.js + TypeScript** que coordina una lista compartida en memoria para elegir un regalo grupal, integrada con el catálogo externo de [DummyJSON](https://dummyjson.com/docs/products).

- **Participantes:** se conectan por **WebSocket** estándar para proponer productos, votar, quitar ítems y ver en vivo quiénes están conectados y el estado actualizado de la lista.
- **Pantalla compartida:** se conecta por **Server-Sent Events (SSE)** (`EventSource`) y muestra el ranking en tiempo real y la cantidad de participantes conectados sin enviar nada al servidor.

---

## Requisitos previos

- **Node.js** versión LTS (recomendado Node 22+ LTS).
- **npm** (incluido con Node.js).

## Instalación y ejecución

```bash
npm install
```

### Modo desarrollo (recarga automática con `tsx`)

```bash
npm run dev
```

### Compilar con TypeScript y ejecutar con Node

```bash
npm run build
npm start
```

### Verificación de tipos y pruebas

```bash
npm run typecheck
npm test
```

> **Nota en Windows PowerShell:** si la política de ejecución bloquea `npm.ps1`, usar `npm.cmd` (por ejemplo, `npm.cmd run dev`).

### URLs disponibles (todo en el mismo servidor y puerto)

Con el servidor levantado en el puerto por defecto (`3000`):

- **Participante (WebSocket):** `http://localhost:3000/`
- **Pantalla compartida (SSE):** `http://localhost:3000/pantalla` (también accesible en `/screen`)
- **Stream SSE crudo:** `http://localhost:3000/eventos`
- **Estado y configuración activa:** `http://localhost:3000/health`

Para probar, abrir varias pestañas en `http://localhost:3000/` (con nombres distintos) y una pestaña en `http://localhost:3000/pantalla`.

---

## Configuración por variables de entorno

Toda la configuración se puede ajustar sin modificar el código, ya sea creando un archivo `.env` a partir de [`.env.example`](./.env.example) o pasando variables de entorno al ejecutar el servidor (las variables del entorno siempre tienen prioridad sobre `.env`).

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto único donde el servidor sirve páginas, WebSocket y SSE. |
| `HOST` | `0.0.0.0` | Interfaz de red donde escucha el servidor (permite acceso local y desde la misma red). |
| `CATALOG_BASE_URL` | `https://dummyjson.com` | URL base del catálogo externo de productos. |
| `CATALOG_TIMEOUT_MS` | `5000` | Tiempo máximo de espera (ms) para cada consulta individual al catálogo. |
| `CATALOG_DELAY_MS` | `0` | Demora artificial (ms) que se envía a DummyJSON mediante `?delay=` para simular un catálogo lento. |
| `WS_HEARTBEAT_MS` | `30000` | Intervalo (ms) del heartbeat `ping`/`pong` para detectar conexiones WebSocket muertas. |

### Cómo simular un catálogo lento sin modificar el código

DummyJSON acepta el query parameter `delay` (en milisegundos). Para activar esa demora desde la configuración del servidor:

- **Opción 1 (`.env`):** copiar `.env.example` a `.env` y configurar `CATALOG_DELAY_MS=3000`.
- **Opción 2 (PowerShell):**
  ```powershell
  $env:CATALOG_DELAY_MS="3000"
  npm.cmd run dev
  ```
- **Opción 3 (Bash / macOS / Linux):**
  ```bash
  CATALOG_DELAY_MS=3000 npm run dev
  ```

Si además se quiere forzar un escenario de timeout, basta con configurar un `CATALOG_DELAY_MS` mayor que `CATALOG_TIMEOUT_MS` (por ejemplo `CATALOG_DELAY_MS=6000` y `CATALOG_TIMEOUT_MS=2000`).

---

## Decisiones de diseño

### Nombres de participantes
- No se permiten nombres vacíos ni compuestos solo por espacios (se aplica `trim()` antes de validar).
- Largo máximo: **30 caracteres**.
- **No se permiten nombres duplicados** entre participantes conectados en simultáneo, comparando sin distinguir mayúsculas y minúsculas (*case-insensitive*, ej. `"Ana"` y `"ana"` colisionan). Si una persona se desconecta, su nombre vuelve a quedar libre.
- **Motivo:** evita confusión en la lista de conectados y hace inequívoco quién propuso cada producto y quién votó.

### Productos repetidos
- Si un producto ya está en la lista (mismo `productoId` del catálogo), no se duplica y se informa el código `YA_EN_LISTA` únicamente al participante que lo propuso.
- Si dos participantes proponen el mismo producto al mismo tiempo mientras el catálogo responde, la verificación e inserción final se realizan de forma sincrónica sin `await` en el medio: entra uno solo y el segundo recibe `YA_EN_LISTA`.

### Quién puede quitar productos
- Puede quitar un producto **quien lo propuso**, o **cualquier participante conectado si quien lo propuso ya se desconectó**.
- Esta regla se valida siempre en el servidor.
- **Motivo:** evita que alguien borre arbitrariamente propuestas ajenas mientras su autor sigue participando, pero impide que queden productos "huérfanos" e imborrables si el autor cerró la pestaña.

### Timeout del catálogo externo (`5000 ms`)
- Se eligió **5000 ms** por defecto mediante `AbortSignal.timeout(CATALOG_TIMEOUT_MS)`.
- **Motivo:** es suficiente margen para una respuesta normal de DummyJSON (incluso con demoras moderadas de red o `?delay=3000` al probar catálogo lento), pero acota la espera para no dejar colgada la propuesta ni retener recursos indefinidamente si el servicio externo falla o tarda demasiado.

---

## Contrato de mensajes (WebSocket y SSE)

Todos los mensajes de WebSocket viajan en **JSON** con un campo discriminador `tipo`, definidos mediante uniones discriminadas de TypeScript en [`src/contrato.ts`](./src/contrato.ts) y validados en tiempo de ejecución en el servidor antes de ejecutarse.

### Mensajes WebSocket (Participantes ↔ Servidor)

| Dirección | `tipo` | Campos | Cuándo se envía |
|---|---|---|---|
| Cliente → Servidor | `unirse` | `nombre: string` | Al abrir la conexión, para identificarse y entrar a la lista. |
| Cliente → Servidor | `proponer` | `productoIds: number[]` | Cuando un participante propone entre 1 y 10 productos del catálogo por su ID entero positivo. |
| Cliente → Servidor | `votar` | `productoId: number` | Cuando un participante vota un producto de la lista (una sola vez por producto). |
| Cliente → Servidor | `quitar_voto` | `productoId: number` | Cuando un participante retira su voto de un producto. |
| Cliente → Servidor | `quitar_producto` | `productoId: number` | Cuando el autor del producto (o cualquiera si el autor se desconectó) pide quitarlo de la lista. |
| Servidor → Cliente | `estado_inicial` | `yo: string`, `productos: ProductoEnLista[]`, `participantes: string[]` | Apenas se acepta `unirse`: entrega al recién llegado el estado completo actual sin esperar cambios. |
| Servidor → Todos | `participantes` | `nombres: string[]` | Cada vez que un participante entra o cierra su conexión. |
| Servidor → Todos | `lista_actualizada` | `productos: ProductoEnLista[]` | Cada vez que cambia la lista (se agregan productos válidos, cambia un voto o se quita un producto). Siempre ordenada por `cantidadVotos` descendente. |
| Servidor → Cliente | `resultado_propuesta` | `agregados: ProductoEnLista[]`, `fallidos: FalloPropuesta[]` | Solo a quien envió `proponer`, al terminar de resolver todos los IDs de la propuesta. |
| Servidor → Cliente | `error` | `motivo: string` | Solo a quien envió un mensaje inválido (no es JSON, tipo desconocido, campos fuera de rango o acción no permitida). Nunca cierra el servidor ni avisa al resto. |

#### Estructura de `ProductoEnLista` y `FalloPropuesta`

```json
{
  "id": 1,
  "titulo": "Essence Mascara Lash Princess",
  "precio": 9.99,
  "imagen": "https://cdn.dummyjson.com/product-images/beauty/essence-mascara-lash-princess/thumbnail.webp",
  "propuestoPor": "Ana",
  "votos": ["Ana", "Bruno"],
  "cantidadVotos": 2
}
```

```json
{
  "productoId": 99999,
  "codigo": "NO_EXISTE",
  "motivo": "El producto #99999 no existe en el catálogo"
}
```

Códigos posibles en `fallidos[].codigo`: `NO_EXISTE`, `TIMEOUT`, `YA_EN_LISTA`, `CATALOGO_NO_DISPONIBLE`.

### Eventos Server-Sent Events (Servidor → Pantalla)

La pantalla se conecta a `GET /eventos` con `EventSource` (`Content-Type: text/event-stream`). Cada evento incluye `event`, `id` incremental y `data` en JSON:

| Evento (`event`) | Campos en `data` | Cuándo se envía |
|---|---|---|
| `estado` | `ranking: ProductoRanking[]`, `cantidadParticipantes: number` | Inmediatamente al abrir (o reconectar) la conexión SSE, para evitar mostrar una pantalla vacía. |
| `actualizacion` | `ranking: ProductoRanking[]`, `cantidadParticipantes: number` | Cada vez que cambia la lista de productos, los votos o la cantidad de participantes conectados. |

Además, el servidor envía comentarios periódicos (`: keep-alive`) para evitar que proxies intermedios cierren la conexión por inactividad.

## Comportamiento ante fallos o demoras del catálogo

Toda consulta al catálogo externo (DummyJSON) se ejecuta mediante `fetch` con `AbortSignal.timeout(CATALOG_TIMEOUT_MS)` y en **simultáneo** mediante `Promise.allSettled` (nunca secuencial con `for...of` ni con `forEach(async)`).

### Qué ve cada tipo de usuario

| Escenario | Quien hizo la propuesta | Los demás participantes | La pantalla (SSE) |
|---|---|---|---|
| **El catálogo tarda** (ej. `?delay=3000`) | Espera el mensaje `resultado_propuesta` mientras la UI indica que su propuesta está en curso. Puede seguir viendo cambios de otros en vivo. | No sufren ningún bloqueo: siguen votando, quitando y proponiendo con normalidad porque el `await` libera el Event Loop de Node. | Sigue recibiendo y mostrando cualquier cambio de votos o participantes al instante. |
| **Fallo parcial** (ej. IDs `[1, 99999, 2]`) | Recibe `resultado_propuesta` con los productos válidos en `agregados` y el detalle de cada fallo en `fallidos` (`NO_EXISTE`, `TIMEOUT`, `YA_EN_LISTA` o `CATALOGO_NO_DISPONIBLE`). | Reciben `lista_actualizada` únicamente con los productos válidos agregados. **No reciben los errores ajenos.** | Recibe `actualizacion` con el ranking actualizado (solo los productos agregados). |
| **Timeout o caída total del catálogo** | Recibe `resultado_propuesta` con `agregados: []` y cada ID informado en `fallidos` con código `TIMEOUT` o `CATALOGO_NO_DISPONIBLE` (sin trazas internas ni URLs del proveedor). | No reciben ninguna notificación innecesaria ni se altera la lista. | Sin cambios; la conexión SSE sigue activa. |
| **Dos propuestas simultáneas del mismo ID** | El primero en completar la inserción sincrónica tras el `await` recibe el producto en `agregados`; el segundo recibe `YA_EN_LISTA` en `fallidos`. | Ven el producto una única vez (sin duplicados). | Muestra el producto una única vez. |

## Por qué WebSocket para participantes, SSE para la pantalla y qué cambiaría con polling

### Por qué WebSocket para los participantes
- Un participante **envía acciones con frecuencia** (`unirse`, `proponer`, `votar`, `quitar_voto`, `quitar_producto`) y al mismo tiempo **recibe cambios en vivo** del resto del grupo (`lista_actualizada`, `participantes`, `resultado_propuesta`, `error`).
- **WebSocket** abre una conexión TCP persistente (iniciada mediante `GET` con `Upgrade: websocket` → `101 Switching Protocols`) con comunicación **bidireccional real** y baja latencia en ambos sentidos.
- Además, cada participante queda asociado a su `socket` en el servidor, permitiendo enviar errores y resultados parciales solo a quien originó la acción y detectar al instante su salida mediante el evento `close` y el heartbeat `ping`/`pong`.
- Se utiliza la biblioteca estándar `ws` en el servidor junto con la API `WebSocket` nativa del navegador (sin protocolos propietarios como Socket.IO).

### Por qué Server-Sent Events (SSE) para la pantalla
- La pantalla compartida **solo escucha y muestra** el ranking y la cantidad de participantes; nunca envía datos al servidor.
- **SSE** funciona sobre HTTP común (`GET /eventos` con `Content-Type: text/event-stream`), con dirección **unidireccional Servidor → Cliente**, que encaja exactamente con ese rol sin la complejidad de diseñar un protocolo bidireccional ni heartbeat de aplicación.
- La API `EventSource` del navegador ofrece **reconexión automática nativa** si se corta la red (con `retry` e `id` por evento), y al reconectarse vuelve a recibir inmediatamente el evento `estado` con el ranking al día.

### Qué cambiaría si la pantalla usara polling
Si la pantalla hiciera *short polling* (por ejemplo un `GET /ranking` cada pocos segundos):
- **Demora artificial:** los cambios tardarían hasta un intervalo completo en reflejarse en la pantalla en lugar de verse al instante.
- **Tráfico y carga innecesarios:** enviaría solicitudes HTTP repetidas incluso cuando nadie está votando ni proponiendo nada (mayor overhead de encabezados y conexiones).
- **A cambio**, no mantendría una conexión HTTP abierta por pantalla, algo que solo tiene sentido cuando las novedades son muy poco frecuentes y una demora de varios segundos resulta aceptable. En un ranking en vivo compartido, SSE entrega actualizaciones inmediatas con mínimo consumo y reconexión automática.

## Evidencia y pruebas

> _Espacio reservado para capturas y video/GIF de pruebas (3 participantes + pantalla sincronizados, propuesta con fallos parciales, catálogo lento y respuesta a mensaje inválido)._
