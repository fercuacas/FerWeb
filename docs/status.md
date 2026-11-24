# Estado actual de FerWeb

Actualizado: **2026-11-25**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E11 y P01–P17: proyectos, GitHub, chat, recuperación, laboratorio, cola, Codex aislado, equipos, presupuestos, memoria, contexto, revisión y escritores integrados. [Codex](codex.md), [contexto](context-packs.md), [operación](deployment.md).
- P18: épicas, dependencias y asignaciones locales versionadas, bloqueos de ejecución/publicación y vínculos estables a issues/PR. Creación de issues con vista previa, aprobación y reconciliación de respuestas inciertas. [Coordinación](github.md#épicas-dependencias-y-coordinación-p18).

## Verificado

- Evidencia anterior P17: 10 Python, 20 básicas, 104 pruebas/subcasos de integración y 22 Chromium, tipos, compilación, formato y smoke.
- P18: pruebas dirigidas de coordinación, publicación y ejecución con confirmación de arranque demorada, más recorrido Chromium en móvil y con teclado. La comprobación general del checkout conjunto P18/P19 se registra con P19; no se declara una pasada aislada de este commit.
- Migración 026 incorporada. La autoridad sigue siendo ferweb_postgres_data.

## Límites y siguiente paso

SQL, Qdrant, CLI y contenedores reales; GitHub y proveedores simulados. Inferencia real, ahorro y capacidad IA/GPU por medir. Métricas ausentes desconocidas; bytes no estiman tokens. Las citas requieren juicio humano.

Publicar código mantiene la aprobación E9 propia. La respuesta remota incierta se reconcilia sin repetir la escritura. Docker comparte kernel y su controlador es privilegiado. Integración real con App/modelos y despliegue permanente pendientes. [Límites](codex.md), [CI](https://github.com/fercuacas/FerWeb/actions).

Continuar el cierre de P19. [Plan](plans/ecc-codex-prompts/progress.md).
