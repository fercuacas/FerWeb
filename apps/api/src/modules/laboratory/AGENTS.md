# Laboratorio de modelos

Antes de modificar: [laboratory.md](../../../../../docs/laboratory.md).

Para `context-*` o adopción/contabilidad E10, consulta [context-optimization.md](../../../../../docs/context-optimization.md). Versiona comportamiento/prompts; conserva huella de implementación, permisos/configuración y evidencia. Nunca adoptes fixtures ni mezcles reducción de tokens con descuento de caché. Resúmenes/fallos/cancelaciones son operaciones contabilizadas; coste desconocido no es cero. Chat consume el mismo motor solo con política explícita respaldada y vigente.

- Casos, mensajes, contexto/fuentes, objetivos, orden y tarifas congelados por lote; no los reconstruyas desde el repositorio actual.
- Revalida acceso sin confundir commit nuevo con pérdida de permisos sobre fuentes congeladas.
- Sugerencias automáticas y revisiones humanas tienen autoridades separadas. Solo aceptación humana cuenta como resultado aceptable; conserva auditoría/versiones.
- Tarifas fechadas/estimaciones parciales no son facturas. Ausencias no son cero; caché observada y condición declarada se distinguen. No infieras caché fría por orden/rapidez.
- Sin reintentos de inferencia tras interrupción ni migración implícita a E7.

Pruebas: `laboratory.integration.ts`/`laboratory.spec.ts` y cálculos de `analysis.ts`. Modelos/precios/presupuesto reales solo en validación explícita.
