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

### Verificación rápida del servidor

Con el servidor levantado, abrir en el navegador o consultar:

```text
http://localhost:3000/health
```

Devuelve `200 OK` con el estado del servidor y la configuración activa del catálogo.

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
- Si un producto ya está en la lista (mismo `productId` del catálogo), no se duplica y se informa el motivo `ALREADY_EXISTS` únicamente al participante que lo propuso.
- Si dos participantes proponen el mismo producto al mismo tiempo mientras el catálogo responde, la verificación e inserción final se realizan de forma sincrónica sin `await` en el medio: entra uno solo y el segundo recibe `ALREADY_EXISTS`.

### Quién puede quitar productos
- Puede quitar un producto **quien lo propuso**, o **cualquier participante conectado si quien lo propuso ya se desconectó**.
- Esta regla se valida siempre en el servidor.
- **Motivo:** evita que alguien borre arbitrariamente propuestas ajenas mientras su autor sigue participando, pero impide que queden productos "huérfanos" e imborrables si el autor cerró la pestaña.

### Timeout del catálogo externo (`5000 ms`)
- Se eligió **5000 ms** por defecto mediante `AbortSignal.timeout(CATALOG_TIMEOUT_MS)`.
- **Motivo:** es suficiente margen para una respuesta normal de DummyJSON (incluso con demoras moderadas de red o `?delay=3000` al probar catálogo lento), pero acota la espera para no dejar colgada la propuesta ni retener recursos indefinidamente si el servicio externo falla o tarda demasiado.

---

## Contrato de mensajes (WebSocket y SSE)

> _En construcción — se completará en los Pasos 2 y 4._

## Comportamiento ante fallos o demoras del catálogo

> _En construcción — se completará en el Paso 3._

## Por qué WebSocket para participantes, SSE para la pantalla y qué cambiaría con polling

> _En construcción — se completará en el Paso 4._

## Evidencia y pruebas

> _Espacio reservado para capturas y video/GIF de pruebas (3 participantes + pantalla sincronizados, propuesta con fallos parciales, catálogo lento y respuesta a mensaje inválido)._
