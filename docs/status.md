# Estado actual de FerWeb

Actualizado: **2026-11-06**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E2: propietario/sesiones, proyectos y tareas autorizados/versionados en Docker.
- E3: GitHub App, snapshots por commit y webhooks firmados/deduplicados.
- E4–E6: chat OpenAI/Ollama persistente, streaming/cancelación, recuperación Qdrant y laboratorio con revisión/exportación.
- E7–E9: cola PostgreSQL, simulador, Codex en contenedor separado y revisión/PR explícita con comparación de condiciones congeladas.
- E10: estrategias de contexto versionadas, contabilidad, invalidación y adopción condicionada a evidencia real; ninguna mejora real adoptada.
- E11: imágenes runtime y bases fijadas, CI preparada, Compose release, copia/restauración PostgreSQL+Qdrant, logs JSON/métricas protegidas, carga, README inglés y demo. [Revisión final](release-review.md), [operación](deployment.md).
- P01–P08: diagnóstico, roles/skills, presupuestos, planes/equipos y mensajes SQL; revisión por dimensiones, diff congelado y evidencia independiente. [Codex](codex.md)

## Verificado

- P08, `npm run docker:check` pasó con **10 Python, 14 básicas, 82 pruebas/subcasos de integración, 18 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p08-docker-check-final.log`.
- E11, `npm run release:check`: 246 fuentes públicas sin datos/dependencias previos, Chromium CRUD/autorización, trabajo simulado idempotente, proxy streaming/cancelación, reinicio y salud.
- Recuperación: hashes/recuentos de **32 tablas** y vector Qdrant con procedencia; rechazo de checksum alterado/sobrescritura; pausa/reanudación automática.
- Carga: **800 operaciones, ocho clientes, 10,79 s, cero errores, p95 16,91 ms**; condiciones/límites en [carga](load-testing.md). Informe privado `.local/release-verification.json` con imágenes probadas.
- Instancia local: siete servicios saludables, migración **018**, volumen `ferweb_postgres_data`, web `http://127.0.0.1:5173`. Concurrencia del proyecto existente: uno.

## Límites y siguiente paso

Despliegue permanente pendiente. CI conserva diagnóstico de arranque; el controlador negocia la API Docker. [Ejecuciones de CI](https://github.com/fercuacas/FerWeb/actions)

Las pruebas usan proveedores y GitHub simulados con CLI, procesos, SQL y Qdrant reales. Inferencia externa, ahorro y capacidad IA/GPU por medir.

Reconstrucción cacheada valida capas/configuración web, no igualdad bit a bit entre constructores. Chat/índice/laboratorio siguen en proceso. Codex: perfil Node, kernel compartido, repositorios controlados y controlador privilegiado; [límites](codex.md). Carga breve sin saturación/SLA.

Para desplegar quedan host/HTTPS, copias cifradas externas, aceptación con App y modelos, monitorización y pruebas prolongadas. [Mantenimiento](development.md)

Global dos; por proyecto uno por defecto. P08 admite hasta dos rondas de revisión con presupuesto/plazo compartidos; no corrige fuentes automáticamente. Sigue P09 en el [plan de agentes](plans/ecc-codex-prompts/progress.md).
