# Estado actual de FerWeb

Actualizado: **2026-11-26**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E11: identidad, proyectos/tareas, GitHub, chat OpenAI/Ollama, recuperación, laboratorio, cola, Codex aislado y revisión/PR. [Operación](deployment.md).
- P01–P10: capacidades, roles/skills, presupuestos, equipos, revisiones, memoria versionada y contexto con mapa Markdown, catálogo SQL/JSON y recibos. [Codex](codex.md), [memoria](memory.md), [contexto](context-packs.md).
- P11–P17: perfiles y controles, evaluación y lecciones, recetas, seguimiento, revisión visual y escritores aislados con integración/publicación revisadas. [Codex](codex.md), [laboratorio](laboratory.md), [revisión](reviews.md).
- P18: épicas, dependencias, asignaciones y vínculos estables a GitHub. Bloqueos de ejecución/publicación y creación de issues con vista previa, aprobación y reconciliación. [Coordinación](github.md#épicas-dependencias-y-coordinación-p18).
- P19: especialistas de lectura con Ollama nativo, modelo por rol, contexto P10, entregas JSON y validación de citas. [Uso y aceptación real](local-specialists.md).
- P20: Codex con Ollama local, herramientas aisladas, contexto P10, informes E9 y equipos con inferencia local en todas sus etapas. [Configuración y aceptación real](local-coding.md).

## Verificado

- El 26 de noviembre de 2026, `npm run docker:check`: **12 Python, 27 básicas, 132 pruebas/subcasos de integración y 25 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p20-docker-check-resumed.log`.
- P20 dirigido: seis pruebas del adaptador, quince de integración con la muestra HTTP saturada y recorrido Chromium. Se verificaron herramientas reales, E9, equipos, contexto, bucles, cancelación y aislamiento, con cero inferencias cloud. Captura móvil inspeccionada.
- Siete servicios saludables y migración **028** aplicada. Autoridad `ferweb_postgres_data`; web `http://127.0.0.1:5173`.

## Límites y siguiente paso

SQL, Qdrant, CLI y contenedores reales; GitHub y proveedores simulados. Aceptación con App, modelos y hardware reales pendiente. Sin ahorro, velocidad o GPU medidos. Métricas ausentes desconocidas; bytes no estiman tokens y las citas requieren juicio humano.

P19 recibe texto acotado; P20 usa herramientas en el sandbox. Ambos mantienen inferencia local sin fallback; la parada remota de Ollama permanece desconocida. GitHub conserva su política propia. E10 sin mejoras reales adoptadas. Docker comparte kernel y su controlador es privilegiado. Despliegue permanente pendiente. [Límites](codex.md), [CI](https://github.com/fercuacas/FerWeb/actions).

Siguiente entrega: P21. [Plan](plans/ecc-codex-prompts/progress.md).
