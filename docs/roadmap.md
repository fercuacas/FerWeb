# Roadmap por entregas

## Uso

Implementar en orden y cerrar cada entrega contra sus criterios. Si una entrega resulta grande, dividirla por recorridos verificables antes de empezar. [status.md](status.md) es la fuente del progreso real; este documento describe el plan.

No se fijan fechas sin conocer disponibilidad, hardware y resultados. La infraestructura crece con las funciones. Las pruebas automáticas no consumirán APIs de pago ni escribirán en cuentas externas por defecto.

## E0. Definición inicial

- Alcance: producto, arquitectura, reglas, estado y hoja de ruta.
- Aceptación: nombre FerWeb consistente, MVP delimitado, documentos enlazados, decisiones y dudas registradas.
- Evidencia: revisión de documentos, enlaces locales y whitespace.

## E1. Base ejecutable con Docker

- Crear web React/TypeScript, API Express/TypeScript y PostgreSQL.
- Elegir versiones compatibles, gestor de paquetes y lockfile; documentar requisitos del equipo.
- Añadir Compose, Dockerfiles, `.env.example`, comprobaciones de salud, migraciones y volúmenes.
- Mostrar en la web el estado de la API sin exponer detalles sensibles.
- Aceptación: un clon limpio puede arrancar siguiendo el README; la API espera una base preparada; una migración funciona y los datos sobreviven a un reinicio normal.
- Validación: compilación, configuración Compose, arranque real y comprobación de salud. No borrar volúmenes del usuario.

## E2. Propietario, proyectos y tareas

- Provisionar al propietario y su sesión, sin registro público.
- Crear, editar y archivar proyectos; gestionar tareas y criterios de aceptación.
- Incorporar tablero, filtros y estados de carga, vacío y error.
- Aceptación: recorrido completo persistente; acceso no autenticado rechazado y autorización comprobada ante identificadores de recursos ajenos con fixtures de prueba.
- Validación: reglas, persistencia y recorrido web; comprobar uso básico por teclado.

## E3. GitHub en lectura

- Conectar una GitHub App, seleccionar repositorio permitido y vincularlo al proyecto.
- Mostrar archivos, issues y PR; registrar commit y estado de sincronización.
- Añadir actualización manual y los webhooks necesarios, con firma y deduplicación.
- Aceptación: un repositorio autorizado se consulta; el acceso denegado se comunica; la revocación impide seguir usando datos; un webhook repetido no duplica cambios.
- Validación: dobles para API, firma, errores y permisos; comprobación real con un repositorio de prueba configurado por el propietario.

## E4. Chat con API y modelo local

- Crear servicio Python y adaptadores de OpenAI y Ollama.
- Añadir chats persistentes, selección de capacidades, streaming, errores y cancelación.
- Registrar configuración, tiempos y uso disponible. Gestionar credenciales en servidor.
- Inspeccionar hardware antes de elegir un modelo local; verificar la conexión anfitrión/contenedores.
- Aceptación: ambos proveedores responden en una configuración real; cancelar detiene el trabajo o muestra explícitamente la limitación del proveedor; el modo local no deriva a API externa.
- Validación: proveedor simulado en tests, fallos de red y validación real separada y acotada. Sin credenciales/hardware, la entrega conserva ese criterio pendiente.

## E5. Contexto del repositorio y fuentes

Implementación y evaluación de integración en [retrieval.md](retrieval.md); el estado y las evidencias ejecutadas se registran en [status.md](status.md). La calidad semántica con un embedding real se acepta por separado.

- Añadir Qdrant, ingesta autorizada, fragmentación, embeddings e indexación incremental.
- Aplicar exclusiones, límites, procedencia y política local/externa del proyecto.
- Recuperar fuentes para el chat y enlazarlas a ruta y commit.
- Aceptación: preguntas de prueba recuperan fuentes esperadas; un cambio de archivo actualiza el contexto; fuentes excluidas, revocadas o de otro proyecto no aparecen; se comunica información insuficiente.
- Validación: fixtures públicos/sintéticos, casos de recuperación, actualización y permisos. Registrar modelo de embeddings y procedimiento de reindexado.

## E6. Comparación de modelos y cierre del MVP

El laboratorio se implementa según [laboratory.md](laboratory.md); la evidencia realmente ejecutada está en [status.md](status.md). El cierre externo del MVP sigue condicionado a pruebas reales con modelos, fuentes y presupuesto elegidos por el propietario.

- Definir casos, contexto congelado, configuración, criterios y repeticiones.
- Mostrar respuestas, calidad revisada, errores, latencia, uso y coste estimado fechado.
- Añadir exportación y separar datos observados de estimaciones.
- Aceptación: un caso puede repetirse con un modelo local y uno por API sin cambiar contexto; los resultados se revisan y conservan condiciones; no se inventan métricas no reportadas.
- Validación: comprobar cálculos y datos ausentes; ejecutar un conjunto real pequeño con presupuesto definido.
- Hito: demostración completa del MVP E1–E6 con un repositorio y contenido autorizados.

## E7. Trabajos persistentes y ejecutor simulado

Implementada y validada en Docker con procesos reales del simulador y base desechable. Evidencias en [status.md](status.md), contratos y límites en [jobs.md](jobs.md). Chat y laboratorio no se han migrado a la cola; código/Codex pertenecen a E8.

- Cola transaccional PostgreSQL; no se necesita Redis ni publicación a otro broker.
- Añadir estados, intentos, progreso, plazos, cancelación y límites de concurrencia.
- Resolver coherencia entre estado persistido y entrega a la cola; detectar ejecutores desconectados.
- Aceptación: un trabajo simulado sobrevive a reinicios de API/worker; los duplicados se controlan; un trabajo perdido puede recuperarse; cancelar alcanza al proceso de trabajo.
- Validación: reinicios, cortes entre persistencia/publicación, redelivery, fallo y cancelación. Distinguir errores transitorios y terminales.

## E8. Primer agente de código con Codex

Implementado mediante CLI Codex oficial fijada, controlador Docker y pasarela sin claves en el código. Validación y límites reales en [codex.md](codex.md); evidencia ejecutada en [status.md](status.md). La aceptación externa con modelo y GitHub reales permanece separada.

- Verificar interfaz, autenticación y capacidades vigentes; integrar mediante adaptador del runner.
- Fijar commit y tarea; preparar espacio limitado; recopilar diff, comandos y pruebas.
- Validar política de archivos, red, recursos, secretos y cancelación antes de ejecutar código.
- Aceptación: un repositorio controlado recibe un cambio revisable sin alterar su rama original; los límites efectivos están comprobados y descritos; el código no accede al socket Docker ni a credenciales generales.
- Validación: repositorio de prueba preparado, pruebas del resultado, fallo, plazo y cancelación. No abrir ejecución pública arbitraria.

## E9. Revisión, PR y comparación de agentes

Implementación de revisión/publicación y comparación de ejecuciones Codex disponible; aceptación externa pendiente de configuración. No se incorpora un segundo motor de agentes. Protocolo en [reviews.md](reviews.md); evidencia ejecutada en [status.md](status.md).

- Añadir visor de diff y evidencias; asociar ejecución con tarea y pruebas de aceptación.
- Publicar rama/PR mediante acción explícita, permisos específicos e idempotencia.
- Comprobar cambios de la base entre ejecución y publicación; no hacer merge automático inicial.
- Añadir comparación de agentes con mismo commit, herramientas y límites.
- Aceptación: publicar dos veces no duplica PR; base desactualizada produce un resultado manejado; la evaluación usa condiciones registradas y un segundo ejecutor si se afirma comparar agentes distintos.
- Validación: dobles de GitHub y, de forma explícita, un repositorio de prueba; probar errores y reintentos sin escribir en repositorios de producción.

## E10. Optimización de contexto y tokens

Implementación de estrategias versionadas, contabilidad/panel e invalidación/adopción condicionada a evidencia disponible; medición real pendiente de configuración y revisión humana. No hay una mejora real adoptada a partir de fixtures. [Protocolo](context-optimization.md); [evidencias ejecutadas](status.md).

- Versionar estrategias: contexto amplio acotado, recuperación, resúmenes y reutilización.
- Incorporar caché solo según capacidades del proveedor e invalidación por fuente, proyecto, permisos y configuración.
- Medir uso, latencia, coste y calidad incluyendo pasos auxiliares y reintentos.
- Aceptación: informe reproducible antes/después; distingue menos tokens de descuento por caché y documenta pérdidas de calidad; un cambio relevante invalida resultados reutilizados.
- Validación: conjunto de evaluación congelado, varias repeticiones y revisión de las respuestas. Adoptar estrategias según evidencia, sin promesas previas de ahorro.

## E11. Operación y demostración

Implementación y evidencia vigente en [revisión de release](release-review.md); preparación no equivale a publicación autorizada.

- Completar CI, imágenes reproducibles y configuración de despliegue Compose.
- Añadir correlación de registros, métricas operativas y trazas necesarias.
- Definir migraciones, copias/restauración, configuración de secretos y recuperación.
- Preparar README en inglés, guía de demo y revisión de permisos/exposición.
- Aceptación: instalación limpia reproducible, copia restaurada en entorno de prueba y carga medida con condiciones y límites publicados. El despliegue preparado debe corresponder a lo probado.
- Validación: recorrido completo, fallos seleccionados y prueba de carga acotada. Publicación externa como acción autorizada, no como efecto de tests.

## Ampliaciones posteriores

| Ampliación | Condición y aceptación |
| --- | --- |
| Coordinación de varios agentes | Comparar un agente frente a desarrollador/verificador con iguales límites; medir calidad, tiempo y coste total. |
| ML para seleccionar proveedor/modelo | Datos suficientes, separación temporal o por tarea entre entrenamiento/evaluación y comparación con reglas sencillas; registrar versiones y degradaciones. |
| Kubernetes | Necesidad operativa o entrega de aprendizaje explícita; probar despliegue, recuperación y escalado con carga definida. |
| Ejecutor del PC desde web remota | Conector autenticado saliente, reconexión, autorización de trabajos y trazabilidad del destino. |
| MongoDB o gRPC | Caso concreto documentado y coste operativo evaluado; no requisito para cerrar el MVP. |
| Equipos y colaboración | Definir membresías y roles, migrar el modelo personal y probar aislamiento antes de habilitar invitaciones. |

## Protocolo de cada entrega

1. Leer estado, inspeccionar código y preservar trabajo existente.
2. Confirmar criterios aplicables y decidir dependencias mínimas.
3. Implementar el recorrido y las verificaciones proporcionales.
4. Registrar lo probado, lo pendiente y las limitaciones en `status.md`.
5. Revisar diff, secretos, artefactos y `git diff --check`.
6. Presentar cómo usar el resultado y el siguiente paso concreto.
