# Progreso del plan ECC/Codex

P00 se completó el **4 de noviembre de 2026**. La revisión de código y documentación fija la base de las entregas siguientes. La aceptación funcional y la aceptación con proveedores reales se registran por separado.

| Entrega | Dependencias declaradas | Estado | Evidencia o criterio pendiente |
|---|---|---|---|
| [P00](P00-baseline.md) | Ninguna | Completada | [Contrato y evidencia de código](BASELINE.md) y [cobertura revisada](coverage.md). |
| [P01](P01-capabilities.md) | P00 | Completada | 4 de noviembre de 2026. Catálogo protegido, diagnóstico en Estado y Trabajos, y validación en Docker con proveedores simulados. [Contrato y uso](../../codex.md) |
| [P02](P02-agents.md) | P01 | Pendiente | P01 verificado. Catálogo versionado de agentes y verificaciones pendientes. |
| [P03](P03-skills.md) | P01, P02 | Pendiente | Implementación y verificaciones del prompt. |
| [P04](P04-budgets.md) | P01, P02 | Pendiente | Implementación y verificaciones del prompt. |
| [P05](P05-teams.md) | P02, P03, P04 | Pendiente | Implementación y verificaciones del prompt. |
| [P06](P06-sequential.md) | P04, P05 | Pendiente | Implementación y verificaciones del prompt. |
| [P07](P07-parallel.md) | P06 | Pendiente | Implementación y verificaciones del prompt. |
| [P08](P08-reviews.md) | P07 | Pendiente | Implementación y verificaciones del prompt. |
| [P09](P09-memory.md) | P06 | Pendiente | Implementación y verificaciones del prompt. |
| [P10](P10-context.md) | P03, P09 | Pendiente | Implementación y verificaciones del prompt. |
| [P11](P11-tool-profiles.md) | P01, P06 | Pendiente | Implementación y verificaciones del prompt. |
| [P12](P12-gates.md) | P08, P11 | Pendiente | Implementación y verificaciones del prompt. |
| [P13](P13-evaluation.md) | P08, P10, P11 | Pendiente | Implementación y verificaciones del prompt. |
| [P14](P14-learning.md) | P09, P13 | Pendiente | Implementación y verificaciones del prompt. |
| [P15](P15-commands.md) | P05, P08, P12 | Pendiente | Implementación y verificaciones del prompt. |
| [P16](P16-control-room.md) | P06, P08, P09, P15 | Pendiente | Implementación y verificaciones del prompt. |
| [P17](P17-writers.md) | P07, P08, P11, P16 | Pendiente | Implementación y verificaciones del prompt. |
| [P18](P18-github.md) | P05, P08, P16 | Pendiente | Implementación y verificaciones del prompt. |
| [P19](P19-local-analysis.md) | P01, P07, P10, P13 | Pendiente | Implementación y verificaciones del prompt. |
| [P20](P20-local-coding.md) | P11, P12, P13, P19 | Pendiente | Implementación y verificaciones del prompt. |
| [P21](P21-routing.md) | P13, P19, P20 | Pendiente | Implementación y verificaciones del prompt. |
| [P22](P22-extensions.md) | P03, P11, P12, P21 | Pendiente | Implementación y verificaciones del prompt. |
| [P23](P23-utility-packs.md) | P03, P15, P22 | Pendiente | Implementación y verificaciones del prompt. |
| [P24](P24-automations.md) | P06, P16, P21, P22 | Pendiente | Implementación y verificaciones del prompt. |
| [P25](P25-operations.md) | P16, P20, P24 | Pendiente | Implementación y verificaciones del prompt. |
| [P26](P26-acceptance.md) | P00–P25 según capacidades habilitadas | Pendiente | Implementación y verificaciones del prompt. |

Las dependencias se cotejaron con cada prompt. Las 27 fases están ordenadas sin ciclos y todas las rutas iniciales existen en el checkout. P26 aplica los requisitos de las capacidades habilitadas. La [base observada](BASELINE.md) identifica el código que se reutilizará en cada área.

Comprobaciones de P00. Enlaces locales, coherencia de fases y cobertura, coincidencia del recopilatorio con los prompts individuales y comprobaciones de whitespace con Git. La evidencia de ejecución de E1–E11 sigue fechada en el [estado de FerWeb](../../status.md).

Comprobaciones de P01. `npm run docker:check` pasó con 10 pruebas Python, 12 básicas, 75 pruebas y subcasos de integración, 14 pruebas Chromium, tipos, compilación, formato y smoke. Se comprobó el diagnóstico con y sin configuración, acceso por proyecto, simulación, capacidades desconocidas y rechazo de modelos y proveedores incompatibles. La aceptación con modelos reales permanece pendiente.

Al ejecutar una entrega, registra fecha, archivos/contratos relevantes, checks realmente ejecutados, simulación o aceptación real, límites y bloqueos. No marques completa una fase funcional con checks requeridos pendientes ni sobrescribas evidencia histórica para que parezca recién ejecutada.
