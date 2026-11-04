import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { Project, jobEventSchema, jobInput } from '@ferweb/contracts';
import { jobsApi } from './jobs-store';
import { errorMessage } from './workspace-store';
import './jobs.css';
import { CodingForm, CodingView } from './Coding';

const names = {
  pending: 'Pendiente',
  running: 'Ejecutando',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
};
function Failure({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="form-error">
      {errorMessage(error)}
    </p>
  ) : null;
}
function JobForm({ project, onCreated }: { project: string; onCreated: (id: string) => void }) {
  const [draft, setDraft] = useState<Omit<z.infer<typeof jobInput>, 'requestId'>>({
    title: 'Simulación de trabajo',
    simulation: {
      steps: 8,
      stepDelayMs: 250,
      unitsPerStep: 2,
      costMicrosPerStep: 100,
      failure: 'none',
      failureStep: 1,
      failuresBeforeSuccess: 1,
      ignoreTermination: false,
    },
    limits: { timeoutMs: 30000, maxAttempts: 3, budgetUnits: 100, budgetMicros: 10000 },
  });
  const request = useRef(crypto.randomUUID()),
    [enqueue, result] = jobsApi.useEnqueueJobMutation();
  const change = (value: typeof draft) => {
    setDraft(value);
    request.current = crypto.randomUUID();
  };
  const sim = draft.simulation,
    limits = draft.limits;
  return (
    <details>
      <summary>Nuevo trabajo simulado</summary>
      <form
        className="job-form"
        onSubmit={(event) => {
          event.preventDefault();
          void enqueue({ project, body: { ...draft, requestId: request.current } })
            .unwrap()
            .then((value) => {
              onCreated(value.job.id);
              request.current = crypto.randomUUID();
            })
            .catch(() => {});
        }}
      >
        <fieldset disabled={result.isLoading}>
          <legend>Configuración y límites</legend>
          <p>
            Este trabajo solo ejecuta una simulación de pasos. No modifica repositorios ni llama a
            proveedores de IA. El consumo monetario es ficticio y sirve para probar el presupuesto.
          </p>
          <label>
            Título del trabajo
            <input
              required
              maxLength={160}
              value={draft.title}
              onChange={(e) => change({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="job-grid">
            <label>
              Pasos
              <input
                required
                type="number"
                min={1}
                max={30}
                value={sim.steps}
                onChange={(e) =>
                  change({
                    ...draft,
                    simulation: {
                      ...sim,
                      steps: Number(e.target.value),
                      failureStep: Math.min(sim.failureStep, Number(e.target.value)),
                    },
                  })
                }
              />
            </label>
            <label>
              Tiempo por paso (ms)
              <input
                required
                type="number"
                min={50}
                max={1000}
                value={sim.stepDelayMs}
                onChange={(e) =>
                  change({ ...draft, simulation: { ...sim, stepDelayMs: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              Unidades por paso
              <input
                required
                type="number"
                min={1}
                max={20}
                value={sim.unitsPerStep}
                onChange={(e) =>
                  change({ ...draft, simulation: { ...sim, unitsPerStep: Number(e.target.value) } })
                }
              />
            </label>
          </div>
          <div className="job-grid">
            <label>
              Plazo total (segundos)
              <input
                required
                type="number"
                min={1}
                max={120}
                value={limits.timeoutMs / 1000}
                onChange={(e) =>
                  change({
                    ...draft,
                    limits: { ...limits, timeoutMs: Number(e.target.value) * 1000 },
                  })
                }
              />
            </label>
            <label>
              Máximo de intentos
              <input
                required
                type="number"
                min={1}
                max={3}
                value={limits.maxAttempts}
                onChange={(e) =>
                  change({ ...draft, limits: { ...limits, maxAttempts: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              Presupuesto de unidades
              <input
                required
                type="number"
                min={1}
                max={10000}
                value={limits.budgetUnits}
                onChange={(e) =>
                  change({ ...draft, limits: { ...limits, budgetUnits: Number(e.target.value) } })
                }
              />
            </label>
          </div>
          <div className="job-grid">
            <label>
              Coste ficticio por paso (USD)
              <input
                required
                type="number"
                min={0}
                max={0.01}
                step={0.000001}
                value={sim.costMicrosPerStep / 1000000}
                onChange={(e) =>
                  change({
                    ...draft,
                    simulation: {
                      ...sim,
                      costMicrosPerStep: Math.round(Number(e.target.value) * 1000000),
                    },
                  })
                }
              />
            </label>
            <label>
              Presupuesto ficticio (USD)
              <input
                required
                type="number"
                min={0}
                max={1}
                step={0.000001}
                value={limits.budgetMicros / 1000000}
                onChange={(e) =>
                  change({
                    ...draft,
                    limits: {
                      ...limits,
                      budgetMicros: Math.round(Number(e.target.value) * 1000000),
                    },
                  })
                }
              />
            </label>
          </div>
          <details>
            <summary>Pruebas de fallo y parada</summary>
            <div className="job-grid">
              <label>
                Fallo simulado
                <select
                  value={sim.failure}
                  onChange={(e) =>
                    change({
                      ...draft,
                      simulation: { ...sim, failure: e.target.value as typeof sim.failure },
                    })
                  }
                >
                  <option value="none">Ninguno</option>
                  <option value="transient">Transitorio, con reintento</option>
                  <option value="permanent">Permanente, sin reintento</option>
                  <option value="after_commit">Fallo después de guardar un paso</option>
                </select>
              </label>
              <label>
                Paso del fallo
                <input
                  type="number"
                  required
                  min={1}
                  max={sim.steps}
                  value={sim.failureStep}
                  onChange={(e) =>
                    change({
                      ...draft,
                      simulation: { ...sim, failureStep: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Intentos que fallan
                <input
                  type="number"
                  required
                  min={0}
                  max={2}
                  value={sim.failuresBeforeSuccess}
                  onChange={(e) =>
                    change({
                      ...draft,
                      simulation: { ...sim, failuresBeforeSuccess: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
            <label className="job-check">
              <input
                type="checkbox"
                checked={sim.ignoreTermination}
                onChange={(e) =>
                  change({ ...draft, simulation: { ...sim, ignoreTermination: e.target.checked } })
                }
              />{' '}
              Probar resistencia a la parada suave
            </label>
          </details>
          <button className="primary-button" disabled={result.isLoading}>
            {result.isLoading ? 'Guardando…' : 'Encolar simulación'}
          </button>
        </fieldset>
        <Failure error={result.error} />
      </form>
    </details>
  );
}
function Events({ project, id, active }: { project: string; id: string; active: boolean }) {
  const [cursor, setCursor] = useState(0),
    [events, setEvents] = useState<z.infer<typeof jobEventSchema>[]>([]);
  const result = jobsApi.useJobEventsQuery(
    { project, id, after: cursor },
    { pollingInterval: active ? 1000 : 0, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  useEffect(() => {
    const value = result.currentData;
    if (!value?.events.length) return;
    setEvents((previous) => [
      ...previous,
      ...value.events.filter((event) => !previous.some((old) => old.sequence === event.sequence)),
    ]);
    setCursor(value.nextCursor);
  }, [result.currentData]);
  useEffect(() => {
    void result.refetch();
  }, [active, result.refetch]);
  return (
    <section aria-label="Eventos del trabajo">
      <h4>Progreso y eventos</h4>
      <Failure error={result.error} />
      <ol className="job-events" role="log" aria-live="polite" aria-relevant="additions">
        {events.map((event) => (
          <li key={event.sequence}>
            <strong>
              #{event.sequence} · intento {event.attempt} · {event.type}
            </strong>
            <span>{event.message}</span>
            <small>
              {event.createdAt} · trabajo {event.jobId}
            </small>
            {event.data.step !== undefined && (
              <small>
                Paso {String(event.data.step)}
                {event.data.total !== undefined ? ` / ${String(event.data.total)}` : ''}
              </small>
            )}
          </li>
        ))}
      </ol>
      {!events.length && <p>Esperando eventos persistentes…</p>}
    </section>
  );
}
function JobView({
  project,
  id,
  onSelect,
}: {
  project: string;
  id: string;
  onSelect: (id: string) => void;
}) {
  const [poll, setPoll] = useState(true),
    result = jobsApi.useJobQuery(
      { project, id },
      { pollingInterval: poll ? 1000 : 0, refetchOnFocus: true, skipPollingIfUnfocused: true },
    );
  const [cancel, cancelling] = jobsApi.useCancelJobMutation(),
    job = result.currentData?.job;
  const active = job ? ['pending', 'running'].includes(job.state) : true;
  useEffect(() => {
    setPoll(active);
  }, [active]);
  if (!job)
    return (
      <>
        <p role="status">Cargando trabajo…</p>
        <Failure error={result.error} />
      </>
    );
  if (job.kind === 'codex-v1')
    return (
      <>
        <CodingView
          onSelect={onSelect}
          project={project}
          job={job}
          onCancel={() => {
            void cancel({ project, id })
              .unwrap()
              .catch(() => {});
          }}
          cancelling={cancelling.isLoading}
        />
        <Failure error={cancelling.error} />
        <Events key={id} project={project} id={id} active={active} />
      </>
    );
  const cfg = job.configuration;
  return (
    <section className="job-view" aria-label="Detalle del trabajo">
      <h3>{job.title}</h3>
      <p role="status">
        Estado: {names[job.state]}
        {job.cancelRequested && active ? ' · cancelación solicitada' : ''}
      </p>
      <small className="job-id">Identificador: {job.id}</small>
      <label>
        Pasos confirmados: {job.completedSteps} / {cfg.simulation.steps}
        <progress
          aria-label="Progreso del trabajo"
          max={cfg.simulation.steps}
          value={job.completedSteps}
        />
      </label>
      <p>
        Unidades reservadas: {job.usedUnits} / {cfg.limits.budgetUnits}. Coste ficticio reservado:{' '}
        {(job.usedCostMicros / 1000000).toFixed(6)} /{' '}
        {(cfg.limits.budgetMicros / 1000000).toFixed(6)} USD. Incluye los intentos fallidos y
        reservas interrumpidas.
      </p>
      <p>
        Intento {job.attempt} / {cfg.limits.maxAttempts}.{' '}
        {job.state === 'running'
          ? job.executorConnected
            ? 'Ejecutor conectado.'
            : 'Ejecutor sin conexión confirmada; esperando recuperación.'
          : job.state === 'pending'
            ? 'Esperando asignación o reintento.'
            : ''}
      </p>
      {job.errorMessage && (
        <p className="read-only-note">
          {job.errorCode}: {job.errorMessage}
        </p>
      )}
      <Failure error={result.error ?? cancelling.error} />
      {active && (
        <button
          className="secondary-button"
          disabled={job.cancelRequested || cancelling.isLoading}
          onClick={() =>
            void cancel({ project, id })
              .unwrap()
              .catch(() => {})
          }
        >
          {job.cancelRequested ? 'Cancelando…' : 'Cancelar trabajo'}
        </button>
      )}
      <details>
        <summary>Intentos y condiciones</summary>
        <p>
          Plazo total desde el primer inicio: {cfg.limits.timeoutMs / 1000} s. Concurrencia máxima:
          2 globales y 1 por proyecto. Los reintentos no reinician el presupuesto ni el plazo.
        </p>
        {result.currentData?.attempts.map((attempt) => (
          <article key={attempt.attempt}>
            <h4>
              Intento {attempt.attempt} · {attempt.state}
            </h4>
            <small>
              Ejecutor: {attempt.executorId} · PID del proceso:{' '}
              {attempt.processPid ?? 'Desconocido'}
            </small>
            <p>
              Salida: {attempt.exitCode ?? attempt.exitSignal ?? 'Desconocida'} · parada confirmada:{' '}
              {attempt.terminationConfirmed === null
                ? 'Desconocida'
                : attempt.terminationConfirmed
                  ? 'Sí'
                  : 'No'}
              {attempt.errorCode ? ` · ${attempt.errorCode}` : ''}
            </p>
          </article>
        ))}
      </details>
      {job.result && (
        <details>
          <summary>Resultado persistente de simulación</summary>
          <pre>{JSON.stringify(job.result, null, 2)}</pre>
        </details>
      )}
      <Events key={id} project={project} id={id} active={active} />
    </section>
  );
}
export function ProjectJobs({ project }: { project: Project }) {
  const result = jobsApi.useJobsQuery(project.id, {
      pollingInterval: 2000,
      refetchOnFocus: true,
      skipPollingIfUnfocused: true,
    }),
    [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="project-jobs">
      <h2>Trabajos en segundo plano</h2>
      <p>
        Cola persistente y ejecución en otro proceso. Puedes cerrar esta página y volver al mismo
        trabajo.
      </p>
      {!project.archivedAt && <JobForm project={project.id} onCreated={setSelected} />}
      {!project.archivedAt && <CodingForm project={project.id} onCreated={setSelected} />}
      <Failure error={result.error} />
      {result.isLoading && <p role="status">Cargando trabajos…</p>}
      <div className="jobs-layout">
        <nav aria-label="Trabajos del proyecto">
          {result.currentData?.jobs.map((job) => (
            <button
              className="job-choice"
              key={job.id}
              aria-pressed={selected === job.id}
              onClick={() => setSelected(job.id)}
            >
              <strong>{job.title}</strong>
              <small>
                {names[job.state]} ·{' '}
                {job.kind === 'simulation-v1'
                  ? `${job.completedSteps}/${job.configuration.simulation.steps}`
                  : 'Codex'}
              </small>
            </button>
          ))}
        </nav>
        {selected ? (
          <JobView key={selected} project={project.id} id={selected} onSelect={setSelected} />
        ) : (
          <p>Selecciona un trabajo o encola una simulación.</p>
        )}
      </div>
      {project.archivedAt && (
        <p className="read-only-note">
          Proyecto archivado: historial consultable y cancelación disponible.
        </p>
      )}
    </section>
  );
}
