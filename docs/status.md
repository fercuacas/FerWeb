# Estado actual de FerWeb

Actualizado: **2026-11-05**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E2: propietario/sesiones, proyectos y tareas autorizados/versionados en Docker.
- E3: GitHub App, snapshots por commit y webhooks firmados/deduplicados.
- E4–E6: chat OpenAI/Ollama persistente, streaming/cancelación, recuperación Qdrant y laboratorio con revisión/exportación.
- E7–E9: cola PostgreSQL, simulador, Codex en contenedor separado y revisión/PR explícita con comparación de condiciones congeladas.
- E10: estrategias de contexto versionadas, contabilidad, invalidación y adopción condicionada a evidencia real; ninguna mejora real adoptada.
- E11: imágenes runtime y bases fijadas, CI preparada, Compose release, copia/restauración PostgreSQL+Qdrant, logs JSON/métricas protegidas, carga, README inglés y demo. [Revisión final](release-review.md), [operación](deployment.md).
- P01–P07: diagnóstico, roles/skills, presupuestos, planes aprobados y equipos duraderos; especialistas de solo lectura, paralelismo explícito y mensajes SQL. [Codex](codex.md)

## Verificado

- P07, `npm run docker:check` pasó con **10 Python, 13 básicas, 81 pruebas/subcasos de integración, 17 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p07-docker-check-final.log`.
- E11, `npm run release:check`: 246 fuentes públicas sin datos/dependencias previos, Chromium CRUD/autorización, trabajo simulado idempotente, proxy streaming/cancelación, reinicio y salud.
- Recuperación: hashes/recuentos de **32 tablas** y vector Qdrant con procedencia; rechazo de checksum alterado/sobrescritura; pausa/reanudación automática.
- Carga: **800 operaciones, ocho clientes, 10,79 s, cero errores, p95 16,91 ms**; condiciones/límites en [carga](load-testing.md). Informe privado `.local/release-verification.json` con imágenes probadas.
- Instancia local: siete servicios saludables, migración **016**, volumen `ferweb_postgres_data`, web `http://127.0.0.1:5173`. Concurrencia del proyecto existente: uno.

## Límites y siguiente paso

Despliegue permanente pendiente. CI conserva diagnóstico de arranque; el controlador negocia la API Docker. [Ejecuciones de CI](https://github.com/fercuacas/FerWeb/actions)

Las pruebas usan proveedores y GitHub simulados con CLI, procesos, SQL y Qdrant reales. Inferencia externa, ahorro y capacidad IA/GPU por medir.

Reconstrucción cacheada valida capas/configuración web, no igualdad bit a bit entre constructores. Chat/índice/laboratorio siguen en proceso. Codex: perfil Node, kernel compartido, repositorios controlados y controlador privilegiado; [límites](codex.md). Carga breve sin saturación/SLA.

Para desplegar quedan host/HTTPS, copias cifradas externas, aceptación con App y modelos, monitorización y pruebas prolongadas. [Mantenimiento](development.md)

Equipos sin reintentar código. Global dos; por proyecto uno por defecto, ampliable a dos lectores del mismo equipo. P08: revisión/publicación agregada; [plan de agentes](plans/ecc-codex-prompts/progress.md).
