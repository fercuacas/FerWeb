# Automatizaciones de proyecto (P24)

Sincroniza el repositorio del proyecto y aprueba un plan de equipo en **Trabajos**. En **Automatizaciones → Nueva programación**, elígelo e indica una hora diaria, una zona IANA y un límite de fechas. El borrador muestra el commit y las versiones congeladas, los destinos y modelos de cada etapa y el cupo API. Revisa la copia y activa la programación. Cada autorización queda ligada a la huella de esa copia.

El proyecto conserva la fecha siguiente, el historial y los avisos en PostgreSQL. El worker de FerWeb revisa las fechas vencidas y reutiliza el coordinador de equipos, que aplica el presupuesto y los permisos del plan. Cada fecha tiene un identificador estable. La reserva, el avance del calendario y la admisión del equipo se confirman en una sola transacción. Reiniciar el worker recupera la observación del equipo admitido. [Equipos secuenciales](codex.md#equipo-secuencial-duradero-p06).

## Calendario y autorización

- El calendario usa la hora civil de la zona elegida. Si la hora desaparece en un cambio de reloj, esa jornada se omite. Si se repite, se usa el primer instante.
- Una fecha puede admitirse durante los primeros quince minutos. Si la infraestructura falla temporalmente, el worker puede comprobar de nuevo la misma fecha dentro de esa ventana. Una fecha atrasada se registra como omitida y el cursor salta a la próxima fecha futura. Si el proyecto ya tiene un equipo pendiente o en curso, la fecha se omite por solapamiento. Las fechas registradas consumen cupo, incluidas las omisiones y los bloqueos.
- **Pausar** detiene las nuevas admisiones. El equipo en curso conserva su seguimiento. **Reanudar** calcula la siguiente fecha futura. **Cancelar** cierra el calendario y solicita la parada del equipo activo de esa programación.
- Cambios de tarea, aprobación, acceso, commit, política o condiciones del ejecutor pueden bloquear la autorización. Prepara un plan y un borrador nuevos al cambiar esas condiciones. Un plan de inferencia local mantiene su destino. Los fallos de una etapa se registran en la ejecución original.

## Notificaciones y resultados

El centro del proyecto muestra finalización, fallo, bloqueo y acción requerida. Un conflicto de integración genera un aviso ligado a su huella. Los sondeos repetidos y los estados pendientes o en curso mantienen el mismo historial. La lectura se guarda en PostgreSQL y el seguimiento abre el equipo bajo los controles de acceso existentes.

Los proyectos archivados conservan la consulta y la cancelación. La publicación externa conserva su revisión explícita en E9. Correo y mensajería requerirían un conector y otra autorización. [Extensiones](extensions.md) · [Destinos API y local](provider-routing.md).
