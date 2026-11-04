import { useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import type { Project, GitHubLink, GitHubSnapshot } from '@ferweb/contracts';
import { githubApi, authorizeGitHub } from './github-store';
import { errorMessage } from './workspace-store';
import './github.css';

function Failure({ error }: { error: unknown }) {
  return error ? (
    <p className="form-error" role="alert">
      {errorMessage(error)}
    </p>
  ) : null;
}
export function GitHubSettings() {
  const status = githubApi.useGithubStatusQuery(undefined, { refetchOnFocus: true });
  const installations = githubApi.useGithubInstallationsQuery(undefined, {
    skip: !status.data?.connected,
    refetchOnFocus: true,
  });
  const [connect, connecting] = githubApi.useConnectInstallationMutation();
  const [disconnect, disconnecting] = githubApi.useDisconnectGitHubMutation();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  async function authorize() {
    setBusy(true);
    setFailure(null);
    try {
      await authorizeGitHub();
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }
  return (
    <section className="github-panel">
      <p className="eyebrow">CÓDIGO CON PROCEDENCIA</p>
      <h1>Conexión con GitHub</h1>
      <p>
        Autoriza tu GitHub App, conecta una instalación y elige los repositorios desde cada
        proyecto.
      </p>
      {window.location.hash.includes('authorization=failed') && (
        <p className="form-error" role="alert">
          La autorización no se completó. Comprueba la sesión y vuelve a intentarlo.
        </p>
      )}
      <Failure error={status.error ?? failure ?? connecting.error ?? disconnecting.error} />
      {status.isLoading ? (
        <p role="status">Comprobando conexión…</p>
      ) : (
        status.data && (
          <>
            {!status.data.configured ? (
              <div className="github-empty">
                <h2>Configura primero tu GitHub App</h2>
                <p>
                  El servidor necesita la configuración privada descrita en{' '}
                  <code>docs/github.md</code>. Las claves y los tokens permanecen en el backend.
                </p>
                <button className="secondary-button" onClick={() => void status.refetch()}>
                  Comprobar configuración
                </button>
              </div>
            ) : (
              <>
                <p role="status">
                  {status.data.connected
                    ? `Autorizado como ${status.data.login}.`
                    : 'Es necesario autorizar tu cuenta de GitHub.'}{' '}
                  {status.data.expiresAt &&
                    `Autorización hasta ${new Date(status.data.expiresAt).toLocaleString()}.`}
                </p>
                <div className="github-actions">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void authorize()}
                  >
                    {busy
                      ? 'Abriendo GitHub…'
                      : status.data.connected
                        ? 'Volver a autorizar GitHub'
                        : 'Autorizar GitHub'}
                  </button>
                  {status.data.installUrl && (
                    <a
                      className="secondary-button"
                      href={status.data.installUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Instalar o configurar la App ↗
                    </a>
                  )}
                  {status.data.login && (
                    <button className="text-button" onClick={() => setConfirm(true)}>
                      Desconectar de FerWeb
                    </button>
                  )}
                </div>
                {confirm && (
                  <div className="github-empty">
                    <p>
                      Se eliminarán la credencial local y los vínculos de repositorios. Los
                      proyectos, tareas y datos de GitHub se conservan.
                    </p>
                    <button className="secondary-button" onClick={() => setConfirm(false)}>
                      Cancelar
                    </button>
                    <button
                      className="primary-button"
                      disabled={disconnecting.isLoading}
                      onClick={() =>
                        void disconnect()
                          .unwrap()
                          .then(() => setConfirm(false))
                          .catch(() => {})
                      }
                    >
                      Confirmar desconexión
                    </button>
                  </div>
                )}
                {status.data.connected && (
                  <>
                    <h2>Instalaciones accesibles</h2>
                    <button
                      className="text-button"
                      disabled={installations.isFetching}
                      onClick={() => void installations.refetch()}
                    >
                      Actualizar instalaciones
                    </button>
                    <Failure error={installations.error} />
                    {installations.isFetching && <p role="status">Consultando instalaciones…</p>}
                    {!installations.error &&
                      installations.currentData?.installations.length === 0 && (
                        <p>Instala la App en tu cuenta u organización y actualiza esta lista.</p>
                      )}
                    {!installations.error &&
                      installations.currentData?.installations.map((item) => (
                        <div className="github-installation" key={item.id}>
                          <div>
                            <strong>{item.account}</strong>
                            <small>
                              Instalación {item.id} ·{' '}
                              {item.connected ? 'Conectada' : 'Sin conectar'}
                            </small>
                          </div>
                          <button
                            className="secondary-button"
                            disabled={connecting.isLoading}
                            onClick={() =>
                              void connect(item.id)
                                .unwrap()
                                .catch(() => {})
                            }
                          >
                            {item.connected ? 'Reconectar' : 'Conectar instalación'}
                          </button>
                        </div>
                      ))}
                  </>
                )}
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
function LinkForm({
  projectId,
  version,
  onDone,
}: {
  projectId: string;
  version: number;
  onDone: () => void;
}) {
  const installations = githubApi.useGithubInstallationsQuery();
  const [installation, setInstallation] = useState(0),
    [page, setPage] = useState(1),
    [repositoryId, setRepository] = useState(0),
    [branch, setBranch] = useState('');
  const repos = githubApi.useGithubRepositoriesQuery(
    installation ? { installationId: installation, page } : skipToken,
  );
  const [link, linking] = githubApi.useLinkGitHubMutation();
  const [sync, syncing] = githubApi.useSyncGitHubMutation();
  const busy = linking.isLoading || syncing.isLoading;
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await link({
        projectId,
        body: {
          installationId: installation,
          repositoryId,
          version,
          ...(branch.trim() ? { branch: branch.trim() } : {}),
        },
      }).unwrap();
      onDone();
      if (saved.link) await sync({ projectId, version: saved.link.version }).unwrap();
    } catch {}
  }
  return (
    <form className="github-link-form" onSubmit={(event) => void submit(event)}>
      <p>
        Selecciona una instalación conectada y un repositorio accesible. Se consultará GitHub para
        verificar tus permisos.
      </p>
      <label>
        Instalación
        <select
          value={installation}
          disabled={busy}
          onChange={(event) => {
            setInstallation(Number(event.target.value));
            setRepository(0);
            setBranch('');
            setPage(1);
          }}
        >
          <option value={0}>Seleccionar instalación</option>
          {installations.currentData?.installations
            .filter((item) => item.connected)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.account} · {item.id}
              </option>
            ))}
        </select>
      </label>
      <Failure error={installations.error ?? repos.error} />
      {repos.isFetching && <p role="status">Consultando repositorios…</p>}
      {installation > 0 && !repos.error && (
        <>
          <label>
            Repositorio
            <select
              value={repositoryId}
              disabled={busy || repos.isFetching}
              onChange={(event) => {
                const id = Number(event.target.value);
                setRepository(id);
                setBranch(
                  repos.currentData?.repositories.find((item) => item.id === id)?.defaultBranch ??
                    '',
                );
              }}
            >
              <option value={0}>Seleccionar repositorio</option>
              {repos.currentData?.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName}
                  {repo.private ? ' · Privado' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="github-actions">
            <button
              type="button"
              className="text-button"
              disabled={page === 1 || busy}
              onClick={() => {
                setPage(page - 1);
                setRepository(0);
              }}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              type="button"
              className="text-button"
              disabled={!repos.currentData?.nextPage || page >= 10 || busy}
              onClick={() => {
                setPage(page + 1);
                setRepository(0);
              }}
            >
              Siguiente
            </button>
          </div>
          <label>
            Rama
            <input
              value={branch}
              maxLength={250}
              disabled={busy}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="Rama predeterminada"
            />
          </label>
        </>
      )}
      <Failure error={linking.error ?? syncing.error} />
      <button className="primary-button" disabled={!installation || !repositoryId || busy}>
        {busy ? 'Vinculando y consultando…' : 'Vincular repositorio'}
      </button>
    </form>
  );
}
function FileContent({
  projectId,
  path,
  version,
}: {
  projectId: string;
  path: string;
  version: number;
}) {
  const file = githubApi.useGithubFileQuery({ projectId, path, version }, { refetchOnFocus: true });
  return (
    <section className="github-file" aria-label="Contenido del archivo">
      <h3>{path}</h3>
      <Failure error={file.error} />
      {file.isFetching ? (
        <p role="status">Leyendo archivo…</p>
      ) : (
        !file.error &&
        file.currentData && (
          <>
            <p>
              Commit <code>{file.currentData.commit}</code>
              {file.currentData.stale ? ' · Pendiente de sincronizar' : ''}
            </p>
            <pre tabIndex={0}>
              <code>{file.currentData.content}</code>
            </pre>
          </>
        )
      )}
    </section>
  );
}
function RepositoryData({ projectId, link }: { projectId: string; link: GitHubLink }) {
  const [tab, setTab] = useState<'files' | 'issues' | 'pulls'>('files'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [path, setPath] = useState('');
  const snapshot = link.snapshot!;
  const files = snapshot.tree.filter((entry) =>
    entry.path.toLowerCase().includes(search.toLowerCase()),
  );
  const items: GitHubSnapshot['issues'] =
    tab === 'issues' ? snapshot.issues : snapshot.pullRequests;
  return (
    <>
      <div className="github-provenance">
        <strong>{snapshot.repository.fullName}</strong>
        <span>
          Rama {snapshot.branch} · {snapshot.repository.private ? 'Privado' : 'Público'}
        </span>
        <a
          href={`https://github.com/${snapshot.repository.fullName}/commit/${snapshot.commit}`}
          target="_blank"
          rel="noreferrer"
        >
          Commit <code>{snapshot.commit}</code> ↗
        </a>
        <span>Consultado: {new Date(snapshot.observedAt).toLocaleString()}</span>
      </div>
      <div className="filter-tabs" role="group" aria-label="Datos del repositorio">
        {(
          [
            ['files', 'Archivos'],
            ['issues', `Issues (${snapshot.issues.length})`],
            ['pulls', `Pull requests (${snapshot.pullRequests.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? 'selected' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'files' ? (
        <>
          {snapshot.treeTruncated && (
            <p role="status" className="read-only-note">
              Árbol parcial: GitHub o el límite de 5000 entradas ha recortado la lista.
            </p>
          )}
          <p>
            Se omiten rutas de configuración privada, secretos y dependencias. El contenido
            pertenece al commit indicado.
          </p>
          <label>
            Buscar archivo
            <input
              type="search"
              maxLength={200}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="github-explorer">
            <div className="github-tree">
              <ul aria-label="Árbol de archivos">
                {files.slice(page * 100, (page + 1) * 100).map((entry) => (
                  <li key={entry.path}>
                    {entry.type === 'blob' ? (
                      <button
                        className="text-button"
                        aria-pressed={path === entry.path}
                        onClick={() => setPath(entry.path)}
                      >
                        {entry.path}
                      </button>
                    ) : (
                      <span>
                        {entry.type === 'tree' ? '▸' : '↗'} {entry.path}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!files.length && <p>No hay archivos coincidentes.</p>}
              <div className="github-actions">
                <button className="text-button" disabled={!page} onClick={() => setPage(page - 1)}>
                  Anterior
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil(files.length / 100))}
                </span>
                <button
                  className="text-button"
                  disabled={(page + 1) * 100 >= files.length}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
            {path ? (
              <FileContent
                key={`${link.version}:${path}`}
                projectId={projectId}
                path={path}
                version={link.version}
              />
            ) : (
              <p>Selecciona un archivo para leerlo.</p>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            Issues y pull requests son datos observados en la fecha de consulta; no están
            versionados por el commit del código.
          </p>
          {(tab === 'issues' ? snapshot.issuesTruncated : snapshot.pullRequestsTruncated) && (
            <p className="read-only-note">
              Lista parcial: se han consultado como máximo cinco páginas de 100 elementos.
            </p>
          )}
          {items.length ? (
            items.map((item) => (
              <details className="github-item" key={item.number}>
                <summary>
                  #{item.number} · {item.title} · {item.state}
                </summary>
                <p>{item.body || 'Sin descripción.'}</p>
                {item.head && (
                  <p>
                    Head <code>{item.head}</code> · Base <code>{item.base}</code>
                  </p>
                )}
                <a className="text-link" href={item.url} target="_blank" rel="noreferrer">
                  Ver en GitHub ↗
                </a>
              </details>
            ))
          ) : (
            <p>No hay elementos en esta consulta.</p>
          )}
        </>
      )}
    </>
  );
}
export function ProjectGitHub({ project }: { project: Project }) {
  const status = githubApi.useGithubStatusQuery(undefined, { refetchOnFocus: true });
  const result = githubApi.useGithubLinkQuery(project.id, {
    refetchOnFocus: true,
    pollingInterval: 30000,
    skipPollingIfUnfocused: true,
  });
  const [sync, syncing] = githubApi.useSyncGitHubMutation(),
    [unlink, unlinking] = githubApi.useUnlinkGitHubMutation();
  const [edit, setEdit] = useState(false),
    [confirm, setConfirm] = useState(false);
  const link = result.currentData?.link;
  return (
    <section className="github-panel" aria-label="Repositorio GitHub">
      <div className="workspace-page-heading">
        <div>
          <h2>Repositorio GitHub</h2>
          <p>Una fuente de código vinculada a este proyecto.</p>
        </div>
        <a className="text-link" href="#/github">
          Gestionar conexión →
        </a>
      </div>
      <Failure error={status.error ?? result.error ?? syncing.error ?? unlinking.error} />
      {result.isLoading && <p role="status">Consultando vínculo…</p>}
      {!status.data?.connected && (
        <p>
          Configura y autoriza la GitHub App desde la conexión de GitHub para consultar
          repositorios.
        </p>
      )}
      {link && (
        <>
          <p>
            <strong>{link.fullName}</strong> · Rama {link.branch}
          </p>
          {link.revoked && (
            <p role="alert" className="form-error">
              Acceso revocado. Reconecta la instalación y sincroniza para volver a consultar datos.
            </p>
          )}
          {link.stale && !link.revoked && (
            <p className="read-only-note" role="status">
              Hay cambios pendientes de sincronizar. Los datos visibles conservan su commit y fecha
              originales.
            </p>
          )}
          <div className="github-actions">
            <button
              className="primary-button"
              disabled={
                !!project.archivedAt ||
                syncing.isLoading ||
                unlinking.isLoading ||
                !status.data?.connected
              }
              onClick={() =>
                void sync({ projectId: project.id, version: link.version })
                  .unwrap()
                  .catch(() => {})
              }
            >
              {syncing.isLoading ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            {!project.archivedAt && (
              <>
                <button
                  className="secondary-button"
                  disabled={syncing.isLoading}
                  onClick={() => setEdit(!edit)}
                >
                  Cambiar repositorio o rama
                </button>
                <button
                  className="text-button"
                  disabled={syncing.isLoading}
                  onClick={() => setConfirm(true)}
                >
                  Desvincular
                </button>
              </>
            )}
          </div>
          {confirm && (
            <div className="github-empty">
              <p>El proyecto y las tareas se conservan. Solo se elimina este vínculo local.</p>
              <button className="secondary-button" onClick={() => setConfirm(false)}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={unlinking.isLoading}
                onClick={() =>
                  void unlink({ projectId: project.id, version: link.version })
                    .unwrap()
                    .then(() => {
                      setConfirm(false);
                      setEdit(false);
                    })
                    .catch(() => {})
                }
              >
                Confirmar desvinculación
              </button>
            </div>
          )}
          {!result.error && !link.revoked && link.snapshot && (
            <RepositoryData
              key={`${link.version}:${link.snapshot.commit}`}
              projectId={project.id}
              link={link}
            />
          )}
        </>
      )}
      {!result.error && !project.archivedAt && status.data?.connected && (!link || edit) && (
        <LinkForm
          projectId={project.id}
          version={link?.version ?? 0}
          onDone={() => setEdit(false)}
        />
      )}
      {project.archivedAt && (
        <p className="read-only-note">
          Proyecto archivado: puedes consultar los datos disponibles, pero debes restaurarlo para
          cambiar el vínculo o sincronizar.
        </p>
      )}
      {result.error && (
        <button className="secondary-button" onClick={() => void result.refetch()}>
          Volver a comprobar acceso
        </button>
      )}
    </section>
  );
}
