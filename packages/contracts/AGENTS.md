# Contratos compartidos

Esquemas Zod/tipos de `@ferweb/contracts`. Localiza con `rg` productores/consumidores en API/web y, si aplica, Python/runner antes de cambiar un esquema.

- Entradas estrictas; conserva versiones, idempotencia y autorización. No hagas opcional un campo para encubrir un error del servidor.
- Ausencias nullable/desconocidas, no cero. Mantén discriminantes y separación entre simulación, observación y estimación.
- Sin credenciales, generación de control o roles/historial arbitrarios en DTO públicos.
- Cambios persistentes necesitan migración/pruebas en consumidores. Recompila contratos primero; no edites `dist/`.

Consulta solo la guía del dominio afectado; comandos en [desarrollo](../../docs/development.md).
