# Estado actual de FerWeb

Actualizado: **2026-11-20**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E11: identidad, proyectos/tareas, GitHub, chat OpenAI/Ollama, recuperación, laboratorio, cola, Codex aislado, revisión/PR y operación Docker. E10 sin mejoras reales adoptadas. [Operación](deployment.md).
- P01–P09: capacidades, roles/skills, presupuestos, equipos/mensajes, revisiones y memoria versionada con procedencia. [Codex](codex.md), [memoria](memory.md).
- P10: mapa Markdown, catálogo SQL/JSON, selección determinista, búsqueda híbrida y recibos por fase con ampliaciones. [Contexto](context-packs.md).
- P11–P12: perfil TypeScript/React fijado, comprobación estática y controles del alcance, configuración, verificación y entrega. [Perfiles y controles](codex.md#perfiles-de-herramientas-p11).
- P13–P14: comparación de agente/equipo, verificador local, revisión humana, lecciones y adopción reversible condicionada. [Laboratorio](laboratory.md).
- P15: nueve recetas versionadas con vistas previas y alcance confirmado. [Recetas](codex.md#recetas-de-tarea-p15).
- P16: seguimiento por etapa y revisión visual ligada a huella. [Centro de control](codex.md#centro-de-control-p16), [revisión](reviews.md#revisión-visual-p16).
- P17: escritores con copias aisladas, integración versionada, resolución explícita, pruebas del conjunto y publicación E9 con aprobación propia. [Uso y límites](codex.md#escritores-e-integración-p17).

## Verificado

- P17, `npm run docker:check`: **10 Python, 20 básicas, 104 pruebas/subcasos de integración y 22 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p17-docker-check.log`.
- Pruebas dirigidas: integración/resolución, alcance del verificador, plazo compartido con ambos escritores activos, informes tras fallos simultáneos, revocación, TypeScript y publicación simulada; móvil, teclado y recarga.
- Instancia local: siete servicios saludables, migración **025**, autoridad `ferweb_postgres_data`, web `http://127.0.0.1:5173`.

## Límites y siguiente paso

SQL, Qdrant, CLI y contenedores reales; GitHub y proveedores simulados. Inferencia real, ahorro y capacidad IA/GPU por medir. Métricas ausentes desconocidas; bytes de contexto no estiman tokens. Las citas requieren juicio humano.

La comparación P17 resuelve conflictos por archivo completo. TypeScript/React es estático. El recibo audita el canal P10. Chat/índice/laboratorio siguen en proceso. Docker comparte kernel y su controlador es privilegiado. [Límites](codex.md).

Despliegue permanente pendiente: host/HTTPS, copias cifradas externas, aceptación con App/modelos y pruebas prolongadas. Máximo global dos trabajos; por proyecto uno por defecto. [CI](https://github.com/fercuacas/FerWeb/actions).

Sigue P18. [Plan](plans/ecc-codex-prompts/progress.md).
