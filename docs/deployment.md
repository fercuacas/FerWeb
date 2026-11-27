# Candidato desplegable de FerWeb

Esta entrega prepara artefactos y prueba entornos locales desechables. No autoriza publicar imágenes ni desplegar una instancia permanente. La instancia actual conserva `ferweb_postgres_data`. El nombre del producto es FerWeb.

## Configuración

`compose.release.yaml` es un overlay sobre `compose.yaml`. Requiere Compose >=2.24.4 por `!reset`: elimina puertos API y montajes de fuentes. Web sirve `dist` con un servidor Node sin dependencias adicionales, proxy `/api/`, streaming/cancelación, bloqueo de `/internal`, CSP y caché inmutable solo para assets versionados. API/worker ejecutan JS compilado, sin watch.

`release:setup` genera `.env.release`; `release:build` construye sandbox/API/web/IA/runner sin publicarlos. `release:start` usa imágenes construidas, espera salud y migra antes de API/worker. Usarlo para una instancia permanente exige autorización. `release:owner` provisiona propietario por terminal. `release:stop`, `release:status`, `release:logs` operan sobre el proyecto seleccionado.

Variables del wrapper: `FERWEB_RELEASE_ENV` (`.env.release`), `FERWEB_RELEASE_PROJECT` (`ferweb-release`), `FERWEB_RELEASE_PORT` (solo setup, 8080). Rechaza el proyecto de desarrollo `ferweb`. Evitar `POSTGRES_*`, tokens, puertos/origen heredados en shell: Compose prioriza entorno sobre fichero. Setup no copia datos existentes.

Variables generadas: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `AI_SERVICE_TOKEN`, `RUNNER_SERVICE_TOKEN`, `METRICS_TOKEN`, `WEB_PORT`, `APP_ORIGIN`, `COOKIE_SECURE`, `FERWEB_RELEASE_TAG`, `SOURCE_DATE_EPOCH`. No imprimir `compose config`. Se crean ficheros 0600; en Windows revisar ACL NTFS porque el modo POSIX no las sustituye.

Integraciones opt-in mediante rutas absolutas de shell `FERWEB_GITHUB_CONFIG_FILE`, `FERWEB_AI_CONFIG_FILE`, `FERWEB_CODEX_CONFIG_FILE`: añaden overlays existentes después de release. Mantener ficheros en `secrets/`, `.local/` o fuera del contexto público. No autodetecta credenciales de desarrollo. Con CA local añade overlays de CA de proveedores. Formatos en [GitHub](github.md), [IA](ai.md), [Codex](codex.md). Estos secretos se respaldan por un canal privado separado.

Solo web publica loopback. Exposición externa requiere ingress HTTPS autorizado, `APP_ORIGIN=https://host-exacto` y `COOKIE_SECURE=true`. El proxy descarta `X-Forwarded-*`: la IP de login es la del proxy y comparte su límite. No se incluye dominio/certificado ni terminación TLS pública probada. No publicar API, métricas, DB, Qdrant o controlador.

Hay límites de memoria/CPU/PIDs y logs rotados (3×10 MiB por servicio). API/web/IA/worker tienen raíz de lectura y capacidades retiradas. Runner conserva socket Docker como controlador de confianza; el código ejecutado mantiene su frontera separada. Requiere anfitrión dedicado y repositorios controlados.

## Reconstrucción y promoción

Bases Node/Python/PostgreSQL/Qdrant/Playwright fijadas por digest, npm por lockfiles y Python por hashes. Codex tiene lockfile separado; Git/ripgrep/CA usan snapshot Debian fechado y versiones fijadas conservando firmas. `SOURCE_DATE_EPOCH=0` fija timestamp de build. Cambiar digest/lock/snapshot exige revisión, pruebas y etiqueta nueva.

La aceptación comprueba igualdad de capas/configuración runtime de web al reconstruir con caché y entradas idénticas. El índice OCI cambia por attestations de procedencia, que se conservan; no se afirma igualdad del digest del índice ni identidad bit a bit entre constructores fríos/arquitecturas. Distribuir **las mismas imágenes validadas por digest/ID**, sin reconstruirlas en servidor. `FERWEB_RELEASE_TAG` identifica el candidato; registrar IDs con `docker image inspect ferweb-api:<etiqueta> --format '{{.Id}}'`. Una etiqueta mutable no sustituye al digest. No hay push ni registro configurado.

Fuentes: [Dockerfile](https://docs.docker.com/reference/dockerfile/), [timestamp reproducible](https://docs.docker.com/build/ci/github-actions/reproducible-builds/), [merge/reset Compose](https://docs.docker.com/reference/compose-file/merge/), [snapshot Debian](https://snapshot.debian.org/).

## Migraciones

El migrador compilado aplica SQL numerado con checksum/bloqueo en una transacción; rechaza cambios de SQL aplicado. API/worker esperan salida 0. `release:migrate` lo ejecuta explícitamente con DB preparada. Actualizar: drenar trabajos, guardar recuperación, detener entrada/escritores, seleccionar imágenes probadas y migrar antes de reabrir. No hay migraciones inversas: volver a un esquema incompatible requiere recuperación en otro proyecto con imágenes del punto guardado.

## Copia coherente PostgreSQL + Qdrant

```powershell
New-Item -ItemType Directory -Force .local/backups | Out-Null
npm run release:backup -- .local/backups/ferweb-20261103
```

La carpeta final debe ser nueva y privada (`.local/`, `backups/`, `secrets/` o fuera del repositorio). Drena trabajos, equipos, chats, lotes y publicaciones en curso. Un equipo activo puede estar esperando una decisión con la cola vacía. La copia comprueba esos estados antes y después de pausar web, API, worker, runner, IA y Qdrant. El calendario de futuras automatizaciones se conserva en SQL y reanuda su política de fechas omitidas al volver.

PostgreSQL permanece iniciado. El comando comprueba el volumen del proyecto seleccionado, escribe `database.dump` en formato custom y lee en frío Qdrant para generar `qdrant.tar.gz`. El manifiesto registra SHA-256, tamaños, fecha, imagen DB y migraciones. Reanuda los servicios previamente iniciados incluso si falla la limpieza del temporal. Una carpeta parcial requiere un manifiesto completo para recuperar.

SQL conserva versiones de roles, skills y extensiones, memorias, recibos, equipos, informes, calendarios y notificaciones. Qdrant conserva los vectores de la misma copia. Guarda junto al manifiesto el commit y los IDs de las imágenes validadas que contienen el catálogo estático. Guarda los secretos de configuración por su canal privado. Conserva cada pareja íntegra y restaura desde una copia propia de procedencia verificada.

### Retención y archivo

Conserva siete puntos diarios, cuatro semanales y una copia verificada antes de cada cambio de esquema. Cifra las copias fuera del anfitrión y verifica una restauración aislada antes de rotar la última copia válida. Ajusta la vigencia según la política del proyecto y los datos personales que conserve. Archivar un proyecto mantiene sus trabajos, versiones e informes en SQL. El operador decide la rotación de copias. Los logs del candidato rotan por tamaño y los temporales del sandbox tienen su ciclo de vida propio.

## Restauración sin sobrescritura

Seleccionar proyecto nuevo, otra configuración privada con puerto libre e imágenes del punto guardado. No iniciar API/migrador/Qdrant todavía. Para operador autorizado:

```powershell
$env:FERWEB_RELEASE_PROJECT = 'ferweb-recovery-20261103'
$env:FERWEB_RELEASE_ENV = '.env.recovery'
# Crear .env.recovery por canal privado y ajustar puerto/origen sin imprimir secretos.
docker compose -f compose.yaml -f compose.release.yaml --env-file .env.recovery -p ferweb-recovery-20261103 up -d --wait db
npm run release:restore -- .local/backups/ferweb-20261103
npm run release:start
npm run release:status
```

Verifica hashes antes de escribir. Exige proyecto diferente al origen, su propio volumen PostgreSQL, solo contenedor db, cero tablas públicas y ningún volumen Qdrant existente. Restaura SQL con `--single-transaction` y vectores en un volumen nuevo etiquetado, leyendo los archivos en modo de solo lectura. Si Qdrant falla después de SQL, conserva el destino separado para diagnosticar. SQL y Qdrant se restauran en pasos distintos. Verifica migraciones, login, tareas, informes y búsqueda antes de un cambio autorizado de tráfico. Conserva la instancia anterior detenida como punto de retorno.

La aceptación usa un fixture sintético con equipos, entregas, versiones, memoria corregida, recibos, informes, admisiones, extensiones y avisos. Compara recuentos y hashes de todas las tablas públicas, revalida los vínculos del fixture y verifica el catálogo incluido en la imagen. Comprueba un punto Qdrant ligado a su recibo SQL, el rechazo de sobrescritura, la migración repetible y el reinicio de DB. La recuperación probada corresponde a volúmenes Docker desechables. [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

## Observabilidad y CI

API emite JSON por solicitud completada con `requestId`, método, patrón de ruta, estado y duración. El worker correlaciona trabajo, intento, ejecutor, equipo, etapa y versión de rol cuando están disponibles. Las ausencias se conservan como null. Los logs usan campos seleccionados y el sondeo rutinario de equipos y automatizaciones aporta métricas HTTP.

`GET /internal/metrics` usa el token de servidor en la red interna. Los contadores HTTP, histogramas de duración, uptime y RSS se observan en el proceso. Las series `ferweb_operations_*` muestran colas y su antigüedad, equipos, calendarios, inconsistencias terminales y, en ventana móvil de 24 horas, intentos, duración, cancelaciones, admisiones y cobertura de informes y recibos. Las etiquetas de estas series son conjuntos acotados. Los identificadores de correlación viven en los logs.

El uso de proveedor tiene cobertura por campo y separa ámbito simulado, proveedor y desconocido. Solo aparecen sumas cuando hay valores reportados. La duración de intentos proviene de timestamps SQL y la confirmación de cancelación se conserva como confirmada, no confirmada o desconocida. Coste, GPU, energía y estimaciones quedan fuera de estas series. El histórico de métricas requiere un recolector externo.

`npm run release:diagnose` consulta salud y métricas desde la API compilada del proyecto seleccionado. El token se lee dentro de ese contenedor. El resultado indica migraciones, colas, evidencias e inconsistencias de leases, intentos o reservas en trabajos terminales. El comando devuelve error si falta salud o consistencia. [Carga de operación](load-testing.md).

GitHub Actions ejecuta `docker:check` y `release:check` con permisos de lectura, acciones fijadas por commit y proveedores simulados. La pasada de release publica un resumen de recuentos y limpia sus proyectos efímeros. La publicación de imágenes y el despliegue permanente conservan su autorización propia. [Seguridad de acciones](https://docs.github.com/en/actions/reference/security/secure-use).

## Topología local y frontera remota

En Docker Desktop, los servicios autorizados alcanzan Ollama del anfitrión mediante `host.docker.internal` y los controles de red locales. El controlador conserva el canal de inferencia del sandbox aislado y valida modelo y revisión. Los contenedores comparten kernel y el socket Docker pertenece al controlador privilegiado. Las mediciones de este candidato observan procesos y capacidad asignada al motor. [IA local](ai.md#ollama-del-anfitrión-desde-docker) · [Codex local](local-coding.md).

Un futuro despliegue remoto con cómputo en el PC necesitaría un conector saliente autenticado hacia el servicio autorizado. El diseño exige identidad revocable por dispositivo, cuotas por proyecto y operación, destinos y datos permitidos, recibos idempotentes y comportamiento explícito ante desconexión. El PC conservaría Ollama y Docker dentro de su frontera local. Esta topología remota es un diseño pendiente de implementación y aceptación.
