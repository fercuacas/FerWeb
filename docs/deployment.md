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

La carpeta final debe ser nueva y privada (`.local/`, `backups/`, `secrets/` o fuera del repositorio). Rechaza trabajos pendientes/ejecutando, chats streaming, lotes activos y publicaciones en curso antes de pausar servicios; drenar/cancelar primero. Pausa web/API/worker/runner/IA/Qdrant y vuelve a comprobar el estado para detectar carreras. Reservar ventana sin generaciones/sincronizaciones. DB permanece iniciada. Escribe `database.dump` custom, `qdrant.tar.gz` en frío y manifiesto SHA-256/tamaños/fecha/imagen DB/migraciones, calculando hashes por streaming. Reanuda solo servicios previamente iniciados. Si falla, una carpeta parcial sin manifiesto completo no es backup válido. No elimina volúmenes.

Contiene sesiones, hashes y datos privados. Guardar cifrada fuera del anfitrión con retención/permisos decididos por operador; no se automatizan cifrado/transporte/programación. Integridad no autentica procedencia: restaurar solo copias propias fiables. No incluye `.env.release`, JSON de proveedores, imágenes o workspace temporal de runner. SQL conserva informes/resultados terminados; no se promete recuperar procesos/generaciones activas. No mezclar archivos de distintas copias. Qdrant es derivado pero la pareja en frío conserva vectores existentes.

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

Verifica hashes antes de escribir; exige proyecto diferente al origen, solo contenedor db, cero tablas públicas y ningún volumen Qdrant existente. Restaura SQL con `--single-transaction`, sin `--clean`/DROP, y vectores en volumen nuevo etiquetado. Rechaza sobrescrituras. Si vectores fallan después de SQL, conservar destino separado y diagnosticar: no hay transacción distribuida ni reintento que borre datos. Validar migraciones/login/tareas/informes/búsqueda antes de un cambio autorizado de tráfico. Conservar instancia anterior detenida para rollback; nunca dos escritores sobre los mismos volúmenes.

La aceptación compara todas las tablas públicas de una DB no vacía, un vector y su procedencia tras restaurar. También rechazo de sobrescritura, migración idempotente y reinicio DB. No acredita pérdida física del anfitrión ni RPO/RTO contratado. [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

## Observabilidad y CI

API emite JSON por solicitud completada: timestamp, servicio, evento, `requestId`, método, **patrón** de ruta, estado y duración. Sin cuerpos, consultas, cookies, claves o URLs arbitrarias. Crear trabajo añade `jobId`; worker/eventos/resultados comparten ID, intento/ejecutor. Informes conservan commit/configuración/tiempos/uso disponible. No es OpenTelemetry distribuido.

`GET /internal/metrics`, solo red interna con `Authorization: Bearer <METRICS_TOKEN>`, ofrece contadores HTTP, histograma de duración, uptime, RSS y trabajos por estado en SQL. Sin token responde 404; web no lo proxifica. Etiquetas acotadas por método/patrón/estado, sin IDs de usuario/proyecto/job. Contadores/histogramas reinician con proceso; histórico/alertas requieren scraper externo todavía no configurado. Configurar su token en fichero privado, nunca URL.

`.github/workflows/ci.yaml`: `contents: read`, acciones fijadas a commits upstream, checkout sin credenciales persistidas, sin claves de proveedor ni publicación. Ejecuta `docker:check` y `release:check`, limpiando solo proyectos efímeros. CI hospedado pendiente de publicación del repositorio por operador. [Seguridad de acciones](https://docs.github.com/en/actions/reference/security/secure-use).
