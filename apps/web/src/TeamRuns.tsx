import { useState, useRef } from 'react';
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
export function TeamLauncher({ project, plan }: { project: Project; plan: TeamPlan }) {
  const query = githubApi.useGithubLinkQuery(project.id, { refetchOnFocus: true });
  const [start, result] = teamsApi.useExecuteTeamPlanMutation();
  const [confirmed, setConfirmed] = useState('');
  const request = useRef({ commit: '', id: crypto.randomUUID() });
  const link = query.error ? undefined : query.currentData?.link;
  const commit = link?.snapshot?.commit ?? '';
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
      {ready && (
        <>
          <p className="skill-text">Commit a congelar: {commit}</p>
          <p>
            Se crearán {plan.snapshot.steps.length} etapas secuenciales con un presupuesto de{' '}
            {plan.snapshot.limits.maxRequests} peticiones y {plan.snapshot.limits.timeoutMs / 1000}{' '}
            segundos. El proveedor y los roles son los de esta copia aprobada.
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
            disabled={confirmed !== commit || result.isLoading || !!project.archivedAt}
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
            Ejecutar equipo secuencial
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
            Una pasada secuencial · Un solo trabajo activo por proyecto · Sin reintentos automáticos
            de código
          </p>
          <ExecutionDetails option={data.plan.execution} />
          <TeamBudget project={project.id} id={data.execution.budgetId} />
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
