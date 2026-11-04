# Cobertura de utilidades ECC

Esta matriz es un **plan**. P00 comprobó que las 30 familias se corresponden con las fases P00–P26 y que las rutas iniciales de los prompts existen. La revisión por entrada canónica corresponde a P23. El estado de cada entrega y la disponibilidad de la aplicación se registran por separado. [Progreso](progress.md) · [Estado de FerWeb](../../status.md)

La unidad de cobertura es la familia/capacidad; P23 debe completar un inventario por entrada canónica del commit ECC fijado, sin contar traducciones o copias generadas como utilidades nuevas. Los números de prompts en una celda expresan entregas relacionadas, no aceptación ya lograda.

| Familia | Origen ECC | Prompts | Evidencia que se exige |
|---|---|---|---|
| Roles y especialidades | agents/, .codex/agents/ | P02 | Versiones, compatibilidad y ejecución individual |
| Skills y recursos | skills/, .agents/skills/ | P03, P10, P23 | Importación estática, recursos/licencia, selección y utilidad real |
| Reglas y modos | rules/, contexts/ | P03, P12, P15 | Adaptación sin reemplazar políticas del proyecto |
| Comandos y recetas | commands/, legacy-command-shims/ | P15 | Argumentos/acotación y workflow efectivo, no texto a shell |
| Equipos y planes | team-builder, team-agent-orchestration, orch-* | P05–P08 | DAG versionado, pasos duraderos y fan-in |
| Delegación y mensajes | ecc2/session, ecc2/comms | P06, P07 | Identidad, autorización, cuotas y entregas |
| Workspaces e integración | orchestrate-worktrees, worktree-lifecycle | P17 | Copias aisladas, conflictos y verificación de integración |
| Proximidad y conflictos | agent-proximity/, control-plane view | P17 | Advertencias heurísticas, sin garantía de ausencia de conflicto |
| Revisión adversarial | orch-review workflow, council, santa, GAN | P08, P13 | Evidencia, deduplicación, fallos visibles y bucles limitados |
| Memoria portable | memory-vault, unified-memory | P09 | Entradas por proyecto, evidencia, revisiones vigentes, historial y exportación |
| Aprendizaje y evolución | continuous-learning, skill-evolution | P14 | Propuestas revisadas, evaluación y rollback |
| Contexto y caché | context-profiles, selection, retrieval, carriers | P10 | Mapa Markdown, búsqueda híbrida, ampliación bajo demanda, recibos y comparación con la recuperación actual |
| Herramientas y perfiles | hooks, runtime patterns, Docker examples | P11, P12 | Herramientas confiables, versiones y verificación independiente |
| Seguridad y GateGuard | gateguard, safety-guard, agent-security-hardening | P12, P22 | Controles efectivos y límites de cobertura explícitos |
| Evaluación y cumplimiento | eval-harness, docker/context-profiles, skill-comply | P13, P14 | Grader protegido, simulación separada y aceptación real |
| Uso, costes y presupuestos | cost tracker, ECC2 budget enforcement | P04, P21, P25 | Reservas, cobertura, tarifas verificadas y desconocidos |
| Panel y planes visuales | control-pane, plan-canvas, dashboard | P16 | Estado SQL, comentarios/versiones y artefactos aislados |
| GitHub y tareas | github-coordination, work-items | P18 | GitHub App, reconciliación y efectos explícitos |
| ADRs y documentación | docs-governance, module-governance, change-impact | P00, P15 | Decisiones/evidencia sin duplicar fuentes de verdad |
| Proveedores e interoperabilidad | src/llm, agent IR, adaptadores de hosts | P01, P19–P22 | Proveedor/runtime separados y adaptador Codex validado |
| Instalación y mantenimiento | manifests/, schemas/, install/doctor/repair/uninstall | P03, P22 | Previsualización, propiedad y retirada no destructiva |
| IA local | Ollama y patrones local-first | P19–P21 | Capacidades verificadas y pruebas de egress |
| Ingeniería por stack | skills frontend/backend/datos/móvil/redes | P11, P15, P23 | Packs por proyecto, no todas las dependencias instaladas |
| Investigación y contenido | research, marketing, SEO, product skills | P23 | Workflows con fuentes y artefactos revisables |
| Documentos y multimedia | slides, image/video/document skills | P22, P23 | Contenido portable y adaptadores específicos cuando existan |
| Dominios especializados | healthcare, finanzas, logística y operaciones | P23 | Catálogo clasificado, límites y herramientas externas diagnosticadas |
| Conectores opcionales | MCP, AURA, Itô, Nasiko, x402 y servicios | P22, P23 | Deshabilitados hasta configuración/autorización/aceptación propia |
| Automatización y notificaciones | ECC2 schedule/daemon/remote patterns | P24 | Durabilidad, zona horaria, deduplicación y silencio estable |
| Operación y evidencia | CI, Docker, observability/readiness/release material | P25, P26 | Recuperación, compatibilidad y cobertura final |
| Diseños/alpha/prototipos | docs/design, ECC2 alpha, pilotos de workflows | P00, P26 | Registrar madurez; no anunciar diseño como producto terminado |

## Estados que debe conservar el inventario detallado

- Catalogado: metadatos disponibles; no implica ejecución.
- Contenido revisado: instrucciones/recursos utilizables con sus límites.
- Adaptador implementado: contrato conectado y probado con simulados.
- Aceptación real verificada: prueba explícita con destino/modelo/hardware y presupuesto identificados.
- Pendiente o no compatible: motivo y requisito concreto.

Para cada utilidad se deben guardar origen/commit/licencia, fase, ruta de implementación, capacidades, destino de datos, prueba y límites. Las herramientas externas sin configuración no pasan a aceptadas porque su skill esté importada. Una política de datos local aplica también a auxiliares y evaluadores.
