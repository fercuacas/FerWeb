import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useDispatch } from 'react-redux';
import { type Project, type AiProvider, type ChatTurn, conversationInput } from '@ferweb/contracts';
import { chatApi, streamTurn } from './chat-store';
import { errorMessage, workspaceUi } from './workspace-store';
import type { AppDispatch } from './store';
import './conversations.css';
import { RepositoryContext, Sources } from './RepositoryContext';
import { ContextOperations } from './ContextStrategies';

const labels = {
  streaming: 'Generando',
  completed: 'Completada',
  incomplete: 'Incompleta',
  cancelled: 'Cancelada',
  error: 'Error',
  interrupted: 'Interrumpida',
};
const value = (metric: number | null, suffix = '') =>
  metric === null ? 'Desconocido' : `${Math.round(metric * 100) / 100}${suffix}`;
function Turn({ turn }: { turn: ChatTurn }) {
  return (
    <article className="chat-turn">
      <div className="chat-message user-message">
        <strong>Tú</strong>
        <p>{turn.prompt}</p>
      </div>
      <div className="chat-message assistant-message">
        <strong>{turn.reportedModel ?? turn.model}</strong>
        <span className="chat-state">{labels[turn.status]}</span>
        <p>
          {turn.response ||
            (turn.status === 'streaming' ? 'Esperando respuesta…' : 'Sin texto de respuesta.')}
        </p>
        {turn.errorMessage && (
          <p className="form-error" role="alert">
            {turn.errorCode}: {turn.errorMessage}
          </p>
        )}
        {turn.grounding === 'insufficient' && (
          <p className="read-only-note">
            No hay fuentes suficientes; respuesta sin llamada de generación.
          </p>
        )}
        {turn.grounding === 'retrieved' && (
          <p>
            Fuentes enviadas al modelo. La selección por similitud no garantiza que respondan por
            completo a la pregunta.
          </p>
        )}
        {turn.grounding === 'preparing' && turn.status === 'streaming' && (
          <p>
            Preparando contexto con la estrategia adoptada. Las fuentes utilizadas se mostrarán al
            finalizar.
          </p>
        )}
        {turn.sources.length > 0 && turn.grounding !== 'preparing' && (
          <Sources sources={turn.sources} />
        )}
        {turn.contextMetrics && <ContextOperations metrics={turn.contextMetrics} />}
        <details>
          <summary>Modelo, tiempos y consumo</summary>
          <dl className="chat-metrics">
            <dt>Proveedor</dt>
            <dd>{turn.provider}</dd>
            <dt>Modelo solicitado</dt>
            <dd>{turn.model}</dd>
            <dt>Límite de salida</dt>
            <dd>{turn.configuration.maxOutputTokens}</dd>
            <dt>Entrada / salida / total</dt>
            <dd>
              {value(turn.usage.inputTokens)} / {value(turn.usage.outputTokens)} /{' '}
              {value(turn.usage.totalTokens)}
            </dd>
            <dt>Tokens en caché / razonamiento</dt>
            <dd>
              {value(turn.usage.cachedTokens)} / {value(turn.usage.reasoningTokens)}
            </dd>
            <dt>Primer texto (API)</dt>
            <dd>{value(turn.firstTokenMs, ' ms')}</dd>
            <dt>Duración observada (API)</dt>
            <dd>{value(turn.durationMs, ' ms')}</dd>
            <dt>Duración del proveedor</dt>
            <dd>{value(turn.usage.providerDurationMs, ' ms')}</dd>
            <dt>Carga / evaluación del proveedor</dt>
            <dd>
              {value(turn.usage.loadDurationMs, ' ms')} /{' '}
              {value(turn.usage.evaluationDurationMs, ' ms')}
            </dd>
            <dt>Revisión observada en catálogo</dt>
            <dd>{turn.catalogRevision ?? 'Desconocida'}</dd>
            <dt>Coste reportado</dt>
            <dd>{value(turn.usage.costUsd, ' USD')}</dd>
            <dt>Motivo de finalización</dt>
            <dd>{turn.finishReason ?? 'Desconocido'}</dd>
          </dl>
          {turn.cancelMode === 'connection_closed' && (
            <p>
              Se ha cerrado la conexión. Confirmación de parada remota:{' '}
              {turn.remoteCancellationConfirmed === null
                ? 'Desconocida'
                : String(turn.remoteCancellationConfirmed)}
              . El proveedor puede haber seguido procesando; el coste final no está confirmado.
            </p>
          )}
        </details>
      </div>
    </article>
  );
}
function ConversationEditor({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState(''),
    [provider, setProvider] = useState<AiProvider>('ollama'),
    [model, setModel] = useState(''),
    [maxTokens, setMaxTokens] = useState(1024);
  const catalog = chatApi.useAiModelsQuery({ projectId, provider });
  const [create, creation] = chatApi.useCreateConversationMutation();
  const [validation, setValidation] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = conversationInput.safeParse({
      title,
      provider,
      model,
      configuration: { maxOutputTokens: maxTokens },
    });
    if (!parsed.success) {
      setValidation('Revisa el título, el modelo y el límite de salida (1–4096).');
      return;
    }
    try {
      const result = await create({ projectId, body: parsed.data }).unwrap();
      onCreated(result.conversation.id);
    } catch {}
  }
  return (
    <form className="conversation-editor" onSubmit={(event) => void submit(event)}>
      <h3>Nueva conversación</h3>
      <label>
        Título
        <input
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={creation.isLoading}
        />
      </label>
      <label>
        Proveedor
        <select
          aria-label="Proveedor"
          value={provider}
          disabled={creation.isLoading}
          onChange={(event) => {
            setProvider(event.target.value as AiProvider);
            setModel('');
          }}
        >
          <option value="ollama">Ollama local</option>
          <option value="openai">OpenAI API</option>
        </select>
      </label>
      <p>
        {provider === 'ollama'
          ? 'Los mensajes se envían al servidor Ollama local configurado. No se usa una API externa como alternativa.'
          : 'Los mensajes de esta conversación se enviarán a OpenAI.'}{' '}
        El proveedor y modelo quedan fijos al crearla.
      </p>
      <label>
        Modelo
        <select
          aria-label="Modelo"
          value={model}
          disabled={catalog.isFetching || creation.isLoading}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">Seleccionar modelo</option>
          {!catalog.error &&
            catalog.currentData?.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
        </select>
      </label>
      {catalog.isFetching && <p role="status">Consultando modelos…</p>}
      {(catalog.error || catalog.currentData?.error) && (
        <p className="form-error" role="alert">
          {catalog.currentData?.error?.message ?? errorMessage(catalog.error)}
        </p>
      )}
      <button
        className="text-button"
        type="button"
        disabled={catalog.isFetching}
        onClick={() => void catalog.refetch()}
      >
        Actualizar modelos
      </button>
      <label>
        Máximo de tokens de salida
        <input
          type="number"
          min={1}
          max={4096}
          value={maxTokens}
          onChange={(event) => setMaxTokens(Number(event.target.value))}
          disabled={creation.isLoading}
        />
      </label>
      {(validation || creation.error) && (
        <p className="form-error" role="alert">
          {validation || errorMessage(creation.error)}
        </p>
      )}
      <button
        className="primary-button"
        disabled={creation.isLoading || !model || !catalog.currentData?.available}
      >
        {creation.isLoading ? 'Creando…' : 'Crear conversación'}
      </button>
    </form>
  );
}
function Chat({ project, id }: { project: Project; id: string }) {
  const [repositoryContext, setRepositoryContext] = useState(false);
  const result = chatApi.useConversationQuery(
    { projectId: project.id, id },
    { pollingInterval: 3000, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  const [content, setContent] = useState(''),
    [live, setLive] = useState<ChatTurn | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [cancel, cancelling] = chatApi.useCancelGenerationMutation();
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const conversation = result.currentData?.conversation;
  const turns = result.currentData?.turns ?? [];
  const active =
    live?.status === 'streaming' ? live : turns.find((turn) => turn.status === 'streaming');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !content.trim() || sending || active) return;
    const controller = new AbortController();
    abort.current = controller;
    setSending(true);
    setError(null);
    const text = content;
    let accepted = false;
    try {
      await streamTurn(
        project.id,
        id,
        {
          content: text,
          requestId: crypto.randomUUID(),
          version: conversation.version,
          repositoryContext,
        },
        controller.signal,
        (event) => {
          if (!mounted.current) return;
          if (event.type === 'started') {
            accepted = true;
            setContent('');
            setLive(event.turn);
          } else if (event.type === 'delta')
            setLive((previous) =>
              previous ? { ...previous, response: previous.response + event.text } : previous,
            );
          else if (event.type === 'done') setLive(event.turn);
          else setError({ data: { error: { message: event.message } } });
        },
      );
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        setError(failure);
        if (typeof failure === 'object' && failure && 'status' in failure && failure.status === 401)
          dispatch(workspaceUi.actions.sessionExpired());
        if (!accepted) setContent(text);
      }
    } finally {
      if (mounted.current) {
        setSending(false);
        dispatch(chatApi.util.invalidateTags(['Conversation']));
        void result.refetch();
      }
      abort.current = null;
    }
  }
  if (result.isLoading) return <p role="status">Cargando conversación…</p>;
  if (result.error || !conversation)
    return (
      <p className="form-error" role="alert">
        {errorMessage(result.error)}
      </p>
    );
  const displayed =
    live && !turns.some((turn) => turn.id === live.id)
      ? [...turns, live]
      : turns.map((turn) => (turn.id === live?.id && sending ? live : turn));
  return (
    <section className="chat-view" aria-label="Conversación">
      <h3>{conversation.title}</h3>
      <p>
        {conversation.provider === 'ollama' ? 'Ollama local' : 'OpenAI API'} · {conversation.model}{' '}
        · Límite {conversation.configuration.maxOutputTokens} tokens
      </p>
      <p className="chat-context-note">
        Se envían los turnos completados sin fuentes de esta conversación. El contexto GitHub se
        incorpora solo al activar su casilla y requiere un índice actualizado.
      </p>
      <div
        className="chat-history"
        role="log"
        aria-label="Mensajes"
        aria-live="polite"
        aria-relevant="additions"
      >
        {displayed.length ? (
          displayed.map((turn) => <Turn key={turn.id} turn={turn} />)
        ) : (
          <p>Envía el primer mensaje para empezar.</p>
        )}
      </div>
      {(error || cancelling.error) && (
        <p className="form-error" role="alert">
          {errorMessage(error ?? cancelling.error)}
        </p>
      )}
      {project.archivedAt && (
        <p className="read-only-note">
          Proyecto archivado: historial en solo lectura. Puedes cancelar una generación que siga
          activa.
        </p>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label className="context-option">
          <input
            type="checkbox"
            checked={repositoryContext}
            disabled={sending || !!active || !!project.archivedAt}
            onChange={(event) => setRepositoryContext(event.target.checked)}
          />{' '}
          Usar contexto del repositorio
        </label>
        {repositoryContext && (
          <p>
            Se enviarán hasta cinco fragmentos al proveedor de esta conversación
            {conversation.provider === 'openai' ? ' (OpenAI externo)' : ' (Ollama local)'}. Los
            turnos previos con fuentes no se reenvían: cada pregunta recupera evidencia actual.
          </p>
        )}
        <label>
          Mensaje
          <textarea
            rows={4}
            required
            maxLength={12000}
            value={content}
            disabled={!!project.archivedAt || sending || !!active}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <div className="github-actions">
          <button
            className="primary-button"
            disabled={!!project.archivedAt || sending || !!active || !content.trim()}
          >
            Enviar mensaje
          </button>
          {active && (
            <button
              type="button"
              className="secondary-button"
              disabled={cancelling.isLoading || active.cancelRequested}
              onClick={() =>
                void cancel({ projectId: project.id, conversationId: id, turnId: active.id })
                  .unwrap()
                  .catch(() => {})
              }
            >
              {cancelling.isLoading || active.cancelRequested
                ? 'Cancelando…'
                : 'Cancelar generación'}
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setLive(null);
              void result.refetch();
            }}
          >
            Actualizar historial
          </button>
        </div>
      </form>
    </section>
  );
}
export function ProjectConversations({ project }: { project: Project }) {
  const list = chatApi.useConversationsQuery(project.id, { refetchOnFocus: true });
  const [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  return (
    <section className="project-conversations">
      <div className="workspace-page-heading">
        <div>
          <h2>Conversaciones</h2>
          <p>Mensajes persistentes, separados por proyecto y proveedor.</p>
        </div>
        <button
          className="primary-button"
          disabled={!!project.archivedAt}
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
        >
          Nueva conversación
        </button>
      </div>
      {list.error && (
        <p className="form-error" role="alert">
          {errorMessage(list.error)}
        </p>
      )}
      <RepositoryContext project={project} />
      <div className="conversations-layout">
        <nav aria-label="Conversaciones del proyecto">
          {list.isLoading && <p role="status">Cargando conversaciones…</p>}
          {list.currentData?.conversations.map((item) => (
            <button
              className="conversation-choice"
              aria-pressed={selected === item.id}
              key={item.id}
              onClick={() => {
                setSelected(item.id);
                setCreating(false);
              }}
            >
              <strong>{item.title}</strong>
              <small>
                {item.provider} · {item.model}
              </small>
            </button>
          ))}
        </nav>
        <div>
          {creating ? (
            <ConversationEditor
              projectId={project.id}
              onCreated={(id) => {
                setSelected(id);
                setCreating(false);
              }}
            />
          ) : selected ? (
            <Chat key={selected} project={project} id={selected} />
          ) : (
            <p>Selecciona una conversación o crea una nueva.</p>
          )}
        </div>
      </div>
    </section>
  );
}
