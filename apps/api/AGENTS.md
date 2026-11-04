# API Express / TypeScript

Ámbito: `apps/api/`. Consulta únicamente las instrucciones del módulo modificado y secciones pertinentes de sus guías; no archivos completos por rutina. `app.ts`/`workspace.ts` conectan routers; `server.ts` compone adaptadores/ciclo de vida. `job-worker.ts` es un proceso separado.

- TypeScript estricto, DTO Zod compartidos y entradas validadas. Autoriza proyecto/recurso en servidor antes de consultar proveedores.
- Separa rutas, casos de uso y adaptadores siguiendo el módulo existente, sin abstracciones genéricas sin uso. PostgreSQL es autoridad; identifica las cachés derivadas.
- Esquema mediante nuevas migraciones; no edites SQL ya aplicado. Reglas en `migrations/AGENTS.md`.
- Para contratos HTTP o seguridad transversal, lee [api.md](../../docs/api.md). Conserva errores sin secretos, límites, origen/JSON, sesiones y control de versiones.

Prueba permisos, persistencia, conflictos y fallos del módulo. Selección de suites en [desarrollo](../../docs/development.md); `test/` tiene instrucciones propias.
