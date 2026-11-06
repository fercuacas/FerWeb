import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  teamPlanSnapshot,
  teamExecution,
  teamExecutionResponse,
  teamDelivery,
  codingReport,
  codingWorkspace,
  type executeTeamPlanInput,
  teamPolicy,
  type updateTeamPolicyInput,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { TeamService } from './service.js';
import { TeamMessages, systemTeamMessage } from './messages.js';
import { gatherDimensionalReview } from '../jobs/dimension-reviews.js';

const active = (state: string) => ['pending', 'running'].includes(state);
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado la ejecución.');
const conflict = (code = 'team_changed') =>
  new HttpError(409, code, 'Las condiciones han cambiado o la ejecución ya no admite esta acción.');
const dto = (row: QueryResultRow) =>
  teamExecution.parse({
    id: row.id,
    projectId: row.project_id,
    planId: row.plan_id,
    planHash: row.snapshot.hash,
    title: row.snapshot.plan.task.title,
    state: row.state,
    cancelRequested: row.cancel_requested,
    commit: row.commit_sha,
    repository: row.repository,
    budgetId: row.budget_id,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  });
export async function teamEvent(
  db: PoolClient,
  id: string,
  type: string,
  message: string,
  data = {},
) {
  const row = (
    await db.query(
      'UPDATE team_executions SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
      [id],
    )
  ).rows[0];
  await db.query(
    'INSERT INTO team_execution_events(execution_id,sequence,type,message,data) VALUES($1,$2,$3,$4,$5)',
    [id, row.event_sequence, type, message, JSON.stringify(data)],
  );
}
export class TeamExecutions {
  private readonly teams: TeamService;
  constructor(
    private readonly pool: Pool,
    private readonly coding: CodingService,
  ) {
    this.teams = new TeamService(pool, coding);
  }
  private async owned(owner: string, project: string, id: string) {
    const row = (
      await this.pool.query(
        'SELECT r.* FROM team_executions r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND p.id=$2 AND r.id=$3',
        [owner, project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }
  async list(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const rows = (
      await this.pool.query(
        'SELECT r.* FROM team_executions r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND p.id=$2 ORDER BY r.created_at DESC,r.id LIMIT 100',
        [owner, project],
      )
    ).rows;
    return { executions: rows.map(dto) };
  }
  async policy(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const row = (
      await this.pool.query(
        'SELECT team_parallelism,team_policy_version FROM projects WHERE id=$1',
        [project],
      )
    ).rows[0];
    return teamPolicy.parse({
      parallelism: row.team_parallelism,
      version: row.team_policy_version,
    });
  }
  async configure(owner: string, project: string, input: z.infer<typeof updateTeamPolicyInput>) {
    await this.coding.jobs.queue.tx(async (db) => {
      const row = (
        await db.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!row) throw missing();
      if (
        row.archived_at ||
        row.team_policy_version !== input.version ||
        (
          await db.query(
            "SELECT 1 FROM team_executions WHERE project_id=$1 AND state IN ('pending','running')",
            [project],
          )
        ).rowCount
      )
        throw conflict('team_policy_conflict');
      await db.query(
        'UPDATE projects SET team_parallelism=$2,team_policy_version=team_policy_version+1 WHERE id=$1',
        [project, input.parallelism],
      );
    });
    return this.policy(owner, project);
  }
  messages(owner: string, project: string, id: string, after: number) {
    return new TeamMessages(this.pool, this.coding).read(owner, project, id, after);
  }
  async read(owner: string, project: string, id: string) {
    const row = await this.owned(owner, project, id);
    if (row.snapshot.plan.memory?.length)
      await this.coding.memory.selections(owner, project, row.snapshot.plan.memory, 'history');
    // Reports and deliveries carry repository text; revalidate access before returning them.
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.repositoryId !== Number(row.repository_id))
      throw new HttpError(
        403,
        'team_source_denied',
        'No se puede confirmar acceso al repositorio.',
      );
    const steps = (
      await this.pool.query(
        'SELECT s.*,j.state,j.error_code FROM team_execution_steps s LEFT JOIN jobs j ON j.id=s.job_id WHERE s.execution_id=$1 ORDER BY s.position',
        [id],
      )
    ).rows;
    const events = (
      await this.pool.query(
        'SELECT * FROM team_execution_events WHERE execution_id=$1 ORDER BY sequence',
        [id],
      )
    ).rows;
    const conflicts = (
      await this.pool.query(
        "SELECT count(*)::int AS n FROM team_messages WHERE execution_id=$1 AND kind='conflict'",
        [id],
      )
    ).rows[0].n;
    const latestIteration = Math.max(...steps.map((s) => s.iteration));
    const required = steps
      .filter((s) => s.iteration === latestIteration)
      .filter(
        (step) =>
          row.snapshot.plan.template.definition.strategy !== 'specialists' ||
          row.snapshot.plan.steps.at(-1).key !== step.step_key,
      );
    const received = required
      .filter((step) => step.delivery?.verified)
      .map((step) => step.step_key);
    const missingSteps = required
      .filter((step) => !step.delivery?.verified)
      .map((step) => step.step_key);
    return teamExecutionResponse.parse({
      gathering: {
        complete: row.state === 'completed' && !missingSteps.length && conflicts === 0,
        received,
        missing: missingSteps,
        summary: steps.at(-1)?.delivery?.result ?? null,
        conflicts,
      },
      execution: dto(row),
      plan: row.snapshot.plan,
      steps: steps.map((step) => ({
        id: step.id,
        position: step.position,
        iteration: step.iteration,
        key: step.step_key,
        jobId: step.job_id,
        state: step.state ?? (active(row.state) ? 'pending' : 'skipped'),
        errorCode: step.error_code ?? null,
        delivery: step.delivery,
      })),
      events: events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        message: event.message,
        data: event.data,
        createdAt: event.created_at.toISOString(),
      })),
    });
  }
  async start(
    owner: string,
    project: string,
    planId: string,
    input: z.infer<typeof executeTeamPlanInput>,
  ) {
    await this.coding.projects.get(owner, project);
    const requestHash = digest(canonical({ planId, ...input }));
    const prior = (
      await this.pool.query(
        'SELECT id,request_hash FROM team_executions WHERE project_id=$1 AND request_id=$2',
        [project, input.requestId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw conflict();
      return this.read(owner, project, prior.id);
    }
    const { plan } = await this.teams.readPlan(owner, project, planId);
    if (
      plan.state !== 'approved' ||
      plan.approval?.hash !== input.hash ||
      plan.hash !== input.hash ||
      digest(canonical(plan.snapshot)) !== input.hash ||
      input.version !== plan.snapshot.version
    )
      throw conflict('team_approval_required');
    await this.teams.validateSnapshot(owner, project, plan.snapshot);
    const { link } = await this.coding.github.read(owner, project);
    if (
      !link ||
      link.revoked ||
      link.stale ||
      !link.snapshot ||
      link.snapshot.treeTruncated ||
      link.snapshot.commit !== input.commit
    )
      throw conflict('team_source_changed');
    const id = await this.coding.jobs.queue.tx(async (db) => {
      const p = (
        await db.query(
          'SELECT archived_at,team_parallelism FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [project, owner],
        )
      ).rows[0];
      if (!p || p.archived_at) throw conflict('project_archived');
      if (plan.snapshot.limits.concurrency > p.team_parallelism)
        throw conflict('team_parallelism_not_configured');
      const old = (
        await db.query(
          'SELECT id,request_hash FROM team_executions WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw conflict();
        return old.id as string;
      }
      const frozen = (
        await db.query(
          'SELECT * FROM prepared_team_plans WHERE id=$1 AND project_id=$2 FOR UPDATE',
          [planId, project],
        )
      ).rows[0];
      const task = (
        await db.query('SELECT version FROM tasks WHERE id=$1 AND project_id=$2', [
          plan.snapshot.task.id,
          project,
        ])
      ).rows[0];
      const source = (
        await db.query('SELECT version,stale,revoked FROM github_links WHERE project_id=$1', [
          project,
        ])
      ).rows[0];
      if (
        !frozen ||
        frozen.execution_id ||
        frozen.approval_hash !== input.hash ||
        task?.version !== plan.snapshot.task.version ||
        !source ||
        source.version !== link.version ||
        source.stale ||
        source.revoked
      )
        throw conflict();
      const count = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('pending','running'))::int AS active FROM team_executions WHERE project_id=$1",
          [project],
        )
      ).rows[0];
      if (count.active || count.total >= 1000) throw conflict('team_execution_limit');
      const budget = await this.coding.jobs.queue.budgets.insert(
        db,
        project,
        plan.snapshot.task.title,
        plan.snapshot.limits,
      );
      const row = (
        await db.query(
          'INSERT INTO team_executions(project_id,plan_id,request_id,request_hash,snapshot,commit_sha,repository_id,repository,link_version,budget_id,parallelism) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
          [
            project,
            planId,
            input.requestId,
            requestHash,
            JSON.stringify({ hash: plan.hash, plan: plan.snapshot }),
            input.commit,
            link.repositoryId,
            link.fullName,
            link.version,
            budget,
            plan.snapshot.limits.concurrency,
          ],
        )
      ).rows[0];
      for (const [index, step] of plan.snapshot.steps.entries())
        await db.query(
          'INSERT INTO team_execution_steps(execution_id,position,step_key) VALUES($1,$2,$3)',
          [row.id, index + 1, step.key],
        );
      await db.query('UPDATE prepared_team_plans SET execution_id=$2 WHERE id=$1', [
        planId,
        row.id,
      ]);
      await teamEvent(
        db,
        row.id,
        'queued',
        'Equipo guardado. El coordinador no consume un slot de código.',
      );
      return row.id as string;
    });
    return this.read(owner, project, id);
  }
  async cancel(owner: string, project: string, id: string) {
    await this.owned(owner, project, id);
    await this.coding.jobs.queue.tx(async (db) => {
      await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [project]);
      const row = (await db.query('SELECT * FROM team_executions WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!active(row.state) || row.cancel_requested) return;
      await db.query('UPDATE team_executions SET cancel_requested=true WHERE id=$1', [id]);
      await db.query(
        'UPDATE execution_budgets SET cancelled_at=COALESCE(cancelled_at,now()) WHERE id=$1',
        [row.budget_id],
      );
      await teamEvent(
        db,
        id,
        'cancel_requested',
        'Cancelación solicitada; no se crearán más etapas.',
      );
    });
    const jobs = (
      await this.pool.query(
        'SELECT job_id FROM team_execution_steps WHERE execution_id=$1 AND job_id IS NOT NULL',
        [id],
      )
    ).rows;
    for (const step of jobs) await this.coding.jobs.queue.cancel(step.job_id, project);
    return this.read(owner, project, id);
  }
  private async close(
    id: string,
    state: 'completed' | 'failed' | 'cancelled',
    code: string | null,
  ) {
    await this.coding.jobs.queue.tx(async (db) => {
      const row = (await db.query('SELECT * FROM team_executions WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row || !active(row.state)) return;
      const effective = row.error_code ? 'failed' : row.cancel_requested ? 'cancelled' : state;
      await db.query(
        'UPDATE team_executions SET state=$2,error_code=COALESCE(error_code,$3),finished_at=now() WHERE id=$1',
        [id, effective, code],
      );
      await teamEvent(db, id, effective, 'Equipo terminado. Consulta entregas, pruebas y dudas.', {
        code,
      });
    });
  }
  async tick() {
    await this.coding.jobs.queue.recover();
    const rows = (
      await this.pool.query(
        "SELECT r.*,p.owner_id,p.archived_at,b.cancelled_at,b.deadline_at FROM team_executions r JOIN projects p ON p.id=r.project_id JOIN execution_budgets b ON b.id=r.budget_id WHERE r.state IN ('pending','running') ORDER BY r.created_at LIMIT 20",
      )
    ).rows;
    for (const run of rows) {
      try {
        await this.advance(run);
      } catch (error) {
        // Validation failure is terminal. Retrying code or inference is never a recovery policy.
        const code = error instanceof HttpError ? error.code : 'team_coordinator_failed';
        const jobs = (
          await this.pool.query(
            "SELECT j.id FROM jobs j JOIN team_execution_steps s ON s.job_id=j.id WHERE s.execution_id=$1 AND j.state IN ('pending','running')",
            [run.id],
          )
        ).rows;
        await this.coding.jobs.queue.tx(async (db) => {
          const row = (
            await db.query('SELECT state FROM team_executions WHERE id=$1 FOR UPDATE', [run.id])
          ).rows[0];
          if (!active(row.state)) return;
          await db.query(
            'UPDATE team_executions SET error_code=$2,cancel_requested=true WHERE id=$1',
            [run.id, code],
          );
          await db.query(
            'UPDATE execution_budgets SET cancelled_at=COALESCE(cancelled_at,now()) WHERE id=$1',
            [run.budget_id],
          );
          await teamEvent(
            db,
            run.id,
            'stopping',
            'Validación fallida; deteniendo cualquier etapa activa.',
            { code },
          );
        });
        for (const job of jobs) await this.coding.jobs.queue.cancel(job.id, run.project_id);
        if (!jobs.length) await this.close(run.id, 'failed', code);
      }
    }
    return { checked: rows.length };
  }
  private async advance(run: QueryResultRow) {
    const steps = (
      await this.pool.query(
        'SELECT s.*,j.state,j.error_code,c.report,c.files,c.output_files FROM team_execution_steps s LEFT JOIN jobs j ON j.id=s.job_id LEFT JOIN coding_runs c ON c.job_id=j.id WHERE s.execution_id=$1 ORDER BY s.position',
        [run.id],
      )
    ).rows;
    const snapshot = teamPlanSnapshot.parse(run.snapshot.plan);
    const specialists = snapshot.template.definition.strategy === 'specialists';
    const stopping = run.cancel_requested || run.archived_at || run.cancelled_at;
    if (stopping) {
      for (const step of steps.filter((item) => item.job_id && active(item.state)))
        await this.coding.jobs.queue.cancel(step.job_id, run.project_id);
      if (steps.some((step) => step.job_id && active(step.state))) return;
      for (const step of steps.filter((item) => item.job_id && !item.delivery))
        await this.saveDelivery(run, step, specialists);
      await this.close(
        run.id,
        run.error_code ? 'failed' : 'cancelled',
        run.error_code ?? 'cancelled',
      );
      return;
    }
    for (const ended of steps.filter(
      (step) => step.job_id && !active(step.state) && !step.delivery,
    )) {
      ended.delivery = await this.saveDelivery(run, ended, specialists);
      if (!ended.delivery.verified) throw conflict(ended.error_code ?? 'team_delivery_unverified');
    }
    const iteration = Math.max(...steps.map((s) => s.iteration));
    const currentSteps = steps.filter((s) => s.iteration === iteration);
    if (currentSteps.every((step) => step.delivery?.verified)) {
      if (
        snapshot.reviewTarget &&
        iteration < snapshot.maxIterations &&
        gatherDimensionalReview(run, steps).blockers.length
      ) {
        await this.coding.jobs.queue.tx(async (db) => {
          const locked = (
            await db.query(
              'SELECT state,cancel_requested FROM team_executions WHERE id=$1 FOR UPDATE',
              [run.id],
            )
          ).rows[0];
          if (!active(locked.state) || locked.cancel_requested) return;
          const next = await db.query(
            'SELECT 1 FROM team_execution_steps WHERE execution_id=$1 AND iteration=$2',
            [run.id, iteration + 1],
          );
          if (next.rowCount) return;
          for (const [index, step] of snapshot.steps.entries())
            await db.query(
              'INSERT INTO team_execution_steps(execution_id,position,step_key,iteration) VALUES($1,$2,$3,$4)',
              [run.id, iteration * snapshot.steps.length + index + 1, step.key, iteration + 1],
            );
          await teamEvent(
            db,
            run.id,
            'review_correction',
            'Ronda de corrección de hallazgos con el mismo diff, criterios, presupuesto y plazo.',
            { iteration: iteration + 1 },
          );
        });
        return;
      }
      await this.close(run.id, 'completed', null);
      return;
    }
    const completed = currentSteps.filter((step) => step.delivery?.verified);
    const current = specialists
      ? currentSteps.find(
          (item) =>
            !item.job_id &&
            snapshot.steps[(item.position - 1) % snapshot.steps.length]!.dependsOn.every((key) =>
              completed.some((done) => done.step_key === key),
            ),
        )
      : steps.find((step) => !step.delivery);
    if (!current || current.job_id) return;
    if (run.deadline_at && run.deadline_at <= new Date()) throw conflict('budget_timeout');
    await this.teams.validateSnapshot(run.owner_id, run.project_id, snapshot);
    const { link } = await this.coding.github.read(run.owner_id, run.project_id);
    if (
      !link ||
      link.revoked ||
      link.stale ||
      link.version !== run.link_version ||
      link.snapshot?.commit !== run.commit_sha
    )
      throw conflict('team_source_changed');
    const step = snapshot.steps[(current.position - 1) % snapshot.steps.length]!;
    if (step.dependsOn.some((key) => !completed.some((item) => item.step_key === key)))
      throw conflict('team_dependency_missing');
    const previous = specialists ? undefined : steps[current.position - 2];
    if (previous && digest(canonical(previous.output_files)) !== previous.delivery.outputHash)
      throw conflict('team_delivery_changed');
    await this.coding.create(
      run.owner_id,
      run.project_id,
      {
        requestId: current.request_id,
        ...(snapshot.memory?.length && { memory: snapshot.memory }),
        taskId: snapshot.task.id,
        taskVersion: snapshot.task.version,
        commit: run.commit_sha,
        model: snapshot.model!,
        maxRequests: step.maxRequests,
        maxOutputTokens: 4096,
        timeoutMs: snapshot.limits.timeoutMs,
        agent: step.role,
        budgetId: run.budget_id,
        attribution: snapshot.reviewTarget
          ? 'reviewer'
          : specialists && current.position === steps.length
            ? 'summary'
            : step.requiredCapabilities.includes('workspaceWrite')
              ? 'agent'
              : 'reviewer',
      },
      {
        executionId: run.id,
        stepId: current.id,
        snapshot,
        stepKey: step.key,
        ...(snapshot.reviewTarget
          ? { files: snapshot.reviewTarget.files }
          : previous
            ? { files: codingWorkspace.parse(previous.output_files) }
            : {}),
        deliveries: completed.map((item) => teamDelivery.parse(item.delivery)),
      },
    );
  }
  private async saveDelivery(run: QueryResultRow, current: QueryResultRow, specialists: boolean) {
    const report = current.report ? codingReport.parse(current.report) : null;
    const output = current.output_files ? codingWorkspace.parse(current.output_files) : null;
    const origin = specialists ? 'controller-readonly-verification' : 'controller-verification';
    const fingerprint = (files: z.infer<typeof codingWorkspace>) =>
      canonical(
        files
          .map((file) => [file.path, digest(file.content)])
          .sort(([a], [b]) => a!.localeCompare(b!)),
      );
    const verified =
      current.state === 'completed' &&
      report?.diffComplete === true &&
      report.terminationConfirmed === true &&
      !!output?.length &&
      report.tests.some((test) => test.origin === origin && test.exitCode === 0) &&
      (!specialists ||
        (report.diff.length === 0 &&
          fingerprint(output) === fingerprint(codingWorkspace.parse(current.files))));
    const delivery = teamDelivery.parse({
      jobId: current.job_id,
      step: current.step_key,
      result: report?.summary ?? '',
      sources: (output ?? []).map((file) => ({ path: file.path, hash: digest(file.content) })),
      inputHash: digest(canonical(current.files)),
      outputHash: output ? digest(canonical(output)) : null,
      tests: (report?.tests ?? [])
        .filter((test) => test.origin === origin)
        .map(({ command, exitCode, origin }) => ({ command, exitCode, origin })),
      doubts: [
        ...(report?.limitations ?? []),
        'Los criterios de salida y las afirmaciones del agente requieren revisión humana.',
      ],
      verified,
    });
    await this.coding.jobs.queue.tx(async (db) => {
      const locked = (
        await db.query('SELECT state FROM team_executions WHERE id=$1 FOR UPDATE', [run.id])
      ).rows[0];
      if (!active(locked.state)) return;
      const saved = await db.query(
        'UPDATE team_execution_steps SET delivery=$2 WHERE id=$1 AND delivery IS NULL RETURNING id',
        [current.id, JSON.stringify(delivery)],
      );
      if (!saved.rowCount) return;
      await teamEvent(
        db,
        run.id,
        'delivery',
        'Entrega guardada con procedencia y evidencia del controlador.',
        { step: current.step_key, jobId: current.job_id, verified },
      );
      if (specialists) {
        await systemTeamMessage(
          db,
          run.id,
          current.id,
          null,
          verified ? 'completion' : 'conflict',
          JSON.stringify({ step: current.step_key, verified, outputHash: delivery.outputHash }),
          verified,
        );
        const snapshot = teamPlanSnapshot.parse(run.snapshot.plan);
        for (const target of snapshot.steps.filter((step) =>
          step.dependsOn.includes(current.step_key),
        )) {
          const row = (
            await db.query(
              'SELECT id FROM team_execution_steps WHERE execution_id=$1 AND step_key=$2 AND iteration=$3',
              [run.id, target.key, current.iteration],
            )
          ).rows[0];
          await systemTeamMessage(
            db,
            run.id,
            current.id,
            row.id,
            'handoff',
            JSON.stringify({
              step: current.step_key,
              verified,
              inputHash: delivery.inputHash,
              outputHash: delivery.outputHash,
            }),
            verified,
          );
        }
      }
    });
    return delivery;
  }
}
