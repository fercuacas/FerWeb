# Estado actual de FerWeb

Actualizado: **2026-11-06**. Evidencias anteriores en [history.md](history.md), solo bajo demanda.

## Disponible

- E1–E9: identidad/sesiones, proyectos/tareas, GitHub por commit, chat OpenAI/Ollama, Qdrant, laboratorio, cola, Codex aislado y revisión/PR explícita.
- E10: comparación y adopción condicionada de estrategias; ninguna mejora real adoptada. [Laboratorio de contexto](context-optimization.md).
- E11: imágenes fijadas, CI, Compose release, copias/restauración y observabilidad. [Revisión final](release-review.md), [operación](deployment.md).
- P01–P09: capacidades, roles/skills, presupuestos, equipos/mensajes, revisiones y memoria versionada con procedencia. [Codex](codex.md), [memoria](memory.md).
- P10: mapa Markdown, catálogo SQL/JSON, selección determinista, recuperación híbrida, recibos por fase y ampliaciones dirigidas. [Uso y límites](context-packs.md).

## Verificado

- P10, `npm run docker:check`: **10 Python, 17 básicas, 98 pruebas/subcasos de integración y 20 Chromium**, tipos, compilación, formato y smoke. Registro privado `.local/p10-docker-check-verified.log`.
- Pruebas dirigidas adicionales: API **7 pruebas/subcasos**, Codex **2**, navegador **1**. Ampliaciones concurrentes/idempotentes, cupos, dos roles, correcciones, revocación, exportación y móvil verificados.
- Instancia local: siete servicios saludables, migración **020**, autoridad `ferweb_postgres_data`, web `http://127.0.0.1:5173`.

## Límites y siguiente paso

Pruebas con SQL, Qdrant, CLI y contenedores reales; GitHub y proveedores simulados. Inferencia real, ahorro y capacidad IA/GPU por medir. Los bytes de contexto no estiman tokens; las métricas ausentes permanecen desconocidas. Las citas requieren juicio humano.

El recibo registra el canal P10, no cada lectura de archivos del agente. Chat/índice/laboratorio siguen en proceso; Codex conserva perfil Node, kernel compartido y controlador privilegiado. [Límites](codex.md).

Despliegue permanente pendiente: host/HTTPS, copias cifradas externas, aceptación con App/modelos, monitorización y pruebas prolongadas. Global dos trabajos; por proyecto uno por defecto. [CI](https://github.com/fercuacas/FerWeb/actions).

Sigue P11, sin iniciarlo automáticamente. [Plan](plans/ecc-codex-prompts/progress.md).
