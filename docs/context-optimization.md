# Evaluar y adoptar estrategias de contexto (E10)

El [protocolo P10](context-packs.md#comparación-e10) añade la comparación vectorial/híbrida/híbrida con memoria vigente. El protocolo anterior descrito aquí sigue disponible.

E10 amplía el laboratorio existente; no modifica las instrucciones usadas para desarrollar FerWeb desde este chat. Reutiliza casos, criterios, tarifas, revisiones y exportación de E6. La migración 010 incorpora contabilidad por operación, resultados reutilizables y una política de contexto por proyecto.

## Recorrido

1. Conecta y sincroniza GitHub y actualiza el índice. Prepara los casos del laboratorio con sus preguntas y criterios; pueden incluir `expectedPaths` como fuentes esperadas. Las cinco preguntas de [retrieval-evaluation.json](../tests/fixtures/retrieval-evaluation.json) son el conjunto existente utilizado en la aceptación simulada, incluida la pregunta sin respuesta. No se cargan datos sintéticos en proyectos reales automáticamente.
2. En **Laboratorio → Comparar estrategias de contexto**, selecciona casos existentes, un único proveedor/modelo/configuración, una tarifa opcional y repeticiones. Guardar congela las condiciones y no ejecuta inferencia. OpenAI exige autorización explícita para enviar corpus, preguntas y resúmenes fuera del equipo.
3. Pulsa **Ejecutar comparación**. El panel **Antes y después del contexto** muestra resultados por estrategia; cada intento conserva respuestas, revisión humana y **Contabilidad de contexto**, con mensajes enviados, salidas y uso de cada llamada. Cancela mediante el control habitual del laboratorio.
4. Revisa respuestas, fuentes y criterios en los formularios de revisión existentes. Las sugerencias automáticas de texto/fuentes son provisionales. No reciben autoridad para aprobar una estrategia.
5. Solo con evidencia real suficiente, elige una medida y pulsa **Adoptar** para la candidata. La política afecta exclusivamente al chat con contexto del mismo proyecto, proveedor, modelo y configuración evaluados. Puede restablecerse desde el panel. Preparar o terminar una comparación no cambia el chat por sí solo.

## Estrategias versionadas

| Versión | Preparación y llamadas |
| --- | --- |
| `wide-v1` | Referencia amplia: todos los fragmentos del corpus indexado autorizado, más contexto manual del caso. Una llamada de respuesta. |
| `retrieval-v1` | Búsqueda Qdrant con embedding local de la pregunta; hasta cinco fragmentos relevantes y una llamada de respuesta. |
| `summary-v1` | La misma recuperación, una llamada de resumen y otra de respuesta sobre el resumen con procedencia de fuentes. Regenera el resumen en cada intento. |
| `reuse-v1` | Recuperación/resumen/respuesta en el primer fallo de caché; después puede reutilizar la respuesta completa de esa pregunta exacta bajo las mismas condiciones. Si no se conoce la revisión del modelo/configuración, ejecuta las llamadas y marca reutilización incompatible. |

El corpus de referencia procede de PostgreSQL, con exclusiones y permisos vigentes; los vectores son derivados. Se exige índice completo/vigente, hasta 60 fragmentos y 65 000 caracteres serializados. Un corpus mayor se rechaza explícitamente: no se trunca para aparentar una referencia amplia. La similitud de un fragmento leído sin búsqueda es desconocida (`score=null`). Estos límites no prueban que el proveedor conserve íntegramente el mensaje dentro de su ventana efectiva.

El resumen utiliza el mismo proveedor/modelo y un máximo fijo de 512 tokens de salida; la respuesta conserva el límite común elegido. No se añade un modelo resumidor distinto ni un evaluador externo invisible. Contexto y resúmenes son datos no confiables en mensajes de usuario separados del sistema; no conceden herramientas, roles ni permisos. Los criterios/respuestas esperadas no se envían al modelo. Un mensaje preparado de más de 100 000 caracteres se rechaza, sin truncado silencioso.

Máximo cinco casos, cuatro estrategias, cinco repeticiones y **40 intentos** por experimento. Orden `counterbalanced_context_v1`: rotación determinista de los objetivos por caso y repetición, conservando el ordinal de cada intento. Reduce el sesgo de ejecutar siempre primero la referencia; no controla hardware, carga, variación del modelo ni estado global del proveedor. El laboratorio E6 mantiene su orden/límite anteriores cuando no se solicita un experimento de contexto.

## Reutilización e invalidación

La caché de resultados de FerWeb y la caché de prefijos del proveedor son mecanismos distintos:

- FerWeb usa claves de proyecto/experimento, pregunta y contexto exactos, estrategia, corpus/permisos, revisión de modelo, configuración y versión de política. La primera consulta de una serie es un fallo de caché; las siguientes pueden referenciar el UUID productor. No se comparte una respuesta entre proyectos. La serie conserva el coste de creación original una sola vez al sumar sus intentos. Cada nuevo experimento inicia su propio espacio; no oculta un precalentamiento pagado en otro experimento.
- El proveedor puede reutilizar prefijos compatibles automáticamente. Se conserva `cachedTokens` cuando lo comunica. No se fuerza vaciado ni se llama «frío» al servidor por observar cero tokens de caché o poca rapidez. La reutilización de respuestas se deshabilita con revisión desconocida; la caché del proveedor sigue siendo únicamente observada.

Antes de reutilizar/generar y después de responder se validan acceso remoto, vínculo, contenido/procedencia, espacio de embeddings y catálogo/configuración. La huella incluye generación/versión del vínculo, permisos de instalación y un sello opaco de la autorización; reautorizar también invalida de forma conservadora. El servicio Python publica una revisión HMAC de su configuración privada; no publica claves. Se registra además un hash de la implementación efectiva del motor/prompts. Una nueva implementación/configuración exige nueva evidencia aunque los nombres de estrategia se mantengan; al cambiar comportamiento deben versionarse también sus identificadores.

Cambios de fuentes, permisos, revisión de modelo o configuración impiden usar entradas antiguas. Los registros históricos permanecen en SQL, pero no se sirven extractos/respuestas sin revalidar permisos; el panel señala cuándo una serie ya no respalda reutilización/adopción. No se promete borrado físico inmediato de derivados. No hay un endpoint para leer libremente `context_results`.

Una política adoptada se invalida también al cambiar las revisiones humanas que la respaldaban. El chat devuelve un conflicto manejado y requiere reevaluar o restablecer; no aplica silenciosamente una respuesta obsoleta. Si la conversación usa otro modelo/configuración, conserva su recorrido habitual. Durante la preparación se muestran fuentes como pendientes, y las utilizadas se confirman al terminar. Los turnos normales de historial se conservan como datos, mientras los turnos antiguos con fuentes no se convierten en evidencia actual. Chat y evaluación mantienen claves de reutilización distintas.

## Qué se mide

Cada operación tiene UUID, inicio, duración, estado, intento, uso disponible y coste parcial/motivo. Las llamadas de resumen/respuesta guardan mensajes exactos, modelo reportado y salida/parcial; el embedding de consulta registra su operación, pero su protocolo actual no comunica tokens ni coste. Validaciones/consultas de caché no se presentan como inferencias. Las operaciones se guardan antes de iniciar llamadas y al finalizar; una interrupción deja incertidumbre visible.

El tiempo observado del intento incluye validaciones, catálogo, búsqueda, resúmenes, generación y checkpoints. Preparar el lote no genera inferencias. La construcción previa del índice es común y no dispone de coste amortizado: no forma parte de un supuesto ahorro total. El circuito conserva los límites/leases y cancelación de E6, sin migrarse implícitamente a la cola E7. El aborto llega al UUID de la llamada auxiliar activa, sin garantizar facturación/parada remota.

No hay reintentos automáticos de inferencia (`maxRetries=0`). Los fallos, parciales, cancelaciones y nuevas llamadas auxiliares sí permanecen contabilizados. Repeticiones de evaluación son intentos independientes, no reintentos ocultos. Para otra serie hay que prepararla explícitamente.

El panel diferencia:

- **Tokens de llamadas de generación:** suma de entrada y salida de todas las llamadas de resumen y respuesta, incluidas las fallidas cuando se dispone de su uso. No resta tokens de caché. Una respuesta reutilizada sin nueva llamada tiene cero tokens nuevos de generación observados; su DTO de uso del proveedor permanece desconocido, porque no hubo un nuevo reporte.
- **Consumo global de inferencia:** desconocido si falta, por ejemplo, uso de embeddings o de una llamada interrumpida. No se estima con caracteres ni se sustituye por cero. El proveedor simulado puede aportar contadores sintéticos únicamente para validar el cálculo.
- **Caché del proveedor:** tokens leídos reportados y descuento estimado de lectura con tarifa vigente, separados de la reducción de tokens. No prueban ahorro global: pueden faltar cargos de escritura/retención u otros conceptos.
- **Coste:** estimación de texto por operación con las tarifas fechadas de E6, subtotal conocido y cobertura. Si falta una operación, la suma completa es desconocida. Incluye resúmenes; no toma solo el precio de la respuesta final. Infraestructura, energía, construcción/amortización del índice, embeddings/cargos no reportados y posibles escrituras de caché impiden conocer una factura total. **`totalCostUsd=null`** identifica esa limitación; el subtotal parcial no se etiqueta como coste total ni ahorro.
- **Calidad:** completados, revisados, aceptables y puntuación humana; nunca convierte falta de revisión en calidad determinada. Fuente esperada/texto literal ayudan a revisar, sin ser una evaluación semántica automática.

La exportación JSON conserva plan/corpus, versiones, operaciones y revisiones; CSV añade estrategia, plan y contabilidad de operaciones. Las claves no forman parte de esos datos.

## Condiciones de adopción

La acción explícita exige lote completado, al menos dos casos distintos y dos repeticiones, parejas referencia/candidata completas, todas revisadas/aceptadas por personas y ninguna puntuación candidata inferior a su referencia. Debe observarse una mejora de al menos el 5 % en la medida elegida: latencia completa, tokens de todas las generaciones o coste de texto de todas las operaciones. Un coste incompleto no puede aprobarse como mejora de coste. Se conserva el coste de creación de los resultados reutilizados.

Las fuentes/configuración deben seguir vigentes y la evidencia no puede ser simulada ni tener configuración desconocida. Se guarda selección, versión y huella de las revisiones; el control de versión evita sustituir/restablecer una política desactualizada. No hay promoción automática ni promesa de significación estadística o mejora para todas las preguntas futuras. La adopción es una decisión acotada al proyecto y modelo evaluados, reversible y sujeta a nueva evaluación cuando cambien condiciones.

## Comprobaciones y aceptación real

[context.integration.ts](../apps/api/test/context.integration.ts) usa los cinco casos existentes, cuatro estrategias y dos repeticiones, SQL/Qdrant/Python reales y generación/embeddings simulados. Comprueba contabilidad, origen/coste de creación, falta de uso, igualdad de condiciones, exportación, permisos, revisión/configuración/fuentes, incompatibilidad de revisión y cancelación durante un resumen. Para comprobar el cableado del chat se siembra una política únicamente en la base desechable de prueba: la API de adopción rechaza los resultados simulados.

[context.spec.ts](../tests/browser/context.spec.ts) recorre preparación desde casos existentes, ejecución, antes/después, operaciones auxiliares, bloqueo de adopción simulada, recarga y móvil. Los resultados ejecutados están en [status.md](status.md). El informe privado `.artifacts/evaluations/e10-context-evaluation.json` está marcado como simulado y no acredita ahorro real; su volumen de herramientas está separado del directorio temporal que limpia Playwright.

Para medición real explícita: configura App/repositorio y modelos locales/API autorizados, indexa un corpus acotado, guarda los casos y tarifas verificadas aplicables y declara condiciones de hardware/carga. Ejecuta la comparación desde la web con presupuesto, revisa respuesta/fuentes/criterios por pareja y repite con suficientes muestras. Comprueba uso de cada auxiliar, caché observada y cobertura de coste; no adoptes por un subtotal incompleto o por datos de fixtures. Esta entrega no realiza llamadas externas reales por sí sola ni instala modelos.

Referencia verificada para la semántica de caché compatible: [documentación oficial de OpenAI sobre prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). Se mantiene el protocolo de generación existente; no se añaden opciones de caché que un modelo no haya declarado compatibles.
