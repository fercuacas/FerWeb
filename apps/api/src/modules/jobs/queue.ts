import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  jobConfiguration,
  anyJobConfiguration,
  codingReport,
  type JobConfiguration,
} from '@ferweb/contracts';
import type { z } from 'zod';

export class JobControlError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface Claim {
  id: string;
  project_id: string;
  attempt: number;
  fence: string;
  executor_id: string;
  completed_steps: number;
  kind: 'simulation-v1' | 'codex-v1';
  configuration: z.infer<typeof anyJobConfiguration>;
  lease_until: Date;
  deadline_at: Date;
}
export class JobQueue {
  constructor(
    readonly pool: Pool,
    readonly leaseMs = 5000,
  ) {
    if (leaseMs < 2000 || leaseMs > 30000) throw new Error('Invalid lease');
  }
  async tx<T>(action: (db: PoolClient) => Promise<T>, mutex = false) {
    const db = await this.pool.connect();
    let connectionError: Error | undefined;
    const onConnectionError = (error: Error) => {
      connectionError = error;
    };
    db.on('error', onConnectionError);
    try {
      await db.query('BEGIN');
      // A SIGSTOP or disconnected executor must not retain queue locks forever.
      // Queue transactions contain SQL only, never provider or repository work.
      await db.query("SET LOCAL idle_in_transaction_session_timeout = '1000ms'");
      if (mutex) await db.query('SELECT pg_advisory_xact_lock(736019247)');
      const result = await action(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        connectionError =
          rollbackError instanceof Error ? rollbackError : new Error('queue_connection_lost');
      }
      throw error;
    } finally {
      db.removeListener('error', onConnectionError);
      db.release(connectionError);
    }
  }
  async event(
    db: PoolClient,
    id: string,
    type: string,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    const row = (
      await db.query(
        'UPDATE jobs SET event_sequence=event_sequence+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING event_sequence,attempt,executor_id',
        [id],
      )
    ).rows[0];
    await db.query(
      'INSERT INTO job_events(job_id,sequence,attempt,executor_id,type,message,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, row.event_sequence, row.attempt, row.executor_id, type, message, JSON.stringify(data)],
    );
  }
  private async row(db: PoolClient, id: string) {
    const row = (
      await db.query(
        'SELECT j.*,EXISTS(SELECT 1 FROM projects p WHERE p.id=j.project_id AND p.archived_at IS NOT NULL) AS archived,clock_timestamp() AS server_now FROM jobs j WHERE j.id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!row) throw new JobControlError('job_missing');
    return row;
  }
  private guard(row: QueryResultRow, claim: Claim) {
    if (
      row.state !== 'running' ||
      row.fence !== claim.fence ||
      row.executor_id !== claim.executor_id ||
      row.lease_until <= row.server_now
    )
      throw new JobControlError('lease_lost');
    if (row.cancel_requested || row.archived) throw new JobControlError('cancelled');
    if (row.deadline_at <= row.server_now) throw new JobControlError('timeout');
  }
  private async terminal(
    db: PoolClient,
    row: QueryResultRow,
    state: 'completed' | 'failed' | 'cancelled',
    code: string | null,
    message: string,
  ) {
    const result =
      row.kind === 'codex-v1'
        ? { kind: 'codex-v1', runId: row.id }
        : {
            kind: 'simulation-v1',
            completedSteps: row.completed_steps,
            effectKeys: Array.from(
              { length: row.completed_steps },
              (_v, i) => `${row.id}/step/${i + 1}`,
            ),
            simulated: true,
          };
    await db.query(
      'UPDATE jobs SET state=$2,finished_at=clock_timestamp(),lease_until=NULL,fence=NULL,result=$3,error_code=$4,error_message=$5 WHERE id=$1',
      [row.id, state, JSON.stringify(result), code, code ? message : null],
    );
    await this.event(db, row.id, state, message, { completedSteps: row.completed_steps });
  }
  private async settle(db: PoolClient, row: QueryResultRow, reason: string, retryable: boolean) {
    if (row.kind === 'codex-v1') {
      const cancelled = row.cancel_requested || row.archived || reason === 'cancelled';
      const completed =
        !cancelled &&
        reason === 'completed' &&
        (!row.deadline_at || row.deadline_at > row.server_now);
      await this.terminal(
        db,
        row,
        cancelled ? 'cancelled' : completed ? 'completed' : 'failed',
        completed ? null : cancelled ? 'cancelled' : reason === 'completed' ? 'timeout' : reason,
        completed
          ? 'Ejecución de código terminada; revisa diff y evidencias.'
          : 'Ejecución de código detenida. No se reintenta automáticamente.',
      );
      return;
    }
    const cfg = jobConfiguration.parse(row.configuration),
      now = row.server_now as Date;
    if (row.cancel_requested || row.archived || reason === 'cancelled') {
      await this.terminal(
        db,
        row,
        'cancelled',
        'cancelled',
        'Trabajo cancelado; los pasos confirmados se conservan.',
      );
      return;
    }
    if (row.completed_steps >= cfg.simulation.steps) {
      await this.terminal(db, row, 'completed', null, 'Todos los pasos están confirmados.');
      return;
    }
    if ((row.deadline_at && row.deadline_at <= now) || reason === 'timeout') {
      await this.terminal(
        db,
        row,
        'failed',
        'timeout',
        'Se ha agotado el plazo total del trabajo.',
      );
      return;
    }
    if (
      reason === 'budget_exceeded' ||
      row.used_units + cfg.simulation.unitsPerStep > cfg.limits.budgetUnits ||
      row.used_cost_micros + cfg.simulation.costMicrosPerStep > cfg.limits.budgetMicros
    ) {
      await this.terminal(
        db,
        row,
        'failed',
        'budget_exceeded',
        'El presupuesto acumulado no permite otro paso.',
      );
      return;
    }
    if (retryable && row.attempt < cfg.limits.maxAttempts) {
      const delayMs = Math.min(2000, 500 * 2 ** (row.attempt - 1));
      await db.query(
        "UPDATE jobs SET state='pending',available_at=clock_timestamp()+$2::int*interval '1 millisecond',fence=NULL,lease_until=NULL,error_code=$3,error_message='Reintento controlado pendiente.' WHERE id=$1",
        [row.id, delayMs, reason],
      );
      await this.event(db, row.id, 'retry_scheduled', 'Reintento programado desde el checkpoint.', {
        reason,
        delayMs,
      });
      return;
    }
    await this.terminal(
      db,
      row,
      'failed',
      retryable ? 'attempts_exhausted' : reason,
      retryable
        ? 'Se ha alcanzado el máximo de intentos.'
        : 'El proceso ha fallado sin reintento permitido.',
    );
  }
  private async reap(db: PoolClient) {
    const candidates = (
      await db.query(
        `SELECT j.id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE (j.state='running' AND j.lease_until+interval '1 second'<clock_timestamp()) OR (j.state='pending' AND (j.cancel_requested OR p.archived_at IS NOT NULL OR j.deadline_at<clock_timestamp())) ORDER BY j.created_at LIMIT 100 FOR UPDATE OF j SKIP LOCKED`,
      )
    ).rows;
    for (const candidate of candidates) {
      const row = await this.row(db, candidate.id);
      if (row.state === 'running') {
        await db.query(
          "UPDATE job_attempts SET state='lost',finished_at=clock_timestamp(),error_code='executor_lost',termination_confirmed=NULL WHERE job_id=$1 AND attempt=$2 AND state='running'",
          [row.id, row.attempt],
        );
        await this.event(
          db,
          row.id,
          'executor_lost',
          'Ejecutor sin lease vigente; sus resultados ya no se aceptan.',
        );
        await this.settle(db, row, 'executor_lost', true);
      } else
        await this.settle(
          db,
          row,
          row.cancel_requested || row.archived ? 'cancelled' : 'timeout',
          false,
        );
    }
  }
  async recover() {
    await this.tx((db) => this.reap(db), true);
  }
  async register(id: string) {
    await this.pool.query('INSERT INTO job_executors(id) VALUES($1)', [id]);
  }
  async executorHeartbeat(id: string) {
    await this.pool.query(
      'UPDATE job_executors SET last_seen_at=clock_timestamp() WHERE id=$1 AND stopped_at IS NULL',
      [id],
    );
  }
  async stopExecutor(id: string) {
    await this.pool.query('UPDATE job_executors SET stopped_at=clock_timestamp() WHERE id=$1', [
      id,
    ]);
  }
  async claim(executor: string): Promise<Claim | null> {
    return this.tx(async (db) => {
      await this.reap(db);
      const count = (await db.query("SELECT count(*)::int AS n FROM jobs WHERE state='running'"))
        .rows[0].n;
      if (count >= 2) return null;
      const row = (
        await db.query(
          `SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.state='pending' AND NOT j.cancel_requested AND p.archived_at IS NULL AND j.available_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM jobs busy WHERE busy.project_id=j.project_id AND busy.state='running') ORDER BY j.available_at,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
        )
      ).rows[0];
      if (!row) return null;
      const cfg = anyJobConfiguration.parse(row.configuration),
        fence = randomUUID();
      const updated = (
        await db.query(
          "UPDATE jobs SET state='running',attempt=attempt+1,executor_id=$2,fence=$3,lease_until=clock_timestamp()+$4::int*interval '1 millisecond',first_started_at=COALESCE(first_started_at,clock_timestamp()),deadline_at=COALESCE(deadline_at,clock_timestamp()+$5::int*interval '1 millisecond'),error_code=NULL,error_message=NULL WHERE id=$1 RETURNING *",
          [row.id, executor, fence, this.leaseMs, cfg.limits.timeoutMs],
        )
      ).rows[0];
      await db.query('INSERT INTO job_attempts(job_id,attempt,executor_id) VALUES($1,$2,$3)', [
        row.id,
        updated.attempt,
        executor,
      ]);
      await this.event(db, row.id, 'claimed', 'Trabajo asignado a un ejecutor.', {
        checkpoint: row.completed_steps,
      });
      return { ...updated, configuration: cfg } as Claim;
    }, true);
  }
  async heartbeat(claim: Claim) {
    return this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      this.guard(row, claim);
      const updated = (
        await db.query(
          "UPDATE jobs SET lease_until=clock_timestamp()+$2::int*interval '1 millisecond' WHERE id=$1 RETURNING lease_until,deadline_at",
          [claim.id, this.leaseMs],
        )
      ).rows[0];
      return {
        leaseExpiresAt: updated.lease_until.toISOString() as string,
        deadlineAt: updated.deadline_at.toISOString() as string,
      };
    });
  }
  async processStarted(claim: Claim, pid: number) {
    await this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      this.guard(row, claim);
      await db.query('UPDATE job_attempts SET process_pid=$3 WHERE job_id=$1 AND attempt=$2', [
        claim.id,
        claim.attempt,
        pid,
      ]);
      await this.event(db, claim.id, 'process_started', 'Proceso de simulación iniciado.', { pid });
    });
  }
  async reserve(claim: Claim, step: number) {
    const cfg = jobConfiguration.parse(claim.configuration);
    return this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      this.guard(row, claim);
      if (step <= row.completed_steps) return { committed: true };
      if (step !== row.completed_steps + 1 || step > cfg.simulation.steps)
        throw new JobControlError('protocol_error');
      const previous = await db.query(
        'SELECT 1 FROM job_charges WHERE job_id=$1 AND attempt=$2 AND step=$3',
        [claim.id, claim.attempt, step],
      );
      if (previous.rowCount) return { committed: false };
      const { simulation: s, limits: l } = cfg;
      if (
        row.used_units + s.unitsPerStep > l.budgetUnits ||
        row.used_cost_micros + s.costMicrosPerStep > l.budgetMicros
      )
        throw new JobControlError('budget_exceeded');
      await db.query(
        'INSERT INTO job_charges(job_id,attempt,step,units,cost_micros) VALUES($1,$2,$3,$4,$5)',
        [claim.id, claim.attempt, step, s.unitsPerStep, s.costMicrosPerStep],
      );
      await db.query(
        'UPDATE jobs SET used_units=used_units+$2,used_cost_micros=used_cost_micros+$3 WHERE id=$1',
        [claim.id, s.unitsPerStep, s.costMicrosPerStep],
      );
      await this.event(
        db,
        claim.id,
        'step_reserved',
        'Presupuesto reservado para un paso simulado.',
        { step, units: s.unitsPerStep, simulatedCostMicros: s.costMicrosPerStep },
      );
      return { committed: false };
    });
  }
  async commitStep(claim: Claim, step: number) {
    const cfg = jobConfiguration.parse(claim.configuration);
    await this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      this.guard(row, claim);
      if (step <= row.completed_steps) return;
      if (step !== row.completed_steps + 1) throw new JobControlError('protocol_error');
      const charge = await db.query(
        'SELECT 1 FROM job_charges WHERE job_id=$1 AND attempt=$2 AND step=$3',
        [claim.id, claim.attempt, step],
      );
      if (!charge.rowCount) throw new JobControlError('protocol_error');
      await db.query(
        'INSERT INTO job_effects(job_id,step,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [claim.id, step, JSON.stringify({ key: `${claim.id}/step/${step}`, simulated: true })],
      );
      await db.query('UPDATE jobs SET completed_steps=$2 WHERE id=$1', [claim.id, step]);
      await this.event(db, claim.id, 'progress', 'Paso confirmado y checkpoint guardado.', {
        step,
        total: cfg.simulation.steps,
        percent: Math.floor((step / cfg.simulation.steps) * 100),
      });
    });
  }
  async finish(
    claim: Claim,
    reason: string,
    exitCode: number | null,
    signal: string | null,
    confirmed: boolean | null,
    report?: z.infer<typeof codingReport>,
  ) {
    return this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      if (row.state !== 'running' || row.fence !== claim.fence) return false;
      if (report)
        await db.query('UPDATE coding_runs SET report=$2 WHERE job_id=$1', [
          claim.id,
          JSON.stringify(codingReport.parse(report)),
        ]);
      const cancelled = row.cancel_requested || row.archived || reason === 'cancelled',
        state = cancelled
          ? 'cancelled'
          : exitCode === 0 && reason === 'completed'
            ? 'completed'
            : 'failed';
      await db.query(
        'UPDATE job_attempts SET state=$3,finished_at=clock_timestamp(),exit_code=$4,exit_signal=$5,termination_confirmed=$6,error_code=$7 WHERE job_id=$1 AND attempt=$2',
        [
          claim.id,
          claim.attempt,
          state,
          exitCode,
          signal,
          confirmed,
          reason === 'completed' ? null : reason,
        ],
      );
      await this.event(db, claim.id, 'process_exited', 'El proceso de trabajo ha terminado.', {
        exitCode,
        signal,
        reason,
        terminationConfirmed: confirmed,
      });
      await this.settle(
        db,
        row,
        reason,
        ['transient_failure', 'executor_shutdown', 'executor_lost', 'spawn_failed'].includes(
          reason,
        ),
      );
      return true;
    }, true);
  }
  async codingProgress(claim: Claim, phase: string | null, report: unknown) {
    await this.tx(async (db) => {
      const row = await this.row(db, claim.id);
      this.guard(row, claim);
      if (report)
        await db.query('UPDATE coding_runs SET report=$2 WHERE job_id=$1', [
          claim.id,
          JSON.stringify(codingReport.parse(report)),
        ]);
      await this.event(
        db,
        claim.id,
        'coding_progress',
        'Ejecución de código: ' + (phase ?? 'en curso').slice(0, 80),
      );
    });
  }
  async cancel(id: string, project: string) {
    await this.tx(async (db) => {
      const row = (
        await db.query(
          'SELECT j.*,clock_timestamp() AS server_now FROM jobs j WHERE id=$1 AND project_id=$2 FOR UPDATE',
          [id, project],
        )
      ).rows[0];
      if (!row) throw new JobControlError('job_missing');
      if (!['pending', 'running'].includes(row.state) || row.cancel_requested) return;
      await db.query('UPDATE jobs SET cancel_requested=true WHERE id=$1', [id]);
      await this.event(db, id, 'cancel_requested', 'Cancelación solicitada.');
      if (row.state === 'pending')
        await this.terminal(
          db,
          { ...row, cancel_requested: true },
          'cancelled',
          'cancelled',
          'Trabajo cancelado antes de asignarlo.',
        );
    });
  }
}
