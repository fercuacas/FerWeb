# Arquitectura y decisiones iniciales

**Estado:** E1–E8 implementados. E6 añade el laboratorio según [laboratory.md](laboratory.md); E7 añade cola y simulador según [jobs.md](jobs.md); E8 integra Codex CLI con contenedores de código separados según [codex.md](codex.md). Evidencia ejecutada en [status.md](status.md). GitHub y modelos se han validado con proveedores simulados; la aceptación externa sigue pendiente del propietario.

## Principios

1. Entregas verticales: cada incremento conecta interfaz, reglas, persistencia y validación.
2. Backend modular antes de dividirlo en servicios adicionales.
3. Datos y contratos explícitos, con una autoridad definida por tipo de recurso.
4. Proveedores de IA y GitHub aislados del dominio mediante adaptadores.
5. Docker Compose desde la primera base ejecutable; infraestructura adicional por necesidad.
6. Calidad y coste medidos sobre tareas y condiciones registradas.

## Evolución de componentes

| Componente | Responsabilidad | Incorporación |
| --- | --- | --- |
| Web React/TypeScript/Redux | Proyectos, tareas, chats, comparativas y revisión. | E1 |
| API Node.js/TypeScript/Express | Salud y configuración en E1; autenticación, autorización y casos de uso desde E2. | E1 |
| PostgreSQL | Persistencia transaccional y metadatos de recursos. | E1 |
| Adaptador GitHub App | Instalaciones, acceso al repositorio y sincronización. | E3 |
| Servicio Python de IA | Proveedores y streaming; contexto/evaluación se amplían después. | E4 |
| Ollama local | Inferencia con el modelo compatible elegido según hardware. | E4 |
| Qdrant | Índices vectoriales derivados de fuentes autorizadas. | E5 |
| Cola y ejecutor | Trabajos duraderos, progreso, límites y recuperación. | E7 |
| Integración Codex | Ejecución de tareas sobre espacios de código limitados. | E8 |

El servicio Python se separa para dar un límite operativo a las funciones de IA. No se creará un microservicio por entidad. E7 usa PostgreSQL como cola transaccional, con un worker Node independiente y sin broker adicional.

## Flujos previstos

```text
Navegador -> API -> PostgreSQL
                 -> Adaptador GitHub -> GitHub
                 -> Servicio IA -> OpenAI / Ollama
                                -> Recuperación -> Qdrant + fuentes

E7:
API -> PostgreSQL (trabajo + cola + eventos) -> Worker -> Proceso simulador
Ejecutor -> Eventos / resultados -> API -> Navegador

E8:
Worker -> Controlador de confianza -> Docker -> Contenedor Codex sin red general/secretos
                                      -> Recolector separado, volumen final en lectura
Codex -> Proxy loopback -> Socket Unix acotado -> Pasarela -> OpenAI Responses
```

La API es la puerta de entrada de la web. PostgreSQL, Qdrant y la cola no se exponen directamente al navegador. El servicio de IA recibe contexto de autorización validado y aplica separación de proyecto en recuperación y caché.

## Organización propuesta del repositorio

```text
apps/web/             interfaz
apps/api/             backend modular
packages/contracts/   contratos compartidos cuando exista reutilización real
apps/ai/             servicio Python, desde E4; embeddings locales desde E5
apps/api/src/job-worker.ts  entrada del worker E7, contenedor separado
apps/api/src/modules/jobs/  cola, servicio, IPC y simulador E7
apps/runner/          controlador de confianza y pasarela Codex E8
apps/sandbox/         imagen, supervisor, agente y recolector E8
infra/                configuración de infraestructura adicional
docs/                 producto, arquitectura, roadmap y estado
compose.yaml          entorno inicial, desde E1
```

Existen `apps/web`, `apps/api`, `packages/contracts`, `scripts` y `tests/browser`. Los contratos comparten el esquema Zod de estado, usado en API, cliente y prueba smoke. Cada módulo de backend separará reglas de dominio, casos de uso y adaptadores sin requerir un framework de DDD.

## Datos y propiedad

| Grupo | Datos previstos | Autoridad |
| --- | --- | --- |
| Identidad y organización | Propietario, proyecto, tarea, criterios de aceptación. | PostgreSQL |
| Integraciones | Instalación GitHub, vínculo a repositorio, estado de sincronización. | PostgreSQL; GitHub conserva autoridad sobre su contenido. |
| Conversaciones | Chat, mensaje, selección de proveedor y configuración. | PostgreSQL |
| Contexto | Versión de fuente, ruta, commit, fragmento, exclusiones. | Metadatos en PostgreSQL; contenido autorizado en almacenamiento local/volumen. |
| Búsqueda | Embeddings y metadatos de filtrado. | Qdrant, reconstruible desde fuentes autorizadas. |
| Evaluación | Caso, contexto congelado, versión, repeticiones y valoraciones. | PostgreSQL; artefactos grandes en volumen. |
| Ejecución | Trabajo, intento, estado, eventos, reservas y efectos simulados. | PostgreSQL, también cola transaccional en E7. |

Las referencias de recursos se resuelven siempre dentro del proyecto autorizado. Los índices y resultados reutilizados incluyen ámbito de proyecto, configuración y versión de fuente. Un cambio de permisos invalida o impide recuperar material previamente permitido.

El MVP se aprovisiona con un propietario mediante CLI, sin registro público. La identidad usa contraseña scrypt con sal y sesión opaca en cookie HttpOnly; se guarda solo el hash del token en PostgreSQL y se aplica expiración máxima de ocho horas. Los fixtures de prueba añaden otra cuenta en una base desechable para verificar aislamiento. No hay gestión de organizaciones o invitaciones.

E2 añade `app_users`, `sessions`, `login_attempts`, `projects` y `tasks` mediante la migración 002. Los proyectos llevan propietario inmutable, archivo reversible y versión. Las tareas pertenecen al proyecto y tienen criterios JSONB. La autorización se aplica desde la identidad de sesión en consultas SQL, sin aceptar propietario desde el cliente. Un proyecto ajeno y uno inexistente devuelven el mismo 404.

E3 añade `github_connections`, `github_oauth_states`, `github_installations`, `github_links` y `github_deliveries` mediante 003. El adaptador HTTP GitHub está separado de las operaciones de conexión/sincronización y de los handlers de webhooks. Los tokens de usuario de la App respetan los permisos compartidos por usuario e instalación y están cifrados con AES-GCM, con el propietario como contexto asociado. No se usan tokens de instalación amplios que puedan saltarse los permisos del usuario.

El código queda fijado por rama resuelta a commit y blobs pertenecientes al árbol; los snapshots de issues/PR tienen fecha independiente. La generación del vínculo aumenta al recibir eventos: una sincronización solo publica si la versión y generación originales siguen coincidiendo. Webhooks firman bytes originales, deduplican por entrega en una transacción SQL e invalidan sin efectuar llamadas remotas. Revocaciones eliminan snapshots y la lectura revalida acceso remoto. No se añade una cola antes de que sea necesaria. Contratos y límites en [github.md](github.md).

Las operaciones de escritura sobre tareas y proyectos bloquean la fila de proyecto dentro de una transacción para resolver la carrera con archivo/restauración. La versión enviada evita pérdida de actualizaciones. Un proyecto archivado queda en solo lectura hasta restauración. El contrato implementado y los límites están en [api.md](api.md).

La web separa la caché de identidad (`authApi`) de los datos privados (`workspaceApi`). Cambios de identidad, logout y un 401 limpian datos y filtros. Las credenciales del formulario usan una petición local fuera de acciones Redux; Redux coordina filtros, selección de tarea y caché de servidor. Los borradores de formularios permanecen en estado local y se conservan tras errores. La navegación usa rutas hash y conserva el proyecto al recargar.

E4 añade `conversations` y `chat_turns`, sin duplicar persistencia en Python. Proveedor, modelo y configuración son fijos por conversación. Los turnos conservan prompt/respuesta, IDs de contexto y métricas nullable. La admisión bloquea proyecto y conversación, valida versión/UUID y limita un turno activo. El contexto se construye desde pares completos de la misma conversación; el cliente no puede añadir roles ni historial de otros proyectos.

Python expone un protocolo interno de catálogo, eventos NDJSON y cancelación autenticado con token de servicio. Node lo transforma en SSE autenticado para el navegador. Una señal inmediata y un indicador SQL cancelan la generación; checkpoints y leases permiten registrar interrupción tras caída sin volver a invocar el modelo. La cancelación cierra conexiones y no afirma una parada remota facturable confirmada. Se mantiene un worker Python; la cola E7 solo admite simulaciones y no modifica este flujo. Topología, configuración, límites y métricas en [ai.md](ai.md).

## Contratos e integraciones

- API web REST con validación de entrada y errores consistentes. Publicar el contrato implementado al introducir endpoints.
- Streaming de respuestas con un transporte elegido y probado en E4; no introducir WebSockets por defecto.
- Webhooks de GitHub con validación de firma, deduplicación y tratamiento idempotente.
- GitHub en lectura hasta E9. La escritura usará permisos específicos y una acción explícita del producto.
- Adaptadores IA con capacidades declaradas: streaming, herramientas, cancelación y métricas pueden variar.
- Las credenciales se suministran por configuración de servidor durante el MVP. Una gestión editable desde web necesitará diseño adicional de almacenamiento y protección.
- El uso reportado por el proveedor es distinto del estimado. Las tarifas y estimaciones se versionan y fechan.
- Los registros se limitan a metadatos necesarios; no incluyen claves ni contenido privado por defecto.

## Contexto y política de datos

La ingesta aplica permisos, exclusiones, límites de tamaño y versión. La recuperación filtra por proyecto y fuente autorizada, y devuelve referencias a ruta y commit. El contenido recuperado no puede modificar instrucciones ni obtener herramientas adicionales.

El modo local abarca inferencia y embeddings. Los evaluadores externos y el envío a APIs requieren una selección visible. Los errores locales no activan silenciosamente un proveedor externo.

La indexación incremental y la reutilización conservan procedencia e invalidación. En E5 el operador elige el modelo local de embeddings y sus dimensiones; cambiar su nombre, digest o dimensiones exige reconstruir el índice de ese proyecto en otro espacio vectorial. Los resúmenes y la optimización de tokens quedan para entregas posteriores.

## Docker y ejecución local

E1 contiene web, API y PostgreSQL en Compose, comprobaciones de salud, un servicio de migración de una sola ejecución, volumen nombrado y configuración de ejemplo. PostgreSQL no publica puerto por defecto; web y API se publican en loopback. `compose.native.yaml` permite publicar la base para desarrollo Node local. El volumen de PostgreSQL 18 se monta en `/var/lib/postgresql`.

Docker es el entorno habitual. Los fuentes permanecen en Windows y API/web los montan en lectura con polling. `scripts/docker.mjs` unifica el arranque y selecciona automáticamente la CA local de construcción cuando existe. `npm run dev`, `owner:create` y `db:migrate` delegan en Docker. La alternativa nativa es explícita y queda reservada para recuperación.

El perfil opcional `tools` compila y ejecuta checks e integración/navegador dentro de Linux. `Dockerfile.tools` combina el runtime Node fijado con la imagen oficial Playwright de la versión del lockfile. No publica puertos ni monta el socket Docker; dispone de memoria compartida propia para Chromium. Cada suite usa bases desechables y el contenedor se elimina al terminar. La base activa es el volumen `ferweb_postgres_data`; la migración lógica desde Windows conserva cuenta, hashes e instalación y está documentada en [docker.md](docker.md).

Las imágenes usan Node 24.22.2 bookworm-slim y npm 11.19.1; PostgreSQL usa 18.6-bookworm. Las dependencias npm directas son exactas y el lockfile se instala con `npm ci`. E2 protege proyectos y tareas con sesión; salud continúa pública. `APP_ORIGIN` fija el origen de mutaciones y `COOKIE_SECURE` distingue el desarrollo HTTP del futuro HTTPS.

La migración SQL crea el registro persistente `installation`. Un runner transaccional con bloqueo asesor y checksums mantiene `schema_migrations`. La API distingue liveness y readiness; el segundo comprueba conexión, historial aplicado y existencia del registro. La UI consulta el mismo esquema validado, actualiza a petición y cada 15 s mientras la pestaña está enfocada, y muestra fallos sin conservar un estado operativo obsoleto.

Ollama podrá ejecutarse en el anfitrión o mediante un perfil opcional. La elección depende del hardware y del soporte de aceleración observado. La conexión desde contenedores se documentará y probará, sin asumir que `localhost` identifica al anfitrión.

Un despliegue remoto no puede usar directamente un modelo del PC como si fuera local al servidor. Esa topología necesitará un ejecutor/conector autenticado con conexión saliente, reconexión y límites, en una ampliación explícita.

## Trabajos y agentes

E7 guarda creación, cola, intentos, eventos, reservas y efectos en PostgreSQL mediante la migración 007. No hay publicación a un segundo almacén. Asignación con exclusión asesora y `SKIP LOCKED`, leases renovables, generación por intento y checkpoints evitan que un ejecutor anterior publique después de una recuperación. Máximo dos trabajos globales y uno por proyecto; presupuesto/plazo acumulados y reintentos acotados. El worker independiente crea un proceso de confianza por intento, cancela su grupo y espera salida. Detalles y límites en [jobs.md](jobs.md).

Solo se acepta `simulation-v1`. La prueba de efecto SQL idempotente no promete ejecución exactamente una vez de efectos externos. Chat y laboratorio conservan su ciclo anterior; no se reintenta inferencia automáticamente. El contenedor actual comparte UID/credenciales del padre y no es una frontera suficiente para código hostil.

E8 fija una copia de tarea/versión/criterios y un snapshot filtrado de blobs del commit sincronizado, sin clon/historial ni cambios en la rama original. `coding_runs` conserva textos, manifiesto, exclusiones e informe. Se mantiene el control de acceso GitHub antes/durante y al servir evidencias. Código no se reintenta automáticamente; chat/laboratorio conservan sus políticas anteriores.

El controlador de confianza es el único componente con acceso Docker y clave de modelo. Código/Codex ejecutan con UID 1000 en otro contenedor, raíz de solo lectura, red `none`, workspace y temporales limitados, sin capacidades ni credenciales/socket. La pasarela por socket Unix acepta solo peticiones Responses del modelo y cupo de esa ejecución. Para recoger artefactos, se pausa el código y otro contenedor lee el volumen en modo lectura; el controlador calcula el diff. Frontera, recursos, supervisor de lease y limitaciones en [codex.md](codex.md).

Docker comparte kernel: esta frontera comprobada con un repositorio preparado no acredita resistencia a exploits de kernel ni ejecución pública de código hostil arbitrario. Los eventos de comandos/uso de la CLI son datos reportados; se separan del uso observado por la pasarela, la verificación lanzada por el controlador y el diff recogido fuera del código.

## Evaluación y observabilidad

Las comparaciones de modelos congelan contexto, condiciones y criterios. Las de agentes añaden commit inicial, herramientas, límites y pruebas de aceptación. Se conservan repeticiones, errores y diferencias entre latencia inicial y duración total.

Tokens por segundo no será un ranking universal entre tokenizadores diferentes. Se priorizan calidad, latencia y coste por resultado aceptado. El coste local es una estimación con supuestos de equipo y utilización; no se equipara coste API cero con coste total cero.

La instrumentación crece con el producto: salud y errores en E1; uso y tiempos en E4; trazabilidad de trabajos en E7; operación y carga en E11. Los identificadores correlacionan peticiones, trabajos e intentos.

## Registro de decisiones

| ID | Decisión | Razón y revisión |
| --- | --- | --- |
| D01 | Nombre FerWeb y repositorio independiente. | Respetar la petición y separar otros proyectos. |
| D02 | Monorepo con backend modular. | Facilitar contratos, cambios completos y operación inicial. Revisar con cuellos de botella reales. |
| D03 | PostgreSQL como persistencia principal. | Mantener relaciones y transacciones con una autoridad clara. |
| D04 | Docker Compose desde E1. | Instalación y desarrollo reproducibles. Kubernetes tras E11 si se justifica. |
| D05 | Python desde E4. | Separar funciones de IA cuando aparezcan, sin un servicio vacío inicial. |
| D06 | Qdrant desde E5. | Recuperación semántica como índice derivado, no base principal. |
| D07 | Un propietario, acceso autenticado. | Limitar el MVP sin omitir autorización por proyecto. |
| D08 | GitHub App, lectura inicial. | Permisos por función y evolución controlada hacia escritura. |
| D09 | Comparar modelos antes que agentes. | Obtener valor y una base de medición antes de ejecutar código. |
| D10 | Primer agente de código integrado con SDK de Codex. | Reutilizar un ejecutor existente. Verificar documentación y autenticación en E8. |
| D11 | Calidad y coste con métricas observadas y supuestos visibles. | Evitar decisiones basadas solo en tokens o estimaciones no verificadas. |
| D12 | Versiones y librerías concretas se fijan al implementar. | Verificar compatibilidad y mantenimiento vigentes; evitar precisión ficticia en planificación. |
| D13 | npm workspaces y contratos Zod compartidos en E1. | Compartir el primer contrato real y validar respuestas sin duplicar su definición. |
| D14 | Runner SQL pequeño con `pg`, transacción, bloqueo y checksum. | Esquema mínimo sin incorporar un ORM antes de E2; mantener migraciones verificables. |
| D15 | RTK Query para consultar salud y Vite como proxy en desarrollo. | Usar Redux para caché/actualización de datos reales y evitar configurar CORS público. |
| D16 | Pruebas básicas con Node y pruebas de navegador con Playwright. | Probar contratos, degradación y recorridos; integración real en una base temporal separada. |
| D17 | Propietario por CLI y sesiones opacas persistentes, sin JWT. | Provisionamiento local sin registro público, expiración y revocación comprobables en servidor. |
| D18 | Propiedad aplicada en SQL, versiones y bloqueo del proyecto. | Evitar acceso ajeno, pérdida de cambios y escrituras durante archivo. |
| D19 | Cachés de identidad y espacio separadas; borradores locales. | Limpiar datos privados al cambiar de sesión sin bloquear la consulta de identidad ni perder borradores por fallos de guardado. |
| D20 | Navegador con API/web/base efímeras propias. | Probar el recorrido completo sin cuentas, proyectos ni puertos del usuario; validar CLI y permisos con credenciales aleatorias. |
| D21 | GitHub App con autorización de usuario, PKCE y token cifrado; reautorización al expirar. | Respetar la intersección usuario/App sin credenciales en el navegador. No guardar refresh tokens antes de implementar su ciclo de vida. |
| D22 | Snapshots con commit, actualización manual y generación de eventos transaccional. | No mezclar ramas móviles ni borrar cambios recibidos durante una consulta. Issues/PR conservan fecha de observación. |
| D23 | Webhooks sin descargas remotas y deduplicación persistente. | Responder con trabajo acotado, evitar efectos repetidos y revocar datos sin depender de un worker. |
| D24 | Proveedor/modelo inmutables y contexto construido por el servidor. | Evitar derivación accidental de conversaciones locales a APIs y filtraciones entre proyectos. |
| D25 | Persistencia en Node/PostgreSQL; Python concentra adaptadores de streaming. | No duplicar autoridad ni añadir colas antes de trabajos durables. Leases detectan interrupción y no reintentan inferencia facturable. |
| D26 | Uso reportado nullable y tiempos de API separados de los del proveedor. | No transformar datos ausentes en ceros ni presentar latencia/coste estimados como observaciones. |

E5 materializa el módulo `retrieval` en Node, embeddings en Python y búsqueda Qdrant. El manifiesto/fragmentos SQL es la autoridad; las búsquedas solo aceptan IDs activos del proyecto y repositorio revalidados. El espacio de vectores incluye digest/modelo/dimensiones; cambios de contenido generan nuevos IDs antes de publicar. Se conservan respuestas y fuentes por turno, pero se ocultan al fallar la revalidación GitHub. Diseño y límites de caché derivada en [retrieval.md](retrieval.md).

| Decisión E5 | Elección | Motivo |
| --- | --- | --- |
| D27 | Embeddings exclusivamente Ollama local, modelo/dimensiones explícitos. | Evitar enviar silenciosamente el repositorio a un proveedor externo. |
| D28 | Publicación del manifiesto en SQL y puntos inmutables en Qdrant. | Impedir servir documentos modificados a medias y recuperar solo contenido autorizado vigente. |
| D29 | Contexto opt-in y fuentes guardadas por turno; datos separados del sistema. | Hacer visible qué se envía al proveedor y limitar autoridad del contenido recuperado. |

E6 añade `laboratory` en el backend y cinco tablas mediante 006. Las condiciones copian casos, mensajes exactos, hashes, tarifas y objetivos. La ejecución secuencial usa el adaptador Python existente, heartbeat y lease, sin cola durable ni reintentos. Las fuentes congeladas requieren acceso vigente al mismo repositorio; un commit posterior no sustituye el contexto del experimento. Sugerencias automáticas y revisiones humanas versionadas tienen autoridades distintas.

| Decisión E6 | Elección | Motivo |
| --- | --- | --- |
| D30 | Mensajes y condiciones inmutables por lote; orden de repeticiones explícito. | Comparar con el mismo contexto y permitir exportación reproducible. |
| D31 | Tarifas fechadas del operador y estimador parcial de texto nullable. | Evitar precios inventados, doble conteo y confundir costes de API con factura/recursos locales. |
| D32 | Aceptación humana y sugerencia literal separada, con auditoría. | Permitir revisar automatismos y relacionar costes/latencias con resultados aceptables. |
| D33 | Caché observada separada de condiciones declaradas. | No inferir frío/caliente por velocidad, carga o repetición. |

| Decisión E7 | Elección | Motivo |
| --- | --- | --- |
| D34 | PostgreSQL como cola y autoridad; sin Redis ni doble publicación. | Crear trabajo/evento y asignar intentos de forma transaccional con la infraestructura existente. |
| D35 | Worker separado y proceso hijo de confianza con IPC, watchdog y generación de lease. | Recuperar caídas, rechazar resultados antiguos y comprobar cancelación real antes de integrar código. |
| D36 | Reservas acumuladas, checkpoints y reintentos clasificados. | Evitar duplicar efectos o ampliar presupuesto/plazo tras fallos; conservar incertidumbre de parada. |
| D37 | E7 solo simulación; frontera independiente antes de E8. | No confundir un contenedor operativo con aislamiento suficiente para repositorios no confiables. |

| Decisión E8 | Elección | Motivo |
| --- | --- | --- |
| D38 | CLI oficial Codex 0.166.0 y JSONL, mediante adaptador del worker. | Usar un ciclo de herramientas real, con interfaz no interactiva fijada y supervisión propia. |
| D39 | Controlador de confianza con Docker socket; código en namespace y usuario separados. | No conceder a repositorios secretos ni la autoridad del motor. |
| D40 | Red `none` y pasarela de modelo por socket Unix por trabajo. | Bloquear red general y mantener claves fuera del contenedor ejecutable, con cupo/política de petición. |
| D41 | Snapshot filtrado de blobs y recolector independiente sobre código pausado. | Fijar procedencia y producir un diff sin confiar en Git o artefactos ejecutables del repositorio. |
| D42 | Sin reintentos automáticos de código; uso CLI/pasarela separados y nulos explícitos. | No repetir efectos facturables ni convertir incertidumbre o eventos del agente en consumos garantizados. |

E9 añade `review-service.ts`/`review-artifacts.ts` junto al flujo de código, usando el cliente GitHub existente. La migración 009 conserva base/árbol/entorno y revisión SQL. Solo la API tiene credenciales GitHub; el ejecutor no adquiere permisos remotos. Detalles en [reviews.md](reviews.md).

| Decisión E9 | Elección | Motivo |
| --- | --- | --- |
| D43 | Revisión humana versionada ligada al hash del informe; publicación separada y explícita. | Hacer revisable el resultado antes de introducir efectos remotos. |
| D44 | Árbol sobre el commit inicial, rama única por ejecución, commit determinista y reconciliación de PR `state=all`. | Conservar archivos/modos no editados y recuperar respuestas perdidas sin sobrescribir ramas ni duplicar PR. |
| D45 | Reserva SQL acotada sin red dentro de transacciones; comprobaciones de base antes de cada etapa y aviso de carrera final. | Mantener disponibilidad y reconocer que SQL/GitHub no comparten transacción ni bloqueo de base. |
| D46 | Imagen inmutable y hash de política por ejecución; repetición desde la entrada SQL original. | Comparar modelos con las mismas herramientas, fuentes, límites y criterios, sin afirmar que existen distintos motores de agentes. |

E10 introduce `context-engine.ts` y `context-analysis.ts` dentro del laboratorio, reutilizados por chat únicamente con política adoptada. La migración 010 conserva operaciones, entradas reutilizables por proyecto/serie y política versionada. La API no recibe estrategias arbitrarias desde un turno ni promociona resultados simulados. [Protocolo y límites](context-optimization.md).

| Decisión E10 | Elección | Motivo |
| --- | --- | --- |
| D47 | Cuatro estrategias versionadas, corpus común congelado y orden rotado por caso/repetición. | Comparar el mismo problema sin reconstruir silenciosamente la referencia ni favorecer siempre al último objetivo. |
| D48 | Registro previo/final de cada llamada auxiliar, métricas nullable y coste completo desconocido cuando faltan conceptos. | Incluir resúmenes/fallos/caché y distinguir reducción de tokens de descuento parcial del proveedor. |
| D49 | Huellas de contenido/permisos, configuración privada mediante HMAC, revisión de modelo y hash de implementación. | Impedir reutilización/adopción después de cambios observables; conservar históricos sin servir derivados no autorizados. |
| D50 | Caché de resultados por proyecto/experimento y productor identificable; prefijos del proveedor solo observados. | Contabilizar la creación y evitar que precalentamientos ocultos o mezcla de proyectos aparenten ahorro. |
| D51 | Política explícita con revisión humana pareada, mejora medida y validación de evidencia en uso. | Mantener el contexto habitual hasta disponer de resultados reales suficientes y permitir restablecer sin borrar historia. |

gRPC, MongoDB, múltiples agentes y selección mediante ML no son dependencias del MVP. Las decisiones se actualizarán con motivación y consecuencias si cambia el alcance.
