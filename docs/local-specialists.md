# Especialistas locales de lectura (P19)

Este recorrido usa la vía nativa de Ollama para planificación, análisis y revisión de texto. Conserva el DAG de especialistas P07, planes aprobados por huella, presupuestos P04 y la cola SQL. El motor `local-readonly-v1` recibe extractos y entrega JSON. No usa la CLI Codex, shell, herramientas, un montaje escribible ni credenciales GitHub. La publicación y ejecución de código siguen sus recorridos existentes.

## Preparar y ejecutar

1. Configura la vía Ollama existente en el servidor siguiendo [ai.md](ai.md#ollama-del-anfitrión-desde-docker). Usa únicamente nombres de modelos ya instalados y permitidos. FerWeb consulta `/api/tags` y `/api/show`, exige capacidad de texto y revisión observada, y descarta nombres o metadatos de nube. No descarga modelos ni inicia un servidor nativo. Una dirección compatible con OpenAI no acredita inferencia local.
2. En **Agentes → Equipos y plantillas**, pulsa **Crear workflow local de lectura**. Crea tres roles explícitos de texto —planificación, revisión y resumen— y una plantilla. Su política `local-only` incluye la reunión final. Los workflows API existentes conservan Codex y sus perfiles; esta entrega permite modelos locales distintos por rol y no mezcla proveedores dentro del workflow local.
3. En **Tareas → Preparar y aprobar planes**, elige la tarea y **Especialistas locales de lectura**. Elige un modelo local permitido para cada rol. La vista previa muestra destino, requisitos, revisión observada y huella. Un rol que requiera shell, llamadas a herramientas, escritura o capacidades no confirmadas resulta incompatible; seleccionar un modelo local no rebaja esas exigencias.
4. Revisa y aprueba el plan. Inicia el equipo con el commit GitHub mostrado. Las etapas independientes preceden al resumen; cada etapa realiza una única generación. Las reservas, admisiones, límites y estados quedan en SQL. Un fallo del modelo, formato o compatibilidad cierra esa etapa y evita iniciar sus dependientes.
5. Abre la ejecución o el informe de una etapa. Consulta resumen, citas, límites, modelo solicitado/reportado, revisión observada, comprobaciones del servidor y uso disponible. **Validación local de formato y citas** significa que la estructura y referencias pasaron controles deterministas. No acredita corrección semántica, calidad de planificación, ejecución de comandos ni pruebas del repositorio. La valoración humana sigue siendo independiente.

El catálogo registra una observación del digest antes de inferir; no demuestra qué pesos ejecutó un alias que cambie durante la solicitud. El servidor comprueba de nuevo catálogo, configuración y revisión al iniciar y durante el trabajo. Si cambian, falla sin escoger otro modelo. El modelo reportado, cuando existe, se conserva por separado.

## Contexto y límites de confianza

Sin un paquete P10, un selector determinista ordena rutas de texto permitidas según la tarea y fija hasta ocho extractos de 4 000 caracteres, con ruta, SHA, huella, línea inicial y aviso de recorte. El resto del repositorio no está disponible para el modelo. Si faltan fuentes, la etapa falla; el modelo debe declarar evidencia insuficiente. No se promete que un modelo real retenga toda su ventana de contexto.

Los paquetes P10 opcionales usan su [mapa, selección, búsqueda y recibos](context-packs.md), con ejecución `local-readonly-v1`. Los embeddings siguen siendo Ollama local. La selección sin modelo y la comprobación de citas son reglas del servidor; la planificación, análisis y resumen son inferencias del modelo elegido. No se invocan el resumen cloud adoptado de E10, jueces externos ni otros proveedores como auxiliares o fallback de este recorrido. Skills, memoria, código y entregas anteriores son datos sin autoridad para ampliar permisos.

El límite del prompt es 100 000 caracteres y el de la salida recibida 24 000. La entrega admite un resumen, hasta veinte citas de líneas suministradas y limitaciones. Ollama recibe `format: json`, pero el servidor vuelve a validar el JSON y las citas exactas. Formato incorrecto, contenido excesivo, respuesta incompleta, cita inventada o modelo cambiado producen errores normalizados visibles. No se reparan mediante otra inferencia automática. Referencias oficiales: [chat nativo](https://docs.ollama.com/api/chat), [salidas estructuradas](https://docs.ollama.com/capabilities/structured-outputs) y [detalle y capacidades](https://docs.ollama.com/api-reference/show-model-details).

La política local afecta a la inferencia de este workflow, sus selecciones, embeddings y evaluación automática. GitHub continúa siendo una integración de red autorizada por separado: local no convierte toda FerWeb en una aplicación offline. El operador debe mantener Ollama como servicio de confianza con nube desactivada y exposición local controlada; ver [configuración y límites](ai.md). Los endpoints de inferencia los fija el servidor, se rechazan destinos arbitrarios y no se siguen redirecciones ni proxies del entorno.

## Persistencia, cancelación y acceso

La migración aditiva `027_local_readonly.sql` añade un tipo de trabajo y `local_read_runs`. Los trabajos comparten los límites de concurrencia, propiedad, archivo, leases, cancelación y presupuesto de la cola. Una solicitud admitida no vuelve a enviarse aunque se pierda su respuesta. La pérdida de worker o una interrupción no reintenta inferencia automáticamente; una repetición debe ser una decisión explícita con otra ejecución.

Cancelar o agotar el plazo aborta el consumidor y la conexión al servicio de IA. La parada remota de Ollama permanece desconocida: cerrar HTTP no prueba que el modelo haya dejado de procesar. No se descarga el modelo ni se detiene Ollama globalmente. Uso y coste ausentes son desconocidos; el presupuesto de solicitudes no es un precio ni un recuento estimado de tokens.

Los informes y paquetes revalidan la propiedad y el acceso a GitHub y sus fuentes. La revocación oculta contenido derivado; un proyecto archivado conserva lectura autorizada y bloquea nuevas preparaciones o ejecuciones. Las credenciales permanecen en API/Python. El worker local usa rutas internas autenticadas y nunca recibe credenciales generales del proveedor ni entrega socket Docker a contenido del repositorio.

API pública: `GET /projects/:id/local-read/capabilities` y `GET /projects/:id/local-read/:jobId`. Las plantillas y planes reutilizan las rutas de equipos; `inferenceMode: local-only`, `executionId: local-readonly-v1` y `stepModels` fijan política y modelos. El protocolo privado de generación añade `localStructured` y `expectedRevision`; no acepta endpoints ni herramientas del cliente.

## Aceptación real pendiente

Las pruebas automáticas utilizan Ollama, embeddings y GitHub simulados, con HTTP, PostgreSQL y cola reales. Prueban la frontera de inferencia local y fallos del protocolo; no acreditan velocidad, calidad, GPU ni funcionamiento con un modelo instalado en tu equipo.

Para una aceptación futura, registrar primero modelo y digest ya instalados, versión de Ollama, configuración de contexto, sistema operativo, CPU, RAM, GPU/VRAM si se usa y corpus no privado autorizado. Con esa información:

1. Ejecutar el mismo workflow de lectura con un caso conocido y límites pequeños; conservar las huellas, extractos y entregas de cada rol.
2. Comprobar en la red del servicio que catálogo, generación, embeddings y cualquier auxiliar permanecen locales. GitHub se audita por separado. Un modelo no compatible debe fallar sin fallback ni descargas.
3. Revisar citas y conclusiones humanas frente al corpus, incluida una tarea sin evidencia suficiente. El JSON válido no sustituye ese juicio.
4. Medir tiempos, uso reportado y memoria con el hardware real; conservar ausencias como desconocidas. No comparar directamente este motor de texto con Codex que dispone de herramientas y pruebas.
5. Probar cancelación, pérdida del servicio y revisión cambiada. Registrar qué parada se observó y qué sigue sin confirmación remota.

No se ha ejecutado esta aceptación real ni se ha elegido un modelo o hardware en nombre del usuario.
