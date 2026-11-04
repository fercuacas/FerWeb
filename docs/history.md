# Historial de entregas y verificaciones

Archivo preservado el 2026-11-02, antes de separar las instrucciones de desarrollo. Describe evidencias y límites de ese momento; el estado vigente está en [status.md](status.md). Consultar solo para investigar una entrega, una comprobación o una migración anterior. No es lectura inicial obligatoria.

---

# Estado real de FerWeb

Actualizado: **2026-11-02**.

## Situación

**E8 implementada y validada en Docker con CLI/contenedores/comandos reales y proveedores GitHub/Responses simulados.** Codex CLI 0.166.0, controlador de confianza, contenedor separado por tarea/commit, pasarela sin claves en el código y recolector independiente del diff. `docker:check` superado: diez pruebas Python, diez básicas, tipos/compilación/formato, 57 pruebas/subcasos de integración, trece Chromium y smoke. No se han usado claves ni modelos externos reales. Guía y aislamiento efectivo en [codex.md](codex.md).

**E7 implementada y validada en Docker con trabajos simulados y procesos reales.** Cola transaccional PostgreSQL, worker separado, estados/progreso/eventos, límites de concurrencia/plazo/presupuesto ficticio, intentos acotados y checkpoints. Reinicios de API, SIGKILL/SIGSTOP del ejecutor, recuperación y cancelación forzada comprobados en una base desechable. En su entrega se superaron diez pruebas Python, siete básicas, tipos/compilación/formato, 50 pruebas/subcasos de integración y doce Chromium, más smoke. E7 habilitó `simulation-v1`; E8 amplía la cola con código/Codex. Chat/laboratorio mantienen su ciclo anterior. Guía: [jobs.md](jobs.md).

**E6 implementada y validada en Docker con proveedores y tarifas simulados.** Laboratorio por proyecto con casos/mensajes/contextos congelados, modelos y repeticiones, métricas reportadas, tarifas fechadas, caché observada/declarada, sugerencias revisables y valoración humana auditada. Exportación JSON/CSV y guardas de fuentes/propiedad. Superadas diez pruebas Python, siete básicas, tipos/compilación/formato, 41 pruebas/subcasos de integración y once Chromium, más smoke. No se han ejecutado modelos ni precios reales. Guía: [laboratory.md](laboratory.md).

**E5 implementada y validada con Qdrant, Python y PostgreSQL reales en Docker, usando GitHub y embeddings simulados.** Incluye ingesta autorizada, fragmentación por líneas, actualización incremental, búsqueda filtrada y contexto opt-in del chat con fuentes persistentes. La aceptación semántica y de extremo a extremo con App/modelos reales sigue pendiente; no se han descargado modelos ni enviado contenido real a proveedores. Configuración y límites en [retrieval.md](retrieval.md).

**E4 implementada y validada en Docker con proveedor simulado, Python y PostgreSQL reales.** Conversaciones por proyecto, catálogo de modelos, streaming, cancelación, parciales, errores y métricas desconocidas explícitas. OpenAI y Ollama tienen adaptadores implementados; **no se han realizado llamadas reales a esos proveedores ni validado GPU/modelos del anfitrión**. La guía de configuración y validación explícita está en [ai.md](ai.md).

**E3 implementada y validada en Docker con GitHub simulado y PostgreSQL real.** Hay autorización GitHub App con PKCE, conexión de instalación, selección/vínculo de repositorio/rama, árbol y contenido por commit, issues/PR, sincronización manual y webhooks firmados con deduplicación persistente. **La aceptación con una GitHub App e instalación reales queda pendiente de credenciales y configuración del propietario.** No se han realizado llamadas reales a repositorios ni configurado una entrada pública de webhooks.

**E2 completada y validada en Docker y de forma nativa con PostgreSQL 18.6 real.** El recorrido permite entrar, crear/editar/archivar/restaurar proyectos y gestionar tareas en un tablero con filtros y detalle. Las comprobaciones de dos cuentas rechazan el acceso a recursos ajenos tanto en API como en navegador.

**E1 aceptada también con Docker real.** Docker Desktop 4.97.0, motor Linux 29.9.2 y Compose v5.6.1 operativos en Windows. `npm run check:compose` ha construido las imágenes, arrancado los servicios, aplicado las dos migraciones y comprobado persistencia tras reinicio de PostgreSQL y recreación de contenedores.

La inspección HTTPS de AVG requería aportar su CA raíz de confianza durante la instalación de npm. Se añadió el override opcional `compose.ca.yaml` y un montaje BuildKit temporal, sin desactivar TLS ni incorporar el certificado a la imagen. El certificado público local queda ignorado en `.local/build-ca.pem`.

**Instancia habitual trasladada a Docker.** Los fuentes permanecen en Documentos/FerWeb; web, API y PostgreSQL se ejecutan en Linux. La cuenta existente conserva su contraseña y la base activa es `ferweb_postgres_data`. La base nativa está detenida. Operación y respaldos en [docker.md](docker.md).

## Disponible

- CLI para provisionar un único propietario, sin registro público ni credenciales demo.
- Contraseñas scrypt con sal; sesiones opacas de ocho horas en PostgreSQL, con hash del token, cookie HttpOnly/SameSite y revocación.
- Validación de origen/cabecera para mutaciones y límite persistente de intentos de login.
- Proyectos propios: crear, listar, abrir, editar, archivar y restaurar.
- Tareas: título, descripción, cuatro prioridades, tres estados y criterios de aceptación.
- Tablero por columnas; búsqueda, filtros de prioridad/estado y detalle editable.
- Archivo reversible con conservación de tareas y solo lectura.
- Propiedad por consulta de servidor, validación estricta y versiones para evitar sobreescrituras.
- Caché RTK Query separada entre identidad y datos privados; Redux para filtros/selección y borradores locales.
- Estados de carga, error, vacío, guardado y sesión terminada; fallos de guardado conservan campos.
- Interfaz coherente con E1, foco de diálogos, Escape y adaptación móvil.
- Salud pública y pantalla `/#/status`, sin datos de proyectos.
- Menú GitHub y pestaña de repositorio en cada proyecto; configuración deshabilitada explícitamente si no hay App en el servidor.
- Credenciales GitHub cifradas por propietario, instalaciones/repositorios revalidados antes de servir snapshots o archivos y revocaciones que eliminan contenido guardado.
- Código por commit/blob, listas de issues/PR fechadas, límites y datos parciales indicados; lectura sin ejecutar código ni publicar cambios en GitHub.
- Webhooks HMAC sobre bytes originales, registro SQL único por entrega y generación que evita publicar una sincronización anterior a un evento nuevo.
- Conversaciones persistentes por proyecto, proveedor/modelo inmutables, historial enviado solo desde el servidor, streaming y cancelación con texto parcial conservado.
- Servicio Python con adaptadores OpenAI Responses y Ollama, catálogo permitido, timeout, errores normalizados y token privado Node/Python. Claves de proveedores solo en Python.
- Tiempos de API separados del uso/duraciones reportados por proveedor; ausencias como `null`, coste desconocido y sin fallback externo del modo local.
- Qdrant 1.20.0 interno, volumen persistente, embeddings exclusivamente Ollama local y modelo/dimensiones/digest explícitos; sin envío externo para indexar ni fallback.
- Manifiesto y texto autorizados en SQL; reembeddings solo de documentos modificados, eliminación de retirados, reparación de vectores ausentes y bloqueo de índices obsoletos.
- Fuentes con proyecto, repositorio, ruta, commit, líneas y observación independiente para incidencias/PR; roles estáticos separados del contenido recuperado.
- Contexto GitHub explícito por mensaje, abstención sin generación cuando no hay evidencia y ocultación de fuentes/respuesta derivada al perder acceso.
- Laboratorio con casos y mensajes congelados, objetivos/configuración, repeticiones y orden explícitos; métricas, errores y parciales por intento.
- Tarifas USD fechadas del operador, estimación parcial de texto y cobertura de importes; caché observada separada de fría/caliente declarada.
- Sugerencias automáticas literales y revisiones humanas auditadas con control de versión; calidad, latencia y coste/tiempo por resultado aceptable, exportación JSON/CSV autorizada.
- Pestaña Trabajos por proyecto: simulaciones persistentes, progreso, eventos incrementales, intentos, resultado y solicitud/confirmación de cancelación.
- Cola SQL y worker Docker independiente: máximo dos trabajos globales y uno por proyecto, reservas acumuladas, plazo persistente, backoff y generación por intento que rechaza resultados antiguos.
- Proceso hijo real por simulación, watchdog de IPC/lease/plazo y parada SIGTERM/SIGKILL. La pérdida del ejecutor conserva confirmación física desconocida.
- Codex por tarea/versión y commit sincronizado, con snapshot filtrado, contenedor independiente y límites explícitos; supervisión, cancelación, resumen, diff de texto, comandos, verificación y uso disponible guardados.
- Clave del modelo solo en controlador de confianza; código sin socket Docker, credenciales generales ni red general. Recolector separado y comparación contra fuente congelada. No hay reintentos automáticos de código ni publicación de cambios.
- [README](../README.md), [contrato HTTP](api.md) y [arquitectura](architecture.md) actualizados.

## Progreso

| Entrega | Estado |
| --- | --- |
| E0: definición | Completada. |
| E1: base Docker | Completada; arranque, salud, migraciones y persistencia verificados con motor Linux real. |
| E2: propietario, proyectos y tareas | Completada con pruebas reales y revisión visual. |
| E3: GitHub en lectura | Implementada y probada con proveedor simulado; pendiente aceptación con App e instalación reales. |
| E4: chat local/API | Implementada y probada con proveedor simulado; pendiente aceptación OpenAI/Ollama reales. |
| E5: contexto y fuentes | Implementada y probada con Qdrant real y embeddings/GitHub simulados; pendiente aceptación semántica con modelo y App reales. |
| E6: comparativas y cierre del MVP | Laboratorio implementado y validado con proveedores simulados. Aceptación externa y cierre real del MVP pendientes de modelos, fuentes y presupuesto del propietario. |
| E7: trabajos persistentes y simulador | Implementada y validada con procesos reales en Docker; no admite ejecución de código ni inferencia. |
| E8: Codex por tarea y commit | Implementada y comprobada con CLI/contenedores reales y proveedores simulados; aceptación externa separada. |
| E9–E11: revisión/publicación, optimización y operación | Pendientes. |

## Evidencias E8

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superado: diez pruebas Python, diez básicas, tipos/compilación/formato, 57 pruebas/subcasos de integración, trece Chromium y smoke. Registro privado `.local/e8-docker-check.log`. No se han hecho llamadas a proveedores externos ni escrituras remotas. |
| CLI e imagen | Paquete oficial `@openai/codex@0.166.0` fijado; `codex --version` comprobado en contenedor sin red. No se copia autenticación del escritorio ni se añade una clave al contenedor del repositorio. |
| Entrada y permisos | Tarea/versión/criterios, repositorio/commit y archivos/manifiesto congelados. Reenvío idéntico no duplica ejecución; UUID conflictivo, input con comandos, commit distinto y sesión ajena rechazados. Una edición posterior de la tarea no cambia la copia. |
| Recorrido con repositorio preparado | GitHub y Responses simulados, CLI Codex real. Se reproduce el fallo de suma, se modifica solo `src/add.cjs`, se ejecutan comandos y `node --test`; otra verificación lanzada por el controlador termina con código 0. El controlador calcula el diff desde otro contenedor sobre el volumen pausado, sin usar el Git del repositorio. |
| Frontera observada desde código | UID 1000, cero capacidades, `NoNewPrivs`, CPU/PIDs/memoria y workspace temporal de 64 MiB comprobados. Sin claves generales ni generación de control en el input; sin socket Docker, escrituras en raíz/control, carpeta del controlador o ruta de red externa. Se comparte kernel: no es certificación de aislamiento hostil. |
| Métricas | Inicio/fin/duración, modelo solicitado/configuración y peticiones conservados. Uso de CLI separado del uso observado por la pasarela. Cero reportado se conserva; campos ausentes/peticiones incompletas quedan desconocidos. Coste `null`; datos sintéticos no equivalen a factura o rendimiento de un modelo real. |
| Fallos y parada | Cupo de una petición, fallo del proveedor, plazo, cancelación y pérdida del worker comprobados. No se reejecuta código automáticamente. Docker confirma parada normal/cancelada; SQL mantiene confirmación desconocida para el ejecutor perdido aunque el controlador observe su parada por separado. |
| Bloqueos SQL y recuperación | Detectado y corregido bloqueo por un cliente pausado dentro de una transacción. Timeout local de inactividad de un segundo y descarte de conexión rota. Prueba nueva pausa con bloqueo adquirido; la recuperación prosigue sin reanudar ese cliente. |
| Informes y navegador | Informe SQL disponible desde otra instancia de servicio y tras recargar la web. Revocación GitHub simulada bloquea informes y detiene trabajo; en Chromium un 403 oculta también la copia previamente visible en caché. Móvil 390 px sin desbordamiento; captura revisada `.artifacts/docker-tests/e8-codex-mobile.png`. |
| Diff aplicable | Prueba con Git real aplica adiciones, eliminaciones, archivos vacíos, nombres con espacios/comillas y ausencia de salto final. No se crean commits ni se modifica el repositorio original. |
| Datos | Dump previo privado `.local/backups/pre-e8-2026-11-02.dump`; instalación, cuenta, proyectos y tareas conservan recuentos y huellas tras aplicar 008. Contraseñas anteriores conservadas; `setup` añade únicamente el token interno nuevo que faltaba. |
| Operación y limpieza | Siete servicios habituales saludables, migrador con salida 0 y readiness con ocho migraciones aplicadas/requeridas. Cero bases/colecciones temporales y cero contenedores/volúmenes de ejecución de código al finalizar. `ai-test` y `runner-test` detenidos y eliminados; volúmenes de aplicación conservados. |
| Higiene | 191 archivos públicos y 120 enlaces locales comprobados; whitespace sin errores, secretos PostgreSQL/IA/controlador ausentes del fuente y respaldos/capturas ignorados. Sin commits, pushes o publicaciones. |

Límites y configuración en [codex.md](codex.md). Falta aceptación explícita con una GitHub App, repositorio y modelo OpenAI reales elegidos por el propietario. No hay publicación de ramas/PR, instalación de dependencias, clon completo ni ejecución pública de código arbitrario.

## Evidencias E7

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superado: 10 pruebas Python, siete básicas, tipos/compilación/formato, 50 pruebas/subcasos de integración y doce Chromium, más smoke. Registro privado `.local/e7-docker-check.log`; sin llamadas reales a proveedores. |
| Persistencia y correlación | Creación/evento inicial atómicos; API y worker separados en base desechable. Reiniciar API conserva UUID, progreso, resultado y eventos; UUID común en logs, eventos e intentos. |
| Idempotencia y permisos | Encolado simultáneo con mismo UUID/condiciones crea un solo trabajo; condiciones distintas se rechazan. Reservas y efectos repetidos no duplican cargos/filas. Sesión ajena, recurso mal asociado y configuración con comandos se rechazan. |
| Concurrencia | Dos workers compiten por tres proyectos; intervalos persistidos comprueban máximo dos globales y uno por proyecto. Procesos hijo distintos y entorno sin claves/credenciales heredadas. |
| Recuperación | SIGKILL del worker termina al hijo por IPC; reemplazo retoma checkpoint. SIGSTOP deja vencer watchdog del hijo y otro worker recupera. Al reanudar el antiguo, su generación no puede publicar. Intento perdido conserva `terminationConfirmed: null`. |
| Fallos y presupuesto | Fallos transitorios antes/después del checkpoint se recuperan sin repetir efectos. Fallo permanente, máximo de intentos, presupuesto agotado y plazo vencido terminan; reservas de intentos fallidos se conservan y se comprueban numéricamente. |
| Cancelación | Pendiente no crea proceso; activo detecta solicitud, envía señal y espera salida. Simulador que ignora SIGTERM termina con SIGKILL, PID observado fuera de ejecución y sin progreso posterior. |
| Navegador | Encolar, ver progreso, recargar y recuperar el mismo trabajo, resultado persistente y cancelación confirmada. Móvil 390 px sin desbordamiento; captura revisada `.artifacts/docker-tests/e7-jobs-mobile.png`. |
| Docker y migración | Migración 007 aplicada; web/API/base/IA/Qdrant/worker saludables. Worker no publica puerto, no monta socket Docker ni recibe secretos GitHub/IA; recursos limitados y raíz de solo lectura. No se ha validado como sandbox de código hostil. |
| Datos y repositorio | Dump privado previo a E7 y comparación posterior: instalación, cuenta, proyectos y tareas conservan recuentos/huellas. Auditoría de 160 archivos públicos y 95 enlaces locales, whitespace sin errores y secretos locales ausentes del fuente; respaldos/capturas ignorados. Sin commits ni publicaciones. |
| Limpieza | Cero bases o colecciones temporales al finalizar. `ai-test` detenido y eliminado; seis servicios habituales saludables y migrador con salida 0. Readiness confirma siete migraciones requeridas/aplicadas. |

La validación usa procesos reales del simulador, pero sus efectos y costes son sintéticos. No confirma facturación ni aislamiento para agentes reales. E7 no convierte las interrupciones de chat/laboratorio en reintentos automáticos.

## Evidencias E6

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superado: 10 pruebas Python, siete básicas, tipos/compilación/formato, 41 pruebas/subcasos de integración y once Chromium, más smoke. Registro privado `.local/e6-docker-check.log`. Las suites de integración se ejecutan secuencialmente para aislar contadores del proveedor simulado compartido. |
| Congelación y repeticiones | Copias de casos, mensajes exactos y hashes, fuentes, configuración y tarifas conservadas; dos objetivos local/API y dos repeticiones producen cuatro intentos en orden explícito. UUID de preparación y ejecución repetida no duplican llamadas. Nueva instancia del servicio lee las mismas condiciones/resultados. |
| Métricas y caché | Primer texto/total observados, modelo solicitado/reportado, revisión y uso guardados. Caché positiva, cero y ausente se distinguen. Adaptador Ollama conserva `prompt_eval_cached_count` con MockTransport; no se infiere frío por ser primera repetición. |
| Estimación | Tarifas sintéticas fechadas, entrada/caché/salida, vigencia, datos ausentes e inconsistencias comprobadas. No hay importes ni precios reales. Por aceptable incluye todos los intentos y solo aceptación humana; coste parcial de texto, separado del reportado. |
| Valoraciones | Una sugerencia automática favorable no acepta el resultado. Revisión humana puede discrepar, corregirse y conservar ambas versiones; versión antigua y aceptación con criterios fallidos son rechazadas. |
| Fallos y recuperación | Error de proveedor con parcial, uso desconocido, cancelación y omisión de repeticiones pendientes; lease vencida conserva parcial, marca interrupción y no reinicia inferencia. Archivo bloquea mutaciones. |
| Fuentes y propiedad | Recursos de otro usuario/proyecto rechazados. Caso con fuente GitHub conserva commit anterior al sincronizar uno nuevo; acceso revocado bloquea exportación y lectura completa. |
| Exportación y navegador | JSON/CSV conservan condiciones, contexto, métricas, tarifas y revisiones; celdas de fórmulas saneadas. Recorrido web crea casos/tarifas, ejecuta, revisa, descarga ambos formatos y conserva valoración tras recarga. Vista móvil 390 px sin desbordamiento global; tabla desplazable dentro de su contenedor. Captura privada `.artifacts/docker-tests/e6-lab-mobile.png`. |
| Datos y entorno | Backup previo `.local/backups/pre-e6-2026-11-02.dump`. Huellas de instalación/usuarios/proyectos/tareas idénticas tras validar; sin bases ni colecciones desechables. Cinco servicios saludables, migración 006 aplicada y `ai-test` eliminado. |
| Higiene | 144 archivos públicos revisados sin secretos locales ni whitespace incorrecto y 81 enlaces locales resueltos. Dumps, snapshots, exportaciones de prueba y captura ignorados. Sin commits, pushes ni llamadas reales como efecto de la entrega. |

La prueba Chromium se ajustó para seleccionar los desplegables por su rol/nombre accesible. La suite completa final pasó. La calidad, latencia/caché y coste con modelos reales siguen pendientes de una validación explícita con presupuesto del propietario; el cierre externo del MVP no se declara completado.

## Evidencias E5

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superada la suite: 10 pruebas Python, tipos, siete básicas, compilación, formato, 33 pruebas/subcasos de integración y diez Chromium, más smoke. Registro ignorado `.local/e5-docker-check.log`. |
| Embeddings | HTTPX MockTransport comprueba ejecución exclusivamente local, `truncate:false`, digest, dimensiones, rechazo de cloud/cambio de digest, autenticación interna y límites. No usa un modelo real. |
| Relevancia de integración | Cuatro preguntas del corpus sintético recuperan la fuente esperada en primera posición; una pregunta sobre facturación no encuentra evidencia. Preguntas/respuestas/fuentes esperadas en [retrieval-evaluation.json](../tests/fixtures/retrieval-evaluation.json). Este resultado no mide semántica de un embedding real. |
| Incremental | Primera ingesta de seis documentos; repetición con cero embeddings. Modificar un archivo y una incidencia y retirar otro archivo calcula dos embeddings, reutiliza tres documentos y elimina los puntos anteriores correspondientes. La cita avanza al commit nuevo. |
| Permisos | Sesión obligatoria, usuario ajeno 404, exclusiones de código/credenciales/compilados; mismo repositorio en dos proyectos devuelve solo fuentes del proyecto solicitado. Se ocultan fuentes y respuesta derivada si GitHub retira acceso. |
| Publicación y fallos | Límites impiden publicar documentos a medias; snapshot obsoleto bloquea búsqueda. Invalidación durante la lectura de un blob rechaza la publicación y conserva la fecha/manifiesto anteriores. Los puntos recuperables siempre se restringen a IDs activos SQL. |
| Chat/navegador | Indexar, buscar, activar contexto, ver cita/fragmento/commit, recargar historial, abstención y vista de 390 px comprobados con el servicio Python de pruebas. Captura privada `.artifacts/docker-tests/e5-context-mobile.png`. |
| Entorno | Cinco servicios habituales: web/API/base/IA/Qdrant, sin publicar PostgreSQL/IA/Qdrant. Migración 005 aplicada. `ai-test` detenido/eliminado al terminar. |
| Respaldo | Dump previo `.local/backups/pre-e5-2026-11-02.dump` y huellas de instalación/usuarios/proyectos/tareas guardadas antes de migrar. No se recrearon cuentas ni se restauró la base activa. |
| Cierre | Suite completa repetida tras corregir una carrera de espera en la preparación del test de navegador. Cinco servicios saludables, readiness 5/5 migraciones, cero bases/colecciones de pruebas y `ai-test` eliminado. Huellas de instalación/usuarios/proyectos/tareas idénticas al respaldo previo. 133 archivos públicos sin secretos locales ni whitespace incorrecto; 70 enlaces locales resueltos. |

Pendiente la aceptación explícita con GitHub App real y un modelo local de embeddings elegido por el propietario: catálogo, calidad semántica, calibración del umbral y resistencia cualitativa del modelo de chat a instrucciones maliciosas. Las llamadas reales y descargas siguen fuera de los tests automáticos. Los payloads vectoriales huérfanos tras una revocación no se borran físicamente de forma inmediata, pero quedan fuera de toda recuperación por permisos/manifiesto; límites en [retrieval.md](retrieval.md).

## Evidencias E4

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superado: siete tests Python con MockTransport, tipos, siete pruebas básicas, compilación, formato, 26 pruebas/subcasos de integración y nueve pruebas Chromium, más smoke. Repetido tras reforzar el cierre de conexiones al cancelar. Registro ignorado `.local/e4-docker-check.log`. |
| Python | Peticiones Responses `stream=true/store=false`, normalización de uso/ceros/desconocidos, respuesta incompleta, fallo sin evento terminal, errores saneados, autenticación interna, exclusión cloud y ausencia de fallback Ollama comprobados con transporte simulado. |
| Node → Python → PostgreSQL | Streaming HTTP real contra `ai-test`, respuesta por deltas, modelo/configuración/uso guardados y persistencia al crear una nueva instancia del servicio Node comprobados. |
| Propiedad y admisión | Usuario/proyecto ajenos rechazados; proveedor inmutable; UUID duplicado, versión y generación concurrente protegidos; archivo rechaza nuevos mensajes y permite historial. |
| Cancelación y fallos | Cancelación por control independiente con respuesta parcial, uso desconocido y confirmación remota null; lectura HTTP del adaptador cerrada y proveedor Python simulado inactivo después de cancelar; errores posteriores al primer texto guardados; sesión revocada detiene el flujo; lease abandonada recuperada como interrumpida sin inferencia nueva. |
| Contexto | Solo turnos completos de la misma conversación; IDs guardados, turnos cancelados/fallidos excluidos y otro proyecto sin datos del primero. |
| Navegador | Crear conversación/modelo, mensaje incremental, consumo, cancelar, recargar historial, error persistido y vista móvil comprobados junto a regresión E1–E3. Captura revisada en `.artifacts/docker-tests/e4-chat-mobile.png`. |
| Entorno | Python 3.13.18, FastAPI 0.162.0, HTTPX 0.28.1 y Uvicorn 0.54.0; lock transitivo con hashes instalado. API/web/base/IA saludables y migración 004 aplicada. `ai-test` eliminado al terminar las comprobaciones. |
| Secretos y operación | Token interno generado sin imprimir ni reemplazar contraseña PostgreSQL. Configuración privada IA opcional solo en Python. `ferweb_ai.verify` requiere invocación manual explícita y no fue ejecutado. |
| Respaldo | Dump previo `.local/backups/pre-e4-2026-11-02.dump` y huellas del propietario/proyectos/tareas guardadas antes de aplicar 004. |
| Cierre | Huellas de usuarios/proyectos/tareas e instalación conservadas tras los tests; sin bases desechables. Overrides IA/CA validados con configuración vacía de prueba. 119 archivos públicos sin whitespace incorrecto ni secretos locales; 49 enlaces resueltos. Readiness confirma cuatro migraciones. |

No se ha probado inferencia, disponibilidad de catálogo ni consumo de una cuenta OpenAI o modelo Ollama reales. La resolución de `host.docker.internal` desde Docker sí se ha comprobado; eso no demuestra conectividad HTTP, instalación de modelo o aceleración GPU.

## Evidencias E3

| Comprobación | Resultado |
| --- | --- |
| `npm run docker:check` | Superado: tipos, siete pruebas básicas, compilación, formato, 18 pruebas/subcasos de integración y ocho pruebas Chromium, seguidas de smoke contra la instancia Docker habitual. Registro ignorado `.local/e3-docker-check.log`. |
| Autorización y credenciales | OAuth/PKCE con estado de un solo uso, expiración y sesión original revocada; cifrado AES-GCM ligado al propietario, vector HMAC oficial y ausencia de tokens en DTO comprobados. |
| Instalaciones y repositorios | Se filtran instalaciones de otra App, se comprueban permisos, paginación y pertenencia, y se rechazan proyectos/recursos ajenos antes de consultar al proveedor. |
| Código y snapshots | Rama resuelta a commit, árbol filtrado, texto por blob, exclusiones, binarios/symlinks/tamaño, versión antigua, separación de issues/PR y truncado comprobados. |
| Webhooks | Firma incorrecta, payload inválido, compresión y exceso de tamaño rechazados; duplicados concurrentes con un solo efecto, conflicto de cuerpo y replay con una nueva instancia de API mantienen deduplicación SQL. |
| Sincronización y revocación | Un webhook durante el fetch impide publicar el resultado antiguo. Retirada de permisos/repositorio, suspensión, revocación de usuario y token inválido eliminan datos/credenciales según su ámbito. Rate limit no revoca credenciales. Archivo bloquea mutaciones. |
| Recorrido de navegador | Login real, redirección GitHub simulada, conexión de instalación, proyecto, repositorio/rama, primera sincronización, archivo, issues/PR como texto, actualización manual y desconexión comprobados; ocho pruebas totales con regresión E1/E2. |
| Visual | Vista GitHub en escritorio y 390 px revisada; sin desbordamiento. Capturas privadas en `.artifacts/docker-tests/e3-github-*.png`. |
| Datos existentes | Backup `.local/backups/pre-e3-2026-11-01.dump` antes de migrar. Tras los tests, huellas de usuarios/proyectos/tareas e instalación idénticas a la copia previa. Migración 003 aplicada; no quedan bases desechables ni fixtures en la aplicación. |
| Configuración | Overrides GitHub/CA validan con `config --quiet` y valores de prueba, sin arrancar la instancia con ellos. Configuración real no suministrada; no se ha verificado autorización ni webhook externos reales. |
| Higiene final | 93 archivos de fuente revisados sin whitespace incorrecto ni contraseña privada de base; 39 enlaces locales resueltos. Configuración privada, backups y capturas ignorados. Tras ajustar únicamente el encuadre de capturas se repitió el recorrido GitHub, superado. |
| Reanudación 2026-11-02 | Docker Desktop iniciado tras encontrarlo detenido; `npm run docker:up` superado con volumen existente y web/API/base saludables. Readiness confirma las tres migraciones. No se repitieron las suites completas al no cambiar código funcional. |

Los tests de GitHub inyectan el transporte de `tests/fixtures/github.mjs`. El servidor de navegador usa los handlers reales con esa inyección; la API habitual carga únicamente la configuración privada de servidor. No hay modo simulado seleccionable desde la web ni desde una opción de producción.

## Evidencias históricas E1–E2

| Comprobación | Resultado |
| --- | --- |
| `npm run check` | Tipos estrictos, siete pruebas básicas y compilación de contratos/API/web superados. |
| `npm run check:smoke` | Web, proxy, API, esquema e instalación locales comprobados; tolera hasta diez segundos de reinicio del API en modo watch. |
| `npm run test:integration` | Ocho pruebas/subcasos superados con bases desechables y PostgreSQL real: migraciones, sesiones y API con dos usuarios. |
| Recursos ajenos | Listado propio sin datos ajenos; 404 para lectura/edición/archivo de proyecto ajeno y lectura/creación/edición de sus tareas. Se verifica también tarea bajo proyecto equivocado. |
| Identidad | Credenciales erróneas/no existentes con mismo error, hash de contraseña/token, rotación, logout, expiración y límite de login comprobados. |
| Escritura | Campos inválidos/adicionales, JSON inválido, cuerpos excesivos, rechazo de origen/cabecera, conflictos de versión y archivo/restauración comprobados. |
| `npm run test:browser` | Siete pruebas Chromium superadas con API/web/base aisladas, sin cuentas ni puertos del usuario. |
| Recorrido web | Login, fallo de guardado con borrador conservado, proyecto, tarea, criterios, recarga, filtros, edición, archivo, lectura, restauración, cambio de columna, logout y nuevo login con datos conservados. |
| Sesión y permisos en navegador | Cookie HttpOnly/SameSite, rechazo de IDs ajenos, credenciales erróneas y retorno al login tras revocación comprobados. |
| Accesibilidad y móvil | Foco inicial/trampa de diálogo, Escape y ausencia de desbordamiento a 390 px comprobados. |
| Aprovisionamiento | CLI compilado ejecutado con credenciales aleatorias de proceso en la base de navegador; repetición sin cambio de propietario comprobada en integración. |
| Migraciones de aplicación | Migraciones 001 y 002 aplicadas en la base local conservando el registro de instalación. |
| Compose | Configuración principal y override nativo validados previamente; override de CA validado con Docker Compose v5.6.1 instalado. |
| `npm run check:compose` | Superado con Docker real y `FERWEB_BUILD_CA_FILE=.local/build-ca.pem`: instalación de dependencias Linux, compilación, servicios saludables y dos migraciones. El UUID de instalación se conserva tras `restart db` y `down`/`up`. |
| Limpieza Docker | Eliminados únicamente los contenedores, red y volumen desechable de `ferweb-check-6f29c7bd71`; sin modificar datos ni procesos de la aplicación nativa. Registro local ignorado: `.local/compose-check.log`. |
| Traslado de la instancia | Dump lógico restaurado en el volumen definitivo nuevo, con siete tablas idénticas por recuento y SHA-256 del contenido normalizado en UTC. Una cuenta, cero proyectos/tareas y dos migraciones conservados; credenciales sin cambios. Copia y comparación en `.local/backups/native-to-docker-2026-11-01.*`. |
| Arranque definitivo | API/web/base saludables tras recrear contenedores con el volumen restaurado; migrador finalizado con código 0. PostgreSQL portable detenido y sin servidores nativos FerWeb activos. |
| Recarga desde Windows | Cambio de timestamp en el fuente de API detectado por el watcher del contenedor; proceso reiniciado y readiness recuperada sin cambiar contenido ni datos. |
| `npm run docker:check` | Superado íntegramente en el contenedor `tools`: tipos, siete pruebas básicas, compilación, formato, ocho pruebas/subcasos de integración, siete pruebas Chromium y smoke contra la instancia Docker habitual. Registro ignorado: `.local/docker-check.log`. |
| Cierre de migración | Tras las pruebas, las siete tablas activas conservan las huellas originales y no quedan bases desechables. `npm run docker:format` superado sin cambios; 28 enlaces locales y whitespace de 15 archivos revisados. Solo API/web/base Docker quedan en ejecución, saludables. |
| Inspección visual | Login y tablero revisados en escritorio/móvil; capturas ignoradas en `.artifacts/e2-*.png`. |
| Formato | `npm run format:check` superado. |
| Higiene | Revisados 69 archivos de fuente, 24 enlaces locales y whitespace de archivos nuevos; secretos y artefactos excluidos. |

Las bases desechables y los procesos de navegador se eliminan al terminar las pruebas. Las dos cuentas de fixtures no se crean en la base de aplicación. La migración a Docker conserva la cuenta que ya existía, sin cambiar ni conocer su contraseña.

La evidencia histórica nativa de E1 incluye arranque desde una copia limpia y persistencia del UUID/fecha al detener/arrancar PostgreSQL. La validación Docker posterior de E1 es independiente y utiliza imágenes construidas sin dependencias locales ni datos del usuario.

Al ejecutar las suites en Docker se detectaron dos ajustes del entorno: las operaciones administrativas CREATE/DROP DATABASE de los fixtures necesitan hasta 30 segundos por los checkpoints de disco (la API mantiene sus límites cortos), y Vite permite explícitamente el nombre interno `web` para el smoke entre contenedores. La base desechable dejada por el primer timeout se eliminó por su nombre exacto; la repetición completa terminó correctamente.

## Entorno local para revisión

FerWeb está en `http://127.0.0.1:5173`, con web, API, PostgreSQL, servicio Python IA, Qdrant, worker y runner en Docker; el migrador termina con código 0. PostgreSQL, IA, Qdrant, worker y runner no publican puerto en Windows. Los siete servicios habituales usan `unless-stopped` y requieren Docker Desktop iniciado. No quedan servidores de desarrollo nativos de FerWeb.

`npm run dev`, `owner:create` y `db:migrate` delegan ahora en Docker. El propietario actual entra con su cuenta existente. `docker:up`, `docker:stop`, `docker:restart`, `docker:status` y `docker:logs` gestionan el entorno; `docker:check` y `docker:format` usan herramientas en contenedores. La alternativa `dev:native` queda reservada para recuperación explícita.

## Límites y pendientes

- El cluster nativo y el dump previo se conservan detenidos/ignorados como respaldos. No incorporan cambios nuevos: la autoridad es el volumen Docker. No se ha ensayado una recuperación de desastre posterior a nuevas escrituras.
- No hay recuperación de contraseña por web, registro público, invitaciones ni colaboración.
- Desarrollo HTTP local con `COOKIE_SECURE=false`; no se ha probado HTTPS ni exposición pública.
- No se han hecho pruebas de carga ni afirmaciones de escalabilidad.
- GitHub está implementado, pero falta su validación real de extremo a extremo con la App del propietario; configuración y recorrido en [github.md](github.md).
- Los webhooks invalidan, no descargan automáticamente. Al expirar un token se requiere reautorizar; no se guarda refresh token. Las listas/archivos están sujetos a los límites explícitos de E3.
- Los adaptadores de modelos están implementados; faltan las validaciones reales explícitas de OpenAI y Ollama. No hay garantía de parada/facturación remota tras cerrar una conexión; se conserva esa confirmación como desconocida.
- RAG manual y limitado según [retrieval.md](retrieval.md); estimaciones parciales de texto en el laboratorio con tarifas del operador, sin factura real ni coste de infraestructura/energía. La cola admite simulación y tareas Codex E8; no reanuda automáticamente inferencia ni código. Sin coordinación multiagente, prueba de carga ni despliegue distribuido. Sin reranking, AST, carga masiva, evaluación semántica real ni garantía universal contra prompt injection.
- El worker E7 solo ejecuta su simulador de confianza dentro de su propio contenedor. E8 delega código en un controlador/namespace separado con los límites de [codex.md](codex.md). Es un kernel compartido, sin validación contra código hostil arbitrario; falta aceptación real de GitHub/modelos y no se ha ensayado caída física del disco o del anfitrión. Sin publicación de ramas/PR ni presupuesto monetario exacto del agente.
- Sin claves de servicios externos, commits, pushes ni despliegues.
- Datos, cuentas, binarios, capturas y configuración privada siguen ignorados.

## Siguiente entrega

Ejecutar las aceptaciones externas pendientes de E3–E6/E8 con la App, credenciales, modelos y presupuesto elegidos por el propietario. Siguiente incremento funcional: E9, revisión y publicación explícita/idempotente de ramas/PR. El trabajo y las comprobaciones siguientes se realizarán en Docker.

Antes de modificar E2, consultar [api.md](api.md) y conservar aislamiento, sesiones, archivo y control de versiones.

## 2026-11-02: instrucciones para desarrollar FerWeb

Reorganización documental solicitada para trabajar desde este repositorio, sin cambiar la IA de la aplicación ni adelantar E10.

- `AGENTS.md` raíz: 366 palabras; estado actual: 300. Lectura inicial propuesta de ambos: 666 palabras frente a 6704 anteriores, aproximadamente un 90 % menos de texto. No es una medición de tokens facturados o rendimiento del modelo.
- Diecinueve `AGENTS.md` en total: raíz más reglas acotadas por componente, dominio API, migraciones y tests. La raíz pide consultar solo la cadena del archivo objetivo si el cliente no la ha incorporado.
- `development.md`: mapa de entradas/guías/pruebas, dependencias entre áreas y recetas Docker dirigidas. README enlaza mapa e historial. El estado previo se conserva íntegro arriba; no sustituye al estado breve vigente.
- Comprobaciones: 211 archivos públicos, 152 enlaces locales y whitespace sin errores; ejemplos PowerShell analizados sintácticamente sin ejecutarlos, once rutas de código comprobadas y cadenas de ámbito de web/GitHub/test API verificadas.
- Comparación de huellas: solo `AGENTS.md`, `docs/status.md` y README cambiaron entre archivos preexistentes; los veinte archivos nuevos son Markdown. Código, contratos, dependencias, configuración y datos no se modificaron. Secretos locales ausentes de archivos públicos.
- No se han arrancado Docker/servicios ni ejecutado compilación, tests funcionales, modelos o llamadas reales. El motor estaba detenido y esta entrega es documental; las cifras de E8 siguen siendo evidencia de la entrega anterior, no pruebas repetidas ahora.

## 2026-11-03: E9, revisión, publicación explícita y comparación

Se completa el recorrido tarea → ejecución → revisión humana guardada → publicación explícita de rama/PR draft. El visor conserva diff, salidas/códigos de pruebas y limitaciones. La migración 009 guarda base/árbol/entorno y revisiones versionadas ligadas al hash del informe final. La publicación exige permisos de escritura de la App y del usuario, comprueba la cabeza real y conserva la misma rama/PR al reconciliar respuestas perdidas. No añade merge ni force push. Protocolo y límites: [reviews.md](reviews.md).

La repetición copia commit, archivos, tarea/criterios y límites; solo varía el modelo permitido. Se fija la imagen real del sandbox y un hash de política; el controlador rechaza entornos distintos. Se muestran diferencias explícitas al comparar ejecuciones de una tarea. Sigue existiendo un único motor Codex, sin comparación validada entre agentes distintos.

La primera comprobación general detectó una carrera durante la recogida: el supervisor recibía lease inválida antes de pausar y podía salir sin captura completa. Se corrigió manteniendo su lease durante la fase de recogida, dentro de los límites originales, con las nuevas llamadas al modelo bloqueadas. La integración Codex dirigida volvió a pasar (seis pruebas/subcasos). El navegador motivó asociar explícitamente etiquetas/textarea y esperar el UUID de la nueva ejecución antes de comprobar su finalización; no se relajaron expectativas de igualdad de condiciones.

Comprobaciones finales realmente ejecutadas:

- `npm run docker:format` y **`npm run docker:check` completos, salida 0**: diez pruebas Python, once básicas, 65 pruebas/subcasos de integración, trece Chromium, tipos/compilación/formato y smoke. Registro privado `.local/e9-docker-check.log`; primer fallo conservado en `.local/e9-docker-check-initial.log`.
- La nueva suite HTTP/SQL utiliza informes sembrados explícitamente y un doble GitHub con efectos/errores: aprobación/versiones, ámbitos ajenos, permisos, archivo, base cambiante, respuesta perdida después de commit/ref/PR, concurrencia, reserva expirada, colisiones, revocación e integridad. No ejecuta el agente en esa suite.
- El recorrido Chromium sí ejecuta CLI Codex/contenedores reales con Responses simulado; revisa, prepara y publica mediante el doble GitHub, recarga la revisión y repite/compara condiciones. Captura móvil inspeccionada: `.artifacts/docker-tests/e9-codex-review-mobile.png`, sin desbordamiento de página; la tabla tiene desplazamiento propio.
- Docker Desktop iniciado; siete servicios saludables, migración 009 aplicada y endpoint de salud `ready` con 9/9 migraciones. Fixtures retirados por los wrappers. Huellas SQL de usuarios, proyectos, tareas, conexiones GitHub, ejecuciones y revisiones en la base activa iguales antes/después de las pruebas; no se borraron volúmenes/datos del propietario.
- Sin App, configuración de proveedores/Codex ni repositorio remoto de prueba configurados en esta instalación: **no se realizaron llamadas reales de inferencia ni escrituras GitHub reales**. La aceptación externa queda documentada y pendiente. Sin commits, pushes o publicaciones del repositorio FerWeb.

No se implementa E10. Se actualizan README, guías del dominio/API/arquitectura/producto/roadmap, mapa e instrucciones locales; el estado breve sigue siendo la entrada vigente.

## 2026-11-03: E10, estrategias de contexto y evidencia de adopción

Se añade el recorrido de evaluación de contexto a E6: referencia amplia `wide-v1`, recuperación `retrieval-v1`, recuperación/resumen `summary-v1` y reutilización compatible `reuse-v1`. Casos y corpus están congelados; proveedor/modelo/configuración/tarifa comunes y orden rotado por caso/repetición. La migración 010 conserva operaciones, resultados por proyecto/serie y política versionada. Protocolo/límites en [context-optimization.md](context-optimization.md).

El motor compartido registra llamadas de resumen/respuesta y embeddings de consulta, mensajes, salidas/parciales, uso disponible, duración y costes parciales/motivos. Los resultados reutilizados identifican su productor; el coste de creación permanece en la serie. Tokens consumidos por llamadas nuevas y descuento de lectura de caché se muestran separados. Embeddings/cargos/infraestructura no reportados mantienen desconocidos consumo/coste completos; no se inventan tokens ni se etiqueta el subtotal como una factura.

La invalidación cubre contenido/procedencia, permisos/autorización, configuración de embeddings/proveedor, revisión conocida de modelo e implementación/prompts. La configuración privada se representa mediante HMAC, sin exponer claves. Se rechaza también la pérdida de permisos entre dos consultas remotas de acceso. La lectura histórica de derivados sigue autorizada; cambios de condiciones impiden reutilizar/adoptar.

La adopción exige acción explícita, evidencia real completada y revisada por parejas, al menos dos casos distintos y dos repeticiones, calidad no inferior y mejora medida de al menos el 5 % en la medida elegida. Las simulaciones y métricas insuficientes no la habilitan. El chat consulta esa política únicamente para el modelo/configuración evaluados, conserva el historial permitido, informa de preparación y confirma fuentes finales; cambiar las revisiones que respaldaban la política la invalida. El cableado de chat se probó sembrando una política exclusivamente en la base desechable del test, sin atravesar ni desactivar el bloqueo de adopción simulada de la API.

Evidencia efectivamente ejecutada:

- **`npm run docker:check`, salida 0**: diez pruebas Python, once básicas, 73 pruebas/subcasos de integración, catorce Chromium, tipos, compilación, formato y smoke. Log privado `.local/e10-docker-check.log`. Pruebas dirigidas: ocho pruebas/subcasos E10 y recorrido Chromium propio, antes de la regresión completa.
- Cinco preguntas existentes de `retrieval-evaluation.json` × cuatro estrategias × dos repeticiones: **40 intentos simulados completados**. SQL, Qdrant y HTTP/Python reales; inferencia/embeddings sintéticos. El informe privado `.artifacts/evaluations/e10-context-evaluation.json` conserva condiciones, corpus, mensajes/operaciones/resultados y marca explícitamente la simulación. Su carpeta de herramientas está separada de la que limpia Playwright.
- El informe observado registra auxiliares por estrategia: referencia 0, recuperación 10, resumen 18 y reutilización 10, con cuatro aciertos de caché de respuesta. La creación inicial permanece incluida. Estas cifras comprueban el recorrido del fixture, **no ahorro, velocidad ni calidad de una IA real**. El coste monetario completo sigue desconocido.
- Las pruebas cubren versiones/igualdad de condiciones, no envío de criterios, costes/consumo faltantes, origen de reutilización, revisiones, permisos y su retirada durante una consulta, configuración/revisión desconocida, fuentes cambiadas, caché fría por experimento, exportación y cancelación que alcanza un resumen activo. No se relajan expectativas por ausencia de datos.
- Chromium recorre preparación desde casos existentes, antes/después, operaciones de resumen, bloqueo de adopción simulada, persistencia/recarga y móvil. Captura inspeccionada `.artifacts/docker-tests/e10-context-mobile.png`: página sin desbordamiento; tablas con desplazamiento propio.
- Siete servicios Docker saludables; salud `ready`, 10/10 migraciones. Las huellas de datos previos de usuarios/proyectos/tareas/conexiones/ejecuciones/revisiones/casos/lotes/turnos se mantienen al excluir las columnas nuevas de la comparación. Registros de políticas activas y resultados de contexto en la base habitual: cero. No se borraron datos/volúmenes del propietario; los fixtures se retiraron.
- Auditoría documental y de secretos sobre fuentes públicos, más whitespace y revisión Git al cierre. Sin cambios de dependencias/versiones, commits, pushes o publicaciones. No se realizaron inferencias ni escrituras GitHub reales como efecto de las pruebas.

**No se ha adoptado ninguna mejora real ni se afirma ahorro real.** Falta configurar proveedores y un corpus autorizado, medir con presupuesto explícito y revisar calidad humana para decidir si alguna estrategia mejora el recorrido. No se inicia otra fase.

## Estado anterior a E11 — conservado el 2026-11-03

# Estado actual de FerWeb

Actualizado: **2026-11-03**. Entrada breve; evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E2: Docker, propietario/sesiones, proyectos y tareas con aislamiento/versiones.
- E3: GitHub App en lectura, snapshots por commit y webhooks firmados/deduplicados.
- E4–E5: conversaciones persistentes, OpenAI/Ollama, streaming/cancelación y recuperación autorizada con Qdrant/embeddings locales.
- E6: comparaciones con contexto congelado, repeticiones, revisión humana y exportación.
- E7–E8: cola PostgreSQL, simulador y tareas Codex en contenedor separado; supervisión, cancelación, diff, comandos, pruebas y uso disponible.
- E9: revisión humana/borrador persistente, publicación explícita de rama y PR draft, permisos/base/idempotencia; comparación y repetición con condiciones congeladas. Guía: [reviews.md](reviews.md).
- E10: cuatro estrategias de contexto versionadas, panel antes/después, contabilidad de auxiliares, invalidación y adopción explícita condicionada a evidencia real. [Guía](context-optimization.md).

GitHub/modelos se validan con dobles; CLI Codex, procesos, PostgreSQL y Qdrant reales en Docker. **Sin inferencia/publicación externas reales ni mejora de contexto adoptada.** GPU, rendimiento y ahorro real sin verificar. E10 completó 40 intentos simulados de los cinco casos existentes; no acreditan ahorro real.

## Entorno y límites

Siete servicios Docker saludables, migración **010** y web `http://127.0.0.1:5173`; salud `ready`, 10/10 migraciones. Datos en `ferweb_postgres_data`; huellas SQL previas conservadas, excluyendo columnas nuevas. Usa `npm run docker:status` para comprobar disponibilidad.

Chat/índice/laboratorio no migran a la cola. Codex: un motor, perfil Node, 100 archivos/1 MB, kernel compartido y repositorios controlados; [límites](codex.md). E10 mantiene el contexto habitual sin política respaldada. Coste completo desconocido si faltan embeddings/cargos/infraestructura; subtotal y caché no se presentan como ahorro total.

## Verificación y siguiente paso

- `npm run docker:check` superado el **2026-11-03**: 10 Python, 11 básicas, 73 pruebas/subcasos de integración, 14 Chromium, tipos, compilación, formato y smoke. Registro privado `.local/e10-docker-check.log`.
- Pendiente: configurar App/repositorio de prueba y permisos de escritura para aceptación externa explícita; modelos reales con presupuesto. Carga/escalado, desastre y exposición pública sin validar. Sin merge automático ni coordinación multiagente.
- Siguiente paso: medir con modelos reales y presupuesto explícito, revisar calidad y adoptar solo si respalda el cambio. Informe simulado: `.artifacts/evaluations/e10-context-evaluation.json`. Mantenimiento: [development.md](development.md).
