# Comparar Codex API y local y elegir por reglas (P21)

## Comparar ejecuciones en el Laboratorio

1. Ejecuta dos trabajos individuales con la misma versión de tarea y el mismo commit, rol, skills, memoria, perfil y límites. Elige **API de OpenAI** en uno y **Ollama local** en el otro desde **Trabajos → Nueva tarea con Codex**. Revisa el contexto P10 de ambos si lo utilizas. Cada trabajo usa su propio presupuesto con los mismos límites.
2. Abre **Laboratorio → Comparación Codex API y Ollama local**. Selecciona los dos trabajos terminados. El caso **Informes registrados** recoge la evidencia disponible. La **Fixture de suma v1** es el caso controlado de P13 y aplica la misma verificación determinista a ambos cambios sobre el defecto previsto. Puedes registrar el hardware observado del equipo local.
3. Guarda la comparación y abre sus resultados. Se indica si la tarea, criterios, repositorio, archivos, herramientas, contexto, límites y condición real o simulada coinciden. Modelo y destino son las variables de la comparación. El informe conserva revisiones observadas, versión de Codex y de Ollama cuando constan, pruebas independientes, tiempos y uso disponible. Un par con diferencias se puede inspeccionar y exportar con sus discrepancias.
4. **Exportar comparación API/local JSON** descarga la evidencia, huellas y referencias a los trabajos. Se comprueban los permisos sobre ambos orígenes al consultar o exportar. En un proyecto archivado puedes consultar y exportar comparaciones guardadas.

La migración 029 conserva el par, el caso y su evidencia con huella. Guardar el mismo par y caso con la misma evidencia recupera la comparación existente. Los datos de hardware son declarados por el operador. Los tokens se muestran por brazo y con su cobertura y no se usan para ordenar proveedores con tokenizadores distintos. El coste total queda desconocido en ambos brazos. En local siguen existiendo costes de hardware y energía.

## Preparar un plan con selección por reglas

En **Preparar y aprobar planes**, elige tarea y plantilla. **Reglas con API de OpenAI** respeta una plantilla API y permite acotar peticiones externas. **Reglas con Ollama local** respeta una plantilla de código local y fija ese cupo a cero. El motor de especialistas de texto conserva el [recorrido P19](local-specialists.md).

**Mixto por etapas** está disponible para un equipo secuencial completo con al menos dos etapas de una plantilla API. Elige el destino de cada etapa y un modelo concreto o el primer modelo permitido por orden de identificador. Selecciona un cupo externo que cubra las peticiones de las etapas asignadas a la API. Los perfiles especializados y la revisión por dimensiones mantienen las políticas de sus plantillas.

La vista previa muestra, para cada etapa, el modelo fijado, su revisión observada, el destino descartado por política y los datos que pueden salir. Una etapa API recibe la tarea, el workspace filtrado, su rol y materiales, y resultados de sus herramientas. Según el plan también puede recibir el contexto P10, la memoria seleccionada y las entregas previas de esa ejecución, incluidos archivos modificados por una etapa local. Las conversaciones y los historiales de otros trabajos quedan fuera de la entrada. P10 y la comprobación de la comparación usan selección y evaluación locales. GitHub conserva su autorización propia.

La política `ferweb-routing-v1` comprueba el destino explícito, catálogo disponible, modelo y capacidades mínimas. El servidor comprueba también los requisitos del rol, perfil y skills. Cada etapa conserva su cupo existente y el equipo comparte el plazo y la reserva global. El cupo externo acota la suma máxima de reservas API del plan. Preparar solo consulta capacidades y congela la decisión con la copia en PostgreSQL. Si la preparación es rechazada, el servidor devuelve el motivo y no crea un plan ejecutable.

Al aprobar un plan que asigna etapas a la API, confirma sus transferencias. La aprobación queda ligada a la huella de la copia que las enumera. Al iniciar, confirma también el commit. La cola usa el modelo y catálogo guardados. Una revisión de catálogo distinta o un fallo de la etapa local detiene el recorrido previsto y requiere una nueva selección explícita. Editar una plantilla o preparar otra política crea una nueva decisión y no concede permisos a copias anteriores ni habilita el reenvío de conversaciones históricas.

## Aceptación con modelos reales

Usa un proyecto y commit de prueba autorizados. Antes de ejecutar, registra la versión de FerWeb, Codex y Ollama, el modelo preciso de cada destino, el digest local observado, CPU/GPU y memoria disponible, el límite de peticiones y tiempo, y el presupuesto monetario externo autorizado. El cupo de peticiones no equivale a un tope monetario. Comprueba qué fuentes, memoria y resultados se permite enviar a la API.

Ejecuta la pareja con el mismo protocolo y repite con un orden registrado si quieres estudiar carga o caché. Exporta cada comparación, revisa la corrección, las pruebas y las diferencias. Registra aparte los cargos que confirme el proveedor y cualquier medición local de energía. Comprueba un plan local y, con autorización para sus transferencias, un plan mixto con etapas fijadas. Para un caso de fallo, retira el modelo local en un entorno de prueba y comprueba que se requiere preparar un plan nuevo. Las pruebas automatizadas usan proveedores simulados. Hasta ejecutar este protocolo, rendimiento, coste real y calidad permanecen sin medir.
