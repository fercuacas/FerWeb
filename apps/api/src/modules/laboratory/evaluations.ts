import type { Pool, QueryResultRow } from 'pg';
import {
  agentEvaluation,
  agentEvaluationEvidence,
  agentEvaluationList,
  codingConfiguration,
  type AgentEvaluationInput,
  type agentEvaluationReviewInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import type { TeamExecutions } from '../teams/executions.js';
import { evaluationEvidence, type EvaluationRun } from './evaluation-evidence.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado la comparación.');
const conflict = (code: string, message: string) => new HttpError(409, code, message);
const summary = (row: QueryResultRow) => ({
  id: row.id,
  soloId: row.solo_id,
  teamId: row.team_id,
  case: row.case_key,
  createdAt: row.created_at.toISOString(),
});
const isActive = (state: string) => state === 'pending' || state === 'running';

export class AgentEvaluations {
  constructor(
    private readonly pool: Pool,
    private readonly coding: CodingService,
    private readonly teams: TeamExecutions,
  ) {}

  async list(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const [evaluations, solo, teams] = await Promise.all([
      this.pool.query(
        'SELECT id,solo_id,team_id,case_key,created_at FROM agent_evaluations WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT 100',
        [project],
      ),
      this.pool.query(
        `SELECT j.id,j.title,j.state,j.created_at FROM jobs j JOIN coding_runs c ON c.job_id=j.id
        WHERE j.project_id=$1 AND c.owner_id=$2 AND j.state IN ('completed','failed','cancelled')
        AND NOT EXISTS (SELECT 1 FROM team_execution_steps s WHERE s.job_id=j.id)
        ORDER BY j.created_at DESC,j.id LIMIT 100`,
        [project, owner],
      ),
      this.pool.query(
        `SELECT id,snapshot->'plan'->'task'->>'title' AS title,state,created_at FROM team_executions
        WHERE project_id=$1 AND snapshot->'plan'->>'mode'='team' AND state IN ('completed','failed','cancelled')
        ORDER BY created_at DESC,id LIMIT 100`,
        [project],
      ),
    ]);
    const candidate = ({ id, title, state, created_at }: QueryResultRow) => ({
      id,
      title,
      state,
      createdAt: created_at.toISOString(),
    });
    return agentEvaluationList.parse({
      evaluations: evaluations.rows.map(summary),
      solo: solo.rows.map(candidate),
      teams: teams.rows.map(candidate),
    });
  }

  private async loadRun(owner: string, project: string, id: string): Promise<EvaluationRun> {
    const row = (
      await this.pool.query(
        'SELECT j.configuration,j.state,j.error_code,j.created_at,j.finished_at,c.repository_id,c.files,c.source_tree,c.output_files,c.memory_snapshot FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1 AND j.project_id=$2 AND c.owner_id=$3',
        [id, project, owner],
      )
    ).rows[0];
    if (!row) throw missing();
    const run = await this.coding.read(owner, project, id);
    return {
      run,
      configuration: codingConfiguration.parse(row.configuration),
      repositoryId: String(row.repository_id),
      state: row.state,
      errorCode: row.error_code,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      files: row.files,
      tree: row.source_tree,
      output: row.output_files,
      memory: row.memory_snapshot,
      receipt: run.contextReceipt
        ? await this.coding.contextPacks!.read(owner, project, run.contextReceipt.id)
        : null,
    };
  }

  private async owned(owner: string, project: string, id: string) {
    const row = (
      await this.pool.query(
        'SELECT e.* FROM agent_evaluations e JOIN projects p ON p.id=e.project_id WHERE e.id=$1 AND p.id=$2 AND p.owner_id=$3',
        [id, project, owner],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }

  private async response(row: QueryResultRow) {
    const evidence = agentEvaluationEvidence.parse(row.evidence);
    if (digest(canonical(evidence)) !== row.evidence_hash)
      throw conflict('evaluation_changed', 'La evidencia guardada ha perdido su integridad.');
    const { rows } = await this.pool.query(
      'SELECT version,verdict,note,recorded_at FROM agent_evaluation_reviews WHERE evaluation_id=$1 ORDER BY version',
      [row.id],
    );
    return agentEvaluation.parse({
      ...summary(row),
      evidenceHash: row.evidence_hash,
      evidence,
      reviews: rows.map(({ version, verdict, note, recorded_at }) => ({
        version,
        verdict,
        note,
        recordedAt: recorded_at.toISOString(),
      })),
    });
  }

  async read(owner: string, project: string, id: string) {
    const row = await this.owned(owner, project, id);
    await this.coding.read(owner, project, row.solo_id);
    await this.teams.read(owner, project, row.team_id);
    return this.response(row);
  }

  async compare(owner: string, project: string, input: AgentEvaluationInput) {
    const solo = await this.loadRun(owner, project, input.soloId);
    const team = await this.teams.read(owner, project, input.teamId);
    if (solo.run.teamExecutionId || team.plan.mode !== 'team')
      throw conflict(
        'evaluation_arms',
        'Selecciona un trabajo individual y una ejecución en modo equipo.',
      );
    if (isActive(solo.state) || isActive(team.execution.state))
      throw conflict('evaluation_active', 'Espera a que ambos trabajos terminen.');
    const children = new Map<string, EvaluationRun>();
    for (const step of team.steps) {
      if (!step.jobId) continue;
      const child = await this.loadRun(owner, project, step.jobId);
      if (child.run.teamExecutionId !== input.teamId || isActive(child.state))
        throw conflict('evaluation_active', 'La evidencia de los pasos todavía no está cerrada.');
      children.set(step.jobId, child);
    }
    const evidence = agentEvaluationEvidence.parse(
      evaluationEvidence(input.case, solo, team, children),
    );
    const hash = digest(canonical(evidence));
    const row = await this.coding.jobs.queue.tx(async (db) => {
      const scope = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!scope) throw missing();
      if (scope.archived_at)
        throw conflict(
          'project_archived',
          'Restaura el proyecto antes de guardar una comparación.',
        );
      const keys = [project, input.soloId, input.teamId, input.case];
      const old = (
        await db.query(
          'SELECT * FROM agent_evaluations WHERE project_id=$1 AND solo_id=$2 AND team_id=$3 AND case_key=$4',
          keys,
        )
      ).rows[0];
      if (old) {
        if (old.evidence_hash !== hash)
          throw conflict('evaluation_changed', 'La repetición difiere de la evidencia congelada.');
        return old;
      }
      if (
        (
          await db.query('SELECT 1 FROM agent_evaluations WHERE project_id=$1 OFFSET 999 LIMIT 1', [
            project,
          ])
        ).rowCount
      )
        throw conflict(
          'evaluation_limit',
          'Se ha alcanzado el límite de comparaciones del proyecto.',
        );
      return (
        await db.query(
          'INSERT INTO agent_evaluations(project_id,solo_id,team_id,case_key,evidence,evidence_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [...keys, JSON.stringify(evidence), hash],
        )
      ).rows[0];
    });
    return this.response(row);
  }

  async review(
    owner: string,
    project: string,
    id: string,
    input: z.infer<typeof agentEvaluationReviewInput>,
  ) {
    const current = await this.read(owner, project, id);
    if (!current.evidence.comparable && input.verdict !== 'inconclusive')
      throw conflict(
        'evaluation_incomparable',
        'Registra una revisión inconclusa para condiciones distintas.',
      );
    await this.coding.jobs.queue.tx(async (db) => {
      const scope = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!scope) throw missing();
      if (scope.archived_at)
        throw conflict('project_archived', 'Restaura el proyecto antes de valorar.');
      const result = await db.query(
        `INSERT INTO agent_evaluation_reviews(evaluation_id,version,verdict,note)
         SELECT $1,$2,$3,$4 WHERE $2=(SELECT count(*)::int FROM agent_evaluation_reviews WHERE evaluation_id=$1)
         AND $2<100 ON CONFLICT DO NOTHING`,
        [id, input.version, input.verdict, input.note],
      );
      if (!result.rowCount)
        throw conflict(
          'version_conflict',
          'La revisión ha cambiado o se ha alcanzado el límite. Vuelve a abrirla.',
        );
    });
    return this.response(await this.owned(owner, project, id));
  }
}
