# Contexto del repositorio y fuentes (E5)

P10 añade [catálogo léxico/híbrido, mapa y recibos por rol](context-packs.md) sobre estas mismas fuentes. El recorrido vectorial E5 sigue disponible.

FerWeb permite indexar el snapshot autorizado del repositorio conectado y recuperar fragmentos de código, documentación, incidencias y pull requests. En **Conversaciones → Contexto del repositorio**, actualizar el índice, probar una pregunta y activar **Usar contexto del repositorio** al enviar un mensaje. Primero debe haberse sincronizado GitHub. No se indexa ni se envía contenido automáticamente al entrar en un proyecto.

## Configuración y política de datos

Qdrant **1.20.0**, versión estable comprobada en las publicaciones oficiales, se ejecuta en Compose sin puertos publicados y con volumen `ferweb_qdrant_data`. No recibe claves GitHub/OpenAI ni el socket Docker. Su salud consulta `/readyz`; la telemetría está deshabilitada. La base PostgreSQL sigue siendo la autoridad; el volumen Qdrant contiene una caché derivada recuperable.

Los embeddings usan exclusivamente **Ollama local**, independientemente del proveedor elegido para generar respuestas. No hay adaptador de embeddings externo, descarga automática de modelos ni fallback. En el JSON privado descrito en [ai.md](ai.md), añadir:

```json
{
  "embeddingModel": "NOMBRE_EXACTO_DEL_MODELO_LOCAL_DE_EMBEDDINGS",
  "embeddingDimensions": 768
}
```

Son campos adicionales del archivo completo, no un reemplazo de la configuración existente. Las dimensiones deben ser las dimensiones nativas reales del modelo seleccionado; 768 es solo el valor inicial de configuración. No se recomienda ni descarga un modelo concreto. Ollama debe anunciar capacidad `embedding`, digest y ejecución local; mantener `OLLAMA_NO_CLOUD=1` como explica [ai.md](ai.md). Reiniciar con `npm run docker:restart` tras editar el JSON ya montado. Sin modelo configurado, el chat normal sigue funcionando y la indexación comunica que faltan embeddings.

El servicio Python consulta `/api/tags` y `/api/show`, usa `/api/embed` con `truncate:false`, valida número, dimensiones y valores finitos de los vectores y vuelve a observar el digest después de calcularlos. La identidad del espacio incluye proveedor, modelo, digest observado, dimensiones y versión del fragmentador. Un cambio exige actualizar el índice; no se comparan vectores de modelos distintos. El digest observado no prueba criptográficamente los pesos ejecutados por el servidor remoto local.

Activar contexto en una conversación OpenAI **envía a OpenAI los fragmentos seleccionados**; la interfaz lo advierte. En una conversación Ollama, tanto embeddings como generación permanecen en los servidores locales configurados. La conexión GitHub sigue siendo externa para obtener las fuentes en ambos casos. No hay evaluador externo automático.

## Datos, actualización y publicación

- Migración 005: `repository_indexes`, `repository_documents`, `repository_chunks`; cada fragmento se une a proyecto, repositorio, ruta, tipo, líneas y commit. El turno guarda las fuentes exactas enviadas, sus extractos y la condición de recuperación.
- Los archivos se leen por SHA del blob del snapshot; solo los blobs de archivos regulares permitidos. Una lista explícita de extensiones de texto incluye código, Markdown, SQL, configuración y Dockerfile. Se aplican las exclusiones E3 y además dependencias, compilados, credenciales conocidas, configuraciones privadas y lockfiles. No se siguen symlinks/submódulos ni se ejecuta contenido. Estas reglas no constituyen un detector de secretos dentro de archivos ordinarios.
- Ventanas deterministas de hasta 2400 caracteres, conservando referencia a líneas; las líneas demasiado largas se dividen. No hay análisis AST ni estimación de tokens en E5.
- Huella por SHA de archivo; incidencias/PR por título, cuerpo, estado y fecha de actualización. Los documentos sin cambios conservan filas, fragmentos y vectores. Solo cambian metadatos de procedencia al avanzar el snapshot. Los archivos no modificados no se descargan de nuevo. Los puntos desaparecidos de Qdrant se reparan desde las fuentes al actualizar el índice.
- En Qdrant, cada punto guarda proyecto, repositorio, ruta y **commit en el momento de calcular el embedding**; PostgreSQL conserva el commit del snapshot actual para ese contenido y es la autoridad de la cita. El texto no se duplica en los payloads vectoriales.
- Incidencias/PR conservan el commit del snapshot del repositorio y su fecha de observación. Su cuerpo no está versionado por ese commit; se indica en las fuentes y no se presenta como una reconstrucción histórica de GitHub.
- Se preparan los vectores con IDs deterministas e inmutables. Un lock asesor SQL excluye dos actualizaciones del mismo proyecto. Se revalidan permisos y snapshot antes de publicar transaccionalmente el manifiesto SQL. Un fallo mantiene el índice anterior; el conjunto solo se sirve si coincide con el vínculo actual. No existe una transacción distribuida PostgreSQL/Qdrant.
- Tras publicar se eliminan puntos retirados de ese proyecto; `cleanupPending` indica fallo en esa limpieza, sin invalidar la autoridad SQL. Una interrupción antes de publicar puede dejar vectores huérfanos no recuperables desde FerWeb; otra actualización del mismo espacio los elimina. Un cambio de modelo limpia el espacio anterior de ese proyecto cuando es posible.
- Revocar o reemplazar el vínculo elimina el índice SQL y sus fragmentos mediante cascadas/trigger. Los vectores derivados no se borran sincrónicamente al recibir un webhook: quedan inaccesibles porque las búsquedas requieren IDs activos de SQL, proyecto y repositorio. Los payloads huérfanos pueden conservar rutas y el commit; no se promete borrado físico inmediato. No eliminar el volumen como prueba rutinaria.

Límites: hasta 200 documentos, 100 fragmentos por documento, 3000 fragmentos por proyecto, 200 000 caracteres por documento y 2 MB de contenido nuevo descargado por actualización. Un límite global rechaza la actualización completa; archivos no compatibles se enumeran como omitidos. El snapshot puede ser parcial por límites de E3: se conserva y muestra esa condición. Indexación manual en la petición, sin cola/reanudación; plazo cooperativo de diez minutos entre documentos y timeouts por operación. Cerrar la página no cancela necesariamente esa actualización. La cola E7 solo ejecuta simulaciones: esta ingesta todavía no se ha migrado a ella.

## Recuperación y permisos

Cada consulta revalida la intersección usuario/App/instalación y la propiedad del proyecto. Qdrant filtra obligatoriamente proyecto, repositorio e IDs de fragmentos activos de PostgreSQL. El texto y la procedencia se cargan de SQL, nunca se aceptan como autoridad desde un payload vectorial. Se revisan las exclusiones antes de recuperar y se revalida el vínculo tras la búsqueda.

Un webhook que marca el snapshot obsoleto bloquea nuevas recuperaciones. Tras **Sincronizar ahora** en GitHub hay que **Actualizar índice de contexto**; incluso si el commit no cambió, las incidencias pueden haber cambiado. Una consulta no vuelve a indexar ni descarga automáticamente archivos.

Para el chat se recuperan hasta cinco fragmentos entre doce candidatos, distancia coseno y umbral inicial 0,25. Es una heurística de selección, **no una probabilidad de respuesta correcta**; su calibración semántica con modelos reales sigue pendiente. No hay reranking ni búsqueda híbrida en esta entrega.

El servidor introduce reglas estáticas en el rol de sistema. Los fragmentos se serializan como JSON en un mensaje de usuario separado; no pueden crear roles, herramientas, permisos ni instrucciones del sistema. Se pide citar `[F1]` y reconocer falta de evidencia. El modelo no tiene herramientas para ejecutar las órdenes que pudiera contener un documento. El prompting reduce confusión, pero no demuestra resistencia universal de un modelo real a prompt injection.

Si no hay fuentes por encima del umbral, el servidor responde explícitamente **«No dispongo de información suficiente…»** sin llamar a la generación y sin inventar consumo. Si hay fuentes pero no bastan, las reglas solicitan abstenerse al modelo; esa parte requiere aceptación cualitativa con el modelo elegido. La web muestra los fragmentos suministrados como fuentes, no afirma que cada frase generada esté verificada ni convierte citas inventadas por el modelo en enlaces de confianza.

Los turnos previos con fuentes no se reenvían como historial: cada pregunta con contexto recupera evidencia actual. Los turnos normales completos de esa conversación sí se conservan en el contexto. Proveedor/modelo siguen siendo inmutables. En lectura de historial, cancelación y finalización se revalidan las fuentes; si no se puede confirmar acceso, se ocultan **extractos y respuesta derivada**. Durante streaming se comprueba revocación/snapshot local con cada checkpoint y heartbeat; no hay forma de retirar texto ya recibido antes de una revocación.

## Contrato HTTP

Todos exigen sesión y autorización por proyecto; mutaciones mantienen Origin/cabecera/JSON:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/projects/:projectId/context` | Disponible/obsoleto, commit, fecha, recuentos, omisiones y cobertura parcial. |
| `POST /api/projects/:projectId/context/index` `{}` | Actualización incremental; añade `embeddedChunks`, `reusedDocuments`, `cleanupPending`. Proyecto archivado: 409. |
| `POST /api/projects/:projectId/context/search` `{query}` | Hasta cinco fuentes, `insufficient`; pregunta de 1–4000 caracteres. |
| `POST …/conversations/:conversationId/turns` | Añade `repositoryContext` opcional, false por defecto. Pregunta con contexto: máximo 4000 caracteres. |

Turnos: `sources` y `grounding` (`disabled`, `retrieved`, `insufficient`; `unavailable` al ocultar lectura). Cada fuente incluye proyecto, repositorio, ruta, commit, versión del vínculo, tipo, líneas, fecha observada, score y extracto. Errores saneados: `context_stale` 409, `index_active` 409, `index_limit` 422, `embedding_unavailable`/`vector_unavailable` 503. No se cambia el catálogo de generación por configurar embeddings.

## Evaluación

E10 reutiliza estas preguntas y el índice para comparar estrategias sobre un corpus común, con captura autorizada de la referencia amplia, embedding de consulta contabilizado y panel antes/después. Los fragmentos sin búsqueda llevan similitud desconocida (`score=null`), sin inventar una puntuación. La ingesta previa no se presenta como un coste gratuito ni como ahorro medido. [Protocolo de evaluación/adopción](context-optimization.md).

[Preguntas y respuestas/fuentes esperadas](../tests/fixtures/retrieval-evaluation.json) usa un corpus sintético con autenticación, Docker, tareas, incidencias y una pregunta sin respuesta. `retrieval.integration.ts` ejecuta búsqueda contra Qdrant y PostgreSQL reales con embeddings deterministas del servicio Python de pruebas. Comprueba fuente en primera posición, ausencia de evidencia, actualización selectiva, eliminación, exclusiones, proyecto ajeno, mismo repositorio en dos proyectos, indexación fallida y permisos retirados. Las pruebas de navegador recorren indexación, búsqueda, chat con fuentes, persistencia y móvil.

Estos resultados verifican integración y filtros con vectores de prueba; **no miden calidad semántica de un modelo real**. Las aceptaciones explícitas pendientes requieren el repositorio/App y el modelo local elegidos por el propietario. Ejecutar manualmente las cinco preguntas sobre un repositorio autorizado equivalente, revisar citas/respuesta, cambiar un archivo/incidencia y repetir. No se ejecutan llamadas reales como parte de `docker:check`, ni se descargan modelos. Guardar resultados reales separadamente de los fixtures.

Referencias oficiales consultadas: [Qdrant 1.20.0](https://github.com/qdrant/qdrant/releases/tag/v1.20.0), [consulta filtrada](https://api.qdrant.tech/api-reference/search/query-points), [upsert](https://api.qdrant.tech/api-reference/points/upsert-points), [eliminación por filtro](https://api.qdrant.tech/api-reference/points/delete-points), [embeddings Ollama](https://docs.ollama.com/api/embed), [jerarquía y delimitación de instrucciones OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering).
