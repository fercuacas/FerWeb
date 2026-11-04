# P24. Automatizaciones, recuperación y notificaciones

Tipo: Funcional. Dependencias: P06, P16, P21, P22.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P24: Automatizaciones, recuperación y notificaciones
Dependencias a verificar: P06, P16, P21, P22.

Objetivo: programar workflows persistentes y avisar de cambios relevantes sin duplicar efectos.

Implementa programaciones por proyecto con zona horaria explícita, próxima ejecución, límites y versiones congeladas. Usa PostgreSQL y el worker existente; no crees cron del anfitrión o automatizaciones del chat para sustituir la función del producto. Define política de ejecuciones omitidas, solapamiento, reinicio, pausa y cancelación, y prueba cambios de hora y repetición de eventos.

Una programación autoriza solo el workflow/versiones/efectos configurados. Un cambio material de permisos, destinos o contenido invalida la autorización necesaria. No reintentes código o escrituras externas inciertas automáticamente: reanuda supervisión o reconcilia según el contrato. Las programaciones locales no derivan a API si el modelo no está disponible.

Añade un centro de notificaciones dentro de FerWeb para finalización, fallo, bloqueo o acción requerida; un monitor permanece silencioso mientras no cambie un estado accionable. Usa IDs deterministas para deduplicar y enlaces autorizados al resultado. Correo/mensajería externa requiere conector y autorización específica y no se habilita por defecto.

Aceptación: reiniciar scheduler no duplica la ejecución; pausar evita nuevas admisiones; solapamiento/cupo se respetan; notificaciones no se repiten en cada sondeo. Tests con reloj controlado, SQL real y proveedores simulados, sin programar envíos reales.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/api/src/job-worker.ts
- apps/api/src/modules/jobs/queue.ts
- apps/web/src/Jobs.tsx
- apps/web/src/Workspace.tsx
- apps/api/migrations
```
