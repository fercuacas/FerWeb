# P08. Revisión por dimensiones y verificación

Tipo: Funcional. Dependencias: P07.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P08: Revisión por dimensiones y verificación
Dependencias a verificar: P07.

Objetivo: obtener hallazgos accionables de varios revisores sobre el mismo diff congelado.

Implementa un workflow con revisor de corrección, especialista del stack y seguridad/pruebas según alcance. Valida sus salidas: ubicación, evidencia, desencadenante, impacto y severidad. Elimina duplicados conservando procedencia y discrepancias; no agregues por títulos libres únicamente.

Verifica adicionalmente hallazgos graves con evidencia independiente. Diferencia confirmado, refutado y no verificable. Si falla un revisor o verificador, conserva revisión incompleta/bloqueo pertinente; no lo conviertas en aprobado. Usa bucles de corrección limitados por P04 y número de iteraciones, sin modificar criterios para pasar.

Integra el resultado en CodingReview junto al informe original, vinculando todo al hash del diff, tarea, herramientas y versiones de revisores. Cambiar el diff invalida las revisiones. La aprobación humana y Publicar PR siguen siendo pasos independientes; no autorices commits o merges desde la coincidencia entre modelos.

Aceptación: deduplicar casos de fixture, conservar fallos de dimensiones y hallazgos no verificados, invalidar revisiones al cambiar artefactos y negar lecturas ajenas. Las pruebas distinguen evidencia del controlador de afirmaciones del agente. Conserva el recorrido individual de E9.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- apps/web/src/CodingReview.tsx
- apps/api/src/modules/jobs/review-service.ts
- apps/api/src/modules/jobs/review-artifacts.ts
- packages/contracts/src/review.ts
```
