# Estado actual de FerWeb

Actualizado el **27 de noviembre de 2026**. [Evidencias anteriores](history.md).

## Disponible

- E1–E11: identidad, proyectos/tareas, GitHub, chat OpenAI/Ollama, recuperación, laboratorio, cola, Codex aislado y revisión/PR. [Operación](deployment.md).
- P01–P10: capacidades, roles/skills, presupuestos, equipos, revisiones, memoria versionada, contexto con mapa Markdown, catálogo SQL/JSON y recibos. [Codex](codex.md), [memoria](memory.md), [contexto](context-packs.md).
- P11–P17: perfiles, controles, evaluación, lecciones, recetas, seguimiento, revisión visual y escritores aislados con integración/publicación revisadas. [Codex](codex.md), [laboratorio](laboratory.md), [revisión](reviews.md).
- P18: épicas, dependencias, asignaciones, bloqueos de ejecución/publicación y creación de issues con previsualización, aprobación y reconciliación. [Coordinación](github.md#épicas-dependencias-y-coordinación-p18).
- P19: especialistas Ollama, selección por rol, contexto P10, salidas JSON y citas. [Especialistas](local-specialists.md).
- P20: Codex con Ollama, herramientas aisladas, contexto P10, informes E9 e inferencia local en equipos. [Código local](local-coding.md).
- P21: comparación Codex API/local, cupo API y consentimiento para transferencias de equipos mixtos. [Política](provider-routing.md).
- P22: extensiones versionadas, lector local aprobado y exportación portable de roles, skills y workflows. [Extensiones](extensions.md).
- P23 incorpora 759 fichas de ECC, diez planes locales por familia y una receta de evidencias con Codex API de solo lectura. [Utilidades](utility-packs.md).
- P24 incorpora programaciones diarias por proyecto con autorización, recuperación y notificaciones internas. [Automatizaciones](automations.md).

## Verificado

- `npm run docker:check` superó **12 Python, 29 básicas, 139 pruebas/subcasos de integración y 29 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p24-docker-check.log`.
- P24 verificó cambios de hora, deduplicación, reinicio, pausa, cancelación, cupo, bloqueos y avisos con reloj controlado. Chromium comprobó autorización, persistencia y móvil.
- Siete servicios saludables, migración **031** y web `http://127.0.0.1:5173`. Autoridad `ferweb_postgres_data`.

## Límites y siguiente paso

SQL, Qdrant, CLI y contenedores reales. GitHub e inferencia simulados. Pendientes aceptación con App, modelos y hardware, importación del ZIP en Codex, conectores externos y despliegue permanente. Métricas ausentes desconocidas. Sin ahorro, velocidad o GPU medidos. Citas sujetas a revisión humana.

P19/P20 mantienen inferencia local sin fallback. La parada remota de Ollama sigue desconocida. GitHub conserva su política propia. E10 sin mejoras reales adoptadas. Docker comparte kernel y su controlador es privilegiado. [Límites](codex.md), [CI](https://github.com/fercuacas/FerWeb/actions).

Siguiente entrega: P25. [Plan](plans/ecc-codex-prompts/progress.md).
