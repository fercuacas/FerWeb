import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './store';
import { StatusApp } from './StatusApp';
import { Workspace } from './Workspace';
import { Brand } from './Brand';
import { authApi, workspaceApi, workspaceUi, errorMessage, loginRequest } from './workspace-store';
import './workspace.css';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dispatch = useDispatch<AppDispatch>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const session = await loginRequest(email, password);
      setPassword('');
      dispatch(workspaceApi.util.resetApiState());
      dispatch(workspaceUi.actions.reset());
      void dispatch(authApi.util.upsertQueryData('session', undefined, session));
    } catch (failure) {
      setError(failure);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">TU ESPACIO PARA CONSTRUIR</p>
          <h1>
            Las grandes ideas
            <br />
            merecen un buen
            <br />
            punto de partida<span>.</span>
          </h1>
          <p>
            Organiza tus proyectos, define el siguiente paso
            <br />y convierte el trabajo en progreso.
          </p>
        </div>
        <span className="login-note">Proyectos · Contexto · Agentes</span>
      </section>
      <main className="login-main">
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <span className="login-symbol">↗</span>
          <p className="eyebrow">BIENVENIDO A FERWEB</p>
          <h2>Vuelve a tu espacio.</h2>
          <p>Entra con tu cuenta de propietario para continuar.</p>
          <label>
            Correo electrónico
            <input
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isLoading}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
            />
          </label>
          {error !== null && (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          <button className="primary-button" disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar en FerWeb'}
            <span aria-hidden="true">→</span>
          </button>
          <p className="login-help">
            ¿Primera instalación? Crea el propietario desde la terminal siguiendo el README.
          </p>
          <a className="text-link" href="#/status">
            Consultar estado de servicios →
          </a>
        </form>
      </main>
    </div>
  );
}
function AuthenticatedApp({ route }: { route: string }) {
  const session = authApi.useSessionQuery(undefined, {
    refetchOnFocus: true,
    pollingInterval: 60000,
    skipPollingIfUnfocused: true,
  });
  const expired = useSelector((state: RootState) => state.workspaceUi.sessionExpired);
  const dispatch = useDispatch<AppDispatch>();
  const [boundUser, setBoundUser] = useState<string | null>(null);
  const user = session.data?.user;
  useLayoutEffect(() => {
    const id = user?.id ?? null;
    if (boundUser !== id) {
      dispatch(workspaceUi.actions.reset());
      dispatch(workspaceApi.util.resetApiState());
      setBoundUser(id);
    }
  }, [user?.id, boundUser, dispatch]);
  useEffect(() => {
    if (expired) {
      dispatch(workspaceApi.util.resetApiState());
      void dispatch(authApi.util.upsertQueryData('session', undefined, { user: null })).then(() =>
        dispatch(workspaceUi.actions.reset()),
      );
    }
  }, [expired, dispatch]);
  if (boundUser !== (user?.id ?? null))
    return (
      <div className="session-screen" role="status">
        Actualizando sesión…
      </div>
    );
  if (session.isLoading)
    return (
      <div className="session-screen" role="status">
        Preparando tu espacio…
      </div>
    );
  if (session.isError && !expired)
    return (
      <div className="session-screen">
        <Brand />
        <p role="alert">No se ha podido comprobar tu sesión.</p>
        <button className="primary-button" onClick={() => void session.refetch()}>
          Volver a intentar
        </button>
        <a className="text-link" href="#/status">
          Estado de los servicios
        </a>
      </div>
    );
  if (!user || expired) return <Login />;
  return <Workspace route={route} user={user} />;
}
export function App() {
  const route = useSyncExternalStore(subscribe, () => window.location.hash.slice(1) || '/projects');
  if (route === '/status') return <StatusApp />;
  return <AuthenticatedApp route={route} />;
}
