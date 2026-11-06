import { useState } from 'react';
import type { z } from 'zod';
import type { codingRunSchema, dimensionalReview } from '@ferweb/contracts';
import { workspaceApi, errorMessage } from './workspace-store';
import { codingApi } from './coding-store';
import { teamsApi } from './teams-store';
import { PlanDetails } from './TeamPlans';

export function DimensionalReviewPanel({
  project,
  run,
  reviews,
}: {
  project: string;
  run: z.infer<typeof codingRunSchema>;
  reviews: z.infer<typeof dimensionalReview>[];
}) {
  const projectQuery = workspaceApi.useProjectQuery(project);
  const templates = teamsApi.useTeamTemplatesQuery(project);
  const capabilities = codingApi.useCodingCapabilitiesQuery(project);
  const plans = teamsApi.useTeamPlansQuery(project);
  const [prepare, result] = teamsApi.usePrepareTeamPlanMutation();
  const [templateId, setTemplate] = useState(''),
    [model, setModel] = useState(''),
    [selected, setSelected] = useState('');
  const available = templates.error
    ? []
    : (templates.currentData?.templates.filter(
        (t) => !t.archivedAt && t.latest.definition.reviewMode,
      ) ?? []);
  const modes = capabilities.error
    ? []
    : (capabilities.currentData?.readOnlyExecution.models ?? []);
  const chosen = available.find((t) => t.id === templateId);
  const projectData = projectQuery.error ? undefined : projectQuery.currentData?.project;
  const effectiveModel = modes.some((m) => m.id === model) ? model : (modes[0]?.id ?? '');
  const history = plans.error
    ? []
    : (plans.currentData?.plans.filter((p) => p.reviewJobId === run.jobId) ?? []);
  const failure = projectQuery.error || templates.error || capabilities.error || plans.error;
  const names = {
    running: 'En curso',
    complete: 'Completa',
    incomplete: 'Incompleta',
    stale: 'Invalidada',
  };
  const verificationNames = {
    confirmed: 'Confirmado',
    refuted: 'Refutado',
    unverifiable: 'No verificable',
  };
  return (
    <section className="agent-history" aria-label="Revisión por dimensiones">
      <h4>Revisión por dimensiones</h4>
      <p>
        Corrección, stack y seguridad/pruebas sobre el mismo diff. Hasta dos rondas aprobadas de
        revisión/corrección y verificación con el mismo presupuesto y plazo; los criterios y las
        fuentes no se modifican. Un acuerdo entre agentes no sustituye evidencia ni aprobación
        humana.
      </p>
      {run.teamExecutionId && (
        <p>El informe del hijo se puede revisar; su publicación individual sigue bloqueada.</p>
      )}
      {(templates.isLoading ||
        capabilities.isLoading ||
        projectQuery.isLoading ||
        plans.isLoading) && <p role="status">Cargando revisores y planes…</p>}
      {failure ? (
        <p role="alert">
          {errorMessage(failure)}{' '}
          <button
            onClick={() => {
              void templates.refetch();
              void capabilities.refetch();
              void projectQuery.refetch();
              void plans.refetch();
            }}
          >
            Reintentar revisión por dimensiones
          </button>
        </p>
      ) : (
        projectData &&
        !projectData.archivedAt && (
          <form
            className="job-form"
            aria-label="Preparar revisión por dimensiones"
            onSubmit={(e) => {
              e.preventDefault();
              if (!chosen) return;
              void prepare({
                project,
                body: {
                  requestId: crypto.randomUUID(),
                  reviewTarget: run.jobId,
                  taskId: String(run.task.id),
                  taskVersion: Number(run.task.version),
                  templateId: chosen.id,
                  templateVersion: chosen.latest.version,
                  mode: 'team',
                  executionId: 'codex-v1',
                  model: effectiveModel,
                },
              })
                .unwrap()
                .then(({ plan }) => setSelected(plan.id))
                .catch(() => {});
            }}
          >
            {!available.length && (
              <p>
                Crea una plantilla «Revisión por dimensiones» desde Agentes → Equipos y plantillas y
                asigna los roles del proyecto.
              </p>
            )}
            <label>
              Plantilla de revisores
              <select required value={templateId} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Selecciona una plantilla</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.latest.definition.name} · v{t.latest.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modelo de revisión
              <select required value={effectiveModel} onChange={(e) => setModel(e.target.value)}>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <p>
                {chosen.latest.definition.maxIterations} rondas máximas · Hasta{' '}
                {chosen.latest.definition.limits.maxRequests} peticiones ·{' '}
                {chosen.latest.definition.limits.timeoutMs / 1000} segundos · Concurrencia{' '}
                {chosen.latest.definition.limits.concurrency}. Preparar no ejecuta ni consume
                inferencia.
              </p>
            )}
            <button disabled={!chosen || !effectiveModel || result.isLoading}>
              Preparar revisión del diff
            </button>
          </form>
        )
      )}
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
      {!!history.length && (
        <ul>
          {history.map((p) => (
            <li key={p.id}>
              <button onClick={() => setSelected(p.id)}>
                Ver plan de revisión · {p.hash.slice(0, 12)}
              </button>{' '}
              · {p.state}
            </li>
          ))}
        </ul>
      )}
      {selected && projectData && (
        <PlanDetails key={selected} project={projectData} id={selected} />
      )}
      {!reviews.length && (
        <p>
          Aún no hay revisiones por dimensiones ejecutadas. La revisión individual sigue disponible.
        </p>
      )}
      {reviews.map((review) => (
        <article key={review.executionId} aria-label="Resultado de revisión por dimensiones">
          <h5>
            Revisión {names[review.state]} · ronda {review.iteration}/{review.maxIterations}
          </h5>
          <p className="skill-text">
            Diff {review.diffHash} · Artefacto {review.artifactHash} · Ejecución{' '}
            {review.executionId}
          </p>
          <ul>
            {review.dimensions.map((d) => (
              <li key={`${d.iteration}:${d.key}`}>
                {d.key} · ronda {d.iteration} · rol {d.role} v{d.version} · {d.state}
                {d.error && ` · ${d.error}`}
              </li>
            ))}
          </ul>
          {!!review.blockers.length && (
            <p role="status">
              Bloqueos: {review.blockers.join(', ')}. Esta revisión no permite aprobar el borrador.
            </p>
          )}
          {!review.findings.length && (
            <p>Sin hallazgos validados. Comprueba el estado de todas las dimensiones.</p>
          )}
          {review.findings.map((f) => (
            <section key={f.id} aria-label="Hallazgo de revisión">
              <h5>
                {f.finding.severity} · {f.finding.title}
              </h5>
              <p>
                {f.finding.path}:{f.finding.startLine}–{f.finding.endLine} · {f.finding.side} ·{' '}
                {f.finding.code}
              </p>
              <pre className="skill-text">{f.finding.evidence}</pre>
              <p>Desencadenante: {f.finding.trigger}</p>
              <p>Impacto: {f.finding.impact}</p>
              <p>
                Verificación: {verificationNames[f.verification.status]} ·{' '}
                {f.verification.origin === 'controller-test'
                  ? 'Prueba independiente del controlador'
                  : 'Sin evidencia independiente válida'}
              </p>
              <p>{f.verification.reason}</p>
              {f.verification.proof && (
                <pre className="skill-text">
                  {f.verification.proof.jobId} · prueba {f.verification.proof.testIndex}
                  {'\n'}
                  {f.verification.proof.quote}
                </pre>
              )}
              {!!f.discrepancies.length && (
                <p>Discrepancias conservadas: {f.discrepancies.join(', ')}</p>
              )}
              <details>
                <summary>Procedencia: {f.provenance.length} aportaciones</summary>
                {f.provenance.map((p, i) => (
                  <p key={i}>
                    {p.dimension} · {p.jobId} · rol {p.role} v{p.version} · {p.claim.severity} ·{' '}
                    {p.claim.title} · {p.claim.impact}
                  </p>
                ))}
              </details>
            </section>
          ))}
          <p>
            Completa describe el recorrido de revisión; aprobar y publicar PR requieren acciones
            humanas independientes.
          </p>
        </article>
      ))}
    </section>
  );
}
