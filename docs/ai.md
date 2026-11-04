# Conversaciones e IA (E4)

Cada proyecto tiene una pestaña **Conversaciones**. El propietario puede crear conversaciones con título, proveedor, modelo disponible y límite de salida (1–4096 tokens), enviar mensajes, leer la respuesta incremental y cancelar. PostgreSQL conserva los mensajes, respuestas parciales, configuración y métricas. Un proyecto ajeno devuelve 404; uno archivado permite leer y cancelar, pero impide crear conversaciones o enviar mensajes nuevos.

El proveedor y el modelo son **inmutables por conversación**. Para cambiar hay que crear otra: un historial local no se envía a OpenAI como efecto de cambiar una selección. No hay fallback entre proveedores. E5 añade contexto GitHub explícito mediante embeddings locales y Qdrant: consulta [recuperación y fuentes](retrieval.md). Los turnos con fuentes no se reenvían como historial antiguo; cada pregunta recupera evidencia actual.

## Componentes

E10 añade `simulated` y `configurationRevision` al catálogo/descriptor de embeddings. El servicio real genera la revisión como HMAC de su configuración privada con el token interno; no expone claves. El fixture se identifica explícitamente como simulado. La API usa estos datos para invalidar estrategias y bloquear adopciones basadas en simulaciones; no amplía permisos ni añade parámetros de proveedor. [Contabilidad y contexto](context-optimization.md).

- React consulta catálogos e historial mediante la API autenticada. Usa un POST con SSE para cada envío y un POST separado para cancelar; las claves no llegan al navegador.
- Node/Express aplica propiedad por proyecto, valida el catálogo y crea el turno de forma transaccional antes de iniciar inferencia. PostgreSQL es la autoridad: `conversations` y `chat_turns`, migración 004. Cada envío incluye UUID y versión, tiene secuencia y solo puede haber un turno activo por conversación.
- `apps/ai` es un servicio Python 3.13.18, FastAPI 0.162.0, HTTPX 0.28.1 y Uvicorn 0.54.0. Las dependencias transitivas se fijan con hashes en `requirements.lock`; `pip install --require-hashes` comprueba la instalación.
- La interfaz `Provider` expone catálogo y un iterador asíncrono de eventos normalizados. Los adaptadores OpenAI y Ollama usan HTTP directamente, sin un framework de agentes ni una cola.
- El servicio Python solo se publica en la red Docker. Los endpoints internos de catálogo, generación y cancelación exigen un token compartido de servidor; `/health` no revela configuración. Node y Python reciben `AI_SERVICE_TOKEN`, generado por `npm run setup` sin imprimirlo. Este token no es una clave de OpenAI.

## Configuración privada

Copiar [ai-providers.example.json](ai-providers.example.json) a `secrets/ai-providers.json` (ignorado). Configurar únicamente los proveedores que se vayan a utilizar:

| Campo | Uso |
| --- | --- |
| `openaiApiKey` | Clave de OpenAI API; dejar vacía para deshabilitar el proveedor. No se reutilizan sesiones de ChatGPT ni credenciales de Codex. |
| `openaiModels` | Lista explícita de hasta 20 IDs de modelos de texto aprobados para Responses. FerWeb los cruza con el catálogo accesible a esa clave; no deduce compatibilidad con Responses solo por aparecer en `/v1/models`. |
| `ollamaUrl` | `http://host.docker.internal:11434` para Ollama en el anfitrión; también admite `localhost`, `127.0.0.1` y el nombre interno `ollama`. Dentro del contenedor `localhost` identifica al propio contenedor, no a Windows. |
| `ollamaModels` | Hasta 20 nombres de modelos locales ya instalados. Se cruzan con `/api/tags` y se comprueba `completion` en `/api/show`. No se descarga ningún modelo automáticamente. |

Sin archivo, ambos proveedores permanecen deshabilitados y la aplicación puede seguir gestionando proyectos, GitHub e historial. Para seleccionar otra ruta se admite `FERWEB_AI_CONFIG_FILE` en la terminal: debe estar en `secrets/`, `.local/` o fuera del repositorio. Otras rutas dentro del contexto de construcción se rechazan para evitar copiar claves a imágenes.

```powershell
npm run setup
npm run docker:up
```

El gestor detecta el archivo y añade `compose.ai.yaml`: **solo Python** recibe el JSON privado en un montaje de lectura. Ni Node ni los contenedores web o de pruebas reciben la clave OpenAI. Si se usa la CA pública local de AVG/proxy, `compose.ai-ca.yaml` permite verificar TLS también desde HTTPX. No se desactiva la validación de certificados. Los clientes HTTP de proveedores no heredan proxies del entorno.

Después de cambiar un archivo privado ya montado, ejecutar `npm run docker:restart` para volver a cargar la configuración. No pegar claves en formularios, URLs o comandos. El backend y Uvicorn no registran cuerpos, cabeceras de autorización ni errores crudos de los proveedores.

## Ollama del anfitrión desde Docker

1. Instalar Ollama en el anfitrión y preparar explícitamente un modelo que pueda ejecutar el equipo. Comprobar sus nombres con `ollama list`; esta entrega no elige ni descarga modelos ni confirma aceleración GPU.
2. Deshabilitar la nube de Ollama: establecer `OLLAMA_NO_CLOUD=1` o `"disable_ollama_cloud": true` en su `server.json`, y reiniciar Ollama. Es una condición del modo local. FerWeb rechaza nombres que contengan `cloud` y metadatos remotos conocidos, pero el operador debe configurar el servidor local para que tampoco derive llamadas a la nube por su cuenta.
3. Añadir el nombre exacto del modelo a `ollamaModels` y mantener `ollamaUrl` apuntando al anfitrión.
4. Docker Desktop resuelve `host.docker.internal`; Compose añade además `host-gateway` para Linux. En este equipo se ha comprobado la resolución DNS desde el contenedor, **no** una conexión a Ollama ni una inferencia real.
5. Si el servidor no acepta conexiones del puente Docker, configurar `OLLAMA_HOST` en Ollama para escuchar en la interfaz necesaria y reiniciarlo. Por ejemplo, `0.0.0.0:11434` escucha en todas las interfaces: limitar el acceso con el firewall a la red local/Docker requerida. Ollama no debe quedar expuesto públicamente. En Windows las variables se establecen en el entorno del usuario y se reinicia la aplicación de la bandeja; en Linux se configuran en el servicio correspondiente.

El navegador no contacta directamente con Ollama, por lo que no necesita CORS hacia ese puerto. El flujo es navegador → Node → Python → Ollama. No se monta el socket Docker ni se ejecuta código del repositorio. E5 mantiene los embeddings exclusivamente locales según [retrieval.md](retrieval.md); los evaluadores externos de E6 deberán seleccionarse explícitamente.

Referencias: [red de Docker Desktop](https://docs.docker.com/desktop/features/networking/), [configuración y nube de Ollama](https://docs.ollama.com/faq), [catálogo](https://docs.ollama.com/api/tags) y [capacidades de modelo](https://docs.ollama.com/api-reference/show-model-details).

## Streaming y cancelación

OpenAI usa `POST /v1/responses` con `stream: true`, `store: false` e historial explícito. Se procesan eventos de texto, rechazo, finalización, error e incompleto. No se usan respuestas en segundo plano. Su endpoint de cancelación remoto solo admite respuestas creadas con `background: true`, así que **no se invoca ese endpoint ni se afirma una cancelación remota confirmada**. Ollama usa `POST /api/chat`, NDJSON y `num_predict` como límite de salida.

Al cancelar, Node guarda la petición, avisa al servicio Python y aborta la conexión. Python interrumpe el iterador activo y cierra la conexión HTTP al proveedor; se conserva el texto recibido. La confirmación remota se guarda como `null` (desconocida): cerrar la conexión no demuestra que un proveedor haya dejado de procesar o facturar inmediatamente. Tampoco se descarga el modelo ni se detiene globalmente Ollama, lo que afectaría a otros trabajos.

Cerrar la pestaña o cambiar de conversación aborta la conexión de ese envío y solicita cancelar. El backend también revisa sesión y archivo del proyecto aproximadamente cada dos segundos y detiene una generación que pierda esas condiciones. Cancelar un turno finalizado es idempotente. Si la finalización y la cancelación coinciden, se conserva el resultado confirmado por la base y cualquier uso ya reportado.

Referencias: [streaming de Responses](https://developers.openai.com/api/docs/guides/streaming-responses), [cancelación de Responses](https://developers.openai.com/api/reference/python/resources/responses/methods/cancel) y [chat de Ollama](https://docs.ollama.com/api/chat).

## Persistencia, tiempos y uso

Un turno guarda proveedor/modelo solicitado, modelo reportado, configuración común (`maxOutputTokens`), IDs de turnos usados como contexto, revisión observada en catálogo, comienzo/finalización, primer texto y duración observados por Node, motivo final, errores normalizados y uso disponible. La revisión del catálogo Ollama es una observación previa de su tag/digest; no se presenta como una confirmación de los pesos ejecutados. OpenAI puede no comunicar revisión y se guarda desconocida.

- Los contadores no reportados son `null`, nunca cero. Un cero reportado sí se conserva.
- OpenAI: entrada, salida, total, caché y razonamiento cuando estén presentes en el evento final. No se inventan datos de un flujo que no termina.
- Ollama: `prompt_eval_count`, `eval_count` y duraciones total/carga/evaluación convertidas de nanosegundos a milisegundos. No se rellena un total que el proveedor no haya comunicado sumando otros campos.
- Coste: desconocido; E4 no aplica tarifas ni supone coste cero para modelos locales. Los precios y estimaciones pertenecen a E6.
- Tiempos de Node: tiempo desde la admisión del turno hasta el primer texto y hasta cerrar el procesamiento en API. Incluyen comunicación con Python y su validación, pero no el catálogo consultado antes de admitir el turno. Son observaciones de la API, distintas del tiempo reportado por el modelo.

Se conserva un checkpoint del parcial al avanzar el flujo y con heartbeat de dos segundos. Una finalización correcta guarda el texto íntegro antes de confirmarlo al navegador. Un cierre abrupto de proceso puede perder el fragmento posterior al último checkpoint. La lease dura 30 segundos: al consultar un historial con un turno abandonado se marca `interrupted`, conservando el parcial y los datos conocidos, sin inventar duración final ni volver a llamar al proveedor. Un apagado ordenado de API cierra sus generaciones activas. **No hay reanudación automática de inferencia ni cola durable en E4.**

Los errores previos a la admisión se muestran manteniendo el borrador. Los errores de generación se guardan con su respuesta parcial. No se reintenta automáticamente una llamada que podría generar coste. El UUID de envío, el control de versión y el índice de un turno activo evitan admitir dos veces el mismo envío o dos generaciones simultáneas en una conversación.

## Límites actuales

- Hasta 100 conversaciones por proyecto y 100 turnos por conversación; mensajes de usuario de hasta 12 000 caracteres y respuestas de hasta 100 000.
- El historial enviado se limita a 80 000 caracteres y solo incluye pares completos no vacíos. Los turnos cancelados, fallidos o incompletos permanecen visibles, pero no se añaden al siguiente contexto. FerWeb no recorta ese historial silenciosamente: al superar su límite solicita otra conversación. Cada modelo mantiene además su propia ventana/contexto y política; E4 no estima tokens de entrada ni demuestra retención completa en un Ollama real. Su configuración de contexto debe ajustarse y validarse según modelo y hardware.
- Sin herramientas, adjuntos, edición de historial ni ingestión automática GitHub. E5 permite RAG opt-in sobre texto UTF-8 según [retrieval.md](retrieval.md).
- Máximo de cuatro generaciones simultáneas en el servicio Python, timeout total de cinco minutos y límites de tamaño de cuerpo/eventos. El catálogo tiene un límite de 30 segundos.
- Un worker Python y una instancia habitual de API. El registro de cancelación inmediata está en memoria y la persistencia/lease en PostgreSQL; no escalar workers sin ampliar la coordinación de E7.

## Pruebas automáticas y validaciones reales

`npm run docker:check` ejecuta las pruebas Python con HTTPX MockTransport y levanta temporalmente `ai-test`, con un proveedor simulado inyectado desde `tests.fake_app`. Node, PostgreSQL y Chromium se ejecutan realmente contra ese servicio Python. El contenedor de prueba no recibe las claves privadas y se detiene/elimina al finalizar. El entrypoint habitual `ferweb_ai.main` no tiene un modo simulado configurable desde la web o el JSON privado.

Para una **única validación real explícita**, configurar primero el proveedor/modelo y ejecutar manualmente uno de estos comandos, sustituyendo el ID por el modelo elegido:

```powershell
docker compose exec -T ai python -m ferweb_ai.verify --provider ollama --model NOMBRE_LOCAL
docker compose exec -T ai python -m ferweb_ai.verify --provider openai --model ID_MODELO_PERMITIDO
```

Cada comando consulta el catálogo e inicia como máximo una generación, con un mensaje fijo y límite de 64 tokens de salida. No tiene reintentos, no guarda una conversación ni modifica datos del proyecto; muestra estado, tiempo y uso normalizado. La validación OpenAI puede generar coste. Este módulo no se importa al arrancar ni se ejecuta desde tests automáticos. También puede validarse manualmente la UI con una conversación de prueba y cancelación.

No se han ejecutado estas llamadas reales: quedan pendientes autorización OpenAI, conexión con Ollama real, capacidad del modelo/hardware y comprobación de cancelación/consumo reales. Estado y evidencias en [status.md](status.md).
