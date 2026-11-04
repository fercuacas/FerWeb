# Revisión, comparación y pull request (E9)

## Recorrido desde la web

En un proyecto propio, vincula y sincroniza el repositorio, crea una tarea y abre **Trabajos → Nueva tarea con Codex**. La ejecución conserva tarea, criterios, archivos y commit inicial. El visor muestra diff por archivo, comandos, salidas y códigos de pruebas, uso disponible y limitaciones. Los resultados del agente y la verificación del controlador conservan su origen; superar pruebas no acredita por sí solo los criterios.

Cuando termine como completada, en **Revisión y pull request**:

1. Revisa diff, pruebas y criterios congelados. Prepara título, descripción, rama y valoración humana. La rama comienza por `ferweb/` y termina en `-<UUID completo de ejecución>`; el nombre intermedio es editable. La base es la rama registrada al ejecutar; no se puede sustituir por otra desde el formulario.
2. Marca la revisión humana y pulsa **Guardar revisión y borrador**. Esto escribe exclusivamente en PostgreSQL. Sin aprobación guardada o con cambios sin guardar no se habilita publicación.
3. Pulsa **Publicar PR borrador en GitHub**. Esta acción explícita crea un commit, una rama nueva y una PR **draft**, vinculada a tarea y ejecución en la descripción. No realiza merge ni modifica la rama base. Las reglas del repositorio pueden bloquearla.
4. Abre el enlace de la PR. La revisión y el resultado sobreviven a recargas/reinicio de API. Si un intento queda interrumpido, actualiza y reintenta la misma publicación. La reserva caduca a los tres minutos; antes devuelve conflicto. No cambies sus condiciones para recuperarla.

El archivo de un proyecto bloquea preparación, repetición y publicación. La lectura sigue requiriendo propiedad y acceso actual al repositorio. La revocación impide servir informes y revisiones; no elimina cambios que ya se hayan creado en GitHub.

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

- [Integración de revisión](../apps/api/test/review.integration.ts): SQL/HTTP reales; informes sembrados explícitamente y GitHub con efectos remotos en memoria. Cubre permisos, aprobación/versiones, base cambiante, ramas ajenas, respuestas perdidas tras commit/ref/PR, concurrencia, reserva expirada, revocación, integridad y condiciones de comparación.
- [Fronteras](../apps/api/test/coding-boundaries.test.ts): reconstrucción exacta, altas/bajas/vacíos/UTF-8/saltos finales, permisos ejecutables y rechazo de paths/hashes manipulados.
- [Navegador](../tests/browser/coding.spec.ts): tarea → CLI/contenedor real con Responses simulado → diff/pruebas → revisión guardada → publicación explícita con GitHub simulado → persistencia → repetición/comparación. No usa credenciales del propietario real.

Resultados efectivamente ejecutados: [status.md](status.md). Esta entrega no configura una App, credenciales ni repositorio remoto por sí sola. No se ha publicado una PR real en GitHub.

Para aceptación real, configura una App de prueba con esos permisos y un repositorio pequeño **dedicado y autorizado**, conecta el proyecto y selecciona un commit. Configura una clave/modelo Codex con presupuesto explícito. Ejecuta la tarea, revisa y publica desde la web; anota fecha, repositorio, commit, trabajo, límites, rama y PR. Reintenta y comprueba que conserva la PR. Para comprobar la protección de base, ejecuta otra tarea, avanza la base del repositorio de prueba antes de publicar y verifica el bloqueo. Confirma archivos excluidos/modos, descripción y que la rama base no fue actualizada. No lo ejecutes como test automático ni sobre repositorios de producción. La limpieza remota es una acción separada del propietario.

Referencias oficiales verificadas para esta entrega: [árboles Git](https://docs.github.com/en/rest/git/trees), [commits Git](https://docs.github.com/en/rest/git/commits), [referencias](https://docs.github.com/en/rest/git/refs), [creación y consulta de PR](https://docs.github.com/en/rest/pulls/pulls).
