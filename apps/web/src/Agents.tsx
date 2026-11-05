import { useEffect, useRef, useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  agentCapability,
  agentDefinition,
  agentToolProfile,
  type AgentDefinition,
  type AgentRole,
  type Project,
} from '@ferweb/contracts';
import { agentsApi } from './agents-store';
import { SkillLinks, SkillsLibrary } from './Skills';
import { errorMessage, workspaceApi } from './workspace-store';
import './jobs.css';
import './agents.css';

const capabilityLabels: Record<(typeof agentCapability.options)[number], string> = {
  text: 'Texto',
  streaming: 'Respuesta progresiva',
  toolCalls: 'Uso de herramientas',
  workspaceWrite: 'Escritura en la copia de trabajo',
  structuredOutput: 'Salida estructurada validada',
  cancellation: 'Cancelación',
  usage: 'Medición de uso',
};
const profileLabels: Record<(typeof agentToolProfile.options)[number], string> = {
  'node-isolated-v1': 'Node aislado',
  'text-only': 'Solo texto',
};
const blank: AgentDefinition = {
  name: '',
  purpose: '',
  instructions: '',
  outputFormat: '',
  requiredCapabilities: ['text'],
  allowedToolProfiles: ['node-isolated-v1'],
};

function AgentEditor({
  project,
  role,
  onSaved,
  onCancel,
}: {
  project: string;
  role: AgentRole | undefined;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AgentDefinition>(() => {
    if (!role) return blank;
    const {
      id: _id,
      origin: _origin,
      version: _version,
      skills: _skills,
      ...definition
    } = role.latest;
    return definition;
  });
  const [skillIds, setSkillIds] = useState(() =>
    (role?.latest.skills ?? []).map((item) => item.id),
  );
  const [error, setError] = useState('');
  const [create, creating] = agentsApi.useCreateAgentMutation();
  const [update, updating] = agentsApi.useUpdateAgentMutation();
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => nameInput.current?.focus(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = agentDefinition.safeParse(draft);
    if (!result.success) {
      setError('Completa los textos y elige al menos una capacidad y un perfil de herramientas.');
      return;
    }
    setError('');
    try {
      const saved = role
        ? await update({
            project,
            id: role.id,
            body: { version: role.latest.version, definition: result.data, skillIds },
          }).unwrap()
        : await create({ project, body: result.data }).unwrap();
      onSaved(saved.role.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form className="job-form agent-editor" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={creating.isLoading || updating.isLoading}>
        <legend>{role ? `Nueva versión de ${role.latest.name}` : 'Nuevo rol'}</legend>
        <label>
          Nombre del rol
          <input
            ref={nameInput}
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        {(
          [
            ['purpose', 'Propósito', 1000],
            ['instructions', 'Instrucciones del rol', 8000],
            ['outputFormat', 'Formato de salida', 2000],
          ] as const
        ).map(([field, label, maxLength]) => (
          <label key={field}>
            {label}
            <textarea
              required
              rows={field === 'instructions' ? 5 : 2}
              maxLength={maxLength}
              value={draft[field]}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            />
          </label>
        ))}
        <fieldset>
          <legend>Capacidades requeridas</legend>
          {agentCapability.options.map((value) => (
            <label className="agent-check" key={value}>
              <input
                type="checkbox"
                checked={draft.requiredCapabilities.includes(value)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    requiredCapabilities: e.target.checked
                      ? [...draft.requiredCapabilities, value]
                      : draft.requiredCapabilities.filter((item) => item !== value),
                  })
                }
              />
              {capabilityLabels[value]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Perfiles de herramientas permitidos</legend>
          {agentToolProfile.options.map((value) => (
            <label className="agent-check" key={value}>
              <input
                type="checkbox"
                checked={draft.allowedToolProfiles.includes(value)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowedToolProfiles: e.target.checked
                      ? [...draft.allowedToolProfiles, value]
                      : draft.allowedToolProfiles.filter((item) => item !== value),
                  })
                }
              />
              {profileLabels[value]}
            </label>
          ))}
        </fieldset>
        {role && <SkillLinks project={project} ids={skillIds} onChange={setSkillIds} />}
        <div className="project-actions">
          <button className="primary-button" type="submit">
            {role ? 'Guardar nueva versión' : 'Crear rol'}
          </button>
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

function AgentHistory({ project, id }: { project: Project; id: string }) {
  const query = agentsApi.useAgentQuery({ project: project.id, id }, { refetchOnFocus: true });
  const [number, setNumber] = useState(0);
  const [archive, state] = agentsApi.useArchiveAgentMutation();
  const [confirm, setConfirm] = useState(false);
  if (query.error)
    return (
      <p role="alert">
        {errorMessage(query.error)} <button onClick={() => void query.refetch()}>Reintentar</button>
      </p>
    );
  if (!query.currentData) return <p role="status">Cargando historial del rol…</p>;
  const { role, versions } = query.currentData;
  const version = versions.find((item) => item.version === number) ?? role.latest;
  return (
    <section className="agent-history" aria-label="Historial del rol">
      <h3>{role.latest.name}</h3>
      <label>
        Versión del historial
        <select value={version.version} onChange={(e) => setNumber(Number(e.target.value))}>
          {versions.map((item) => (
            <option key={item.version} value={item.version}>
              Versión {item.version}
            </option>
          ))}
        </select>
      </label>
      <dl>
        <dt>Propósito</dt>
        <dd>{version.purpose}</dd>
        <dt>Instrucciones</dt>
        <dd>{version.instructions}</dd>
        <dt>Formato de salida</dt>
        <dd>{version.outputFormat}</dd>
        <dt>Capacidades</dt>
        <dd>{version.requiredCapabilities.map((item) => capabilityLabels[item]).join(', ')}</dd>
        <dt>Herramientas</dt>
        <dd>{version.allowedToolProfiles.map((item) => profileLabels[item]).join(', ')}</dd>
        <dt>Origen</dt>
        <dd>
          {version.origin.kind === 'custom' ? (
            'Propio del proyecto'
          ) : (
            <a href={version.origin.reference} target="_blank" rel="noreferrer">
              Inspirado en ECC · plantilla {version.origin.template} rev. {version.origin.revision}
            </a>
          )}
        </dd>
      </dl>
      {!!version.skills?.length && (
        <>
          <h4>Material vinculado</h4>
          <ul>
            {version.skills.map((item) => (
              <li key={item.id}>
                {item.name} · versión {item.version} · <code>{item.sha256.slice(0, 12)}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {role.archivedAt && (
        <p className="read-only-note">Rol archivado. Historial de solo lectura.</p>
      )}
      {!project.archivedAt &&
        !role.archivedAt &&
        (confirm ? (
          <div>
            <p>El historial y las ejecuciones guardadas se conservan.</p>
            <button
              className="secondary-button"
              disabled={state.isLoading}
              onClick={() => {
                void archive({ project: project.id, id, version: role.latest.version })
                  .unwrap()
                  .then(() => setConfirm(false))
                  .catch(() => {});
              }}
            >
              Confirmar archivo
            </button>{' '}
            <button
              className="secondary-button"
              disabled={state.isLoading}
              onClick={() => setConfirm(false)}
            >
              Cancelar archivo
            </button>
          </div>
        ) : (
          <button className="secondary-button" onClick={() => setConfirm(true)}>
            Archivar rol
          </button>
        ))}
      {state.error && (
        <p role="alert" className="form-error">
          {errorMessage(state.error)}
        </p>
      )}
    </section>
  );
}

function ProjectAgents({ project }: { project: Project }) {
  const query = agentsApi.useAgentsQuery(project.id, { refetchOnFocus: true });
  const [create, copying] = agentsApi.useCreateAgentMutation();
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<AgentRole | 'new' | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  function saved(id: string) {
    setSelected(id);
    setEditing(null);
  }
  const data = query.error ? undefined : query.currentData;
  return (
    <div className="project-agents">
      <a className="text-link" href={`#/projects/${project.id}`}>
        ← Volver al proyecto
      </a>
      <div className="workspace-page-heading">
        <div>
          <p className="eyebrow">CATÁLOGO DE AGENTES</p>
          <h1>Agentes · {project.name}</h1>
          <p>Elige un rol y una versión al preparar una ejecución en Trabajos.</p>
        </div>
        {data && !project.archivedAt && (
          <button className="primary-button" onClick={() => setEditing('new')}>
            Nuevo rol
          </button>
        )}
      </div>
      {project.archivedAt && (
        <p className="read-only-note">Proyecto archivado. El catálogo es de solo lectura.</p>
      )}
      <details className="agent-history" onToggle={(e) => setLibraryOpen(e.currentTarget.open)}>
        <summary>Biblioteca de skills</summary>
        {libraryOpen && <SkillsLibrary project={project} />}
      </details>
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar</button>
        </p>
      )}
      {query.isLoading && <p role="status">Cargando agentes…</p>}
      {data && !project.archivedAt && editing && (
        <AgentEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.latest.version}`}
          project={project.id}
          role={editing === 'new' ? undefined : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
      {data && (
        <>
          <h2>Roles del proyecto</h2>
          {!data.roles.length && <p>Aún no hay roles. Crea uno o añade una plantilla.</p>}
          <ul className="agent-list">
            {data.roles.map((role) => (
              <li key={role.id}>
                <strong>{role.latest.name}</strong>
                <p>
                  Versión {role.latest.version}
                  {role.archivedAt ? ' · Archivado' : ''}
                </p>
                <div className="project-actions">
                  <button
                    className="secondary-button"
                    aria-pressed={selected === role.id}
                    onClick={() => setSelected(role.id)}
                  >
                    Ver historial
                  </button>
                  {!project.archivedAt && !role.archivedAt && (
                    <button className="secondary-button" onClick={() => setEditing(role)}>
                      Crear versión
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {selected && <AgentHistory key={selected} id={selected} project={project} />}
          {!project.archivedAt && (
            <section>
              <h2>Plantillas revisadas</h2>
              <ul className="agent-list">
                {data.templates.map(({ id, definition }) => (
                  <li key={id}>
                    <strong>{definition.name}</strong>
                    <p>{definition.purpose}</p>
                    <button
                      className="secondary-button"
                      disabled={copying.isLoading}
                      onClick={() => {
                        void create({ project: project.id, body: { template: id } })
                          .unwrap()
                          .then((result) => saved(result.role.id))
                          .catch(() => {});
                      }}
                    >
                      Añadir {definition.name}
                    </button>
                  </li>
                ))}
              </ul>
              {copying.error && (
                <p role="alert" className="form-error">
                  {errorMessage(copying.error)}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function AgentsPage({ id }: { id: string | undefined }) {
  const project = workspaceApi.useProjectQuery(id ?? skipToken, { refetchOnFocus: true });
  const projects = workspaceApi.useProjectsQuery(id ? skipToken : undefined, {
    refetchOnFocus: true,
  });
  const query = id ? project : projects;
  if (query.error)
    return (
      <p role="alert">
        {errorMessage(query.error)} <button onClick={() => void query.refetch()}>Reintentar</button>
      </p>
    );
  if (id)
    return project.currentData ? (
      <ProjectAgents key={id} project={project.currentData.project} />
    ) : (
      <p role="status">Cargando proyecto…</p>
    );
  return (
    <section className="project-agents">
      <h1>Agentes</h1>
      <p>Selecciona el proyecto cuyo catálogo quieres abrir.</p>
      {projects.isLoading && <p role="status">Cargando proyectos…</p>}
      {projects.currentData?.projects.length === 0 && (
        <a href="#/projects">Ir a Proyectos para crear uno</a>
      )}
      <ul>
        {projects.currentData?.projects.map((item) => (
          <li key={item.id}>
            <a href={`#/agents/${item.id}`}>
              {item.name}
              {item.archivedAt ? ' · Archivado' : ''}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
