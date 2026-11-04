# P06. Ejecución duradera de un equipo secuencial

Tipo: Funcional. Dependencias: P04, P05.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P06: Ejecución duradera de un equipo secuencial
Dependencias a verificar: P04, P05.

Objetivo: ejecutar un equipo de extremo a extremo con un solo escritor y pasos secuenciales.

Amplía la cola PostgreSQL y el worker para persistir ejecución padre, pasos, dependencias, entregas y eventos. Usa el ejecutor Codex existente para pasos compatibles, con inyección de roles/skills revisados desde el servidor y el presupuesto P04. Conserva codex-v1 y sus informes antiguos; no actives delegación interna sin atribución/control.

Resuelve explícitamente la admisión padre/hijos: el coordinador duradero no debe ocupar el único slot de proyecto y bloquear sus pasos. Los pasos activos consumen los límites de ejecución. Una entrega incluye fuentes, hashes, resultado y dudas; el texto del agente no confirma por sí mismo pruebas o éxito.

Implementa cancelar padre → impedir nuevos pasos → detener el activo → conservar evidencias. La pérdida de worker no reejecuta código automáticamente; recupera la supervisión o termina con estado explícito según la política vigente. Revalida permisos y versiones entre pasos. No conviertas un bucle en reintento ilimitado.

Integra seguimiento en Trabajos y una acción desde una tarea. Aceptación: ejecutar fixture de equipo → ver plan y pasos → recargar → consultar mismo historial e informe; cubrir reinicio, cancelación, revocación, fallo del revisor y agotamiento de cupo. Tests con Codex/comandos reales y proveedor simulado, sin inferencia real.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/api/src/job-worker.ts
- apps/api/src/modules/jobs/queue.ts
- apps/api/src/modules/jobs/coding-executor.ts
- apps/runner/controller.mjs
- apps/web/src/Jobs.tsx
```
