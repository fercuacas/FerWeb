import { useEffect, useRef, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  codingOption,
  codingToolProfile,
  supportsAgent,
  type CodingToolProfile,
} from '@ferweb/contracts';
import type { Job } from '@ferweb/contracts';
import { agentsApi } from './agents-store';
import { SkillPreview, SkillText } from './Skills';
import { codingApi } from './coding-store';
import { githubApi } from './github-store';
import { workspaceApi, errorMessage } from './workspace-store';
import { CodingReview, CodingComparison } from './CodingReview';
import { ExecutionDetails } from './ExecutionDetails';
import { budgetsApi } from './budgets-store';
import { attributionNames, BudgetUsage } from './Budgets';
import { usageAttribution } from '@ferweb/contracts';
import { ContextPreparer, ContextReceiptView, type ContextSelection } from './ContextPacks';
import { MemoryPicker, MemoryText, type MemorySelection } from './ProjectKnowledge';
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
  const agents = agentsApi.useAgentsQuery(project, { refetchOnFocus: true });
  const budgets = budgetsApi.useBudgetsQuery(project, { refetchOnFocus: true });
  const [budgetId, setBudgetId] = useState('');
  const [context, setContext] = useState<ContextSelection>({
    enabled: false,
    reference: null,
    valid: true,
  });
  const [memory, setMemory] = useState<MemorySelection[]>([]),
    [memoryValid, setMemoryValid] = useState(true);
  const [attribution, setAttribution] =
    useState<(typeof usageAttribution.options)[number]>('agent');
  const [agentId, setAgentId] = useState('');
  const [agentVersion, setAgentVersion] = useState(0);
  const [toolProfile, setToolProfile] = useState<CodingToolProfile>('node-isolated-v1');
  const history = agentsApi.useAgentQuery(agentId ? { project, id: agentId } : skipToken, {
    refetchOnFocus: true,
  });
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
  const execution = options && codingOption(options, toolProfile);
  const selectedModel = model || options?.models[0] || '';
  const roles = agents.error
    ? []
    : (agents.currentData?.roles.filter((role) => !role.archivedAt) ?? []);
  const versions =
    execution &&
    !agents.error &&
    !history.error &&
    roles.some((role) => role.id === agentId) &&
    history.currentData &&
    !history.currentData.role.archivedAt
      ? history.currentData.versions.filter((version) =>
          [version, ...(version.skills ?? [])].every((item) => supportsAgent(item, execution)),
        )
      : [];
  const selectedAgent = versions.find((version) => version.version === agentVersion);
  const budgetChoices = budgets.error
    ? []
    : (budgets.currentData?.budgets.filter((item) => !item.stopReason) ?? []);
  const budgetAvailable = !budgetId || budgetChoices.some((item) => item.id === budgetId);
  useEffect(() => {
    request.current = crypto.randomUUID();
  }, [context.reference?.id, context.reference?.hash]);
  const ready =
    (!context.enabled || (context.valid && !!context.reference)) &&
    memoryValid &&
    !!task &&
    !!link?.snapshot &&
    !link.stale &&
    !link.revoked &&
    !link.snapshot.treeTruncated &&
    execution?.available &&
    execution.models.some((item) => item.id === selectedModel) &&
    (!agentId || !!selectedAgent) &&
    budgetAvailable &&
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
              ...(toolProfile === 'typescript-react-v1' && { toolProfile }),
              timeoutMs,
              maxRequests,
              maxOutputTokens,
              ...(budgetId && { budgetId }),
              attribution,
              ...(context.reference
                ? { contextReceipt: context.reference }
                : memory.length
                  ? { memory }
                  : {}),
              ...(selectedAgent && {
                agent: { id: selectedAgent.id, version: selectedAgent.version },
              }),
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
          <ContextPreparer
            project={project}
            taskId={task?.id ?? ''}
            taskVersion={task?.version ?? 0}
            agent={
              selectedAgent ? { id: selectedAgent.id, version: selectedAgent.version } : undefined
            }
            model={selectedModel}
            toolProfile={toolProfile}
            memory={memory}
            onChange={setContext}
          />
          <MemoryPicker
            project={project}
            value={memory}
            onChange={(value) => {
              setMemory(value);
              request.current = crypto.randomUUID();
            }}
            onValidity={setMemoryValid}
          />
          <p>
            Codex trabaja en una copia separada del commit. Revisa el diff y las pruebas antes de
            aplicar los cambios.
          </p>
          <label>
            Perfil de herramientas
            <select
              value={toolProfile}
              onChange={(e) => {
                setToolProfile(codingToolProfile.parse(e.target.value));
                setAgentVersion(0);
              }}
            >
              <option value="node-isolated-v1">Node aislado</option>
              <option value="typescript-react-v1">TypeScript/React aislado</option>
            </select>
          </label>
          {execution && <ExecutionDetails option={execution} />}
          {execution?.destination === 'openai-api' && (
            <p>
              Al ejecutar, la tarea, las instrucciones del rol y sus materiales vinculados se
              enviarán a OpenAI mediante la API configurada.
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
            Rol de agente
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setAgentVersion(0);
              }}
            >
              <option value="">Sin rol personalizado</option>
              {agentId && !roles.some((role) => role.id === agentId) && (
                <option value={agentId} disabled>
                  Rol seleccionado no disponible
                </option>
              )}
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.latest.name}
                </option>
              ))}
            </select>
          </label>
          {agentId && (
            <label>
              Versión del agente
              <select
                value={selectedAgent?.version ?? ''}
                disabled={!versions.length}
                onChange={(e) => setAgentVersion(Number(e.target.value))}
              >
                <option value="">Seleccionar versión compatible</option>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    {version.name} · versión {version.version}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!!selectedAgent?.skills?.length && (
            <>
              <p>
                Material para el modelo:{' '}
                {selectedAgent.skills.map((item) => `${item.name} v${item.version}`).join(', ')}.
              </p>
              <SkillPreview project={project} ids={selectedAgent.skills.map((item) => item.id)} />
            </>
          )}
          {agents.isLoading || history.isFetching ? (
            <p role="status">Consultando roles y versiones…</p>
          ) : agentId && !versions.length && !agents.error && !history.error ? (
            <p>No hay versiones de este rol compatibles con el ejecutor actual.</p>
          ) : null}
          {(agents.error || history.error) && (
            <p role="alert" className="form-error">
              {errorMessage(agents.error || history.error)}
            </p>
          )}
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
          <label>
            Presupuesto de ejecución
            <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
              <option value="">Crear presupuesto propio para esta ejecución</option>
              {!budgetAvailable && (
                <option value={budgetId} disabled>
                  Presupuesto seleccionado no disponible
                </option>
              )}
              {budgetChoices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · disponibles {item.availableRequests}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atribución de uso
            <select
              value={attribution}
              onChange={(e) => setAttribution(usageAttribution.parse(e.target.value))}
            >
              {usageAttribution.options.map((value) => (
                <option key={value} value={value}>
                  {attributionNames[value]}
                </option>
              ))}
            </select>
          </label>
          {budgets.error && <p role="alert">{errorMessage(budgets.error)}</p>}
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
const controlLabels = {
  impact: 'Alcance congelado',
  configuration: 'Protección de configuración',
  verification: 'Verificación del perfil',
  artifact: 'Control de entrega',
};
const controlStates = {
  not_run: 'Sin ejecutar',
  running: 'En curso',
  passed: 'Superado',
  failed: 'Fallido',
  blocked: 'Bloqueado',
  timeout: 'Tiempo agotado',
  interrupted: 'Interrumpido',
};
const controlDetails: Record<string, string> = {
  snapshot_recorded: 'Se registraron el commit y los archivos antes de lanzar el agente.',
  receipt_reused: 'Se reutilizó el recibo P10 de esta ejecución.',
  reserved_paths_locked: 'Las rutas reservadas están protegidas contra escritura y sustitución.',
  readonly_workspace: 'El volumen completo se montó en solo lectura.',
  workspace_not_ready: 'El espacio de trabajo no respondió dentro del plazo de preparación.',
  workspace_setup_failed: 'Falló la preparación del espacio de trabajo.',
  verification_deadline: 'La comprobación independiente agotó su plazo.',
  verification_interrupted: 'El proceso de verificación terminó por una señal.',
  profile_failed: 'La comprobación devolvió un error. Consulta la salida del controlador.',
  profile_passed: 'La comprobación independiente del perfil se completó correctamente.',
  no_tests_executed:
    'Node no informó de ninguna prueba superada. Añade o habilita pruebas para verificar el trabajo.',
  protected_artifact_changed: 'Se rechazó la entrega porque modifica una ruta reservada.',
  artifact_unavailable: 'No se pudo recoger un snapshot final válido.',
  snapshot_collected: 'Se recogió el snapshot y se comprobó el alcance protegido.',
};
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
          {visible.environment?.profile === 'typescript-react-v1' && (
            <p>Perfil congelado · TypeScript/React aislado</p>
          )}
          {visible.budget ? (
            <BudgetUsage budget={visible.budget} />
          ) : (
            <p>
              Esta ejecución antigua conserva el informe sin contabilidad de peticiones del
              presupuesto padre.
            </p>
          )}
          {visible.agent && (
            <details>
              <summary>
                Rol congelado · {visible.agent.name} · versión {visible.agent.version}
              </summary>
              <pre>{JSON.stringify({ ...visible.agent, materials: undefined }, null, 2)}</pre>
              {visible.agent.materials?.map((skill) => (
                <SkillText key={skill.id} skill={skill} />
              ))}
            </details>
          )}
          {!!visible.memory.length && (
            <details>
              <summary>Memoria congelada para la ejecución</summary>
              {visible.memory.map((entry) => (
                <MemoryText key={entry.id} entry={entry} />
              ))}
            </details>
          )}
          {visible.contextReceipt && (
            <ContextReceiptView project={project} id={visible.contextReceipt.id} />
          )}
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
          {report.controls && (
            <details>
              <summary>Controles de ejecución</summary>
              <p>{report.controls.files} archivos en el alcance inicial.</p>
              <p className="job-id">Huella del alcance · {report.controls.inputHash}</p>
              <p>Rutas reservadas en la raíz · {report.controls.protectedRoots.join(', ')}</p>
              <ul>
                {report.controls.events.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {controlLabels[event.id]} · {controlStates[event.status]}
                    </strong>
                    {event.durationMs !== null && <span> · {event.durationMs} ms</span>}
                    {controlDetails[event.code] && <p>{controlDetails[event.code]}</p>}
                    {event.paths.length > 0 && <p className="job-id">{event.paths.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
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
              <p>
                {c.origin === 'controller-typecheck'
                  ? 'Comprobación de tipos del controlador'
                  : c.origin}
              </p>
              <pre>{c.output || 'Sin salida capturada.'}</pre>
            </details>
          ))}
          <h4>Limitaciones</h4>
          <ul>
            {report.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {!active && !visible?.teamExecutionId && (
            <CodingComparison key={job.id} project={project} id={job.id} onSelect={onSelect} />
          )}
          {['completed', 'failed'].includes(job.state) &&
            report.diffComplete &&
            report.terminationConfirmed &&
            visible &&
            report.diff.length > 0 && (
              <CodingReview
                key={job.id}
                project={project}
                run={visible}
                publicationAvailable={job.state === 'completed'}
              />
            )}
        </>
      )}
    </section>
  );
}
