# P07. Especialistas en paralelo y mensajes

Tipo: Funcional. Dependencias: P06.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P07: Especialistas en paralelo y mensajes
Dependencias a verificar: P06.

Objetivo: ejecutar investigaciones y revisiones independientes en paralelo, con control efectivo de acceso y concurrencia.

Añade fan-out/fan-in acotado y mensajes estructurados: handoff, consulta, respuesta, finalización y conflicto. Autentica remitente y destinatario por ejecución/proyecto; el texto de un mensaje no acredita identidad, permiso o procedencia. Usa cursor/eventos duraderos, deduplicación, límites de tamaño, cuota y destinatarios; no dependas de archivos de inbox del anfitrión.

Los especialistas de esta fase no escriben fuentes: impón snapshot de solo lectura y herramientas adecuadas desde el controlador. Un prompt o sandbox_mode dentro del rol no garantiza aislamiento. No habilites escritores paralelos ni subagentes anidados sin seguimiento. Un rol incompatible se rechaza antes de empezar.

Mantén el máximo global y el valor por proyecto existentes como defaults. Si permites paralelismo dentro de un equipo, usa un límite configurado explícito que cuente cada hijo contra el global y el presupuesto; prueba la configuración en entornos desechables sin aumentar silenciosamente producción. El coordinador reúne resultados completos y señala especialistas ausentes.

Aceptación: dos especialistas con fixture pueden producir resultados independientes y un resumen; intento de escritura falla por la frontera real; mensajes entre proyectos o de generaciones antiguas se rechazan; fallo/cancelación de un hijo no produce aprobación completa ni procesos huérfanos.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/api/src/modules/jobs
- apps/runner/controller.mjs
- apps/sandbox/agent.mjs
- apps/web/src/Jobs.tsx
- packages/contracts/src
```
