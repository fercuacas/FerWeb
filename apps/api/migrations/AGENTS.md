# Migraciones PostgreSQL

- Añade una migración numerada tras la última. No edites/renombres SQL aplicado: el runner valida checksums e historial.
- Mantén autoridad SQL, referencias de proyecto/propietario y datos existentes. No borres/recrees la base para hacer pasar una migración.
- Actualiza contratos/casos de uso y expectativas de descubrimiento. Consulta el módulo afectado y `src/migrations.ts`/`src/health.ts` según el cambio.
- Verifica aplicación repetida/concurrente, rollback y compatibilidad sobre base desechable: `database.integration.ts`, `migrations.test.ts`. La instancia activa se migra con el flujo Docker; respaldos en [docker.md](../../../docs/docker.md).
