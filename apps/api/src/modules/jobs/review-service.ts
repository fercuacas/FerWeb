import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import {
  codingComparisons,
  codingConfiguration,
  codingReport,
  codingReview,
  reviewResponse,
  type reviewInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
import type { CodingService } from './coding-service.js';
import { canonical, digest, publicationTree } from './review-artifacts.js';

const conflict = (message: string) => new HttpError(409, 'review_conflict', message);
function dto(row: QueryResultRow) {
  return codingReview.parse({
    jobId: row.job_id,
    title: row.title,
    body: row.body,
    branch: row.branch,
    approved: row.approved,
    notes: row.notes,
    version: row.version,
    state: row.state,
    attemptedAt: row.attempted_at?.toISOString() ?? null,
    commit: row.commit_sha,
    pullNumber: row.pull_number,
    pullUrl: row.pull_url,
    baseChanged: row.base_changed,
    errorCode: row.error_code,
  });
}
export class ReviewService {
  constructor(readonly coding: CodingService) {}
  private get pool() {
    return this.coding.pool;
  }
  private async run(owner: string, project: string, id: string) {
    await this.coding.read(owner, project, id);
    return (
      await this.pool.query(
        'SELECT c.*,j.state,j.configuration FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1 AND j.project_id=$2 AND c.owner_id=$3',
        [id, project, owner],
      )
    ).rows[0]!;
  }
  private ready(row: QueryResultRow) {
    if (
      row.state !== 'completed' ||
      !row.base_branch ||
      !row.source_tree ||
      !row.environment ||
      !row.report
    )
      throw conflict(
        'La ejecución debe haber completado con las condiciones de publicación registradas. Las ejecuciones antiguas deben repetirse.',
      );
    const report = codingReport.parse(row.report);
    if (
      report.terminationConfirmed !== true ||
      report.commit !== row.commit_sha ||
      report.jobId !== row.job_id
    )
      throw conflict('No se ha confirmado un resultado final válido.');
    return publicationTree(report, row.files, row.source_tree);
  }
  async read(owner: string, project: string, id: string) {
    const run = await this.run(owner, project, id),
      row = (await this.pool.query('SELECT * FROM coding_reviews WHERE job_id=$1', [id])).rows[0];
    return reviewResponse.parse({ review: row ? dto(row) : null, baseBranch: run.base_branch });
  }
  async save(owner: string, project: string, id: string, input: z.infer<typeof reviewInput>) {
    const run = await this.run(owner, project, id);
    this.ready(run);
    if (
      !input.branch.endsWith(`-${id}`) ||
      input.branch.includes('//') ||
      input.branch.split('/').some((p) => p.startsWith('-'))
    )
      throw new HttpError(
        400,
        'review_branch',
        'Usa una rama ferweb/ que termine en el identificador completo de la ejecución.',
      );
    try {
      await this.coding.jobs.queue.tx(async (db) => {
        const p = (
          await db.query(
            'SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [project, owner],
          )
        ).rows[0];
        if (!p || p.archived_at) throw conflict('Restaura el proyecto antes de preparar una PR.');
        const old = (
          await db.query('SELECT * FROM coding_reviews WHERE job_id=$1 FOR UPDATE', [id])
        ).rows[0];
        if ((old?.version ?? 0) !== input.version || old?.attempted_at)
          throw conflict(
            'El borrador cambió o ya se intentó publicar. Actualiza; los reintentos conservan sus condiciones.',
          );
        await db.query(
          `INSERT INTO coding_reviews(job_id,project_id,repository_id,title,body,branch,approved,notes,report_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(job_id) DO UPDATE SET title=$4,body=$5,branch=$6,approved=$7,notes=$8,report_hash=$9,version=coding_reviews.version+1,updated_at=now()`,
          [
            id,
            project,
            run.repository_id,
            input.title,
            input.body,
            input.branch,
            input.approved,
            input.notes,
            digest(canonical(run.report)),
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw conflict('Esta rama está reservada para otra ejecución.');
      throw error;
    }
    return this.read(owner, project, id);
  }
  async publish(owner: string, project: string, id: string, version: number) {
    const team = await this.coding.read(owner, project, id);
    if (team.teamExecutionId)
      throw new HttpError(
        409,
        'team_managed_step',
        'La publicación del resultado de equipo requiere revisión agregada.',
      );
    const run = await this.run(owner, project, id),
      tree = this.ready(run);
    // Remote access/permissions are checked on every explicit attempt, including retries.
    const access = await this.coding.github.publicationAccess(
      owner,
      project,
      Number(run.repository_id),
      run.base_branch,
    );
    const token = randomUUID();
    const review = await this.coding.jobs.queue.tx(async (db) => {
      const p = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!p || p.archived_at) throw conflict('El proyecto no permite publicar.');
      const row = (
        await db.query(
          'SELECT *,lease_until>clock_timestamp() AS busy FROM coding_reviews WHERE job_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (
        !row ||
        row.version !== version ||
        !row.approved ||
        row.report_hash !== digest(canonical(run.report))
      )
        throw conflict('Guarda y aprueba la revisión vigente antes de publicar.');
      if (row.state === 'published') return row;
      if (row.busy) throw conflict('Ya hay una publicación en curso. Espera y actualiza.');
      return (
        await db.query(
          "UPDATE coding_reviews SET state='publishing',attempt_token=$2,lease_until=clock_timestamp()+interval '180 seconds',attempted_at=COALESCE(attempted_at,now()),error_code=NULL,updated_at=now() WHERE job_id=$1 RETURNING *",
          [id, token],
        )
      ).rows[0]!;
    });
    if (review.state === 'published') return this.read(owner, project, id);
    const { api, fullName } = access;
    const base = async () => {
      await access.check();
      if ((await api.branchHead(access.token, fullName, run.base_branch)) !== run.commit_sha)
        throw new HttpError(
          409,
          'review_base_changed',
          'La rama base ha cambiado desde la ejecución. Sincroniza y ejecuta una nueva tarea; no se publica sobre otra base.',
        );
    };
    const marker = `<!-- ferweb-run:${id} report:${review.report_hash} -->`;
    const recordPull = async (pull: Awaited<ReturnType<typeof api.createPull>>, commit: string) => {
      await access.check();
      if (
        pull.head.sha !== commit ||
        pull.head.ref !== review.branch ||
        pull.base.ref !== run.base_branch ||
        pull.base.repo.id !== Number(run.repository_id) ||
        pull.head.repo?.id !== Number(run.repository_id) ||
        !pull.body?.includes(marker) ||
        (await api.ref(access.token, fullName, review.branch)) !== commit
      )
        throw conflict('La PR encontrada no corresponde a los cambios revisados. No se modifica.');
      const changed =
        pull.base.sha !== run.commit_sha ||
        (await api.branchHead(access.token, fullName, run.base_branch)) !== run.commit_sha;
      const saved = await this.pool.query(
        "UPDATE coding_reviews SET state='published',pull_number=$3,pull_url=$4,base_changed=$5,lease_until=NULL,attempt_token=NULL,updated_at=now() WHERE job_id=$1 AND attempt_token=$2",
        [id, token, pull.number, `https://github.com/${fullName}/pull/${pull.number}`, changed],
      );
      if (!saved.rowCount)
        throw conflict('La publicación perdió su reserva. Actualiza para reconciliarla.');
    };
    try {
      // Recover a successful remote creation whose response/SQL confirmation was
      // lost, even if the base moved afterwards. Never create another PR here.
      if (review.commit_sha) {
        const existing = await api.findPull(access.token, fullName, review.branch);
        if (existing.length > 1)
          throw conflict('Hay varias PR para esta rama; requiere revisión manual.');
        if (existing[0]) {
          await recordPull(existing[0], review.commit_sha);
          return this.read(owner, project, id);
        }
      }
      await base();
      let commit = review.commit_sha as string | null;
      if (!commit) {
        commit = await api.createChangeCommit(
          access.token,
          fullName,
          run.commit_sha,
          tree,
          `${review.title}\n\nFerWeb task ${run.task_id}\n${marker}`,
          review.created_at.toISOString(),
        );
        const saved = await this.pool.query(
          "UPDATE coding_reviews SET commit_sha=$3 WHERE job_id=$1 AND attempt_token=$2 AND state='publishing'",
          [id, token, commit],
        );
        if (!saved.rowCount) throw conflict('La publicación perdió su reserva.');
      }
      await base();
      const ref = await api.ref(access.token, fullName, review.branch);
      if (ref && ref !== commit)
        throw conflict('La rama remota contiene cambios ajenos. No se sobrescribe.');
      if (!ref) await api.createRef(access.token, fullName, review.branch, commit);
      await base();
      const matches = await api.findPull(access.token, fullName, review.branch);
      if (matches.length > 1)
        throw conflict('Hay varias PR para esta rama; requiere revisión manual.');
      const body = `${review.body}\n\n---\nTarea FerWeb: ${run.task_id}\nEjecución: ${id}\nCommit inicial: ${run.commit_sha}\n\n${marker}`;
      const pull =
        matches[0] ??
        (await api.createPull(access.token, fullName, {
          title: review.title,
          body,
          head: review.branch,
          base: run.base_branch,
        }));
      await recordPull(pull, commit);
    } catch (error) {
      await this.pool.query(
        "UPDATE coding_reviews SET state='failed',error_code=$3,lease_until=NULL,attempt_token=NULL,updated_at=now() WHERE job_id=$1 AND attempt_token=$2",
        [id, token, error instanceof HttpError ? error.code : 'publication_unknown'],
      );
      throw error;
    }
    return this.read(owner, project, id);
  }
  async comparisons(owner: string, project: string, id: string) {
    const baseline = await this.run(owner, project, id);
    const rows = (
      await this.pool.query(
        `SELECT c.*,j.configuration,j.state,r.job_id AS review_id,to_jsonb(r) AS review FROM coding_runs c JOIN jobs j ON j.id=c.job_id LEFT JOIN coding_reviews r ON r.job_id=c.job_id WHERE c.task_id=$1 AND c.owner_id=$2 AND j.project_id=$3 AND c.repository_id=$4 ORDER BY c.created_at DESC,c.job_id LIMIT 21`,
        [baseline.task_id, owner, project, baseline.repository_id],
      )
    ).rows;
    const conditions = (row: QueryResultRow) => {
      const { model: _model, ...configuration } = codingConfiguration.parse(row.configuration);
      return {
        commit: row.commit_sha,
        files: row.manifest,
        task: {
          title: row.task_snapshot.title,
          description: row.task_snapshot.description,
          acceptanceCriteria: row.task_snapshot.acceptanceCriteria,
        },
        toolsAndLimits: row.environment,
        agent: row.agent_snapshot,
        configuration,
      };
    };
    const original = conditions(baseline);
    return codingComparisons.parse({
      baseline: id,
      truncated: rows.length > 20,
      runs: rows.slice(0, 20).map((row) => {
        const current = conditions(row),
          differences = Object.keys(original).filter(
            (key) =>
              canonical(original[key as keyof typeof original]) !==
              canonical(current[key as keyof typeof current]),
          );
        if (!row.environment || !baseline.environment) differences.push('unrecordedEnvironment');
        return {
          jobId: row.job_id,
          state: row.state,
          configuration: row.configuration,
          commit: row.commit_sha,
          environment: row.environment,
          comparable: differences.length === 0,
          differences,
          report: row.report,
          review: row.review_id
            ? dto({
                ...row.review,
                attempted_at: row.review.attempted_at ? new Date(row.review.attempted_at) : null,
              })
            : null,
        };
      }),
    });
  }
}
