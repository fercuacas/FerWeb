import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  executionBudgetSchema,
  type executionBudgetInput,
  type executionBudgetLimits,
  type requestAdmissionInput,
  type requestUsageInput,
  type usageAttribution,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { canonical, digest } from './review-artifacts.js';

type Transaction = <T>(action: (db: PoolClient) => Promise<T>) => Promise<T>;
const budgetMessages: Record<string, string> = {
  request_budget_exhausted:
    'El presupuesto no tiene cupo para reservar o admitir estas peticiones.',
  budget_cancelled: 'El presupuesto está cancelado.',
  budget_timeout: 'El plazo compartido del presupuesto ha terminado.',
  project_archived: 'Restaura el proyecto antes de crear un presupuesto.',
  request_conflict: 'Este identificador ya se usó con otras condiciones.',
  lease_lost: 'La generación del paso ya no está vigente.',
};
const denied = (code: string) =>
  new HttpError(409, code, budgetMessages[code] ?? 'El presupuesto no permite esta operación.');
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const allocations = `SELECT s.*, j.error_code, count(a.request_id)::int AS admitted,
  count(a.request_id) FILTER (WHERE a.usage IS NOT NULL)::int AS reported,
  sum((a.usage->>'inputTokens')::numeric) AS input_tokens,
  sum((a.usage->>'outputTokens')::numeric) AS output_tokens
  FROM execution_budget_steps s JOIN jobs j ON j.id=s.job_id
  LEFT JOIN execution_request_admissions a ON a.job_id=s.job_id
  WHERE s.budget_id=ANY($1::uuid[]) GROUP BY s.job_id,j.error_code`;

export class ExecutionBudgets {
  constructor(
    readonly pool: Pool,
    private readonly tx: Transaction,
  ) {}

  private async parent(db: Pool | PoolClient, project: string, id: string, lock = false) {
    const result = await db.query(
      `SELECT *,clock_timestamp() AS server_now FROM execution_budgets WHERE project_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [project, id],
    );
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }
  private usable(row: QueryResultRow) {
    if (row.cancelled_at) throw denied('budget_cancelled');
    if (row.deadline_at && row.deadline_at <= row.server_now) throw denied('budget_timeout');
  }
  private async owner(db: Pool | PoolClient, owner: string, project: string) {
    const p = (
      await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2', [
        project,
        owner,
      ])
    ).rows[0];
    if (!p) throw missing();
    return p;
  }
  async create(owner: string, project: string, input: z.infer<typeof executionBudgetInput>) {
    const id = await this.tx(async (db) => {
      const p = await this.owner(db, owner, project);
      const hash = digest(canonical(input));
      const prior = (
        await db.query(
          'SELECT id,request_hash FROM execution_budgets WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw denied('request_conflict');
        return prior.id as string;
      }
      if (p.archived_at) throw denied('project_archived');
      // Serialize creation and archive using the existing project lock.
      const locked = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 FOR UPDATE', [project])
      ).rows[0];
      if (locked.archived_at) throw denied('project_archived');
      const old = (
        await db.query(
          'SELECT id,request_hash FROM execution_budgets WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw denied('request_conflict');
        return old.id as string;
      }
      return this.insert(db, project, input.name, input.limits, input.requestId, hash);
    });
    return this.read(owner, project, id);
  }
  async insert(
    db: PoolClient,
    project: string,
    name: string,
    limits: z.infer<typeof executionBudgetLimits>,
    requestId: string = randomUUID(),
    hash = '',
  ) {
    const count = (
      await db.query('SELECT count(*)::int AS n FROM execution_budgets WHERE project_id=$1', [
        project,
      ])
    ).rows[0].n;
    if (count >= 1000) throw denied('budget_limit');
    const row = (
      await db.query(
        'INSERT INTO execution_budgets(project_id,request_id,request_hash,name,max_requests,timeout_ms) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [project, requestId, hash, name, limits.maxRequests, limits.timeoutMs],
      )
    ).rows[0];
    return row.id as string;
  }
  async allocate(
    db: PoolClient,
    project: string,
    jobId: string,
    name: string,
    limits: z.infer<typeof executionBudgetLimits>,
    parentId?: string,
    attribution: z.infer<typeof usageAttribution> = 'agent',
    parentLimits: z.infer<typeof executionBudgetLimits> = limits,
  ) {
    const id = parentId ?? (await this.insert(db, project, name, parentLimits));
    const parent = await this.parent(db, project, id, true);
    this.usable(parent);
    const steps = (await db.query(allocations, [[id]])).rows;
    const held = steps.reduce(
      (sum, step) => sum + (step.released ? step.admitted : step.request_limit),
      0,
    );
    if (held + limits.maxRequests > parent.max_requests) throw denied('request_budget_exhausted');
    await db.query(
      'INSERT INTO execution_budget_steps(job_id,budget_id,attribution,request_limit) VALUES($1,$2,$3,$4)',
      [jobId, id, attribution, limits.maxRequests],
    );
    return {
      maxRequests: parent.max_requests as number,
      timeoutMs: parent.timeout_ms as number,
      concurrency: 1 as const,
    };
  }
  async activate(db: PoolClient, row: QueryResultRow) {
    if (row.kind !== 'codex-v1') return row;
    let step = (await db.query('SELECT * FROM execution_budget_steps WHERE job_id=$1', [row.id]))
      .rows[0];
    if (!step) {
      await this.allocate(db, row.project_id, row.id, row.title, {
        maxRequests: row.configuration.maxRequests,
        timeoutMs: row.configuration.limits.timeoutMs,
        concurrency: 1,
      });
      step = (await db.query('SELECT * FROM execution_budget_steps WHERE job_id=$1', [row.id]))
        .rows[0];
    }
    const parent = await this.parent(db, row.project_id, step.budget_id, true);
    this.usable(parent);
    const active = (
      await db.query(
        "SELECT count(*)::int AS n FROM execution_budget_steps s JOIN jobs j ON j.id=s.job_id WHERE s.budget_id=$1 AND j.state='running' AND j.id<>$2",
        [parent.id, row.id],
      )
    ).rows[0].n;
    if (active >= parent.concurrency) throw denied('budget_concurrency');
    const updated = (
      await db.query(
        "UPDATE execution_budgets SET deadline_at=COALESCE(deadline_at,clock_timestamp()+timeout_ms*interval '1 millisecond') WHERE id=$1 RETURNING deadline_at",
        [parent.id],
      )
    ).rows[0];
    await db.query('UPDATE execution_budget_steps SET fence=$2 WHERE job_id=$1 AND NOT released', [
      row.id,
      row.fence,
    ]);
    return (
      await db.query('UPDATE jobs SET deadline_at=LEAST(deadline_at,$2) WHERE id=$1 RETURNING *', [
        row.id,
        updated.deadline_at,
      ])
    ).rows[0];
  }
  async release(db: PoolClient, id: string, fence: string | null) {
    const step = (
      await db.query('SELECT budget_id FROM execution_budget_steps WHERE job_id=$1', [id])
    ).rows[0];
    if (!step) return;
    await db.query('SELECT id FROM execution_budgets WHERE id=$1 FOR UPDATE', [step.budget_id]);
    await db.query(
      'UPDATE execution_budget_steps SET released=true WHERE job_id=$1 AND fence IS NOT DISTINCT FROM $2::uuid',
      [id, fence],
    );
  }
  async admit(id: string, input: z.infer<typeof requestAdmissionInput>) {
    return this.tx(async (db) => {
      const row = (
        await db.query(
          'SELECT j.*,p.archived_at,clock_timestamp() AS server_now FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=$1 FOR UPDATE OF j',
          [id],
        )
      ).rows[0];
      if (
        !row ||
        row.fence !== input.fence ||
        row.state !== 'running' ||
        row.lease_until <= row.server_now
      )
        throw denied('lease_lost');
      if (row.cancel_requested || row.archived_at) throw denied('budget_cancelled');
      if (row.deadline_at <= row.server_now) throw denied('budget_timeout');
      const step = (await db.query('SELECT * FROM execution_budget_steps WHERE job_id=$1', [id]))
        .rows[0];
      if (!step || step.fence !== input.fence || step.released) throw denied('lease_lost');
      const parent = await this.parent(db, row.project_id, step.budget_id, true);
      this.usable(parent);
      const now = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
      if (row.lease_until <= now) throw denied('lease_lost');
      if (row.deadline_at <= now || (parent.deadline_at && parent.deadline_at <= now))
        throw denied('budget_timeout');
      const prior = (
        await db.query(
          'SELECT payload_hash,fence FROM execution_request_admissions WHERE job_id=$1 AND request_id=$2',
          [id, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== input.payloadHash || prior.fence !== input.fence)
          throw denied('request_conflict');
        return { admitted: true, repeated: true };
      }
      const used = (
        await db.query(
          'SELECT count(*)::int AS n FROM execution_request_admissions WHERE job_id=$1',
          [id],
        )
      ).rows[0].n;
      if (used >= step.request_limit) throw denied('request_budget_exhausted');
      await db.query(
        'INSERT INTO execution_request_admissions(job_id,request_id,fence,payload_hash) VALUES($1,$2,$3,$4)',
        [id, input.requestId, input.fence, input.payloadHash],
      );
      return { admitted: true, repeated: false };
    });
  }
  async recordUsage(id: string, input: z.infer<typeof requestUsageInput>) {
    await this.tx(async (db) => {
      const row = (
        await db.query(
          'SELECT a.* FROM execution_request_admissions a JOIN execution_budget_steps s ON s.job_id=a.job_id WHERE a.job_id=$1 AND a.request_id=$2 AND a.fence=$3 AND s.fence=$3 FOR UPDATE OF a',
          [id, input.requestId, input.fence],
        )
      ).rows[0];
      if (!row) throw denied('lease_lost');
      if (row.settled) {
        if (canonical(row.usage) !== canonical(input.usage)) throw denied('usage_conflict');
        return;
      }
      await db.query(
        'UPDATE execution_request_admissions SET usage=$3,settled=true WHERE job_id=$1 AND request_id=$2',
        [id, input.requestId, input.usage ? JSON.stringify(input.usage) : null],
      );
    });
  }
  async cancel(owner: string, project: string, id: string) {
    await this.tx(async (db) => {
      await this.owner(db, owner, project);
      await this.parent(db, project, id, true);
      await db.query(
        'UPDATE execution_budgets SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE id=$1',
        [id],
      );
    });
    return this.read(owner, project, id);
  }
  async read(owner: string, project: string, id: string) {
    await this.owner(this.pool, owner, project);
    const parent = await this.parent(this.pool, project, id);
    const steps = (await this.pool.query(allocations, [[id]])).rows;
    return this.report(parent, steps);
  }
  private report(parent: QueryResultRow, steps: QueryResultRow[]) {
    const reserved = steps.reduce(
      (sum, step) => sum + (step.released ? step.admitted : step.request_limit),
      0,
    );
    const known = (key: string) => {
      const values = steps.map((step) => step[key]).filter((value) => value !== null);
      const sum = values.reduce((total, value) => total + Number(value), 0);
      return values.length && Number.isSafeInteger(sum) ? sum : null;
    };
    return executionBudgetSchema.parse({
      id: parent.id,
      name: parent.name,
      limits: {
        maxRequests: parent.max_requests,
        timeoutMs: parent.timeout_ms,
        concurrency: parent.concurrency,
      },
      deadlineAt: parent.deadline_at?.toISOString() ?? null,
      cancelledAt: parent.cancelled_at?.toISOString() ?? null,
      stopReason: parent.cancelled_at
        ? 'cancelled'
        : parent.deadline_at && parent.deadline_at <= parent.server_now
          ? 'timeout'
          : null,
      reservedRequests: reserved,
      admittedRequests: steps.reduce((sum, step) => sum + step.admitted, 0),
      availableRequests: parent.max_requests - reserved,
      reportedRequests: steps.reduce((sum, step) => sum + step.reported, 0),
      knownInputTokens: known('input_tokens'),
      knownOutputTokens: known('output_tokens'),
      costUsd: null,
      steps: steps.map((step) => ({
        jobId: step.job_id,
        attribution: step.attribution,
        requestLimit: step.request_limit,
        admittedRequests: step.admitted,
        released: step.released,
        stopReason: step.error_code,
      })),
    });
  }
  async forJob(owner: string, project: string, id: string) {
    const step = (
      await this.pool.query('SELECT budget_id FROM execution_budget_steps WHERE job_id=$1', [id])
    ).rows[0];
    return step ? this.read(owner, project, step.budget_id) : null;
  }
  async list(owner: string, project: string) {
    await this.owner(this.pool, owner, project);
    const rows = (
      await this.pool.query(
        'SELECT *,clock_timestamp() AS server_now FROM execution_budgets WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT 100',
        [project],
      )
    ).rows;
    const steps = (await this.pool.query(allocations, [rows.map((row) => row.id)])).rows;
    return {
      budgets: rows.map((row) =>
        this.report(
          row,
          steps.filter((step) => step.budget_id === row.id),
        ),
      ),
    };
  }
}
