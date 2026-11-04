# Controlador de confianza de Codex

Lee [codex.md](../../docs/codex.md). Si cambia protocolo/lifecycle, consulta `apps/api/src/modules/jobs/coding-executor.ts` y las instrucciones de ese módulo.

- Tiene autoridad Docker/clave del proveedor; nunca ejecuta código del repositorio en su proceso. Su API no es proxy genérico de Docker, rutas o comandos.
- Modelo, ruta Responses, cupos/cuerpo/salida y generación/lease se validan en servidor. Sin credenciales generales en input, imagen, logs o sandbox; no copies autenticación del escritorio.
- Conserva red `none`, identidad/recursos y supervisor independiente. Recolector separado con volumen en lectura y código pausado; diff contra textos congelados, no Git/salida del repositorio.
- Uso de pasarela/CLI tiene autoridades distintas; desconocido no es cero. Libera memoria tras confirmar SQL. Limpia solo recursos propios etiquetados, con namespaces Compose separados.
- E9 fija el ID de imagen y hash de política, registrados en SQL y verificados al iniciar. Conserva esta igualdad al repetir/comparar; un cambio de entorno debe bloquear condiciones antiguas, no ejecutarlas bajo la misma etiqueta.
- `test-server.mjs` no se selecciona desde producción. Prueba fronteras, integración y navegador Codex con Responses simulado; no acredita aislamiento hostil o aceptación externa.
