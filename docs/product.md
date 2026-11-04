# Producto y alcance de FerWeb

## Visión

FerWeb será una web para organizar proyectos de software, reunir su contexto y dirigir trabajo asistido por IA. Conectará GitHub, modelos por API, modelos locales y ejecutores de agentes, manteniendo trazabilidad entre peticiones, fuentes, tareas, cambios y evaluaciones.

El objetivo es resolver un recorrido real: comprender una necesidad, encontrar contexto, planificar trabajo, ejecutarlo y revisar evidencias de calidad y coste.

E7 permite abrir un proyecto, encolar un trabajo simulado, seguir progreso e intentos, cerrar la web y recuperar el mismo historial o solicitar cancelación del proceso. Se prueban límites, presupuesto ficticio y recuperación antes de habilitar agentes de código. Todavía no ejecuta repositorios ni migra chat/comparativas a segundo plano. Guía: [jobs.md](jobs.md); disponibilidad comprobada: [status.md](status.md).

## Usuarios iniciales

E8 añade el recorrido **tarea → commit sincronizado → ejecución Codex separada → supervisión/cancelación → informe y diff revisables**. El perfil inicial está limitado a repositorios controlados pequeños y herramientas Node; no publica cambios ni usa automáticamente cuentas del escritorio. [Configuración y límites](codex.md).

E9 completa **revisión humana → borrador versionado → publicación explícita de rama y PR draft**, con permisos, protección de base y reconciliación de reintentos. Añade comparación y repetición de ejecuciones Codex/modelos con condiciones congeladas; sigue habiendo un solo motor de agentes. [Recorrido y límites](reviews.md).

E10 permite medir referencia amplia, recuperación, resúmenes y reutilización sobre los mismos casos y fuentes. El antes/después conserva auxiliares, costes desconocidos, caché observada y revisión humana. Solo una acción explícita respaldada por evidencia real puede activar la estrategia para chats compatibles del proyecto; las simulaciones no acreditan ahorro ni activan cambios. [Evaluación y adopción](context-optimization.md).

| Usuario | Necesidad |
| --- | --- |
| Desarrollador individual | Organizar repositorios, tareas y conversaciones sin reconstruir el contexto cada vez. |
| Desarrollador que evalúa IA | Comparar modelos locales y externos con condiciones y resultados registrados. |
| Responsable de un proyecto pequeño, posteriormente | Supervisar trabajo de agentes y aceptar cambios con pruebas y trazabilidad. |

La primera instalación será personal y de un solo propietario, con autenticación y acceso restringido. El modelo de datos asociará los recursos a ese propietario y proyecto. Registro público, invitaciones y colaboración simultánea quedan fuera del MVP.

E2 ya implementa este acceso mediante CLI de propietario y sesión, la gestión de proyectos y el tablero de tareas. Un proyecto archivado conserva las tareas y permite consultarlas; se restaura antes de editar. El estado real y las evidencias se mantienen en [status.md](status.md).

E3 añade conexión con GitHub App, instalación y repositorio por proyecto, exploración de código por commit, issues/PR y actualización manual. Requiere configuración privada del servidor y autorización del usuario; no publica cambios en GitHub. La aceptación con GitHub real queda pendiente de configurar una App y una instalación autorizadas. Ver [github.md](github.md).

E4 incorpora conversaciones persistentes por proyecto con modelo/proveedor fijos, respuesta incremental, cancelación y consulta de errores, configuración, tiempos y uso reportado. Los datos ausentes se presentan como desconocidos. El modo local no deriva a OpenAI. E5 añade índice incremental y contexto GitHub opt-in con fuentes, exclusiones y embeddings exclusivamente locales; ver [retrieval.md](retrieval.md). Los adaptadores están probados con respuestas simuladas; inferencia real y hardware siguen pendientes. Ver [ai.md](ai.md).

## Problemas que resolver

E6 incorpora el laboratorio con casos y mensajes congelados, modelos/repeticiones, tarifas fechadas, errores, métricas disponibles, revisiones humanas auditadas y exportación JSON/CSV. Las comprobaciones automáticas son sugerencias revisables; los resultados aceptables se determinan por revisión humana. La aceptación con modelos reales y presupuesto verificado sigue pendiente, según [laboratory.md](laboratory.md).

- Contexto disperso entre código, issues, documentos y chats.
- Dificultad para conocer qué fuentes respaldan una respuesta de IA.
- Comparaciones de modelos que no conservan condiciones, calidad ni coste total.
- Ejecuciones de agentes difíciles de supervisar, cancelar y revisar.
- Consumo creciente de contexto y tokens sin medir si aporta mejores resultados.

## Recorridos principales

### Organizar y comprender un proyecto

El propietario crea un proyecto, registra tareas y conecta un repositorio de GitHub. Consulta archivos, issues y PR. Abre un chat, selecciona proveedor y modelo, y pregunta por una parte del proyecto. La respuesta enlaza las fuentes y el commit consultado.

### Comparar modelos

El usuario define una pregunta, congela el contexto y establece criterios de evaluación. Ejecuta varios modelos, revisa las respuestas y compara calidad, tiempos, errores, consumo disponible y coste estimado. El historial conserva configuración, fuentes y repeticiones.

### Delegar una tarea, después del MVP

El usuario parte de una tarea y un commit. Un agente trabaja en un espacio separado, informa de progreso y entrega un diff y resultados de pruebas. El usuario revisa los cambios y puede publicar una PR mediante una acción explícita.

### Optimizar con evidencias

El usuario compara estrategias de contexto y reutilización con el mismo conjunto de evaluación. Valora ahorro y calidad, incluyendo el trabajo auxiliar y los reintentos. Puede identificar cuándo una estrategia más barata empeora el resultado.

## MVP: primera versión útil

El MVP se considera cerrado al completar las entregas E1 a E6 del [roadmap](roadmap.md):

- Acceso autenticado del propietario y separación de datos por proyecto.
- Proyectos y tareas persistentes, con prioridades, estados y criterios de aceptación.
- GitHub App para conectar repositorios y consultar código, issues y PR en modo lectura.
- Chats persistentes con selección de un proveedor OpenAI y un proveedor local Ollama.
- Consulta del contexto del repositorio con referencias verificables a fuentes y commit.
- Comparación básica de modelos con condiciones guardadas, revisión humana y métricas disponibles.
- Entorno reproducible con Docker Compose y documentación comprobada de instalación.

Una conexión local funcional y otra por API requieren configuración y validación real. Los dobles de prueba permiten desarrollar, pero no sustituyen esa aceptación.

## Después del MVP

- Trabajos duraderos, ejecución de agentes e integración con Codex.
- Revisión de cambios y publicación de PR.
- Comparación de agentes completos, además de modelos.
- Optimización de contexto, caché y presupuestos con evaluaciones versionadas.
- Despliegue, observabilidad, copias y recuperación probadas.
- Coordinación de varios agentes, selector de modelos con ML y Kubernetes.

## Fuera del alcance inicial

- Importar automáticamente el historial de chats de otras aplicaciones. Los chats de FerWeb pertenecen a su propia persistencia.
- Entrenar modelos fundacionales o prometer resultados equivalentes entre proveedores.
- Registro público, facturación, marketplace de agentes o soporte empresarial multiusuario.
- Conceder acceso indiscriminado a cuentas, repositorios o archivos del equipo.
- Ejecutar código de terceros en un servicio público sin haber validado el aislamiento.
- Añadir lenguajes y almacenes solo para reproducir todos los nombres de una oferta laboral.

## Requisitos transversales

- El usuario conoce qué proyecto, fuentes, modelo y destino de procesamiento se usan.
- El modo local requiere inferencia y embeddings locales; un evaluador externo se habilita por separado. No habrá fallback externo silencioso.
- Los datos privados solo se procesan según permisos y política del proyecto.
- Las operaciones largas muestran estado, errores y posibilidad de cancelación cuando esté implementada.
- Las métricas desconocidas se presentan como tales. Las estimaciones muestran supuestos y fecha.
- Las fuentes y las evaluaciones quedan vinculadas a versiones reproducibles.
- Los recorridos contemplan carga, vacío, error y navegación por teclado.

## Cómo valorar el producto

| Objetivo | Evidencia prevista |
| --- | --- |
| Entender un repositorio | Respuestas comprobadas contra preguntas y fuentes esperadas. |
| Organizar trabajo | Recorrido completo de creación, actualización y consulta de tareas. |
| Comparar con rigor | Casos repetibles, condiciones congeladas y valoraciones revisables. |
| Controlar consumo | Uso y coste por ejecución, incluidos pasos auxiliares cuando estén disponibles. |
| Entregar cambios útiles | Requisitos satisfechos, pruebas y revisión del diff. |
| Ser instalable | Arranque desde un clon limpio y persistencia comprobada. |

Todavía no hay resultados ni objetivos numéricos de rendimiento. Se fijarán umbrales con las primeras mediciones y casos de uso.

## Dudas que condicionan las siguientes fases

| Duda | Supuesto inicial y momento de resolución |
| --- | --- |
| Recursos del equipo: CPU, RAM y GPU | Consultarlos antes de elegir el modelo local en E4. No se presupone GPU. |
| Cuenta GitHub y acceso a repositorios privados | GitHub App personal; concretar repositorio de prueba y permisos en E3. |
| Clave y presupuesto de API | Configuración local de servidor y presupuesto acotado antes de la validación real en E4/E6. |
| Destino de despliegue | Desarrollo local primero; decidir alojamiento y dominio en E11. |
| Necesidad de compartir con otras personas | Instancia personal inicialmente; revisar antes de ampliar autenticación y permisos. |
| Material permitido para evaluación | Usar fixtures públicos o sintéticos; acordar tratamiento de repositorios privados antes de usarlos. |

Estas dudas no bloquean la documentación ni la base Docker. Las decisiones se revisarán con evidencia al alcanzar su entrega.
