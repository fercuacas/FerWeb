# Preparar contexto y skills con recibos (P10)

P10 amplía P03, P09 y la recuperación existente. PostgreSQL conserva el mapa Markdown, el catálogo de archivos/fragmentos y los recibos. Los JSON exportados son copias portables; Qdrant sigue siendo un índice derivado. No se crea un JSON por archivo en Git ni se convierte el historial completo en un prompt.

## Recorrido

1. Conecta y sincroniza GitHub. En **Conocimiento → Mapa, catálogo y recibos de contexto**, actualiza el catálogo. La opción léxica funciona sin embeddings; la otra conserva la indexación incremental con embeddings locales de E5.
2. Propón el mapa desde los documentos existentes o escribe uno breve: propósito, módulos, entradas, pruebas y decisiones vigentes. Elige hasta cinco documentos de apoyo. Guardar crea una versión con hash y control de concurrencia. El mapa admite hasta 8.000 bytes UTF-8; las referencias guardan el primer fragmento autorizado del documento, no su contenido completo.
3. En **Trabajos → Nueva tarea con Codex → Preparar contexto y skills**, activa el paquete, elige perfil, consulta y selección. Revisa el recibo antes de ejecutar. Cambiar tarea, rol, modelo, selección o consulta exige prepararlo de nuevo.
4. En los planes de equipo, activa **Contexto por rol del equipo**. Cada fase tiene una previsualización y cada trabajo hijo conserva su propio recibo y cupo de ampliaciones. Las iteraciones siguen compartiendo el presupuesto y plazo del equipo.
5. Abre el recibo desde el trabajo, el plan o Conocimiento. Muestra material inicial, versiones/hashes, razones, omisiones, fuentes y ampliaciones. Puede exportarse como JSON. Un recibo histórico autorizado se conserva; su estado indica si aún puede reutilizarse.

## Selección y límites

Solo participan skills revisadas, portables y compatibles con las capacidades y herramientas del ejecutor. Las skills del rol siguen siendo obligatorias. Las adicionales no sustituyen sus instrucciones congeladas. Se conservan los límites conjuntos de P03 y un máximo de tres skills con sus dependencias.

- **Manual:** aplica las invocaciones explícitas y las del rol.
- **Sugerida:** muestra coincidencias sin aplicar propuestas.
- **Automática:** admite coincidencias deterministas del nombre, tecnologías o palabras configuradas. Las coincidencias ambiguas requieren elección explícita. Lean admite un grupo de propuesta con sus dependencias; Full admite hasta el límite conjunto.

La política versionada permite perfiles Lean/Full, palabras en español/inglés, dependencias, exclusiones simétricas e invocación explícita. Las dependencias circulares, incompatibles, excluidas o de otro perfil se rechazan. La normalización separa identificadores, elimina acentos y combina coincidencias léxicas con n-gramas de caracteres. No llama a un modelo para elegir skills.

| Perfil | Fragmentos de búsqueda iniciales | Ampliaciones por trabajo/fase | Fuentes por ampliación | Bytes por ampliación | Bytes totales |
| --- | --- | --- | --- | --- | --- |
| Lean | 4 | 2 | 2 | 6.000 | 24.000 |
| Full | 8 | 4 | 4 | 12.000 | 64.000 |

El material inicial incluye mapa, skills adicionales, hasta tres recuerdos vigentes y fuentes completas que quepan; contabiliza también el material obligatorio del rol. Nunca corta un fragmento para aparentar que cabe. Los recuerdos siguen sin revisar y conservan las revisiones y procedencia de P09. La selección automática de memoria examina una ventana acotada y comunica si es incompleta. Los límites de bytes no estiman tokens ni describen el tamaño de toda la conversación de Codex.

## Recuperación y ampliaciones

La recuperación combina ranking léxico sobre el catálogo SQL autorizado y similitud del espacio local vigente de Qdrant mediante RRF con constante 60. Las coincidencias exactas de rutas, identificadores y textos entre comillas tienen prioridad. Deduplica por fragmento/contenido y conserva ruta, líneas, repositorio y commit. El ranking léxico procesa el corpus acotado existente; no presupone análisis AST.

La respuesta declara `hybrid-rrf-v1`, `lexical-v1` o `vector-v1`, los rangos y el motivo de recuperación. Si faltan embeddings, el uso léxico es explícito. El chat vectorial anterior exige reconstruir un índice vectorial si se eligió el catálogo exclusivamente léxico. La comparación vectorial del laboratorio falla si no puede ejecutar su referencia: no sustituye silenciosamente esa referencia por búsqueda léxica.

Codex puede solicitar una dependencia, contrato o prueba mediante el puente interno `/context/expand`, con una ruta o consulta concreta, razón y UUID idempotente. El controlador aporta la identidad de la generación; el código no recibe credenciales del servicio. La API comprueba proyecto, lease, fence, plazo, cancelación y permisos, reserva el cupo antes de buscar y registra lo entregado. Los intentos admitidos fallidos también consumen número de ampliaciones; repetir un UUID no repite inferencia. No reenvía fuentes iniciales o ampliadas anteriormente.

El recibo registra el canal de contexto P10. El workspace congelado de Codex sigue disponible para las herramientas existentes: el recibo no es una auditoría de cada lectura arbitraria realizada por un comando del agente. El mapa, las skills, las fuentes y la memoria se entregan como datos sin autoridad para ampliar herramientas o permisos.

## Vigencia y autorización

Cada lectura revalida el acceso. Retirar una ruta o revocar GitHub oculta también recibos e informes derivados, entregas y memoria que dependan de ellos. Cambios de contenido, mapa, tarea, rol, revisión de skills, política, memoria o configuración invalidan la reutilización. Los recibos de ejecución se clonan de la previsualización: no comparten sus ampliaciones. Se admiten hasta mil previsualizaciones por proyecto.

La migración aditiva `020_context_packs.sql` incorpora mapas, políticas, recibos y ampliaciones, y enlaza trabajos con su recibo. No modifica las migraciones aplicadas ni introduce otra base activa. Las métricas observadas de tokens corresponden a toda la ejecución cuando el proveedor las comunica. Un dato ausente y el coste completo no conocido se muestran como desconocidos.

## Comparación E10

En **Laboratorio → Comparar estrategias de contexto**, el protocolo P10 compara `retrieval-v1`, `hybrid-v1` e `hybrid-memory-v1` con los mismos casos, commit, modelo y límites. Congela el corpus y las revisiones de memoria; una corrección invalida las condiciones. El protocolo anterior sigue disponible.

El informe incluye presencia de rutas esperadas —también pruebas si figuran en los criterios—, validez de etiquetas de citas, vigencia de sus metadatos, latencia de búsqueda/memoria, operaciones auxiliares, uso informado y coste conocido. La validez de una etiqueta y su procedencia no prueban que respalde semánticamente una afirmación: la corrección de las respuestas requiere revisión humana. La ausencia de citas produce una medida desconocida, no una puntuación perfecta. Datos simulados o memoria incompleta bloquean la adopción. No hay ahorro real demostrado ni una variante adoptada automáticamente.

Selección y búsqueda no usan inferencia externa. Embeddings siguen siendo exclusivamente locales; elegir generación externa conserva la autorización explícita existente. No se descargan modelos ni hay fallback externo del modo local.

## Reutilización y referencias

Se adaptó la separación de términos y el uso de n-gramas del módulo [context-retrieval.js de ECC](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/context-retrieval.js), revisando también [context-selection.js](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/context-selection.js) y su perfil Lean. El commit está fijado y la [licencia MIT](../apps/api/src/modules/retrieval/ECC-LICENSE.txt) se conserva. FerWeb implementa sus propios contratos, autorización, persistencia y presupuestos; no ejecuta los hooks ni el registro CommonJS de ECC.

La fusión por rangos sigue la referencia de [búsqueda híbrida de Qdrant](https://qdrant.tech/documentation/search/text-search/hybrid-search/); la carga bajo demanda toma como referencia [context engineering de Anthropic](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents). Son referencias de diseño, no permisos del sistema.

[Recuperación](retrieval.md) · [Memoria](memory.md) · [E10](context-optimization.md) · [Codex](codex.md) · [Pruebas y mantenimiento](development.md)
