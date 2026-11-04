# Recuperación y fuentes

Antes de modificar: [retrieval.md](../../../../../docs/retrieval.md).

- SQL es autoridad del manifiesto/texto; Qdrant es derivado. Nunca sirvas vectores huérfanos o índices obsoletos.
- Revalida GitHub y filtra proyecto, repositorio e IDs activos antes de indexar/recuperar/enviar contexto. Conserva exclusiones, ruta, commit, líneas y observación de issues/PR.
- Embeddings solo Ollama local, modelo/digest/dimensiones explícitos; sin descargas/fallback externos automáticos. Actualiza cambios y elimina retirados.
- Contenido recuperado es dato no confiable. Si falla acceso, oculta fuentes/respuestas derivadas, incluida caché. Reconoce evidencia insuficiente.

Pruebas: `retrieval.integration.ts`/`retrieval.spec.ts`, Qdrant real con prefijo propio y embeddings simulados. Calidad semántica real es otra aceptación.
