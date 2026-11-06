import type { Pool, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  codingReport,
  codingWorkspace,
  reviewTarget,
  reviewFinding,
  dimensionOutput,
  verificationOutput,
  dimensionalReview,
  teamPlanSnapshot,
  controllerReviewTest,
} from '@ferweb/contracts';
import { canonical, digest, publicationTree } from './review-artifacts.js';
import { HttpError } from '../../http-error.js';

const changed = () =>
  new HttpError(
    409,
    'review_target_changed',
    'El diff, tarea o herramientas de la revisión han cambiado. Prepara una revisión nueva.',
  );
export function freezeReviewTarget(row: QueryResultRow) {
  if (
    !['completed', 'failed'].includes(row.state) ||
    !row.report ||
    !row.environment ||
    !row.source_tree ||
    row.configuration?.workspaceAccess === 'read-only'
  )
    throw changed();
  const report = codingReport.parse(row.report);
  if (
    !report.terminationConfirmed ||
    report.jobId !== row.job_id ||
    report.commit !== row.commit_sha
  )
    throw changed();
  const tree = publicationTree(report, row.files, row.source_tree);
  const files = new Map<string, string>(
    codingWorkspace.parse(row.files).map((f) => [f.path, f.content]),
  );
  for (const entry of tree) {
    if ('content' in entry) files.set(entry.path, entry.content!);
    else files.delete(entry.path);
  }
  const result = {
    jobId: row.job_id,
    reportHash: digest(canonical(report)),
    diffHash: digest(canonical(report.diff)),
    taskHash: digest(canonical(row.task_snapshot)),
    environmentHash: digest(canonical(row.environment)),
    filesHash: digest(canonical([...files].sort(([a], [b]) => a.localeCompare(b)))),
    diff: report.diff,
    files: codingWorkspace.parse([...files].map(([path, content]) => ({ path, content }))),
    beforeFiles: codingWorkspace.parse(row.files),
  };
  return reviewTarget.parse({ ...result, artifactHash: digest(canonical(result)) });
}
export async function assertReviewTarget(
  pool: Pool,
  target: z.infer<typeof reviewTarget>,
  project: string,
) {
  const row = (
    await pool.query(
      'SELECT c.*,j.state,j.configuration FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1 AND j.project_id=$2',
      [target.jobId, project],
    )
  ).rows[0];
  if (!row || canonical(freezeReviewTarget(row)) !== canonical(target)) throw changed();
}
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export function findingId(finding: z.infer<typeof reviewFinding>) {
  return digest(
    canonical({
      code: finding.code,
      path: finding.path,
      side: finding.side,
      start: finding.startLine,
      end: finding.endLine,
      evidence: finding.evidence,
      trigger: normalize(finding.trigger),
    }),
  );
}
export function gatherDimensionalReview(
  run: QueryResultRow,
  steps: QueryResultRow[],
  stale = false,
) {
  const snapshot = teamPlanSnapshot.parse(run.snapshot.plan),
    target = snapshot.reviewTarget!;
  const blockers: string[] = [],
    findings = new Map<string, z.infer<typeof dimensionalReview>['findings'][number]>();
  const iteration = Math.max(...steps.map((s) => s.iteration));
  const dimensions = steps.map((child) => {
    const step = snapshot.steps.find((s) => s.key === child.step_key)!;
    let state: 'pending' | 'verified' | 'failed' | 'invalid' = 'pending',
      error: string | null = null;
    if (child?.job_id && ['completed', 'failed', 'cancelled'].includes(child.state)) {
      if (!child.delivery?.verified || child.state !== 'completed') {
        state = 'failed';
        error = 'delivery_unverified';
      } else {
        try {
          if (step.key === 'verify') verificationOutput.parse(JSON.parse(child.delivery.result));
          else {
            const output = dimensionOutput.parse(JSON.parse(child.delivery.result));
            for (const claim of output.findings) {
              const file = (claim.side === 'before' ? target.beforeFiles : target.files).find(
                (f) => f.path === claim.path,
              );
              if (
                !file ||
                !target.diff.some((f) => f.path === claim.path) ||
                claim.endLine > file.content.split('\n').length ||
                !file.content
                  .split('\n')
                  .slice(claim.startLine - 1, claim.endLine)
                  .join('\n')
                  .includes(claim.evidence)
              )
                throw Error('finding_location_or_evidence');
            }
            for (const claim of output.findings) {
              const id = findingId(claim),
                prior = findings.get(id);
              const provenance = {
                dimension: step.key,
                iteration: child.iteration,
                jobId: child.job_id,
                role: step.role.id,
                version: step.role.version,
                claim,
              };
              if (prior) {
                prior.provenance.push(provenance);
                for (const key of ['severity', 'impact', 'reproductionTest'] as const)
                  if (prior.finding[key] !== claim[key] && !prior.discrepancies.includes(key))
                    prior.discrepancies.push(key);
                const order = ['critical', 'high', 'medium', 'low'];
                if (order.indexOf(claim.severity) < order.indexOf(prior.finding.severity))
                  prior.finding = { ...prior.finding, severity: claim.severity };
              } else
                findings.set(id, {
                  id,
                  finding: claim,
                  provenance: [provenance],
                  discrepancies: [],
                  verification: {
                    status: 'unverifiable',
                    reason: 'Sin evidencia independiente válida.',
                    proof: null,
                    origin: 'unverified',
                  },
                });
            }
          }
          state = 'verified';
        } catch {
          state = 'invalid';
          error = 'structured_output_or_evidence_invalid';
        }
      }
    }
    if (state !== 'verified' && child.iteration === iteration)
      blockers.push(`${step.key}:${error ?? 'pending'}`);
    return {
      key: step.key,
      iteration: child.iteration,
      jobId: child?.job_id ?? null,
      role: step.role.id,
      version: step.role.version,
      state,
      error,
    };
  });
  const verifier = steps.find((s) => s.step_key === 'verify' && s.iteration === iteration);
  if (
    dimensions.find((d) => d.key === 'verify' && d.iteration === iteration)?.state === 'verified'
  ) {
    const { verifications } = verificationOutput.parse(JSON.parse(verifier!.delivery.result));
    const ids = new Set<string>();
    for (const verification of verifications) {
      if (ids.has(verification.findingId) || !findings.has(verification.findingId)) {
        blockers.push('verification_reference_invalid');
        continue;
      }
      ids.add(verification.findingId);
      const finding = findings.get(verification.findingId)!;
      finding.verification = {
        status: 'unverifiable',
        reason: 'Afirmación sin prueba independiente válida: ' + verification.reason,
        proof: null,
        origin: 'unverified',
      };
      const proof = verification.proof;
      if (
        verification.status === 'unverifiable' ||
        !proof ||
        !finding.finding.reproductionTest ||
        finding.discrepancies.includes('reproductionTest')
      )
        continue;
      const source = steps.find(
        (s) => s.job_id === proof.jobId && s.step_key !== 'verify' && s.delivery?.verified,
      );
      const test = source?.report?.tests?.[proof.testIndex];
      if (
        test?.origin !== 'controller-review-tests' ||
        ![0, 1].includes(test.exitCode) ||
        !test.output.includes(proof.quote)
      )
        continue;
      const matches = (test.output as string).split('\n').flatMap((line) => {
        try {
          const record = controllerReviewTest.parse(JSON.parse(line));
          return record.name === finding.finding.reproductionTest &&
            ['passed', 'failed'].includes(record.outcome) &&
            record.file?.startsWith('/workspace/') &&
            target.files.some((f) => '/workspace/' + f.path === record.file)
            ? [{ line, record }]
            : [];
        } catch {
          return [];
        }
      });
      if (matches.length !== 1 || !proof.quote.includes(matches[0]!.line)) continue;
      const outcome = matches[0]!.record.outcome === 'failed' ? 'confirmed' : 'refuted';
      if (outcome !== verification.status) continue;
      finding.verification = {
        status: outcome,
        reason: verification.reason,
        proof,
        origin: 'controller-test',
      };
    }
  }
  for (const finding of findings.values())
    if (
      ['critical', 'high'].includes(finding.finding.severity) &&
      finding.verification.status === 'unverifiable'
    )
      blockers.push(`severe_unverified:${finding.id}`);
  if (stale) blockers.push('artifact_changed');
  if (Number(run.message_conflicts) > 0) blockers.push('team_message_conflict');
  const state = stale
    ? 'stale'
    : ['pending', 'running'].includes(run.state)
      ? 'running'
      : run.state === 'completed' && !blockers.length
        ? 'complete'
        : 'incomplete';
  return dimensionalReview.parse({
    executionId: run.id,
    artifactHash: target.artifactHash,
    diffHash: target.diffHash,
    state,
    iteration,
    maxIterations: snapshot.maxIterations,
    dimensions,
    findings: [...findings.values()],
    blockers,
  });
}
export async function dimensionReviews(
  pool: Pool,
  project: string,
  id: string,
  authorizeMemory?: (
    refs: NonNullable<z.infer<typeof teamPlanSnapshot>['memory']>,
  ) => Promise<boolean>,
) {
  const runs = (
    await pool.query(
      "SELECT r.*,(SELECT count(*) FROM team_messages m WHERE m.execution_id=r.id AND m.kind='conflict') AS message_conflicts FROM team_executions r WHERE project_id=$1 AND snapshot->'plan'->'reviewTarget'->>'jobId'=$2 ORDER BY created_at DESC,id LIMIT 10",
      [project, id],
    )
  ).rows;
  const result = [];
  for (const run of runs) {
    const snapshot = teamPlanSnapshot.parse(run.snapshot.plan);
    let stale = false;
    if (snapshot.memory?.length) {
      if (!authorizeMemory)
        throw new HttpError(
          403,
          'memory_source_unavailable',
          'No se puede confirmar acceso a las fuentes de la revisión.',
        );
      stale = !(await authorizeMemory(snapshot.memory));
    }
    try {
      await assertReviewTarget(pool, snapshot.reviewTarget!, project);
    } catch {
      stale = true;
    }
    const steps = (
      await pool.query(
        'SELECT s.*,j.state,c.report FROM team_execution_steps s LEFT JOIN jobs j ON j.id=s.job_id LEFT JOIN coding_runs c ON c.job_id=j.id WHERE s.execution_id=$1 ORDER BY position',
        [run.id],
      )
    ).rows;
    result.push(gatherDimensionalReview(run, steps, stale));
  }
  return result;
}
export function dimensionHash(reviews: z.infer<typeof dimensionalReview>[]) {
  return reviews.length ? digest(canonical(reviews[0])) : null;
}
