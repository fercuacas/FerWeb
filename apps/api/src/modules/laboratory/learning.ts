import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  learningCompliance,
  learningHealth,
  learningInput,
  learningList,
  learningProposal,
  memoryDraft,
  memorySelection,
  type AgentEvaluation,
  type LearningInput,
  type learningComplianceInput,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { rejectMemorySecrets } from '../memory/codec.js';
import type { AgentEvaluations } from './evaluations.js';
import { learningObservation } from './learning-observations.js';

type Selection = z.infer<typeof memorySelection>;
const missing = () =>
  new HttpError(404, 'not_found', 'No se ha encontrado la propuesta o ejecución.');
const changed = () =>
  new HttpError(
    409,
    'learning_changed',
    'La propuesta o su evidencia cambió. Revisa el estado vigente.',
  );
const archived = () =>
  new HttpError(409, 'project_archived', 'Restaura el proyecto antes de cambiar propuestas.');
const hash = (value: unknown) => digest(canonical(value));
const summary = (row: QueryResultRow) => ({
  id: row.id,
  state: row.state,
  createdAt: row.created_at.toISOString(),
});
const observationFields = `SELECT c.job_id,c.report,c.agent_snapshot,c.environment,c.manifest,c.memory_snapshot,
  c.context_receipt_id,p.snapshot->'payload'->'skills' AS context_skills,j.configuration,j.state,j.error_code,j.finished_at
  FROM jobs j JOIN coding_runs c ON c.job_id=j.id LEFT JOIN context_pack_receipts p ON p.id=c.context_receipt_id
  WHERE j.project_id=$1 AND c.owner_id=$2 AND j.state IN ('completed','failed','cancelled')
    AND j.finished_at >= now() - interval '30 days'`;

function freeze(evaluation: AgentEvaluation, arm: LearningInput['arm']) {
  const selected = evaluation.evidence[arm];
  return {
    hash: evaluation.evidenceHash,
    origin: selected.evidence,
    baseline: selected.baseline.status,
    verifier: selected.grade.status,
    comparable: evaluation.evidence.comparable,
    feedback: evaluation.reviews.at(-1)?.verdict ?? null,
    feedbackVersion: evaluation.reviews.length,
  };
}
function learningEligible(evidence: ReturnType<typeof freeze>) {
  return (
    evidence.comparable &&
    evidence.origin === 'real' &&
    evidence.baseline === 'failed' &&
    evidence.verifier === 'passed' &&
    evidence.feedback !== 'inconclusive'
  );
}

export class ProjectLearning {
  constructor(
    private readonly pool: Pool,
    private readonly coding: CodingService,
    private readonly evaluations: Pick<AgentEvaluations, 'read' | 'recheck'>,
  ) {}

  async health(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked)
      return learningHealth.parse({
        retentionDays: 30,
        truncated: false,
        available: false,
        observations: [],
      });
    const { rows } = await this.pool.query(
      observationFields + ' AND c.repository_id=$3 ORDER BY j.finished_at DESC,j.id LIMIT 61',
      [project, owner, link.repositoryId],
    );
    return learningHealth.parse({
      retentionDays: 30,
      truncated: rows.length > 60,
      available: true,
      observations: rows.slice(0, 60).map(learningObservation),
    });
  }

  async comply(owner: string, project: string, input: z.infer<typeof learningComplianceInput>) {
    const rows = [];
    const prompts = new Set<string>();
    const conditions = new Set<string | null>();
    for (const label of ['supportive', 'neutral', 'competing'] as const) {
      const id = input[label];
      const run = await this.coding.read(owner, project, id);
      const row = (await this.pool.query(observationFields + ' AND j.id=$3', [project, owner, id]))
        .rows[0];
      if (!row) throw missing();
      const { taskId: _taskId, ...configuration } = row.configuration;
      const { title, description, acceptanceCriteria } = run.task;
      prompts.add(hash([title, description, acceptanceCriteria]));
      conditions.add(
        run.teamExecutionId ||
          row.context_receipt_id ||
          !run.environment?.image ||
          !run.environment.policyHash ||
          typeof run.environment.simulated !== 'boolean' ||
          run.budget?.steps.length !== 1 ||
          !run.report ||
          run.report.simulated !== run.environment.simulated
          ? null
          : hash([
              run.repository,
              run.environment,
              row.manifest,
              configuration,
              row.agent_snapshot,
              row.memory_snapshot,
            ]),
      );
      rows.push({ label, observation: learningObservation(row) });
    }
    return learningCompliance.parse({
      protocol: 'ferweb-skill-comply-v1',
      comparable: prompts.size === 3 && conditions.size === 1 && !conditions.has(null),
      scenarios: rows,
    });
  }

  async list(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const { rows } = await this.pool.query(
      'SELECT id,state,created_at FROM learning_proposals WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT 100',
      [project],
    );
    return learningList.parse({ proposals: rows.map(summary) });
  }

  private async owned(owner: string, project: string, id: string) {
    const row = (
      await this.pool.query(
        'SELECT l.* FROM learning_proposals l JOIN projects p ON p.id=l.project_id WHERE l.id=$1 AND p.id=$2 AND p.owner_id=$3',
        [id, project, owner],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }

  private async dto(row: QueryResultRow) {
    const { rows } = await this.pool.query(
      'SELECT action,memory,recorded_at FROM learning_events WHERE proposal_id=$1 AND version<=$2 ORDER BY version',
      [row.id, row.version],
    );
    return learningProposal.parse({
      ...row.draft,
      ...summary(row),
      version: row.version,
      evidence: row.evidence,
      eligible: learningEligible(row.evidence),
      memory: row.memory,
      history: rows.map((item) => ({
        action: item.action,
        at: item.recorded_at.toISOString(),
        memory: item.memory,
      })),
    });
  }

  async read(owner: string, project: string, id: string) {
    const row = await this.owned(owner, project, id);
    await this.evaluations.read(owner, project, row.evaluation_id);
    return this.dto(row);
  }

  async propose(owner: string, project: string, input: LearningInput) {
    rejectMemorySecrets(input);
    const evaluation = await this.evaluations.read(owner, project, input.evaluationId);
    const { requestId, ...draft } = learningInput.parse(input);
    const requestHash = hash(draft);
    const evidence = freeze(evaluation, input.arm);
    if (input.replaces) {
      const [entry] = await this.coding.memory.selections(owner, project, [input.replaces]);
      if (entry?.kind !== 'lesson') throw changed();
    }
    const id = await this.coding.projects.locked(owner, project, async (db, scope) => {
      if (scope.archived_at) throw archived();
      const old = (
        await db.query(
          'SELECT id,request_hash FROM learning_proposals WHERE project_id=$1 AND request_id=$2',
          [project, requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw changed();
        return old.id as string;
      }
      if (
        (
          await db.query(
            'SELECT 1 FROM learning_proposals WHERE project_id=$1 OFFSET 499 LIMIT 1',
            [project],
          )
        ).rowCount
      )
        throw new HttpError(409, 'learning_limit', 'El proyecto admite hasta 500 propuestas.');
      const created = (
        await db.query(
          'INSERT INTO learning_proposals(project_id,evaluation_id,request_id,request_hash,draft,evidence) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            project,
            input.evaluationId,
            requestId,
            requestHash,
            JSON.stringify(draft),
            JSON.stringify(evidence),
          ],
        )
      ).rows[0].id as string;
      await db.query(
        "INSERT INTO learning_events(proposal_id,version,action) VALUES($1,1,'propose')",
        [created],
      );
      return created;
    });
    return this.read(owner, project, id);
  }

  private async transition(
    db: PoolClient,
    project: string,
    id: string,
    version: number,
    action: 'approve' | 'reject' | 'adopt' | 'revert',
    selection: Selection | null = null,
  ) {
    const next = { approve: 'approved', reject: 'rejected', adopt: 'adopted', revert: 'reverted' }[
      action
    ];
    const previous = action === 'adopt' ? 'approved' : action === 'revert' ? 'adopted' : 'proposed';
    const result = await db.query(
      'UPDATE learning_proposals SET version=version+1,state=$5,memory=$6 WHERE project_id=$1 AND id=$2 AND version=$3 AND state=$4',
      [project, id, version, previous, next, selection && JSON.stringify(selection)],
    );
    if (!result.rowCount) throw changed();
    await db.query(
      'INSERT INTO learning_events(proposal_id,version,action,memory) VALUES($1,$2,$3,$4)',
      [id, version + 1, action, selection && JSON.stringify(selection)],
    );
  }

  async review(
    owner: string,
    project: string,
    id: string,
    version: number,
    decision: 'approve' | 'reject',
  ) {
    await this.read(owner, project, id);
    await this.coding.projects.locked(owner, project, async (db, scope) => {
      if (scope.archived_at) throw archived();
      await this.transition(db, project, id, version, decision);
    });
    return this.read(owner, project, id);
  }

  async adopt(owner: string, project: string, id: string, version: number) {
    const row = await this.owned(owner, project, id);
    if (row.state !== 'approved' || row.version !== version) throw changed();
    const evaluation = await this.evaluations.recheck(owner, project, row.evaluation_id);
    const proposal = await this.dto(row);
    const current = freeze(evaluation, proposal.arm);
    if (hash(current) !== hash(row.evidence)) throw changed();
    if (!learningEligible(current))
      throw new HttpError(
        409,
        'learning_insufficient',
        'La evidencia real comparable debe confirmar un fallo inicial y una corrección verificada.',
      );
    const arm = evaluation.evidence[proposal.arm];
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.stale || link.snapshot?.commit !== arm.commit)
      throw changed();
    const sources = arm.steps.map((step) => {
      if (!step.jobId || !step.reportHash || step.state !== 'completed') throw changed();
      return { kind: 'job' as const, id: step.jobId, expectedHash: step.reportHash };
    });
    const draft = memoryDraft.parse({
      kind: 'lesson',
      status: 'active',
      title: proposal.title,
      content: proposal.correction,
      observedAt: proposal.createdAt,
      tags: ['learning'],
      targets: [],
      lesson: {
        failure: proposal.failure,
        decision: proposal.correction,
        validation:
          'Verificación determinista de la corrección, con base fallida y resultado aprobado.',
      },
      sources,
    });
    const record = async (db: PoolClient, selection: Selection) => {
      const source = (
        await db.query(
          "SELECT version,stale,revoked,snapshot->>'commit' AS commit FROM github_links WHERE project_id=$1 FOR SHARE",
          [project],
        )
      ).rows[0];
      const comparison = (
        await db.query(
          'SELECT evidence_hash,(SELECT count(*)::int FROM agent_evaluation_reviews WHERE evaluation_id=$1) AS reviews FROM agent_evaluations WHERE id=$1 AND project_id=$2',
          [evaluation.id, project],
        )
      ).rows[0];
      if (
        !source ||
        source.stale ||
        source.revoked ||
        source.version !== link.version ||
        source.commit !== arm.commit ||
        comparison?.evidence_hash !== current.hash ||
        comparison.reviews !== current.feedbackVersion
      )
        throw changed();
      await this.transition(db, project, id, version, 'adopt', selection);
    };
    if (proposal.replaces) {
      const [entry] = await this.coding.memory.selections(owner, project, [proposal.replaces]);
      if (entry?.kind !== 'lesson') throw changed();
      await this.coding.memory.correct(owner, project, entry.id, entry.revision, draft, record);
    } else await this.coding.memory.create(owner, project, randomUUID(), draft, record);
    return this.read(owner, project, id);
  }

  async revert(owner: string, project: string, id: string, version: number) {
    const proposal = await this.read(owner, project, id);
    if (proposal.state !== 'adopted' || proposal.version !== version || !proposal.memory)
      throw changed();
    const { entry } = await this.coding.memory.read(owner, project, proposal.memory.id);
    if (entry.revision !== proposal.memory.revision || entry.hash !== proposal.memory.hash)
      throw changed();
    const previous = proposal.replaces
      ? (
          await this.coding.memory.read(
            owner,
            project,
            proposal.replaces.id,
            proposal.replaces.revision,
          )
        ).entry
      : null;
    if (previous && previous.hash !== proposal.replaces?.hash) throw changed();
    const { kind, title, content, observedAt, tags, targets, lesson, sources, status } =
      previous ?? entry;
    await this.coding.memory.correct(
      owner,
      project,
      entry.id,
      entry.revision,
      {
        kind,
        title,
        content,
        observedAt,
        tags,
        targets,
        lesson,
        sources,
        status: previous ? status : 'retired',
      },
      (db, selection) => this.transition(db, project, id, version, 'revert', selection),
    );
    return this.read(owner, project, id);
  }
}
