# Revisión del primer candidato FerWeb

**2026-11-03. Candidato local preparado; no publicado ni desplegado como instancia permanente.** El producto y repositorio siguen llamándose FerWeb. Procedimientos en [deployment.md](deployment.md), instalación en el [README en inglés](../README.md) y [demo](demo.md).

## Funciona

E1–E10: propietario/sesiones, proyectos/tareas, GitHub App/snapshots, chat OpenAI/Ollama, recuperación Qdrant, laboratorio/estrategias, cola, Codex aislado y revisión/PR explícita. Esta entrega añade imágenes runtime, overlay release, CI, copia emparejada, métricas/logs, carga y aceptación desde fuentes limpias.

## Evidencia local

- `npm run docker:check`: tipos, compilación, formato, **10 Python, 12 básicas, 73 pruebas/subcasos de integración, 14 Chromium y smoke**. Logs privados: `.local/e11-docker-check.log`.
- `npm run release:check`: copia de **246 archivos públicos**, sin `.env`, secretos, dependencias o compilados del anfitrión; imágenes construidas dentro de Docker y volúmenes nuevos. Chromium realiza login → proyecto → tarea → cambio de estado → recarga; otra cuenta no puede leer/modificar el proyecto. Simulador persistente completa un trabajo y deduplica su solicitud.
- Proxy de distribución probado con upstream HTTP simulado: streaming antes del final de respuesta, desconexión que alcanza upstream y bloqueo de rutas internas. No se confunde con una llamada real a un modelo.
- PostgreSQL: las **32 tablas públicas** conservan recuentos y SHA-256 de filas normalizadas tras restaurar. Colección Qdrant no vacía recuperada con punto y procedencia. Rechazados checksum manipulado y sobrescritura de tablas. Migración idempotente, login/tarea tras reinicio y copia iniciada con servicios saludables que pausa/reanuda esos servicios.
- Métricas protegidas accesibles dentro de API y denegadas por web; prueba básica comprueba token y ausencia de URLs/consultas privadas en métricas. Logs HTTP estructurados y correlación de trabajos por ID.
- `release:setup`: crea configuración privada, rechaza sobrescribirla y el wrapper rechaza seleccionar `ferweb` de desarrollo. Las huellas de las doce tablas de dominio comprobadas en la instancia original permanecen iguales; sus volúmenes no se han eliminado.

Informe privado `.local/release-verification.json`: fecha **15:37:32 UTC**, condiciones, resultados, huella de fuentes e IDs/etiquetas de imágenes realmente probadas. Los recursos Compose desechables se retiran. La prueba usa una copia limpia de archivos visibles a Git: el repositorio sigue sin commits; **no se ha clonado un commit publicado ni ejecutado CI en GitHub**. El workflow está preparado con permisos de lectura, acciones fijadas y sin publicación; su ejecución hospedada queda pendiente.

## Carga medida

Linux x86_64 en Docker Desktop, **16 CPU y 16.575.774.720 bytes (~15,44 GiB)** visibles al motor, compartido con servicios de desarrollo y generador. Límites de contenedor y procedimiento en [load-testing.md](load-testing.md). Un proyecto inicialmente con una tarea, ocho clientes, cien operaciones por cliente y pausa de 100 ms. **800 operaciones en 10.787,68 ms**, cero errores, 74,16 solicitudes/s observadas.

| Operaciones   | Cantidad | p50 ms | p95 ms | p99 ms | Máximo ms |
| ------------- | -------: | -----: | -----: | -----: | --------: |
| Listar tareas |      640 |   4,87 |  16,38 |  26,65 |     40,34 |
| Crear tarea   |      160 |   8,04 |  17,21 |  55,81 |     58,42 |
| Total         |      800 |   5,47 |  16,91 |  32,24 |     58,42 |

Supera umbrales cero errores/p95 <1000 ms/máximo <5000 ms. La latencia excluye pausas; solicitudes/s las incluyen y **no representan capacidad máxima**. Es una carga sostenida breve, caliente, sin rampa ni duración suficiente para evaluar fugas, saturación o degradación prolongada. No mide IA/GPU/servicios externos.

## Límites y prioridades

Sin publicación/despliegue externo ni CI hospedado. Dominio/HTTPS, cifrado/retención off-host, monitorización histórica/alertas requieren operación. Copia local no acredita pérdida física del host ni RPO/RTO.

Las bases/datos de dependencias están fijados. Se verifica estabilidad de capas/configuración runtime web con reconstrucción cacheada; no identidad bit a bit en constructores fríos ni entre arquitecturas. Las attestations cambian el índice OCI: promover las imágenes validadas por digest/ID, no reconstruirlas para distribuir. El informe registra las imágenes del candidato sin enviarlas a un registro.

Proveedores/GitHub usan dobles: pendiente aceptación real autorizada y presupuesto. Carga CRUD no acredita IA/GPU, repositorios grandes ni escalado horizontal. Chat/ingesta/laboratorio siguen en proceso; ampliar cola antes de replicar API. Codex: kernel compartido, perfil Node, repositorios controlados y controlador con socket Docker en host dedicado. Sin multiagente/Kubernetes.

Vite avisa de un bundle principal mayor de 500 kB sin comprimir; la compilación pasa. Separar pantallas en chunks queda como optimización posterior, sin cambiar este candidato.

Prioridades: (1) integraciones reales en repositorio de prueba con presupuesto; (2) decidir host/HTTPS y recuperación off-host antes de autorizar publicación; (3) ampliar carga/monitorización y persistir procesos largos antes de escalar; (4) medir calidad/coste real antes de adoptar estrategias. Sin ahorro real declarado.
