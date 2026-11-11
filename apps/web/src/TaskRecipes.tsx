import { useRef, useState } from 'react';
import { recipeInput, type RecipeDefinition, type RecipeInput, type Task } from '@ferweb/contracts';
import { agentsApi } from './agents-store';
import { codingApi } from './coding-store';
import { jobsApi } from './jobs-store';
import { recipeApi } from './recipe-store';
import { errorMessage } from './workspace-store';

const modeLabel = {
  read: 'Un agente · Solo lectura',
  write: 'Un agente · Escritura en las rutas seleccionadas',
  plan: 'Plan local',
  draft: 'Borrador local para E9',
};

function PrepareRecipe({
  project,
  task,
  recipe,
  onPrepared,
}: {
  project: string;
  task: Task;
  recipe: RecipeDefinition;
  onPrepared: (id: string) => void;
}) {
  const launches = recipe.mode === 'read' || recipe.mode === 'write';
  const usesDiff = recipe.key === 'review' || recipe.key === 'pr-draft';
  const caps = codingApi.useCodingCapabilitiesQuery(project, {
    skip: !launches,
    refetchOnFocus: true,
  });
  const agents = agentsApi.useAgentsQuery(project, { skip: !launches, refetchOnFocus: true });
  const jobs = jobsApi.useJobsQuery(project, { skip: !usesDiff, refetchOnFocus: true });
  const [model, setModel] = useState('');
  const [agentId, setAgentId] = useState('');
  const [sourceJobId, setSourceJobId] = useState('');
  const [paths, setPaths] = useState('');
  const [format, setFormat] = useState<NonNullable<RecipeInput['format']>>('steps');
  const [profile, setProfile] = useState<NonNullable<RecipeInput['profile']>>('node-isolated-v1');
  const [validation, setValidation] = useState('');
  const request = useRef<{ id: string; key: string } | null>(null);
  const [prepare, result] = recipeApi.usePrepareRecipeMutation();
  const roles = (agents.error ? [] : (agents.currentData?.roles ?? [])).filter(
    (role) => !role.archivedAt,
  );
  const agent = roles.find((role) => role.id === agentId);
  const options = caps.error
    ? null
    : recipe.mode === 'read'
      ? caps.currentData?.readOnlyExecution
      : profile === 'typescript-react-v1'
        ? caps.currentData?.typescriptExecution
        : caps.currentData?.execution;
  const reports = (jobs.error ? [] : (jobs.currentData?.jobs ?? [])).filter(
    (job) =>
      job.kind === 'codex-v1' &&
      job.configuration.taskId === task.id &&
      !job.configuration.workspaceAccess &&
      (job.state === 'completed' || (recipe.key === 'review' && job.state === 'failed')),
  );
  const chosen = options?.models.some((item) => item.id === model) ? model : options?.models[0]?.id;
  return (
    <form
      className="task-recipe-form"
      aria-label="Parámetros de receta"
      onSubmit={(event) => {
        event.preventDefault();
        const args = {
          key: recipe.key,
          version: recipe.version,
          taskVersion: task.version,
          paths: usesDiff
            ? []
            : paths
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
          ...(launches && { model: chosen }),
          ...(recipe.mode === 'write' && { profile }),
          ...(recipe.mode === 'plan' && { format }),
          ...(usesDiff && { sourceJobId }),
          ...(agent && { agent: { id: agent.id, version: agent.latest.version } }),
        };
        const key = JSON.stringify(args);
        if (request.current?.key !== key) request.current = { id: crypto.randomUUID(), key };
        const body = recipeInput.safeParse({ ...args, requestId: request.current.id });
        if (!body.success) {
          setValidation(
            'Revisa el informe elegido y las rutas. Puedes indicar hasta doce archivos distintos.',
          );
          return;
        }
        setValidation('');
        void prepare({ project, task: task.id, body: body.data })
          .unwrap()
          .then((plan) => {
            request.current = null;
            onPrepared(plan.id);
          })
          .catch(() => {});
      }}
    >
      <p>
        {modeLabel[recipe.mode]} · {recipe.output}
      </p>
      {usesDiff ? (
        <label>
          Informe con diff
          <select
            required
            value={sourceJobId}
            onChange={(event) => setSourceJobId(event.target.value)}
          >
            <option value="">Selecciona un informe</option>
            {reports.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {new Date(job.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {recipe.mode === 'write' ? 'Rutas editables' : 'Rutas de referencia (opcional)'}
          <textarea
            rows={3}
            maxLength={2652}
            required={recipe.mode === 'write'}
            value={paths}
            onChange={(event) => setPaths(event.target.value)}
            placeholder="Una ruta relativa por línea"
          />
        </label>
      )}
      {recipe.mode === 'plan' && (
        <label>
          Formato del plan
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="steps">Pasos y validación</option>
            <option value="adr">ADR</option>
            <option value="impact">Análisis de impacto</option>
          </select>
        </label>
      )}
      {launches && (
        <>
          {recipe.mode === 'write' && (
            <label>
              Perfil de la receta
              <select
                value={profile}
                onChange={(event) => setProfile(event.target.value as typeof profile)}
              >
                <option value="node-isolated-v1">Node aislado</option>
                <option value="typescript-react-v1">TypeScript y React</option>
              </select>
            </label>
          )}
          <label>
            Modelo de la receta
            <select value={chosen ?? ''} onChange={(event) => setModel(event.target.value)}>
              {!chosen && <option value="">Sin modelo disponible</option>}
              {options?.models.map(({ id }) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label>
            Rol de la receta
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">Rol predefinido</option>
              {roles.map(({ id, latest }) => (
                <option key={id} value={id}>
                  {latest.name} · v{latest.version}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {usesDiff && jobs.isLoading && <p role="status">Cargando informes…</p>}
      {usesDiff && jobs.currentData && !jobs.error && !reports.length && (
        <p>Hace falta un informe de código de esta tarea.</p>
      )}
      {launches && caps.isLoading && <p role="status">Cargando capacidades…</p>}
      {launches && options && !options.available && (
        <p>El perfil de la receta no está disponible.</p>
      )}
      {(validation || result.error || caps.error || agents.error || jobs.error) && (
        <p role="alert">
          {validation || errorMessage(result.error ?? caps.error ?? agents.error ?? jobs.error)}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          result.isLoading ||
          (launches && (!options?.available || !chosen || (!!agentId && !agent)))
        }
      >
        {result.isLoading ? 'Preparando…' : 'Preparar receta'}
      </button>
    </form>
  );
}

function PlanDetail({
  project,
  task,
  id,
  archived,
}: {
  project: string;
  task: Task;
  id: string;
  archived: boolean;
}) {
  const result = recipeApi.useRecipePlanQuery(
    { project, task: task.id, id },
    { refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const [confirm, setConfirm] = useState(false);
  const [execute, launch] = recipeApi.useExecuteRecipeMutation();
  if (result.error) return <p role="alert">{errorMessage(result.error)}</p>;
  const plan = result.currentData;
  if (!plan) return <p role="status">Cargando plan de receta…</p>;
  const { definition, input, commit, repository, source, preview, simulated, role } = plan.snapshot;
  const jobLink = (job: string) => `#/projects/${project}/jobs/${job}`;
  const launches = definition.mode === 'read' || definition.mode === 'write';
  const stale = task.version !== plan.snapshot.task.version;
  return (
    <section className="task-recipe-preview" aria-label="Plan de receta guardado">
      <h3>
        {definition.label} · v{definition.version}
      </h3>
      <p>
        {modeLabel[definition.mode]} · Tarea v{plan.snapshot.task.version} · {repository} ·{' '}
        {commit.slice(0, 12)}
      </p>
      <p>{role.purpose}</p>
      <ol>
        {definition.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p>Salida prevista · {definition.output}</p>
      <p>Alcance · {(source?.paths ?? input.paths).join(', ') || 'Snapshot de la tarea'}</p>
      {launches && (
        <p>
          {input.model} · {input.profile ?? 'node-readonly-v1'} · {definition.maxRequests}{' '}
          peticiones · {definition.timeoutMs / 1000} s · {definition.maxOutputTokens} tokens máximos
          por respuesta{simulated && ' · Simulada'}
        </p>
      )}
      {preview && <pre>{preview}</pre>}
      {source && (
        <p>
          <a href={jobLink(source.jobId)}>
            {definition.mode === 'draft'
              ? 'Abrir informe para guardar el borrador en E9'
              : 'Abrir informe de origen'}
          </a>
        </p>
      )}
      {plan.jobId && (
        <p>
          <a href={jobLink(plan.jobId)}>Ver ejecución de la receta</a>
        </p>
      )}
      {launches && !plan.jobId && !archived && (
        <>
          {stale ? (
            <p>La tarea ha cambiado. Prepara una copia con su versión vigente.</p>
          ) : (
            <>
              <label className="task-recipe-confirm">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />
                Confirmo el alcance y el envío al proveedor de Codex
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!confirm || launch.isLoading}
                onClick={() =>
                  void execute({ project, task: task.id, id, hash: plan.hash })
                    .unwrap()
                    .catch(() => {})
                }
              >
                {launch.isLoading ? 'Encolando…' : 'Ejecutar receta'}
              </button>
            </>
          )}
        </>
      )}
      {launch.error && <p role="alert">{errorMessage(launch.error)}</p>}
    </section>
  );
}

export function TaskRecipes({
  project,
  task,
  archived,
}: {
  project: string;
  task: Task;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [selected, setSelected] = useState('');
  const query = recipeApi.useRecipesQuery(
    { project, task: task.id },
    { skip: !open, refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const data = query.error ? null : query.currentData;
  const recipe = data?.recipes.find((item) => item.key === key);
  return (
    <details className="task-recipes" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Recetas de la tarea</summary>
      {open && (
        <>
          {query.isLoading && <p role="status">Cargando recetas…</p>}
          {query.error && <p role="alert">{errorMessage(query.error)}</p>}
          {!archived && data && (
            <>
              <label>
                Elegir receta
                <select value={key} onChange={(event) => setKey(event.target.value)}>
                  <option value="">Selecciona una receta</option>
                  {data.recipes.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {recipe && (
                <PrepareRecipe
                  key={recipe.key}
                  project={project}
                  task={task}
                  recipe={recipe}
                  onPrepared={setSelected}
                />
              )}
            </>
          )}
          {data?.plans.length === 0 && <p>Todavía no hay planes de receta.</p>}
          {!!data?.plans.length && (
            <label>
              Planes de receta guardados
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">Selecciona un plan</option>
                {data.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {data.recipes.find((item) => item.key === plan.key)?.label ?? plan.key} · v
                    {plan.version} · {new Date(plan.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && data && (
            <PlanDetail
              key={selected}
              project={project}
              task={task}
              id={selected}
              archived={archived}
            />
          )}
        </>
      )}
    </details>
  );
}
