import { createHash } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import type { z } from 'zod';
import { jobSchema, jobAttemptSchema, jobEventSchema, jobInput } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { JobQueue } from './queue.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const stamp = (value: Date | null) => value?.toISOString() ?? null;
function dto(row: QueryResultRow) {
  return jobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    requestId: row.request_id,
    title: row.title,
    kind: row.kind,
    configuration: row.configuration,
    state: row.state,
    attempt: row.attempt,
    completedSteps: row.completed_steps,
    usedUnits: row.used_units,
    usedCostMicros: row.used_cost_micros,
    cancelRequested: row.cancel_requested,
    executorId: row.executor_id,
    executorConnected: !!row.connected,
    availableAt: stamp(row.available_at),
    firstStartedAt: stamp(row.first_started_at),
    deadlineAt: stamp(row.deadline_at),
    finishedAt: stamp(row.finished_at),
    createdAt: stamp(row.created_at),
    updatedAt: stamp(row.updated_at),
    eventSequence: row.event_sequence,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    result: row.result,
  });
}
export class JobService {
  readonly queue: JobQueue;
  constructor(readonly pool: Pool) {
    this.queue = new JobQueue(pool);
  }
  private async project(owner: string, project: string) {
    if (
      !(
        await this.pool.query('SELECT 1 FROM projects WHERE owner_id=$1 AND id=$2', [
          owner,
          project,
        ])
      ).rowCount
    )
      throw missing();
  }
  private async owned(owner: string, project: string, id: string) {
    await this.project(owner, project);
    const row = (
      await this.pool.query(
        `SELECT j.*,COALESCE(e.stopped_at IS NULL AND e.last_seen_at>clock_timestamp()-interval '5 seconds' AND j.lease_until>clock_timestamp() AND j.state='running',false) AS connected FROM jobs j LEFT JOIN job_executors e ON e.id=j.executor_id WHERE j.project_id=$1 AND j.id=$2`,
        [project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }
  async list(owner: string, project: string) {
    await this.project(owner, project);
    await this.queue.recover();
    const rows = (
      await this.pool.query(
        `SELECT j.*,COALESCE(e.stopped_at IS NULL AND e.last_seen_at>clock_timestamp()-interval '5 seconds' AND j.lease_until>clock_timestamp() AND j.state='running',false) AS connected FROM jobs j LEFT JOIN job_executors e ON e.id=j.executor_id WHERE j.project_id=$1 ORDER BY j.created_at DESC,j.id LIMIT 100`,
        [project],
      )
    ).rows;
    return { jobs: rows.map(dto) };
  }
  async create(owner: string, project: string, body: z.infer<typeof jobInput>) {
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const id = await this.queue.tx(async (db) => {
      const p = (
        await db.query('SELECT * FROM projects WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
          owner,
          project,
        ])
      ).rows[0];
      if (!p) throw missing();
      const old = (
        await db.query('SELECT id,request_hash FROM jobs WHERE project_id=$1 AND request_id=$2', [
          project,
          body.requestId,
        ])
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash)
          throw new HttpError(
            409,
            'request_conflict',
            'Este identificador corresponde a otro trabajo.',
          );
        return old.id as string;
      }
      if (p.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de crear un trabajo.',
        );
      const count = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('pending','running'))::int AS active FROM jobs WHERE project_id=$1",
          [project],
        )
      ).rows[0];
      if (count.total >= 1000 || count.active >= 50)
        throw new HttpError(
          422,
          'job_limit',
          'Límite de 50 trabajos activos o 1000 guardados por proyecto.',
        );
      const row = (
        await db.query(
          "INSERT INTO jobs(project_id,request_id,request_hash,title,kind,configuration) VALUES($1,$2,$3,$4,'simulation-v1',$5) RETURNING id",
          [
            project,
            body.requestId,
            hash,
            body.title,
            JSON.stringify({ simulation: body.simulation, limits: body.limits }),
          ],
        )
      ).rows[0];
      await this.queue.event(db, row.id, 'queued', 'Trabajo guardado en la cola persistente.');
      return row.id as string;
    });
    return this.detail(owner, project, id);
  }
  async detail(owner: string, project: string, id: string) {
    await this.owned(owner, project, id);
    await this.queue.recover();
    const row = await this.owned(owner, project, id),
      attempts = (
        await this.pool.query('SELECT * FROM job_attempts WHERE job_id=$1 ORDER BY attempt', [id])
      ).rows;
    return {
      job: dto(row),
      attempts: attempts.map((r) =>
        jobAttemptSchema.parse({
          jobId: id,
          attempt: r.attempt,
          executorId: r.executor_id,
          state: r.state,
          processPid: r.process_pid,
          startedAt: stamp(r.started_at),
          finishedAt: stamp(r.finished_at),
          exitCode: r.exit_code,
          exitSignal: r.exit_signal,
          terminationConfirmed: r.termination_confirmed,
          errorCode: r.error_code,
        }),
      ),
      limits: {
        globalConcurrency: 2 as const,
        projectConcurrency:
          (
            await this.pool.query(
              'SELECT r.parallelism FROM team_execution_steps s JOIN team_executions r ON r.id=s.execution_id WHERE s.job_id=$1',
              [id],
            )
          ).rows[0]?.parallelism ?? 1,
      },
    };
  }
  async events(owner: string, project: string, id: string, after: number) {
    await this.owned(owner, project, id);
    const rows = (
        await this.pool.query(
          'SELECT * FROM job_events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101',
          [id, after],
        )
      ).rows,
      events = rows.slice(0, 100).map((r) =>
        jobEventSchema.parse({
          jobId: id,
          sequence: r.sequence,
          attempt: r.attempt,
          executorId: r.executor_id,
          type: r.type,
          message: r.message,
          data: r.data,
          createdAt: stamp(r.created_at),
        }),
      );
    return { events, nextCursor: events.at(-1)?.sequence ?? after, hasMore: rows.length > 100 };
  }
  async cancel(owner: string, project: string, id: string) {
    await this.owned(owner, project, id);
    await this.queue.cancel(id, project);
    return this.detail(owner, project, id);
  }
}
