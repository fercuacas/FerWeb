# Cola, simulación y Codex

Lee [jobs.md](../../../../../docs/jobs.md) para cola/simulador. Para `coding-*` o `runner-client.ts`, añade [codex.md](../../../../../docs/codex.md) y reglas de `apps/runner/`/`apps/sandbox/` si cambian límites/protocolo.

Para `review-*`, comparación o repetición, consulta [reviews.md](../../../../../docs/reviews.md). Publicar requiere una acción explícita y aprobación ligada al informe; conserva rama/commit/PR ante fallos y reintentos, sin force push/merge. La repetición copia las condiciones congeladas y exige el mismo entorno real del ejecutor.

- SQL es autoridad. Conserva eventos/creación atómicos, generaciones de lease, checkpoints, idempotencia y reservas acumuladas. Recuperar no amplía plazo/presupuesto.
- Transacciones cortas sin red/procesos; conserva timeout de inactividad y descarte de conexión rota para no bloquear recuperación con un worker pausado.
- `simulation-v1` solo ejecuta el simulador de confianza, sin comandos del cliente. Código real va al controlador separado.
- `codex-v1` congela tarea/versión/commit; revalida GitHub antes/durante y al servir informes. Sin reintentos automáticos de código/llamadas facturables; token/generación internos nunca en navegador o input del repositorio.
- Cancelar alcanza proceso/contenedor. Parada no observada es desconocida; rechaza resultados de generaciones antiguas.

Pruebas: `jobs.integration.ts`; Codex: `coding.integration.ts`, `coding-boundaries.test.ts`, `coding.spec.ts`. Comprueba reinicios, SIGKILL/SIGSTOP, cupo, fallos y cancelación con recursos propios.
