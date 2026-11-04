import { useEffect, useRef, useState } from 'react';
import type { Job } from '@ferweb/contracts';
import { codingApi } from './coding-store';
import { githubApi } from './github-store';
import { workspaceApi, errorMessage } from './workspace-store';
import { CodingReview, CodingComparison } from './CodingReview';
import { ExecutionDetails } from './ExecutionDetails';
export function CodingForm({
  project,
  onCreated,
}: {
  project: string;
  onCreated: (id: string) => void;
}) {
  const caps = codingApi.useCodingCapabilitiesQuery(project, { refetchOnFocus: true });
  const source = githubApi.useGithubLinkQuery(project, { refetchOnFocus: true });
  const tasks = workspaceApi.useTasksQuery({ projectId: project, filters: {} });
  const [taskId, setTask] = useState(''),
    [model, setModel] = useState(''),
    [timeoutMs, setTimeoutMs] = useState(120000),
    [maxRequests, setRequests] = useState(8),
    [maxOutputTokens, setOutput] = useState(4096);
  const request = useRef(crypto.randomUUID()),
    [start, state] = codingApi.useStartCodingMutation();
  const task = tasks.currentData?.tasks.find((t) => t.id === taskId),
    link = source.currentData?.link;
  const options = caps.error ? undefined : caps.currentData;
  const selectedModel = model || options?.models[0] || '';
  const ready =
    !!task &&
    !!link?.snapshot &&
    !link.stale &&
    !link.revoked &&
    !link.snapshot.treeTruncated &&
    options?.execution.available &&
    options.models.includes(selectedModel) &&
    !source.error &&
    !caps.error &&
    !tasks.error;
  return (
    <details>
      <summary>Nueva tarea con Codex</summary>
      <form
        className="job-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || !task || !link?.snapshot) return;
          void start({
            project,
            body: {
              requestId: request.current,
              taskId: task.id,
              taskVersion: task.version,
              commit: link.snapshot.commit,
              model: selectedModel,
              timeoutMs,
              maxRequests,
              maxOutputTokens,
            },
          })
            .unwrap()
            .then((r) => {
              onCreated(r.job.id);
              request.current = crypto.randomUUID();
            })
            .catch(() => {});
        }}
        onChange={() => {
          request.current = crypto.randomUUID();
        }}
      >
        <fieldset disabled={state.isLoading}>
          <legend>Ejecución sobre un commit fijo</legend>
          <p>
            Codex trabaja en una copia separada del commit. Revisa el diff y las pruebas antes de
            aplicar los cambios.
          </p>
          {options && <ExecutionDetails option={options.execution} />}
          {options?.execution.destination === 'openai-api' && (
            <p>
              Al ejecutar, el contexto de la tarea se enviará a OpenAI mediante la API configurada.
            </p>
          )}
          {caps.isLoading || source.isLoading || tasks.isLoading ? (
            <p role="status">Consultando ejecutor, repositorio y tareas…</p>
          ) : null}
          {options?.simulated && (
            <p className="read-only-note">
              Proveedor simulado de pruebas; Codex y los comandos sí se ejecutan.
            </p>
          )}
          {!link?.snapshot || link.stale || link.revoked || link.snapshot.treeTruncated ? (
            <p>Vincula y sincroniza un repositorio accesible antes de ejecutar.</p>
          ) : (
            <p className="job-id">
              {link.fullName} · commit {link.snapshot.commit}
            </p>
          )}
          <label>
            Tarea de programación
            <select required value={taskId} onChange={(e) => setTask(e.target.value)}>
              <option value="">Seleccionar tarea</option>
              {tasks.currentData?.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modelo Codex
            <select value={selectedModel} onChange={(e) => setModel(e.target.value)}>
              {selectedModel && !options?.models.includes(selectedModel) && (
                <option value={selectedModel} disabled>
                  Modelo seleccionado no permitido
                </option>
              )}
              {options?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="job-grid">
            <label>
              Plazo de ejecución (segundos)
              <input
                required
                type="number"
                min="10"
                max="1200"
                value={timeoutMs / 1000}
                onChange={(e) => setTimeoutMs(Number(e.target.value) * 1000)}
              />
            </label>
            <label>
              Máximo de peticiones al modelo
              <input
                required
                type="number"
                min="1"
                max="20"
                value={maxRequests}
                onChange={(e) => setRequests(Number(e.target.value))}
              />
            </label>
            <label>
              Máximo de salida por petición
              <input
                required
                type="number"
                min="64"
                max="8192"
                value={maxOutputTokens}
                onChange={(e) => setOutput(Number(e.target.value))}
              />
            </label>
          </div>
          <p>
            Sin reintentos automáticos. Estos límites no representan un presupuesto monetario ni un
            límite exacto de tokens de entrada.
          </p>
          <button type="submit" disabled={!ready}>
            {state.isLoading ? 'Preparando snapshot…' : 'Ejecutar tarea con Codex'}
          </button>
        </fieldset>
        {state.error && (
          <p role="alert" className="form-error">
            {errorMessage(state.error)}
          </p>
        )}
        {(caps.error || source.error || tasks.error) && (
          <p role="alert" className="form-error">
            {errorMessage(caps.error || source.error || tasks.error)}
          </p>
        )}
      </form>
    </details>
  );
}
const states = {
  pending: 'Pendiente',
  running: 'Ejecutando',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
};
const known = (v: number | null | undefined) => v ?? 'Desconocido';
export function CodingView({
  project,
  job,
  onCancel,
  cancelling,
  onSelect,
}: {
  project: string;
  job: Job;
  onCancel: () => void;
  cancelling: boolean;
  onSelect: (id: string) => void;
}) {
  const active = ['pending', 'running'].includes(job.state),
    run = codingApi.useCodingRunQuery(
      { project, id: job.id },
      {
        pollingInterval: active ? 1500 : 10000,
        refetchOnFocus: true,
        skipPollingIfUnfocused: true,
      },
    );
  const visible = run.error ? undefined : run.currentData;
  const report = visible?.report;
  useEffect(() => {
    void run.refetch();
  }, [active, run.refetch]);
  return (
    <section className="job-view" aria-label="Ejecución de código">
      <h3>{job.title}</h3>
      <p role="status">
        Estado: {states[job.state]}
        {job.cancelRequested && active ? ' · cancelación solicitada' : ''}
      </p>
      <small className="job-id">Identificador: {job.id}</small>
      {active && (
        <button type="button" disabled={cancelling || job.cancelRequested} onClick={onCancel}>
          Detener Codex
        </button>
      )}
      {job.errorMessage && (
        <p role="alert" className="form-error">
          {job.errorCode}: {job.errorMessage}
        </p>
      )}
      {run.isLoading && <p role="status">Cargando evidencias…</p>}
      {run.error && (
        <p role="alert" className="form-error">
          {errorMessage(run.error)}
        </p>
      )}
      {visible && (
        <>
          <p className="job-id">
            {visible.repository} · commit {visible.commit}
          </p>
          <details>
            <summary>Tarea y archivos de partida</summary>
            <pre>{JSON.stringify(visible.task, null, 2)}</pre>
            <ul>
              {visible.manifest.map((f) => (
                <li key={f.path}>
                  {f.path} · {f.contentHash.slice(0, 12)}
                </li>
              ))}
            </ul>
            <p>Excluidos: {visible.excluded.join(', ') || 'Ninguno adicional'}</p>
          </details>
        </>
      )}
      {report && (
        <>
          <p>
            {report.simulated ? 'Proveedor simulado · ' : ''}Codex CLI {report.cliVersion} ·{' '}
            {report.model}
          </p>
          <h4>Resumen del trabajo</h4>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {report.summary || 'Aún no hay resumen del agente.'}
          </p>
          <p>
            Duración: {known(report.durationMs)} ms · peticiones: {report.modelRequests}. Parada
            confirmada:{' '}
            {report.terminationConfirmed === null
              ? 'Desconocida'
              : report.terminationConfirmed
                ? 'Sí'
                : 'No'}
            .
          </p>
          <p>
            Uso observado en la pasarela: entrada {known(report.providerUsage?.inputTokens)} ·
            caché: {known(report.providerUsage?.cachedInputTokens)} · salida:{' '}
            {known(report.providerUsage?.outputTokens)} · razonamiento:{' '}
            {known(report.providerUsage?.reasoningTokens)}. Coste: desconocido.
          </p>
          <p>
            Uso reportado por Codex: entrada {known(report.usage?.inputTokens)} · salida{' '}
            {known(report.usage?.outputTokens)}. Peticiones con uso recibido:{' '}
            {report.providerUsage?.reportedRequests ?? 0}/{report.modelRequests}.
          </p>
          <h4>Diff de archivos</h4>
          <p>
            {report.diffComplete
              ? 'Snapshot final recogido.'
              : 'Diff incompleto o todavía no disponible; no implica ausencia de cambios.'}
          </p>
          {report.diff.map((f) => (
            <details key={f.path}>
              <summary>{f.path}</summary>
              <pre>{f.patch}</pre>
            </details>
          ))}
          <h4>Comandos y pruebas</h4>
          <p>
            Los comandos del agente proceden de eventos Codex. La verificación adicional la lanza el
            controlador.
          </p>
          {[...report.commands, ...report.tests].map((c, i) => (
            <details key={i}>
              <summary>
                {c.command} · salida {known(c.exitCode)}
              </summary>
              <p>{c.origin}</p>
              <pre>{c.output || 'Sin salida capturada.'}</pre>
            </details>
          ))}
          <h4>Limitaciones</h4>
          <ul>
            {report.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {!active && (
            <CodingComparison key={job.id} project={project} id={job.id} onSelect={onSelect} />
          )}
          {job.state === 'completed' && visible && (
            <CodingReview key={job.id} project={project} run={visible} />
          )}
        </>
      )}
    </section>
  );
}
