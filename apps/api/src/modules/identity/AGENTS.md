# Identidad y sesiones

Antes de modificar: [contrato de identidad](../../../../../docs/api.md).

- Propietario por CLI; no añadas registro público, cuentas demo o cambios de contraseña como efecto de pruebas.
- Conserva scrypt con sal, sesión opaca con hash del token, expiración/revocación y cookie HttpOnly/SameSite. Sin credenciales/tokens en DTO o logs.
- Mantén origen/JSON, límite persistente de login y separación de identidad/caché privada del cliente.

Verifica login, logout, expiración/revocación e aislamiento con dos usuarios. Pruebas: `identity.test.ts`, `workspace.integration.ts` y recorridos de sesión de `workspace.spec.ts`.
