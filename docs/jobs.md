# Trabajos persistentes y ejecutor simulado (E7)

Este documento describe `simulation-v1`. E8 amplía la misma cola con `codex-v1`, cuyo aislamiento, configuración, informe y ausencia de reintentos automáticos se documentan en [codex.md](codex.md). No se ejecuta código dentro del proceso del simulador.

En un proyecto, abrir **Trabajos**, desplegar **Nuevo trabajo simulado**, elegir pasos, fallos y límites y pulsar **Encolar simulación**. La API devuelve 202 con un UUID de trabajo y la cabecera `X-FerWeb-Job`. El worker lo ejecuta en segundo plano; cerrar la página o reiniciar la API no elimina el trabajo. La web consulta estado, eventos y resultado guardados y permite cancelar.

El simulador E7 habilita exclusivamente `simulation-v1`. No ejecuta código del repositorio, shell aportada por el usuario, modelos, comandos de Codex ni llamadas a GitHub. El chat E4 y el laboratorio E6 conservan su ciclo de vida anterior: **todavía no se han migrado a esta cola ni adquieren reanudación automáticamente**. Esos adaptadores requieren su propia política de efectos, permisos e idempotencia.

## Componentes y autoridad

- PostgreSQL es la cola y la autoridad de trabajos, intentos, eventos, presupuesto y efectos confirmados. La migración 007 añade `jobs`, `job_attempts`, `job_events`, `job_executors`, `job_charges` y `job_effects`.
- La creación y el evento inicial quedan en la misma transacción SQL. No hay una publicación a Redis/broker que pueda perderse entre dos escrituras; por ese motivo no se añade otro servidor ni un outbox separado.
- `JobQueue` usa transacciones cortas, exclusión asesora para decisiones de asignación/recuperación y `FOR UPDATE SKIP LOCKED` para consumidores. No mantiene una transacción abierta mientras ejecuta un proceso.
- Las transacciones de cola fijan un segundo de `idle_in_transaction_session_timeout`, solo durante esa transacción. Un cliente pausado no puede conservar indefinidamente el bloqueo de cola; las conexiones terminadas se descartan del pool. Hay una prueba que pausa expresamente un proceso con el bloqueo adquirido. No se cambia la configuración global de PostgreSQL.
- `worker` es un servicio Docker independiente de la API. Ejecuta Node compilado y consulta la cola cada 250 ms. Cada intento crea un proceso hijo del simulador mediante IPC, sin heredar argumentos de depuración ni el entorno privado del worker.
- UUID del trabajo es la correlación común de API, tablas, eventos, logs y resultado; número de intento y UUID de ejecutor completan el diagnóstico. Las generaciones de lease/fence son internas y no se devuelven al navegador.

La cola tiene cinco estados: `pending` (pendiente), `running` (ejecutando), `completed` (completado), `failed` (fallido), `cancelled` (cancelado). Un reintento vuelve a pendiente y conserva checkpoint, consumos, intento y eventos. La solicitud de cancelar un trabajo en marcha se muestra mientras se confirma la parada; no se presenta como cancelado inmediatamente sin avisar al proceso.

## Concurrencia, plazos y presupuesto

| Límite | Aplicación |
| --- | --- |
| Concurrencia global | Máximo dos trabajos ejecutando en la base de la instancia, aunque haya varios workers. |
| Concurrencia por proyecto | Máximo un trabajo ejecutando; los demás permanecen en cola. |
| Worker individual | `JOB_WORKER_CONCURRENCY`, 1–2, por defecto 2. Reducirlo no aumenta el máximo SQL global. |
| Plazo total | 1–120 segundos desde la primera asignación; incluye validación, trabajo, reintentos y espera entre ellos. Se conserva al reiniciar. El tiempo inicial en cola no consume ese plazo. |
| Intentos | 1–3 por trabajo. Solo fallos clasificados como transitorios, pérdida del ejecutor, fallo de arranque o apagado ordenado permiten reintento. |
| Backoff | 500 ms y después 1000 ms, con disponibilidad guardada en SQL. Nunca se reintenta un fallo permanente, cancelación, presupuesto agotado o plazo vencido. |
| Simulación | Hasta 30 pasos; 50–1000 ms por paso; consumo declarado de 1–20 unidades y 0–10 000 microdólares ficticios por paso. |
| Admisión | Hasta 50 trabajos activos y 1000 guardados por proyecto; el listado devuelve los últimos 100. No se eliminan trabajos del usuario para liberar cupo. |

El presupuesto máximo es de 1–10 000 unidades y 0–1 000 000 microdólares **simulados**. Estos importes prueban límites contables: no son gasto de API, estimación de proveedor ni dinero realmente consumido. Los valores se guardan como enteros en microdólares, sin redondeo monetario por paso.

Antes de cada paso, el worker reserva unidades y coste en SQL verificando límites acumulados. La reserva se identifica por trabajo/intento/paso y una repetición del mismo mensaje no vuelve a cobrarla. Si el proceso falla o desaparece después de reservar, la reserva se conserva; no se devuelve silenciosamente ni se reinicia el presupuesto en el siguiente intento. Antes de reintentar se comprueba que queda presupuesto para otro paso. Los límites nunca se amplían por un reinicio.

La transición del efecto del simulador y su checkpoint es atómica. `job_effects` tiene clave única por trabajo/paso; el siguiente intento parte del último paso confirmado. Un fallo después de confirmar un efecto no lo repite. Esto asegura idempotencia de los **efectos SQL de esta simulación**, no una garantía general de ejecución exactamente una vez para servicios externos. Codex, llamadas facturables y escrituras remotas necesitan mecanismos propios antes de ser admitidos.

## Leases, desconexión y reinicios

Cada asignación obtiene un token nuevo de generación y una lease, por defecto cinco segundos. Heartbeat de 500 ms renueva la lease tras comprobar el estado persistente. Cada reserva y checkpoint comprueba estado, generación, ejecutor, lease, plazo, cancelación y archivo del proyecto dentro de la transacción. Un ejecutor antiguo no puede publicar efectos ni sobrescribir el resultado de un intento nuevo.

El proceso simulado vigila su propia conexión IPC, el vencimiento de la lease y el plazo total. La renovación se comunica después de confirmarse en SQL. Si el worker muere, el hijo sale al cerrarse IPC. Si el worker se pausa, el hijo sigue vigilando su lease y se detiene al vencer. Los contenedores de una misma instancia Docker comparten reloj; despliegues distribuidos requerirán revisar sincronización y márgenes, además del resto de condiciones de operación.

Al vencer una lease más un segundo de margen, otro worker —o una consulta autenticada de estado— puede recuperar el registro. Se marca el intento perdido, se invalida su generación y se decide en una transacción: cancelar, completar si todos los efectos ya están confirmados, fallar por límites o programar un reintento permitido. No se usa un PID guardado de un ejecutor antiguo para matar procesos posteriores, porque un PID puede reutilizarse.

Al detener/reiniciar el worker ordenadamente, se detienen sus procesos activos y se programan los reintentos que correspondan. Con SIGKILL no hay confirmación final de ese worker; la base conserva el último checkpoint y la recuperación sucede tras el vencimiento. Si no hay ningún worker disponible, el trabajo permanece pendiente hasta que vuelva uno. El estado expone si la conexión del ejecutor puede confirmarse.

## Cancelación efectiva

Cancelar pendiente es inmediato y no crea proceso. Cancelar ejecutando guarda la solicitud; el heartbeat la detecta y envía SIGTERM al grupo del proceso hijo. Si no sale en 500 ms, se envía SIGKILL. Se espera el evento de salida antes de cerrar el intento y se guardan código/señal y `terminationConfirmed`.

El proceso cooperativo del simulador también sale si se desconecta del padre. Si el ejecutor desaparece, la API no inventa una confirmación física: el intento perdido muestra `terminationConfirmed: null`, aunque las pruebas puedan observar por separado que el watchdog terminó el proceso. Los datos ya recibidos o efectos confirmados antes de cancelar no se revierten.

Archivar el proyecto impide nuevas admisiones; trabajos en cola se cancelan al mantener la cola y los activos detectan el archivo en el siguiente control. El historial y la cancelación siguen disponibles. Los trabajos autorizados persisten tras cerrar la página o salir de la sesión; el worker opera sobre el trabajo guardado y no necesita conservar la cookie del usuario.

## Progreso, API y seguridad

Eventos persistentes con secuencia creciente: cola, asignación, inicio de proceso, reserva, progreso confirmado, salida, pérdida de ejecutor, reintento y estado terminal. La web consulta incrementalmente por cursor, conserva el avance y recupera eventos al volver. No se depende de una conexión SSE en memoria ni de que el navegador permanezca abierto.

Todos bajo `/api/projects/:projectId/jobs`:

| Método/ruta | Contrato |
| --- | --- |
| `GET /` | Últimos 100 trabajos del proyecto propio. |
| `POST /` | `requestId`, título, simulación y límites. Devuelve 202 y el trabajo persistido. |
| `GET /:jobId` | Trabajo, intentos y límites globales. |
| `GET /:jobId/events?after=N` | Hasta 100 eventos, `nextCursor` y `hasMore`. Puede reproducirse tras reconectar. |
| `POST /:jobId/cancel` `{}` | Solicitud de cancelación idempotente. |

El UUID de creación es único por proyecto: reenviar las mismas condiciones devuelve el mismo trabajo; reutilizarlo con otras condiciones devuelve 409. No se aceptan estado, comandos, scripts, rutas, variables de entorno ni credenciales del cliente. Se comprueba propiedad del proyecto en cada lectura y mutación; recursos ajenos y mal asociados devuelven 404. Las mutaciones mantienen Origin, JSON y cabecera de FerWeb. Logs incluyen IDs/estado, sin configuración privada ni salida cruda del simulador.

El worker no recibe configuración GitHub, claves de IA ni socket Docker. Su proceso hijo recibe solo PATH/LANG/NODE_ENV y el canal IPC. En Compose el worker usa usuario no root, raíz de solo lectura, `/tmp` temporal limitado, capacidades eliminadas, `no-new-privileges`, máximo 64 PIDs, 384 MiB y una CPU. No publica puertos al anfitrión; `/health` interno comprueba actividad reciente de la cola/base.

**Este mecanismo solo admite un simulador de confianza.** El worker padre necesita credenciales SQL y comparte contenedor/UID con sus hijos; limpiar el entorno y usar un contenedor no aísla código hostil de `/proc`, del sistema de archivos o de la red. No se presenta como sandbox suficiente para repositorios. E8 debe diseñar y verificar una frontera de ejecución independiente antes de admitir código o herramientas reales.

## Operación Docker

```powershell
npm run docker:up
npm run docker:status
npm run docker:logs
npm run docker:restart
npm run docker:stop
```

El worker se construye con el Dockerfile Node existente y su lockfile, sin dependencia nueva ni motor Redis. `compose.ca.yaml` le aporta la CA de construcción cuando corresponde, sin desactivar TLS. `JOB_WORKER_LEASE_MS` admite 2000–30000 ms; no cambiarlo para reducir márgenes sin revisar carga/latencia. La autoridad sigue en `ferweb_postgres_data`; el worker no necesita otro volumen persistente.

## Evidencia y límites

`jobs.integration.ts` crea una base desechable y arranca API y workers como procesos Node separados dentro de Docker. Comprueba duplicados, permisos, checkpoints, presupuesto, dos consumidores, concurrencia, reinicio de API, SIGKILL, SIGSTOP, watchdog del hijo, relevo, tokens antiguos rechazados, fallos transitorios/permanentes, cancelación forzada y plazo. Los efectos son filas sintéticas de prueba; no se toca código, modelos ni cuentas externas.

Chromium recorre encolar, ver eventos, recargar y volver al mismo trabajo, resultado persistente y cancelación confirmada. Los recursos de prueba se eliminan por su nombre aleatorio; nunca se vacía la base o los trabajos del usuario. Ver verificaciones realmente ejecutadas en [status.md](status.md).

Fuera del alcance del simulador: migración del chat/laboratorio a la cola, costes o presupuestos de proveedor reales, garantía de aislamiento hostil, despliegue distribuido y pruebas de carga. El adaptador de código/Codex se implementa por separado en E8 según [codex.md](codex.md), sin reintentos automáticos de sus efectos.

Referencias: [PostgreSQL 18, SELECT y SKIP LOCKED](https://www.postgresql.org/docs/18/sql-select.html), [Node, procesos hijo](https://nodejs.org/docs/latest-v24.x/api/child_process.html), [Node 24, señales e IPC](https://nodejs.org/docs/latest-v24.x/api/process.html).
