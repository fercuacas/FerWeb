# Contrato HTTP de FerWeb (E2–E6)

E6 añade [laboratorio por proyecto](laboratory.md#exportación-y-contrato): casos/mensajes congelados, tarifas inmutables, lotes, intentos, revisiones versionadas y exportación autorizada. Ejecutar es una acción explícita y no reintenta un lote ya iniciado. Datos ausentes siguen siendo desconocidos.

E5 añade [contexto del repositorio](retrieval.md#contrato-http): estado, ingesta incremental, búsqueda y fuentes guardadas por turno. Los mensajes aceptan `repositoryContext` opcional (false por defecto). Se conserva el resto de contratos E2–E4 y los controles de sesión/origen.

Los DTO y esquemas de entrada están en [contracts](../packages/contracts/src/index.ts). Las rutas se montan bajo `/api`. Las respuestas no se almacenan en caché y llevan `X-Request-Id`.

## Identidad y sesión

| Método y ruta | Resultado |
| --- | --- |
| `GET /auth/session` | 200 con `{ user: null }` o `{ user: { id, email } }`. |
| `POST /auth/login` | JSON `{ email, password }`; 200 con usuario y cookie nueva. |
| `POST /auth/logout` | JSON `{}`; 204, revoca la sesión presentada y borra la cookie. |

No existe endpoint de registro. El CLI provisiona un propietario y rechaza repetir el proceso si ya hay una cuenta. Las cuentas adicionales usadas en tests son fixtures privados de bases desechables.

La cookie es `ferweb_session`, de ámbito `/api`, `HttpOnly`, `SameSite=Strict` y ocho horas máximas. `COOKIE_SECURE` controla el atributo `Secure` para el futuro uso por HTTPS. Solo se almacena SHA-256 del token aleatorio de 256 bits en PostgreSQL. El login rota la sesión previa del mismo usuario; logout y expiración la invalidan. No se devuelve el token como JSON.

La contraseña de propietario admite 12–128 caracteres. Se guarda mediante scrypt con sal de 16 bytes y parámetros versionados N=32768, r=8, p=3. El login devuelve el mismo error para correo inexistente y contraseña incorrecta. Tiene límite persistente de diez intentos por cuenta/IP y cincuenta por IP en ventanas de quince minutos. Tras un login válido se reinicia el contador de cuenta/IP. `trust proxy` no está habilitado; detrás del proxy de desarrollo se comparte la IP del proxy.

## Solicitudes que modifican datos

Todos los POST/PATCH requieren JSON, `Origin` igual a `APP_ORIGIN` y cabecera `X-FerWeb-Request: 1`. Se rechaza Fetch Metadata `cross-site`. No se habilita CORS. La web envía la cabecera y el navegador aporta el origen; los clientes de pruebas/API deben incluir ambos explícitamente.

El parser limita el cuerpo a 96 KiB. La configuración local deriva el origen desde `WEB_PORT`; configurar otro host requiere definir `APP_ORIGIN`. Este flujo no pretende dar acceso por Internet a una instalación HTTP de desarrollo.

## Proyectos

Todas las rutas siguientes requieren una sesión válida.

| Método y ruta | Entrada / resultado |
| --- | --- |
| `GET /projects` | `{ projects: Project[] }` del usuario, incluidos archivados. |
| `POST /projects` | `{ name, description }`; 201 con `{ project }`. |
| `GET /projects/:projectId` | 200 con `{ project }` propio; 404 si no existe o pertenece a otro usuario. |
| `PATCH /projects/:projectId` | `version` y uno o más de `name`, `description`, `archived`; 200 con `{ project }`. |

`Project` contiene `id`, `name`, `description`, `archivedAt`, `createdAt`, `updatedAt` y `version`. Nombre: 1–120 caracteres tras trim. Descripción: hasta 4000. Propietario y timestamps se determinan en servidor; las entradas con campos adicionales se rechazan.

Archivar usa `{ version, archived: true }`. Restaurar usa `{ version, archived: false }`. Un proyecto archivado solo admite restauración; su contenido sigue siendo consultable. No hay borrado permanente de proyectos.

## Tareas

| Método y ruta | Entrada / resultado |
| --- | --- |
| `GET /projects/:projectId/tasks` | `{ tasks: Task[] }`; filtros opcionales `q`, `priority`, `status`. |
| `POST /projects/:projectId/tasks` | `TaskInput`; 201 con `{ task }`. |
| `GET /projects/:projectId/tasks/:taskId` | 200 con `{ task }` si usuario y proyecto coinciden. |
| `PATCH /projects/:projectId/tasks/:taskId` | Campos completos de `TaskInput` y `version`; 200 con `{ task }`. |

`TaskInput`:

- `title`: 1–160 caracteres tras trim.
- `description`: hasta 10000 caracteres.
- `priority`: `low`, `medium`, `high` o `urgent`.
- `status`: `todo`, `in_progress` o `done`.
- `acceptanceCriteria`: array de hasta 30 textos no vacíos, hasta 500 caracteres cada uno.

`Task` añade `id`, `projectId`, `createdAt`, `updatedAt` y `version`. Los criterios son texto, no HTML ni instrucciones ejecutables. `q` busca una subcadena en título/descripción sin distinguir mayúsculas y admite hasta 200 caracteres. No hay borrado de tareas en esta entrega; se completan cambiando su estado.

La API comprueba propietario tanto en lecturas como en escrituras y cruza tarea con proyecto. Una tarea válida no puede consultarse ni modificarse bajo otro proyecto. Las modificaciones bloquean la fila del proyecto para serializarse con archivo/restauración.

## Versiones y errores

Cada modificación incrementa `version`. La versión enviada debe coincidir con la almacenada. Un conflicto devuelve 409 y no sobrescribe datos. La interfaz conserva el borrador y explica cómo abrir la versión actual. Las tareas de proyectos archivados también devuelven 409 ante escritura.

Los errores de operaciones E2 usan `{ error: { code, message } }`, sin SQL, claves ni hashes:

| Estado | Significado |
| --- | --- |
| 400 | Entrada, UUID, campos adicionales o JSON inválidos. |
| 401 | Sin sesión vigente o credenciales incorrectas. |
| 403 | Origen o cabecera de solicitud rechazados. |
| 404 | Proyecto/tarea inexistente o ajeno; mismo mensaje en ambos casos. |
| 409 | Versión desactualizada o proyecto archivado. |
| 413 | Cuerpo superior al límite. |
| 415 | Tipo de contenido no JSON. |
| 429 | Límite de intentos de login. |

El manejador general conserva el error genérico heredado de E1 (`{ error: "internal_error" }` para fallos imprevistos, 500). Una ruta desconocida puede responder `{ error: "not_found" }`, 404. La web maneja estos errores sin mostrar datos internos.

## GitHub App (E3)

Las rutas autenticadas heredan la sesión, el control de origen/cabecera y el aislamiento de propietario. Solo callback y webhook son públicos y se montan antes del parser JSON del espacio. Los contratos están en [github.ts](../packages/contracts/src/github.ts).

| Método y ruta bajo `/api` | Entrada / resultado |
| --- | --- |
| `GET /github/status` | `configured`, `connected`, `login`, `expiresAt`, `installUrl`; nunca tokens. |
| `POST /github/authorize` | `{}`; URL de autorización de GitHub App con estado aleatorio y PKCE. |
| `GET /github/callback?state=…&code=…` | Consume estado de sesión y código; redirige al hash GitHub con `authorization=connected` o `failed`, sin reflejar parámetros sensibles. |
| `POST /github/disconnect` | `{}`; 204. Elimina credencial, instalaciones y vínculos locales del propietario; conserva proyectos/tareas. |
| `GET /github/installations` | Instalaciones de esta App accesibles al usuario, indicando cuáles están conectadas localmente. |
| `POST /github/installations` | `{installationId}`; verifica App/usuario/permisos y conecta; 204. |
| `GET /github/installations/:id/repositories?page=1` | Repositorios accesibles en una instalación conectada, páginas de 100; `nextPage` o `null`. Páginas 1–10. |
| `GET /projects/:projectId/github` | `{link: null}` o vínculo/snapshot autorizado. Revalida permisos remotos; los snapshots revocados no se devuelven. |
| `POST /projects/:projectId/github` | `{installationId, repositoryId, branch?, version}`. `version: 0` para crear; versión actual para reemplazar. Devuelve vínculo sin snapshot y pendiente de sincronizar. La web solicita después su primera sincronización. |
| `DELETE /projects/:projectId/github` | `{version}`; desvincula, 204. |
| `POST /projects/:projectId/github/sync` | `{version}`; consulta repositorio/rama/commit, árbol, issues y PR; publica snapshot e incrementa versión si el vínculo y la generación de eventos siguen coincidiendo. |
| `GET /projects/:projectId/github/file?path=…&version=…` | Texto UTF-8 de un blob perteneciente al snapshot solicitado, con `path`, `commit`, `sha`, `content`, `stale`. No admite un SHA o repositorio arbitrario. |
| `POST /github/webhook` | JSON original, cabeceras `X-Hub-Signature-256`, `X-GitHub-Delivery` y `X-GitHub-Event`; `{accepted, duplicate, outcome}`. No requiere cookie ni origen de navegador. |

`link` contiene instalación/repositorio, nombre, rama, versión, `stale`, `revoked`, fecha y snapshot nullable. El snapshot contiene metadatos, commit del código, árbol filtrado, issues/PR, indicadores de truncado y fecha de observación. Las issues/PR reflejan una consulta temporal, no el estado del commit. Los proyectos archivados permiten lectura autorizada pero rechazan vincular, sincronizar y desvincular con 409. Un ID de proyecto ajeno sigue devolviendo 404 antes de consultar GitHub.

Errores específicos: 503 `github_unconfigured`/`github_key_changed`, 409 `github_reauthorize`/`github_installation`/`github_changed`, 403 `github_access_denied`, 429 `github_rate_limited`, 502 `github_unavailable`/`github_response` y 504 `github_timeout`. El lector devuelve 415 para formatos/tamaños no soportados. Webhooks: 401 firma inválida, 400 cabeceras/payload inválidos, 413 tamaño excesivo, 415 compresión y 409 ID reutilizado con distinto cuerpo/evento. Los errores no incluyen el cuerpo de GitHub ni credenciales.

Sincronización manual y webhooks no escriben en GitHub. Los webhooks invalidan y revocan; no generan llamadas remotas ni trabajos externos. Configuración, permisos, exclusiones y límites exactos en [github.md](github.md).

## Conversaciones e IA (E4)

Todas estas rutas heredan identidad, propiedad por proyecto y protección de origen/cabecera para mutaciones. Los DTO están en [chat.ts](../packages/contracts/src/chat.ts). No se aceptan claves, historial ni roles enviados por el cliente: el backend construye el contexto autorizado desde PostgreSQL.

| Método y ruta bajo `/api` | Entrada / resultado |
| --- | --- |
| `GET /projects/:projectId/ai/models?provider=ollama` | Catálogo del proveedor elegido: `available`, modelos permitidos/disponibles con revisión nullable y error normalizado o null. También admite `openai`. |
| `GET /projects/:projectId/conversations` | `{conversations}` del proyecto, máximo 100. |
| `POST /projects/:projectId/conversations` | `{title, provider, model, configuration:{maxOutputTokens}}`; 201 con conversación y turnos vacíos. Proveedor/modelo/configuración quedan fijos. |
| `GET /projects/:projectId/conversations/:conversationId` | `{conversation,turns}` ordenados por secuencia. Recupera turnos cuya lease haya expirado como interrumpidos, sin volver a generar. |
| `POST /projects/:projectId/conversations/:conversationId/turns` | `{requestId, version, content}`. Admite el turno transaccionalmente y devuelve SSE. UUID repetido, versión antigua o generación activa: 409, sin otra inferencia. |
| `POST /projects/:projectId/conversations/:conversationId/turns/:turnId/cancel` | `{}`; petición persistente de cancelación y cierre del upstream. Devuelve el turno conocido; si ya terminó no modifica su estado final. Se admite también en proyectos archivados. |

La versión de conversación comienza en cero y aumenta al admitir cada envío. Un turno guarda juntos prompt y respuesta, IDs de contexto, configuración, modelo solicitado/reportado, revisión observada en catálogo, estado, fechas, tiempos, consumo, motivo y errores. Estados: `streaming`, `completed`, `incomplete`, `cancelled`, `error`, `interrupted`.

El flujo SSE usa `data: <JSON>` seguido de una línea vacía. Eventos: `started` con turno admitido; `delta` con texto incremental; `done` con registro final persistido; `error` si no se puede confirmar el guardado. Los comentarios heartbeat no son mensajes. Un error previo a abrir SSE conserva el contrato JSON normal; después de iniciarlo no se cambia retrospectivamente el código HTTP 200. El navegador debe revisar el evento final y refrescar historial si falta confirmación.

Errores: 422 para modelo/configuración/contexto/límites; 409 para concurrencia/archivo; 503 para servicio no disponible; 404 común para recursos ajenos o inexistentes. Los errores de proveedor posteriores a la admisión se almacenan en el turno con texto parcial y uso disponible. Cancelación remota confirmada y métricas ausentes son `null`, no cero ni una afirmación de que no habrá coste.

La API revisa sesión y estado del proyecto durante el flujo. La cancelación usa una señal inmediata y un indicador persistente; la lease/heartbeat permite detectar una caída sin reintentar automáticamente inferencia. Configuración privada, topología Docker, políticas de historial, métricas y límites en [ai.md](ai.md).

## Trabajos persistentes (E7)

Todas las rutas heredan sesión, propiedad por proyecto y protección de mutaciones. Contratos estrictos en [jobs.ts](../packages/contracts/src/jobs.ts); guía, estados, semántica de límites y recuperación en [jobs.md](jobs.md).

| Método y ruta bajo `/api/projects/:projectId/jobs` | Entrada / resultado |
| --- | --- |
| `GET /` | `{jobs}`: los últimos 100, por creación descendente. |
| `POST /` | `{requestId,title,simulation,limits}`; 202, `{job,attempts,limits}` y cabecera `X-FerWeb-Job`. Mismo UUID/condiciones devuelve el mismo trabajo; condiciones distintas, 409. |
| `GET /:jobId` | `{job,attempts,limits}` con eventos consultables por separado. |
| `GET /:jobId/events?after=N` | `{events,nextCursor,hasMore}`, hasta 100 y secuencia creciente. |
| `POST /:jobId/cancel` | `{}`; devuelve detalle. En marcha confirma primero solicitud y solo cierra tras salida o recuperación; terminal es idempotente. |

La admisión E7 crea únicamente `simulation-v1`, sin comandos ni credenciales del cliente. Cinco estados: `pending`, `running`, `completed`, `failed`, `cancelled`. Cada DTO/evento/resultado identifica trabajo; intentos identifican ejecutor y proceso. Uso y coste de ese simulador son reservas acumuladas **simuladas**, no métricas de proveedor. Lectura, eventos y cancelación también admiten `codex-v1` desde E8, con consumo en su informe específico. La confirmación de parada puede ser `null` tras pérdida del ejecutor. El archivo impide nuevas admisiones y solicita detener las pendientes/activas; conserva lectura y cancelación. Recursos ajenos o asociados a otro proyecto devuelven 404; input inválido 400; archivo/idempotencia 409; cupo 422.

## Tareas de programación con Codex (E8)

Se conservan las rutas de estado/eventos/cancelación E7 y sus cinco estados para `codex-v1`. El contador de unidades ficticias del simulador no representa uso Codex; este se consulta en el informe. Solo la ruta de admisión siguiente crea trabajos de código.

| Método y ruta bajo `/api` | Entrada / resultado |
| --- | --- |
| `GET /projects/:projectId/coding/capabilities` | Conserva `{available,models,simulated,environment}` y añade `execution` con el diagnóstico normalizado. Exige acceso al proyecto. |
| `POST /projects/:projectId/coding` | `{requestId,taskId,taskVersion,commit,model,timeoutMs,maxRequests,maxOutputTokens}`; 202, detalle de trabajo y `X-FerWeb-Job`. Tarea/commit guardados antes de encolar. |
| `GET /projects/:projectId/coding/:jobId` | `{jobId,task,commit,repository,baseBranch,environment,manifest,excluded,report}`. Revalida acceso GitHub antes de devolver informe o fuentes congeladas. |

Campos extra como `command`, credenciales, rutas de montaje o imagen son rechazados. Error 400 para input inválido; 404 para ámbito ajeno; 409 para tarea/commit/snapshot modificados, archivo o UUID conflictivo; 422 para tamaño/cupo; 503 para ejecutor/modelo sin configurar; 403 o error de autorización GitHub si no se confirma acceso a la fuente. El modelo se elige de una lista del servidor. Contratos en [coding.ts](../packages/contracts/src/coding.ts).

La ruta interna `POST /internal/coding/:jobId/input` requiere token de servidor y generación de lease vigente. No usa cookie de navegador ni acepta escoger propietario/repositorio; el servidor los obtiene del trabajo admitido y revalida acceso. No se envía ese token al contenedor de código. La API del controlador no se expone al anfitrión ni ofrece opciones Docker arbitrarias al cliente. Semántica, configuración y evidencia en [codex.md](codex.md).

`GET /api/execution/capabilities` exige sesión y devuelve `{options}` con Codex y las dos rutas de chat. Cada opción indica proveedor, runtime, destino, perfil, disponibilidad, motivo, modelos, simulación y revisión observada. La consulta usa el catálogo existente de IA y el descriptor del controlador. El estado público de salud sigue un recorrido independiente. [Contrato](../packages/contracts/src/execution.ts)

## Catálogo de agentes (P02)

Rutas autenticadas bajo `/api/projects/:projectId/agents`.

| Método y sufijo | Entrada y resultado |
| --- | --- |
| `GET /` | `{ roles, templates }` con la versión actual de cada rol del proyecto. |
| `POST /` | Definición completa o `{ template }` con el identificador de una plantilla. Devuelve 201 con `{ role }`. |
| `GET /:agentId` | `{ role, versions }` con las versiones inmutables, de la última a la primera. |
| `PATCH /:agentId` | `{ version, definition, skillIds? }`. La versión indicada debe ser la última. Omitir `skillIds` conserva los vínculos. Devuelve `{ role }` con la versión siguiente. |
| `POST /:agentId/archive` | `{ version }` de la última versión. Devuelve `{ role }` con la fecha de archivo y mantiene el historial. |

La definición incluye `name`, `purpose`, `instructions`, `outputFormat`, `requiredCapabilities` y `allowedToolProfiles`. La procedencia la asigna el servidor. Las escrituras sobre proyectos o roles archivados y las ediciones concurrentes devuelven 409. Los recursos ajenos devuelven 404.

`POST /projects/:projectId/coding` admite opcionalmente `agent: { id, version }`. Devuelve 422 con `agent_incompatible` si el perfil de herramientas o las capacidades de la versión no encajan. El detalle de la ejecución devuelve `agent` con la versión congelada o `null` para trabajos sin rol. [Uso y límites](codex.md#roles-versionados-por-proyecto-p02)

## Biblioteca de skills (P03)

Rutas autenticadas bajo `/api/projects/:projectId/skills`.

| Método y sufijo | Entrada y resultado |
| --- | --- |
| `GET /` | `{ versions, curated }` con metadatos, recursos, compatibilidad y estados. |
| `POST /` | `{ manifest }` o `{ curated }` con el identificador de una entrada incluida. Devuelve 201 y `{ skill }`. |
| `GET /:skillId` | `{ skill }` con los metadatos, aviso de licencia y texto de una versión. |
| `POST /:skillId/review` | `{ sha256, state }` con el hash del paquete y el estado terminal `approved` o `rejected`. Devuelve `{ skill }`. |

Ejemplo de archivo JSON para importar desde la web. El SHA-256 se calcula sobre los bytes UTF-8 antes de codificarlos en Base64.

```json
{
  "format": 1,
  "slug": "guia-revision",
  "name": "Guía de revisión",
  "description": "Revisión básica de cambios",
  "purpose": "review",
  "technologies": ["typescript"],
  "license": "LicenseRef-Project",
  "notice": "Material de ejemplo para uso en este proyecto.",
  "source": "Guía interna del proyecto",
  "requiredCapabilities": ["text"],
  "allowedToolProfiles": ["node-isolated-v1"],
  "resources": [{ "kind": "file", "name": "guia.md" }],
  "files": [{
    "path": "guia.md",
    "type": "file",
    "sha256": "39e93df4e7dedc90e6e07f8c3edde0d05737966a3cbca67a990a098dcb6c8ea5",
    "contentBase64": "UmV2aXNhIGVsIGRpZmYuCg=="
  }]
}
```

El UUID identifica una versión concreta. La API devuelve 404 para recursos ajenos, 409 para hash de revisión obsoleto, estados terminales incompatibles o proyectos archivados y 422 para contenido inválido o dependencias bloqueadas. Solo una versión aprobada del mismo proyecto puede vincularse a un rol. `GET /coding/:jobId` incluye el texto congelado bajo `agent.materials` cuando se usó material. [Contratos](../packages/contracts/src/skills.ts)

## Presupuesto de ejecución (P04)

Rutas autenticadas bajo `/api/projects/:projectId/budgets`.

| Método y sufijo | Entrada y resultado |
| --- | --- |
| `GET /` | `{ budgets }` con los últimos cien presupuestos del proyecto y su contabilidad. |
| `POST /` | `{ requestId, name, limits: { maxRequests, timeoutMs, concurrency: 1 } }`. Devuelve 201 y `{ budget }`. |
| `GET /:budgetId` | `{ budget }` con reserva, admisiones, uso conocido y cobertura. |
| `POST /:budgetId/cancel` | `{}`. Cierra nuevas admisiones y conserva el consumo. |

Los límites admiten 1–20 peticiones y 10 000–1 200 000 ms. El UUID de creación es idempotente por proyecto. Los presupuestos ajenos devuelven 404 y las condiciones incompatibles, cancelación o plazo agotado devuelven 409. Los campos monetarios se rechazan por el contrato estricto.

`POST /coding` acepta `budgetId` opcional y `attribution` opcional (`agent`, `coordinator`, `selection`, `summary` o `reviewer`). Sin presupuesto indicado crea uno propio. La configuración congelada conserva los límites del padre y la atribución. `GET /coding/:jobId` añade `budget`, nullable para informes históricos sin registro.

Las rutas internas `POST /internal/coding/:jobId/admit` y `/usage` exigen el token del controlador. La primera recibe generación, UUID y hash de la petición. La segunda conserva el uso reportado del proveedor para ese UUID y generación, incluido el uso parcial conocido después de cancelar. [Contratos](../packages/contracts/src/usage.ts)

## Equipos y planes (P05)

Rutas bajo `/api/projects/:projectId`, protegidas por sesión y propietario. Las escrituras requieren proyecto activo y el origen/cabecera JSON habituales. Contratos en [teams.ts](../packages/contracts/src/teams.ts); uso y límites en [Codex](codex.md#equipos-y-planes-p05).

| Método y ruta | Entrada / resultado |
| --- | --- |
| `GET /team-templates` | `{templates,presets}` con últimas versiones e indicación de archivo. |
| `POST /team-templates` | `{definition,preset?}` → 201 `{template}`; verifica roles, skills y capacidades. |
| `GET /team-templates/:templateId` | `{template,versions}` con historial inmutable. |
| `PATCH /team-templates/:templateId` | `{version,definition}` → `{template}` con versión nueva. Conflicto si no es la cabeza vigente. |
| `POST /team-templates/:templateId/archive` | `{version}` → `{archived:true}`; conserva versiones y planes. |
| `GET /team-plans` | `{plans}` con hasta cien resúmenes recientes, sin textos privados de roles/skills. |
| `POST /team-plans` | `{requestId,taskId,taskVersion,templateId,templateVersion,mode,singleStep?,executionId,model}` → 201 `{plan}`; copia inmutable, sin encolar. |
| `GET /team-plans/:planId` | `{plan}` con snapshot completo, hash, estado y aprobación nullable. |
| `POST /team-plans/:planId/approve` | `{hash,version:1}` → `{plan}` aprobado, idempotente para la misma copia; no ejecuta. |

`definition` contiene nombre, descripción, `maxIterations`, `limits` de P04 y `steps`. Cada paso declara `key`, título, selección de rol/versiones, `dependsOn`, `exitCriteria`, `requiredCapabilities` y `maxRequests`. Solo se permiten esos campos; claves únicas, DAG válido y peticiones de todas las iteraciones dentro del máximo del padre. Versiones de plantilla entre 1 y 50; de una a seis etapas y de una a tres iteraciones. Las referencias se resuelven dentro del proyecto.

`mode` es `auto`, `single` o `team`. `singleStep` es obligatorio exclusivamente para `single`. `executionId` conserva `codex-v1`; `model` debe pertenecer al catálogo, o ser `null` solo si está vacío. La falta de ejecutor permite preparar un plan bloqueado; no aprobarlo. Antes de una aprobación nueva se vuelve a consultar su descriptor y se exige igualdad con el congelado. El snapshot recoge tarea, clasificación, modo efectivo, plantilla, roles/materiales y criterios, ejecución/modelo, límites, iteraciones y máximo previsto de peticiones.

El plan tiene `state=prepared|approved|executed`, `hash` SHA-256 canónico, `approval={hash,version,approvedAt}|null` y `executionId=null|UUID`. `executed` indica asociación a un recorrido P06, no su éxito. No se actualiza el snapshot: los cambios requieren otra preparación/aprobación. `requestId` repetido con la misma entrada devuelve la copia original; entrada distinta produce 409. Tarea obsoleta, hash incorrecto o archivo producen 409; elementos ajenos 404; incompatibilidad o modelo no permitido 422; DAG/campos/límites inválidos 400. Hasta mil planes por proyecto. El catálogo/historial es consultable en proyectos archivados.

## Equipos en ejecución (P06)

Mismo ámbito de propietario/proyecto y protección JSON/origen que P05. [Protocolo y límites](codex.md#equipo-secuencial-duradero-p06).

| Método bajo `/api/projects/:projectId` | Entrada / resultado |
| --- | --- |
| `POST /team-plans/:planId/execute` | `{requestId,hash,version:1,commit}` → 202 `{execution,plan,steps,events}`. Requiere aprobación y condiciones vigentes; crea padre, presupuesto y etapas. |
| `GET /team-executions` | `{executions}` con hasta cien resúmenes recientes; no incluye entregas ni texto de roles. |
| `GET /team-executions/:executionId` | `{execution,plan,steps,events}`, con snapshot y entregas autorizadas. Revalida acceso GitHub; 403 si se pierde. |
| `POST /team-executions/:executionId/cancel` | `{}` → mismo detalle con cancelación solicitada; no promete parada física inmediata. Admite proyecto archivado. |

El padre devuelve ID, proyecto/plan/hash, título, estado, cancelación solicitada, commit/repositorio, presupuesto, motivo nullable y fechas. Las etapas incluyen ID, posición/clave, hijo nullable, estado (`pending/running/completed/failed/cancelled/skipped`), motivo y entrega nullable. La entrega conserva hashes de entrada/salida, fuentes/hash, resumen reportado, pruebas del controlador y dudas; `verified` permite avanzar técnicamente y no acredita todos los criterios humanos. Los eventos tienen secuencia, tipo, mensaje, datos y fecha, sin token ni fence. `codingRun` añade `teamExecutionId` nullable; no expone los archivos de trabajo internos.

Se admite un equipo activo y mil históricos por proyecto; cada plan tiene una ejecución. El mismo UUID y cuerpo devuelve el mismo padre; otras condiciones con ese UUID dan 409. Sin aprobación, con tarea/modelo/ejecutor/commit obsoletos o con otro equipo activo, devuelve conflicto. Hijos siguen la cola `codex-v1` y el presupuesto P04; no se crea un tipo de trabajo que bloquee sus slots. Repetir/publicar directamente un hijo devuelve 409 `team_managed_step`.

El worker llama `POST /internal/teams/tick` con `{}` y token de servicio; no es una ruta pública ni admite planes/comandos del cliente. El controlador sirve `GET /runs/:jobId/files` solo después de finalizar correctamente, con su token y generación. Esa ruta entrega exclusivamente la instantánea segura recogida; no acepta rutas de filesystem ni ofrece un proxy Docker.

## Especialistas y mensajes (P07)

`teamDefinition.strategy="specialists"` selecciona entre dos y cuatro etapas raíz independientes más un resumen final dependiente de todas. Requiere `maxIterations=1`, capacidades sin escritura y roles/materiales compatibles con `node-readonly-v1`. `limits.concurrency` puede ser uno o dos; otros workflows conservan uno. Preparar requiere `mode="team"`; la aprobación congela el descriptor de solo lectura y el máximo solicitado. `coding/capabilities` añade `readOnlyExecution`, disponible únicamente si el controlador confirma el perfil. Los hijos guardan `configuration.workspaceAccess="read-only"`, que no puede solicitarse a través del formulario/API individual de Codex.

| Método bajo `/api/projects/:projectId` | Entrada / resultado |
| --- | --- |
| `GET /team-policy` | `{parallelism:1|2,version}`; comienza en uno. |
| `PATCH /team-policy` | `{parallelism,version}` → configuración nueva; requiere propietario, proyecto activo y ningún equipo activo. No cambia el máximo global. |
| `GET /team-executions/:executionId/messages?after=N` | `{messages,nextCursor,hasMore}`, páginas de cincuenta; sesión, propiedad y acceso GitHub revalidados. |

`GET /team-executions/:id` añade `gathering={complete,received,missing,summary,conflicts}`. `complete=false` mientras falten entregas, si el recorrido falla/cancela o existen conflictos reportados. No equivale a aprobación de producto. Solicitar más concurrencia que la configuración actual devuelve 409 `team_parallelism_not_configured`; políticas obsoletas o cambios durante un equipo activo devuelven 409. Las versiones de la política son propias e independientes de la versión del contenido del proyecto.

Rutas internas con token de servicio: `POST /internal/coding/:jobId/messages` recibe `{fence,message:{requestId,to,kind,text,replyTo?}}`; `POST /internal/coding/:jobId/inbox` recibe `{fence,after}`. `to` es el UUID de una etapa del mismo equipo o `null` para el coordinador. Las respuestas requieren consulta original y destinatarios coherentes. Cuerpo máximo de 16 KiB; hasta 2.000 caracteres y 8 kB de texto, 16 mensajes por hijo, 80 de agentes y veinte del coordinador. El mismo UUID/cuerpo es idempotente; cambios, destinatarios ajenos, cuota o generación inválida se rechazan. No admiten campos para declarar remitente, propietario o aprobación.

El código solo ve `POST http://127.0.0.1:9040/team/messages` con el objeto `message`, y `POST /team/inbox` con `{after}`. La pasarela exclusiva del hijo incorpora su identidad de control y solo habilita esas rutas a especialistas. Los mensajes devueltos identifican origen `agent|coordinator`, etapa/hijo, destino, secuencia, tipo, texto, referencia de respuesta, `verified` y fecha; nunca token/fence. El texto de agente queda sin verificar. El coordinador produce entregas y finalizaciones técnicas a partir de informes guardados, no de afirmaciones en el mensaje. [Protocolo P07](codex.md#especialistas-y-mensajes-p07)

## Revisión y PR (E9)

| Método y ruta bajo `/api/projects/:projectId/coding/:jobId` | Entrada / resultado |
| --- | --- |
| `GET /review` | `{review,baseBranch,dimensions}`; revisión nullable y hasta diez revisiones dimensionales, acceso GitHub revalidado. |
| `PUT /review` | `{version,title,body,branch,approved,notes}`; versión 0 para crear, después versión vigente. No escribe en GitHub. |
| `POST /review/publish` | `{version}`; acción explícita, aprobación e informe final vigente; crea/reconcilia rama y PR draft. Devuelve la misma revisión con resultado. |
| `GET /comparisons` | `{baseline,runs,truncated}`; hasta veinte ejecuciones de la misma tarea/repositorio con condiciones, métricas, informes, revisión y diferencias. |
| `POST /repeat` | `{requestId,model}`; 202 con trabajo que copia entrada/criterios/herramientas/límites congelados. Solo el modelo puede variar. |

`review` incluye estado `prepared/publishing/failed/published`, versión, valoración/aprobación humana, título/cuerpo/rama, fecha del primer intento, commit publicado, número/URL de PR, `baseChanged` y código de error nullable. Nunca incluye token de intento, credenciales ni lease interno. Publicación/repetición rechazan archivo, ámbitos ajenos, condiciones obsoletas o conflictos; permisos de escritura y cabeza real se verifican en el servidor. No hay merge ni force push. Una respuesta fallida puede haber producido efectos remotos; reintentar conserva las condiciones y reconcilia el mismo resultado. Contratos en [review.ts](../packages/contracts/src/review.ts); protocolo y límites en [reviews.md](reviews.md).

### Revisión por dimensiones (P08)

El preset `dimensional-review` usa `strategy=specialists`, `reviewMode=dimensions-v1` y cuatro claves ordenadas: `correctness,stack,security-tests,verify`. El verificador depende de los tres revisores. Admite una o dos rondas, dentro de las veinte peticiones P04; todas conservan el mismo diff, roles, criterios, presupuesto y plazo.

`POST /team-plans` acepta `reviewTarget?: UUID` exclusivamente para una plantilla de revisión. Es el trabajo cuyo diff íntegro se congela; debe pertenecer al proyecto y tarea/versiones elegidas, con parada confirmada y fuentes reconstruibles. `snapshot.reviewTarget` conserva originales/finales, diff y hashes del informe, tarea, herramientas, archivos y artefacto. Preparar requiere el origen en su versión vigente. El listado de planes incluye `reviewJobId`, nullable para planes anteriores o de otros workflows. Aprobación/ejecución/cancelación mantienen las rutas y controles de P05–P07. Las etapas de ejecución añaden `iteration` (uno para históricos).

`GET /coding/:jobId/review` conserva la revisión E9 y añade `dimensions[]`: ejecución, hashes, ronda actual/máxima, estado `running/complete/incomplete/stale`, dimensiones con hijos/roles/versiones/rondas y errores, hallazgos con procedencia/discrepancias, verificaciones y bloqueos. La verificación distingue `confirmed/refuted/unverifiable`, referencia nullable al informe del controlador y origen `controller-test/unverified`; el texto del agente no puede crear esa autoridad. Duplicados se reúnen por ubicación/código/evidencia/desencadenante, conservando afirmaciones discrepantes. Hallazgos graves sin reproducción independiente válida impiden completar.

`PUT /review` sigue guardando borradores sin escribir GitHub. Para `approved=true`, la última revisión dimensional debe estar completa y vigente, si existe; se congela también el hash de su resultado. Una revisión posterior o un artefacto cambiado retira la aprobación vigente y bloquea `POST /review/publish` hasta revisión humana válida. Sin análisis dimensional se conserva E9. El historial anterior no se elimina. [Semántica, evidencia y límites](reviews.md#revisión-por-dimensiones-p08).

## Estrategias de contexto (E10)

`POST /projects/:projectId/lab/batches` admite `contextExperiment="ferweb-context-v1"` y cuatro objetivos con `contextStrategy` en orden `wide-v1/retrieval-v1/summary-v1/reuse-v1`; proveedor/modelo/configuración/tarifa comunes. El servidor congela corpus/huellas y fija rotación `counterbalanced_context_v1`; máximo 40 intentos. Los lotes E6 conservan su contrato anterior sin estos campos. `criteria[].expectedPaths` opcional ayuda a comprobar fuentes esperadas sin enviarlas al modelo.

| Método y ruta bajo `/api/projects/:projectId/lab` | Resultado |
| --- | --- |
| `GET /batches/:batchId/context-comparison` | Informe pareado, vigencia del contexto y comprobación de evidencia por latencia. No infiere ahorro ni aprobación humana. |
| `GET /context-policy` | `{policy,version}`; selección pública nullable y versión monotónica. No devuelve plan privado ni credenciales. |
| `POST /context-policy` | `{batchId,target,metric,version}`; adopción explícita si hay evidencia real pareada suficiente, mejora y calidad no inferior. |
| `DELETE /context-policy` | `{version}`; restablece contexto habitual y avanza versión, sin borrar evidencias. |

Condiciones y ejecuciones E10 añaden `contextPlan` y `contextMetrics` respectivamente. El plan guarda corpus autorizado, procedencia, revisión de proveedor/implementación y límites; las métricas conservan operaciones, uso nullable, resultados/parciales, mensajes, tiempos y origen de reutilización. JSON/CSV incluyen esas evidencias; las respuestas derivadas requieren acceso GitHub revalidado. Total monetario completo desconocido permanece `null`; el subtotal conocido no es ahorro.

El chat aplica una política vigente solo a su mismo proveedor/modelo/configuración y con `repositoryContext=true`. Los turnos añaden `contextMetrics` nullable; `grounding=preparing` distingue candidatos de fuentes usadas hasta preparar el contexto. Sin política, conserva E4/E5. Una política invalidada devuelve conflicto manejado, no una respuesta obsoleta. Se mantiene sesión/origen/propiedad/archivo, y los datos derivados se ocultan ante revocación. Protocolo y límites: [context-optimization.md](context-optimization.md).

## Memoria de proyecto P09

Rutas bajo `/api/projects/:projectId/memory`; sesión, propiedad, origen y contratos estrictos. Las mutaciones se rechazan en proyectos archivados. [Semántica, procedencia y límites](memory.md).

| Método/ruta | Contrato |
| --- | --- |
| `POST /` | `{requestId, entry}`; crea entrada y responde 201 con `{selection: {id,revision,hash}}`. |
| `PUT /:id` | `{version, entry}`; corrección/retirada como revisión nueva; conflicto de versión 409. |
| `GET /:id?revision=N` | `{entry}`; sin revisión usa cabeza, con revisión solicita historial autorizado. |
| `GET /:id/history` | `{entries,complete,unavailable}`; no devuelve contenido de fuentes retiradas. |
| `POST /search` | `{query,target?,asOf?,cursor?}`; `{entries,complete,state,issues,nextCursor,notice}`. Ventanas de veinte autorizadas antes del matching. |
| `POST /import` | `{requestId,format: json\|markdown,content}`; 201 con `{selections}`; archivo incompleto 422 sin inserciones parciales. |
| `POST /export` | `{selections,format}`; `{filename,mime,content,scope: selection,complete: true}`; exportación acotada, no descarga de todo el proyecto. |

`entry` contiene `kind,title,content,observedAt,status,tags,targets,lesson,sources`. Las respuestas añaden identidad, autor/origen, revisión/relación/hash, fechas de vigencia, confianza y evidencia normalizada. Fuente `code`: ruta, commit, líneas, `canonical`; `task`: ID/versión; `job`: ID; `delivery`: ejecución/etapa. Hashes esperados opcionales se validan y se normalizan al guardar. Sin fuentes no hay verificación de la afirmación. Falta de fuente o revocación devuelve error seguro o búsqueda incompleta; no es un resultado vacío comprobado.

Las entradas de Codex y preparación de planes admiten `memory?: [{id,revision,hash}]`, máximo tres, únicas y del mismo proyecto. Se congelan las referencias y se revalidan para reutilizar. `GET coding/:id` añade `memory` con las revisiones utilizadas y autorizadas, incluidas ejecuciones antiguas con `[]`. La memoria se entrega como datos sin autoridad; el cliente no puede enviar herramientas ni un bloque libre de contexto de proyecto.

## Contexto por rol P10

Rutas bajo `/api/projects/:projectId/context-packs`: `GET /` devuelve mapa, política y resúmenes de recibos; `POST /map/draft {}` propone Markdown sin generación; `PUT /map {version,markdown,paths}` y `PUT /policy {version,rules}` usan control de versión. `POST /prepare` recibe tarea/version, rol opcional, modelo opcional, fase, perfil, modo, consulta, IDs explícitos/excluidos y referencias de memoria; responde 201 con `{receipt}`. `GET /receipts/:id` devuelve el recibo autorizado, su estado de vigencia y ampliaciones.

Recuperación añade `GET /context/catalog`, `POST /context/catalog/export {}` y `POST /context/hybrid/search {query,path?,limit?}`. `POST /context/index` admite `lexicalOnly` opcional y sus respuestas/estado declaran `strategy`. Preparar un trabajo puede enviar `contextReceipt: {id,hash}` en lugar de referencias de memoria separadas. Preparar un plan admite configuración `context`; su snapshot añade `contexts` por etapa. `GET coding/:id` incorpora la referencia nullable al recibo de ejecución.

El puente interno autenticado `POST /internal/coding/:jobId/context` recibe `{fence,request}`. `request` contiene UUID, tipo `dependency|contract|test`, razón y exactamente una ruta o consulta. Solo una generación activa y autorizada puede ampliar el contexto; el código del agente usa el proxy local del controlador. Los contratos completos y límites están en [context-packs.md](context-packs.md).

El laboratorio admite `contextExperiment: ferweb-context-p10-v1`, con `retrieval-v1`, `hybrid-v1` e `hybrid-memory-v1` en ese orden. Conserva revisiones de memoria, métricas de búsqueda, etiquetas de citas y uso nullable; no adopta evidencia simulada.

## Referencias de diseño

- [Node.js crypto](https://nodejs.org/api/crypto.html).
- [OWASP: almacenamiento de contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- [OWASP: sesiones](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
- [OWASP: CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
