import { useId, useRef, useState } from 'react';
import type { z } from 'zod';
import type { codingRunSchema, codingReview } from '@ferweb/contracts';
import { codingApi } from './coding-store';
import { errorMessage } from './workspace-store';
import { DimensionalReviewPanel } from './DimensionalReviewPanel';

type Run = z.infer<typeof codingRunSchema>;
type Review = z.infer<typeof codingReview>;
export function CodingReview({
  project,
  run,
  publicationAvailable,
}: {
  project: string;
  run: Run;
  publicationAvailable: boolean;
}) {
  const query = codingApi.useCodingReviewQuery(
    { project, id: run.jobId },
    { refetchOnFocus: true, pollingInterval: 1500, skipPollingIfUnfocused: true },
  );
  return (
    <section aria-label="Revisión y pull request">
      <h4>Revisión y pull request</h4>
      {query.isLoading && <p role="status">Cargando revisión…</p>}
      {query.error ? (
        <p role="alert">{errorMessage(query.error)}</p>
      ) : (
        query.currentData && (
          <>
            <DimensionalReviewPanel
              project={project}
              run={run}
              reviews={query.currentData.dimensions}
            />
            {publicationAvailable && !run.teamExecutionId && (
              <ReviewEditor
                key={`${run.jobId}:${query.currentData.review?.version ?? 0}:${query.currentData.review?.state ?? ''}:${query.currentData.review?.approved}:${query.currentData.dimensions[0]?.executionId}:${query.currentData.dimensions[0]?.state}`}
                project={project}
                run={run}
                review={query.currentData.review}
                blocked={
                  !!query.currentData.dimensions[0] &&
                  query.currentData.dimensions[0].state !== 'complete'
                }
              />
            )}
          </>
        )
      )}
    </section>
  );
}
function ReviewEditor({
  project,
  run,
  review,
  blocked,
}: {
  project: string;
  run: Run;
  review: Review | null;
  blocked: boolean;
}) {
  const formId = useId();
  const [title, setTitle] = useState(review?.title ?? String(run.task.title ?? '').slice(0, 200)),
    [body, setBody] = useState(
      review?.body ??
        `${run.report?.summary ?? ''}\n\nPruebas: revisar resultados del controlador y criterios de aceptación.\n\nLimitaciones:\n${run.report?.limitations.join('\n') ?? ''}`.slice(
          0,
          20000,
        ),
    ),
    [branch, setBranch] = useState(
      review?.branch ?? `ferweb/task-${String(run.task.id).slice(0, 8)}-${run.jobId}`,
    ),
    [notes, setNotes] = useState(review?.notes ?? ''),
    [approved, setApproved] = useState(review?.approved ?? false),
    [dirty, setDirty] = useState(false);
  const [save, saving] = codingApi.useSaveCodingReviewMutation(),
    [publish, publishing] = codingApi.usePublishCodingReviewMutation();
  const locked = !!review?.attemptedAt,
    busy = saving.isLoading || publishing.isLoading;
  return (
    <>
      <p className="job-id">
        Rama base: {run.baseBranch ?? 'No registrada'} · commit {run.commit}
      </p>
      <p>
        La PR se publica como borrador tras una revisión humana. Comprueba los cambios, las pruebas
        y estos criterios congelados:
      </p>
      <ul>
        {(Array.isArray(run.task.acceptanceCriteria) ? run.task.acceptanceCriteria : []).map(
          (c, i) => (
            <li key={i}>{String(c)}</li>
          ),
        )}
      </ul>
      <form
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            project,
            id: run.jobId,
            body: { version: review?.version ?? 0, title, body, branch, notes, approved },
          })
            .unwrap()
            .then(() => setDirty(false))
            .catch(() => {});
        }}
      >
        <fieldset disabled={busy || locked}>
          <legend>Preparar propuesta</legend>
          <label>
            Título de la PR
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label htmlFor={`${formId}-body`}>Descripción de la PR</label>
          <textarea
            id={`${formId}-body`}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <label>
            Rama de la PR
            <input
              required
              maxLength={180}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </label>
          <small>
            Debe empezar por ferweb/ y terminar en -{run.jobId}. No se sobrescriben ramas ajenas.
          </small>
          <label htmlFor={`${formId}-notes`}>Valoración humana y limitaciones</label>
          <textarea
            id={`${formId}-notes`}
            maxLength={10000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              disabled={blocked}
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            He revisado el diff, los resultados de pruebas y los criterios de aceptación.
          </label>
          <button type="submit">
            {saving.isLoading ? 'Guardando revisión…' : 'Guardar revisión y borrador'}
          </button>
        </fieldset>
      </form>
      {review && (
        <p role="status">
          Revisión guardada · versión {review.version} ·{' '}
          {review.state === 'published'
            ? 'PR publicada'
            : review.state === 'publishing'
              ? 'Publicación en curso'
              : review.state === 'failed'
                ? 'Publicación pendiente de reintento'
                : 'Preparada'}
        </p>
      )}
      {locked && review?.state !== 'published' && (
        <p>
          Las condiciones están congeladas. Reintentar recupera la misma rama y PR; una reserva
          interrumpida caduca a los tres minutos.
        </p>
      )}
      {review?.errorCode && (
        <p role="alert">
          Último intento: {review.errorCode}.{' '}
          {review.errorCode === 'review_base_changed'
            ? 'La base cambió: sincroniza y crea una nueva ejecución desde la tarea.'
            : 'Revisa el estado remoto. Reintentar conserva esta rama y propuesta; no se sobrescriben cambios ajenos.'}
        </p>
      )}
      {review?.state === 'published' ? (
        <>
          <a href={review.pullUrl!} target="_blank" rel="noreferrer">
            Abrir PR #{review.pullNumber} en GitHub
          </a>
          {review.baseChanged && (
            <p role="alert">
              La base cambió durante la publicación. La PR requiere una nueva revisión sobre la base
              actual.
            </p>
          )}
        </>
      ) : (
        <button
          type="button"
          disabled={busy || dirty || blocked || !review?.approved}
          onClick={() => {
            if (review)
              void publish({ project, id: run.jobId, version: review.version })
                .unwrap()
                .catch(() => {});
          }}
        >
          {publishing.isLoading ? 'Publicando en GitHub…' : 'Publicar PR borrador en GitHub'}
        </button>
      )}
      {dirty && <p>Guarda los cambios de revisión antes de publicar.</p>}
      {(saving.error || publishing.error) && (
        <p role="alert">{errorMessage(saving.error || publishing.error)}</p>
      )}
    </>
  );
}
const known = (v: number | null | undefined) => v ?? 'Desconocido';
export function CodingComparison({
  project,
  id,
  onSelect,
}: {
  project: string;
  id: string;
  onSelect: (id: string) => void;
}) {
  const query = codingApi.useCodingComparisonsQuery({ project, id }, { refetchOnFocus: true }),
    caps = codingApi.useCodingCapabilitiesQuery(project),
    [repeat, repeating] = codingApi.useRepeatCodingMutation();
  const [model, setModel] = useState(''),
    [selected, setSelected] = useState(''),
    request = useRef(crypto.randomUUID());
  const runs = query.error ? [] : (query.currentData?.runs ?? []),
    other = runs.find((r) => r.jobId === selected);
  return (
    <section aria-label="Comparación de ejecuciones">
      <h4>Comparar ejecuciones de la tarea</h4>
      <p>
        Se conservan commit, archivos, tarea, criterios, imagen de herramientas y límites. Solo
        cambia el modelo al repetir. Calidad: revisión humana; uso y coste ausentes se mantienen
        desconocidos.
      </p>
      {query.isLoading && <p role="status">Cargando comparaciones…</p>}
      {(query.error || caps.error) && <p role="alert">{errorMessage(query.error || caps.error)}</p>}
      {!query.error && (
        <>
          <label>
            Modelo para repetir las mismas condiciones
            <select
              value={model || caps.currentData?.models[0] || ''}
              onChange={(e) => {
                setModel(e.target.value);
                request.current = crypto.randomUUID();
              }}
            >
              {caps.currentData?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={repeating.isLoading || !caps.currentData?.available || !!caps.error}
            onClick={() => {
              void repeat({
                project,
                id,
                body: {
                  requestId: request.current,
                  model: model || caps.currentData?.models[0] || '',
                },
              })
                .unwrap()
                .then((r) => {
                  request.current = crypto.randomUUID();
                  onSelect(r.job.id);
                })
                .catch(() => {});
            }}
          >
            Repetir con las mismas condiciones
          </button>
          <div className="comparison-scroll">
            <table>
              <caption>Resultados respecto a la ejecución seleccionada</caption>
              <thead>
                <tr>
                  <th>Ejecución / modelo</th>
                  <th>Condiciones</th>
                  <th>Duración</th>
                  <th>Tokens entrada / salida</th>
                  <th>Pruebas del controlador</th>
                  <th>Valoración humana</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.jobId}>
                    <td>
                      <button type="button" onClick={() => onSelect(r.jobId)}>
                        {r.configuration.model} · {r.jobId.slice(0, 8)}
                      </button>
                      <br />
                      {r.state}
                    </td>
                    <td>{r.comparable ? 'Iguales' : `Diferentes: ${r.differences.join(', ')}`}</td>
                    <td>{known(r.report?.durationMs)} ms</td>
                    <td>
                      {known(r.report?.providerUsage?.inputTokens)} /{' '}
                      {known(r.report?.providerUsage?.outputTokens)}
                    </td>
                    <td>
                      {r.report?.tests.length
                        ? r.report.tests.map((t, i) => (
                            <div key={i}>
                              {t.command}:{' '}
                              {t.exitCode === null
                                ? 'Desconocido'
                                : t.exitCode === 0
                                  ? 'Superada'
                                  : `Fallo ${t.exitCode}`}
                            </div>
                          ))
                        : 'Sin resultados'}
                    </td>
                    <td>
                      {r.review?.notes || 'Sin valoración'}
                      {r.review?.approved ? ' · Revisión aprobada' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.currentData?.truncated && (
            <p>Se muestran las veinte ejecuciones más recientes de esta tarea y repositorio.</p>
          )}
          <label>
            Contrastar diff y pruebas con otra ejecución
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Seleccionar ejecución</option>
              {runs
                .filter((r) => r.jobId !== id)
                .map((r) => (
                  <option key={r.jobId} value={r.jobId}>
                    {r.configuration.model} · {r.jobId.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          {other && (
            <div>
              <h5>Resultado de la otra ejecución</h5>
              <p>
                {other.comparable
                  ? 'Condiciones iguales.'
                  : `Condiciones diferentes: ${other.differences.join(', ')}`}
              </p>
              <p>{other.report?.summary || 'Sin resumen'}</p>
              {other.report?.diff.map((f) => (
                <details key={f.path}>
                  <summary>Comparación: {f.path}</summary>
                  <pre>{f.patch}</pre>
                </details>
              ))}
              {other.report?.tests.map((t, i) => (
                <details key={i}>
                  <summary>
                    {t.command} · salida {known(t.exitCode)}
                  </summary>
                  <pre>{t.output}</pre>
                </details>
              ))}
            </div>
          )}
        </>
      )}
      {repeating.error && <p role="alert">{errorMessage(repeating.error)}</p>}
    </section>
  );
}
