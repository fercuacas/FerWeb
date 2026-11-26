import { useState, useRef, useEffect } from 'react';
import type { z } from 'zod';
import type { teamMessage, teamIntegration } from '@ferweb/contracts';
import type { Project, TeamPlan } from '@ferweb/contracts';
import { teamsApi } from './teams-store';
import { jobsApi } from './jobs-store';
import { CodingView } from './Coding';
import { LocalReadView } from './LocalSpecialists';
import { SaveDeliveryMemory } from './ProjectKnowledge';
import { errorMessage } from './workspace-store';
import { ExecutionDetails } from './ExecutionDetails';
import { budgetsApi } from './budgets-store';
import { BudgetUsage } from './Budgets';
import { githubApi } from './github-store';
import { ContextReceiptView } from './ContextPacks';
import { PlanRouting } from './PlanRouting';

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
        Por defecto, un trabajo por proyecto. El máximo global sigue siendo dos. Pueden coincidir
        especialistas de lectura o escritores con copias aisladas del mismo equipo.
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
            {plan.snapshot.template.definition.strategy === 'writers'
              ? 'de escritores aislados e integración'
              : plan.snapshot.template.definition.strategy === 'specialists'
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
            {plan.snapshot.template.definition.strategy === 'writers'
              ? 'Ejecutar escritores'
              : plan.snapshot.template.definition.strategy === 'specialists'
                ? 'Ejecutar especialistas'
                : 'Ejecutar equipo secuencial'}
          </button>
        </>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </div>
  );
}
function IntegrationView({
  project,
  id,
  stepId,
  integration,
  active,
}: {
  project: Project;
  id: string;
  stepId: string;
  integration: z.infer<typeof teamIntegration>;
  active: boolean;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [resolve, result] = teamsApi.useResolveTeamIntegrationMutation();
  const artifact = integration.artifact;
  return (
    <section aria-label="Integración de escritores">
      <h4>
        Integración v{artifact.version} ·{' '}
        {integration.state === 'conflict'
          ? 'Conflictos pendientes'
          : integration.state === 'ready'
            ? 'Pendiente de pruebas'
            : integration.state === 'verified'
              ? 'Verificada'
              : 'Fallida'}
      </h4>
      <p className="skill-text">
        Artefacto: {integration.hash}
        <br />
        Base: {artifact.baseHash}
        <br />
        Resultado: {artifact.resultHash ?? 'Bloqueado por conflictos'}
      </p>
      <p>
        La comparación conserva altas, bajas y contenido exactos. Cambios distintos en un mismo
        archivo requieren una selección; las advertencias de proximidad no garantizan
        compatibilidad.
      </p>
      {artifact.warnings.map((warning, i) => (
        <p key={i}>{warning}</p>
      ))}
      <details>
        <summary>Entregas y huellas de archivos</summary>
        <pre className="skill-text">{JSON.stringify(artifact, null, 2)}</pre>
      </details>
      {integration.verifierJobId && (
        <p>
          <a href={`#/projects/${project.id}/teams/${id}/steps/${stepId}`}>
            Verificación y revisión del resultado
          </a>{' '}
          · Informe {integration.reportHash}
        </p>
      )}
      {integration.state === 'conflict' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void resolve({
              project: project.id,
              id,
              body: {
                hash: integration.hash,
                choices: artifact.conflicts.map((c) => ({
                  path: c.path,
                  step: choices[c.path] === '__base__' ? null : choices[c.path]!,
                })),
              },
            })
              .unwrap()
              .catch(() => {});
          }}
        >
          {artifact.conflicts.map((conflict) => (
            <label key={conflict.path}>
              Resolver {conflict.path}
              <select
                required
                disabled={!active || !!project.archivedAt}
                value={choices[conflict.path] ?? ''}
                onChange={(e) => {
                  setChoices({ ...choices, [conflict.path]: e.target.value });
                  setConfirmed(false);
                }}
              >
                <option value="">Selecciona una versión</option>
                <option value="__base__">Conservar base</option>
                {conflict.steps.map((step) => (
                  <option key={step} value={step}>
                    Entrega de {step}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!active || !!project.archivedAt}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmo esta resolución para crear una versión nueva y verificarla
          </label>
          <button
            disabled={
              !active ||
              !!project.archivedAt ||
              !confirmed ||
              artifact.conflicts.some((c) => !choices[c.path]) ||
              result.isLoading
            }
          >
            Guardar resolución y verificar
          </button>
          {result.error && <p role="alert">{errorMessage(result.error)}</p>}
        </form>
      )}
    </section>
  );
}
function StepReport({ project, id, archived }: { project: string; id: string; archived: boolean }) {
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
      {job?.kind === 'local-readonly-v1' && <LocalReadView project={project} id={job.id} />}
      {job?.kind === 'codex-v1' && (
        <CodingView
          project={project}
          job={job}
          archived={archived}
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
export function TeamRunDetails({
  project,
  id,
  initialStepId,
}: {
  project: Project;
  id: string;
  initialStepId?: string | undefined;
}) {
  const query = teamsApi.useTeamExecutionQuery(
    { project: project.id, id },
    { pollingInterval: 1500, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  const [cancel, result] = teamsApi.useCancelTeamExecutionMutation();
  const [selectedStep, setSelectedStep] = useState(initialStepId ?? '');
  const data = query.error ? undefined : query.currentData;
  const report = data?.steps.find((step) => step.id === selectedStep);
  const teamUrl = `#/projects/${project.id}/teams/${id}`;
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
          <p>
            Propietario {data.owner} · Tarea de producto{' '}
            {data.taskStatus
              ? { todo: 'Pendiente', in_progress: 'En curso', done: 'Hecha' }[data.taskStatus]
              : 'Estado desconocido'}
          </p>
          <p>
            {data.steps.filter((step) => step.delivery?.verified).length} de {data.steps.length}{' '}
            etapas con entrega verificada · <a href={teamUrl}>Abrir seguimiento del equipo</a>
          </p>
          <p className="skill-text">
            Commit: {data.execution.commit} · Plan: {data.execution.planHash}
          </p>
          <p>
            {data.plan.template.definition.reviewMode
              ? `Hasta ${data.plan.maxIterations} rondas de revisión`
              : 'Una pasada'}{' '}
            {data.plan.template.definition.strategy === 'writers'
              ? `de escritores aislados · Concurrencia aprobada ${data.plan.limits.concurrency}`
              : data.plan.template.definition.strategy === 'specialists'
                ? `de especialistas · Concurrencia aprobada ${data.plan.limits.concurrency}`
                : 'secuencial · Un solo trabajo activo por proyecto'}{' '}
            · Sin reintentos automáticos de código
          </p>
          {data.plan.routing ? (
            <PlanRouting decision={data.plan.routing} />
          ) : (
            <ExecutionDetails option={data.plan.execution} />
          )}
          <TeamBudget project={project.id} id={data.execution.budgetId} />
          {data.integrations?.map((integration, index) => (
            <div key={integration.hash}>
              {index === data.integrations!.length - 1 ? (
                <IntegrationView
                  key={integration.hash}
                  project={project}
                  id={id}
                  stepId={
                    data.steps.find((step) => step.jobId === integration.verifierJobId)?.id ?? ''
                  }
                  integration={integration}
                  active={
                    ['pending', 'running'].includes(data.execution.state) &&
                    !data.execution.cancelRequested
                  }
                />
              ) : (
                <details>
                  <summary>Integración anterior v{integration.artifact.version}</summary>
                  <pre className="skill-text">{JSON.stringify(integration, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
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
          <ol className="control-steps">
            {data.steps.map((step) => {
              const definition = data.plan.steps.find((item) => item.key === step.key);
              const waiting = (definition?.dependsOn ?? []).filter(
                (key) =>
                  !data.steps.some(
                    (item) =>
                      item.key === key &&
                      item.iteration === step.iteration &&
                      item.delivery?.verified,
                  ),
              );
              return (
                <li key={step.id}>
                  <h4>
                    {definition?.title ?? step.key} · {names[step.state]}
                    {data.plan.template.definition.reviewMode && ` · Ronda ${step.iteration}`}
                  </h4>
                  <p>Depende de: {definition?.dependsOn.join(', ') || 'ninguna etapa'}</p>
                  <p>
                    Rol: {definition?.agent.name} v{definition?.agent.version}
                  </p>
                  {step.state === 'pending' && waiting.length > 0 && (
                    <p>Entregas pendientes de {waiting.join(', ')}.</p>
                  )}
                  {step.jobId && (
                    <>
                      <p>
                        Último latido de la etapa{' '}
                        {step.lastHeartbeatAt ? (
                          <time dateTime={step.lastHeartbeatAt}>
                            {new Date(step.lastHeartbeatAt).toLocaleString()}
                          </time>
                        ) : (
                          'Sin registrar'
                        )}
                        {step.workerConnected === false && ' · Conexión del ejecutor sin confirmar'}
                        {step.workerConnected === true && ' · Lease vigente y ejecutor conectado'}
                      </p>
                      <p>
                        Peticiones admitidas {step.admittedRequests ?? 'Desconocidas'} · Reserva{' '}
                        {step.reservedRequests ?? 'Desconocida'}
                      </p>
                      {step.progress && (
                        <p>
                          {step.progress.label} ·{' '}
                          <time dateTime={step.progress.at}>
                            {new Date(step.progress.at).toLocaleString()}
                          </time>
                        </p>
                      )}
                    </>
                  )}
                  {step.contextReceiptId && (
                    <details>
                      <summary>Fuentes de contexto de la etapa</summary>
                      <ContextReceiptView project={project.id} id={step.contextReceiptId} />
                    </details>
                  )}
                  <ul>
                    {definition?.exitCriteria.map((criterion, i) => (
                      <li key={i}>{criterion}</li>
                    ))}
                  </ul>
                  {step.errorCode && <p>Motivo de la etapa: {step.errorCode}</p>}
                  {step.delivery && (
                    <details>
                      <summary>Entrega de {step.key}</summary>
                      <p>{step.delivery.result || 'Sin resumen del agente.'}</p>
                      {step.delivery.verification === 'local-structure' && (
                        <p>
                          Formato y citas comprobados localmente. Conclusiones pendientes de
                          revisión humana; no se ejecutaron pruebas.
                        </p>
                      )}
                      {step.delivery.verified &&
                        step.delivery.verification !== 'local-structure' &&
                        !project.archivedAt && (
                          <SaveDeliveryMemory
                            project={project.id}
                            executionId={id}
                            stepId={step.id}
                            content={step.delivery.result}
                          />
                        )}
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
                    <button
                      aria-pressed={selectedStep === step.id}
                      onClick={() => setSelectedStep(step.id)}
                    >
                      {data.plan.execution.id === 'local-readonly-v1'
                        ? 'Informe local'
                        : 'Informe Codex'}{' '}
                      · {step.key}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <h4>Historial persistente</h4>
          <ol>
            {data.events.map((event) => (
              <li key={event.sequence}>
                {event.sequence} · {event.type} · {event.message}
              </li>
            ))}
          </ol>
          {report?.jobId && (
            <>
              <p>
                <a href={teamUrl + '/steps/' + report.id}>Abrir enlace directo al informe</a>
              </p>
              <StepReport
                key={report.jobId}
                project={project.id}
                id={report.jobId}
                archived={!!project.archivedAt}
              />
            </>
          )}
          {selectedStep && !report?.jobId && (
            <p role="status">Informe de etapa aún no disponible en esta ejecución.</p>
          )}
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
export function ProjectTeamRuns({
  project,
  initialTeamId,
  initialStepId,
}: {
  project: Project;
  initialTeamId?: string | undefined;
  initialStepId?: string | undefined;
}) {
  const query = teamsApi.useTeamExecutionsQuery(project.id, {
    pollingInterval: 2000,
    refetchOnFocus: true,
    skipPollingIfUnfocused: true,
  });
  const [selected, setSelected] = useState(initialTeamId ?? '');
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
          {selected && (
            <TeamRunDetails
              key={selected}
              project={project}
              id={selected}
              initialStepId={selected === initialTeamId ? initialStepId : undefined}
            />
          )}
        </>
      )}
    </section>
  );
}

export function TaskTeamHistory({ project, task }: { project: string; task: string }) {
  const [open, setOpen] = useState(false);
  const result = teamsApi.useTaskTeamExecutionsQuery(
    { project, task },
    {
      skip: !open,
      pollingInterval: 4000,
      refetchOnFocus: true,
      refetchOnMountOrArgChange: true,
      skipPollingIfUnfocused: true,
    },
  );
  const entries = result.error ? undefined : result.currentData?.executions;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Seguimiento de equipos de la tarea</summary>
      {open && result.isLoading && <p role="status">Cargando ejecuciones…</p>}
      {open && result.error && (
        <p role="alert">
          {errorMessage(result.error)}{' '}
          <button onClick={() => void result.refetch()}>Reintentar seguimiento</button>
        </p>
      )}
      {open && entries?.length === 0 && <p>Esta tarea todavía no tiene ejecuciones de equipo.</p>}
      {open && !!entries?.length && (
        <ul>
          {entries.map((item) => (
            <li key={item.id}>
              <a href={`#/projects/${project}/teams/${item.id}`}>
                {names[item.state]} · {new Date(item.createdAt).toLocaleString()} ·{' '}
                {item.id.slice(0, 8)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
