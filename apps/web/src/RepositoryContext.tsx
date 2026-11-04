import { useState } from 'react';
import { indexResponse, retrievalResponse, type Project, type Source } from '@ferweb/contracts';
import { workspaceApi, errorMessage } from './workspace-store';

export const contextApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    contextStatus: builder.query<ReturnType<typeof indexResponse.parse>, string>({
      query: (project) => `/projects/${project}/context`,
      transformResponse: (data) => indexResponse.parse(data),
      providesTags: ['GitHub'],
      keepUnusedDataFor: 0,
    }),
    indexContext: builder.mutation<
      ReturnType<typeof indexResponse.parse> & { embeddedChunks: number; reusedDocuments: number },
      string
    >({
      query: (project) => ({
        url: `/projects/${project}/context/index`,
        method: 'POST',
        body: {},
        timeout: 660000,
      }),
      invalidatesTags: ['GitHub'],
    }),
    searchContext: builder.mutation<
      ReturnType<typeof retrievalResponse.parse>,
      { project: string; query: string }
    >({
      query: ({ project, query }) => ({
        url: `/projects/${project}/context/search`,
        method: 'POST',
        body: { query },
        timeout: 90000,
      }),
      transformResponse: (data) => retrievalResponse.parse(data),
    }),
  }),
});
export function Sources({ sources }: { sources: Source[] }) {
  return (
    <ol className="context-sources">
      {sources.map((source, i) => {
        const repo = source.repository.split('/').map(encodeURIComponent).join('/');
        const url =
          source.kind === 'file'
            ? `https://github.com/${repo}/blob/${source.commit}/${source.path.split('/').map(encodeURIComponent).join('/')}#L${source.startLine}-L${source.endLine}`
            : `https://github.com/${repo}/${source.path}`;
        return (
          <li key={source.id}>
            <strong>[F{i + 1}] </strong>
            <a href={url} target="_blank" rel="noreferrer">
              {source.repository} · {source.path}
            </a>
            <small>
              Commit {source.commit} · líneas {source.startLine}–{source.endLine}
              {source.observedAt
                ? ` · incidencia/PR observada ${source.observedAt} (no versionada por commit)`
                : ''}
            </small>
            <details>
              <summary>Ver fragmento utilizado</summary>
              <pre>{source.excerpt}</pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
export function RepositoryContext({ project }: { project: Project }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const status = contextApi.useContextStatusQuery(project.id, {
    skip: !open,
    refetchOnFocus: true,
  });
  const [index, indexing] = contextApi.useIndexContextMutation(),
    [search, searching] = contextApi.useSearchContextMutation();
  const data = status.currentData;
  return (
    <details className="repository-context" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Contexto del repositorio</summary>
      <p>
        Embeddings exclusivamente locales con Ollama. Primero sincroniza el repositorio en la
        pestaña GitHub; después actualiza este índice. Se incluyen código, documentación,
        incidencias y PR admitidos por los permisos y exclusiones.
      </p>
      {status.isFetching && <p role="status">Consultando índice…</p>}
      {data && (
        <p role="status">
          {!data.available
            ? 'Sin índice'
            : data.stale
              ? 'Índice desactualizado'
              : 'Índice actualizado'}{' '}
          · {data.documents} documentos · {data.chunks} fragmentos
          <br />
          Commit: {data.commit ?? 'Desconocido'}
        </p>
      )}
      {data?.partial && (
        <p className="read-only-note">
          El snapshot de GitHub es parcial. Las fuentes no cubren todo el repositorio o todas sus
          incidencias.
        </p>
      )}
      {data && data.skipped.length > 0 && (
        <details>
          <summary>Archivos excluidos o no compatibles ({data.skipped.length})</summary>
          <ul>
            {data.skipped.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
      )}
      <button
        className="secondary-button"
        disabled={!!project.archivedAt || indexing.isLoading}
        onClick={() =>
          void index(project.id)
            .unwrap()
            .catch(() => {})
        }
      >
        {indexing.isLoading ? 'Actualizando índice…' : 'Actualizar índice de contexto'}
      </button>
      {indexing.data && (
        <p role="status">
          Última actualización: {indexing.data.embeddedChunks} embeddings nuevos;{' '}
          {indexing.data.reusedDocuments} documentos reutilizados.
        </p>
      )}
      {(status.error || indexing.error || searching.error) && (
        <p role="alert" className="form-error">
          {errorMessage(status.error ?? indexing.error ?? searching.error)}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search({ project: project.id, query })
            .unwrap()
            .catch(() => {});
        }}
      >
        <label>
          Pregunta para probar la recuperación
          <input
            value={query}
            maxLength={4000}
            onChange={(event) => setQuery(event.target.value)}
            required
          />
        </label>
        <button
          className="secondary-button"
          disabled={!query.trim() || searching.isLoading || !data?.available || data.stale}
        >
          {searching.isLoading ? 'Buscando…' : 'Buscar fuentes'}
        </button>
      </form>
      {searching.data &&
        (searching.data.insufficient ? (
          <p>No se han encontrado fuentes suficientes.</p>
        ) : (
          <Sources sources={searching.data.sources} />
        ))}
    </details>
  );
}
