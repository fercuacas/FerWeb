# Ejecución de tareas con Codex (E8)

En un proyecto activo, crear una tarea con descripción y criterios de aceptación, vincular y sincronizar GitHub y abrir **Trabajos → Nueva tarea con Codex**. Elegir tarea, modelo permitido, plazo, máximo de peticiones y salida por petición. **Ejecutar tarea con Codex** guarda las condiciones y devuelve el UUID del trabajo. La web muestra estado/eventos, permite **Detener Codex** y conserva resumen, diff, comandos, pruebas, tiempos, uso disponible y limitaciones.

La ejecución no modifica la rama remota, la carpeta FerWeb del anfitrión ni el estado de la tarea. Un trabajo completado significa que acabó el recorrido técnico; la calidad y el cumplimiento de los criterios requieren revisión humana. E9 añade un paso separado de revisión y publicación explícita de una rama/PR borrador desde la API de confianza: [recorrido, permisos y reintentos](reviews.md).

## Configuración y autenticación

Se integra **Codex CLI 0.166.0**, fijado en [Dockerfile del sandbox](../apps/sandbox/Dockerfile), mediante `codex exec --json` y eventos documentados. La CLI oficial ejecuta el ciclo de herramientas; FerWeb controla la admisión, el entorno, el proveedor y los resultados. No se usa el chat E4 como sustituto del agente.

1. Ejecutar `npm run setup` desde FerWeb para añadir `RUNNER_SERVICE_TOKEN` aleatorio si falta, conservando los valores anteriores.
2. Copiar [codex.example.json](codex.example.json) a `secrets/codex.json`. Definir `apiKey` con una clave dedicada del proyecto OpenAI y `models` con identificadores concretos habilitados para esa cuenta. No hay modelo implícito ni selección automática de una versión nueva.
3. Ejecutar `npm run docker:up`. Construye la imagen de Codex y arranca el controlador. El gestor detecta el JSON y lo monta **solo en runner**, mediante `compose.codex.yaml`. `FERWEB_CODEX_CONFIG_FILE` admite otra ubicación privada en `secrets/`, `.local/` o fuera del repositorio.
4. Si hay CA local de inspección HTTPS, se usa para construir la CLI y, mediante `compose.codex-ca.yaml`, para verificar TLS en la pasarela. No se desactiva TLS ni se entrega la configuración privada al sandbox.
5. Comprobar capacidades en la web. Sin clave/configuración válida se muestra indisponible: no hay fallback a ChatGPT, otro modelo, Ollama ni credenciales de la aplicación Codex del anfitrión.

La integración usa facturación/autenticación por API. No copia `~/.codex/auth.json`, sesiones de escritorio o sus permisos del ordenador. El modelo recibe el contexto de la tarea y del snapshot por la API de OpenAI configurada; el código no obtiene la clave. La aceptación real con una clave/modelo concretos es una prueba explícita, nunca parte de los tests automáticos.

En **Estado → Consultar capacidades**, una sesión autenticada puede consultar las opciones Codex, OpenAI para conversaciones y Ollama para conversaciones. El formulario de Codex muestra su diagnóstico por proyecto y distingue destino real, proveedor simulado y destino sin confirmar. Los estados de soporte describen lo que ofrece FerWeb con cada perfil. La opción de chat local ofrece texto, streaming y solicitud de cancelación. La confirmación de parada remota y el uso real dependen de la evidencia recibida.

La revisión de configuración del ejecutor es una huella del entorno anunciado, la lista de modelos y la disponibilidad. La revisión individual de sus modelos queda desconocida. En chat se usa la revisión opaca del catálogo existente. La consulta comprueba configuración y catálogos. La aceptación de inferencia y herramientas con un modelo real se verifica por separado.

## Tarea y commit congelados

`POST /api/projects/:projectId/coding` requiere `requestId`, `taskId`, `taskVersion`, `commit`, `model`, `timeoutMs`, `maxRequests`, `maxOutputTokens`. No admite shell, credenciales, rutas de montaje, imágenes ni opciones Docker del cliente. Se exige tarea propia del proyecto y un snapshot GitHub autorizado, completo, sincronizado y del commit solicitado.

E8 utiliza una **copia filtrada de los blobs del snapshot del commit**, no un clon completo ni un checkout con historial. No se crea un commit Git local distinto para hacerlo pasar por el SHA de origen. La tarea, su versión/criterios, repositorio/commit, textos, SHA de blobs y hashes SHA-256 se guardan en `coding_runs` mediante la migración 008. Cambiar después una tarea no altera la entrada guardada.

Se aplican exclusiones de lectura/indexación y restricciones adicionales: sin `.git`, `.codex`, `AGENTS.md`, secretos, credenciales, claves, dependencias, generados, enlaces o submódulos; hasta 100 archivos de texto UTF-8, 200 KB por archivo y 1 MB total. Los archivos omitidos se enumeran. No se instalan dependencias ni se conservan permisos ejecutables. Los contenidos son datos no confiables y no pueden ampliar permisos.

La API revalida acceso GitHub antes de congelar, al iniciar, durante la ejecución y antes de mostrar el informe. El worker pide la entrada por una ruta interna autenticada y ligada a la generación vigente; no recibe credenciales GitHub. Una revocación bloquea informes y detiene el trabajo. El control periódico no es instantáneo: intervalo aproximado de tres segundos más latencia de las comprobaciones.

UUID y condiciones de admisión son idempotentes por proyecto. Un UUID repetido con condiciones diferentes se rechaza. El código nunca se reintenta automáticamente tras interrupción: se conservan las evidencias disponibles y se admite otro trabajo explícito si se quiere repetirlo.

PostgreSQL es la autoridad duradera. Tras confirmar el informe en SQL, el worker libera la copia en memoria del controlador; reiniciar este último no borra el informe SQL. Las transacciones cortas de cola limitan también la inactividad dentro de una transacción, para que un worker pausado no retenga el bloqueo e impida recuperaciones.

## Roles versionados por proyecto (P02)

Desde **Agentes**, abre un proyecto y crea un rol o añade una de las seis plantillas revisadas. Editar crea una versión nueva. El historial permite ver el propósito, las instrucciones, la forma de salida, las capacidades y perfiles requeridos y el origen de cada versión. Las plantillas de FerWeb son de redacción propia e identifican las especialidades que las inspiraron. [Catálogo de ECC](https://github.com/affaan-m/ECC/tree/main/agents)

En **Trabajos → Nueva tarea con Codex**, selecciona la tarea, el rol opcional y una versión compatible. Codex comprueba las capacidades declaradas como compatibles en P01 y el perfil permitido. El modelo sigue escogido de la lista del ejecutor. El rol guía el trabajo y el formato de la respuesta. Los perfiles de esta fase sirven para comprobar compatibilidad y las sugerencias de mantener archivos intactos dependen de que el agente las siga. El aislamiento efectivo sigue siendo el del perfil Node existente.

La migración 011 guarda el catálogo y el historial en PostgreSQL. Cada trabajo guarda una copia íntegra de la versión elegida junto a la tarea y el commit. El informe muestra **Rol congelado**, incluso tras editar o archivar el rol. Una repetición requiere que el rol siga activo y conserva la versión del trabajo original. La comparación detecta cambios de versión o contenido del rol.

El catálogo y la entrada congelada se consultan con autorización de proyecto. El ejecutor recibe el propósito, las instrucciones y el formato del rol seleccionado al ejecutar. En el destino OpenAI, estos textos forman parte de la solicitud al modelo. La forma de salida es una guía textual. Una versión que requiera salida estructurada validada u otra capacidad que Codex no confirme se rechaza. Cada proyecto admite hasta 50 roles y cada rol hasta 50 versiones.

## Biblioteca de skills (P03)

En **Agentes → Biblioteca de skills**, importa un manifiesto JSON o incorpora una entrada del catálogo. La selección de ECC contiene siete adaptaciones de texto para FerWeb y dos referencias bloqueadas por sus dependencias de hooks o MCP. Las adaptaciones incluyen los modos desarrollo, investigación y revisión, reglas TypeScript y Python y guías React y PostgreSQL. Cada entrada conserva su origen fijado y el aviso MIT. [Commit de ECC](https://github.com/affaan-m/ECC/commit/b38be6a7f6350964d59328b52f0624e1d1d552d1)

Comprueba el texto, la licencia y los recursos antes de aprobar la versión. En **Crear versión** del rol, elige hasta tres versiones aprobadas y usa **Ver texto que recibirá el modelo**. Al preparar un trabajo se comprueban las capacidades y perfiles tanto del rol como de sus materiales. Codex recibe los nombres, rutas, textos y avisos de licencia como contexto de referencia. En el destino OpenAI esos textos viajan en la solicitud de inferencia. Los archivos se guardan como datos y el sandbox conserva su política. El frontmatter se trata como texto.

La migración 012 guarda los paquetes y versiones en PostgreSQL. Una importación idéntica devuelve la versión existente. Los cambios crean otra versión que requiere revisión propia. Una edición del rol crea otra versión del rol. **Rol congelado**, en el informe, muestra la selección y su texto aunque después se importe contenido nuevo o se edite el rol. Repetir una ejecución conserva el material congelado y requiere el entorno original. La imagen de sandbox de P03 cambia para incluir este contexto y las repeticiones de ejecuciones de una imagen anterior siguen sujetas a esa comprobación.

El importador valida texto UTF-8, Base64 canónico, rutas relativas, recursos y SHA-256 por archivo. Cada paquete admite seis archivos `.md` o `.txt`, 12 KiB por archivo y 36 KiB en total. El contexto serializado de materiales y avisos de licencia admite hasta 24 KiB por rol. El origen de un manifiesto es informativo. La aplicación importa archivos locales elegidos por el usuario o adaptaciones incluidas en el código de FerWeb. Las referencias a servicios, scripts, hooks, MCP y ejecutores específicos son diagnósticos y bloquean la aprobación. [Manifiesto y API](api.md#biblioteca-de-skills-p03)

## Separación de componentes

```text
Web → API → PostgreSQL: tarea, snapshot, cola, eventos e informe
         ↑ consulta interna autorizada
       worker → runner de confianza → Docker Engine
                 ├─ contenedor de código sin red general ni secretos
                 │    Codex → proxy loopback → socket Unix de esta ejecución
                 ├─ pasarela → https://api.openai.com/v1/responses
                 └─ recolector independiente: volumen final en solo lectura
```

`runner` es un componente de control **de confianza** con acceso al socket Docker y a la clave OpenAI. No ejecuta código del repositorio en su propio proceso ni lo monta como fuente ejecutable. Su API no publica puerto en Windows y requiere un token interno; operaciones sobre una ejecución requieren además su generación. Docker socket implica autoridad sobre el motor: comprometer este controlador comprometería esa frontera. No es un proxy Docker genérico ofrecido a la web.

Cada trabajo obtiene un contenedor y un volumen temporal propios. Los volúmenes de control se montan por subdirectorio de ejecución, en lectura: el código no ve entradas ni sockets de otros trabajos. No se monta la carpeta del anfitrión, PostgreSQL, claves de GitHub/OpenAI, sockets del anfitrión ni herramientas de control de FerWeb.

La producción y las pruebas tienen redes/volúmenes y etiquetas de controlador separadas por proyecto Compose. Al reiniciar, cada controlador elimina solamente sus contenedores huérfanos y volúmenes temporales etiquetados. Las bases y volúmenes de la aplicación no forman parte de esa limpieza.

El controlador negocia la API del motor por el socket local. Admite de 1.45 a 1.51 y utiliza la versión más alta del intervalo que acepte el motor. El mínimo conserva el montaje de un subdirectorio del volumen de control por ejecución. La versión negociada queda registrada en las condiciones congeladas. [Historial de la API de Docker](https://docs.docker.com/reference/api/engine/version-history/#v145-api-changes)

## Límites efectivos

| Recurso | Límite aplicado |
| --- | --- |
| Identidad | Codex, shell, código y tests con UID/GID 1000, sin capacidades y `no-new-privileges`. Supervisor root separado, con solo SETUID/SETGID para lanzar ese usuario. |
| Archivos | Raíz de solo lectura; workspace exclusivo temporal de 64 MiB; `/tmp` 128 MiB y home 64 MiB temporales, `nosuid/noexec`. Sin montajes de fuentes del anfitrión. El código puede leer herramientas/archivos públicos de la imagen. |
| Herramientas | Shell, Node, npm, Git y ripgrep de la imagen. No hay comandos del cliente ejecutados en el controlador. No se cargan configuración MCP, reglas o AGENTS del repositorio; multiagente y búsqueda web desactivados. |
| Red | Namespace Docker `none`, solo loopback. La única salida prevista es el socket Unix de modelo, limitado a Responses para esta ejecución. No hay DNS/red general, Git remoto, instalación de paquetes ni acceso a API/base de FerWeb desde el código. |
| Modelo | Modelo fijo permitido por servidor; 1–20 peticiones admitidas y cuerpo acotado; la pasarela fija `max_output_tokens` entre 64 y 8192, `store=false` y clave de caché de ejecución. Rechaza herramientas alojadas, referencias a conversaciones/respuestas ajenas, archivos remotos y rutas arbitrarias. |
| CPU/memoria/procesos | Una CPU, 768 MiB, swap limitado al mismo total y 128 PIDs por contenedor de código. Descriptores 1024. El recolector tiene 0,5 CPU, 128 MiB, 16 PIDs y ningún privilegio/red. |
| Tiempo | 10 segundos–20 minutos desde primera asignación. Lease SQL renovable; supervisor root comprueba lease por socket cada 500 ms y sale si pierde control. El plazo también se vigila dentro del contenedor. |
| Concurrencia | Comparte los límites SQL E7: dos trabajos globales y uno por proyecto; controlador admite como máximo dos ejecuciones activas. |
| Verificación | Comando fijo `node --test`, con límite independiente de 20 segundos y salida acotada. No hay un comando de instalación definido por el repositorio. |
| Artefactos | Lectura final acotada, solo archivos regulares UTF-8; sin enlaces/especiales, hasta 100 archivos y 1 MB. Diff de texto máximo 600 KB; exceso/fallo no se presenta como diff completo. |

El código podría llamar directamente a su pasarela de modelo: no es una credencial general, pero puede consumir el cupo reservado a esa tarea. El contador y la política se aplican en el controlador también a esas peticiones. No se afirma un límite monetario exacto ni un presupuesto exacto de tokens de entrada. La aceptación real del límite de salida depende de la API/modelo configurados y sigue pendiente de prueba explícita.

Esta frontera utiliza namespaces, cgroups, montajes, usuarios y capacidades de Linux en Docker Desktop. **Comparte kernel; no es una microVM ni un entorno validado contra exploits de kernel o código hostil arbitrario.** Está destinada inicialmente a repositorios controlados. Los temporales en memoria pueden usar swap del motor/anfitrión; no se promete borrado físico seguro.

## Presupuesto compartido (P04)

Cada trabajo Codex nuevo reserva un cupo en PostgreSQL antes de entrar en la cola. Puede crear su propio presupuesto o seleccionar uno desde **Trabajos → Presupuestos compartidos de Codex**. El presupuesto padre admite hasta veinte peticiones, un plazo de diez segundos a veinte minutos y un paso activo. Los máximos de dos trabajos globales y uno por proyecto siguen aplicándose.

El primer paso inicia el plazo del padre. Los siguientes comparten ese vencimiento y reservan su máximo de peticiones al encolarse. Al terminar se libera la reserva sobrante. Las peticiones admitidas conservan su cargo interno aunque falle el proveedor o se desconozca el resultado. **Repetir con las mismas condiciones** crea un presupuesto nuevo con los mismos límites y atribución para esa ejecución explícita.

Antes de cada llamada al modelo, el controlador consulta la ruta interna de admisión, autenticada con su token de servicio. PostgreSQL valida estado, generación, lease, cancelación, plazo y reserva. Las reconsultas internas reutilizan el UUID y el hash de la petición. Un mensaje de una generación antigua queda rechazado y el controlador detiene las llamadas si pierde la autorización. La configuración del worker determina el origen interno de control; el código ejecutado recibe únicamente su pasarela de modelo.

La contabilidad clasifica cada paso como agente, coordinador, selección, resumen o revisor. Muestra reserva, peticiones admitidas, uso conocido y cobertura de reportes del proveedor. Los tokens conocidos pueden ser parciales y el coste final permanece desconocido. Las métricas de CLI siguen identificadas por separado. El modo monetario se rechaza como campo no admitido.

Cancelar un presupuesto cierra nuevas admisiones y detiene sus pasos mediante el control de la cola. Los reportes de uso de peticiones ya admitidas pueden llegar después de cancelar y se conservan de forma idempotente. La migración 013 añade la reserva y el registro de admisiones en PostgreSQL. Los trabajos antiguos sin este registro muestran su informe histórico; un trabajo pendiente anterior recibe presupuesto al asignarse. [Contrato HTTP](api.md#presupuesto-de-ejecución-p04)

## Supervisión, cancelación e informe

La pestaña Trabajos consulta eventos persistentes y resultados. Se guarda informe parcial durante la ejecución. Al cancelar se conserva la solicitud SQL, el worker pide detener al controlador, este bloquea nuevas peticiones al modelo, recoge el estado final y mata el contenedor completo, incluidos descendientes separados del shell. Se confirma la parada mediante Docker; si no puede observarse, queda desconocida. Cancelar no revierte llamadas facturables previas ni garantiza la parada/facturación remota de OpenAI.

Para obtener el diff, se **pausa el contenedor de código** y un recolector de confianza, en otro contenedor sin red y con el volumen en lectura, lee archivos regulares. El controlador calcula diferencias contra los textos iniciales. No confía en el Git, el diff ni un archivo de resultado producido por el repositorio. El diff no compara permisos. Un fallo de recogida es explícito y no implica ausencia de cambios.

Durante la recogida se bloquean nuevas llamadas al modelo y se mantiene válida la respuesta de lease del supervisor dentro del plazo ya concedido, hasta pausar/recoger y detener el contenedor. Esto evita que PID 1 salga antes de poder congelar los archivos. No amplía la lease ni el plazo de ejecución.

Resumen y comandos provienen de eventos de la CLI: son evidencia reportada por el agente, no un registro forense infalsificable frente a un proceso del mismo usuario. La verificación adicional la lanza el controlador y conserva salida/código de terminación. Los tests del propio repositorio pueden ser insuficientes; revisar cambios y criterios sigue siendo necesario.

Tiempos observados de inicio/fin/duración y número de peticiones se separan del uso reportado. La pasarela observa `response.completed` y agrega uso solo cuando se dispone del campo en todas las peticiones; mantiene cuántas lo reportaron. También se conserva el uso de `turn.completed` de Codex, etiquetado aparte. Ausencias/interrupciones son desconocidas, no cero. Coste permanece `null`: esta entrega no añade tarifas ni inventa facturación.

Tras perder worker/controlador se falla sin reejecutar código. Las leases, supervisor y limpieza al reiniciar limitan trabajo huérfano; si el controlador cae durante la pausa de recogida, puede quedar un contenedor pausado y su memoria hasta que vuelva el controlador. No se ha validado caída del kernel, disco o anfitrión como recuperación de desastre.

## Validación y aceptación real

Pruebas automáticas: [repositorio preparado](../tests/fixtures/coding-repo/src/add.cjs), [integración](../apps/api/test/coding.integration.ts), [fronteras](../apps/api/test/coding-boundaries.test.ts) y [navegador](../tests/browser/coding.spec.ts). Usan **CLI Codex real y comandos/contenedores Linux reales**, con GitHub y Responses simulados en `runner-test`; nunca seleccionados desde una petición de producción. Se reproduce un fallo de suma, se corrige, se ejecutan pruebas y se inspecciona la restricción desde código con UID 1000. Cubre cancelación, plazo, pérdida del worker, cupo, fallos y revocación. Los resultados realmente ejecutados se anotan en [status.md](status.md).

Para aceptación externa explícita: configurar una clave/modelo dedicados y un repositorio pequeño autorizado, fijar un commit sincronizado, crear una tarea acotada, elegir inicialmente pocas peticiones y un plazo corto, ejecutar desde la web y revisar informe/diff/pruebas/uso. Comprobar que el repositorio original y su rama permanecen iguales. Guardar fecha, modelo, commit y límites del ensayo; no presentarlo como prueba de otros modelos, cuentas o repositorios. Esta guía no ha realizado esa llamada por sí sola.

Referencias oficiales consultadas: [Codex no interactivo y seguridad de autenticación](https://developers.openai.com/codex/noninteractive/), [configuración de proveedores](https://developers.openai.com/codex/config-reference/), [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.51/), [tmpfs y sus límites](https://docs.docker.com/engine/storage/tmpfs/), [volúmenes locales](https://docs.docker.com/reference/cli/docker/volume/create/).
