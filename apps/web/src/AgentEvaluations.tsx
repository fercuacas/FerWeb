import { useState } from 'react';
import type {
  AgentEvaluation,
  AgentEvaluationEvidence,
  AgentEvaluationInput,
  Project,
} from '@ferweb/contracts';
import { labApi } from './lab-store';
import { errorMessage } from './workspace-store';

const cases = { recorded: 'Informes registrados', 'addition-v1': 'Fixture de suma v1' };
const states: Record<string, string> = {
  completed: 'Finalizado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  skipped: 'Omitido',
  pending: 'Pendiente',
  running: 'En curso',
};
const grades = {
  passed: 'Aprobado',
  failed: 'Fallido',
  unverifiable: 'Sin verificar',
  not_run: 'Sin ejecutar',
};
const evidenceKinds = {
  real: 'Real',
  simulated: 'Simulada',
  mixed: 'Mixta',
  unknown: 'Desconocida',
};
const differences = {
  task: 'Tarea o versión',
  snapshot: 'Repositorio, commit o archivos iniciales',
  tools: 'Herramientas, imagen o acceso de escritura',
  limits: 'Presupuesto o límites',
  model: 'Modelo',
  context: 'Contexto, memoria o material de skills',
  destination: 'Destino real o simulado',
};
const verdicts = {
  solo: 'Agente único',
  team: 'Equipo',
  tie: 'Empate',
  inconclusive: 'Inconclusa',
};
type Verdict = keyof typeof verdicts;
const formatDate = (date: string) => new Date(date).toLocaleString();
const metric = (value: number | null | undefined, suffix = '') =>
  value == null ? 'Desconocido' : `${value}${suffix}`;

function EvaluationArm({ title, arm }: { title: string; arm: AgentEvaluationEvidence['solo'] }) {
  return (
    <article className="lab-run">
      <h4>{title}</h4>
      <p>
        {states[arm.state]} · Evidencia {evidenceKinds[arm.evidence].toLowerCase()}
      </p>
      {arm.errorCode && <small>{arm.errorCode}</small>}
      <p>
        Tiempo total {metric(arm.elapsedMs, ' ms')} · Iteraciones iniciadas {arm.iterations}
      </p>
      <p>
        Modelo {arm.model ?? 'Desconocido'} · Límite {metric(arm.limits?.maxRequests, ' llamadas')}
      </p>
      <p>
        Coste {metric(arm.costUsd)} · Cobertura de líneas {metric(arm.lineCoverage)}
      </p>
      <p>
        Verificador independiente {grades[arm.grade.status]}
        {arm.grade.total !== null && ` (${arm.grade.passed}/${arm.grade.total})`}
        {arm.grade.status !== 'passed' && <small>{arm.grade.code}</small>}
      </p>
      {arm.baseline.total !== null && (
        <p>
          Antes del cambio {arm.baseline.passed}/{arm.baseline.total} pruebas
        </p>
      )}
      {arm.steps.map((step) => (
        <details key={`${step.iteration}/${step.key}`}>
          <summary>
            {step.key} · Ronda {step.iteration} · {states[step.state]}
          </summary>
          {step.errorCode && <small>{step.errorCode}</small>}
          <p>
            Llamadas {metric(step.requests)} · Tiempo {metric(step.durationMs, ' ms')}
          </p>
          <p>
            Tokens de entrada {metric(step.providerUsage?.inputTokens)} · Salida{' '}
            {metric(step.providerUsage?.outputTokens)}
          </p>
          {step.providerUsage && (
            <p>
              Uso reportado en {step.providerUsage.reportedRequests} de{' '}
              {step.providerUsage.totalRequests} llamadas
            </p>
          )}
          {step.context && (
            <p>
              Contexto registrado {step.context.bytes} bytes · {step.context.expansions}{' '}
              ampliaciones
              {step.context.relevance === 'missing' && ' · Fuente del fixture ausente en el recibo'}
              {step.context.diagnostics.length > 0 && ' · Recibo incompleto'}
            </p>
          )}
          <ul>
            {step.tests.map((test, index) => (
              <li key={index}>
                {test.command} · {test.origin} ·{' '}
                {test.exitCode === null ? 'Sin código de salida' : `Salida ${test.exitCode}`}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </article>
  );
}

function EvaluationReview({
  project,
  evaluation,
}: {
  project: string;
  evaluation: AgentEvaluation;
}) {
  const [verdict, setVerdict] = useState<Verdict>('inconclusive');
  const [note, setNote] = useState('');
  const [review, result] = labApi.useReviewAgentEvaluationMutation();
  return (
    <form
      className="lab-form"
      onSubmit={(event) => {
        event.preventDefault();
        void review({
          project,
          id: evaluation.id,
          body: { version: evaluation.reviews.length, verdict, note },
        })
          .unwrap()
          .then(() => setNote(''))
          .catch(() => {});
      }}
    >
      <label>
        Valoración humana
        <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
          {Object.entries(verdicts)
            .filter(([key]) => evaluation.evidence.comparable || key === 'inconclusive')
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </select>
      </label>
      <label>
        Motivo de la valoración
        <textarea
          required
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="secondary-button" disabled={result.isLoading || !note.trim()}>
        Guardar valoración
      </button>
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
    </form>
  );
}

function EvaluationDetail({ project, id }: { project: Project; id: string }) {
  const result = labApi.useAgentEvaluationQuery(
    { project: project.id, id },
    { refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const [compare, replay] = labApi.useCompareAgentsMutation();
  if (result.error) return <p role="alert">{errorMessage(result.error)}</p>;
  const detail = result.currentData;
  if (!detail) return <p role="status">Cargando comparación…</p>;
  const { evidence } = detail;
  return (
    <section className="lab-batch" aria-label="Resultado de evaluación">
      <h3>{cases[detail.case]}</h3>
      <p>
        {evidence.comparable
          ? 'Condiciones registradas equivalentes'
          : 'Condiciones no comparables'}
      </p>
      {evidence.differences.length > 0 && (
        <ul>
          {evidence.differences.map((key) => (
            <li key={key}>{differences[key]}</li>
          ))}
        </ul>
      )}
      <div className="lab-grid">
        <EvaluationArm title="Agente único" arm={evidence.solo} />
        <EvaluationArm title="Equipo" arm={evidence.team} />
      </div>
      <small>Huella de evidencia {detail.evidenceHash}</small>
      <div className="lab-actions">
        <a
          className="secondary-button"
          href={`/api/projects/${project.id}/lab/agent-evaluations/${id}/export`}
          download
        >
          Exportar evaluación JSON
        </a>
        {!project.archivedAt && (
          <button
            type="button"
            className="secondary-button"
            disabled={replay.isLoading}
            onClick={() => {
              const { soloId, teamId, case: corpus } = detail;
              void compare({ project: project.id, body: { soloId, teamId, case: corpus } })
                .unwrap()
                .catch(() => {});
            }}
          >
            Repetir verificación
          </button>
        )}
      </div>
      {replay.isSuccess && <p role="status">La repetición coincide con la evidencia guardada.</p>}
      {replay.error && <p role="alert">{errorMessage(replay.error)}</p>}
      <h4>Valoraciones humanas</h4>
      {detail.reviews.length === 0 && <p>Pendiente de valoración.</p>}
      <ul>
        {detail.reviews.map((review) => (
          <li key={review.version}>
            {verdicts[review.verdict]} · {formatDate(review.recordedAt)}
            <p>{review.note}</p>
          </li>
        ))}
      </ul>
      {!project.archivedAt && <EvaluationReview project={project.id} evaluation={detail} />}
    </section>
  );
}

export function AgentEvaluations({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [soloId, setSoloId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [corpus, setCorpus] = useState<AgentEvaluationInput['case']>('recorded');
  const list = labApi.useAgentEvaluationsQuery(project.id, {
    skip: !open,
    refetchOnFocus: true,
    refetchOnMountOrArgChange: true,
  });
  const [compare, result] = labApi.useCompareAgentsMutation();
  const data = list.error ? undefined : list.currentData;
  return (
    <div className="lab-editors">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Evaluar agente y equipo</summary>
        <p>
          Selecciona dos ejecuciones terminadas. La evaluación usa los artefactos guardados y
          registra por separado las condiciones, el verificador y la valoración humana.
        </p>
        {open && !data && !list.error && <p role="status">Cargando ejecuciones…</p>}
        {(list.error || result.error) && (
          <p role="alert">{errorMessage(list.error ?? result.error)}</p>
        )}
        {open && data && (
          <>
            {!project.archivedAt &&
              (data.solo.length && data.teams.length ? (
                <form
                  className="lab-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void compare({ project: project.id, body: { soloId, teamId, case: corpus } })
                      .unwrap()
                      .then((value) => setSelected(value.id))
                      .catch(() => {});
                  }}
                >
                  <label>
                    Agente único
                    <select
                      required
                      value={soloId}
                      onChange={(event) => setSoloId(event.target.value)}
                    >
                      <option value="">Selecciona un trabajo</option>
                      {data.solo.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} · {states[item.state]} · {formatDate(item.createdAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Equipo
                    <select
                      required
                      value={teamId}
                      onChange={(event) => setTeamId(event.target.value)}
                    >
                      <option value="">Selecciona una ejecución</option>
                      {data.teams.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} · {states[item.state]} · {formatDate(item.createdAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Caso de evaluación
                    <select
                      value={corpus}
                      onChange={(event) =>
                        setCorpus(event.target.value as AgentEvaluationInput['case'])
                      }
                    >
                      {Object.entries(cases).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={!soloId || !teamId || result.isLoading}
                  >
                    {result.isLoading ? 'Verificando…' : 'Guardar comparación'}
                  </button>
                </form>
              ) : (
                <p>
                  Hace falta un trabajo individual y una ejecución de equipo terminados en este
                  proyecto.
                </p>
              ))}
            {data.evaluations.length > 0 ? (
              <label className="lab-form">
                Comparaciones guardadas
                <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                  <option value="">Selecciona una comparación</option>
                  {data.evaluations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {cases[item.case]} · {formatDate(item.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>Todavía no hay comparaciones de agentes guardadas.</p>
            )}
            {selected && <EvaluationDetail key={selected} project={project} id={selected} />}
          </>
        )}
      </details>
    </div>
  );
}
