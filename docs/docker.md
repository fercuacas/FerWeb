# Operación de desarrollo en Docker

Docker es el entorno habitual desde el 2026-11-01. El repositorio sigue en `C:\Users\ferna\Documents\FerWeb`. Editar archivos en Windows no ejecuta los servidores en Windows: API y web leen sus fuentes mediante montajes y ejecutan Node dentro de Linux. Dependencias, compilados y navegador de pruebas se preparan dentro de las imágenes. El anfitrión solo necesita Docker Desktop y Node/npm para invocar los scripts de gestión.

## Comandos habituales

Desde la raíz, con Docker Desktop iniciado:

```powershell
npm run dev
npm run docker:status
npm run docker:logs
npm run docker:check
npm run docker:format
npm run docker:stop
npm run docker:up
npm run docker:restart
```

`dev` y `docker:up` construyen las imágenes y esperan a los servicios preparados. `docker:restart` recrea los contenedores conservando el volumen y vuelve a ejecutar el migrador idempotente. Los datos no se guardan en la capa del contenedor: pertenecen al volumen `ferweb_postgres_data`. No usar `down --volumes` para detener o reiniciar.

La web continúa en `http://127.0.0.1:5173`; la API publica únicamente loopback en el puerto 3001. La base, el servicio Python IA, Qdrant, worker y runner no publican puerto. No se debe abrir la instancia nativa en paralelo. Web/API/base/IA/Qdrant/worker/runner usan `unless-stopped`; el migrador termina correctamente con código 0 y no es un servicio permanente. Docker Desktop debe estar ejecutándose.

E8 añade `runner`, controlador de confianza que monta el socket Docker y su volumen de control privado, y construye `ferweb-codex-sandbox:0.166.0`. Los contenedores de repositorio se crean bajo límites fijos, sin socket ni secretos y con red `none`; solo reciben el snapshot de su tarea. Un volumen temporal de 64 MiB por ejecución permite recoger un diff desde otro contenedor, en lectura y con el código pausado. No se limpia ningún volumen de aplicación como parte de esa operación. La configuración `secrets/codex.json` se monta solo en runner. Frontera efectiva, temporales, watchdog, cancelación y límites en [codex.md](codex.md).

E7 añade `worker`, construido con la imagen Node y sin dependencias nuevas. Ejecuta el simulador en procesos hijo; PostgreSQL conserva cola, eventos, intentos y presupuesto. No necesita otro volumen ni Redis. Su salud interna comprueba actividad reciente de la cola. `JOB_WORKER_CONCURRENCY` y `JOB_WORKER_LEASE_MS` están documentados en `.env.example`; concurrencia máxima SQL global 2 y por proyecto 1. El worker usa código compilado, raíz de solo lectura, recursos limitados y `/tmp` efímero; reconstruir con `docker:up` tras cambiarlo. Apagado ordenado y recuperación tras pérdida del ejecutor en [jobs.md](jobs.md). Esto no habilita ejecución de repositorios ni migra la inferencia a la cola.

E5 añade Qdrant 1.20.0 y `ferweb_qdrant_data`: caché derivada, nunca autoridad de permisos o contenido. PostgreSQL conserva el manifiesto y el texto; Qdrant guarda vectores y procedencia inicial. No borrar volúmenes para reiniciar. Las pruebas E5 crean y eliminan exclusivamente colecciones con un prefijo aleatorio propio en ese servidor, sin tocar colecciones de la aplicación. Configuración de embeddings, reconstrucción y límites de limpieza en [retrieval.md](retrieval.md).

`docker:check` prepara la aplicación, ejecuta las pruebas Python y levanta temporalmente `ai-test` y `runner-test` con proveedores simulados. `tools` realiza tipos, compilación, formato, integración PostgreSQL, navegador y smoke. Codex CLI, contenedores y comandos son reales, pero no hay llamadas a modelos externos. Los fixtures se detienen y eliminan incluso si falla la suite; sus bases, redes/etiquetas y volúmenes de control están separados de producción. No se vacía la aplicación. `docker:format` aplica formato desde Linux con un montaje escribible explícito; los montajes habituales de API/web son de lectura. Ollama y secretos de IA en [ai.md](ai.md); credenciales y límites de Codex en [codex.md](codex.md).

La CA local verificada de AVG está en `.local/build-ca.pem`. El gestor la detecta o admite otra ruta en `FERWEB_BUILD_CA_FILE`. Se monta solamente durante instalación de npm mediante BuildKit; no se copia dentro de las imágenes ni se desactiva TLS. El certificado es configuración local y no se distribuye con el repositorio. Ver [README](../README.md).

## Migración realizada

1. Se comprobó que no quedaban servidores nativos web/API y se arrancó temporalmente el PostgreSQL portable existente para leerlo.
2. Se exportó la base con `pg_dump` 18.6 en formato custom, usando el cliente Linux contra el servidor Windows. Se preservaron todas las tablas sin copiar el directorio binario de PostgreSQL entre sistemas.
3. Se creó el volumen Docker de aplicación. Con API/web detenidas y el destino recién creado sin cuentas/proyectos/tareas se restauró el dump transaccionalmente.
4. Se compararon recuentos y SHA-256 del contenido JSON normalizado en UTC de las siete tablas, incluidas credenciales derivadas, sesiones, instalación y migraciones. Coincidieron íntegramente: una cuenta, cero proyectos, cero tareas y dos migraciones.
5. Se detuvo PostgreSQL nativo y se recrearon los contenedores habituales conservando el volumen restaurado. No se cambió la contraseña del propietario ni se insertaron cuentas de demostración.

Respaldos privados, ignorados por Git y por el contexto Docker:

- `.local/backups/native-to-docker-2026-11-01.dump`: copia lógica previa al cambio.
- `.local/backups/native-to-docker-2026-11-01.snapshot.json`: recuentos y huellas por tabla.
- `.local/backups/native-to-docker-2026-11-01.verified.json`: resultado de comparación tras restaurar.
- `.local/postgres-data`: cluster Windows original, detenido. No recibe los cambios posteriores.

La base Docker es ahora la autoridad. Los respaldos son anteriores a los cambios nuevos: no deben reactivarse como alternativa sin planificar una restauración y evitar dos bases divergentes.

## Copias posteriores

Esta operación genera un nuevo dump de la base activa; no elimina datos:

```powershell
New-Item -ItemType Directory -Force .local/backups | Out-Null
$backupName = 'ferweb-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges --file=/tmp/ferweb-backup.dump'
if ($LASTEXITCODE -ne 0) { throw 'No se ha podido generar el backup' }
$databaseContainer = docker compose ps -q db
docker cp "${databaseContainer}:/tmp/ferweb-backup.dump" ".local/backups/$backupName"
```

El dump contiene datos privados y hashes de credenciales. Conservarlo fuera de Git. Para restaurar, usar una base o volumen nuevo y comprobar el resultado antes de cambiar la aplicación; no sobrescribir la base activa como prueba rutinaria. El procedimiento sigue el [backup lógico de PostgreSQL](https://www.postgresql.org/docs/18/backup-dump.html).
