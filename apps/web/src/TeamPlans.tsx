import { useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  classifyPlanTask,
  codingOption,
  teamStepOrder,
  type Project,
  type TeamPlan,
  type CodingDestination,
} from '@ferweb/contracts';
import { teamsApi } from './teams-store';
import { codingApi } from './coding-store';
import { localReadApi } from './local-read-store';
import { workspaceApi, errorMessage } from './workspace-store';
import { ExecutionDetails, capabilityLabels } from './ExecutionDetails';
import { SkillText } from './Skills';
import { TeamLauncher, TeamRunDetails } from './TeamRuns';
import { TeamContextOptions, ContextReceiptView } from './ContextPacks';
import type { contextPackConfigure } from '@ferweb/contracts';
import type { z } from 'zod';
import { MemoryPicker, type MemorySelection } from './ProjectKnowledge';
import { ReviewCanvas } from './ReviewCanvas';
import { PlanRouting } from './PlanRouting';

export function PlanDetails({ project, id }: { project: Project; id: string }) {
  const query = teamsApi.useTeamPlanQuery({ project: project.id, id }, { refetchOnFocus: true });
  const [approve, result] = teamsApi.useApproveTeamPlanMutation();
  const [confirmed, setConfirmed] = useState('');
  const [transferConsent, setTransferConsent] = useState('');
  const plan = query.error ? undefined : query.currentData?.plan;
  const task = workspaceApi.useTaskQuery(
    plan ? { projectId: project.id, id: plan.snapshot.task.id } : skipToken,
    { refetchOnFocus: true },
  );
  const current = !task.error && task.currentData?.task.version === plan?.snapshot.task.version;
  const requiresTransfers = !!plan?.snapshot.routing?.reservedApiRequests;
  return (
    <section className="agent-history" aria-label="Detalle del plan">
      {query.isLoading && <p role="status">Cargando plan…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar</button>
        </p>
      )}
      {plan && (
        <>
          <h3>
            {plan.snapshot.task.title} · {plan.snapshot.template.definition.name}
          </h3>
          <p>
            Estado:{' '}
            {plan.state === 'executed'
              ? 'Iniciado'
              : plan.state === 'approved'
                ? 'Aprobado'
                : 'Preparado'}{' '}
            · Copia inmutable v{plan.snapshot.version}
          </p>
          <p className="skill-text">Hash: {plan.hash}</p>
          {plan.snapshot.routing && <PlanRouting decision={plan.snapshot.routing} />}
          {plan.snapshot.stepModels && (
            <section aria-label="Inferencia local del plan">
              <p>
                Workflow exclusivamente local. Selección y validación deterministas; cada entrega y
                resumen infiere con Ollama. GitHub sigue siendo una integración autorizada por
                separado.
              </p>
              <ul>
                {plan.snapshot.stepModels.map((m) => (
                  <li key={m.step} className="skill-text">
                    {m.step}: Ollama · {m.model} · revisión observada {m.revision}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p>
            <a href={`#/projects/${project.id}/plans/${plan.id}`}>Abrir enlace directo al plan</a>
          </p>
          {plan.snapshot.contexts?.map((item) => (
            <section key={item.step}>
              <h4>Contexto del rol: {item.step}</h4>
              <ContextReceiptView project={project.id} id={item.receipt.id} />
            </section>
          ))}
          {!!plan.snapshot.memory?.length && (
            <details>
              <summary>Referencias de memoria congeladas</summary>
              <pre className="skill-text">{JSON.stringify(plan.snapshot.memory, null, 2)}</pre>
              <p>Sin revisar; las fuentes se comprueban de nuevo al aprobar y ejecutar.</p>
            </details>
          )}
          {plan.snapshot.reviewTarget && (
            <details>
              <summary>Diff congelado de la revisión</summary>
              <p className="skill-text">
                Ejecución: {plan.snapshot.reviewTarget.jobId} · Diff:{' '}
                {plan.snapshot.reviewTarget.diffHash} · Artefacto:{' '}
                {plan.snapshot.reviewTarget.artifactHash}
              </p>
              {plan.snapshot.reviewTarget.diff.map((file) => (
                <pre className="skill-text" key={file.path}>
                  {file.path}
                  {'\n'}
                  {file.patch}
                </pre>
              ))}
            </details>
          )}
          <p>
            Tarea v{plan.snapshot.task.version} · Plantilla v{plan.snapshot.template.version} ·{' '}
            {plan.snapshot.mode === 'single' ? 'Agente único' : 'Equipo'}
            {!plan.snapshot.routing &&
              ` · Modelo: ${plan.snapshot.model ?? 'Sin modelo disponible'}`}
          </p>
          {!plan.snapshot.routing && <ExecutionDetails option={plan.snapshot.execution} />}
          <p>
            Máximo previsto: {plan.snapshot.plannedRequests} peticiones · Presupuesto:{' '}
            {plan.snapshot.limits.maxRequests} · Iteraciones: {plan.snapshot.maxIterations} ·
            Tiempo: {plan.snapshot.limits.timeoutMs / 1000} segundos · Concurrencia:{' '}
            {plan.snapshot.limits.concurrency}
          </p>
          <p>
            Esta preparación no consume inferencia ni reserva presupuesto. Tokens y coste: sin
            estimación disponible.
          </p>
          <details>
            <summary>Tarea y criterios congelados</summary>
            <p>{plan.snapshot.task.description}</p>
            <ul>
              {plan.snapshot.task.acceptanceCriteria.map((criterion, index) => (
                <li key={index}>{criterion}</li>
              ))}
            </ul>
          </details>
          <ol>
            {plan.snapshot.steps.map((step) => (
              <li key={step.key}>
                <h4>
                  {step.title} · {step.key}
                </h4>
                <p>
                  {step.agent.name} v{step.agent.version} · Máximo {step.maxRequests} peticiones ·
                  Depende de: {step.dependsOn.join(', ') || 'ninguna etapa'}
                </p>
                {step.paths && <p>Rutas aprobadas: {step.paths.join(', ')}</p>}
                {!plan.snapshot.routing && (
                  <p>
                    Inferencia del rol:{' '}
                    {plan.snapshot.execution.id === 'local-readonly-v1'
                      ? `Ollama local · ${plan.snapshot.stepModels?.find((m) => m.step === step.key)?.model}`
                      : `${plan.snapshot.execution.id === 'codex-local-v1' ? 'Codex + Ollama local' : 'API'} · ${plan.snapshot.model ?? 'Sin modelo'}`}
                  </p>
                )}
                <p>
                  Capacidades:{' '}
                  {step.requiredCapabilities.map((key) => capabilityLabels[key]).join(', ')}
                </p>
                <ul>
                  {step.exitCriteria.map((criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ))}
                </ul>
                <details>
                  <summary>Rol y skills congelados</summary>
                  <p>{step.agent.purpose}</p>
                  <pre className="skill-text">{step.agent.instructions}</pre>
                  <p>Formato: {step.agent.outputFormat}</p>
                  <p>
                    Perfiles: {step.agent.allowedToolProfiles.join(', ')} · Capacidades del rol:{' '}
                    {step.agent.requiredCapabilities.join(', ')}
                  </p>
                  {step.agent.materials?.map((material) => (
                    <SkillText key={material.id} skill={material} />
                  ))}
                </details>
              </li>
            ))}
          </ol>
          <ReviewCanvas
            project={project.id}
            kind="plan"
            id={plan.id}
            archived={!!project.archivedAt}
            executed={!!plan.executionId}
          />
          {plan.changesRequested && (
            <p>Se solicitaron cambios. Prepara una copia nueva para volver a aprobar.</p>
          )}
          {task.currentData && !current && (
            <p>La tarea tiene otra versión. Prepara un plan con la versión vigente.</p>
          )}
          {!project.archivedAt &&
            plan.state === 'prepared' &&
            !plan.changesRequested &&
            current && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed === plan.hash}
                    onChange={(e) => setConfirmed(e.target.checked ? plan.hash : '')}
                  />
                  He revisado esta copia, sus roles, skills, criterios y presupuesto
                </label>
                {requiresTransfers && (
                  <label>
                    <input
                      type="checkbox"
                      checked={transferConsent === plan.hash}
                      onChange={(event) =>
                        setTransferConsent(event.target.checked ? plan.hash : '')
                      }
                    />
                    Autorizo las transferencias a la API indicadas para esta copia
                  </label>
                )}
                <button
                  className="primary-button"
                  disabled={
                    confirmed !== plan.hash ||
                    (requiresTransfers && transferConsent !== plan.hash) ||
                    result.isLoading ||
                    !plan.snapshot.execution.available ||
                    !plan.snapshot.model
                  }
                  onClick={() =>
                    void approve({
                      project: project.id,
                      id,
                      body: {
                        hash: plan.hash,
                        version: plan.snapshot.version,
                        ...(requiresTransfers && { acceptApiTransfers: true }),
                      },
                    })
                      .unwrap()
                      .catch(() => {})
                  }
                >
                  Aprobar este plan
                </button>
              </>
            )}
          {plan.approval && current && (
            <p>
              Aprobación vinculada al hash de esta copia. Si cambias tarea, roles, skills o
              plantilla, prepara y aprueba un plan nuevo.
            </p>
          )}
          {!project.archivedAt && plan.state === 'approved' && current && (
            <TeamLauncher project={project} plan={plan} />
          )}
          {plan.executionId && <TeamRunDetails project={project} id={plan.executionId} />}
          <p>No se publican cambios automáticamente.</p>
        </>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </section>
  );
}

function PlansContent({ project }: { project: Project }) {
  const tasksQuery = workspaceApi.useTasksQuery({ projectId: project.id, filters: {} });
  const templatesQuery = teamsApi.useTeamTemplatesQuery(project.id);
  const capabilities = codingApi.useCodingCapabilitiesQuery(project.id);
  const plansQuery = teamsApi.useTeamPlansQuery(project.id);
  const [prepare, preparing] = teamsApi.usePrepareTeamPlanMutation();
  const [taskId, setTask] = useState('');
  const [context, setContext] = useState<z.infer<typeof contextPackConfigure> | null>(null);
  const [memory, setMemory] = useState<MemorySelection[]>([]),
    [memoryValid, setMemoryValid] = useState(true);
  const [templateId, setTemplate] = useState('');
  const templateQuery = teamsApi.useTeamTemplateQuery(
    templateId ? { project: project.id, id: templateId } : skipToken,
  );
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<'auto' | 'single' | 'team'>('auto');
  const [singleStep, setStep] = useState('');
  const [model, setModel] = useState('');
  const [routing, setRouting] = useState<'default' | 'rules' | 'mixed'>('default');
  const [apiLimit, setApiLimit] = useState<number | null>(null);
  const [destinations, setDestinations] = useState<Partial<Record<string, CodingDestination>>>({});
  const [routedModels, setRoutedModels] = useState<Partial<Record<string, string>>>({});
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const tasks = tasksQuery.error ? undefined : tasksQuery.currentData?.tasks;
  const templates = templatesQuery.error ? undefined : templatesQuery.currentData?.templates;
  const detail = templateQuery.error ? undefined : templateQuery.currentData;
  const plans = plansQuery.error ? undefined : plansQuery.currentData?.plans;
  const task = tasks?.find((item) => item.id === taskId);
  const template = detail?.versions.find(
    (item) => item.version === (version || detail.template.latest.version),
  );
  const specialists = template?.definition.strategy === 'specialists';
  const local = template?.definition.inferenceMode === 'local-only';
  const localCapabilities = localReadApi.useLocalCapabilitiesQuery(local ? project.id : skipToken);
  const [stepModels, setStepModels] = useState<Record<string, string>>({});
  const writers = template?.definition.strategy === 'writers';
  const localCoding = template?.definition.inferenceMode === 'local-coding-only';
  const mixed = routing === 'mixed' && !local && !localCoding && !specialists && !writers;
  const withRules = !local && (mixed || routing === 'rules');
  const routingLimit = localCoding ? 0 : (apiLimit ?? template?.definition.limits.maxRequests ?? 0);
  const execution = local
    ? localCapabilities.error
      ? undefined
      : localCapabilities.currentData?.execution
    : !capabilities.error && capabilities.currentData
      ? codingOption(
          capabilities.currentData,
          template?.definition.toolProfile,
          specialists,
          template?.definition.inferenceMode === 'local-coding-only' ? 'codex-local-v1' : undefined,
        )
      : undefined;
  const effectiveModel = execution?.models.some((item) => item.id === model)
    ? model
    : (execution?.models[0]?.id ?? '');
  const classification = task ? classifyPlanTask(task) : null;
  const single =
    !specialists &&
    !writers &&
    !mixed &&
    (mode === 'single' || (mode === 'auto' && classification?.recommendedMode === 'single'));
  const orderedSteps = template
    ? teamStepOrder(template.definition.steps)!.map((key) =>
        template.definition.steps.find((step) => step.key === key)!,
      )
    : [];
  const effectiveSteps = orderedSteps.filter(
    (step) => !single || step.key === (mode === 'single' ? singleStep : orderedSteps[0]?.key),
  );
  const plannedRequests = template
    ? effectiveSteps.reduce((sum, step) => sum + step.maxRequests, 0) *
      template.definition.maxIterations
    : null;
  const routingReady =
    !mixed ||
    (new Set(effectiveSteps.map(({ key }) => destinations[key])).size === 2 &&
      effectiveSteps.every(({ key }) => !!destinations[key]));
  const stageCatalog = (destination: CodingDestination) =>
    capabilities.currentData && !capabilities.error
      ? codingOption(capabilities.currentData, template?.definition.toolProfile, false, destination)
      : undefined;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!task || !template || !execution || !memoryValid || !routingReady) return;
    setError('');
    try {
      const { plan }: { plan: TeamPlan } = await prepare({
        project: project.id,
        body: {
          requestId: crypto.randomUUID(),
          ...(memory.length && { memory }),
          taskId: task.id,
          ...(context && { context }),
          taskVersion: task.version,
          templateId: template.id,
          templateVersion: template.version,
          mode: specialists || writers || mixed ? 'team' : mode,
          ...(!specialists && !writers && !mixed && mode === 'single' && { singleStep }),
          executionId: local
            ? 'local-readonly-v1'
            : template.definition.inferenceMode === 'local-coding-only'
              ? 'codex-local-v1'
              : 'codex-v1',
          ...(local && {
            stepModels: effectiveSteps.map((s) => ({
              step: s.key,
              model: stepModels[s.key] || effectiveModel,
            })),
          }),
          model: mixed ? null : effectiveModel || null,
          ...(withRules && {
            routing: {
              mode: mixed ? 'mixed' : localCoding ? 'local' : 'api',
              maxApiRequests: routingLimit,
              ...(mixed && {
                stages: effectiveSteps.map(({ key }) => ({
                  step: key,
                  destination: destinations[key]!,
                  ...(routedModels[key] && { model: routedModels[key] }),
                })),
              }),
            },
          }),
        },
      }).unwrap();
      setSelected(plan.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  const failures = [
    tasksQuery.error,
    templatesQuery.error,
    templateQuery.error,
    local ? localCapabilities.error : capabilities.error,
    plansQuery.error,
  ].filter(Boolean);
  return (
    <>
      <p>
        Elige una tarea de producto y una plantilla. Cada preparación guarda una copia
        independiente; la aprobación queda ligada a su hash.
      </p>
      {(tasksQuery.isLoading ||
        templatesQuery.isLoading ||
        plansQuery.isLoading ||
        capabilities.isLoading) && <p role="status">Cargando datos para preparar planes…</p>}
      {failures.length > 0 && (
        <p role="alert">
          {errorMessage(failures[0])}{' '}
          <button
            onClick={() => {
              void tasksQuery.refetch();
              void templatesQuery.refetch();
              void plansQuery.refetch();
              void capabilities.refetch();
              if (local) void localCapabilities.refetch();
              if (templateId) void templateQuery.refetch();
            }}
          >
            Reintentar planes
          </button>
        </p>
      )}
      {!project.archivedAt && tasks && templates && (
        <form className="job-form" aria-label="Preparar plan" onSubmit={(e) => void submit(e)}>
          <TeamContextOptions value={context} onChange={setContext} />
          <MemoryPicker
            project={project.id}
            value={memory}
            onChange={setMemory}
            onValidity={setMemoryValid}
          />
          {!tasks.length && <p>Crea una tarea antes de preparar un plan.</p>}
          {!templates.some((item) => !item.archivedAt) && (
            <p>Crea una plantilla de equipo desde Agentes → Equipos y plantillas.</p>
          )}
          <div className="job-grid">
            <label>
              Tarea del plan
              <select required value={taskId} onChange={(e) => setTask(e.target.value)}>
                <option value="">Selecciona una tarea</option>
                {tasks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · v{item.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Plantilla del plan
              <select
                required
                value={templateId}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setVersion(0);
                  setStep('');
                  setRouting('default');
                  setApiLimit(null);
                  setDestinations({});
                  setRoutedModels({});
                }}
              >
                <option value="">Selecciona una plantilla</option>
                {templates
                  .filter((item) => !item.archivedAt && !item.latest.definition.reviewMode)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.latest.definition.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Versión de la plantilla
              <select
                required
                disabled={!detail}
                value={template?.version ?? ''}
                onChange={(e) => {
                  setVersion(Number(e.target.value));
                  setStep('');
                  setRouting('default');
                  setApiLimit(null);
                  setDestinations({});
                  setRoutedModels({});
                }}
              >
                {detail?.versions.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version} · {item.definition.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modo del plan
              <select
                disabled={specialists || writers || mixed}
                value={specialists || writers || mixed ? 'team' : mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="auto">Automático según tamaño</option>
                <option value="single">Agente único</option>
                <option value="team">Equipo completo</option>
              </select>
            </label>
            {!specialists && !writers && !mixed && mode === 'single' && (
              <label>
                Etapa del agente único
                <select required value={singleStep} onChange={(e) => setStep(e.target.value)}>
                  <option value="">Selecciona una etapa</option>
                  {template?.definition.steps.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!mixed && (
              <label>
                Modelo del plan
                <select
                  disabled={!execution?.models.length}
                  value={effectiveModel}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {!execution?.models.length && <option value="">Sin modelo disponible</option>}
                  {execution?.models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {template && !local && (
            <fieldset>
              <legend>Selección de inferencia</legend>
              <label>
                Política del plan
                <select
                  value={routing}
                  onChange={(event) => setRouting(event.target.value as typeof routing)}
                >
                  <option value="default">Destino de la plantilla</option>
                  <option value="rules">
                    Reglas con {localCoding ? 'Ollama local' : 'API de OpenAI'}
                  </option>
                  {!localCoding &&
                    !specialists &&
                    !writers &&
                    template.definition.steps.length > 1 && (
                      <option value="mixed">Mixto por etapas</option>
                    )}
                </select>
              </label>
              {withRules && !localCoding && (
                <label>
                  Límite de peticiones a la API
                  <input
                    type="number"
                    required
                    min={0}
                    max={template.definition.limits.maxRequests}
                    value={routingLimit}
                    onChange={(event) => setApiLimit(event.target.valueAsNumber)}
                  />
                </label>
              )}
              {mixed && (
                <>
                  <p>
                    Elige ambos destinos en etapas distintas. Las etapas API pueden recibir el
                    workspace y las entregas de etapas locales de este mismo plan. La vista previa
                    detalla las transferencias que autorizarás.
                  </p>
                  {effectiveSteps.map(({ key, title }) => {
                    const destination = destinations[key];
                    const catalog = destination ? stageCatalog(destination) : undefined;
                    return (
                      <div key={key} className="job-grid">
                        <label>
                          Destino de {title}
                          <select
                            required
                            value={destination ?? ''}
                            onChange={(event) => {
                              setDestinations({
                                ...destinations,
                                [key]: (event.target.value || undefined) as
                                  CodingDestination | undefined,
                              });
                              setRoutedModels({ ...routedModels, [key]: undefined });
                            }}
                          >
                            <option value="">Elige destino</option>
                            <option value="codex-v1">API de OpenAI</option>
                            <option value="codex-local-v1">Ollama local</option>
                          </select>
                        </label>
                        <label>
                          Modelo de {title}
                          <select
                            disabled={!catalog?.available}
                            value={routedModels[key] ?? ''}
                            onChange={(event) =>
                              setRoutedModels({ ...routedModels, [key]: event.target.value })
                            }
                          >
                            <option value="">Primer modelo permitido</option>
                            {catalog?.models.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        {destination && !catalog?.available && (
                          <p>Este destino no está disponible.</p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </fieldset>
          )}
          {specialists && (
            <p>
              Este workflow requiere todos los especialistas y su resumen.{' '}
              {local
                ? 'Cada rol recibe extractos acotados como datos, sin shell ni escritura; selección y validación deterministas, con resumen también local. GitHub se autoriza por separado.'
                : 'Las fuentes se montan como solo lectura y el límite del proyecto debe permitir la concurrencia solicitada.'}
            </p>
          )}
          {local && execution && (
            <fieldset>
              <legend>Modelo local por rol</legend>
              {effectiveSteps.map((step) => (
                <label key={step.key}>
                  {step.title} · Ollama local
                  <select
                    aria-label={`Modelo local: ${step.title}`}
                    value={stepModels[step.key] || effectiveModel}
                    onChange={(e) => setStepModels({ ...stepModels, [step.key]: e.target.value })}
                  >
                    {execution.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} · {m.revision ?? 'Sin revisión'}
                      </option>
                    ))}
                  </select>
                  <small>
                    Requiere texto. No requiere ni concede herramientas, escritura o formato
                    garantizado por el modelo.
                  </small>
                </label>
              ))}
            </fieldset>
          )}
          {writers && (
            <p>
              Escritores con copias separadas y rutas exactas. Los solapamientos requieren
              resolución si las entregas difieren; la combinación pasa pruebas y revisión propias.
            </p>
          )}
          {classification && !specialists && !writers && (
            <p>
              Clasificación orientativa por longitud y número de criterios:{' '}
              {{ small: 'pequeña', medium: 'mediana', large: 'grande' }[classification.size]}.
              Recomendación:{' '}
              {classification.recommendedMode === 'single' ? 'agente único' : 'equipo'}. Puedes
              cambiar el modo.
            </p>
          )}
          {template && (
            <>
              <p>
                Etapas elegidas:{' '}
                {effectiveSteps.map((item) => item.title).join(', ') || 'Selecciona una etapa'} ·
                Máximo de iteraciones: {template.definition.maxIterations}
              </p>
              <ul>
                {effectiveSteps.map((step) => (
                  <li key={step.key}>
                    {step.title} · Rol v{step.role.version} · Depende de:{' '}
                    {single ? 'ninguna etapa' : step.dependsOn.join(', ') || 'ninguna etapa'}
                  </li>
                ))}
              </ul>
              <p>
                Máximo previsto: {plannedRequests} peticiones · Presupuesto:{' '}
                {template.definition.limits.maxRequests} ·{' '}
                {template.definition.limits.timeoutMs / 1000} segundos
              </p>
            </>
          )}
          {mixed ? null : execution ? (
            <ExecutionDetails option={execution} />
          ) : (
            <p role="status">Elige una plantilla o espera su diagnóstico de ejecución.</p>
          )}
          {!mixed && !execution?.available && (
            <p>
              {local
                ? 'Configura un modelo Ollama instalado, permitido y con revisión observada antes de preparar el workflow local.'
                : 'Puedes guardar una preparación bloqueada. Configura el ejecutor y prepara una copia nueva para aprobarla.'}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            className="primary-button"
            disabled={
              preparing.isLoading ||
              !memoryValid ||
              !execution ||
              !routingReady ||
              (local && !execution.available) ||
              !task ||
              !template ||
              (!specialists && !writers && !mixed && mode === 'single' && !singleStep)
            }
          >
            Preparar copia del plan
          </button>
        </form>
      )}
      {plans && (
        <>
          <h3>Planes preparados y aprobados</h3>
          {!plans.length && <p>Aún no hay planes preparados.</p>}
          <ul className="agent-list">
            {plans.map((plan) => (
              <li key={plan.id}>
                <strong>{plan.title}</strong>
                <p>
                  {plan.templateName} v{plan.templateVersion} ·{' '}
                  {plan.state === 'executed'
                    ? 'Iniciado'
                    : plan.state === 'approved'
                      ? 'Aprobado'
                      : 'Preparado'}
                </p>
                <button aria-pressed={selected === plan.id} onClick={() => setSelected(plan.id)}>
                  Ver plan · {plan.hash.slice(0, 12)}
                </button>
              </li>
            ))}
          </ul>
          {selected && <PlanDetails key={selected} project={project} id={selected} />}
        </>
      )}
    </>
  );
}

export function ProjectPlans({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="agent-history team-surface" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Preparar y aprobar planes</summary>
      {open && <PlansContent project={project} />}
    </details>
  );
}
