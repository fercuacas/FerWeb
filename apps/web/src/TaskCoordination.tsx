import { useState, useRef, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import type { z } from 'zod';
import { taskCoordinationInput, type taskCoordinationGraph } from '@ferweb/contracts';
import { coordinationApi } from './coordination-store';
import { teamsApi } from './teams-store';
import { githubApi } from './github-store';
import { errorMessage } from './workspace-store';
import './coordination.css';

type Node = z.infer<typeof taskCoordinationGraph>['tasks'][number];
const issueStateLabels = {
  prepared: 'Preparada',
  sending: 'En curso',
  uncertain: 'Resultado remoto incierto',
  published: 'Creación confirmada',
};
function LocalEditor({
  project,
  archived,
  node,
  nodes,
}: {
  project: string;
  archived: boolean;
  node: Node;
  nodes: Node[];
}) {
  const [kind, setKind] = useState(node.kind),
    [parent, setParent] = useState(node.parentEpicId ?? ''),
    [deps, setDeps] = useState(node.dependsOn),
    [blocker, setBlocker] = useState(node.blocker ?? '');
  const [claim, setClaim] = useState(
      node.claim.templateId ? 'team' : node.claim.owner ? 'owner' : 'none',
    ),
    [team, setTeam] = useState(node.claim.templateId ?? ''),
    [version, setVersion] = useState(node.claim.templateVersion ?? 1);
  const teams = teamsApi.useTeamTemplatesQuery(project);
  const [save, result] = coordinationApi.useSaveCoordinationMutation();
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const body = taskCoordinationInput.safeParse({
      version: node.version,
      kind,
      parentEpicId: parent || null,
      dependsOn: deps,
      blocker: blocker.trim() || null,
      claim:
        claim === 'team'
          ? { kind: 'team', templateId: team, templateVersion: version }
          : { kind: claim },
    });
    if (!body.success) {
      setError(body.error.issues.map((i) => i.message).join(' '));
      return;
    }
    try {
      await save({ project, id: node.id, body: body.data }).unwrap();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form
      className="job-form"
      aria-label="Coordinar tarea"
      onSubmit={(event) => void submit(event)}
    >
      <h4>
        {node.title} · versión {node.version}
      </h4>
      <fieldset disabled={archived || result.isLoading}>
        <div className="job-grid">
          <label>
            Tipo de trabajo
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="task">Tarea</option>
              <option value="epic">Épica</option>
            </select>
          </label>
          <label>
            Épica superior
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Sin épica</option>
              {nodes
                .filter((n) => n.kind === 'epic' && n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reclamación local
            <select value={claim} onChange={(e) => setClaim(e.target.value)}>
              <option value="none">Sin reclamar</option>
              <option value="owner">Para mí</option>
              <option value="team">Para un equipo</option>
            </select>
          </label>
          {claim === 'team' && (
            <>
              <label>
                Equipo reclamante
                <select
                  required
                  value={team}
                  onChange={(e) => {
                    setTeam(e.target.value);
                    setVersion(
                      teams.currentData?.templates.find((t) => t.id === e.target.value)?.latest
                        .version ?? 1,
                    );
                  }}
                >
                  <option value="">Selecciona un equipo</option>
                  {!teams.error &&
                    teams.currentData?.templates
                      .filter((t) => !t.archivedAt)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.latest.definition.name}
                        </option>
                      ))}
                </select>
              </label>
              <label>
                Versión del equipo reclamante
                <input
                  type="number"
                  required
                  min={1}
                  value={version}
                  onChange={(e) => setVersion(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>
        <label>
          Motivo del bloqueo local
          <textarea maxLength={500} value={blocker} onChange={(e) => setBlocker(e.target.value)} />
        </label>
        <fieldset>
          <legend>Dependencias para avanzar</legend>
          {nodes
            .filter((n) => n.id !== node.id)
            .map((n) => (
              <label key={n.id}>
                <input
                  type="checkbox"
                  checked={deps.includes(n.id)}
                  onChange={(e) =>
                    setDeps(e.target.checked ? [...deps, n.id] : deps.filter((id) => id !== n.id))
                  }
                />
                {n.title} ·{' '}
                {n.status === 'done'
                  ? 'Hecha'
                  : n.status === 'in_progress'
                    ? 'En curso'
                    : 'Pendiente'}
              </label>
            ))}
          {nodes.length === 1 && <p>Añade otra tarea para definir dependencias.</p>}
        </fieldset>
        <button className="primary-button">
          {result.isLoading ? 'Guardando coordinación…' : 'Guardar coordinación local'}
        </button>
      </fieldset>
      {archived && <p>Restaura el proyecto para cambiar su coordinación.</p>}
      {teams.error && (
        <p role="alert">
          {errorMessage(teams.error)}{' '}
          <button type="button" onClick={() => void teams.refetch()}>
            Reintentar equipos
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function IssueAction({
  project,
  archived,
  id,
}: {
  project: string;
  archived: boolean;
  id: string;
}) {
  const query = coordinationApi.useIssueActionQuery(
    { project, id },
    { pollingInterval: 2000, skipPollingIfUnfocused: true },
  );
  const [execute, executing] = coordinationApi.useExecuteIssueMutation(),
    [reconcile, reconciling] = coordinationApi.useReconcileIssueMutation();
  const [confirmed, setConfirmed] = useState('');
  const action = query.error ? undefined : query.currentData?.action;
  return (
    <section className="agent-history" aria-label="Vista previa de issue">
      {query.isLoading && <p role="status">Cargando acción…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar acción</button>
        </p>
      )}
      {action && (
        <>
          <h4>Issue · {issueStateLabels[action.state]}</h4>
          <p>
            {action.snapshot.repository} · Tarea v{action.snapshot.taskVersion}
          </p>
          <p className="skill-text">Huella revisada: {action.hash}</p>
          <h5>{action.snapshot.title}</h5>
          <pre className="skill-text">{action.snapshot.body}</pre>
          {!action.conditionsCurrent && action.state === 'prepared' && (
            <p role="alert">Las condiciones han cambiado. Prepara otra vista previa.</p>
          )}
          {action.state === 'prepared' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed === action.hash}
                  disabled={archived || !action.conditionsCurrent}
                  onChange={(e) => setConfirmed(e.target.checked ? action.hash : '')}
                />
                He revisado el contenido y el repositorio de esta issue
              </label>
              <button
                disabled={
                  archived ||
                  !action.conditionsCurrent ||
                  confirmed !== action.hash ||
                  executing.isLoading
                }
                onClick={() =>
                  void execute({ project, id, hash: action.hash })
                    .unwrap()
                    .catch(() => {})
                }
              >
                Crear issue revisada en GitHub
              </button>
            </>
          )}
          {['sending', 'uncertain'].includes(action.state) && (
            <>
              <p>
                Reconcilia esta acción consultando GitHub. La creación no se repetirá. Una operación
                todavía en curso conserva su reserva durante tres minutos.
              </p>
              <button
                disabled={archived || reconciling.isLoading}
                onClick={() =>
                  void reconcile({ project, id, hash: action.hash })
                    .unwrap()
                    .catch(() => {})
                }
              >
                Reconciliar resultado remoto
              </button>
            </>
          )}
          {action.errorCode && <p role="status">Último resultado: {action.errorCode}</p>}
          {action.item && (
            <a href={action.item.url} target="_blank" rel="noreferrer">
              Abrir issue #{action.item.number}
            </a>
          )}
        </>
      )}
      {action?.state !== 'published' && (executing.error || reconciling.error) && (
        <p role="alert">{errorMessage(executing.error ?? reconciling.error)}</p>
      )}
    </section>
  );
}
function RemoteWork({
  project,
  archived,
  nodes,
}: {
  project: string;
  archived: boolean;
  nodes: Node[];
}) {
  const query = coordinationApi.useGithubWorkQuery(project, { refetchOnFocus: true });
  const source = githubApi.useGithubLinkQuery(project, { refetchOnFocus: true });
  const [link, result] = coordinationApi.useLinkWorkMutation(),
    [prepare, preparing] = coordinationApi.usePrepareIssueMutation();
  const [task, setTask] = useState(''),
    [item, setItem] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [actionId, setActionId] = useState('');
  const request = useRef({ key: '', id: crypto.randomUUID() });
  const data = query.error || source.error ? undefined : query.currentData;
  const snapshot = source.error ? undefined : source.currentData?.link?.snapshot;
  const selected = nodes.find((n) => n.id === task);
  const items = [
    ...(snapshot?.issues ?? [])
      .filter((i) => i.id)
      .map((i) => ({ key: `issue:${i.id}`, label: `Issue #${i.number} · ${i.title}` })),
    ...(snapshot?.pullRequests ?? [])
      .filter((i) => i.id)
      .map((i) => ({ key: `pull:${i.id}`, label: `PR #${i.number} · ${i.title}` })),
  ];
  async function preview(event: FormEvent) {
    event.preventDefault();
    if (!data || !selected) return;
    const key = JSON.stringify([task, selected.version, data.linkVersion, title, body]);
    if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const response = await prepare({
        project,
        body: {
          requestId: request.current.id,
          taskId: task,
          taskVersion: selected.version,
          linkVersion: data.linkVersion,
          title,
          body,
        },
      }).unwrap();
      setActionId(response.action.id);
    } catch {
      /* Draft stays available. */
    }
  }
  return (
    <section className="agent-history" aria-label="Vínculos y acciones GitHub">
      <h4>Estado observado en GitHub</h4>
      <p>
        Las etiquetas, responsables y cierres remotos son observaciones. La reclamación, los
        bloqueos y el estado de las tareas los decide FerWeb.
      </p>
      {query.isLoading && <p role="status">Cargando vínculos…</p>}
      {(query.error || source.error) && (
        <p role="alert">
          {errorMessage(query.error ?? source.error)}{' '}
          <button
            onClick={() => {
              void query.refetch();
              void source.refetch();
            }}
          >
            Reintentar coordinación GitHub
          </button>
        </p>
      )}
      {data && (
        <>
          {data.stale && (
            <p role="status">
              Sincroniza el repositorio para confirmar los cambios remotos. Se conserva la última
              observación.
            </p>
          )}
          {!data.links.length && !data.publications.length && (
            <p>Aún no hay issues ni PR vinculadas a tareas.</p>
          )}
          <ul className="coordination-list">
            {data.links.map((row) => (
              <li key={row.id}>
                <strong>{nodes.find((n) => n.id === row.taskId)?.title ?? 'Tarea'}</strong> ·{' '}
                {row.kind === 'issue' ? 'Issue' : 'PR'} #{row.number} ·{' '}
                {row.state === 'present'
                  ? 'Observada'
                  : row.state === 'missing'
                    ? 'No aparece en la lista completa'
                    : 'Pendiente de confirmar'}
                {row.observation && (
                  <>
                    <p>
                      <a href={row.observation.url} target="_blank" rel="noreferrer">
                        {row.observation.title}
                      </a>{' '}
                      · GitHub: {row.observation.state}
                    </p>
                    <p>
                      Observada:{' '}
                      {row.observedAt ? new Date(row.observedAt).toLocaleString() : 'Sin fecha'} ·
                      ID {row.itemId}
                    </p>
                    <p>
                      Responsables remotos:{' '}
                      {row.observation.assignees?.join(', ') || 'No disponibles'} · Etiquetas:{' '}
                      {row.observation.labels?.join(', ') || 'Sin etiquetas observadas'}
                    </p>
                  </>
                )}
              </li>
            ))}
            {data.publications.map((row) => (
              <li key={row.jobId}>
                {nodes.find((n) => n.id === row.taskId)?.title ?? 'Tarea'} ·{' '}
                <a href={row.url} target="_blank" rel="noreferrer">
                  PR #{row.number} publicada desde E9
                </a>{' '}
                · <a href={`#/projects/${project}/jobs/${row.jobId}`}>Ejecución revisada</a>
              </li>
            ))}
          </ul>
          <label>
            Tarea para GitHub
            <select
              value={task}
              onChange={(e) => {
                setTask(e.target.value);
                setTitle(nodes.find((n) => n.id === e.target.value)?.title ?? '');
              }}
            >
              <option value="">Selecciona una tarea</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <form
            className="job-form"
            aria-label="Vincular observación"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              const [kind, id] = item.split(':');
              void link({
                project,
                body: {
                  taskId: task,
                  taskVersion: selected.version,
                  linkVersion: data.linkVersion,
                  kind: kind as 'issue' | 'pull',
                  itemId: Number(id),
                },
              })
                .unwrap()
                .catch(() => {});
            }}
          >
            <label>
              Issue o PR observada
              <select required value={item} onChange={(e) => setItem(e.target.value)}>
                <option value="">Selecciona una observación</option>
                {items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={archived || !selected || !item || data.stale || result.isLoading}>
              Vincular a la tarea local
            </button>
          </form>
          {result.error && <p role="alert">{errorMessage(result.error)}</p>}
          <form
            className="job-form"
            aria-label="Preparar issue"
            onSubmit={(event) => void preview(event)}
          >
            <h4>Nueva issue desde la tarea local</h4>
            <label>
              Título de la issue
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Cuerpo de la issue
              <textarea maxLength={19000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <button disabled={archived || !selected || data.stale || preparing.isLoading}>
              Preparar vista previa de issue
            </button>
          </form>
          {preparing.error && <p role="alert">{errorMessage(preparing.error)}</p>}
          <label>
            Historial de acciones
            <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
              <option value="">Selecciona una acción</option>
              {data.actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.snapshot.title} · {issueStateLabels[a.state]}
                </option>
              ))}
            </select>
          </label>
          {actionId && (
            <IssueAction key={actionId} project={project} archived={archived} id={actionId} />
          )}
        </>
      )}
    </section>
  );
}
export function ProjectCoordination({ project, archived }: { project: string; archived: boolean }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState('');
  const query = coordinationApi.useCoordinationQuery(open ? project : skipToken, {
    refetchOnFocus: true,
  });
  const data = query.error ? undefined : query.currentData,
    node = data?.tasks.find((t) => t.id === selected);
  const [remote, setRemote] = useState(false);
  return (
    <details
      className="agent-history coordination-panel"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Épicas, dependencias y GitHub</summary>
      <section aria-label="Coordinación del proyecto">
        <p>
          Las dependencias y los bloqueos impiden avanzar y ejecutar. Completar una épica requiere
          completar sus hijos. Vincular o preparar una issue no cambia el estado local.
        </p>
        {query.isLoading && <p role="status">Cargando dependencias…</p>}
        {query.error && (
          <p role="alert">
            {errorMessage(query.error)}{' '}
            <button onClick={() => void query.refetch()}>Reintentar dependencias</button>
          </p>
        )}
        {data && (
          <>
            {!data.tasks.length ? (
              <p>Crea una tarea para comenzar la coordinación.</p>
            ) : (
              <>
                <ul className="coordination-list">
                  {data.tasks.map((task) => (
                    <li key={task.id}>
                      <button className="text-button" onClick={() => setSelected(task.id)}>
                        {task.kind === 'epic' ? 'Épica' : 'Tarea'} · {task.title}
                      </button>
                      <p>
                        FerWeb:{' '}
                        {task.status === 'done'
                          ? 'Hecha'
                          : task.status === 'in_progress'
                            ? 'En curso'
                            : 'Pendiente'}{' '}
                        ·{' '}
                        {task.claim.owner
                          ? `Reclamada por ${task.claim.owner}`
                          : task.claim.name
                            ? `Equipo ${task.claim.name} v${task.claim.templateVersion}`
                            : 'Sin reclamar'}
                      </p>
                      {task.parentEpicId && (
                        <p>Épica: {data.tasks.find((n) => n.id === task.parentEpicId)?.title}</p>
                      )}
                      <p>
                        Depende de:{' '}
                        {task.dependsOn
                          .map((id) => data.tasks.find((n) => n.id === id)?.title ?? id)
                          .join(', ') || 'Sin dependencias'}
                      </p>
                      {task.blocker && <p>Bloqueo local: {task.blocker}</p>}
                      {!!task.blockedBy.length && (
                        <p>
                          Espera a:{' '}
                          {task.blockedBy
                            .map((id) => data.tasks.find((n) => n.id === id)?.title ?? id)
                            .join(', ')}
                        </p>
                      )}
                      {data.executions
                        .filter((e) => e.taskId === task.id)
                        .map((e) => (
                          <p key={e.id}>
                            <a
                              href={`#/projects/${project}/${e.kind === 'team' ? 'teams' : 'jobs'}/${e.id}`}
                            >
                              {e.kind === 'team' ? 'Equipo' : 'Codex'} · {e.title} · {e.state}
                            </a>
                          </p>
                        ))}
                    </li>
                  ))}
                </ul>
                <label>
                  Tarea que coordinar
                  <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                    <option value="">Selecciona una tarea</option>
                    {data.tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
                {node && (
                  <LocalEditor
                    key={`${node.id}:${node.version}`}
                    project={project}
                    archived={archived}
                    node={node}
                    nodes={data.tasks}
                  />
                )}
              </>
            )}
            <details onToggle={(e) => setRemote(e.currentTarget.open)}>
              <summary>Vincular issues/PR y revisar acciones</summary>
              {remote && <RemoteWork project={project} archived={archived} nodes={data.tasks} />}
            </details>
          </>
        )}
      </section>
    </details>
  );
}
