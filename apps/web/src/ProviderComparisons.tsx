import { useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import type { Project, ProviderComparison, ProviderComparisonInput } from '@ferweb/contracts';
import { labApi } from './lab-store';
import { errorMessage } from './workspace-store';

const differences = {
  task: 'tarea, versión o criterios',
  sources: 'repositorio, commit o fuentes',
  tools: 'imagen, perfil o versión de herramientas',
  context: 'contexto, memoria, rol o skills',
  limits: 'presupuesto o límites',
  simulation: 'evidencia real o simulada',
};
const states = { completed: 'Finalizado', failed: 'Fallido', cancelled: 'Cancelado' };
const grades = {
  passed: 'Superada',
  failed: 'Fallida',
  unverifiable: 'Sin verificar',
  not_run: 'Sin ejecutar',
};
const metric = (value: number | null | undefined) => value ?? 'Desconocido';

function Arm({ title, arm }: { title: string; arm: ProviderComparison['evidence']['api'] }) {
  return (
    <article className="lab-run skill-text">
      <h4>{title}</h4>
      <p>
        {states[arm.state]} ·{' '}
        {arm.simulated === null ? 'Evidencia desconocida' : arm.simulated ? 'Simulado' : 'Real'}
      </p>
      {arm.errorCode && <p>{arm.errorCode}</p>}
      <p>
        {arm.model} · Revisión {arm.modelRevision ?? 'desconocida'}
      </p>
      {arm.reportedModel && <p>Modelo reportado {arm.reportedModel}</p>}
      <p>
        Codex {arm.cliVersion ?? 'desconocido'}
        {arm.destination === 'codex-local-v1' && ` · Ollama ${arm.serverVersion ?? 'desconocido'}`}
      </p>
      <p>
        Tiempo total (ms) {metric(arm.elapsedMs)} · Peticiones {metric(arm.requests)} de{' '}
        {arm.maxRequests}
      </p>
      <p>
        Tokens de entrada {metric(arm.usage?.inputTokens)} · Salida{' '}
        {metric(arm.usage?.outputTokens)}
      </p>
      {arm.usage && (
        <p>
          Uso reportado en {arm.usage.reportedRequests} de {arm.usage.totalRequests} peticiones.
        </p>
      )}
      <p>Coste total desconocido.</p>
      <p>Fixture {grades[arm.grade.status]}</p>
      <p>
        Pruebas del controlador{' '}
        {arm.independentTests.length
          ? arm.independentTests
              .map(({ exitCode }) =>
                exitCode === 0 ? 'superada' : exitCode === null ? 'sin resultado' : 'fallida',
              )
              .join(', ')
          : 'sin evidencia'}
      </p>
    </article>
  );
}

export function ProviderComparisons({ project }: { project: Project }) {
  const list = labApi.useProviderComparisonsQuery(project.id, { refetchOnFocus: true });
  const [draft, setDraft] = useState<ProviderComparisonInput>({
    apiId: '',
    localId: '',
    case: 'recorded',
  });
  const [selected, setSelected] = useState('');
  const [compare, result] = labApi.useCompareProvidersMutation();
  const detail = labApi.useProviderComparisonQuery(
    selected ? { project: project.id, id: selected } : skipToken,
    { refetchOnFocus: true, refetchOnMountOrArgChange: true },
  );
  const data = list.error ? undefined : list.currentData;
  const saved = detail.error ? undefined : detail.currentData;
  return (
    <details className="lab-editor">
      <summary>Comparación Codex API y Ollama local</summary>
      <section aria-label="Comparación Codex API y Ollama local">
        <p>
          Elige dos trabajos individuales ya terminados. La comparación usa sus fuentes y
          condiciones guardadas.
        </p>
        {list.isLoading && <p role="status">Cargando trabajos…</p>}
        {list.error && (
          <p role="alert">
            {errorMessage(list.error)}{' '}
            <button onClick={() => void list.refetch()}>Reintentar</button>
          </p>
        )}
        {data && (!data.api.length || !data.local.length) && (
          <p>Hace falta un trabajo de cada destino para comparar.</p>
        )}
        {data && !project.archivedAt && !!data.api.length && !!data.local.length && (
          <form
            className="lab-form"
            onSubmit={(event) => {
              event.preventDefault();
              const { localHardware, ...fields } = draft;
              void compare({
                project: project.id,
                body: {
                  ...fields,
                  ...(localHardware?.trim() && { localHardware: localHardware.trim() }),
                },
              })
                .unwrap()
                .then(({ id }) => {
                  setSelected(id);
                })
                .catch(() => {});
            }}
          >
            <label>
              Trabajo Codex API
              <select
                required
                value={draft.apiId}
                onChange={(event) => setDraft({ ...draft, apiId: event.target.value })}
              >
                <option value="">Elige un trabajo</option>
                {data.api.map((run) => (
                  <option value={run.id} key={run.id}>
                    {run.title} · {states[run.state]} · {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trabajo Codex local
              <select
                required
                value={draft.localId}
                onChange={(event) => setDraft({ ...draft, localId: event.target.value })}
              >
                <option value="">Elige un trabajo</option>
                {data.local.map((run) => (
                  <option value={run.id} key={run.id}>
                    {run.title} · {states[run.state]} · {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Caso de comparación API/local
              <select
                value={draft.case}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    case: event.target.value as ProviderComparisonInput['case'],
                  })
                }
              >
                <option value="recorded">Informes registrados</option>
                <option value="addition-v1">Fixture de suma v1</option>
              </select>
            </label>
            <label>
              Hardware local observado (opcional)
              <input
                maxLength={240}
                value={draft.localHardware ?? ''}
                onChange={(event) => setDraft({ ...draft, localHardware: event.target.value })}
              />
            </label>
            <button disabled={result.isLoading || !draft.apiId || !draft.localId}>
              Guardar comparación API/local
            </button>
          </form>
        )}
        {result.error && <p role="alert">{errorMessage(result.error)}</p>}
        {data && !!data.comparisons.length && (
          <label>
            Comparaciones API/local guardadas
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Abrir comparación</option>
              {data.comparisons.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.createdAt).toLocaleString()} · {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        {detail.isFetching && <p role="status">Consultando la evidencia guardada…</p>}
        {detail.error && (
          <p role="alert">
            {errorMessage(detail.error)}{' '}
            <button onClick={() => void detail.refetch()}>Reintentar comparación</button>
          </p>
        )}
        {saved && (
          <section aria-label="Evidencia API y local">
            <h3>
              {saved.evidence.comparable
                ? 'Condiciones registradas equivalentes'
                : 'Condiciones registradas diferentes'}
            </h3>
            {!!saved.evidence.differences.length && (
              <ul>
                {saved.evidence.differences.map((item) => (
                  <li key={item}>{differences[item]}</li>
                ))}
              </ul>
            )}
            <p className="skill-text">
              Hardware local{' '}
              {saved.evidence.localHardware
                ? `declarado: ${saved.evidence.localHardware}`
                : 'desconocido'}
              .
            </p>
            <div className="job-grid">
              <Arm title="Codex API" arm={saved.evidence.api} />
              <Arm title="Codex local" arm={saved.evidence.local} />
            </div>
            <a
              href={`/api/projects/${project.id}/lab/provider-comparisons/${saved.id}/export`}
              download
            >
              Exportar comparación API/local JSON
            </a>
          </section>
        )}
      </section>
    </details>
  );
}
