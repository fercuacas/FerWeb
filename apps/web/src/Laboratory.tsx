import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type {
  Project,
  LabCase,
  LabBatch,
  LabRun,
  LabTariff,
  labTargetInput,
  labOverviewSchema,
} from '@ferweb/contracts';
import { labApi } from './lab-store';
import { chatApi } from './chat-store';
import { errorMessage } from './workspace-store';
import { Sources } from './RepositoryContext';
import './laboratory.css';
import { ContextExperimentForm, ContextComparison, ContextOperations } from './ContextStrategies';

type Overview = z.infer<typeof labOverviewSchema>;
const metric = (value: number | null, suffix = '') =>
  value === null ? 'Desconocido' : `${Number(value.toPrecision(6))}${suffix}`;
const states: Record<string, string> = {
  draft: 'Preparado',
  running: 'En ejecución',
  completed: 'Finalizado',
  error: 'Error',
  incomplete: 'Incompleto',
  cancelled: 'Cancelado',
  interrupted: 'Interrumpido',
  skipped: 'Omitido',
  pending: 'Pendiente',
};
function Failure({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="form-error">
      {errorMessage(error)}
    </p>
  ) : null;
}
function CaseEditor({ project }: { project: string }) {
  const [title, setTitle] = useState(''),
    [question, setQuestion] = useState(''),
    [context, setContext] = useState(''),
    [repository, setRepository] = useState(false),
    [criteria, setCriteria] = useState([{ description: '', expectedText: '' }]);
  const [create, result] = labApi.useLabCreateCaseMutation();
  return (
    <details>
      <summary>Nuevo caso congelado</summary>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create({
            project,
            body: { title, question, context, repositoryContext: repository, criteria },
          })
            .unwrap()
            .then(() => {
              setTitle('');
              setQuestion('');
              setContext('');
            })
            .catch(() => {});
        }}
      >
        <p>
          El caso es inmutable. Para cambiar sus condiciones crea otro. Los criterios no se envían a
          los modelos.
        </p>
        <label>
          Nombre del caso
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Pregunta del caso
          <textarea
            required
            maxLength={4000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
          />
        </label>
        <label>
          Contexto manual congelado
          <textarea
            maxLength={20000}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
          />
        </label>
        <label className="lab-check">
          <input
            type="checkbox"
            checked={repository}
            onChange={(e) => setRepository(e.target.checked)}
          />{' '}
          Congelar también fuentes del repositorio
        </label>
        {criteria.map((criterion, i) => (
          <fieldset key={i}>
            <legend>Criterio {i + 1}</legend>
            <label>
              Criterio de evaluación {i + 1}
              <input
                required
                maxLength={500}
                value={criterion.description}
                onChange={(e) =>
                  setCriteria((values) =>
                    values.map((v, n) => (n === i ? { ...v, description: e.target.value } : v)),
                  )
                }
              />
            </label>
            <label>
              Texto esperado {i + 1} (opcional)
              <input
                maxLength={300}
                value={criterion.expectedText}
                onChange={(e) =>
                  setCriteria((values) =>
                    values.map((v, n) => (n === i ? { ...v, expectedText: e.target.value } : v)),
                  )
                }
              />
            </label>
          </fieldset>
        ))}
        <div className="lab-actions">
          <button
            type="button"
            className="text-button"
            disabled={criteria.length >= 10}
            onClick={() =>
              setCriteria((values) => [...values, { description: '', expectedText: '' }])
            }
          >
            Añadir criterio
          </button>
          <button className="primary-button" disabled={result.isLoading}>
            {result.isLoading ? 'Congelando…' : 'Guardar caso congelado'}
          </button>
        </div>
        <Failure error={result.error} />
        {result.isSuccess && <p role="status">Caso congelado guardado.</p>}
      </form>
    </details>
  );
}
function TariffEditor({ project }: { project: string }) {
  const [create, result] = labApi.useLabCreateTariffMutation();
  return (
    <details>
      <summary>Registrar tarifa fechada</summary>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void create({
            project,
            body: {
              provider: data.get('provider') as 'openai' | 'ollama',
              model: String(data.get('model')),
              effectiveFrom: String(data.get('from')),
              effectiveTo: data.get('to') ? String(data.get('to')) : null,
              verifiedOn: String(data.get('verified')),
              source: String(data.get('source')),
              inputPerMillion: Number(data.get('input')),
              cachedInputPerMillion: Number(data.get('cached')),
              outputPerMillion: Number(data.get('output')),
              notes: String(data.get('notes')),
            },
          })
            .unwrap()
            .catch(() => {});
        }}
      >
        <p>
          USD por millón de tokens. Estimación parcial de texto, sin impuestos, herramientas,
          escrituras de caché, energía ni hardware. No son tarifas verificadas automáticamente;
          tampoco se supone coste cero para Ollama.
        </p>
        <label>
          Proveedor de tarifa
          <select name="provider">
            <option value="ollama">Ollama local</option>
            <option value="openai">OpenAI API</option>
          </select>
        </label>
        <label>
          Modelo exacto de tarifa
          <input name="model" required maxLength={200} />
        </label>
        <div className="lab-grid">
          <label>
            Vigente desde
            <input type="date" name="from" required />
          </label>
          <label>
            Vigente hasta (opcional)
            <input type="date" name="to" />
          </label>
          <label>
            Verificada el
            <input type="date" name="verified" required />
          </label>
        </div>
        <label>
          Fuente de la tarifa (HTTPS)
          <input type="url" name="source" required pattern="https://.*" />
        </label>
        <div className="lab-grid">
          {[
            ['input', 'Entrada'],
            ['cached', 'Entrada en caché'],
            ['output', 'Salida'],
          ].map(([name, label]) => (
            <label key={name}>
              {label} USD / millón
              <input name={name} type="number" min="0" max="100000" step="any" required />
            </label>
          ))}
        </div>
        <label>
          Notas y alcance de tarifa
          <textarea name="notes" required maxLength={1000} rows={2} />
        </label>
        <button className="primary-button" disabled={result.isLoading}>
          Guardar tarifa
        </button>
        <Failure error={result.error} />
        {result.isSuccess && <p role="status">Tarifa guardada como versión inmutable.</p>}
      </form>
    </details>
  );
}
const targetDefaults = (): z.infer<typeof labTargetInput> => ({
  provider: 'ollama',
  model: '',
  configuration: { maxOutputTokens: 256 },
  tariffId: null,
  cacheLabel: 'unspecified',
});
function TargetEditor({
  project,
  index,
  value,
  onChange,
  tariffs,
}: {
  project: string;
  index: number;
  value: z.infer<typeof labTargetInput>;
  onChange: (value: z.infer<typeof labTargetInput>) => void;
  tariffs: LabTariff[];
}) {
  const catalog = chatApi.useAiModelsQuery({ projectId: project, provider: value.provider });
  return (
    <fieldset>
      <legend>Modelo {index + 1}</legend>
      <div className="lab-grid">
        <label>
          Proveedor {index + 1}
          <select
            value={value.provider}
            onChange={(e) =>
              onChange({
                ...value,
                provider: e.target.value as 'openai' | 'ollama',
                model: '',
                tariffId: null,
              })
            }
          >
            <option value="ollama">Ollama local</option>
            <option value="openai">OpenAI API</option>
          </select>
        </label>
        <label>
          Modelo {index + 1}
          <select
            value={value.model}
            required
            onChange={(e) => onChange({ ...value, model: e.target.value, tariffId: null })}
          >
            <option value="">
              {catalog.isFetching ? 'Consultando modelos…' : 'Selecciona un modelo'}
            </option>
            {catalog.currentData?.models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Límite de salida {index + 1}
          <input
            type="number"
            required
            min={1}
            max={4096}
            value={value.configuration.maxOutputTokens}
            onChange={(e) =>
              onChange({ ...value, configuration: { maxOutputTokens: Number(e.target.value) } })
            }
          />
        </label>
      </div>
      <label>
        Tarifa {index + 1}
        <select
          value={value.tariffId ?? ''}
          onChange={(e) => onChange({ ...value, tariffId: e.target.value || null })}
        >
          <option value="">Sin tarifa: coste desconocido</option>
          {tariffs
            .filter((t) => t.provider === value.provider && t.model === value.model)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.effectiveFrom} · {t.inputPerMillion}/{t.cachedInputPerMillion}/
                {t.outputPerMillion} USD/M
              </option>
            ))}
        </select>
      </label>
      <label>
        Condición de caché declarada {index + 1}
        <select
          value={value.cacheLabel}
          onChange={(e) =>
            onChange({ ...value, cacheLabel: e.target.value as typeof value.cacheLabel })
          }
        >
          <option value="unspecified">Sin controlar</option>
          <option value="cold">Fría, declarada por el operador</option>
          <option value="warm">Caliente, declarada por el operador</option>
        </select>
      </label>
      <Failure error={catalog.error} />
      {catalog.currentData?.error && <p role="alert">{catalog.currentData.error.message}</p>}
    </fieldset>
  );
}
function BatchEditor({
  project,
  overview,
  onCreated,
}: {
  project: string;
  overview: Overview;
  onCreated: (id: string) => void;
}) {
  const [targets, setTargets] = useState([targetDefaults(), targetDefaults()]),
    [cases, setCases] = useState<string[]>([]),
    [title, setTitle] = useState(''),
    [repetitions, setRepetitions] = useState(2),
    [environment, setEnvironment] = useState(''),
    [external, setExternal] = useState(false);
  const [create, result] = labApi.useLabCreateBatchMutation();
  const hasExternal = targets.some((t) => t.provider === 'openai'),
    calls = cases.length * targets.length * repetitions;
  return (
    <details>
      <summary>Preparar comparación</summary>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create({
            project,
            body: {
              requestId: crypto.randomUUID(),
              title,
              caseIds: cases,
              targets,
              repetitions,
              environment,
              allowExternal: external,
            },
          })
            .unwrap()
            .then((value) => onCreated(value.batch.id))
            .catch(() => {});
        }}
      >
        <label>
          Nombre de la comparación
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Casos congelados (máximo 5)</legend>
          {overview.cases.length ? (
            overview.cases.map((c) => (
              <label className="lab-check" key={c.id}>
                <input
                  type="checkbox"
                  checked={cases.includes(c.id)}
                  disabled={!cases.includes(c.id) && cases.length >= 5}
                  onChange={(e) =>
                    setCases((values) =>
                      e.target.checked ? [...values, c.id] : values.filter((v) => v !== c.id),
                    )
                  }
                />
                {c.title} · {c.sourceCount} fuentes
              </label>
            ))
          ) : (
            <p>Primero guarda un caso.</p>
          )}
        </fieldset>
        {targets.map((value, index) => (
          <TargetEditor
            key={index}
            project={project}
            index={index}
            value={value}
            tariffs={overview.tariffs}
            onChange={(value) =>
              setTargets((values) => values.map((v, i) => (i === index ? value : v)))
            }
          />
        ))}
        <div className="lab-actions">
          <button
            type="button"
            className="text-button"
            disabled={targets.length >= 4}
            onClick={() => setTargets((values) => [...values, targetDefaults()])}
          >
            Añadir modelo
          </button>
          <button
            type="button"
            className="text-button"
            disabled={targets.length <= 1}
            onClick={() => setTargets((values) => values.slice(0, -1))}
          >
            Quitar último modelo
          </button>
        </div>
        <label>
          Repeticiones
          <input
            required
            type="number"
            min={1}
            max={5}
            value={repetitions}
            onChange={(e) => setRepetitions(Number(e.target.value))}
          />
        </label>
        <label>
          Entorno y condiciones declaradas
          <textarea
            maxLength={2000}
            rows={2}
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="Hardware, carga concurrente, servidor/modelo local, preparación de caché…"
          />
        </label>
        <p>
          {calls} intentos, máximo 20. Secuenciales por repetición, caso y modelo; sin reintentos.
          La declaración fría/caliente no fuerza ni demuestra el estado de la caché.
        </p>
        {hasExternal && (
          <label className="lab-check">
            <input
              type="checkbox"
              required
              checked={external}
              onChange={(e) => setExternal(e.target.checked)}
            />{' '}
            Autorizo enviar preguntas y contexto congelado a los modelos API seleccionados.
          </label>
        )}
        <button className="primary-button" disabled={result.isLoading || calls < 1 || calls > 20}>
          {result.isLoading ? 'Preparando…' : 'Guardar comparación'}
        </button>
        <Failure error={result.error} />
      </form>
    </details>
  );
}
function Review({
  project,
  batch,
  run,
  caseValue,
}: {
  project: string;
  batch: string;
  run: LabRun;
  caseValue: LabCase;
}) {
  const previous = run.reviews.at(-1),
    [accepted, setAccepted] = useState(previous?.accepted ?? false),
    [score, setScore] = useState<number | ''>(previous?.score ?? ''),
    [notes, setNotes] = useState(previous?.notes ?? ''),
    [verdicts, setVerdicts] = useState<('pass' | 'fail' | 'uncertain')[]>(
      previous?.verdicts ??
        caseValue.criteria.map((_c, i) =>
          run.automatic?.verdicts[i] === 'pass'
            ? 'pass'
            : run.automatic?.verdicts[i] === 'fail'
              ? 'fail'
              : 'uncertain',
        ),
    );
  const [save, result] = labApi.useLabReviewMutation();
  return (
    <form
      className="lab-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (score === '') return;
        void save({
          project,
          batch,
          run: run.id,
          body: { version: run.reviewVersion, accepted, score, verdicts, notes },
        })
          .unwrap()
          .catch(() => {});
      }}
    >
      <p>
        La comprobación automática busca texto y fuentes esperadas cuando existen, y es provisional.
        Revisa la respuesta y cada criterio; no demuestra corrección semántica.
      </p>
      {caseValue.criteria.map((criterion, i) => (
        <label key={i}>
          {criterion.description}
          <small>Sugerencia automática: {run.automatic?.verdicts[i] ?? 'unknown'}</small>
          {criterion.expectedPaths?.length ? (
            <small>Fuentes esperadas: {criterion.expectedPaths.join(', ')}</small>
          ) : null}
          <select
            aria-label={`Valoración del criterio ${i + 1}`}
            value={verdicts[i]}
            onChange={(e) =>
              setVerdicts((values) =>
                values.map((v, n) => (n === i ? (e.target.value as typeof v) : v)),
              )
            }
          >
            <option value="pass">Cumple</option>
            <option value="fail">No cumple</option>
            <option value="uncertain">Sin determinar</option>
          </select>
        </label>
      ))}
      <label>
        Calidad (0–5)
        <select
          value={score}
          required
          onChange={(e) => setScore(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Selecciona una puntuación</option>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="lab-check">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{' '}
        Resultado aceptable tras revisión humana
      </label>
      <label>
        Notas de revisión
        <textarea
          rows={2}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <button className="primary-button" disabled={result.isLoading}>
        Guardar valoración
      </button>
      <Failure error={result.error} />
      {result.isSuccess && <p role="status">Valoración guardada con historial.</p>}
    </form>
  );
}
function BatchView({ project, id }: { project: Project; id: string }) {
  const [poll, setPoll] = useState(true);
  const result = labApi.useLabBatchQuery(
    { project: project.id, id },
    { pollingInterval: poll ? 1000 : 0, refetchOnFocus: true, skipPollingIfUnfocused: true },
  );
  const [execute, executing] = labApi.useLabExecuteMutation(),
    [cancel, cancelling] = labApi.useLabCancelMutation();
  const value = result.currentData,
    batch = value?.batch;
  useEffect(() => {
    if (batch) setPoll(batch.status === 'running');
  }, [batch]);
  if (!value || !batch)
    return (
      <>
        <p role="status">
          {result.isLoading ? 'Cargando comparación…' : 'No se puede mostrar la comparación.'}
        </p>
        <Failure error={result.error} />
      </>
    );
  return (
    <section className="lab-batch" aria-label="Resultados de comparación">
      <h3>{batch.conditions.title}</h3>
      {batch.conditions.contextPlan && <ContextComparison project={project.id} batch={batch} />}
      <p role="status">Estado del lote: {states[batch.status]}</p>
      <div className="lab-actions">
        {batch.status === 'draft' && (
          <button
            className="primary-button"
            disabled={!!project.archivedAt || executing.isLoading}
            onClick={() =>
              void execute({ project: project.id, id })
                .unwrap()
                .catch(() => {})
            }
          >
            Ejecutar comparación
          </button>
        )}
        {['draft', 'running'].includes(batch.status) && (
          <button
            className="secondary-button"
            disabled={cancelling.isLoading || batch.cancelRequested}
            onClick={() =>
              void cancel({ project: project.id, id })
                .unwrap()
                .catch(() => {})
            }
          >
            Cancelar lote
          </button>
        )}
        <a
          className="secondary-button"
          href={`/api/projects/${project.id}/lab/batches/${id}/export?format=json`}
          download
        >
          Exportar JSON
        </a>
        <a
          className="secondary-button"
          href={`/api/projects/${project.id}/lab/batches/${id}/export?format=csv`}
          download
        >
          Exportar CSV
        </a>
      </div>
      <Failure error={result.error ?? executing.error ?? cancelling.error} />
      <p>
        Aceptación y calidad provienen de revisiones humanas. Coste de texto estimado por resultado
        aceptable = coste de todos los intentos / aceptados; si falta algún coste se muestra
        desconocido. No incluye otros cargos ni recursos locales.
      </p>
      <div className="lab-table-wrap">
        <table>
          <caption>Calidad, latencia y coste por modelo</caption>
          <thead>
            <tr>
              <th>Modelo / configuración</th>
              <th>Calidad</th>
              <th>Revisados / intentos</th>
              <th>Aceptados</th>
              <th>Primera respuesta</th>
              <th>Tiempo total medio</th>
              <th>Coste / aceptable</th>
              <th>Tiempo / aceptable</th>
            </tr>
          </thead>
          <tbody>
            {value.summary.map((s) => {
              const t = batch.conditions.targets[s.target]!;
              return (
                <tr key={s.target}>
                  <td>
                    {t.provider} · {t.model}
                    <small>Salida máx. {t.configuration.maxOutputTokens}</small>
                  </td>
                  <td>{metric(s.meanQuality, ' / 5')}</td>
                  <td>
                    {s.reviewed} / {s.attempted}
                    <small>{s.errors} errores/interrumpidos</small>
                  </td>
                  <td>{s.accepted}</td>
                  <td>
                    {metric(s.meanFirstTokenMs, ' ms')}
                    <small>n={s.firstTokenSamples}</small>
                  </td>
                  <td>
                    {metric(s.meanDurationMs, ' ms')}
                    <small>n={s.durationSamples}</small>
                  </td>
                  <td>
                    {metric(s.costPerAcceptedUsd, ' USD')}
                    <small>
                      {s.pricedAttempts}/{s.attempted} intentos con coste
                    </small>
                  </td>
                  <td>{metric(s.timePerAcceptedMs, ' ms')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Condiciones y contexto congelado</summary>
        <p>
          Protocolo {batch.conditions.protocol}; {batch.conditions.order};{' '}
          {batch.conditions.repetitions} repeticiones; plazo {batch.conditions.timeoutMs} ms por
          intento.
        </p>
        <p>Entorno declarado: {batch.conditions.environment || 'Sin especificar'}</p>
        {batch.conditions.targets.map((target, i) => (
          <p key={i}>
            Modelo {i + 1}: {target.provider}/{target.model}.{' '}
            {target.tariff ? (
              <>
                <a href={target.tariff.source} target="_blank" rel="noreferrer">
                  Fuente de tarifa
                </a>{' '}
                · vigente desde {target.tariff.effectiveFrom}; verificada {target.tariff.verifiedOn}
                . {target.tariff.notes}
              </>
            ) : (
              'Sin tarifa conocida.'
            )}
          </p>
        ))}
        {batch.conditions.cases.map((c) => (
          <section key={c.id}>
            <h4>
              {c.title} · versión {c.version}
            </h4>
            <p>{c.question}</p>
            <small>
              Hash de contexto: {c.contextHash}
              <br />
              Hash de mensajes: {batch.conditions.messagesHash[c.id]}
            </small>
            <pre>{c.context || 'Sin contexto manual.'}</pre>
            <Sources sources={c.sources} />
          </section>
        ))}
      </details>
      {batch.runs.map((run) => {
        const target = batch.conditions.targets[run.target]!,
          c = batch.conditions.cases.find((c) => c.id === run.caseId)!;
        return (
          <details className="lab-run" key={run.id}>
            <summary>
              Intento {run.ordinal} · {target.provider}/{target.model} · repetición {run.repetition}{' '}
              · {states[run.status]} ·{' '}
              {run.reviews.at(-1)?.accepted
                ? 'Aceptable'
                : run.reviews.length
                  ? 'Revisado'
                  : 'Sin revisión'}
            </summary>
            <p>Caso: {c.title}</p>
            {target.contextStrategy && <p>Estrategia versionada: {target.contextStrategy}</p>}
            <pre>{run.response || 'Sin respuesta.'}</pre>
            {run.contextMetrics && <ContextOperations metrics={run.contextMetrics} />}
            {run.errorMessage && (
              <p role="alert" className="form-error">
                {run.errorCode}: {run.errorMessage}
              </p>
            )}
            <dl className="chat-metrics">
              <dt>Modelo reportado / revisión observada</dt>
              <dd>
                {run.reportedModel ?? 'Desconocido'} / {run.catalogRevision ?? 'Desconocida'}
              </dd>
              <dt>Primer texto / total</dt>
              <dd>
                {metric(run.firstTokenMs, ' ms')} / {metric(run.durationMs, ' ms')}
              </dd>
              <dt>Tokens entrada / salida / total / caché</dt>
              <dd>
                {metric(run.usage.inputTokens)} / {metric(run.usage.outputTokens)} /{' '}
                {metric(run.usage.totalTokens)} / {metric(run.usage.cachedTokens)}
              </dd>
              <dt>Coste reportado / estimación de texto</dt>
              <dd>
                {metric(run.usage.costUsd, ' USD')} / {metric(run.estimatedCostUsd, ' USD')} (
                {run.costReason})
              </dd>
              <dt>Caché declarada / observada</dt>
              <dd>
                {target.cacheLabel} /{' '}
                {run.cacheObserved === 'hit'
                  ? 'Acierto reportado (caliente al menos en parte)'
                  : run.cacheObserved === 'no_hit'
                    ? 'Sin acierto reportado; no demuestra servidor frío'
                    : 'Desconocida'}
              </dd>
              <dt>Duración / carga / evaluación del proveedor</dt>
              <dd>
                {metric(run.usage.providerDurationMs, ' ms')} /{' '}
                {metric(run.usage.loadDurationMs, ' ms')} /{' '}
                {metric(run.usage.evaluationDurationMs, ' ms')}
              </dd>
              <dt>Tarifa fijada</dt>
              <dd>
                {target.tariff
                  ? `${target.tariff.effectiveFrom} · verificada ${target.tariff.verifiedOn} · ${target.tariff.inputPerMillion}/${target.tariff.cachedInputPerMillion}/${target.tariff.outputPerMillion} USD/M`
                  : 'Sin tarifa'}
              </dd>
            </dl>
            {!['running', 'pending', 'skipped'].includes(run.status) && !project.archivedAt && (
              <Review
                key={`${run.id}-${run.reviewVersion}`}
                project={project.id}
                batch={id}
                run={run}
                caseValue={c}
              />
            )}
            {run.reviews.length > 0 && (
              <details>
                <summary>Historial de valoraciones ({run.reviews.length})</summary>
                {run.reviews.map((review) => (
                  <p key={review.version}>
                    v{review.version} · {review.createdAt} · {review.score}/5 ·{' '}
                    {review.accepted ? 'aceptable' : 'no aceptable'} · {review.notes}
                  </p>
                ))}
              </details>
            )}
          </details>
        );
      })}
    </section>
  );
}
export function ProjectLaboratory({ project }: { project: Project }) {
  const result = labApi.useLabOverviewQuery(project.id, { refetchOnFocus: true });
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="laboratory">
      <h2>Laboratorio de modelos</h2>
      <p>
        Compara el mismo contexto congelado, revisa calidad y relaciona latencia y coste con
        resultados aceptables.
      </p>
      <Failure error={result.error} />
      {result.isLoading && <p role="status">Cargando laboratorio…</p>}
      {result.currentData && (
        <>
          {!project.archivedAt && (
            <div className="lab-editors">
              <CaseEditor project={project.id} />
              <TariffEditor project={project.id} />
              <BatchEditor
                project={project.id}
                overview={result.currentData}
                onCreated={setSelected}
              />
              <ContextExperimentForm
                project={project.id}
                overview={result.currentData}
                onCreated={setSelected}
              />
            </div>
          )}
          <div className="lab-actions" aria-label="Comparaciones guardadas">
            {result.currentData.batches.map((b) => (
              <button
                key={b.id}
                className="secondary-button"
                aria-pressed={selected === b.id}
                onClick={() => setSelected(b.id)}
              >
                {b.title} · {states[b.status] ?? b.status}
              </button>
            ))}
          </div>
          {selected && <BatchView key={selected} project={project} id={selected} />}
        </>
      )}
      {project.archivedAt && (
        <p className="read-only-note">
          Proyecto archivado: consulta y exportación disponibles; sin nuevas ejecuciones ni
          revisiones.
        </p>
      )}
    </section>
  );
}
