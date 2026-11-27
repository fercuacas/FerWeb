# Cobertura de utilidades ECC

P26 audita las 30 capacidades del plan y los diez paquetes de P23. Cada ficha del inventario identifica los recursos de ECC por ruta y objeto Git. La evidencia distingue el uso local del producto, las pruebas con proveedores simulados y las operaciones que requieren aceptación externa. [Progreso](progress.md) · [Estado de FerWeb](../../status.md)

## Inventario verificable por entrada

El inventario contiene **759 fichas** del commit fijado de ECC 2.2.3. Incluye 314 skills, 71 agentes, 98 comandos, reglas, modos, workflows, herramientas, manifests, prototipos y los servidores declarados en el registro MCP. El identificador es la ruta canónica, con un fragmento por servidor en el fichero compartido. Cada recurso asociado conserva la ruta y el objeto Git del origen. La ficha muestra la licencia declarada, con MIT del repositorio por defecto. Los archivos de licencia y otros recursos adjuntos conservan su referencia original. [Inventario JSON](../../../apps/api/src/modules/utility-packs/inventory.json) · [ECC b38be6a7](https://github.com/affaan-m/ECC/tree/b38be6a7f6350964d59328b52f0624e1d1d552d1)

El generador lee el árbol y los metadatos fijados. Clasifica 1.681 archivos bajo las entradas, 1.535 como traducciones, variantes de host y shims, y 1.485 como material auxiliar. Los ejemplos internos, recursos del repositorio y copias no se cuentan como utilidades independientes. Ejecuta `node scripts/ecc-inventory.mjs <ruta-a-ECC> --verify` con el commit presente para comprobar igualdad por entrada, recurso y huella. [Generador](../../../scripts/ecc-inventory.mjs)

Por modo de origen, hay 515 fichas de contenido, 98 de workflow, 85 de herramientas y 61 de integración externa. La disponibilidad se muestra por separado en cada ficha.

| Familia | Fichas · externas | Origen ECC representativo | Adaptación, aceptación y límite |
| --- | ---: | --- | --- |
| Ingeniería | 461 · 34 | Roles de implementación, modos de desarrollo y comandos de prueba | Plan de cambio, prueba y reversión. La ejecución equivalente depende de los roles y perfiles verificados de FerWeb. |
| Frontend, diseño y accesibilidad | 56 · 4 | `frontend-patterns`, diseño y accesibilidad | Matriz de estados, foco y comprobaciones. P11 prueba el perfil TypeScript/React en Docker. La inspección visual externa queda pendiente. |
| Backend y datos | 50 · 2 | `postgres-patterns`, patrones de API y bases de datos | Plan de contratos, migración y persistencia. SQL real en los checks. Conectores a otras bases requieren su propia integración. |
| Móvil | 57 · 0 | Skills de Android, iOS y plataformas híbridas | Matriz por dispositivo y conexión. Chromium comprueba la web adaptable. Falta aceptación de compiladores nativos y dispositivos. |
| Investigación y documentación | 25 · 4 | Modos de investigación y skills documentales | Plan de verificación de fuentes. La receta adicional de mapa de evidencias ejecuta Codex CLI API de solo lectura con Responses simulado y verifica el artefacto. Falta repetir con un modelo real autorizado. |
| Contenido y SEO | 15 · 2 | Skills de contenido, marketing y SEO | Brief y lista de verificación. Publicación y consulta de servicios externos requieren adaptador y consentimiento. |
| Documentos y multimedia | 33 · 4 | Skills de diapositivas, documentos, vídeo y medios | Guion, materiales y derechos. Renderizado, generación y firma quedan sujetos a motor, permisos y licencia propios. |
| Operaciones empresariales | 19 · 10 | Workflows de operaciones, correo y gestión de trabajo | Mapa de proceso y borrador revisable. Envíos, cobros y escrituras en servicios permanecen pendientes de autorización y aceptación. |
| Redes y homelab | 14 · 0 | Skills de red y operación local | Revisión documental de infraestructura propia. El paquete genera el plan dentro del proyecto a partir de sus referencias. |
| Dominios especializados | 29 · 1 | Referencias de salud, finanzas, logística y otros dominios | Ficha para revisión humana cualificada. La presencia en el catálogo acredita procedencia y clasificación. |

El runtime de los diez planes es el servidor de FerWeb con PostgreSQL. La acción exige una tarea del propietario en proyecto activo y snapshot sincronizado. Guarda fuentes, versión y resultado dentro del proyecto. La lectura sigue disponible en archivo con acceso vigente. La receta adicional de investigación necesita confirmación de la huella y perfil de solo lectura. [Definiciones versionadas y rutas exactas de origen](../../../apps/api/src/modules/jobs/utility-recipes.ts) · [Ruta de catálogo y controles](../../../apps/api/src/workspace.ts).

**Contenido utilizable.** Las siete adaptaciones portables revisadas del catálogo P03 se pueden importar como versiones pendientes de aprobación en el proyecto. Sus usos y perfiles dependen del rol que las vincule. Las demás referencias conservan su estado en la ficha.

**Recorridos de FerWeb.** La API y Chromium prueban catálogo y filtros, planes locales y persistencia. La integración verifica los diez planes y una ejecución aislada de mapa de evidencias con Codex CLI real y proveedor simulado. Los planes locales preparan un entregable de revisión desde una tarea y sus fuentes. La receta de evidencias requiere confirmación explícita y el perfil Codex API de solo lectura. [Recorrido](../../utility-packs.md).

**Aceptación externa pendiente.** Las fichas de MCP y servicios listan el adaptador, los permisos, el destino, la cuenta o el presupuesto exigidos según proceda. Su acción permanece deshabilitada. La ejecución del mapa con un modelo API real sigue pendiente. [Progreso y evidencias](progress.md).

## Matriz de adaptación y aceptación

Los permisos de proyecto se comprueban en servidor. Las escrituras requieren proyecto activo y las referencias a repositorio requieren permiso de origen vigente. Los nombres de escenarios remiten a [pruebas de API](../../../apps/api/test), [recorridos de Chromium](../../../tests/browser) y al [registro por fase](progress.md).

| Capacidad · origen ECC | FerWeb · permisos y runtime | Evidencia · aceptación pendiente |
|---|---|---|
| Roles · `agents/`, `.codex/agents/` | P02 versiona roles por proyecto y congela el seleccionado según capacidades del motor. | `coding.integration.ts`, `coding.spec.ts`. Selección y ejecución simulada verificadas. Calidad con modelos reales pendiente. |
| Skills y recursos · `skills/`, `.agents/skills/` | P03/P10/P23 importan texto estático. Revisión de versión antes de vincularlo a un rol. | `coding.integration.ts`, `coding.spec.ts`, `utility-packs.spec.ts`. Siete adaptaciones revisadas. Recursos ejecutables quedan bloqueados. |
| Reglas y modos · `rules/`, `contexts/` | P03/P12/P15 adaptan instrucciones bajo el perfil y las reglas del proyecto. | `coding.integration.ts`. Curación y controles Docker probados con simulación. |
| Comandos y recetas · `commands/`, `legacy-command-shims/` | P15 congela ámbito, parámetros, tarea y huella. Plan local o Codex aislado tras confirmación. | `coding.integration.ts`, `recipes.spec.ts`. Investigación, corrección y borrador local. El catálogo general de comandos queda por adaptar. |
| Equipos y planes · `team-builder`, `team-agent-orchestration`, `orch-*` | P05–P08 coordinan DAG SQL, cola y entrega, con aprobación de la copia y presupuesto. | `coding.integration.ts`, `teams.spec.ts`, `team-execution.spec.ts`. CLI real, inferencia simulada. |
| Delegación y mensajes · `ecc2/session`, `ecc2/comms` | P06/P07 coordinan pasos y mensajes autenticados, acotados a equipo y fase. | `coding.integration.ts`, `specialists.spec.ts`. Fan-in y resultados incompletos comprobados. |
| Workspaces e integración · `orchestrate-worktrees`, `worktree-lifecycle` | P17 separa workspaces por escritura delegada. Integración y revisión posterior autorizadas. | `coding.integration.ts`, `writers.spec.ts`. Archivos y conflictos reales en Docker, GitHub simulado. |
| Proximidad y conflictos · `agent-proximity/`, control plane | P17 avisa por solapamiento de rutas y proximidad entre dependencias. | `coding-boundaries.test.ts`, `writers.spec.ts`. La advertencia es heurística. |
| Revisión adversarial · `orch-review`, council, GAN | P08/P13 registran hallazgos, adjuntan evidencias y verifican dimensiones con perfiles aislados y límites. | `coding.integration.ts`, `dimension-reviews.spec.ts`. Calidad de los revisores reales pendiente. |
| Memoria portable · `memory-vault`, `unified-memory` | P09 guarda revisiones y fuentes por proyecto, con exportación y revalidación. El motor trata la memoria como datos. | `memory.integration.ts`, `memory.spec.ts`, `coding.integration.ts`. Corrección e invalidación probadas. |
| Aprendizaje y evolución · `continuous-learning`, `skill-evolution` | P14 guarda propuestas de lección, revisión humana, señal de cumplimiento y adopción reversible con evidencia válida. | `coding.integration.ts`, `team-execution.spec.ts`. La evidencia simulada bloquea la adopción. Sigue pendiente el recorrido equivalente de evaluación, adopción y reversión para versiones de skills. |
| Contexto y caché · perfiles, selección y recuperación | P10 guarda mapa Markdown, catálogo derivado, recibos y ampliaciones acotadas. SQL/Qdrant y embeddings locales. | `context-packs.integration.ts`, `context-packs.spec.ts`, `coding.integration.ts`. Ahorro y calidad semántica reales pendientes. |
| Herramientas y perfiles · hooks y Docker | P11/P12 fijan perfiles, herramientas y verificación independiente en contenedor. | `coding.integration.ts`, `coding.spec.ts`. Cada perfil tiene límites propios. Los hooks de ECC siguen como referencia. |
| Seguridad y GateGuard · `gateguard`, `safety-guard` | P12/P22 ejecutan controles propios y exigen revisión de extensiones. Red y privilegios del sandbox restringidos. | `coding-boundaries.test.ts`, `coding.integration.ts`, `extensions.spec.ts`. El GateGuard completo y hooks de terceros quedan como referencias. |
| Evaluación y cumplimiento · `eval-harness`, `skill-comply` | P13/P14 fijan condiciones y grader protegido, con revisión de resultados. | `coding.integration.ts`, `team-execution.spec.ts`. Verificador real, calidad de modelos pendiente. |
| Uso y presupuestos · cost tracker y ECC2 budget | P04/P21/P25 reservan cupos en SQL, guardan admisiones y exponen cobertura con token. | `coding.integration.ts`, `observability.test.ts`, `release:check`. Coste final y uso ausente permanecen desconocidos. |
| Panel y planes visuales · control pane, plan canvas | P16 enlaza estado, latido y anotaciones a copias SQL y sirve artefactos como texto. | `coding.integration.ts`, `team-execution.spec.ts`. Recarga, error, foco y móvil evaluados. |
| GitHub y tareas · github coordination, work items | P18 usa App y exige preparación y aprobación antes de efectos remotos. | `coordination.integration.ts`, `review.integration.ts`, `work-coordination.spec.ts`. App y permisos reales pendientes de aceptación. |
| ADRs y documentación · docs governance y change impact | P00/P15 enlazan fuentes canónicas. Receta ADR prepara texto local por tarea. | Enlaces del plan, `coding.integration.ts`, `recipes.spec.ts`. Borrador local verificado. |
| Proveedores e interoperabilidad · `src/llm`, agent IR | P01/P19–P22 distinguen proveedor, motor y herramientas. Consentimiento explícito para transferencias de equipos mixtos. | `coding.integration.ts`, `provider-routing.spec.ts`. Rutas simuladas verificadas. Importación del ZIP en Codex y modelos reales pendientes. |
| Instalación y mantenimiento · manifests, schemas y doctor | P03/P22 importan versiones estáticas y retiran con historial. Lector incorporado sujeto a configuración aprobada. | `coding.integration.ts`, `extensions.spec.ts`. Lector, retirada y ZIP verificados. Instaladores y conectores terceros pendientes. |
| IA local · Ollama y patrones local-first | P19 usa lectura sin shell. P20 usa Codex con Ollama. P21 acota cada destino. | `local-readonly.integration.ts`, `local-coding.test.ts`, `coding.integration.ts`, `local-coding.spec.ts`. Hardware y calidad reales quedan pendientes. La confirmación de que Ollama detuvo el cómputo remoto sigue desconocida. |
| Ingeniería por stack · frontend, backend, datos, móvil y redes | P11/P15/P23 ofrecen planes y perfiles Node/TypeScript revisados, con alcance por tarea. | `coding.integration.ts`, `utility-packs.spec.ts`. Los runtimes adicionales exigen validación propia. |
| Investigación y contenido · research, marketing, SEO | P23 prepara planes y ejecuta el mapa de evidencias con solo lectura confirmada. | `coding.integration.ts`, `utility-packs.spec.ts`. Modelo API y publicación externa pendientes. |
| Documentos y multimedia · slides, vídeo y documentos | P22/P23 guardan contenido portable y planes de producción. | `extensions.spec.ts`, `utility-packs.spec.ts`. Generadores y servicios externos pendientes. |
| Dominios especializados · salud, finanzas, logística | P23 clasifica fichas y prepara una revisión humana dentro del proyecto. | `coding.integration.ts`, `utility-packs.spec.ts`. Aceptación sectorial pendiente. |
| Conectores · MCP, AURA, Itô, Nasiko, x402 | P22/P23 muestran requisitos por operación. Las fichas externas quedan deshabilitadas. | `coding.integration.ts`, `utility-packs.spec.ts`. Faltan adaptador, cuenta, destino y aceptación por conector. |
| Automatización y notificaciones · patrones ECC2 | P24 ejecuta planes aprobados mediante worker y calendarios IANA y deduplica avisos internos. | `automations.test.ts`, `coding.integration.ts`, `automations.spec.ts`. Conectores externos y calendarios adicionales pendientes. |
| Operación · CI, Docker y readiness | P25/P26 diagnostican, copian y restauran en proyectos aislados. Métricas internas y configuración privada. | `release:check`, `observability.test.ts`, `review.integration.ts`. Docker local y CI verificados. Despliegue permanente y recuperación off-host pendientes. |
| Diseños y alpha · `docs/design`, pilotos | El inventario conserva procedencia y referencia. Requieren adaptación y verificación antes de habilitarse. | Regeneración del catálogo y muestra en navegador. Madurez de ejecución pendiente. |

## Estados que debe conservar el inventario detallado

- Catalogado: metadatos disponibles; no implica ejecución.
- Contenido revisado: instrucciones/recursos utilizables con sus límites.
- Adaptador implementado: contrato conectado y probado con simulados.
- Aceptación real verificada: prueba explícita con destino/modelo/hardware y presupuesto identificados.
- Pendiente o no compatible: motivo y requisito concreto.

Para cada utilidad se deben guardar origen/commit/licencia, fase, ruta de implementación, capacidades, destino de datos, prueba y límites. Las herramientas externas sin configuración no pasan a aceptadas porque su skill esté importada. Una política de datos local aplica también a auxiliares y evaluadores.

## Procedencia, licencias y versiones

El inventario fijado registra 750 fichas con licencia MIT, ocho Apache-2.0 y una CC-BY-SA-4.0. Esos recuentos describen las declaraciones del origen. La ficha y su lista de objetos Git conservan los recursos para revisar individualmente cuando se proponga otra copia o adaptación.

- La [biblioteca curada](../../../apps/api/src/modules/skills/curated.ts) guarda el aviso MIT, las rutas y el commit de las siete adaptaciones de texto. Las otras dos entradas curadas describen hooks y MCP con sus requisitos de ejecución.
- El [ranking](../../../apps/api/src/modules/retrieval/ranking.ts) atribuye a ECC la separación de tokens y el ranking por n-gramas. Conserva su [aviso MIT](../../../apps/api/src/modules/retrieval/ECC-LICENSE.txt). La normalización en español y la prioridad de coincidencias literales se adaptan en FerWeb.
- Los paquetes vinculan versiones y rutas de origen. El inventario incluye metadatos y referencias Git de los recursos con otras licencias. Para incorporar contenido de una ficha se revisan los archivos y sus avisos en la revisión fijada.
- Codex CLI 0.166.0, dependencias e imágenes conservan las versiones fijadas del candidato. Las pruebas leen registros preexistentes sobre migraciones 001–009 y después de aplicar hasta 031. [Migraciones](../../../apps/api/migrations) · [Límites del runtime local](../../local-coding.md).

## Recorridos reproducibles de P26

Desde la raíz de FerWeb, `npm run docker:check` prepara PostgreSQL, Qdrant, los proveedores simulados y el navegador con las fixtures de Docker. Usa los siguientes casos para identificar la evidencia en la salida.

| Recorrido | Qué comprueba |
|---|---|
| `coding.integration.ts` · recibos de contexto y equipo P26 | Tarea y snapshot → roles y aprobación → recibos por etapa y revisión de memoria congelada → presupuesto liquidado → entrega verificada al revisor → borrador local recuperable. El contador del doble GitHub conserva sus escrituras previas. |
| `coding.integration.ts` · equipo Codex local P26 y requisitos del modelo | Dos etapas con runtime local y recibos léxicos sin embeddings. Se comprueba que el contador cloud no cambia. Los casos de capacidades, versión, revisión y destinos inválidos comprueban el rechazo antes de reenrutar. GitHub aplica su política de red propia. |
| `coding.integration.ts`, `jobs.integration.ts`, `automations.spec.ts` | Cancelación antes y durante ejecución, cierre del proceso, reinicio, lease, revocación y persistencia en SQL. La prueba P26 guarda la cancelación entre la selección y la admisión de una etapa y verifica que termine cancelada sin trabajo hijo. Los casos P20/P21/P24 comprueban incompatibilidad y ausencia de fallback API. |
| `review.integration.ts` · actualización desde migración 009 | Crea proyecto, chat, trabajo Codex sin identificador de motor y revisión antes de migrar. Los lee con la API actual y valida que otra cuenta reciba 404. |
| `team-execution.spec.ts`, `context-packs.spec.ts`, `memory.spec.ts`, `local-coding.spec.ts`, `recipes.spec.ts` | Operaciones en Chromium con recarga, teclado, móvil, error y permisos. El historial y los borradores se comprueban en sus pantallas. |
| `npm run release:check` | Candidato compilado, carga concurrente y recuperación sobre volúmenes nuevos. Conserva catálogo, registros SQL y punto Qdrant ligado a su recibo. [Procedimiento de release](../../deployment.md). |

El borrador de una etapa secuencial es evidencia local. La publicación de resultados de varios escritores usa la integración verificada de P17 y su revisión agregada. La receta `pr-draft` de P15 prepara texto desde un informe individual.

## Aceptación externa opcional

La matriz de abajo define pruebas separadas y sus efectos. Antes de cada prueba, registra proyecto y commit sintéticos, versión fijada, identificador y revisión exactos del modelo o servicio, equipo anfitrión y recursos asignados, destino de datos, límite monetario máximo y responsable. Los identificadores reales y el hardware quedan por elegir con el operador. La primera ejecución usa un solo caso pequeño y una revisión humana final.

| Prueba pendiente | Modelo, hardware y destino | Presupuesto y efecto por autorizar | Evidencia exigida |
|---|---|---|---|
| Equipo Codex API y mapa de evidencias | Modelo admitido por el catálogo API, CLI fijada y Docker en anfitrión de prueba. Pasarela Responses del proyecto API autorizado. | Un equipo de hasta diez peticiones o un mapa de solo lectura de hasta cuatro. Fijar tope monetario y aprobar el envío del snapshot sintético. Guardar diff y borrador local. | Entrega, pruebas independientes, recibos, revisión manual y uso efectivamente reportado. |
| Especialista y equipo Ollama | Un modelo de texto P19 y un modelo P20 con herramientas, instalados y fijados por digest. Anotar CPU, RAM y GPU/VRAM si se usa, versión Ollama y destino privado. | Un caso por motor, hasta diez peticiones y 120 s por equipo dentro del presupuesto local. Autorizar cómputo y acceso a las referencias locales. | Red observada, trazas de herramientas, evidencia independiente, cancelación y recursos medidos si están disponibles. |
| Comparación API/local | Mismos commit, tarea, herramientas y criterios con los modelos y equipos anotados arriba. | Dos ejecuciones acotadas. Transferencia explícita por etapa si se verifica un plan mixto. El límite monetario se acuerda antes de usar API. | Comparación reproducible con resultados, fallos, recursos realmente medidos y datos ausentes. |
| Aprendizaje a partir de una corrección | Caso P13 de una tarea sintética con grader fijado y proveedor/modelo aprobados en la comparación anterior. | Una referencia y una ejecución corregida dentro del tope elegido para P13. Autorizar la adopción reversible de la lección en ese proyecto. | Diferencia de resultados comprobada, evidencia vigente, decisión humana y reversión registrada. La evolución evaluada de skills requiere completar primero su flujo. |
| GitHub App y reconciliación | Instalación de prueba con permisos mínimos sobre un repositorio sintético y rama aislada. Sin modelo para el ensayo de publicación. | Autorizar por separado lectura, un issue y una PR en el destino de prueba. Presupuesto de inferencia cero para esos efectos. | Identificadores remotos, deduplicación tras respuesta perdida y revocación comprobada. |
| Importar el ZIP P22 | Cliente Codex de versión anotada, perfil y proyecto desechables. Validar TOML, Markdown y descriptor del workflow. | Autorizar la importación de metadatos. Presupuesto de inferencia cero para validar archivos. | Carga de cada recurso y diagnóstico del cliente, con revisión de permisos conservada. |
| Conectores externos y publicación de contenido | Para cada ficha pendiente, fijar adaptador, versión, cuenta sandbox, permisos mínimos, payload y destino. | Aprobar una operación y su límite de coste por separado. Cualquier envío, compra, firma o publicación requiere consentimiento explícito. | Registro del único efecto esperado, reintento idempotente, revocación y aislamiento de secretos. |
| Operación permanente o conector remoto del PC | Host dedicado y medios cifrados para recuperación off-host. Para el PC, el diseño del conector saliente requiere implementación y aceptación propias. | Autorizar infraestructura, almacenamiento, tráfico y ventana de restauración por separado. Probar en un destino vacío. | Recuperación fuera del host con tiempos medidos y permisos operativos, o trazas de identidad, revocación y cuotas del conector cuando exista. |
