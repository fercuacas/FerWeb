# Guía de demostración

Preparación: [README](../README.md), `setup`, `docker:up`, `owner:create`. Sin claves se demuestran proyectos y simulador. `release:check` verifica Chromium y candidato compilado en entornos desechables. Instancia release permanente solo autorizada, según [deployment.md](deployment.md).

## Recorrido de 8–10 minutos

1. Mostrar salud y login sin revelar contraseña ni `.env`.
2. Crear proyecto/tarea con descripción, prioridad y criterios. Filtrar, pasar a «En curso», recargar y comprobar persistencia.
3. Ejecutar trabajo **simulado**: progreso, identificador y resultado; cancelar otro más largo. Sus unidades/costes son ficticios, no inferencia.
4. Con App/repositorio de prueba configurados: sincronizar GitHub y mostrar commit/archivos/issues/PR. Sin configuración, explicar dobles de tests y estado vacío; no mostrar claves ni publicar PR inesperada.
5. Con modelos autorizados y presupuesto: chat, streaming/cancelación y fuentes por ruta/commit. Sin configuración no ejecutar llamadas reales ni afirmar rendimiento.
6. Laboratorio: condiciones congeladas, revisión humana, desconocidos y panel de estrategias. Resultados simulados no acreditan calidad/ahorro real; adopción requiere evidencia.
7. Con ejecutor/repositorio autorizados: tarea → commit → ejecución → diff/pruebas → revisión. Detenerse antes de **Publicar** salvo autorización explícita. Explicar límites y kernel compartido.
8. Mostrar [revisión final](release-review.md): pruebas, recuperación/carga, límites y prioridades. Detener instancia con `docker:stop` o `release:stop`, conservando volúmenes.

Autorización cruzada se prueba con segunda cuenta fixture; no existe registro/equipos. Demo manual no sustituye suites. No poblar ni limpiar datos del usuario automáticamente.
