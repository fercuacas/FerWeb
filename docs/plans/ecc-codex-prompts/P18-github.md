# P18. Épicas, dependencias y coordinación GitHub

Tipo: Funcional. Dependencias: P05, P08, P16.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P18: Épicas, dependencias y coordinación GitHub
Dependencias a verificar: P05, P08, P16.

Objetivo: vincular el trabajo de los equipos con issues/PR sin trasladar credenciales al agente.

Amplía la sincronización existente para relacionar épicas, tareas, dependencias y ejecuciones con identidad estable y procedencia. Implementa reclamación/propietario y bloqueos sin interpretar etiquetas o comentarios del repositorio como permisos. Define reconciliación ante cambios remotos y conserva qué estado pertenece a FerWeb y cuál a GitHub.

Usa la GitHub App y su cliente del servidor; no introduzcas gh autenticado ni tokens generales en sandbox. Las escrituras remotas deben declararse como acciones explícitas y quedar vinculadas al contenido/versiones que el usuario revisó. El flujo de publicación existente conserva hashes, aprobación, protección de base e idempotencia; no añadas merge, force push o borrado automático.

Integra la vista de dependencias en Tareas/GitHub y enlaces a ejecuciones. Un proyecto archivado o una revocación bloquea nuevas operaciones y lecturas sensibles según el contrato vigente. Las interrupciones con efecto remoto incierto requieren reconciliar, no crear otra issue/PR por defecto.

Aceptación: sincronización simulada repetida no duplica recursos ni pisa propiedad local; una dependencia bloqueada impide el paso; pérdida de respuesta tras escritura se recupera idempotentemente. Tests GitHub simulados y navegador; no publiques ni envíes comentarios reales durante esta entrega.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/api/src/modules/github
- apps/api/src/modules/projects
- apps/api/src/modules/jobs/review-service.ts
- apps/web/src/GitHub.tsx
- apps/web/src/Workspace.tsx
```
