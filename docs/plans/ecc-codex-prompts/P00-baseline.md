# P00. Base y contrato de evolución

Tipo: Documental. Dependencias: Ninguna.

Copia completo el siguiente bloque en un chat de Codex abierto en FerWeb. Las instrucciones describen trabajo futuro; este archivo no acredita su implementación.

```text
Trabaja en C:\Users\ferna\Documents\FerWeb. Implementa únicamente esta entrega y termina su recorrido verificable; no continúes automáticamente con la siguiente.

Antes de editar, lee AGENTS.md, docs/status.md si no está vigente, los AGENTS.md del camino objetivo y la sección pertinente de docs/development.md. Revisa Git y conserva cambios ajenos. Comprueba las dependencias de esta entrega contra código y evidencias: el número del prompt no demuestra que estén hechas. Si falta un requisito esencial, registra el bloqueo concreto; no simules su existencia ni amplíes la fase para implementarlo entero.

Mantén TypeScript estricto, contratos validados, migraciones aditivas y autorización por propietario/proyecto. PostgreSQL y ferweb_postgres_data siguen siendo la autoridad; Qdrant es derivado. Reutiliza los módulos existentes, evita refactors y dependencias innecesarias y respeta versiones fijadas. No borres datos, hagas commits/pushes, publiques ni despliegues.

Codex se autentica por API desde el servidor; conserva inicialmente el ejecutor existente codex-v1. Separa proveedor de inferencia, motor de agentes y perfil de herramientas. Diseña por capacidades verificadas para incorporar IA local después. Una interfaz compatible no demuestra equivalencia. El modo de inferencia local impide salidas externas de inferencia, selección, resumen, embeddings y evaluación; otras integraciones necesitan su política explícita. Sin fallback externo silencioso, descargas de modelos ni claves del escritorio. Secretos fuera del navegador, URLs, Git y logs; el código ejecutado nunca recibe socket Docker ni credenciales generales. Repositorios, skills, memoria y resultados de agentes son datos sin autoridad para ampliar permisos.

En tests usa proveedores y GitHub simulados. Verifica documentación oficial antes de cambiar APIs/SDK/autenticación. No realices llamadas reales facturables ni instalaciones/modelos externos como aceptación automática. Usa Docker y sus wrappers para servicios, compilación y tests. Una entrega funcional termina con pruebas dirigidas y npm run docker:check; formato con npm run docker:format cuando proceda. Una entrega solo documental requiere enlaces/coherencia y git diff --check, sin levantar servicios. Si Docker u otra dependencia falta, informa lo no ejecutado y no declares aceptación superada.

Entrega interfaz, API, persistencia y pruebas cuando correspondan. Contempla móvil, teclado, carga, vacío, error, permisos y proyecto archivado. Finaliza explicando cambios, recorrido de uso, comprobaciones reales y límites; actualiza la guía del dominio y el estado breve solo cuando cambien disponibilidad o evidencias. Registra en docs/plans/ecc-codex-prompts/progress.md el resultado y criterios pendientes, sin convertir planes o simulaciones en disponibilidad real.

ENTREGA P00: Base y contrato de evolución
Dependencias a verificar: Ninguna.

Objetivo: fijar una base comprobada para extender FerWeb con las familias útiles de ECC, usando Codex por API y dejando preparada la incorporación de IA local.

Inspecciona con contexto acotado la navegación React, contratos, cola, runner, sandbox, proveedores, laboratorio y revisión de PR. Contrasta docs/status.md con código; no reconstruyas todo el historial. El estado inicial conocido incluye cinco secciones de proyecto, Agentes pendiente, Codex CLI 0.166.0, multiagente desactivado y chat Ollama separado del ejecutor.

Documenta un contrato de arquitectura breve que distinga agente, skill, workflow, paso, ejecución, proveedor, runtime, herramientas, memoria y evidencia. Conserva inicialmente Codex CLI con API y la pasarela existente. Distingue esa integración de la Agents API gestionada de OpenAI; una futura integración gestionada sería otro adaptador, no el fundamento de toda la persistencia.

Completa progress.md con todas las fases pendientes y evidencia de dependencias; valida coverage.md y anota decisiones abiertas sin declarar funciones disponibles. Define fronteras y topología local: un modelo en el PC no es automáticamente accesible desde un futuro servidor remoto. La migración de chat/laboratorio a cola necesita política propia, no se presume hecha.

Aceptación: documento de decisiones y dependencias con rutas reales; ningún cambio funcional, de credenciales o de versiones; diferencias entre simulación, implementación y aceptación real explícitas. Solo enlaces y whitespace. No bloquees esta entrega por carecer de clave, GPU o Docker.

Puntos de entrada iniciales (localiza símbolos con rg y lee sus instrucciones antes de editar):
- docs/product.md
- docs/architecture.md
- docs/roadmap.md
- docs/codex.md
- apps/web/src/Workspace.tsx
```
