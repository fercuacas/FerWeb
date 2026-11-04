# Pruebas de API

Prioriza permisos, contratos, persistencia y fallos; no mocks que copien la implementación. Consulta reglas del módulo probado si cambia comportamiento.

- Bases aleatorias propias y limpieza en `finally`; nunca vacíes la aplicación o uses al propietario. Administrar bases con `database-admin.ts` y sus límites.
- Proveedores simulados; HTTP/SQL/contenedores reales cuando lo exige el caso. Sin llamadas externas automáticas ni aserciones relajadas para ocultar fallos.
- Fixtures IA compartidos secuenciales: conserva `--test-concurrency=1`. Reanuda/detén procesos de prueba y limpia recursos propios aun si falla una aserción.
- No imprimas secretos como valores esperados, regex, entorno o cuerpos de error.

Ejecuta primero la suite concreta. Preparación de imágenes/fixtures y comandos en [desarrollo](../../../docs/development.md).
