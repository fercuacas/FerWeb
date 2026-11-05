import { useState, useRef, useEffect } from 'react';
import type { z } from 'zod';
import type { teamMessage } from '@ferweb/contracts';
import type { Project, TeamPlan } from '@ferweb/contracts';
import { teamsApi } from './teams-store';
import { jobsApi } from './jobs-store';
import { CodingView } from './Coding';
import { errorMessage } from './workspace-store';
import { ExecutionDetails } from './ExecutionDetails';
import { budgetsApi } from './budgets-store';
import { BudgetUsage } from './Budgets';
import { githubApi } from './github-store';

const names = {
  pending: 'Pendiente',
  running: 'En curso',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  skipped: 'Omitido',
};
export function TeamPolicySettings({ project }: { project: Project }) {
  const query = teamsApi.useTeamPolicyQuery(project.id);
  const [save, result] = teamsApi.useUpdateTeamPolicyMutation();
  const [selected, setSelected] = useState<0 | 1 | 2>(0);
  const [confirmed, setConfirmed] = useState(false);
  const data = query.error ? undefined : query.currentData;
  const value = selected || data?.parallelism || 1;
  return (
    <section className="agent-history" aria-label="Concurrencia de especialistas">
      <h3>Concurrencia de especialistas</h3>
      <p>
        Por defecto, un trabajo por proyecto. El máximo global sigue siendo dos. Solo especialistas
        del mismo equipo con fuentes de solo lectura pueden coincidir.
      </p>
      {query.isLoading && <p>Cargando configuración…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar configuración</button>
        </p>
      )}
      {data && (
        <>
          <p>
            Configuración actual: {data.parallelism} · Versión {data.version}
          </p>
          {!project.archivedAt && (
            <>
              <label>
                Límite del proyecto
                <select
                  value={value}
                  onChange={(e) => {
                    setSelected(Number(e.target.value) as 1 | 2);
                    setConfirmed(false);
                  }}
                >
                  <option value={1}>1 especialista</option>
                  <option value={2}>2 especialistas</option>
                </select>
              </label>
              {value === 2 && (
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Confirmo permitir dos especialistas simultáneos en este proyecto
                </label>
              )}
              <button
                disabled={
                  result.isLoading || value === data.parallelism || (value === 2 && !confirmed)
                }
                onClick={() =>
                  void save({
                    project: project.id,
                    body: { parallelism: value, version: data.version },
                  })
                    .unwrap()
                    .then(() => {
                      setSelected(0);
                      setConfirmed(false);
                    })
                    .catch(() => {})
                }
              >
                Guardar concurrencia del proyecto
              </button>
            </>
          )}
        </>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </section>
  );
}
function TeamMessageFeed({
  project,
  id,
  steps,
}: {
  project: string;
  id: string;
  steps: { id: string; key: string }[];
}) {
  const [cursor, setCursor] = useState(0);
  const [messages, setMessages] = useState<z.infer<typeof teamMessage>[]>([]);
  const query = teamsApi.useTeamMessagesQuery(
    { project, id, after: cursor },
    { pollingInterval: 1500, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  useEffect(() => {
    const data = query.currentData;
    if (!query.error && data?.messages.length) {
      setMessages((previous) => [
        ...previous,
        ...data.messages.filter((message) => !previous.some((item) => item.id === message.id)),
      ]);
      setCursor(data.nextCursor);
    }
  }, [query.currentData, query.error]);
  const kinds = {
    handoff: 'Entrega',
    query: 'Consulta',
    response: 'Respuesta',
    completion: 'Finalización',
    conflict: 'Conflicto',
  };
  const label = (step: string | null) =>
    step ? (steps.find((item) => item.id === step)?.key ?? 'Etapa') : 'Coordinador';
  return (
    <section className="agent-history" aria-label="Mensajes del equipo">
      <h4>Mensajes del equipo</h4>
      <p>
        Identidad asignada por el servidor. El texto de un agente no concede permisos ni acredita
        éxito.
      </p>
      {query.isLoading && <p>Cargando mensajes…</p>}
      {query.error ? (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar mensajes</button>
        </p>
      ) : (
        <>
          {!messages.length && <p>Aún no hay mensajes.</p>}
          <ol>
            {messages.map((message) => (
              <li key={message.id}>
                <strong>
                  {message.sequence} · {kinds[message.kind]} · {label(message.senderStepId)} →{' '}
                  {label(message.to)}
                </strong>
                <p>
                  {message.sender === 'coordinator' ? 'Coordinador' : 'Agente autenticado'} ·{' '}
                  {message.verified ? 'Procedencia técnica verificada' : 'Texto sin verificar'}
                </p>
                <p className="skill-text">{message.text}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
export function TeamLauncher({ project, plan }: { project: Project; plan: TeamPlan }) {
  const query = githubApi.useGithubLinkQuery(project.id, { refetchOnFocus: true });
  const policy = teamsApi.useTeamPolicyQuery(project.id, { refetchOnFocus: true });
  const [start, result] = teamsApi.useExecuteTeamPlanMutation();
  const [confirmed, setConfirmed] = useState('');
  const request = useRef({ commit: '', id: crypto.randomUUID() });
  const link = query.error ? undefined : query.currentData?.link;
  const commit = link?.snapshot?.commit ?? '';
  const configured =
    !policy.error &&
    !!policy.currentData &&
    plan.snapshot.limits.concurrency <= policy.currentData.parallelism;
  const ready = !!commit && !link?.revoked && !link?.stale && !link?.snapshot?.treeTruncated;
  return (
    <div className="job-form">
      <h4>Ejecutar plan aprobado</h4>
      {query.isLoading && <p>Cargando commit sincronizado…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar repositorio del equipo</button>
        </p>
      )}
      {!ready && !query.isLoading && !query.error && (
        <p>Vincula y sincroniza un repositorio desde GitHub antes de ejecutar el equipo.</p>
      )}
      {!configured && (
        <p>
          Configura la concurrencia solicitada desde Agentes → Equipos y plantillas antes de
          ejecutar.
        </p>
      )}
      {policy.error && (
        <p role="alert">
          {errorMessage(policy.error)}{' '}
          <button onClick={() => void policy.refetch()}>Reintentar límite del proyecto</button>
        </p>
      )}
      {ready && (
        <>
          <p className="skill-text">Commit a congelar: {commit}</p>
          <p>
            Se crearán {plan.snapshot.steps.length} etapas{' '}
            {plan.snapshot.template.definition.strategy === 'specialists'
              ? 'de especialistas de solo lectura y resumen'
              : 'secuenciales'}{' '}
            con un presupuesto de {plan.snapshot.limits.maxRequests} peticiones y{' '}
            {plan.snapshot.limits.timeoutMs / 1000} segundos. El proveedor y los roles son los de
            esta copia aprobada.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed === commit}
              onChange={(event) => setConfirmed(event.target.checked ? commit : '')}
            />
            Confirmo la ejecución de este plan sobre el commit indicado
          </label>
          <button
            className="primary-button"
            disabled={
              !configured || confirmed !== commit || result.isLoading || !!project.archivedAt
            }
            onClick={() => {
              if (request.current.commit !== commit)
                request.current = { commit, id: crypto.randomUUID() };
              void start({
                project: project.id,
                id: plan.id,
                body: { requestId: request.current.id, hash: plan.hash, version: 1, commit },
              })
                .unwrap()
                .catch(() => {});
            }}
          >
            {plan.snapshot.template.definition.strategy === 'specialists'
              ? 'Ejecutar especialistas'
              : 'Ejecutar equipo secuencial'}
          </button>
        </>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </div>
  );
}
function StepReport({ project, id }: { project: string; id: string }) {
  const query = jobsApi.useJobQuery(
    { project, id },
    { pollingInterval: 2000, skipPollingIfUnfocused: true },
  );
  const [cancel, result] = jobsApi.useCancelJobMutation();
  const job = query.error ? undefined : query.currentData?.job;
  return (
    <>
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar informe</button>
        </p>
      )}
      {job && (
        <CodingView
          project={project}
          job={job}
          cancelling={result.isLoading}
          onCancel={() =>
            void cancel({ project, id })
              .unwrap()
              .catch(() => {})
          }
          onSelect={() => {}}
        />
      )}
    </>
  );
}
function TeamBudget({ project, id }: { project: string; id: string }) {
  const query = budgetsApi.useBudgetQuery(
    { project, id },
    { pollingInterval: 2000, skipPollingIfUnfocused: true },
  );
  return query.error ? (
    <p role="alert">{errorMessage(query.error)}</p>
  ) : query.currentData ? (
    <BudgetUsage budget={query.currentData.budget} />
  ) : (
    <p>Cargando consumo…</p>
  );
}
export function TeamRunDetails({ project, id }: { project: Project; id: string }) {
  const query = teamsApi.useTeamExecutionQuery(
    { project: project.id, id },
    { pollingInterval: 1500, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  const [cancel, result] = teamsApi.useCancelTeamExecutionMutation();
  const [report, setReport] = useState('');
  const data = query.error ? undefined : query.currentData;
  return (
    <section className="agent-history" aria-label="Ejecución del equipo">
      {query.isLoading && <p role="status">Cargando ejecución de equipo…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar equipo</button>
        </p>
      )}
      {data && (
        <>
          <h3>{data.execution.title}</h3>
          <p role="status">
            Equipo: {names[data.execution.state]}
            {data.execution.cancelRequested && data.execution.state === 'running'
              ? ' · Deteniendo la etapa activa…'
              : ''}
          </p>
          <p>
            ID: {data.execution.id} · Repositorio: {data.execution.repository}
          </p>
          <p className="skill-text">
            Commit: {data.execution.commit} · Plan: {data.execution.planHash}
          </p>
          <p>
            Una pasada{' '}
            {data.plan.template.definition.strategy === 'specialists'
              ? `de especialistas · Concurrencia aprobada ${data.plan.limits.concurrency}`
              : 'secuencial · Un solo trabajo activo por proyecto'}{' '}
            · Sin reintentos automáticos de código
          </p>
          <ExecutionDetails option={data.plan.execution} />
          <TeamBudget project={project.id} id={data.execution.budgetId} />
          {data.plan.template.definition.strategy === 'specialists' && (
            <>
              <section aria-label="Resultados reunidos">
                <h4>Resultados reunidos</h4>
                <p>
                  {data.gathering.complete ? 'Recogida completa' : 'Recogida incompleta'} ·
                  Recibidos: {data.gathering.received.join(', ') || 'ninguno'} · Ausentes:{' '}
                  {data.gathering.missing.join(', ') || 'ninguno'} · Conflictos:{' '}
                  {data.gathering.conflicts}
                </p>
                <p className="skill-text">
                  {data.gathering.summary ?? 'Resumen aún no disponible.'}
                </p>
              </section>
              <TeamMessageFeed project={project.id} id={id} steps={data.steps} />
            </>
          )}
          {data.execution.errorCode && (
            <p role="alert">
              Motivo: {data.execution.errorCode}. Consulta la evidencia parcial de cada etapa.
            </p>
          )}
          {['pending', 'running'].includes(data.execution.state) && (
            <button
              disabled={result.isLoading || data.execution.cancelRequested}
              onClick={() =>
                void cancel({ project: project.id, id })
                  .unwrap()
                  .catch(() => {})
              }
            >
              Cancelar equipo
            </button>
          )}
          <ol>
            {data.steps.map((step, index) => (
              <li key={step.id}>
                <h4>
                  {data.plan.steps[index]?.title} · {names[step.state]}
                </h4>
                <p>Depende de: {data.plan.steps[index]?.dependsOn.join(', ') || 'ninguna etapa'}</p>
                <p>
                  Rol: {data.plan.steps[index]?.agent.name} v{data.plan.steps[index]?.agent.version}
                </p>
                <ul>
                  {data.plan.steps[index]?.exitCriteria.map((criterion, i) => (
                    <li key={i}>{criterion}</li>
                  ))}
                </ul>
                {step.errorCode && <p>Motivo de la etapa: {step.errorCode}</p>}
                {step.delivery && (
                  <details>
                    <summary>Entrega de {step.key}</summary>
                    <p>{step.delivery.result || 'Sin resumen del agente.'}</p>
                    <p>
                      {step.delivery.verified
                        ? 'Controlador: pruebas y recogida confirmadas.'
                        : 'Entrega sin verificación suficiente para continuar.'}
                    </p>
                    <p className="skill-text">
                      Entrada: {step.delivery.inputHash} · Salida:{' '}
                      {step.delivery.outputHash ?? 'Desconocida'}
                    </p>
                    <ul>
                      {step.delivery.tests.map((test, i) => (
                        <li key={i}>
                          {test.command} · salida {test.exitCode ?? 'desconocida'} · {test.origin}
                        </li>
                      ))}
                    </ul>
                    <details>
                      <summary>Fuentes y hashes</summary>
                      <ul>
                        {step.delivery.sources.map((source) => (
                          <li className="skill-text" key={source.path}>
                            {source.path} · {source.hash}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <ul>
                      {step.delivery.doubts.map((doubt, i) => (
                        <li key={i}>{doubt}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {step.jobId && (
                  <button onClick={() => setReport(step.jobId!)}>Informe Codex · {step.key}</button>
                )}
              </li>
            ))}
          </ol>
          <h4>Historial persistente</h4>
          <ol>
            {data.events.map((event) => (
              <li key={event.sequence}>
                {event.sequence} · {event.type} · {event.message}
              </li>
            ))}
          </ol>
          {report && <StepReport key={report} project={project.id} id={report} />}
          <p>
            Las pruebas observadas no acreditan todos los criterios de aceptación. La revisión
            agregada y publicación de equipos corresponden a fases posteriores.
          </p>
        </>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </section>
  );
}
export function ProjectTeamRuns({ project }: { project: Project }) {
  const query = teamsApi.useTeamExecutionsQuery(project.id, {
    pollingInterval: 2000,
    refetchOnFocus: true,
    skipPollingIfUnfocused: true,
  });
  const [selected, setSelected] = useState('');
  const data = query.error ? undefined : query.currentData;
  return (
    <section className="team-surface" aria-label="Equipos en segundo plano">
      <h3>Equipos en segundo plano</h3>
      <p>
        Ejecuta un plan aprobado desde Tareas o desde la preparación de planes. Su coordinador
        conserva el avance en PostgreSQL.
      </p>
      {query.isLoading && <p role="status">Cargando equipos…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar lista de equipos</button>
        </p>
      )}
      {data && (
        <>
          {!data.executions.length && <p>Aún no hay ejecuciones de equipo.</p>}
          <ul className="agent-list">
            {data.executions.map((execution) => (
              <li key={execution.id}>
                <strong>{execution.title}</strong>
                <p>{names[execution.state]}</p>
                <button
                  onClick={() => setSelected(execution.id)}
                  aria-pressed={selected === execution.id}
                >
                  Ver equipo · {execution.id.slice(0, 8)}
                </button>
              </li>
            ))}
          </ul>
          {selected && <TeamRunDetails key={selected} project={project} id={selected} />}
        </>
      )}
    </section>
  );
}
