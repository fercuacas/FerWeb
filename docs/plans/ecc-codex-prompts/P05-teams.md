# P05. Equipos y plantillas de workflow

Tipo: Funcional. Dependencias: P02, P03, P04.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P05: Equipos y plantillas de workflow
Dependencias a verificar: P02, P03, P04.

Objetivo: definir equipos y planes de trabajo versionados antes de ejecutarlos.

Implementa plantillas de equipo con roles/versiones, pasos, dependencias, criterios de salida, capacidades y un máximo explícito de iteraciones. Usa un DAG validado: rechaza ciclos, referencias ausentes y planes que excedan límites. Distingue tarea de producto, paso del plan y ejecución. La IA puede proponer un plan como datos, pero no introducir herramientas, rutas o permisos nuevos.

Incluye plantillas pequeñas: implementar y revisar; investigar y responder; revisar un diff. Clasifica el tamaño de la tarea para permitir un solo agente cuando un equipo no aporta valor. Añade preparación del plan desde Tareas/Trabajos y gestión de plantillas desde Agentes. Muestra destino de inferencia, etapas y presupuesto antes de lanzar.

Congela plan, versiones y criterios al crear una ejecución. Si existe una aprobación del plan, vincúlala a su hash/versión; cualquier cambio material la invalida. Implementa preparación y validación, sin mostrar un botón de ejecución funcional hasta P06.

Aceptación: crear plantilla → instanciar con una tarea → ver plan válido e inmutable; rechazo de DAG cíclico, roles incompatibles y elementos ajenos; edición de plantilla conserva planes anteriores. La interfaz diferencia preparado, aprobado y ejecutado.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/web/src/Workspace.tsx
- apps/web/src/Jobs.tsx
- apps/api/src/modules/projects
- apps/api/src/modules/jobs
- packages/contracts/src
```
