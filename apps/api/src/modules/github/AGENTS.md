# GitHub App

Antes de modificar: [github.md](../../../../../docs/github.md).

- OAuth/PKCE, estado de un uso ligado a sesión e intersección usuario/App/instalación. Un ID de instalación no acredita propiedad.
- Revalida acceso antes de servir snapshots/archivos guardados; revocación debe bloquearlos. Credenciales cifradas en backend, sin tokens en URLs de aplicación, DTO o logs.
- Código por commit/blob; issues/PR por observación. Conserva exclusiones, límites, versiones y generación frente a sincronizaciones obsoletas.
- Webhooks: firma sobre bytes originales y deduplicación transaccional por entrega/cuerpo. Publicación E9 solo mediante revisión aprobada y acción explícita; consulta [reviews.md](../../../../../docs/reviews.md) antes de cambiar escrituras/reconciliación. Sin merge ni force push.

Pruebas: `github.integration.ts`/`github.spec.ts`, transporte simulado. App real, webhook público y acciones remotas son aceptaciones separadas. Revisa recuperación/Codex si cambian permisos o procedencia.
