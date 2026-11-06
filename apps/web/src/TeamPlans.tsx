import { useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { classifyPlanTask, teamStepOrder, type Project, type TeamPlan } from '@ferweb/contracts';
import { teamsApi } from './teams-store';
import { codingApi } from './coding-store';
import { workspaceApi, errorMessage } from './workspace-store';
import { ExecutionDetails, capabilityLabels } from './ExecutionDetails';
import { SkillText } from './Skills';
import { TeamLauncher, TeamRunDetails } from './TeamRuns';
import { MemoryPicker, type MemorySelection } from './ProjectKnowledge';

export function PlanDetails({ project, id }: { project: Project; id: string }) {
  const query = teamsApi.useTeamPlanQuery({ project: project.id, id });
  const [approve, result] = teamsApi.useApproveTeamPlanMutation();
  const [confirmed, setConfirmed] = useState('');
  const plan = query.error ? undefined : query.currentData?.plan;
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
            {plan.snapshot.mode === 'single' ? 'Agente único' : 'Equipo'} · Modelo:{' '}
            {plan.snapshot.model ?? 'Sin modelo disponible'}
          </p>
          <ExecutionDetails option={plan.snapshot.execution} />
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
          {!project.archivedAt && plan.state === 'prepared' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed === plan.hash}
                  onChange={(e) => setConfirmed(e.target.checked ? plan.hash : '')}
                />
                He revisado esta copia, sus roles, skills, criterios y presupuesto
              </label>
              <button
                className="primary-button"
                disabled={
                  confirmed !== plan.hash ||
                  result.isLoading ||
                  !plan.snapshot.execution.available ||
                  !plan.snapshot.model
                }
                onClick={() =>
                  void approve({
                    project: project.id,
                    id,
                    body: { hash: plan.hash, version: plan.snapshot.version },
                  })
                    .unwrap()
                    .catch(() => {})
                }
              >
                Aprobar este plan
              </button>
            </>
          )}
          {plan.approval && (
            <p>
              Aprobación vinculada al hash de esta copia. Si cambias tarea, roles, skills o
              plantilla, prepara y aprueba un plan nuevo.
            </p>
          )}
          {!project.archivedAt && plan.state === 'approved' && (
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
  const execution = capabilities.error
    ? undefined
    : specialists
      ? capabilities.currentData?.readOnlyExecution
      : capabilities.currentData?.execution;
  const effectiveModel = execution?.models.some((item) => item.id === model)
    ? model
    : (execution?.models[0]?.id ?? '');
  const classification = task ? classifyPlanTask(task) : null;
  const single =
    !specialists &&
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!task || !template || !execution || !memoryValid) return;
    setError('');
    try {
      const { plan }: { plan: TeamPlan } = await prepare({
        project: project.id,
        body: {
          requestId: crypto.randomUUID(),
          ...(memory.length && { memory }),
          taskId: task.id,
          taskVersion: task.version,
          templateId: template.id,
          templateVersion: template.version,
          mode: specialists ? 'team' : mode,
          ...(!specialists && mode === 'single' && { singleStep }),
          executionId: 'codex-v1',
          model: effectiveModel || null,
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
    capabilities.error,
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
              if (templateId) void templateQuery.refetch();
            }}
          >
            Reintentar planes
          </button>
        </p>
      )}
      {!project.archivedAt && tasks && templates && execution && (
        <form className="job-form" aria-label="Preparar plan" onSubmit={(e) => void submit(e)}>
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
                disabled={specialists}
                value={specialists ? 'team' : mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="auto">Automático según tamaño</option>
                <option value="single">Agente único</option>
                <option value="team">Equipo completo</option>
              </select>
            </label>
            {!specialists && mode === 'single' && (
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
            <label>
              Modelo del plan
              <select
                disabled={!execution.models.length}
                value={effectiveModel}
                onChange={(e) => setModel(e.target.value)}
              >
                {!execution.models.length && <option value="">Sin modelo disponible</option>}
                {execution.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {specialists && (
            <p>
              Este workflow requiere todos los especialistas y su resumen. Las fuentes se montan
              como solo lectura y el límite del proyecto debe permitir la concurrencia solicitada.
            </p>
          )}
          {classification && !specialists && (
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
          <ExecutionDetails option={execution} />
          {!execution.available && (
            <p>
              Puedes guardar una preparación bloqueada. Configura el ejecutor y prepara una copia
              nueva para aprobarla.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            className="primary-button"
            disabled={
              preparing.isLoading ||
              !memoryValid ||
              !task ||
              !template ||
              (!specialists && mode === 'single' && !singleStep)
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
