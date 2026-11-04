import type { CSSProperties, ReactNode } from 'react';
import { healthApi } from './store';
import { authApi, workspaceApi } from './workspace-store';
import { ExecutionDetails, executionLabels } from './ExecutionDetails';

function Icon({
  name,
  size = 20,
}: {
  name:
    | 'grid'
    | 'folder'
    | 'chat'
    | 'agent'
    | 'chart'
    | 'arrow'
    | 'refresh'
    | 'database'
    | 'server'
    | 'globe'
    | 'check'
    | 'code';
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z" />,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />,
    agent: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="4" />
        <path d="M12 3v4M8 12v2m8-2v2M9 17h6M1 12v4m22-4v4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v17h17M8 15l4-5 4 2 5-7" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M5.6 7a8 8 0 0 1 13-2L20 7M4 17l1.4 2a8 8 0 0 0 13-2" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    server: (
      <>
        <rect x="3" y="3" width="18" height="7" rx="2" />
        <rect x="3" y="14" width="18" height="7" rx="2" />
        <path d="M7 6.5h.01M7 17.5h.01M15 7h3m-3 10h3" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Status({ state, children }: { state: 'good' | 'bad' | 'muted'; children: ReactNode }) {
  return (
    <span className={`status status-${state}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

function ServiceCard({
  icon,
  title,
  subtitle,
  value,
  state,
  footnote,
  index,
}: {
  icon: 'globe' | 'server' | 'database';
  title: string;
  subtitle: string;
  value: string;
  state: 'good' | 'bad' | 'muted';
  footnote: string;
  index: number;
}) {
  return (
    <article className="service-card" style={{ '--card-index': index } as CSSProperties}>
      <div className="card-heading">
        <span className="service-icon">
          <Icon name={icon} />
        </span>
        <span className="card-index">0{index + 1}</span>
      </div>
      <h3>{title}</h3>
      <p className="service-subtitle">{subtitle}</p>
      <div className="service-value">
        <Status state={state}>{value}</Status>
      </div>
      <p className="card-footnote">{footnote}</p>
    </article>
  );
}

function ExecutionStatus() {
  const session = authApi.useSessionQuery(undefined, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
  });
  const user = session.isError ? null : session.currentData?.user;
  return (
    <section className="persistence-panel" aria-labelledby="execution-heading">
      <h2 id="execution-heading">Capacidades de ejecución</h2>
      {user ? (
        <ExecutionOptions key={user.id} userId={user.id} />
      ) : (
        <p>
          {session.isFetching
            ? 'Comprobando sesión…'
            : 'Entra en FerWeb para consultar las capacidades.'}
        </p>
      )}
    </section>
  );
}

function ExecutionOptions({ userId }: { userId: string }) {
  const [consult, result] = workspaceApi.useLazyExecutionCapabilitiesQuery();
  const options = result.isFetching || result.isError ? undefined : result.currentData?.options;
  return (
    <>
      <button
        className="refresh-button"
        disabled={result.isFetching}
        onClick={() => void consult(userId)}
      >
        {result.isFetching ? 'Consultando capacidades…' : 'Consultar capacidades'}
      </button>
      {result.isError && (
        <p role="alert">
          No se han podido consultar las capacidades. Comprueba tu sesión y vuelve a intentarlo.
        </p>
      )}
      {options?.map((option) => (
        <div key={option.id}>
          <h3>{executionLabels[option.id]}</h3>
          <ExecutionDetails option={option} />
        </div>
      ))}
    </>
  );
}

export function StatusApp() {
  const { data, error, isFetching, refetch } = healthApi.useReadinessQuery(undefined, {
    pollingInterval: 15_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const liveData = error ? undefined : data;
  const ready = liveData?.status === 'ready';
  const databaseReady = liveData?.checks.database === 'ready';
  const initial = isFetching && !data;
  const state = ready ? 'good' : initial ? 'muted' : 'bad';
  const checkedAt = data ? new Date(data.checkedAt).toLocaleTimeString('es-ES') : null;

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <a className="brand" href="#/projects" aria-label="FerWeb, inicio">
          <span className="brand-mark">
            f<span>.</span>
          </span>
          FerWeb<span className="brand-tag">LAB</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">F</span>
          <div>
            <strong>Mi espacio</strong>
            <small>Desarrollo local</small>
          </div>
          <span className="workspace-indicator" />
        </div>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          <a className="nav-item active" href="#/status" aria-current="page">
            <Icon name="grid" />
            Vista general
            <span className="nav-active-dot" />
          </a>
          <a className="nav-item" href="#/projects">
            <Icon name="folder" />
            Proyectos
          </a>
          <a className="nav-item" href="#/agents">
            <Icon name="agent" />
            Agentes
          </a>
          {(
            [
              ['chat', 'Conversaciones'],
              ['chart', 'Comparativas'],
            ] as const
          ).map(([icon, label]) => (
            <span key={label} className="nav-item upcoming" aria-disabled="true">
              <Icon name={icon} />
              {label}
              <span className="nav-soon">Pronto</span>
            </span>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-flower">✳</span>
          <strong>De la idea a la evidencia.</strong>
          <p>
            Proyectos, contexto y agentes.
            <br />
            Un mismo lugar.
          </p>
          <span className="version">FERWEB / 0.1.0</span>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <span>
            Mi espacio <span className="breadcrumb-slash">/</span> <strong>Vista general</strong>
          </span>
          <span className="environment-tag">
            <span />
            Entorno de desarrollo
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          <section className="intro">
            <div className="eyebrow">
              <span className="eyebrow-line" /> EL PUNTO DE PARTIDA
            </div>
            <div className="intro-row">
              <div>
                <h1>
                  Todo empieza
                  <br />
                  con una buena base<span>.</span>
                </h1>
                <p className="intro-copy">
                  Tu espacio para construir software con IA.
                  <br className="desktop-break" /> Primero, comprobemos que todo está conectado.
                </p>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-outer" />
                <div className="orbit orbit-inner" />
                <div className="art-core">
                  <Icon name="code" size={34} />
                </div>
                <span className="orbit-node node-one" />
                <span className="orbit-node node-two" />
                <span className="orbit-label">build → connect → create</span>
              </div>
            </div>
          </section>

          <section className="system-section" aria-labelledby="system-heading">
            <div className="section-heading">
              <div>
                <h2 id="system-heading">Estado del sistema</h2>
                <p>Conexión en tiempo real con los servicios de FerWeb.</p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void refetch()}
                disabled={isFetching}
                aria-busy={isFetching}
              >
                <span className={isFetching ? 'spin' : ''}>
                  <Icon name="refresh" size={16} />
                </span>
                {isFetching ? 'Comprobando…' : 'Actualizar estado'}
              </button>
            </div>
            <div className="system-banner" role="status" aria-live="polite">
              <div>
                <Status state={state}>
                  {ready
                    ? 'Servicios operativos'
                    : initial
                      ? 'Comprobando conexión'
                      : 'La conexión necesita atención'}
                </Status>
                <span className="banner-description">
                  {ready
                    ? 'La web, la API y la base de datos están disponibles.'
                    : initial
                      ? 'Consultando el estado de la API y la base de datos.'
                      : 'Revisa el estado de los servicios y vuelve a consultar.'}
                </span>
              </div>
              <span className="last-check">
                {isFetching
                  ? 'Actualizando…'
                  : checkedAt
                    ? `${error ? 'Última respuesta' : 'Comprobado'} ${checkedAt}`
                    : 'Sin respuesta todavía'}
              </span>
            </div>
            {error && (
              <p className="error-message" role="alert">
                No se ha podido consultar la API. Comprueba los servicios y vuelve a intentarlo.
              </p>
            )}
            <div className="service-grid">
              <ServiceCard
                icon="globe"
                title="Aplicación web"
                subtitle="React · TypeScript"
                value="Disponible"
                state="good"
                footnote="Tu espacio de trabajo está listo para abrirse."
                index={0}
              />
              <ServiceCard
                icon="server"
                title="API"
                subtitle="Node.js · Express"
                value={liveData ? 'Conectada' : initial ? 'Comprobando' : 'Sin conexión'}
                state={liveData ? 'good' : initial ? 'muted' : 'bad'}
                footnote={
                  liveData
                    ? `En ejecución desde hace ${liveData.uptimeSeconds} s.`
                    : 'Esperando una respuesta válida del servicio.'
                }
                index={1}
              />
              <ServiceCard
                icon="database"
                title="Base de datos"
                subtitle="PostgreSQL"
                value={databaseReady ? 'Disponible' : initial ? 'Comprobando' : 'No disponible'}
                state={databaseReady ? 'good' : initial ? 'muted' : 'bad'}
                footnote={
                  databaseReady
                    ? 'Conexión verificada mediante una consulta real.'
                    : 'La API verificará conexión y esquema.'
                }
                index={2}
              />
            </div>
          </section>

          <div className="bottom-grid">
            <section className="persistence-panel" aria-labelledby="persistence-heading">
              <div className="panel-heading">
                <span className="small-icon">
                  <Icon name="database" size={18} />
                </span>
                <h2 id="persistence-heading">Una base que permanece</h2>
              </div>
              <p>
                Este registro identifica tu instalación y permite comprobar que los datos sobreviven
                a los reinicios.
              </p>
              <dl>
                <div>
                  <dt>Estado del esquema</dt>
                  <dd>
                    {liveData?.checks.migrations === 'ready' ? (
                      <span className="inline-success">
                        <Icon name="check" size={14} />
                        Al día · {liveData.checks.appliedMigrations}{' '}
                        {liveData.checks.appliedMigrations === 1 ? 'migración' : 'migraciones'}
                      </span>
                    ) : liveData?.checks.migrations === 'pending' ? (
                      'Migraciones pendientes'
                    ) : (
                      'Sin verificar'
                    )}
                  </dd>
                </div>
                <div className="installation-row">
                  <dt>ID de instalación</dt>
                  <dd>
                    <code data-testid="installation-id">
                      {liveData?.installation?.id ?? 'Pendiente de conexión'}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Creada el</dt>
                  <dd>
                    {liveData?.installation
                      ? new Date(liveData.installation.createdAt).toLocaleString('es-ES')
                      : 'Sin verificar'}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="next-panel">
              <span className="next-kicker">LO QUE VIENE DESPUÉS</span>
              <div className="next-icon">
                <Icon name="folder" size={26} />
              </div>
              <h2>
                Tu proyecto,
                <br />
                con todo su contexto.
              </h2>
              <p>
                Codex ya ejecuta tareas en una copia separada y entrega cambios con pruebas. La
                siguiente entrega ampliará su revisión y publicación explícita.
              </p>
              <details>
                <summary>
                  Ver siguiente paso <Icon name="arrow" size={17} />
                </summary>
                <p>
                  Podrás revisar cambios y publicar una rama o pull request mediante una acción
                  explícita, con evidencias y control de la versión de partida.
                </p>
              </details>
            </section>
          </div>
          <ExecutionStatus />
          <footer className="page-footer">
            <span>
              <span className="footer-dot" />
              Construyendo FerWeb, paso a paso.
            </span>
            <span>Base de desarrollo · E1</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
