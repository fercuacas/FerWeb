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
| Red | Namespace Docker `none`, solo loopback. La pasarela por trabajo admite Responses y, para especialistas P07, mensajes/inbox de ese equipo. No hay DNS/red general, Git remoto, instalación de paquetes ni acceso general a API/base de FerWeb desde el código. |
| Modelo | Modelo fijo permitido por servidor; 1–20 peticiones admitidas y cuerpo acotado; la pasarela fija `max_output_tokens` entre 64 y 8192, `store=false` y clave de caché de ejecución. Rechaza herramientas alojadas, referencias a conversaciones/respuestas ajenas, archivos remotos y rutas arbitrarias. |
| CPU/memoria/procesos | Una CPU, 768 MiB, swap limitado al mismo total y 128 PIDs por contenedor de código. Descriptores 1024. El recolector tiene 0,5 CPU, 128 MiB, 16 PIDs y ningún privilegio/red. |
| Tiempo | 10 segundos–20 minutos desde primera asignación. Lease SQL renovable; supervisor root comprueba lease por socket cada 500 ms y sale si pierde control. El plazo también se vigila dentro del contenedor. |
| Concurrencia | Dos trabajos globales y uno por proyecto por defecto; P07 admite dos especialistas del mismo equipo con configuración explícita. El controlador admite como máximo dos ejecuciones activas. |
| Verificación | Comando fijo `node --test` para escritores; verificador de snapshot/montaje para especialistas P07. Límite independiente de 20 segundos y salida acotada. No hay un comando de instalación definido por el repositorio. |
| Artefactos | Lectura final acotada, solo archivos regulares UTF-8; sin enlaces/especiales, hasta 100 archivos y 1 MB. Diff de texto máximo 600 KB; exceso/fallo no se presenta como diff completo. |

El código podría llamar directamente a su pasarela de modelo: no es una credencial general, pero puede consumir el cupo reservado a esa tarea. El contador y la política se aplican en el controlador también a esas peticiones. No se afirma un límite monetario exacto ni un presupuesto exacto de tokens de entrada. La aceptación real del límite de salida depende de la API/modelo configurados y sigue pendiente de prueba explícita.

Esta frontera utiliza namespaces, cgroups, montajes, usuarios y capacidades de Linux en Docker Desktop. **Comparte kernel; no es una microVM ni un entorno validado contra exploits de kernel o código hostil arbitrario.** Está destinada inicialmente a repositorios controlados. Los temporales en memoria pueden usar swap del motor/anfitrión; no se promete borrado físico seguro.

## Presupuesto compartido (P04)

Cada trabajo Codex nuevo reserva un cupo en PostgreSQL antes de entrar en la cola. Puede crear su propio presupuesto o seleccionar uno desde **Trabajos → Presupuestos compartidos de Codex**. El presupuesto padre admite hasta veinte peticiones, un plazo de diez segundos a veinte minutos y un paso activo. Los máximos de dos trabajos globales y uno por proyecto siguen aplicándose.

El primer paso inicia el plazo del padre. Los siguientes comparten ese vencimiento y reservan su máximo de peticiones al encolarse. Al terminar se libera la reserva sobrante. Las peticiones admitidas conservan su cargo interno aunque falle el proveedor o se desconozca el resultado. **Repetir con las mismas condiciones** crea un presupuesto nuevo con los mismos límites y atribución para esa ejecución explícita.

Antes de cada llamada al modelo, el controlador consulta la ruta interna de admisión, autenticada con su token de servicio. PostgreSQL valida estado, generación, lease, cancelación, plazo y reserva. Las reconsultas internas reutilizan el UUID y el hash de la petición. Un mensaje de una generación antigua queda rechazado y el controlador detiene las llamadas si pierde la autorización. La configuración del worker determina el origen interno de control; el código ejecutado recibe únicamente su pasarela de modelo.

La contabilidad clasifica cada paso como agente, coordinador, selección, resumen o revisor. Muestra reserva, peticiones admitidas, uso conocido y cobertura de reportes del proveedor. Los tokens conocidos pueden ser parciales y el coste final permanece desconocido. Las métricas de CLI siguen identificadas por separado. El modo monetario se rechaza como campo no admitido.

Cancelar un presupuesto cierra nuevas admisiones y detiene sus pasos mediante el control de la cola. Los reportes de uso de peticiones ya admitidas pueden llegar después de cancelar y se conservan de forma idempotente. La migración 013 añade la reserva y el registro de admisiones en PostgreSQL. Los trabajos antiguos sin este registro muestran su informe histórico; un trabajo pendiente anterior recibe presupuesto al asignarse. [Contrato HTTP](api.md#presupuesto-de-ejecución-p04)

## Equipos y planes (P05)

En **Agentes → Equipos y plantillas** puedes crear un workflow propio o partir de tres presets secuenciales: implementar y revisar, investigar y responder, y revisar un diff. P07 añade **Especialistas y resumen**. Asigna a cada etapa un rol y su versión de este proyecto, capacidades, criterios de salida, dependencias y máximo de peticiones. El catálogo conserva hasta cincuenta plantillas por proyecto y cincuenta versiones por plantilla; archivar impide nuevas preparaciones y conserva el historial.

El servidor valida un DAG de una a seis etapas: rechaza claves repetidas, ciclos, referencias ausentes, roles ajenos/archivados y capacidades o skills incompatibles. Cada workflow admite de una a tres iteraciones. El producto de iteraciones por peticiones de todas las etapas debe caber en el presupuesto padre de P04: hasta veinte peticiones, diez segundos a veinte minutos y concurrencia uno por defecto. P07 permite solicitar dos exclusivamente para especialistas de solo lectura, con configuración explícita del proyecto. Los presets son definiciones propias de FerWeb; requieren roles del proyecto y no conceden permisos ni instalan herramientas.

Desde **Tareas** o **Trabajos → Preparar y aprobar planes**, elige tarea, plantilla/versiones, modelo y modo. La clasificación orientativa usa longitud de la descripción y número de criterios: pequeña hasta 800 caracteres y tres criterios; mediana hasta 4.000 y diez; el resto grande. Automático recomienda una sola etapa para las pequeñas y equipo para las demás. Puedes elegir el equipo completo o una etapa específica como agente único. En automático, la etapa única es la primera del orden topológico; sus dependencias se eliminan de la copia efectiva, conservando la plantilla completa como procedencia.

La vista previa muestra destino de inferencia y capacidades verificadas, etapas, iteraciones, plazo y peticiones máximas previstas. **Preparar no consume inferencia, crea trabajos ni reserva presupuesto.** Coste y tokens previstos permanecen desconocidos. Un ejecutor sin configurar permite guardar una preparación bloqueada, que debe prepararse de nuevo cuando esté disponible.

La migración 014 guarda en PostgreSQL la plantilla versionada y una copia inmutable de la tarea/criterios, etapas ordenadas, roles, textos y hashes de skills aprobadas, modelo, configuración/destino del ejecutor y límites. Cada plan tiene SHA-256 de su JSON canónico. La aprobación explícita requiere revisar esa copia, enviar su hash/versión y confirmar que la configuración de ejecución sigue vigente. Cambiar fuentes no reescribe copias anteriores: una preparación nueva genera otro hash y empieza sin aprobación. Una aprobación histórica solo corresponde a su copia; no autoriza fuentes modificadas ni otro plan.

La API solo admite los campos declarados; un plan propuesto por IA sigue siendo datos sujetos a esas validaciones. No puede introducir rutas, herramientas o permisos. P05 conserva `codex-v1`; el descriptor separa proveedor, runtime y perfil para incorporar otras implementaciones por capacidades verificadas. Preparar y aprobar no ejecuta: la acción explícita de P06 crea una ejecución separada y asocia su UUID en `executionId`. La interfaz distingue preparado, aprobado e iniciado; el estado final pertenece a la ejecución.

Pruebas: [integración](../apps/api/test/coding.integration.ts) y [recorrido Chromium](../tests/browser/teams.spec.ts), con proveedor simulado. Cubren preparación/aprobación, versiones y material congelado, permisos, DAG inválido, incompatibilidad, presupuesto excedido y ejecutor bloqueado. [Contrato HTTP](api.md#equipos-y-planes-p05)

## Equipo secuencial duradero (P06)

Desde el detalle de un plan aprobado, en **Tareas** o **Trabajos → Preparar y aprobar planes**, revisa el commit sincronizado, confirma la ejecución y pulsa **Ejecutar equipo secuencial**. Modelo, roles/skills, etapas, criterios, capacidades y límites proceden de la copia aprobada. El servidor revalida su hash, aprobación, tarea, plantilla y materiales, el descriptor actual del ejecutor y el repositorio autorizado. Un plan solo crea una ejecución; para repetir, prepara y aprueba otra copia. Cambiar el controlador o su política invalida la configuración anterior y exige preparar de nuevo.

La migración 015 añade padre, etapas, entregas y eventos en PostgreSQL. El padre no es un trabajo `jobs` ni reclama un slot: un coordinador determinista del worker consulta su estado mediante una ruta interna autenticada. Solo las etapas Codex entran en la cola y consumen los límites vigentes de dos trabajos globales y uno por proyecto, salvo la excepción explícita de especialistas de P07. Se admite un equipo activo y hasta mil guardados por proyecto. La creación del hijo, su reserva P04, la asociación de etapa y el evento padre son atómicos. Dos coordinadores pueden consultar el mismo padre sin duplicar trabajos gracias a bloqueos y UUID de petición por etapa.

P06 ejecuta **una pasada secuencial en orden topológico**, de una a seis etapas. `maxIterations` conserva el techo aprobado; no obliga a repetir ni activa un bucle de corrección automática. No hay delegación interna de Codex ni inferencia del coordinador. El plazo del presupuesto empieza con la primera etapa y se conserva entre etapas y reinicios. Las peticiones de cada hijo se atribuyen a agente o revisión según sus capacidades declaradas; el coste y las métricas ausentes siguen siendo desconocidos.

Cada etapa parte de la salida de archivos de la anterior, incluso cuando no hay dependencia directa: P06 mantiene una sola cadena de trabajo. Las dependencias de aceptación deben estar verificadas antes de encolar el siguiente hijo. El controlador pausa el código y recoge archivos regulares UTF-8 en el contenedor recolector de lectura. Una ruta interna con token y generación entrega al worker esa instantánea acotada; se guarda en `coding_runs.output_files`, sin incluirla en el DTO público. El servidor valida rutas, duplicados y límites y verifica el hash de la entrega antes de usarla. Se conservan los límites existentes de cien archivos, 200 kB por archivo y 1 MB total; una recogida incompleta o demasiado grande bloquea el avance.

La entrega guarda UUID del hijo, etapa, resumen reportado, fuentes y SHA-256, hashes canónicos de entrada/salida, pruebas del controlador y dudas/limitaciones. El siguiente agente recibe esas entregas como datos sin autoridad, además de la instantánea recogida. Avanzar requiere trabajo completado, recogida completa, parada física confirmada, archivos disponibles y prueba independiente del controlador con salida cero. La frase de un agente que afirma haber terminado no cumple estas condiciones. **Completado describe el recorrido técnico, no acredita todos los criterios de producto ni marca la tarea como hecha**; esa revisión sigue siendo humana.

Se revalidan tarea, versiones seleccionadas, revisión de skills, configuración del ejecutor y permisos/versión del enlace GitHub entre etapas. El hijo vuelve a comprobar acceso y condiciones durante su ejecución. Cambiar la tarea, archivar proyecto/rol, retirar acceso o agotar cupo/plazo impide continuar. El padre conserva estados `pending/running/completed/failed/cancelled`, motivo y secuencia de eventos. Un fallo del revisor es terminal; no repite implementación ni abre un bucle de inferencia.

Cancelar el padre cierra su presupuesto y nuevas etapas, solicita detener al hijo y espera su estado terminal. Conserva informes parciales, consumo y confirmación de parada nullable. Si desaparece un worker durante código, sigue la política E8: vence la lease, se falla explícitamente y no se reejecuta. Si desaparece entre etapas, otro worker retoma únicamente la coordinación SQL pendiente, sin repetir hijos confirmados. Las escrituras de coordinación son cortas y no mantienen bloqueos durante llamadas de red.

En **Trabajos → Equipos en segundo plano** se recuperan el mismo UUID, plan, pasos, eventos, entregas, presupuesto e informes después de recargar. Las entregas e informes requieren acceso GitHub revalidado; un error oculta los datos privados y permite reintentar. El historial y la cancelación siguen disponibles para proyectos archivados. Los trabajos `codex-v1` anteriores conservan sus informes. Los hijos de equipo no admiten repetición ni publicación individual de PR: la revisión/publicación agregada queda para fases posteriores.

Las pruebas de [integración](../apps/api/test/coding.integration.ts) y [Chromium](../tests/browser/team-execution.spec.ts) utilizan CLI Codex, comandos, SQL y contenedores reales con Responses/GitHub simulados. Cubren entrega real de implementación a revisión, persistencia, idempotencia, cancelación, pérdida de worker, cambio de tarea, revocación, fallo del revisor y cupo. No acreditan modelos externos ni ejecución local de agentes. [Contrato HTTP](api.md#equipos-en-ejecución-p06)

## Especialistas y mensajes (P07)

En **Agentes → Equipos y plantillas**, el preset **Especialistas y resumen** crea dos etapas independientes y un resumen que depende de ambas. La estrategia `specialists` admite entre dos y cuatro especialistas y una etapa final de reunión, todos de solo lectura y en una pasada. El editor permite solicitar concurrencia uno o dos. Las versiones de rol/skills deben admitir `node-readonly-v1` y no requerir `workspaceWrite`; el servidor rechaza las incompatibles antes de empezar. La revisión 2 de las plantillas de rol añade ese perfil a los roles sin escritura. Las versiones existentes se conservan: crea una versión compatible o copia una plantilla actualizada.

La configuración de cada proyecto empieza en **uno**, incluidos los proyectos anteriores a la migración 016. Para permitir dos, selecciona **Límite del proyecto → 2 especialistas**, confirma y guarda la configuración. No se puede cambiar mientras exista un equipo activo. El plan congela el máximo solicitado y solo arranca si el proyecto lo permite. La cola mantiene el máximo global **dos**, contando cada hijo, y permite coincidir únicamente a especialistas de solo lectura del **mismo equipo**. Otros equipos, escritores, simulaciones y trabajos independientes conservan la exclusión por proyecto. El presupuesto comparte cupo/plazo y también limita la concurrencia; la API genérica P04 sigue rechazando presupuestos públicos con concurrencia dos.

La frontera es de filesystem, no un prompt: un contenedor inicializador de confianza escribe los archivos validados y mantiene montado el volumen temporal hasta que el consumidor lo monta como **solo lectura**. El controlador retira el inicializador antes de ejecutar al agente, que no conserva un montaje de escritura alternativo. Se mantienen usuario 1000, raíz de lectura, red `none`, capacidades eliminadas para el agente, supervisor independiente y ausencia de socket Docker/credenciales generales. `/tmp` y el directorio privado de Codex son temporales de cada hijo; no son fuentes compartidas. El controlador verifica de nuevo el snapshot y rechazos `EROFS` para modificar, crear, borrar, renombrar, cambiar permisos, crear directorios y enlaces. El informe registra `controller-readonly-verification`, diff vacío y hashes de los archivos. Las pruebas del repositorio pueden fallar por un defecto que el especialista está investigando; esa verificación de fuentes no se presenta como aprobación de los criterios de producto. [Montajes de solo lectura de Docker](https://docs.docker.com/engine/storage/volumes/#use-a-read-only-volume).

Cada especialista recibe el mismo snapshot original, sin incorporar cambios ni resultados implícitos de su hermano. El resumen se encola únicamente después de las entregas técnicas verificadas de todas sus dependencias. Recibe esas entregas como datos y conserva su propia reserva e informe. **Resultados reunidos** muestra recibidos, ausentes, resumen nullable y conflictos. Un fallo o cancelación impide una recogida completa, detiene otros hijos y conserva sus evidencias; no crea un resumen que aparente contar con participantes ausentes. Una finalización técnica no concede aprobación humana ni publica PRs.

Los mensajes `handoff/query/response/completion/conflict` viven en PostgreSQL, con UUID, secuencia, remitente/destinatario de etapa, origen y fecha. El agente solo conoce los IDs de sus participantes y una pasarela local por trabajo. El controlador añade su generación y token al reenviar, sin entregárselos al código. El servidor obtiene identidad, ejecución y proyecto desde el hijo admitido y verifica estado, lease, plazo, cancelación, acceso GitHub y destinatario del mismo equipo. Una respuesta debe referenciar una consulta dirigida al remitente actual y volver a su autor. Texto e identidad declarados dentro del cuerpo no sustituyen esas comprobaciones; los campos de identidad adicionales se rechazan.

Cada mensaje tiene un destinatario o el coordinador, hasta 2.000 caracteres/8 kB de texto y un UUID de petición. Se permiten hasta **16 mensajes por hijo y 80 de agentes por ejecución**, más hasta veinte del coordinador. Repetir el mismo UUID/cuerpo conserva el registro; otras condiciones producen conflicto. Un emisor antiguo, un destinatario ajeno y mensajes fuera de cuota se rechazan. Las entregas del servidor conservan procedencia técnica; el texto enviado por un agente siempre tiene `verified=false`. Un mensaje de finalización no termina un trabajo ni amplía permisos. Los conflictos reportados permanecen visibles e impiden presentar una recogida sin reservas.

**Trabajos → Equipo → Mensajes del equipo** recupera mensajes por cursor, en páginas de cincuenta, sin duplicados al recargar. Un error oculta la copia privada y ofrece reintento. No hay inbox en archivos del anfitrión. La delegación interna de la CLI sigue desactivada y la pasarela rechaza herramientas de delegación anidada. La coordinación permanece determinista, sin inferencia oculta ni escritores paralelos.

Pruebas: [integración](../apps/api/test/coding.integration.ts), [fronteras](../apps/api/test/coding-boundaries.test.ts) y [Chromium](../tests/browser/specialists.spec.ts). El entorno desechable configura dos explícitamente y usa CLI/comandos/contenedores reales con proveedor simulado. La capacidad de modelos externos o locales no se infiere de estas pruebas. [Contrato HTTP](api.md#especialistas-y-mensajes-p07)

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
