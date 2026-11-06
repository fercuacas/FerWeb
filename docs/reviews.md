# Revisión, comparación y pull request (E9)

## Recorrido desde la web

Esta publicación y repetición individual corresponde a trabajos Codex independientes. P08 añade revisión por dimensiones del diff de un trabajo, incluidos hijos con cambios; estos siguen sin publicar ni repetirse por separado. La publicación del resultado de un equipo completo permanece pendiente. [Equipo secuencial](codex.md#equipo-secuencial-duradero-p06)

En un proyecto propio, vincula y sincroniza el repositorio, crea una tarea y abre **Trabajos → Nueva tarea con Codex**. La ejecución conserva tarea, criterios, archivos y commit inicial. El visor muestra diff por archivo, comandos, salidas y códigos de pruebas, uso disponible y limitaciones. Los resultados del agente y la verificación del controlador conservan su origen; superar pruebas no acredita por sí solo los criterios.

Cuando termine como completada, en **Revisión y pull request**:

1. Revisa diff, pruebas y criterios congelados. Prepara título, descripción, rama y valoración humana. La rama comienza por `ferweb/` y termina en `-<UUID completo de ejecución>`; el nombre intermedio es editable. La base es la rama registrada al ejecutar; no se puede sustituir por otra desde el formulario.
2. Marca la revisión humana y pulsa **Guardar revisión y borrador**. Esto escribe exclusivamente en PostgreSQL. Sin aprobación guardada o con cambios sin guardar no se habilita publicación.
3. Pulsa **Publicar PR borrador en GitHub**. Esta acción explícita crea un commit, una rama nueva y una PR **draft**, vinculada a tarea y ejecución en la descripción. No realiza merge ni modifica la rama base. Las reglas del repositorio pueden bloquearla.
4. Abre el enlace de la PR. La revisión y el resultado sobreviven a recargas/reinicio de API. Si un intento queda interrumpido, actualiza y reintenta la misma publicación. La reserva caduca a los tres minutos; antes devuelve conflicto. No cambies sus condiciones para recuperarla.

El archivo de un proyecto bloquea preparación, repetición y publicación. La lectura sigue requiriendo propiedad y acceso actual al repositorio. La revocación impide servir informes y revisiones; no elimina cambios que ya se hayan creado en GitHub.

## Revisión por dimensiones (P08)

1. En **Agentes → Equipos y plantillas**, crea **Revisión por dimensiones**. Asigna versiones compatibles con `node-readonly-v1` a corrección, especialista del stack, seguridad/pruebas y verificador. Ajusta su alcance mediante roles, skills y criterios de salida; no se conceden herramientas nuevas.
2. Abre el informe de un trabajo con diff completo y parada confirmada. En **Revisión por dimensiones**, elige plantilla/modelo y pulsa **Preparar revisión del diff**. También se pueden investigar trabajos fallidos con artefactos íntegros; esto no los habilita para publicar.
3. Revisa el diff congelado, sus hashes, versiones y presupuesto en el plan; aprueba la copia y ejecuta. Preparar/aprobar no consume inferencia. El workflow conserva los límites de P07: dos globales y uno por proyecto por defecto; solicitar dos lectores necesita la configuración explícita del proyecto.
4. Consulta dimensiones, hallazgos, procedencia, discrepancias y evidencia desde el informe original. El historial y los planes se recuperan al recargar; una revalidación fallida oculta los datos privados.

Los tres revisores reciben exactamente los mismos archivos finales reconstruidos desde el diff y los originales como referencia congelada; no el HEAD móvil ni cambios de sus compañeros. El plan guarda trabajo origen y hashes del informe, diff, tarea, herramientas y archivos. Cambiar esos artefactos invalida la revisión; también se comprueban antes de aprobar, iniciar, avanzar y servir entrada al hijo. La tarea debe corresponder a la versión del trabajo origen al preparar.

El origen debe ser reconstruible según las reglas de E9; conserva sus exclusiones de rutas y workflows. Esta fase sigue usando herramientas Node y no amplía los perfiles ni los permisos de publicación.

Las salidas son JSON estricto. Cada hallazgo declara código de incidencia, ubicación/lado antes o después, rango de hasta cincuenta líneas, extracto exacto, condición desencadenante, impacto, título, severidad y nombre de una prueba de reproducción o `null`. El servidor comprueba la ubicación contra los archivos congelados y exige que pertenezca al diff. Una salida inválida conserva la dimensión como inválida y la revisión incompleta. Cada revisor admite hasta diez hallazgos por ronda.

La clave de deduplicación combina código, ruta/lado, rango, evidencia y desencadenante normalizado. Los títulos libres no deciden igualdad. Se conservan todas las aportaciones con hijo, dimensión, ronda, rol/versión y texto; diferencias de severidad, impacto o reproducción quedan explícitas. Se toma la severidad más alta declarada, sin eliminar discrepancias.

El controlador ejecuta adicionalmente el comando fijo `node --test` con un **reporter propio de confianza**, veinte segundos y salida acotada sobre el snapshot de solo lectura. Conserva registros `ferweb-test-v1` del flujo de eventos, separados del stdout/stderr del repositorio y de comandos del agente. El verificador posterior recibe esos informes y los hallazgos validados; no aporta comandos nuevos. Para confirmar/refutar, debe referenciar hijo, índice y registro exacto de una prueba con el nombre indicado, resultado no omitido y terminación válida. Una referencia ajena, una afirmación sin prueba, resultados ambiguos/recortados o un nombre ausente permanecen **no verificables**. [Reporters de Node](https://nodejs.org/docs/latest-v24.x/api/test.html#custom-reporters).

La prueba referenciada debe proceder de un archivo congelado bajo `/workspace`. Para confirmar se exige un fallo de aserción observado; errores de entorno o de ejecución del test, incluidos permisos, dependencias ausentes y plazos, quedan no verificables. Una prueba omitida o marcada como pendiente tampoco confirma ni refuta. El texto impreso por un test no crea registros de verificación.

**Confirmado/refutado se refiere al resultado observado de esa reproducción concreta**. La relación entre el caso y el impacto requiere revisión humana; pruebas del repositorio pueden ser insuficientes. El verificador no convierte consenso entre modelos ni una comprobación de montaje en evidencia funcional. Para hallazgos `critical/high`, la falta de evidencia independiente válida bloquea la revisión. Los perfiles sin una prueba reproducible compatible conservan esa limitación; no se instalan dependencias ni se invoca otro proveedor.

La plantilla autoriza una o dos rondas como máximo. Una segunda ronda solo corrige salidas/hallazgos incompletos tras terminar técnicamente todos los hijos de la primera; conserva criterios, fuentes, roles y el **mismo** presupuesto/plazo P04. Con dos peticiones por etapa, dos rondas requieren hasta dieciséis peticiones. Cada ronda crea hijos rastreados nuevos; no reinicia código ni repone reservas. Los hallazgos graves anteriores se mantienen en la reunión aunque un revisor deje de mencionarlos. Las dimensiones inválidas previas permanecen en el historial y una corrección posterior se muestra separada. Un hijo fallido/cancelado detiene el equipo sin intentar otra ronda ni aparentar aprobación. Corregir fuentes requiere una ejecución de código explícita y revisar su diff nuevo.

`GET /review` reúne hasta diez revisiones duraderas, con estados `running/complete/incomplete/stale`. La revisión humana se vincula al informe y al resultado dimensional más reciente. Si este cambia, está incompleto o queda invalidado, la lectura deja de mostrar la aprobación como vigente y el servidor rechaza aprobar/publicar; permite conservar un borrador sin aprobar. Un recorrido completo no marca la casilla humana. Una revisión posterior válida puede resolver una anterior incompleta, que sigue visible en el historial. Guardar aprobación y **Publicar PR borrador** mantienen acciones separadas y nunca se ejecutan desde un acuerdo entre modelos.

Se reutilizan planes, cola, presupuesto, mensajes y entregas SQL de P05–P07. La migración 017 añade el vínculo de aprobación y el índice por trabajo revisado; 018 identifica rondas y admite las ocho etapas máximas del workflow. Se conservan las revisiones E9 sin análisis dimensional y su recorrido individual. No se publica el conjunto de un equipo ni se habilitan escritores paralelos.

## Permisos de la App

La lectura E3 sigue admitiendo **Contents: read**, **Issues: read** y **Pull requests: read**. Para publicar, el propietario debe habilitar **Contents: write** y **Pull requests: write** en la GitHub App y aceptar el cambio en su instalación; el usuario autorizado debe tener `push` en ese repositorio. Reautoriza/reconecta si GitHub lo requiere. No se solicitan permisos generales de organización ni `Workflows: write`; esta entrega rechaza publicar cambios en `.github/workflows/`.

Las credenciales permanecen cifradas en el backend; solo la API de confianza realiza las escrituras. El runner, sandbox, navegador y código del repositorio no reciben el token GitHub. Se revalida usuario/App/instalación/repositorio, y el vínculo/proyecto se comprueba entre etapas. Una revocación remota concurrente depende también de la autorización de GitHub en cada solicitud; no hay una transacción distribuida que pueda retirar una escritura ya aceptada.

## Integridad y base cambiante

La migración 009 guarda rama base, árbol de origen, entorno del ejecutor y borradores en `coding_reviews`. Una revisión se vincula al hash canónico del informe final; cambios posteriores del informe invalidan su aprobación. Se exige ejecución completada, captura completa, parada confirmada y cambios verificables. Las ejecuciones anteriores sin metadatos E9 conservan su consulta, pero requieren una nueva ejecución para publicar/comparar con garantías.

La API reconstruye exclusivamente los reemplazos de archivo completo generados por el recolector de confianza. Comprueba contenido original, hashes finales, límites y rutas; rechaza enlaces, archivos excluidos y workflows. Las altas y bajas, archivos vacíos y ausencia de salto final se conservan. Usa el árbol del commit inicial como `base_tree` y aplica solo los cambios revisados, conservando archivos excluidos y permisos ejecutables originales. No interpreta shell ni aplica un patch con herramientas del repositorio.

Se consulta la cabeza real de la base antes de crear objetos y antes de crear rama/PR; no se confía en el snapshot almacenado. Si difiere del commit ejecutado, devuelve `review_base_changed`: sincroniza y ejecuta de nuevo. Una rama ya creada queda registrada, sin borrado ni force push automático.

GitHub no permite condicionar atómicamente la creación de una PR al SHA actual de su rama base. Si esta cambia en la ventana entre comprobación y creación, o durante la reconciliación, se conserva `baseChanged=true` y la web exige nueva revisión. La PR es un borrador; no hay merge automático. No se promete que su base permanezca inmóvil después de la consulta.

## Reintentos e incertidumbre

SQL reserva un intento por ejecución, con token interno y lease de 180 segundos. No hay red dentro de la transacción SQL. Las operaciones GitHub tienen ocho segundos por solicitud y un presupuesto compartido de 45 segundos, menor que la reserva. Los errores no exponen cuerpos del proveedor ni credenciales.

Desde el primer intento, título/cuerpo/rama/aprobación quedan congelados. Se guarda el SHA del commit antes de crear la referencia. Árbol, mensaje, padre e identidades/fecha del commit son deterministas para que una respuesta perdida pueda recuperarse sin crear otra rama. Los objetos Git sin referencia pueden quedar huérfanos tras un fallo; no se anuncian como publicación completa.

Antes de crear la rama se consulta la referencia exacta; solo se reutiliza si apunta al commit esperado. No hay actualizaciones forzadas ni borrado. Antes de crear la PR se consulta `state=all` para esa rama y se verifica repositorio, head, base y marcador de ejecución/informe; también se recupera una PR cerrada, sin reabrirla ni crear otra. Una colisión, modificación remota, duplicidad o respuesta ambigua requiere revisión y nunca se sobrescribe.

Si GitHub creó una PR y se perdió su respuesta o confirmación SQL, el siguiente intento la reconcilia aunque la base haya avanzado, marcándola como cambiada. No se reenvía automáticamente una escritura facturable o una ejecución de código. El fallo puede dejar objetos/rama/PR remotos; la web no debe interpretar un error HTTP como ausencia de efectos.

## Comparación de ejecuciones

El panel compara hasta veinte ejecuciones recientes de la misma tarea y repositorio. Presenta modelo, estado, duración total, uso reportado, resultados de pruebas y valoración humana. Permite contrastar otro diff y sus pruebas junto al informe seleccionado. Coste sin tarifa y métricas no reportadas permanecen desconocidos; no hay ranking automático de calidad.

**Repetir con las mismas condiciones** copia el snapshot SQL original, incluso si la tarea o la base actual cambiaron: conserva commit, textos/manifiesto, criterios, rama base, cupos y plazo. Solo admite cambiar el modelo a otro disponible. El UUID de solicitud evita duplicar trabajos ante reintentos. Se revalidan permisos y cupos del proyecto.

El controlador resuelve y fija el ID inmutable de la imagen del sandbox. Guarda imagen, versión CLI, herramientas, recursos y hash de los archivos de política/controlador; verifica el entorno al iniciar cada ejecución. Una reconstrucción/cambio de política impide repetir bajo la etiqueta de condiciones iguales. No controla cambios internos de un alias de modelo remoto ni elimina la variación entre respuestas.

Las condiciones diferentes se señalan explícitamente por commit, archivos, tarea/criterios, herramientas/límites o configuración. Un entorno antiguo desconocido nunca se declara comparable. Hay **un único ejecutor Codex**: repetir modelos permite comparar ejecuciones/modelos con ese ejecutor; no acredita comparación entre motores de agentes distintos ni coordinación multiagente.

## Pruebas y aceptación externa

P08 añade [integración de dimensiones](../apps/api/test/coding.integration.ts), [frontera del reporter](../apps/api/test/coding-boundaries.test.ts) y [recorrido Chromium](../tests/browser/dimension-reviews.spec.ts). Se comprueban duplicados, discrepancias, prueba independiente con resultado confirmado/refutado/no verificable, referencias forjadas, fallos de revisores/verificador, conflictos pendientes, rondas/cupo compartido, invalidación, acceso, recarga y móvil. El reporter se prueba con Node real, fallos de aserción/entorno, omisiones y stdout que intenta imitar registros. CLI, procesos, SQL y contenedores son reales; Responses/GitHub están simulados y no acreditan calidad de modelos reales.

- [Integración de revisión](../apps/api/test/review.integration.ts): SQL/HTTP reales; informes sembrados explícitamente y GitHub con efectos remotos en memoria. Cubre permisos, aprobación/versiones, base cambiante, ramas ajenas, respuestas perdidas tras commit/ref/PR, concurrencia, reserva expirada, revocación, integridad y condiciones de comparación.
- [Fronteras](../apps/api/test/coding-boundaries.test.ts): reconstrucción exacta, altas/bajas/vacíos/UTF-8/saltos finales, permisos ejecutables y rechazo de paths/hashes manipulados.
- [Navegador](../tests/browser/coding.spec.ts): tarea → CLI/contenedor real con Responses simulado → diff/pruebas → revisión guardada → publicación explícita con GitHub simulado → persistencia → repetición/comparación. No usa credenciales del propietario real.

Resultados efectivamente ejecutados: [status.md](status.md). Esta entrega no configura una App, credenciales ni repositorio remoto por sí sola. No se ha publicado una PR real en GitHub.

Para aceptación real, configura una App de prueba con esos permisos y un repositorio pequeño **dedicado y autorizado**, conecta el proyecto y selecciona un commit. Configura una clave/modelo Codex con presupuesto explícito. Ejecuta la tarea, revisa y publica desde la web; anota fecha, repositorio, commit, trabajo, límites, rama y PR. Reintenta y comprueba que conserva la PR. Para comprobar la protección de base, ejecuta otra tarea, avanza la base del repositorio de prueba antes de publicar y verifica el bloqueo. Confirma archivos excluidos/modos, descripción y que la rama base no fue actualizada. No lo ejecutes como test automático ni sobre repositorios de producción. La limpieza remota es una acción separada del propietario.

Referencias oficiales verificadas para esta entrega: [árboles Git](https://docs.github.com/en/rest/git/trees), [commits Git](https://docs.github.com/en/rest/git/commits), [referencias](https://docs.github.com/en/rest/git/refs), [creación y consulta de PR](https://docs.github.com/en/rest/pulls/pulls).
