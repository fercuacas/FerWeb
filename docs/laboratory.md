# Laboratorio de comparación (E6)

E10 añade experimentos pareados de estrategias de contexto, contabilidad de auxiliares y adopción explícita condicionada a evidencia real: [gestión de contexto](context-optimization.md). Los límites/protocolo E6 siguientes siguen aplicándose a los lotes habituales.

En cada proyecto, abrir **Laboratorio**. El recorrido es guardar casos congelados, registrar tarifas si se conocen, preparar un lote con modelos y repeticiones, ejecutarlo, revisar respuestas y exportar JSON o CSV. Los proveedores usan la configuración privada de [ai.md](ai.md); las fuentes opcionales usan [retrieval.md](retrieval.md). Sin proveedores reales configurados se pueden preparar casos manuales y tarifas, pero no ejecutar modelos reales.

## Evaluación de agente único y equipo P13

Desde **Trabajos**, completa un trabajo Codex individual y un plan en modo equipo para la misma tarea y versión. Usa el mismo repositorio, commit, perfil, modelo, plazo y techo global de solicitudes, con concurrencia uno y 4096 tokens máximos de salida por solicitud, que es el límite de cada paso del equipo. Para aislar la coordinación usa el mismo material adicional de skills, memoria y contexto en ambos brazos. La asignación de solicitudes entre pasos y sus instrucciones forman parte de la intervención. Las ejecuciones fallidas y canceladas también se pueden seleccionar.

En **Laboratorio → Evaluar agente y equipo**, elige ambos trabajos. **Informes registrados** conserva el resultado sin pruebas secretas. **Fixture de suma v1** activa las sondas deterministas para el corpus CommonJS con `src/add.cjs` inicialmente defectuoso. El panel separa el verificador, las pruebas observadas del informe y las valoraciones humanas. Conserva pasos y rondas iniciadas, causas registradas, tiempo desde creación hasta cierre, llamadas admitidas y uso reportado por auxiliar. El coste y la cobertura de líneas quedan desconocidos. El recuento de sondas de la fixture expresa cobertura del caso, con las pruebas del repositorio listadas aparte.

La comparación registra diferencias de tarea, snapshot, herramientas, presupuesto, modelo, contexto y destino de inferencia. La evidencia antigua incompleta puede impedir la equivalencia. Cuando hay recibos P10 se comparan los extractos y material realmente preparados y se registra si el archivo objetivo aparece entre las fuentes de la fixture. El espacio de trabajo montado sigue disponible para Codex aunque una ruta falte en los extractos. La equivalencia de condiciones registradas permite interpretar ese par, sin controlar la variación de un alias remoto, la carga o las diferencias propias de la estrategia de equipo. El destino simulado se etiqueta en cada brazo.

El verificador adapta el diseño de corpus, sondas ocultas y control negativo/positivo de ECC con licencia MIT. El servicio de evaluación del servidor conserva los vectores y resultados esperados fuera del contenedor y verifica el candidato como datos con una gramática cerrada para la fixture. Comprueba la huella de entrada P12, el cierre de la CLI, los controles, el diff reconstruido y la cadena de entregas del equipo antes de dar un aprobado. El resultado depende de esas comprobaciones y de las sondas del servidor. Un artefacto incompleto, una expresión fuera de la gramática, un cambio fuera de `src/add.cjs` o una base que no falla producen evidencia sin verificar. El harness genérico de ECC mantiene deshabilitada la ejecución de candidatos. [Diseño del corpus](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/docker/context-profiles/complex-eval/DESIGN.md), [harness](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/eval-harness/gate.js), [licencia](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/LICENSE).

La migración 021 guarda el informe de cada par/caso con las huellas de evidencia y fixture y un historial versionado de valoraciones. **Repetir verificación** recalcula el resultado a partir de las ejecuciones registradas y exige la misma huella. **Exportar evaluación JSON** descarga referencias, condiciones, huellas, resultados y valoraciones. Los archivos del repositorio y los vectores de prueba permanecen en el servidor. Consulta, valoración y exportación revalidan el acceso a ambos orígenes. En proyectos archivados están disponibles consulta y exportación. Si las condiciones difieren, la valoración queda limitada a inconclusa. P13 utiliza un verificador local determinista. Los jueces LLM, el coste real y la validación con modelos externos quedan pendientes de una aceptación explícita. La evaluación está separada de E10 y de la promoción de memoria o skills.

## Casos y condiciones

Un caso inmutable conserva título, pregunta, contexto manual exacto, hasta cinco fuentes recuperadas por el servidor y entre uno y diez criterios. Cada fuente mantiene proyecto/repositorio/ruta/commit/líneas/observación. El caso tiene versión 1 y SHA-256 del contexto serializado; cambiar pregunta, contexto o criterios implica crear otro caso. Una fuente de incidencia/PR conserva su fecha de observación: el commit asociado no versiona su cuerpo en GitHub.

Al preparar el lote se copian casos y tarifas, modelo/proveedor, revisión de catálogo observada, configuración y declaración de caché de cada objetivo. No se actualizan al sincronizar GitHub ni al añadir otra tarifa. Se guardan los mensajes exactos, incluido el sistema, y su hash por caso; la ejecución usa esa copia, incluso después de reiniciar. Todos los modelos reciben esos mismos mensajes, sin historial de chats, sin nuevas búsquedas y **sin los criterios ni las respuestas esperadas**. La configuración común disponible es `maxOutputTokens`; no se añaden parámetros de muestreo cuya compatibilidad no esté declarada por ambos adaptadores. Los valores por defecto no controlados del proveedor siguen siendo una limitación de reproducibilidad.

Protocolo `ferweb-lab-v1`: orden secuencial repetición → caso → objetivo. Hasta cinco casos, cuatro objetivos, cinco repeticiones, **20 intentos totales**; cada intento tiene plazo de dos minutos y respuesta de hasta 20 000 caracteres. Se permiten objetivos con el mismo modelo y configuraciones distintas. Se registran entorno/hardware/carga/preparación declarados por el operador, no como telemetría medida. Cada objetivo conserva identidad propia para no mezclar configuraciones al resumir.

La revisión del catálogo se observa al preparar y antes de cada intento; si un digest conocido cambia, se registra error sin generar. Los alias con revisión desconocida no se presentan como pesos fijados. Se guardan modelo solicitado y modelo reportado, que pueden diferir. El orden, la carga de otros servicios, el hardware y los valores por defecto pueden afectar las medidas. Un lote pequeño no es una prueba de significación estadística ni de superioridad general de un modelo.

Igualdad de mensajes enviados no demuestra que cada proveedor retenga todo el contexto dentro de su ventana efectiva. Los límites y políticas del modelo/servidor deben comprobarse en la aceptación real; E6 no inventa tokens de entrada ni demuestra retención completa en hardware no validado.

## Ejecución, permisos y fallos

La migración 006 añade `lab_cases`, `lab_tariffs`, `lab_batches`, `lab_runs` y `lab_reviews`. PostgreSQL es la autoridad. No se añaden colas ni ejecutores nuevos: la API procesa un lote activo a la vez, con un índice SQL que impide dos lotes activos del mismo proyecto. Preparar no genera llamadas; **Ejecutar comparación** es la acción explícita. Seleccionar OpenAI exige confirmar que las preguntas/contextos se enviarán a esos modelos externos. No hay fallback de Ollama a OpenAI ni evaluador externo.

Cada intento guarda fechas, estado, parcial/respuesta, modelo reportado, revisión observada, métricas disponibles, coste estimado/motivo y comprobación automática. Los errores no se ocultan ni se reintentan. Ejecutar nuevamente el mismo lote no vuelve a generar; para otra serie hay que crear otro lote. La preparación usa un UUID único por proyecto y rechaza reutilizarlo con condiciones diferentes.

Las fuentes congeladas se revalidan antes de leer casos completos, preparar/ejecutar lotes, revisar o exportar resultados. Una sincronización nueva o un snapshot marcado obsoleto no cambia el contexto congelado, siempre que el vínculo siga al mismo repositorio y GitHub confirme permisos. Revocar, desvincular o cambiar de repositorio bloquea la lectura de las fuentes y resultados derivados. El listado de casos devuelve solo cabeceras aportadas por el usuario, hash y número de fuentes. No devuelve extractos ni contexto de repositorio sin revalidar. Los datos recuperados se serializan en un mensaje de usuario separado del sistema y no conceden herramientas ni permisos.

Heartbeat de dos segundos y lease de 30 segundos conservan parciales y detectan caída. Cancelar detiene la generación actual y omite los intentos pendientes; no descarga modelos ni limpia globalmente su caché. Cerrar la página no cancela el lote: permanece visible al volver. Se comprueba sesión, archivo y revocación local durante el trabajo, y acceso remoto antes de cada intento. Las validaciones remotas tienen sus propios plazos; cerrar una conexión no prueba cancelación/facturación remota. Un reinicio o lease vencida marca interrupción y omite pendientes, sin reanudar inferencia. E7 incorporará trabajos durables.

El proyecto archivado permite consultar/exportar y cancelar, pero no crear, ejecutar ni valorar. Todos los IDs se resuelven bajo proyecto y propietario; un recurso ajeno devuelve 404. Hasta 50 casos, 50 tarifas y 50 lotes por proyecto en esta entrega.

## Tiempos y consumo

- Primer texto: milisegundos desde el inicio del intento en Node hasta el primer delta de texto no vacío.
- Total: tiempo observado por Node hasta resolver el intento, incluidas validaciones de acceso/catálogo, comunicación y generación. No incluye espera entre intentos, preparación del lote ni descarga por el navegador. El guardado final se inicia después de medir; los checkpoints previos sí forman parte del tiempo observado.
- Duraciones de proveedor/carga/evaluación se conservan aparte. No son equivalentes a la latencia del producto.
- Entrada/salida/total/caché/razonamiento/coste reportado proceden del proveedor. Ausente significa `null`, no cero ni un total inventado. Tokens de distintos modelos pueden usar tokenizadores diferentes.

La interfaz presenta calidad revisada, errores, tamaños de muestra de latencia y coste/tiempo por resultado aceptable. No usa tokens por segundo para clasificar modelos.

## Caché observada y declarada

`cacheLabel` (`unspecified`, `cold`, `warm`) es una **declaración del operador**, no una medición ni una orden de vaciado. Se exporta por separado de `cacheObserved`:

| Dato reportado | Interpretación |
| --- | --- |
| `cachedTokens > 0` | `hit`: al menos parte del prompt se ha reutilizado; caché caliente en esa parte. |
| `cachedTokens = 0` | `no_hit`: sin acierto reportado; no demuestra servidor/modelo completamente frío. |
| Sin contador | `unknown`: no se deduce por orden de repetición, velocidad ni tiempo de carga. |

OpenAI se toma de `input_tokens_details.cached_tokens`; Ollama de `prompt_eval_cached_count` cuando lo comunica. `load_duration` se muestra pero no se transforma en una etiqueta de caché fría. No se hacen prewarmings ni peticiones extra ni se descarga el modelo para forzar un estado. Las comparaciones de frío/caliente requieren preparar condiciones explícitas y revisar la evidencia disponible.

## Tarifas y estimación parcial

Las tarifas son registros inmutables **introducidos y verificados por el operador**, con proveedor/modelo exactos, vigencia desde/hasta, fecha de verificación, fuente HTTPS y notas. No hay precios preinstalados ni consultas automáticas de precios. La moneda es USD; tres tasas por millón de tokens: entrada, entrada leída de caché y salida. Una tasa cero solo se usa si fue registrada explícitamente; no se supone electricidad/hardware gratuito para Ollama.

Para tokens de entrada `I`, caché `C` y salida `O` reportados:

```text
estimación de texto USD = ((I − C) × tarifaEntrada + C × tarifaCaché + O × tarifaSalida) / 1 000 000
```

Si falta entrada/salida o una tarifa vigente en la fecha UTC del intento, el importe es desconocido. Si falta caché y sus dos tasas difieren, también es desconocido. Contadores inconsistentes no producen un importe. El razonamiento no se suma otra vez a salida. Se conserva el coste reportado, si existe, separado del estimado.

**Alcance `text_tokens_only`: estimación parcial, no factura ni coste total.** No incluye escrituras/retención de caché con facturación adicional, herramientas, imágenes/audio, impuestos, descuentos por contrato o procesamiento, infraestructura, energía ni hardware. Los esquemas de un proveedor pueden superar esas tres tasas; las notas y la fuente de tarifa deben reflejarlo. Los nuevos esquemas requerirán ampliar la versión del estimador. La UI y la exportación identifican siempre ese alcance.

Por objetivo, se muestran el subtotal de costes conocidos y la cobertura de intentos con coste. El **coste estimado de texto por resultado aceptable** divide el coste de todos los intentos iniciados —incluidos fallidos— entre los aceptados por revisión humana. Si falta el coste de alguno, o no hay aceptados, el cociente es desconocido; no se divide solo la parte conocida. El tiempo por aceptable aplica la misma regla a los tiempos de intentos iniciados. Los intentos omitidos no se presentan como inferencias ejecutadas ni con consumo cero.

## Valoraciones revisables

`substring-v1` comprueba si el texto esperado aparece en la respuesta, ignorando mayúsculas; sin texto esperado el criterio automático es desconocido. Es una sugerencia provisional con versión de método, nunca una evaluación semántica ni aceptación final. No evalúa por sí mismo fidelidad de citas, seguridad o corrección de código.

La revisión humana guarda criterio a criterio (`pass`, `fail`, `uncertain`), calidad 0–5, notas, aceptable/no aceptable, autor, fecha y versión. Solo puede aceptarse una ejecución completada con todos los criterios aprobados por la persona. Se permite discrepar de la sugerencia y modificar valoraciones conservando un historial completo; el control de versión rechaza una revisión antigua. Resúmenes usan la última valoración humana; la automática original no se sobrescribe. Se muestran revisados/intentos para no confundir falta de revisión con una calidad ya determinada.

## Exportación y contrato

JSON (`ferweb-lab-export-v1`) contiene condiciones completas, contexto y versiones de fuentes, hashes, resultados, métricas, tarifas, errores, sugerencias, historial de revisiones y resúmenes. CSV conserva una fila por intento con condiciones, objetos JSON en celdas y columnas explícitas. Se escapan comillas y fórmulas potenciales de hojas de cálculo. La exportación exige los mismos permisos de lectura que la pantalla, sin claves ni cabeceras de proveedores.

Todos bajo `/api/projects/:projectId/lab`, con sesión, autorización y protección de origen en mutaciones:

| Método y ruta | Uso |
| --- | --- |
| `GET /` | Cabeceras de casos, tarifas y lotes del proyecto. |
| `POST /cases` | Congelar pregunta/contexto/criterios y fuentes opcionales. |
| `GET /cases/:caseId` | Caso completo, tras revalidar fuentes. |
| `POST /tariffs` | Registrar versión de tarifa. |
| `POST /batches` | Preparar casos, objetivos, repeticiones y condiciones. |
| `GET /batches/:batchId` | Condiciones, resultados y resumen. |
| `POST /batches/:batchId/execute` `{}` | Admitir ejecución, respuesta 202; no reintenta un lote ya iniciado. |
| `POST /batches/:batchId/cancel` `{}` | Cancelar lote, también en proyecto archivado. |
| `POST /batches/:batchId/runs/:runId/reviews` | Registrar valoración humana con versión. |
| `GET /batches/:batchId/export?format=json\|csv` | Descargar resultados autorizados. |

## Validación y límites de evidencia

Las comprobaciones automáticas usan exclusivamente `ai-test`, datos y tarifas sintéticos; nunca claves privadas, modelos reales ni precios supuestamente actuales. `laboratory.integration.ts` comprueba congelación, repeticiones, uso, caché, importes, errores/desconocidos, revisión/auditoría, permisos, exportación, cancelación y leases con PostgreSQL/Python reales. El recorrido Chromium permite preparar, ejecutar y revisar/exportar una comparación local/API simulada. Evidencia ejecutada en [status.md](status.md).

Queda pendiente la aceptación externa con modelos reales, un conjunto acotado de casos y presupuesto/tarifas verificados por el propietario. Esta entrega no declara cerrado ese criterio real del MVP ni demuestra calidad, consumo, caché o GPU de un equipo/proveedor real. No se ha invocado la validación real como efecto secundario de implementar el laboratorio.

Referencias oficiales consultadas: [caché de OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), [precios y alcances de OpenAI](https://developers.openai.com/api/docs/pricing), [uso y caché de Ollama](https://docs.ollama.com/api/usage), [chat de Ollama](https://docs.ollama.com/api/chat).
