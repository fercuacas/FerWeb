# Memoria de proyecto (P09)

En cada proyecto, **Conocimiento** permite guardar hechos, decisiones operativas, notas, lecciones y entregas. El propietario escribe o importa expresamente; los agentes no disponen de una herramienta para modificar esta memoria. La creación y consulta no consumen inferencia. PostgreSQL es la autoridad: `project_memory_entries`, `project_memory_revisions` y `project_memory_imports`, migración 019. No se crea un almacén paralelo en Git ni Qdrant.

## Uso y procedencia

Cada entrada tiene UUID, tipo, título, texto pequeño, estado, etiquetas/destinos, autor efectivo, origen, fecha observada y fecha de registro del servidor. Una lección exige fallo observado y decisión; la validación puede faltar y queda explícitamente `null`. Las fuentes opcionales apuntan a tarea/version, informe de un trabajo o entrega técnicamente verificada de equipo. Para código se guarda ruta, líneas, commit, blob, hash del extracto y enlace a GitHub; una regla canónica se vincula a su documento Markdown versionado, sin convertir la memoria en política.

Una referencia acredita procedencia y acceso, no la veracidad de la afirmación. Sin fuentes se muestra **Sin evidencia**; con fuentes sigue siendo contenido **sin revisar**. Los destinos son etiquetas para filtrar, nunca roles, herramientas ni permisos. El texto se muestra escapado, también al importar o contener instrucciones maliciosas.

Desde una entrega verificada de P06 se puede abrir **Guardar entrega como memoria de proyecto**, revisar el resumen y guardar. Después, **Nueva tarea con Codex** o **Preparar plan** permite seleccionar hasta tres entradas vigentes por búsqueda o ID y ver su contenido. Solo se envían las seleccionadas al ejecutor configurado, dentro de `task.projectMemory`, con un aviso fijo de contenido sin autoridad. El trabajo y el plan congelan ID, revisión y hash; el informe identifica la memoria utilizada. La memoria no elige proveedor ni crea un fallback de inferencia. El contexto automático, jerárquico o resumido pertenece a P10.

## Revisiones y fechas

Corregir o retirar crea una revisión vinculada a la anterior. Una transacción bloquea el proyecto, cierra el intervalo anterior, inserta la sucesora y mueve el puntero vigente; una versión concurrente pierde con 409. El hash identifica contenido y evidencia normalizados; la revisión vigente y sus fuentes autorizan reutilizarlo. Máximo 50 revisiones por entrada y 500 entradas por proyecto.

La búsqueda ordinaria excluye entradas retiradas y revisiones anteriores. La lectura por ID permite inspeccionar también una cabeza retirada, sin seleccionarla para ejecutar. Historial y `?revision=N` solicitan versiones anteriores explícitamente. **Conocido en esta fecha** usa el tiempo de registro del servidor, con intervalos `[recordedAt, validUntil)` y precisión de PostgreSQL; `observedAt` es una fecha declarada, no altera lo que el servidor sabía entonces. La corrección importada empieza una entrada local nueva: conserva la procedencia declarada, pero no falsifica intervalos ni identidad del historial local.

## Autorización y búsquedas incompletas

Cada operación exige sesión y propiedad del proyecto. Antes de buscar palabras se autoriza una ventana de hasta veinte entradas, independientemente de la consulta: un término oculto no debe revelar que coincidía con memoria inaccesible. Se usa búsqueda léxica PostgreSQL `simple`, con ranking dentro de esa ventana. `nextCursor` recorre ventanas siguientes; una ventana parcial o posterior nunca se presenta como una búsqueda global completa. Un ID se resuelve directamente, sin depender del límite de búsqueda.

`complete`, `state`, `issues` y `nextCursor` distinguen resultados, vacío comprobado, consulta incompleta y fuentes no disponibles. La UI permite reintentar y consultar más ventanas. No confunde ausencia de coincidencias con ausencia de información. El historial devuelve solo revisiones autorizadas y señala omisiones. El navegador revalida cada cuatro segundos y oculta datos privados si la petición falla.

Las fuentes de código requieren el mismo repositorio y una ruta regular todavía accesible. El contexto vigente exige además el mismo commit y blob; sincronizar sin cambiar el commit no invalida el recuerdo. El historial puede conservar una versión antigua si la ruta sigue existiendo y autorizada; retirar la ruta, cambiar repositorio o revocar acceso la oculta también allí. Las tareas requieren existencia y, para reutilizar, versión vigente. Trabajos/entregas exigen informe terminal, hash conservado, acceso al repositorio y tarea existente/vigente según el modo. Su memoria de origen se comprueba recursivamente: hasta cuatro niveles y 256 comprobaciones por petición; ciclos o exceso dejan un resultado incompleto, no contenido sin verificar. La procedencia de un informe se autoriza por repositorio, sin afirmar que su antiguo código siga vigente.

Se vuelven a comprobar referencias al crear, aprobar/iniciar planes y mientras corre el trabajo. Una corrección o retirada impide usar la selección anterior. Los informes históricos conservan la revisión realmente usada, sujetos a acceso a sus fuentes. También se autoriza la memoria añadida por un equipo de revisión por dimensiones, aunque el trabajo original no la utilizase: una corrección marca la revisión como obsoleta y retirar su fuente oculta el resultado derivado. Revisión humana/publicación y comparación no presentan como vigente una aprobación apoyada en memoria cambiada. Un proyecto archivado permite consultar/exportar, pero no crear, corregir ni importar.

## Intercambio portable

La UI importa un archivo UTF-8 y exporta una selección explícita. Límites: 32.000 bytes, hasta diez entradas JSON o una Markdown; no se trunca contenido ni se acepta una importación parcial. Se valida todo antes de insertar en una transacción. `requestId` permite reintentar sin duplicar; cambiar el contenido bajo la misma clave da conflicto. No se ejecutan bloques, enlaces ni instrucciones del archivo.

- JSON: `ferweb.memory.v1`, `scope: selection`, `complete: true`, registros con `externalId`, `sourceHarness`, metadatos `reported` y `entry`. El autor local es siempre el propietario autenticado; las fechas, hashes y relaciones declaradas se conservan como procedencia sin autoridad.
- Markdown: adaptación del [diseño Memory Vault de ECC, revisión fijada](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/docs/design/ecc-memory-vault.md). Frontmatter `ecc.memory.v1` con valores JSON, ámbito `project` y confianza `unreviewed`; exportación con bloque `ferweb-memory-v1` para conservar fuentes y campos de lección. Se rechazan claves desconocidas/duplicadas y YAML arbitrario. La prosa de un Vault ajeno puede importarse como contenido sin evidencia; una lección sin estructura suficiente se rechaza. No se promete compatibilidad con todos los tipos de nota de ECC.

Los archivos son copias de una selección, no un respaldo completo ni autoridad para restaurar permisos. Solo se exportan cabezas vigentes, incluso retiradas si se piden por ID; las fuentes deben seguir accesibles. Al importar, las referencias se vuelven a resolver en el proyecto destino y se comparan los hashes esperados. Un archivo exportado antes de una retirada puede dejar de ser importable. No hay escritura automática a Git ni replicación de secretos.

El filtro rechaza formatos conocidos de claves privadas PEM, claves OpenAI/GitHub/AWS y algunas asignaciones de credenciales o Bearer. Responde sin repetir el valor. Es una detección por patrones: puede tener falsos positivos y no detecta secretos arbitrarios, codificados, fragmentados o desconocidos. No sustituye revisar el contenido antes de guardarlo o compartirlo.

## Verificación

`memory.integration.ts` prueba HTTP/SQL reales en una base aislada: ámbito, datos maliciosos sin autoridad, vacío sin evidencia, correcciones concurrentes, límites temporales, historial, roundtrip, importación incompleta atómica, rechazo de secretos, retirada/revocación y ventanas acotadas. `coding.integration.ts` guarda una entrega P06 y la usa en otra ejecución CLI, verifica la presencia del aviso en el input del proveedor simulado y bloquea la selección corregida. `memory.spec.ts` recorre creación/error/reintento, corrección, historial, exportación/importación, archivo, revocación de lectura y móvil/teclado.

Los casos de actualización, tiempo y abstención se inspiran en [LongMemEval](https://arxiv.org/abs/2410.10813). No se ejecuta ese benchmark ni se atribuyen puntuaciones o ahorro de tokens. Las pruebas no acreditan resistencia semántica de un modelo real a prompt injection; comprueban contratos, permisos y aislamiento del ejecutor existente. Preparación y comprobación completa en [desarrollo](development.md).
