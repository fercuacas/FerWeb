# Estado actual de FerWeb

Actualizado: **2026-11-26**. Evidencias anteriores en [history.md](history.md).

## Disponible

- E1–E11: identidad, proyectos/tareas, GitHub, chat OpenAI/Ollama, recuperación, laboratorio, cola, Codex aislado y revisión/PR. [Operación](deployment.md).
- P01–P10: capacidades, roles/skills, presupuestos, equipos, revisiones, memoria versionada y contexto con mapa Markdown, catálogo SQL/JSON y recibos. [Codex](codex.md), [memoria](memory.md), [contexto](context-packs.md).
- P11–P17: perfiles y controles, evaluación y lecciones, recetas, seguimiento, revisión visual y escritores aislados con integración/publicación revisadas. [Codex](codex.md), [laboratorio](laboratory.md), [revisión](reviews.md).
- P18: épicas, dependencias, asignaciones y vínculos estables a GitHub. Bloqueos de ejecución/publicación y creación de issues con vista previa, aprobación y reconciliación. [Coordinación](github.md#épicas-dependencias-y-coordinación-p18).
- P19: especialistas de lectura con Ollama nativo, modelo por rol, contexto P10, entregas JSON y validación de citas. [Uso y aceptación real](local-specialists.md).
- P20: Codex con Ollama local, herramientas aisladas, contexto P10, informes E9 y equipos con inferencia local en todas sus etapas. [Configuración y aceptación real](local-coding.md).
- P21: comparación exportable Codex API/local y reglas con cupo externo, decisiones congeladas por etapa y consentimiento para las transferencias de planes mixtos secuenciales. [Uso y protocolo](provider-routing.md).
- P22: extensiones versionadas por proyecto, lector local revisado y exportación portable de roles, skills y workflows. [Extensiones](extensions.md).

## Verificado

- `npm run docker:check` superó **12 Python, 27 básicas, 136 pruebas/subcasos de integración y 27 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p22-docker-check.log`.
- P22 dirigido comprobó permisos, aprobación, conservación de ediciones y lectura independiente del ZIP. Chromium verificó teclado, móvil y descarga. Captura inspeccionada.
- Siete servicios saludables y migración **030** aplicada. Autoridad `ferweb_postgres_data`. Web en `http://127.0.0.1:5173`.

## Límites y siguiente paso

SQL, Qdrant, CLI y contenedores reales; GitHub y proveedores simulados. Aceptación con App, modelos y hardware reales pendiente. Sin ahorro, velocidad o GPU medidos. Métricas ausentes desconocidas; bytes no estiman tokens y las citas requieren juicio humano.

P19 recibe texto acotado; P20 usa herramientas en el sandbox. Ambos conservan inferencia local sin fallback. La parada remota sigue desconocida. GitHub conserva su política propia. E10 sin mejoras reales adoptadas. Docker comparte kernel y su controlador es privilegiado. Pendientes la aceptación del ZIP en Codex, extensiones de terceros y despliegue permanente. [Límites](codex.md), [CI](https://github.com/fercuacas/FerWeb/actions).

Siguiente entrega: P23. [Plan](plans/ecc-codex-prompts/progress.md).
