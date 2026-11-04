import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  projectInputSchema,
  taskInputSchema,
  type Project,
  type Task,
  type User,
} from '@ferweb/contracts';
import { Brand } from './Brand';
import type { AppDispatch, RootState } from './store';
import { authApi, workspaceApi, workspaceUi, errorMessage } from './workspace-store';
import { GitHubSettings, ProjectGitHub } from './GitHub';
import { ProjectConversations } from './Conversations';
import { ProjectLaboratory } from './Laboratory';
import { ProjectJobs } from './Jobs';

const statusLabels = { todo: 'Por hacer', in_progress: 'En curso', done: 'Hecho' };
const priorityLabels = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const field = dialog?.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    );
    (field ?? dialog?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      className="editor-dialog"
      ref={ref}
      aria-labelledby="editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="editor-heading">
        <h2 id="editor-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Cerrar editor"
          onClick={onClose}
          disabled={busy}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Notice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return (
    <div className="workspace-notice">
      <p role="alert">{children}</p>
      {retry && (
        <button className="secondary-button" onClick={retry}>
          Volver a intentar
        </button>
      )}
    </div>
  );
}
function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [validation, setValidation] = useState('');
  const [create, creation] = workspaceApi.useCreateProjectMutation();
  const [update, updating] = workspaceApi.useUpdateProjectMutation();
  const busy = creation.isLoading || updating.isLoading;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = projectInputSchema.safeParse({ name, description });
    if (!parsed.success) {
      setValidation('Revisa el nombre (1–120 caracteres) y la descripción (hasta 4000).');
      return;
    }
    setValidation('');
    try {
      if (project)
        await update({
          id: project.id,
          body: { ...parsed.data, version: project.version },
        }).unwrap();
      else await create(parsed.data).unwrap();
      onClose();
    } catch {}
  }
  return (
    <Modal title={project ? 'Editar proyecto' : 'Nuevo proyecto'} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <p className="editor-intro">
          Dale un lugar a tu próxima idea. Siempre podrás ajustar los detalles.
        </p>
        <label>
          Nombre del proyecto
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Descripción
          <textarea
            rows={4}
            maxLength={4000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
        </label>
        {(validation || creation.error || updating.error) && (
          <p className="form-error" role="alert">
            {validation || errorMessage(creation.error ?? updating.error)}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Guardando…' : project ? 'Guardar proyecto' : 'Crear proyecto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ArchiveProject({ project, onClose }: { project: Project; onClose: () => void }) {
  const [update, { isLoading, error }] = workspaceApi.useUpdateProjectMutation();
  const restoring = !!project.archivedAt;
  async function save() {
    try {
      await update({
        id: project.id,
        body: { archived: !restoring, version: project.version },
      }).unwrap();
      onClose();
    } catch {}
  }
  return (
    <Modal
      title={restoring ? 'Restaurar proyecto' : 'Archivar proyecto'}
      onClose={onClose}
      busy={isLoading}
    >
      <p className="editor-intro">
        {restoring
          ? `«${project.name}» volverá a estar activo y podrás modificar sus tareas.`
          : `«${project.name}» se conservará con todas sus tareas y quedará en solo lectura. Puedes restaurarlo después.`}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      <div className="form-actions">
        <button className="secondary-button" onClick={onClose} disabled={isLoading}>
          Cancelar
        </button>
        <button className="primary-button" onClick={() => void save()} disabled={isLoading}>
          {isLoading ? 'Guardando…' : restoring ? 'Restaurar proyecto' : 'Archivar proyecto'}
        </button>
      </div>
    </Modal>
  );
}
function TaskForm({
  projectId,
  task,
  onClose,
  readOnly,
}: {
  projectId: string;
  task: Task | null;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'todo',
    criteria: task?.acceptanceCriteria.join('\n') ?? '',
  });
  const [validation, setValidation] = useState('');
  const [create, creation] = workspaceApi.useCreateTaskMutation();
  const [update, updating] = workspaceApi.useUpdateTaskMutation();
  const busy = creation.isLoading || updating.isLoading;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = taskInputSchema.safeParse({
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      status: draft.status,
      acceptanceCriteria: draft.criteria
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setValidation(
        'Revisa los campos: título hasta 160 caracteres, descripción hasta 10000 y un máximo de 30 criterios de 500 caracteres.',
      );
      return;
    }
    setValidation('');
    try {
      if (task)
        await update({
          projectId,
          id: task.id,
          body: { ...parsed.data, version: task.version },
        }).unwrap();
      else await create({ projectId, body: parsed.data }).unwrap();
      onClose();
    } catch {}
  }
  return (
    <Modal title={task ? 'Detalle de tarea' : 'Nueva tarea'} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        {readOnly && (
          <p className="read-only-note">Proyecto archivado. El detalle está en solo lectura.</p>
        )}
        <fieldset disabled={busy || readOnly}>
          <label>
            Título de la tarea
            <input
              autoFocus
              required
              maxLength={160}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Estado
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as Task['status'] })
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: event.target.value as Task['priority'] })
                }
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Descripción de la tarea
            <textarea
              rows={4}
              maxLength={10000}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label>
            Criterios de aceptación
            <textarea
              rows={4}
              maxLength={15030}
              value={draft.criteria}
              onChange={(event) => setDraft({ ...draft, criteria: event.target.value })}
            />
            <small>Un criterio por línea. Define qué debe cumplirse para terminar.</small>
          </label>
        </fieldset>
        {(validation || creation.error || updating.error) && (
          <p className="form-error" role="alert">
            {validation || errorMessage(creation.error ?? updating.error)}
          </p>
        )}
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            {readOnly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!readOnly && (
            <button className="primary-button" disabled={busy}>
              {busy ? 'Guardando…' : task ? 'Guardar tarea' : 'Crear tarea'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
function TaskDetail({
  project,
  id,
  onClose,
}: {
  project: Project;
  id: string;
  onClose: () => void;
}) {
  const result = workspaceApi.useTaskQuery({ projectId: project.id, id });
  if (result.isLoading)
    return (
      <Modal title="Detalle de tarea" onClose={onClose}>
        <p role="status">Cargando tarea…</p>
      </Modal>
    );
  if (!result.currentData || result.error)
    return (
      <Modal title="Detalle de tarea" onClose={onClose}>
        <Notice retry={() => void result.refetch()}>{errorMessage(result.error)}</Notice>
      </Modal>
    );
  return (
    <TaskForm
      key={id}
      task={result.currentData.task}
      projectId={project.id}
      onClose={onClose}
      readOnly={!!project.archivedAt}
    />
  );
}

function Board({ project }: { project: Project }) {
  const ui = useSelector((state: RootState) => state.workspaceUi);
  const dispatch = useDispatch<AppDispatch>();
  const [newTask, setNewTask] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => dispatch(workspaceUi.actions.setSearch(search)), 250);
    return () => clearTimeout(timer);
  }, [search, dispatch]);
  const filters = {
    ...(ui.search ? { q: ui.search } : {}),
    ...(ui.priority ? { priority: ui.priority } : {}),
    ...(ui.status ? { status: ui.status } : {}),
  };
  const result = workspaceApi.useTasksQuery(
    { projectId: project.id, filters },
    { refetchOnFocus: true },
  );
  const tasks = result.currentData?.tasks;
  function clearFilters() {
    setSearch('');
    dispatch(workspaceUi.actions.resetFilters());
  }
  return (
    <>
      <div className="board-toolbar">
        <label className="search-field">
          <span className="sr-only">Buscar tareas</span>
          <input
            type="search"
            placeholder="Buscar tareas…"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filtrar prioridad</span>
          <select
            aria-label="Filtrar prioridad"
            value={ui.priority}
            onChange={(event) =>
              dispatch(workspaceUi.actions.setPriority(event.target.value as typeof ui.priority))
            }
          >
            <option value="">Todas las prioridades</option>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar estado</span>
          <select
            aria-label="Filtrar estado"
            value={ui.status}
            onChange={(event) =>
              dispatch(workspaceUi.actions.setStatus(event.target.value as typeof ui.status))
            }
          >
            <option value="">Todos los estados</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(search || ui.priority || ui.status) && (
          <button className="text-button" onClick={clearFilters}>
            Limpiar filtros
          </button>
        )}
        <button
          className="primary-button"
          onClick={() => setNewTask(true)}
          disabled={!!project.archivedAt}
        >
          ＋ Nueva tarea
        </button>
      </div>
      {project.archivedAt && (
        <p className="read-only-note">
          Este proyecto está archivado. Puedes consultar sus tareas y restaurarlo cuando quieras
          continuar.
        </p>
      )}
      <div className="board-summary" role="status" aria-label="Estado del tablero">
        {result.isFetching
          ? 'Actualizando tareas…'
          : tasks
            ? `${tasks.length} tareas visibles`
            : 'Consultando tareas…'}
      </div>
      {result.error ? (
        <Notice retry={() => void result.refetch()}>{errorMessage(result.error)}</Notice>
      ) : tasks ? (
        <div className="task-board">
          {Object.entries(statusLabels).map(([status, label]) => {
            const column = tasks.filter((task) => task.status === status);
            return (
              <section className={`board-column column-${status}`} key={status} aria-label={label}>
                <header>
                  <h2>
                    <span className="column-dot" />
                    {label}
                  </h2>
                  <span className="column-count">{column.length}</span>
                </header>
                <div className="column-tasks">
                  {column.map((task) => (
                    <button
                      className="task-card"
                      key={task.id}
                      onClick={() => dispatch(workspaceUi.actions.selectTask(task.id))}
                    >
                      <span className={`priority priority-${task.priority}`}>
                        {priorityLabels[task.priority]}
                      </span>
                      <h3>{task.title}</h3>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-card-footer">
                        <span>☑ {task.acceptanceCriteria.length} criterios</span>
                        <span aria-hidden="true">↗</span>
                      </div>
                    </button>
                  ))}
                  {column.length === 0 && (
                    <p className="column-empty">
                      {ui.search || ui.priority || ui.status
                        ? 'Sin tareas con estos filtros.'
                        : 'Todavía no hay tareas aquí.'}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p>Cargando el tablero…</p>
      )}
      {newTask && (
        <TaskForm
          projectId={project.id}
          task={null}
          onClose={() => setNewTask(false)}
          readOnly={false}
        />
      )}{' '}
      {ui.selectedTaskId && (
        <TaskDetail
          project={project}
          id={ui.selectedTaskId}
          onClose={() => dispatch(workspaceUi.actions.selectTask(null))}
        />
      )}
    </>
  );
}

function ProjectPage({ id }: { id: string }) {
  const [tab, setTab] = useState<'tasks' | 'github' | 'chat' | 'laboratory' | 'jobs'>('tasks');
  const result = workspaceApi.useProjectQuery(id, { refetchOnFocus: true });
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const project = result.currentData?.project;
  if (result.error)
    return (
      <>
        <a className="text-link" href="#/projects">
          ← Volver a proyectos
        </a>
        <Notice retry={() => void result.refetch()}>{errorMessage(result.error)}</Notice>
      </>
    );
  if (!project) return <p role="status">Cargando proyecto…</p>;
  return (
    <>
      <a className="text-link back-link" href="#/projects">
        ← Todos los proyectos
      </a>
      <div className="workspace-page-heading">
        <div>
          <p className="eyebrow">DEL PLAN A LA ACCIÓN</p>
          <h1>{project.name}</h1>
          <p className="project-description">
            {project.description || 'Define las tareas y da el siguiente paso.'}
          </p>
        </div>
        <div className="project-actions">
          {!project.archivedAt && (
            <button className="secondary-button" onClick={() => setEdit(true)}>
              Editar proyecto
            </button>
          )}
          <button className="secondary-button" onClick={() => setArchive(true)}>
            {project.archivedAt ? 'Restaurar' : 'Archivar'}
          </button>
        </div>
      </div>
      <div className="filter-tabs" role="group" aria-label="Secciones del proyecto">
        <button
          className={tab === 'tasks' ? 'selected' : ''}
          aria-pressed={tab === 'tasks'}
          onClick={() => setTab('tasks')}
        >
          Tareas
        </button>
        <button
          className={tab === 'github' ? 'selected' : ''}
          aria-pressed={tab === 'github'}
          onClick={() => setTab('github')}
        >
          Repositorio GitHub
        </button>
        <button
          className={tab === 'chat' ? 'selected' : ''}
          aria-pressed={tab === 'chat'}
          onClick={() => setTab('chat')}
        >
          Conversaciones
        </button>
        <button
          className={tab === 'laboratory' ? 'selected' : ''}
          aria-pressed={tab === 'laboratory'}
          onClick={() => setTab('laboratory')}
        >
          Laboratorio
        </button>
        <button
          className={tab === 'jobs' ? 'selected' : ''}
          aria-pressed={tab === 'jobs'}
          onClick={() => setTab('jobs')}
        >
          Trabajos
        </button>
      </div>
      {tab === 'tasks' ? (
        <Board key={id} project={project} />
      ) : tab === 'github' ? (
        <ProjectGitHub project={project} />
      ) : tab === 'chat' ? (
        <ProjectConversations project={project} />
      ) : tab === 'laboratory' ? (
        <ProjectLaboratory key={id} project={project} />
      ) : (
        <ProjectJobs key={id} project={project} />
      )}
      {edit && <ProjectEditor project={project} onClose={() => setEdit(false)} />}{' '}
      {archive && <ArchiveProject project={project} onClose={() => setArchive(false)} />}
    </>
  );
}

function ProjectList() {
  const result = workspaceApi.useProjectsQuery(undefined, { refetchOnFocus: true });
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState('');
  const filter = useSelector((state: RootState) => state.workspaceUi.projectFilter);
  const dispatch = useDispatch<AppDispatch>();
  const projects = result.data?.projects.filter(
    (project) =>
      (filter === 'all' || (filter === 'archived' ? !!project.archivedAt : !project.archivedAt)) &&
      project.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <div className="workspace-page-heading">
        <div>
          <p className="eyebrow">UN ESPACIO PARA TUS IDEAS</p>
          <h1>
            Tu próximo paso
            <br />
            empieza aquí<span>.</span>
          </h1>
          <p>Organiza lo importante. Construye a tu ritmo.</p>
        </div>
        <button className="primary-button" onClick={() => setCreate(true)}>
          ＋ Nuevo proyecto
        </button>
      </div>
      <div className="projects-toolbar">
        <div className="filter-tabs" role="group" aria-label="Mostrar proyectos">
          {(
            [
              ['active', 'Activos'],
              ['archived', 'Archivados'],
              ['all', 'Todos'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={value === filter ? 'selected' : ''}
              aria-pressed={value === filter}
              onClick={() => dispatch(workspaceUi.actions.setProjectFilter(value))}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <span className="sr-only">Buscar proyectos</span>
          <input
            type="search"
            maxLength={120}
            placeholder="Buscar proyectos…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {result.error ? (
        <Notice retry={() => void result.refetch()}>{errorMessage(result.error)}</Notice>
      ) : !projects ? (
        <p role="status">Cargando proyectos…</p>
      ) : projects.length === 0 ? (
        <div className="empty-projects">
          <span aria-hidden="true">▧</span>
          <h2>
            {filter === 'archived'
              ? 'Un lugar para lo que ya has cerrado.'
              : search
                ? 'No hay proyectos con ese nombre.'
                : 'Cada proyecto empieza con una idea.'}
          </h2>
          <p>
            {search
              ? 'Prueba con otro nombre.'
              : filter === 'archived'
                ? 'Tus proyectos archivados aparecerán aquí, con sus tareas intactas.'
                : 'Crea tu primer proyecto y convierte esa idea en tareas concretas.'}
          </p>
          {!search && filter === 'active' && (
            <button className="primary-button" onClick={() => setCreate(true)}>
              Crear mi primer proyecto
            </button>
          )}
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <a href={`#/projects/${project.id}`} key={project.id} className="project-card">
              <div className="project-card-top">
                <span className="project-avatar">
                  {project.name.slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="project-state">{project.archivedAt ? 'Archivado' : 'Activo'}</span>
              </div>
              <h2>{project.name}</h2>
              <p>{project.description || 'Una nueva idea, lista para tomar forma.'}</p>
              <div className="project-card-bottom">
                <span>{new Date(project.updatedAt).toLocaleDateString('es-ES')}</span>
                <span>Abrir proyecto ↗</span>
              </div>
            </a>
          ))}
        </div>
      )}
      {create && <ProjectEditor project={null} onClose={() => setCreate(false)} />}
    </>
  );
}

export function Workspace({ route, user }: { route: string; user: User }) {
  const [logout, { isLoading, error }] = authApi.useLogoutMutation();
  const dispatch = useDispatch<AppDispatch>();
  const id = route.match(/^\/projects\/([^/]+)$/)?.[1];
  useEffect(() => {
    dispatch(workspaceUi.actions.resetFilters());
  }, [id, dispatch]);
  async function leave() {
    try {
      await logout().unwrap();
      dispatch(workspaceApi.util.resetApiState());
      dispatch(workspaceUi.actions.reset());
      void dispatch(authApi.util.upsertQueryData('session', undefined, { user: null }));
      window.location.hash = '/projects';
    } catch {}
  }
  return (
    <div className="app-shell workspace-shell">
      <a
        className="skip-link"
        href="#workspace-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('workspace-main')?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>Mi espacio</strong>
            <small>Propietario</small>
          </div>
          <span className="workspace-indicator" />
        </div>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          <a
            className={`nav-item ${!route.startsWith('/github') ? 'active' : ''}`}
            href="#/projects"
            aria-current={!route.startsWith('/github') ? 'page' : undefined}
          >
            <span aria-hidden="true">▧</span>Proyectos
            <span className="nav-active-dot" />
          </a>
          <a
            className={`nav-item ${route.startsWith('/github') ? 'active' : ''}`}
            href="#/github"
            aria-current={route.startsWith('/github') ? 'page' : undefined}
          >
            <span aria-hidden="true">⌘</span>GitHub
          </a>
          <a className="nav-item" href="#/status">
            <span aria-hidden="true">◉</span>Estado del sistema
          </a>
          {['Agentes'].map((label) => (
            <span className="nav-item upcoming" aria-disabled="true" key={label}>
              {label}
              <span className="nav-soon">Pronto</span>
            </span>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-flower">✳</span>
          <strong>De la idea a la evidencia.</strong>
          <p>
            Una tarea cada vez.
            <br />
            Un paso más cerca.
          </p>
          <span className="version">FERWEB / E8</span>
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span>
            <a href="#/projects">Mi espacio</a>
            <span className="breadcrumb-slash">/</span>
            <strong>{id ? 'Tablero' : 'Proyectos'}</strong>
          </span>
          <div className="account-menu">
            <span className="account-email">{user.email}</span>
            <button className="text-button" onClick={() => void leave()} disabled={isLoading}>
              {isLoading ? 'Saliendo…' : 'Cerrar sesión'}
            </button>
          </div>
        </header>
        <nav className="mobile-navigation" aria-label="Navegación móvil">
          <a href="#/projects">Proyectos</a>
          <a href="#/status">Estado</a>
          <a href="#/github">GitHub</a>
        </nav>
        <main id="workspace-main" tabIndex={-1}>
          {error && <Notice>{errorMessage(error)}</Notice>}
          {id ? (
            <ProjectPage key={id} id={id} />
          ) : route.split('?')[0] === '/github' ? (
            <GitHubSettings />
          ) : route === '/projects' ? (
            <ProjectList />
          ) : (
            <Notice>
              <a href="#/projects">Esta página no existe. Volver a proyectos.</a>
            </Notice>
          )}
        </main>
      </div>
    </div>
  );
}
