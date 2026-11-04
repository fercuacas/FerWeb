# Base observada y decisiones para los prompts

P00 completado el 4 de noviembre de 2026 mediante revisión del checkout y de los contratos. La base funcional y las verificaciones anteriores se registran por separado. [Estado de FerWeb](../../status.md) · [Progreso del plan](progress.md)

## Interfaz que se amplía

| Superficie | Código revisado | Extensión prevista |
|---|---|---|
| Acceso y proyectos | [App](../../../apps/web/src/App.tsx), [Workspace](../../../apps/web/src/Workspace.tsx) | Mantener sesión, proyectos y ámbito. Activar Agentes con capacidades reales. |
| Tareas y tablero | [Workspace](../../../apps/web/src/Workspace.tsx) | Acciones para recetas, planes y equipos; dependencias y evidencias. |
| Repositorio | [GitHub](../../../apps/web/src/GitHub.tsx), [contexto](../../../apps/web/src/RepositoryContext.tsx) | Procedencia y coordinación de issues/épicas. |
| Conversaciones | [Conversations](../../../apps/web/src/Conversations.tsx) | Conservar proveedor/modelo inmutables por conversación. Recetas explícitas cuando proceda. |
| Laboratorio | [Laboratory](../../../apps/web/src/Laboratory.tsx), [ContextStrategies](../../../apps/web/src/ContextStrategies.tsx) | Comparación de agentes/equipos, skills y API/local. |
| Trabajos | [Jobs](../../../apps/web/src/Jobs.tsx), [Coding](../../../apps/web/src/Coding.tsx) | Pasos de equipo, progreso, presupuesto y entregas. |
| Revisión | [CodingReview](../../../apps/web/src/CodingReview.tsx) | Hallazgos de especialistas y resultado integrado; publicación explícita conservada. |
| Estado | [StatusApp](../../../apps/web/src/StatusApp.tsx) | Diagnóstico de capacidades, proveedor/runtime y herramientas. |

## Arquitectura observada

- Monorepo React/TypeScript, API Node modular, servicio Python de IA, PostgreSQL, Qdrant y contenedores de herramientas/runner.
- OpenAI y Ollama ya existen para chat. Ese adaptador devuelve texto; no acredita un ciclo de herramientas para agentes locales.
- Codex CLI 0.166.0 se ejecuta con `codex exec --json`, en un contenedor aislado con pasarela del controlador a Responses. Autenticación por API, sin usar sesiones del Codex del escritorio.
- El modo multiagente está desactivado. Se usa un modelo fijo por ejecución, sin instalación de dependencias o red general dentro del código.
- La frontera de código depende de Docker/usuario/montajes/red y pasarela. `danger-full-access` dentro del contenedor no es por sí mismo una garantía ni permiso sobre el anfitrión.
- El ejecutor verifica con `node --test`; no hay un perfil genérico completo para todas las tecnologías.
- Cola con dos trabajos globales y uno por proyecto. Padres e hijos necesitan un modelo de admisión que evite bloquearse entre sí.
- El snapshot usa blobs filtrados y excluye `.git`, `.codex`, `AGENTS.md`, secretos y otros archivos. Los nuevos roles/skills deben proceder de configuración revisada del servidor.
- Chat/laboratorio no adquieren durabilidad de cola por añadir equipos; esa migración requiere su propia política de efectos.
- El checkout aún no tiene HEAD válido. Los prompts no autorizan crear commits ni dependen de worktrees del anfitrión.

Referencias: [Codex](../../codex.md), [IA](../../ai.md), [trabajos](../../jobs.md), [revisiones](../../reviews.md), [contexto](../../context-optimization.md), [mapa de desarrollo](../../development.md).

## Evidencia de la revisión P00

| Capacidad | Base confirmada en código | Dependencia que habilita |
|---|---|---|
| Navegación | `ProjectPage` ofrece Tareas, GitHub, Conversaciones, Laboratorio y Trabajos. Agentes figura como pendiente. | P01 amplía el diagnóstico y P02 incorpora el catálogo. [Workspace](../../../apps/web/src/Workspace.tsx) |
| Contratos y cola | `simulation-v1` y `codex-v1` son los tipos de trabajo admitidos. La asignación usa leases y `SKIP LOCKED`, con un máximo de dos ejecuciones globales y una por proyecto. | P04 amplía la admisión y P06 añade coordinación padre/pasos. [Contratos](../../../packages/contracts/src/jobs.ts) · [Cola](../../../apps/api/src/modules/jobs/queue.ts) |
| Ejecución y pasarela | La CLI fijada en 0.166.0 usa `codex exec --json`, con delegación interna desactivada. El controlador valida el modelo y lleva las peticiones a Responses. El contenedor de código carece de red general y la verificación independiente usa `node --test`. | P01 describe el motor actual. P07 y P11 dependen de fronteras efectivas de ejecución. [Versión](../../../apps/sandbox/tooling/package.json) · [CLI](../../../apps/sandbox/agent.mjs) · [Controlador](../../../apps/runner/controller.mjs) · [Pasarela](../../../apps/runner/policy.mjs) |
| Proveedores y fuentes | El servicio admite OpenAI y Ollama para generación de texto. Los embeddings tienen su propio adaptador local. PostgreSQL conserva el texto y la procedencia del repositorio. | P09 añade memoria operativa y P10 amplía la recuperación. P19 y P20 prueban capacidades locales por separado. [Proveedores](../../../apps/ai/ferweb_ai/main.py) · [Embeddings](../../../apps/ai/ferweb_ai/embeddings.py) · [Migración de fuentes](../../../apps/api/migrations/005_retrieval.sql) |
| Chat y laboratorio | Los servicios mantienen controladores de cancelación en memoria. El laboratorio conserva resultados y políticas de contexto en PostgreSQL. | P13 y P21 amplían las comparaciones. La incorporación de chat o laboratorio a la cola requiere definir recuperación y efectos propios. [Chat](../../../apps/api/src/modules/chat/service.ts) · [Laboratorio](../../../apps/api/src/modules/laboratory/service.ts) · [Políticas](../../../apps/api/migrations/010_context_strategies.sql) |
| Revisión y publicación | La aprobación se vincula al hash del informe. La publicación del borrador se solicita por separado con la versión de la revisión. | P08 y P17 añaden evidencias de varios pasos a la revisión. P18 reutiliza la vía autorizada de GitHub. [Servicio de revisión](../../../apps/api/src/modules/jobs/review-service.ts) · [Interfaz](../../../apps/web/src/CodingReview.tsx) |

## Contrato de evolución

Estos términos describen el diseño para las fases siguientes. Los nombres de tablas, rutas y tipos nuevos se decidirán en la fase que los use.

| Concepto | Responsabilidad y relación |
|---|---|
| Agente | Definición versionada de un rol con instrucciones revisadas, resultado esperado y capacidades requeridas. La ejecución conserva la versión elegida. |
| Skill | Procedimiento versionado con procedencia y recursos. Su selección aporta instrucciones o referencias dentro de las capacidades autorizadas. |
| Workflow | Plan versionado que asocia roles y dependencias con criterios de aceptación y límites. Cada ejecución congela el plan. |
| Paso | Unidad del plan con entradas, dependencias y resultado verificable. El planificador habilita el paso cuando se cumplen sus condiciones y hay presupuesto. |
| Ejecución | Instancia persistida de un plan o trabajo individual. Vincula proyecto, tarea, snapshot, versiones, estado, consumo y evidencias. Un paso activo consume un cupo de ejecución. |
| Proveedor | Destino de inferencia y modelo configurado en servidor. Declara capacidades verificadas y los datos de uso que puede reportar. |
| Runtime | Motor que ejecuta el ciclo del agente. El primer adaptador sigue siendo `codex-v1`. La integración gestionada de OpenAI, si se adopta, tendrá su propio adaptador. |
| Perfil de herramientas | Herramientas, imagen, recursos y política de acceso que impone el ejecutor. La capacidad efectiva resulta de la intersección entre el perfil, la política del proyecto y el runtime. |
| Memoria | Entradas operativas por proyecto con procedencia, vigencia e historial en PostgreSQL. Las decisiones canónicas y el mapa Markdown pueden mantenerse en Git. |
| Evidencia | Fuente, artefacto, prueba o resultado con procedencia y versión. Distingue afirmaciones del agente, observaciones del controlador y revisión humana. |

La API de FerWeb resuelve permisos, destino y capacidades antes de admitir el trabajo. PostgreSQL guarda el plan y sus versiones, y el controlador aplica el perfil de herramientas, los límites y el destino de inferencia. El código corre en el contenedor aislado. El coordinador de un workflow mantiene estado duradero y deja los cupos de ejecución a sus pasos activos. Los recibos de contexto de P10 vincularán las fuentes, la memoria y las skills a cada paso. La autorización se revalida al recuperar datos y antes de servir evidencias.

La ruta inicial conserva la CLI de Codex y su pasarela hacia Responses. Una integración con la Agents API gestionada se evaluará como adaptador separado. FerWeb mantiene la autoridad sobre proyectos, permisos, ejecuciones e informes. [Agents API de OpenAI](https://developers.openai.com/api/docs/guides/agents-api/overview)

## Fronteras para IA local

Proveedor de inferencia, runtime de agente y herramientas son dimensiones diferentes. Un modelo local de texto puede servir para análisis sin poder ejecutar código. Un runtime en el PC puede seguir enviando inferencia a la nube. Las capacidades se describen y verifican separadamente.

La ruta inicial mantiene Codex por API. La futura ruta local verifica primero la compatibilidad de Codex OSS y, si procede, incorpora un runtime local mínimo bajo el mismo contrato. El modo local no permite usar silenciosamente un juez, resumidor o selector externo. Un modo mixto exige elección explícita de etapas y destinos.

El despliegue en el mismo equipo puede conectar el servicio de IA al Ollama autorizado del anfitrión. Si FerWeb se despliega en otro equipo, usar el modelo del PC requiere una conexión saliente autenticada desde ese PC, con revocación, reconexión y cuotas. El servidor validará destinos de inferencia, embeddings, selección, resúmenes y evaluación. El acceso a GitHub seguirá su autorización independiente. [Topología prevista](../../architecture.md) · [Ollama en FerWeb](../../ai.md)

## Decisiones pendientes por fase

| Cuándo | Qué se decide |
|---|---|
| P01 | Forma mínima de exponer capacidades y revisiones conservando los contratos de Codex y chat. |
| P04–P07 | Reserva de presupuesto entre pasos, cancelación de descendientes y admisión de especialistas dentro del límite global. |
| P09–P10 | Formato de memoria y recibo, estrategia de búsqueda híbrida y umbrales de adopción con evidencia en el laboratorio. |
| P19–P21 | Modelo y hardware local autorizados, soporte real de herramientas y elección entre Codex local o runtime alternativo. |
| P25–P26 | Topología de despliegue, recuperación y aceptación con proveedores reales y presupuesto explícito. |

P00 confirma el diseño a partir del código. Las ejecuciones anteriores con proveedores simulados respaldan los contratos que cita el estado del proyecto. La aceptación con GitHub, modelos y hardware reales se registra por separado, con su configuración y resultados. [Evidencia vigente](../../status.md)

## Precauciones concretas del origen ECC

- Tres roles en `.codex/agents/` no equivalen a adaptar los 71 agentes canónicos. Sus tiers/modelos y controles de permisos necesitan revisión por versión.
- El plugin Codex de ECC declara un bootstrap SessionStart; no se presume que todos los hooks Claude funcionen en Codex.
- El eval-harness genérico rehúsa ejecutar candidatos sin un backend de aislamiento admitido. El evaluador de perfiles es otra implementación con requisitos/versiones propios.
- ECC2 contiene coordinación real en Rust/SQLite y sigue identificado como alpha. FerWeb conserva Node/PostgreSQL y porta contratos/algoritmos útiles.
- Memory Vault es contexto, no autoridad. Los recibos de hashes no son autenticación ni garantizan vigencia de los hechos.
- El contador de costes leído está ligado a transcripciones/tarifas de Claude; no sirve directamente como contabilidad Codex.
- La selección híbrida de skills usa léxico y n-gramas; no es un modelo semántico de embeddings.
- El conversor de agentes declara `claude → pi`; no se da por existente un conversor universal a Codex.

Estas diferencias se convierten en criterios de aceptación de las fases, no en dependencias obligatorias para copiar el sistema entero.
