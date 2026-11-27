import { useRef, useState } from 'react';
import {
  automationCreate,
  type AutomationAction,
  type AutomationOverview,
  type AutomationSchedule,
  type Project,
} from '@ferweb/contracts';
import { automationsApi } from './automations-store';
import { teamsApi } from './teams-store';
import { errorMessage } from './workspace-store';

const states = {
  draft: 'Pendiente de autorización',
  active: 'Activa',
  paused: 'En pausa',
  blocked: 'Bloqueada',
  exhausted: 'Cupo agotado',
  cancelled: 'Cancelada',
};
const providers = { local: 'Inferencia local', api: 'Codex API', mixed: 'Destinos mixtos' };
const notices = {
  completed: 'Finalización',
  failed: 'Fallo de ejecución',
  blocked: 'Bloqueo',
  action_required: 'Acción requerida',
};
const teamStates = {
  pending: 'En cola',
  running: 'En ejecución',
  completed: 'Completada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
};
const reasonLabels: Record<string, string> = {
  missed_window: 'La ventana de admisión ya había pasado.',
  automation_overlap: 'Había un equipo activo en el proyecto.',
  team_execution_limit: 'El proyecto alcanzó el límite de ejecuciones de equipo.',
  project_archived: 'El proyecto está archivado.',
  team_environment_changed: 'El modelo o las condiciones del ejecutor requieren otra revisión.',
  team_source_changed: 'Cambió el repositorio, el commit o el acceso.',
  automation_policy_changed: 'Cambió la política del equipo.',
  team_approval_required: 'El plan necesita una aprobación vigente.',
};
const reason = (code: string) => reasonLabels[code] ?? 'Revisa la tarea, el plan y sus permisos.';
const inZone = (value: string, zone: string) =>
  new Intl.DateTimeFormat('es', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(value));

function ScheduleForm({ project }: { project: string }) {
  const plans = teamsApi.useTeamPlansQuery(project, { refetchOnMountOrArgChange: true });
  const [create, result] = automationsApi.useCreateAutomationMutation();
  const [planId, selectPlan] = useState('');
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [timeZone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [limit, setLimit] = useState('7');
  const [invalid, setInvalid] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const approved = plans.error
    ? []
    : (plans.currentData?.plans ?? []).filter((plan) => plan.approval && !plan.changesRequested);
  const plan = approved.find((item) => item.id === planId);
  return (
    <form
      className="task-recipe-form"
      aria-label="Preparar programación"
      onSubmit={(event) => {
        event.preventDefault();
        if (!plan) return;
        const draft = {
          planId: plan.id,
          planHash: plan.hash,
          title,
          calendar: { timeZone, time },
          maxOccurrences: Number(limit),
        };
        const key = JSON.stringify(draft);
        if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
        const input = automationCreate.safeParse({ ...draft, requestId: request.current.id });
        if (!input.success) {
          setInvalid(input.error.issues[0]?.message ?? 'Revisa los campos de la programación.');
          return;
        }
        setInvalid('');
        void create({ project, body: input.data })
          .unwrap()
          .then(() => {
            request.current = null;
            setTitle('');
          })
          .catch(() => {});
      }}
    >
      {plans.isLoading && <p role="status">Cargando planes aprobados…</p>}
      {plans.error && <p role="alert">{errorMessage(plans.error)}</p>}
      {!plans.isLoading && !plans.error && !approved.length && (
        <p>Aprueba un plan de equipo en Trabajos para poder programarlo.</p>
      )}
      <label>
        Plan aprobado
        <select required value={planId} onChange={(event) => selectPlan(event.target.value)}>
          <option value="">Elegir plan</option>
          {approved.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.templateName} v{item.templateVersion}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nombre de la programación
        <input
          required
          maxLength={100}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Hora local diaria
        <input
          required
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </label>
      <label>
        Zona horaria IANA
        <input
          required
          maxLength={100}
          placeholder="Europe/Madrid"
          value={timeZone}
          onChange={(event) => setZone(event.target.value)}
        />
      </label>
      <label>
        Límite de fechas
        <input
          required
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
      </label>
      <button className="primary-button" disabled={!plan || result.isLoading}>
        Preparar borrador
      </button>
      {(invalid || result.error) && <p role="alert">{invalid || errorMessage(result.error)}</p>}
      {result.isSuccess && (
        <p role="status">Borrador guardado. Revisa sus condiciones para activarlo.</p>
      )}
    </form>
  );
}

function ScheduleCard({
  item,
  project,
  archived,
  occurrences,
}: {
  item: AutomationSchedule;
  project: string;
  archived: boolean;
  occurrences: AutomationOverview['occurrences'];
}) {
  const [change, result] = automationsApi.useAutomationActionMutation();
  const [confirmed, confirm] = useState(false);
  const [cancelReview, reviewCancel] = useState(false);
  const { snapshot } = item;
  const action = (body: AutomationAction) =>
    void change({ project, id: item.id, body })
      .unwrap()
      .then(() => {
        confirm(false);
        reviewCancel(false);
      })
      .catch(() => {});
  return (
    <details id={`automation-${item.id}`} className="automation-card">
      <summary>
        {snapshot.title} · {states[item.state]}
      </summary>
      <dl>
        <dt>Próxima fecha</dt>
        <dd>
          {item.nextRunAt
            ? inZone(item.nextRunAt, snapshot.calendar.timeZone)
            : 'Sin próxima fecha'}{' '}
          · {snapshot.calendar.timeZone}
        </dd>
        <dt>Plan congelado</dt>
        <dd>
          <a href={`#/projects/${project}/plans/${snapshot.planId}`}>
            {snapshot.templateName} v{snapshot.templateVersion}
          </a>{' '}
          · tarea v{snapshot.taskVersion}
        </dd>
        <dt>Repositorio</dt>
        <dd>
          {snapshot.repository} · <code>{snapshot.commit.slice(0, 12)}</code>
        </dd>
        <dt>Destino y límites</dt>
        <dd>
          {providers[snapshot.destination]} · hasta {snapshot.limits.maxRequests} peticiones por
          ejecución ({snapshot.apiRequestLimit} API) · {snapshot.limits.timeoutMs / 1000} s
        </dd>
        <dt>Calendario</dt>
        <dd>
          Diario a las {snapshot.calendar.time} · {item.observedCount} de {snapshot.maxOccurrences}{' '}
          fechas gestionadas
        </dd>
      </dl>
      {item.reason && <p>{reason(item.reason)}</p>}
      <ul>
        {snapshot.stages.map((stage) => (
          <li key={stage.key}>
            {stage.key} · {stage.executionId} · {stage.model ?? 'Sin modelo'}
          </li>
        ))}
      </ul>
      {item.state === 'draft' && !archived && (
        <>
          <p>
            La autorización aplica al plan y los destinos mostrados. Los avisos se guardan en
            FerWeb.
          </p>
          <label className="automation-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => confirm(event.target.checked)}
            />
            Autorizo este plan, destinos y límites
          </label>
          <button
            className="primary-button"
            disabled={!confirmed || result.isLoading}
            onClick={() => action({ action: 'approve', revision: item.revision, hash: item.hash })}
          >
            Activar programación
          </button>
        </>
      )}
      <div className="form-actions">
        {!archived && (item.state === 'active' || item.state === 'paused') && (
          <button
            className="secondary-button"
            disabled={result.isLoading}
            onClick={() =>
              action({
                action: item.state === 'active' ? 'pause' : 'resume',
                revision: item.revision,
              })
            }
          >
            {item.state === 'active' ? 'Pausar programación' : 'Reanudar programación'}
          </button>
        )}
        {item.state !== 'cancelled' && (
          <button
            className="secondary-button"
            disabled={result.isLoading}
            onClick={() => reviewCancel((open) => !open)}
          >
            Cancelar programación
          </button>
        )}
      </div>
      {cancelReview && (
        <div>
          <p>
            La cancelación cierra las fechas futuras y solicita detener el equipo activo de esta
            programación.
          </p>
          <button
            className="secondary-button"
            disabled={result.isLoading}
            onClick={() => action({ action: 'cancel', revision: item.revision })}
          >
            Confirmar cancelación
          </button>
        </div>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
      <details>
        <summary>Fechas recientes</summary>
        {!occurrences.length && <p>Todavía no hay fechas gestionadas.</p>}
        <ul>
          {occurrences.map((slot) => (
            <li key={slot.id}>
              {inZone(slot.dueAt, snapshot.calendar.timeZone)} ·{' '}
              {slot.teamState
                ? teamStates[slot.teamState]
                : slot.disposition === 'blocked'
                  ? 'Bloqueada'
                  : 'Omitida'}
              {slot.reason && ` · ${reason(slot.reason)}`}
              {slot.teamId && (
                <>
                  {' '}
                  · <a href={`#/projects/${project}/teams/${slot.teamId}`}>Ver ejecución</a>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}

export function ProjectAutomations({ project }: { project: Project }) {
  const query = automationsApi.useAutomationsQuery(project.id, {
    pollingInterval: 5000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const [mark, marked] = automationsApi.useMarkAutomationReadMutation();
  const data = query.error ? undefined : query.currentData;
  return (
    <section className="automations-page" aria-label="Automatizaciones del proyecto">
      <h2>Automatizaciones</h2>
      {project.archivedAt ? (
        <p>Proyecto archivado. Puedes consultar el historial y cancelar programaciones.</p>
      ) : (
        <details className="automation-card">
          <summary>Nueva programación</summary>
          <ScheduleForm project={project.id} />
        </details>
      )}
      {!data && query.isLoading && <p role="status">Cargando automatizaciones…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <button className="secondary-button" onClick={() => void query.refetch()}>
            Reintentar automatizaciones
          </button>
        </>
      )}
      {data && (
        <>
          <section aria-label="Centro de notificaciones">
            <h3>Notificaciones</h3>
            <p aria-live="polite">{data.unread} sin leer</p>
            {!data.notifications.length && <p>Todavía no hay avisos.</p>}
            {marked.error && <p role="alert">{errorMessage(marked.error)}</p>}
            {data.notifications.map((notice) => (
              <article className="automation-card" key={notice.id}>
                <strong>
                  {notices[notice.kind]} · {notice.title}
                </strong>
                <p>{new Date(notice.createdAt).toLocaleString('es')}</p>
                {notice.occurrence.reason && <p>{reason(notice.occurrence.reason)}</p>}
                <div className="form-actions">
                  {notice.occurrence.teamId && (
                    <a href={`#/projects/${project.id}/teams/${notice.occurrence.teamId}`}>
                      Ver seguimiento
                    </a>
                  )}
                  {!notice.readAt && !project.archivedAt && (
                    <button
                      className="secondary-button"
                      disabled={marked.isLoading}
                      onClick={() => {
                        void mark({ project: project.id, id: notice.id })
                          .unwrap()
                          .catch(() => {});
                      }}
                    >
                      Marcar como leída
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section aria-label="Programaciones guardadas">
            <h3>Programaciones</h3>
            {!data.schedules.length && <p>Todavía no hay programaciones.</p>}
            {data.schedules.map((item) => (
              <ScheduleCard
                key={item.id}
                item={item}
                project={project.id}
                archived={!!project.archivedAt}
                occurrences={data.occurrences.filter(({ scheduleId }) => scheduleId === item.id)}
              />
            ))}
          </section>
        </>
      )}
    </section>
  );
}
