import { useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  agentCapability,
  teamDefinition,
  type Project,
  type TeamDefinition,
  type TeamTemplate,
  type TeamPreset,
  type AgentRole,
} from '@ferweb/contracts';
import { agentsApi } from './agents-store';
import { teamsApi } from './teams-store';
import { errorMessage } from './workspace-store';
import { capabilityLabels } from './ExecutionDetails';
import { TeamPolicySettings } from './TeamRuns';

function RoleChoice({
  project,
  roles,
  value,
  onChange,
}: {
  project: string;
  roles: AgentRole[];
  value: TeamDefinition['steps'][number]['role'];
  onChange: (value: TeamDefinition['steps'][number]['role']) => void;
}) {
  const query = agentsApi.useAgentQuery(value.id ? { project, id: value.id } : skipToken);
  const data = query.error ? undefined : query.currentData;
  return (
    <>
      <label>
        Rol de la etapa
        <select
          required
          value={value.id}
          onChange={(e) => {
            const role = roles.find((item) => item.id === e.target.value);
            onChange({ id: role?.id ?? '', version: role?.latest.version ?? 1 });
          }}
        >
          <option value="">Selecciona un rol</option>
          {roles
            .filter((role) => !role.archivedAt)
            .map((role) => (
              <option key={role.id} value={role.id}>
                {role.latest.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Versión del rol
        <select
          required
          disabled={!data}
          value={value.version}
          onChange={(e) => onChange({ ...value, version: Number(e.target.value) })}
        >
          {data?.versions.map((item) => (
            <option key={item.version} value={item.version}>
              {item.version} · {item.name}
            </option>
          ))}
        </select>
      </label>
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button type="button" onClick={() => void query.refetch()}>
            Reintentar versiones
          </button>
        </p>
      )}
    </>
  );
}

function TemplateEditor({
  project,
  initial,
  template,
  preset,
  roles,
  onSaved,
  onCancel,
}: {
  project: string;
  initial: TeamDefinition;
  template?: TeamTemplate;
  preset?: TeamPreset['id'];
  roles: AgentRole[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [create, creating] = teamsApi.useCreateTeamTemplateMutation();
  const [update, updating] = teamsApi.useUpdateTeamTemplateMutation();
  function step(index: number, patch: Partial<TeamDefinition['steps'][number]>) {
    setDraft({
      ...draft,
      steps: draft.steps.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = teamDefinition.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      );
      return;
    }
    setError('');
    try {
      const body = { definition: parsed.data };
      const result = template
        ? await update({
            project,
            id: template.id,
            body: { ...body, version: template.latest.version },
          }).unwrap()
        : await create({ project, body: { ...body, ...(preset && { preset }) } }).unwrap();
      onSaved(result.template.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form
      className="job-form"
      onSubmit={(e) => void submit(e)}
      aria-label="Editar plantilla de equipo"
    >
      <h3>
        {template
          ? `Nueva versión de ${template.latest.definition.name}`
          : 'Nueva plantilla de equipo'}
      </h3>
      <label>
        Nombre del equipo
        <input
          required
          autoFocus
          maxLength={120}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        Descripción del workflow
        <textarea
          maxLength={1000}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <div className="job-grid">
        <label>
          Estrategia del equipo
          <select
            value={draft.strategy ?? 'sequential'}
            onChange={(e) => {
              const { strategy: _, reviewMode: _reviewMode, toolProfile, ...rest } = draft;
              setDraft({
                ...rest,
                ...(e.target.value === 'specialists' && {
                  strategy: 'specialists' as const,
                  maxIterations: 1,
                }),
                ...(e.target.value !== 'specialists' && toolProfile && { toolProfile }),
                limits: { ...draft.limits, concurrency: 1 },
              });
            }}
          >
            <option value="sequential">Cadena secuencial</option>
            <option value="specialists">Especialistas de solo lectura y resumen</option>
          </select>
        </label>
        {draft.strategy !== 'specialists' && (
          <label>
            Perfil de herramientas del equipo
            <select
              value={draft.toolProfile ?? 'node-isolated-v1'}
              onChange={(e) => {
                const { toolProfile: _, ...rest } = draft;
                setDraft(
                  e.target.value === 'typescript-react-v1'
                    ? {
                        ...rest,
                        toolProfile: 'typescript-react-v1',
                      }
                    : rest,
                );
              }}
            >
              <option value="node-isolated-v1">Node aislado</option>
              <option value="typescript-react-v1">TypeScript/React aislado</option>
            </select>
          </label>
        )}
        {draft.strategy === 'specialists' && (
          <label>
            Concurrencia solicitada
            <select
              value={draft.limits.concurrency}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  limits: { ...draft.limits, concurrency: Number(e.target.value) as 1 | 2 },
                })
              }
            >
              <option value={1}>1 especialista</option>
              <option value={2}>2 especialistas</option>
            </select>
          </label>
        )}
        <label>
          Máximo de iteraciones
          <input
            type="number"
            min={1}
            max={draft.reviewMode ? 2 : draft.strategy === 'specialists' ? 1 : 3}
            required
            value={draft.maxIterations}
            onChange={(e) => setDraft({ ...draft, maxIterations: Number(e.target.value) })}
          />
        </label>
        <label>
          Presupuesto de peticiones
          <input
            type="number"
            min={1}
            max={20}
            required
            value={draft.limits.maxRequests}
            onChange={(e) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, maxRequests: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Tiempo límite en segundos
          <input
            type="number"
            min={10}
            max={1200}
            required
            value={draft.limits.timeoutMs / 1000}
            onChange={(e) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, timeoutMs: Number(e.target.value) * 1000 },
              })
            }
          />
        </label>
      </div>
      <p>
        Concurrencia máxima: {draft.limits.concurrency}. El presupuesto debe cubrir todas las etapas
        en todas las iteraciones.
      </p>
      {draft.strategy === 'specialists' && (
        <p>
          Asigna roles y skills compatibles con Node de solo lectura. Los roles antiguos pueden
          necesitar una versión nueva. Las etapas independientes van primero y el resumen final
          depende de todas.
        </p>
      )}
      {draft.steps.map((item, index) => (
        <fieldset key={item.key}>
          <legend>
            Etapa {index + 1} · {item.key}
          </legend>
          <label>
            Título de la etapa
            <input
              required
              maxLength={120}
              value={item.title}
              onChange={(e) => step(index, { title: e.target.value })}
            />
          </label>
          <RoleChoice
            project={project}
            roles={roles}
            value={item.role}
            onChange={(role) => step(index, { role })}
          />
          <label>
            Criterios de salida (uno por línea)
            <textarea
              required
              value={item.exitCriteria.join('\n')}
              onChange={(e) => step(index, { exitCriteria: e.target.value.split('\n') })}
            />
          </label>
          <label>
            Máximo de peticiones de la etapa
            <input
              type="number"
              required
              min={1}
              max={20}
              value={item.maxRequests}
              onChange={(e) => step(index, { maxRequests: Number(e.target.value) })}
            />
          </label>
          <fieldset>
            <legend>Depende de</legend>
            {draft.steps
              .filter((other) => other.key !== item.key)
              .map((other) => (
                <label key={other.key}>
                  <input
                    type="checkbox"
                    checked={item.dependsOn.includes(other.key)}
                    onChange={(e) =>
                      step(index, {
                        dependsOn: e.target.checked
                          ? [...item.dependsOn, other.key]
                          : item.dependsOn.filter((key) => key !== other.key),
                      })
                    }
                  />
                  {other.title || other.key}
                </label>
              ))}
            {draft.steps.length === 1 && <p>Sin dependencias.</p>}
          </fieldset>
          <fieldset>
            <legend>Capacidades requeridas</legend>
            {agentCapability.options.map((capability) => (
              <label key={capability}>
                <input
                  type="checkbox"
                  checked={item.requiredCapabilities.includes(capability)}
                  onChange={(e) =>
                    step(index, {
                      requiredCapabilities: e.target.checked
                        ? [...item.requiredCapabilities, capability]
                        : item.requiredCapabilities.filter((key) => key !== capability),
                    })
                  }
                />
                {capabilityLabels[capability]}
              </label>
            ))}
          </fieldset>
          {draft.steps.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: draft.steps
                    .filter((_, i) => i !== index)
                    .map((other) => ({
                      ...other,
                      dependsOn: other.dependsOn.filter((key) => key !== item.key),
                    })),
                })
              }
            >
              Eliminar etapa {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      {draft.steps.length < 6 && (
        <button
          type="button"
          onClick={() => {
            let suffix = 1;
            while (draft.steps.some((item) => item.key === `step-${suffix}`)) suffix++;
            setDraft({
              ...draft,
              steps: [
                ...draft.steps,
                {
                  key: `step-${suffix}`,
                  title: '',
                  role: { id: '', version: 1 },
                  dependsOn: [],
                  exitCriteria: [''],
                  requiredCapabilities: ['text'],
                  maxRequests: 1,
                },
              ],
            });
          }}
        >
          Añadir etapa
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="project-actions">
        <button className="primary-button" disabled={creating.isLoading || updating.isLoading}>
          Guardar plantilla de equipo
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar edición
        </button>
      </div>
    </form>
  );
}

function TemplateHistory({ project, id }: { project: Project; id: string }) {
  const query = teamsApi.useTeamTemplateQuery({ project: project.id, id });
  const [archive, result] = teamsApi.useArchiveTeamTemplateMutation();
  const data = query.error ? undefined : query.currentData;
  return (
    <section className="agent-history" aria-label="Historial del equipo">
      {query.isLoading && <p role="status">Cargando versiones del equipo…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar</button>
        </p>
      )}
      {data?.versions.map((version) => (
        <details key={version.version}>
          <summary>
            Versión {version.version} · {version.definition.name}
          </summary>
          <p>{version.definition.description}</p>
          <p>
            {version.definition.maxIterations} iteraciones · {version.definition.limits.maxRequests}{' '}
            peticiones · {version.definition.limits.timeoutMs / 1000} segundos
          </p>
          <ol>
            {version.definition.steps.map((step) => (
              <li key={step.key}>
                {step.title} · rol {step.role.id} v{step.role.version} · depende de{' '}
                {step.dependsOn.join(', ') || 'ninguna etapa'}
                <ul>
                  {step.exitCriteria.map((criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </details>
      ))}
      {data && !project.archivedAt && !data.template.archivedAt && (
        <button
          disabled={result.isLoading}
          onClick={() =>
            void archive({ project: project.id, id, version: data.template.latest.version })
              .unwrap()
              .catch(() => {})
          }
        >
          Archivar plantilla de equipo
        </button>
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </section>
  );
}

export function TeamTemplates({ project }: { project: Project }) {
  const query = teamsApi.useTeamTemplatesQuery(project.id);
  const rolesQuery = agentsApi.useAgentsQuery(project.id);
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<{
    initial: TeamDefinition;
    template?: TeamTemplate;
    preset?: TeamPreset['id'];
  } | null>(null);
  const data = query.error ? undefined : query.currentData;
  const roles = rolesQuery.error ? undefined : rolesQuery.currentData?.roles;
  function start(preset?: TeamPreset, template?: TeamTemplate) {
    const initial: TeamDefinition = template?.latest.definition ?? {
      name: preset?.name ?? '',
      ...(preset?.strategy && { strategy: preset.strategy }),
      ...(preset?.reviewMode && { reviewMode: preset.reviewMode }),
      description: preset?.description ?? '',
      maxIterations: 1,
      limits: { maxRequests: 10, timeoutMs: 300000, concurrency: 1 },
      steps: preset
        ? preset.steps.map(({ specialty, ...step }) => {
            const role = roles?.find(
              (item) =>
                !item.archivedAt &&
                item.latest.origin.kind === 'template' &&
                item.latest.origin.template === specialty,
            );
            return { ...step, role: { id: role?.id ?? '', version: role?.latest.version ?? 1 } };
          })
        : [
            {
              key: 'step-1',
              title: '',
              role: { id: '', version: 1 },
              dependsOn: [],
              exitCriteria: [''],
              requiredCapabilities: ['text'],
              maxRequests: 1,
            },
          ],
    };
    setEditor({ initial, ...(template && { template }), ...(preset && { preset: preset.id }) });
  }
  return (
    <section className="team-surface" aria-label="Equipos y plantillas">
      <h2>Equipos y plantillas</h2>
      <TeamPolicySettings project={project} />
      <p>
        Define etapas, versiones de roles, dependencias y criterios de salida. Después prepara el
        plan desde Tareas o Trabajos.
      </p>
      {(query.isLoading || rolesQuery.isLoading) && (
        <p role="status">Cargando plantillas y roles…</p>
      )}
      {(query.error || rolesQuery.error) && (
        <p role="alert">
          {errorMessage(query.error ?? rolesQuery.error)}{' '}
          <button
            onClick={() => {
              void query.refetch();
              void rolesQuery.refetch();
            }}
          >
            Reintentar
          </button>
        </p>
      )}
      {data && roles && (
        <>
          {!project.archivedAt && !editor && (
            <div className="project-actions">
              <button onClick={() => start()}>Nueva plantilla de equipo</button>
              {data.presets.map((preset) => (
                <button key={preset.id} onClick={() => start(preset)}>
                  Usar {preset.name}
                </button>
              ))}
            </div>
          )}
          {editor && !project.archivedAt && (
            <TemplateEditor
              {...editor}
              project={project.id}
              roles={roles}
              onCancel={() => setEditor(null)}
              onSaved={(id) => {
                setEditor(null);
                setSelected(id);
              }}
            />
          )}
          {!data.templates.length && (
            <p>
              Aún no hay plantillas de equipo. Los presets requieren asignar roles de este proyecto.
            </p>
          )}
          <ul className="agent-list">
            {data.templates.map((template) => (
              <li key={template.id}>
                <strong>{template.latest.definition.name}</strong>
                <p>
                  Versión {template.latest.version} · {template.latest.definition.steps.length}{' '}
                  etapas{template.archivedAt && ' · Archivada'}
                </p>
                <div className="project-actions">
                  <button onClick={() => setSelected(template.id)}>Historial del equipo</button>
                  {!project.archivedAt && !template.archivedAt && (
                    <button onClick={() => start(undefined, template)}>
                      Nueva versión del equipo
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {selected && <TemplateHistory key={selected} project={project} id={selected} />}
        </>
      )}
    </section>
  );
}
