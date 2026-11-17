import { useRef, useState } from 'react';
import type { z } from 'zod';
import type { CanvasEntryInput, CanvasKind, canvasResponse } from '@ferweb/contracts';
import { canvasApi } from './canvas-store';
import { errorMessage } from './workspace-store';

const labels = {
  comment: 'Comentario',
  reply: 'Respuesta',
  request_changes: 'Cambios solicitados',
  approve: 'Aprobación',
};
type Scope = {
  project: string;
  kind: CanvasKind;
  id: string;
  archived: boolean;
  executed?: boolean;
};
type Review = z.infer<typeof canvasResponse>;

function ReviewContent({ scope, data }: { scope: Scope; data: Review }) {
  const [target, setTarget] = useState('overview');
  const [reply, setReply] = useState('');
  const [text, setText] = useState('');
  const [approve, setApprove] = useState(false);
  const [add, result] = canvasApi.useAddCanvasEntryMutation();
  const request = useRef<{ key: string; id: string } | null>(null);
  const { project, kind, id, archived, executed } = scope;
  async function submit(action: CanvasEntryInput['action']) {
    const fields = {
      hash: data.hash,
      element: target,
      action,
      ...(text.trim() && { text: text.trim() }),
      ...(action === 'reply' && { replyTo: reply }),
    };
    const key = JSON.stringify(fields);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      await add({ project, kind, id, body: { ...fields, requestId: request.current.id } }).unwrap();
      request.current = null;
      setReply('');
      setText('');
      setApprove(false);
    } catch {}
  }
  const chosen = data.elements.find((item) => item.id === target);
  const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
  const html = kind === 'diff' && chosen?.htmlDownload;
  return (
    <>
      <p className="skill-text">
        Versión {data.version} · {data.hash}
      </p>
      <p role="status">{data.decision ? labels[data.decision] : 'Pendiente de revisión'}</p>
      <label>
        Elemento de revisión
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setReply('');
            setApprove(false);
          }}
        >
          {data.elements.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {html && (
        <p>
          <a
            href={
              `/api/projects/${project}/canvas/diff/${id}/html-source?` +
              new URLSearchParams({ hash: data.hash, element: target })
            }
            download
          >
            Descargar fuente HTML como texto
          </a>
        </p>
      )}
      {data.entries.length === 0 && <p>Todavía no hay anotaciones.</p>}
      <ol className="canvas-entries">
        {data.entries.map((entry) => {
          const current = data.hash === entry.hash;
          return (
            <li key={entry.id}>
              <strong>
                {labels[entry.action]} ·{' '}
                {data.elements.find(({ id }) => id === entry.element)?.title ??
                  'Elemento de una copia anterior'}
              </strong>
              <small>
                {entry.author} ·{' '}
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              </small>
              {!current && <small className="skill-text">Evidencia anterior · {entry.hash}</small>}
              {entry.replyTo && (
                <small>
                  Respuesta a la anotación {byId.get(entry.replyTo)?.sequence ?? entry.replyTo}
                </small>
              )}
              {entry.text && <p className="skill-text">{entry.text}</p>}
              {!archived && current && (
                <button
                  type="button"
                  onClick={() => {
                    setTarget(entry.element);
                    setReply(entry.id);
                  }}
                >
                  Responder a la anotación {entry.sequence}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {!archived && (
        <form
          className="canvas-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(reply ? 'reply' : 'comment');
          }}
        >
          {reply && (
            <p>
              Respuesta a la anotación {byId.get(reply)?.sequence}{' '}
              <button type="button" onClick={() => setReply('')}>
                Cancelar respuesta
              </button>
            </p>
          )}
          <label>
            Texto de revisión
            <textarea
              rows={3}
              required
              maxLength={2000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="canvas-actions">
            <button type="submit" disabled={!text.trim() || result.isLoading}>
              {reply ? 'Guardar respuesta' : 'Añadir comentario'}
            </button>
            {!reply && !(kind === 'plan' && executed) && (
              <button
                type="button"
                disabled={!text.trim() || result.isLoading}
                onClick={() => void submit('request_changes')}
              >
                Solicitar cambios
              </button>
            )}
          </div>
          {kind !== 'plan' && !reply && (
            <div className="canvas-actions">
              <label className="canvas-confirm">
                <input
                  type="checkbox"
                  checked={approve}
                  onChange={(event) => setApprove(event.target.checked)}
                />
                He revisado esta evidencia
              </label>
              <button
                type="button"
                disabled={!approve || result.isLoading}
                onClick={() => void submit('approve')}
              >
                Registrar aprobación visual
              </button>
            </div>
          )}
          {result.error && <p role="alert">{errorMessage(result.error)}</p>}
        </form>
      )}
    </>
  );
}

export function ReviewCanvas(scope: Scope) {
  const [open, setOpen] = useState(false);
  const { project, kind, id } = scope;
  const query = canvasApi.useCanvasQuery(
    { project, kind, id },
    {
      skip: !open,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      pollingInterval: 6000,
      skipPollingIfUnfocused: true,
    },
  );
  const data = !query.error && query.currentData;
  return (
    <details className="review-canvas" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{kind === 'diff' ? 'Revisión visual del diff' : 'Revisión visual del plan'}</summary>
      {open && query.isLoading && <p role="status">Cargando revisión…</p>}
      {open && query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button type="button" onClick={() => void query.refetch()}>
            Reintentar revisión
          </button>
        </p>
      )}
      {open && data && <ReviewContent key={data.hash} scope={scope} data={data} />}
    </details>
  );
}
