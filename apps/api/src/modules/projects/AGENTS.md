# Proyectos y tareas

Antes de modificar: [contratos E2](../../../../../docs/api.md).

- Propiedad inmutable derivada de sesión, comprobada por consulta/recurso. No aceptes propietario del cliente; recursos ajenos o mal asociados devuelven 404.
- Conserva versiones y conflictos, archivo reversible, tareas retenidas y lectura/cancelación autorizada de recursos existentes.
- Bloquea mutaciones incompatibles con archivo dentro de la transacción; archivar no es borrar.

Pruebas: `workspace.integration.ts` y `workspace.spec.ts`; añade consumidores de tareas/archivo si cambian contratos. Consulta esos módulos solo cuando exista impacto.
