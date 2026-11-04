# Conversaciones e IA

Antes de modificar: [ai.md](../../../../../docs/ai.md). Python está en `apps/ai/`; consulta esa área solo si cambia protocolo/proveedor.

E10 aplica una política de contexto solo al proveedor/modelo/configuración evaluados. Motor/contabilidad en laboratorio `context-*`; [protocolo](../../../../../docs/context-optimization.md). Conserva preparación, historial permitido, fuentes finales, invalidación de evidencia y cancelación del UUID auxiliar. No ocultes métricas/prompts derivados al revocar solo la respuesta: oculta también `contextMetrics`.

- SQL es autoridad de turnos, contexto e idempotencia; conserva versiones, lease y checkpoints. Proveedor/modelo fijos por conversación.
- Contexto/historial en servidor, con permisos/exclusiones. No aceptes roles, claves o historial arbitrarios del cliente; sin fallback externo del modo local.
- Conserva streaming, parciales y cancelación del upstream; parada/facturación no confirmada es desconocida. Sin reintentos de inferencia tras interrupción.
- Uso ausente es `null`, no cero; tiempos observados separados del proveedor. La cola no reanuda automáticamente el chat.

Pruebas: `chat.integration.ts`/`chat.spec.ts` con `ai-test`; añade recuperación si cambian fuentes o historial con contexto.
