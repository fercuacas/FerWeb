import { useRef, useState } from 'react';
import type { z } from 'zod';
import type { LabBatch, ContextMetrics, labOverviewSchema, AiProvider } from '@ferweb/contracts';
import { labApi } from './lab-store';
import { chatApi } from './chat-store';
import { errorMessage } from './workspace-store';
import { Sources } from './RepositoryContext';
const strategies = ['wide-v1', 'retrieval-v1', 'summary-v1', 'reuse-v1'] as const;
const names: Record<string, string> = {
  'wide-v1': 'Referencia amplia',
  'retrieval-v1': 'Fragmentos relevantes',
  'summary-v1': 'Recuperación + resumen',
  'reuse-v1': 'Resumen + reutilización',
};
const known = (v: number | null | undefined, s = '') =>
  v === null || v === undefined ? 'Desconocido' : `${Number(v.toPrecision(6))}${s}`;
function Failure({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="form-error">
      {errorMessage(error)}
    </p>
  ) : null;
}
export function ContextExperimentForm({
  project,
  overview,
  onCreated,
}: {
  project: string;
  overview: z.infer<typeof labOverviewSchema>;
  onCreated: (id: string) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>('ollama'),
    [model, setModel] = useState(''),
    [cases, setCases] = useState<string[]>([]),
    [repetitions, setRepetitions] = useState(2),
    [tariff, setTariff] = useState(''),
    [external, setExternal] = useState(false),
    [limit, setLimit] = useState(512);
  const catalog = chatApi.useAiModelsQuery({ projectId: project, provider }),
    [create, result] = labApi.useLabCreateBatchMutation(),
    request = useRef(crypto.randomUUID());
  return (
    <details>
      <summary>Comparar estrategias de contexto</summary>
      <form
        className="lab-form"
        onChange={() => {
          request.current = crypto.randomUUID();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void create({
            project,
            body: {
              requestId: request.current,
              title: 'Evaluación de contexto',
              caseIds: cases,
              repetitions,
              environment:
                'Comparación pareada de estrategias; condiciones observadas en el informe.',
              allowExternal: external,
              contextExperiment: 'ferweb-context-v1',
              targets: strategies.map((contextStrategy) => ({
                provider,
                model: model || catalog.currentData?.models[0]?.id || '',
                configuration: { maxOutputTokens: limit },
                tariffId: tariff || null,
                cacheLabel: 'unspecified' as const,
                contextStrategy,
              })),
            },
          })
            .unwrap()
            .then((r) => {
              onCreated(r.batch.id);
              request.current = crypto.randomUUID();
            })
            .catch(() => {});
        }}
      >
        <p>
          Usa casos existentes y un único proveedor/modelo. Congela el corpus indexado autorizado;
          máximo cinco casos, dos repeticiones completas de cinco casos y cuarenta intentos. Incluye
          llamadas de resumen y búsqueda. Guardar no ejecuta modelos.
        </p>
        <fieldset disabled={result.isLoading}>
          <legend>Casos de evaluación existentes</legend>
          {overview.cases.map((c) => (
            <label className="lab-check" key={c.id}>
              <input
                type="checkbox"
                checked={cases.includes(c.id)}
                onChange={(e) =>
                  setCases((v) => (e.target.checked ? [...v, c.id] : v.filter((id) => id !== c.id)))
                }
              />
              {c.title}
            </label>
          ))}
        </fieldset>
        <label>
          Proveedor de la evaluación
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as AiProvider);
              setModel('');
              setTariff('');
            }}
          >
            <option value="ollama">Ollama local</option>
            <option value="openai">OpenAI API</option>
          </select>
        </label>
        <label>
          Modelo común de contexto
          <select
            value={model || catalog.currentData?.models[0]?.id || ''}
            onChange={(e) => setModel(e.target.value)}
          >
            {catalog.currentData?.models.map((m) => (
              <option key={m.id}>{m.id}</option>
            ))}
          </select>
        </label>
        <label>
          Tarifa de la evaluación
          <select value={tariff} onChange={(e) => setTariff(e.target.value)}>
            <option value="">Sin tarifa: coste desconocido</option>
            {overview.tariffs
              .filter(
                (t) =>
                  t.provider === provider &&
                  t.model === (model || catalog.currentData?.models[0]?.id),
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.model} · {t.effectiveFrom}
                </option>
              ))}
          </select>
        </label>
        <label>
          Repeticiones de contexto
          <input
            type="number"
            required
            min={1}
            max={5}
            value={repetitions}
            onChange={(e) => setRepetitions(Number(e.target.value))}
          />
        </label>
        <label>
          Máximo de salida por respuesta
          <input
            type="number"
            required
            min={1}
            max={4096}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </label>
        <p>
          {cases.length * 4 * repetitions} intentos; hasta dos generaciones por intento y una
          búsqueda de embeddings. Resúmenes limitados a 512 tokens de salida. Sin reintentos
          automáticos. Se registran fallos y consumo desconocido.
        </p>
        {provider === 'openai' && (
          <label className="lab-check">
            <input
              type="checkbox"
              required
              checked={external}
              onChange={(e) => setExternal(e.target.checked)}
            />
            Autorizo enviar corpus, preguntas y resúmenes a OpenAI para esta evaluación.
          </label>
        )}
        <button
          className="primary-button"
          disabled={
            result.isLoading ||
            !catalog.currentData?.available ||
            !cases.length ||
            cases.length > 5 ||
            cases.length * 4 * repetitions > 40
          }
        >
          Guardar evaluación de contexto
        </button>
        <Failure error={result.error || catalog.error} />
      </form>
    </details>
  );
}
export function ContextOperations({ metrics }: { metrics: ContextMetrics }) {
  return (
    <details>
      <summary>
        Contabilidad de contexto · {names[metrics.strategy]} ({metrics.strategy})
      </summary>
      {metrics.sources.length > 0 && <Sources sources={metrics.sources} />}
      {metrics.simulated && (
        <p className="read-only-note">
          Medición simulada: valida integración y contabilidad; no demuestra ahorro real.
        </p>
      )}
      <p>
        Tiempo del recorrido de contexto: {known(metrics.elapsedMs, ' ms')}. Reutilización:{' '}
        {metrics.reuseStatus}. Ejecución de origen: {metrics.reusedFrom ?? 'No aplica'}.
      </p>
      <p>
        El consumo principal del proveedor no incluye por sí solo los resúmenes. Este registro
        conserva todas las llamadas observadas. Coste total de infraestructura y cargos no
        reportados: desconocido.
      </p>
      {metrics.operations.map((op) => (
        <details key={op.id}>
          <summary>
            {op.kind} · {op.status} · {known(op.durationMs, ' ms')}
          </summary>
          <p>
            Intento {op.attempt}. Entrada: {known(op.usage.inputTokens)}; salida:{' '}
            {known(op.usage.outputTokens)}; caché del proveedor: {known(op.usage.cachedTokens)}.
            Estimación parcial de texto: {known(op.estimatedTextCostUsd, ' USD')} ({op.costReason}).
          </p>
          {op.errorCode && <p>{op.errorCode}</p>}
          {op.reportedModel && <p>Modelo reportado: {op.reportedModel}</p>}
          {op.response && <pre>{op.response}</pre>}
          {op.messages && <pre>{JSON.stringify(op.messages, null, 2)}</pre>}
        </details>
      ))}
    </details>
  );
}
export function ContextComparison({ project, batch }: { project: string; batch: LabBatch }) {
  const result = labApi.useContextComparisonQuery(
      { project, id: batch.id },
      { pollingInterval: batch.status === 'running' ? 2000 : 0, refetchOnFocus: true },
    ),
    policy = labApi.useContextPolicyQuery(project),
    [adopt, adopting] = labApi.useAdoptContextMutation(),
    [reset, resetting] = labApi.useResetContextMutation();
  const [metric, setMetric] = useState<'latency' | 'generation_tokens' | 'text_cost'>('latency');
  const data = result.error ? undefined : result.currentData;
  return (
    <section aria-label="Antes y después del contexto">
      <h4>Antes y después del contexto</h4>
      <p>
        Referencia: wide-v1. Se comparan las mismas preguntas, fuentes, modelo y límites. Los tokens
        en caché siguen siendo tokens de entrada: su descuento se muestra separado de la reducción
        de tokens. Los costes desconocidos no se convierten en cero.
      </p>
      {result.isLoading && <p role="status">Cargando mediciones…</p>}
      <Failure error={result.error || policy.error || adopting.error || resetting.error} />
      {data && (
        <>
          <p role="status">
            {data.valid
              ? 'Corpus y configuración de fuentes vigentes.'
              : 'Resultados históricos invalidados para reutilización o adopción: prepara otra evaluación.'}
          </p>
          {data.report.simulated && (
            <p className="read-only-note">
              Datos simulados: adopción bloqueada. No se ha medido ahorro real de IA.
            </p>
          )}
          <div className="lab-table-wrap">
            <table>
              <caption>Calidad, consumo y latencia antes/después</caption>
              <thead>
                <tr>
                  <th>Estrategia</th>
                  <th>Calidad revisada</th>
                  <th>Tokens nuevos de resumen + respuesta</th>
                  <th>Diferencia frente a referencia</th>
                  <th>Tokens leídos de caché del proveedor</th>
                  <th>Latencia total</th>
                  <th>Costes y auxiliares</th>
                  <th>Reutilización</th>
                </tr>
              </thead>
              <tbody>
                {data.report.rows.map((r) => (
                  <tr key={r.target}>
                    <td>
                      {names[r.strategy ?? '']}
                      <br />
                      {r.strategy}
                    </td>
                    <td>
                      {r.reviewed}/{r.attempts} revisados · {r.accepted} aceptables
                      <br />
                      Calidad: {known(r.meanQuality)}
                    </td>
                    <td>{known(r.generationTokens)}</td>
                    <td>
                      {known(r.generationTokenDelta)} tokens
                      <br />
                      {known(
                        r.tokenReductionRatio === null ? null : r.tokenReductionRatio * 100,
                        '%',
                      )}{' '}
                      {data.report.simulated ? '(simulado)' : ''}
                    </td>
                    <td>
                      {known(r.providerCachedTokens)}
                      <br />
                      Descuento de lectura estimado:{' '}
                      {known(r.estimatedCacheReadDiscountUsd, ' USD')} (parcial)
                    </td>
                    <td>
                      {known(r.latencyMs, ' ms')}
                      <br />
                      Referencia: {known(r.baselineLatencyMs, ' ms')}
                    </td>
                    <td>
                      Total: {known(r.totalCostUsd, ' USD')}
                      <br />
                      Texto de todas las operaciones: {known(r.estimatedTextCostUsd, ' USD')}
                      <br />
                      Subtotal conocido: {known(r.knownTextCostSubtotalUsd, ' USD')}
                      <br />
                      {r.auxiliaryCalls} auxiliares; {r.summaryCalls} resúmenes
                    </td>
                    <td>
                      {r.resultCacheHits} aciertos
                      <br />
                      Coste de creación:{' '}
                      {r.creationCostsIncluded ? 'incluido en la serie' : 'falta origen'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Los embeddings no reportados impiden conocer el consumo y coste global completos. La
            diferencia de tokens mide todas las generaciones, incluidos resúmenes, sin restar tokens
            de caché. El subtotal conocido no es una factura ni un ahorro total.
          </p>
          <label>
            Medida para adoptar
            <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
              <option value="latency">Latencia observada completa</option>
              <option value="generation_tokens">Tokens de todas las generaciones</option>
              <option value="text_cost">Coste de texto de todas las operaciones</option>
            </select>
          </label>
          <p>
            Adopción explícita: al menos dos casos y dos repeticiones, revisión humana completa,
            ninguna regresión de calidad por pareja y mejora medida de al menos el 5 %. No es prueba
            de superioridad general.
          </p>
          {data.report.rows.slice(1).map((r) => (
            <div key={r.target}>
              <button
                className="secondary-button"
                disabled={
                  !data.valid ||
                  data.report.simulated ||
                  adopting.isLoading ||
                  !!policy.error ||
                  batch.status !== 'completed'
                }
                onClick={() =>
                  void adopt({
                    project,
                    body: {
                      batchId: batch.id,
                      target: r.target,
                      metric,
                      version: policy.currentData?.version ?? 0,
                    },
                  })
                    .unwrap()
                    .catch(() => {})
                }
              >
                Adoptar {r.strategy}
              </button>
              <small>
                Comprobación por latencia:{' '}
                {data.adoption[r.target]?.eligible
                  ? 'cumple'
                  : data.adoption[r.target]?.reasons.join(', ')}
              </small>
            </div>
          ))}
        </>
      )}
      {policy.currentData?.policy && (
        <>
          <p>
            Política del proyecto: {policy.currentData.policy.strategy} · versión{' '}
            {policy.currentData.version}. Se aplica al chat con contexto solo para el
            modelo/configuración evaluados; cualquier invalidación exige reevaluación.
          </p>
          <button
            className="secondary-button"
            disabled={resetting.isLoading}
            onClick={() =>
              void reset({ project, version: policy.currentData!.version })
                .unwrap()
                .catch(() => {})
            }
          >
            Restablecer contexto habitual
          </button>
        </>
      )}
    </section>
  );
}
