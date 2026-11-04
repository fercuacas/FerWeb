# Carga inicial del candidato

`npm run release:check` ejecuta `scripts/load-test.mjs` dentro de tools contra **web compilada → proxy → API → PostgreSQL**, con proyecto Compose aleatorio vacío. Sin cuentas del usuario ni llamadas a modelos/GitHub.

## Condiciones

Después de Chromium y un trabajo simulado: una sesión, un proyecto, ocho clientes concurrentes en lazo cerrado, cien solicitudes secuenciales por cliente y pausa de 100 ms tras cada una: 800 total, 160 creaciones de tarea y 640 listados, durante al menos diez segundos. Consume JSON completo y valida estado/forma. La latencia excluye la pausa; duración y solicitudes/s la incluyen. Aplicación/base calientes por recorrido previo, sin control de caché de disco. No es comparación fría/caliente.

Timeout 5 s/solicitud. Umbrales: cero errores, p95 global <1000 ms y máximo <5000 ms. Script limita parámetros a 1–32 clientes, 1–200 iteraciones y pausa 0–1000 ms; aceptación fija 8×100 con pausa 100 ms. Mide p50/p95/p99/máximo por lectura/escritura y global, duración, errores y solicitudes/s. Es carga sostenida breve y criterio inicial de regresión, no SLA ni ensayo de saturación. El ritmo ofrecido está limitado por pausas y latencia: solicitudes/s no mide capacidad máxima.

Límites Docker: API 2 CPU/768 MiB, web 1 CPU/192 MiB, DB 2 CPU/1 GiB, worker 1 CPU/384 MiB. Pool API cinco conexiones, timeout SQL 2 s; cola global 2/proyecto 1. Generador comparte motor/recursos. No extrapolar capacidad de IA/GPU, embeddings, repositorios grandes o latencia externa desde CRUD.

## Evidencia

`.local/release-verification.json` guarda fecha, hardware visible a Docker, condiciones/percentiles y recuperación. Resultados actuales en [release-review.md](release-review.md). No repetir contra producción. Saturación requiere otra entrega con rampa, dataset mayor, duración, CPU/memoria/colas y presupuesto si incluye proveedores.
