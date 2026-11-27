import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  automationOverview,
  automationSchedule,
  automationSnapshot,
  type AutomationAction,
  type AutomationCreate,
  type AutomationSchedule,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { TeamExecutions } from '../teams/executions.js';
import { TeamService } from '../teams/service.js';
import { nextOccurrence } from './calendar.js';

const graceMs = 15 * 60_000;
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado la programación.');
const changed = (code = 'automation_changed') =>
  new HttpError(
    409,
    code,
    'Las condiciones de la programación han cambiado. Revisa su autorización.',
  );
const snapshotHash = (snapshot: AutomationSchedule['snapshot']) => digest(canonical(snapshot));

function schedule(row: QueryResultRow) {
  const snapshot = automationSnapshot.parse(row.snapshot);
  if (snapshotHash(snapshot) !== row.hash || row.plan_id !== snapshot.planId) throw changed();
  return automationSchedule.parse({
    id: row.id,
    snapshot,
    hash: row.hash,
    revision: row.revision,
    state: row.state,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    observedCount: row.observed_count,
    reason: row.reason,
  });
}

const occurrenceColumns = `o.*, r.state AS team_state,
  CASE WHEN NOT g.revoked AND g.repository_id=r.repository_id THEN r.id END AS team_id`;
const occurrenceJoins = `LEFT JOIN team_executions r ON r.automation_occurrence_id=o.id
  LEFT JOIN github_links g ON g.project_id=o.project_id`;
const occurrence = (row: QueryResultRow) => ({
  id: row.id,
  scheduleId: row.schedule_id,
  dueAt: row.due_at.toISOString(),
  disposition: row.disposition,
  reason: row.reason,
  teamId: row.team_id ?? null,
  teamState: row.team_state ?? null,
});

// A stable UUIDv8 provides the same queue identity on every observation of a slot.
function occurrenceId(id: string, due: string): string {
  const hex = createHash('sha256')
    .update('ferweb-automation-v1:' + id + ':' + due)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class Automations {
  private readonly teams: TeamService;
  private readonly executions: TeamExecutions;

  constructor(
    private readonly coding: CodingService,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.teams = new TeamService(coding.pool, coding);
    this.executions = new TeamExecutions(coding.pool, coding);
  }

  async list(owner: string, project: string) {
    await this.coding.projects.get(owner, project);
    const [schedules, occurrences, notifications, unread] = await Promise.all([
      this.coding.pool.query(
        'SELECT * FROM automation_schedules WHERE project_id=$1 ORDER BY created_at DESC,id',
        [project],
      ),
      this.coding.pool.query(
        `SELECT ${occurrenceColumns} FROM automation_occurrences o ${occurrenceJoins}
         WHERE o.project_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 100`,
        [project],
      ),
      this.coding.pool.query(
        `SELECT ${occurrenceColumns},n.id AS notice_id,n.kind,n.read_at,n.created_at AS sent_at,s.snapshot->>'title' AS title
         FROM automation_notifications n JOIN automation_occurrences o ON o.id=n.occurrence_id
         JOIN automation_schedules s ON s.id=o.schedule_id ${occurrenceJoins}
         WHERE n.project_id=$1 ORDER BY (n.read_at IS NULL) DESC,n.created_at DESC,n.id LIMIT 100`,
        [project],
      ),
      this.coding.pool.query(
        'SELECT count(*)::int AS count FROM automation_notifications WHERE project_id=$1 AND read_at IS NULL',
        [project],
      ),
    ]);
    return automationOverview.parse({
      schedules: schedules.rows.map(schedule),
      occurrences: occurrences.rows.map(occurrence),
      notifications: notifications.rows.map((row) => ({
        id: row.notice_id,
        title: row.title,
        kind: row.kind,
        occurrence: occurrence(row),
        createdAt: row.sent_at.toISOString(),
        readAt: row.read_at?.toISOString() ?? null,
      })),
      unread: unread.rows[0].count,
    });
  }

  async create(owner: string, project: string, input: AutomationCreate) {
    const projectInfo = await this.coding.projects.get(owner, project);
    if (projectInfo.archivedAt) throw changed('project_archived');
    const { requestId, ...definition } = input;
    const requestHash = digest(canonical(definition));
    const previous = (
      await this.coding.pool.query(
        'SELECT * FROM automation_schedules WHERE project_id=$1 AND request_id=$2',
        [project, requestId],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw changed();
      return schedule(previous);
    }
    const { plan } = await this.teams.readPlan(owner, project, input.planId);
    if (!plan.approval || plan.hash !== input.planHash || plan.changesRequested)
      throw changed('team_approval_required');
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.stale || !link.snapshot || link.snapshot.treeTruncated)
      throw changed('team_source_changed');
    const data = plan.snapshot;
    const policy = await this.executions.policy(owner, project);
    const snapshot = automationSnapshot.parse({
      ...definition,
      format: 1,
      taskId: data.task.id,
      taskVersion: data.task.version,
      templateName: data.template.definition.name,
      templateVersion: data.template.version,
      planVersion: data.version,
      repository: link.fullName,
      repositoryId: link.repositoryId,
      linkVersion: link.version,
      teamPolicyVersion: policy.version,
      commit: link.snapshot.commit,
      destination: data.routing?.mode ?? (data.execution.id === 'codex-v1' ? 'api' : 'local'),
      apiRequestLimit:
        data.routing?.reservedApiRequests ??
        (data.execution.id === 'codex-v1' ? data.limits.maxRequests : 0),
      stages: data.steps.map((step) => {
        const routed = data.routing?.stages.find((stage) => stage.step === step.key);
        return {
          key: step.key,
          executionId: routed?.execution.id ?? data.execution.id,
          model:
            routed?.model ??
            data.stepModels?.find((item) => item.step === step.key)?.model ??
            data.model,
        };
      }),
      limits: data.limits,
    });
    return this.coding.projects.locked(owner, project, async (db, projectRow) => {
      if (projectRow.archived_at) throw changed('project_archived');
      const prior = (
        await db.query('SELECT * FROM automation_schedules WHERE project_id=$1 AND request_id=$2', [
          project,
          requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash) throw changed();
        return schedule(prior);
      }
      await this.assertSqlGrant(db, project, projectRow.team_policy_version, snapshot);
      if (
        (
          await db.query(
            'SELECT id FROM automation_schedules WHERE project_id=$1 OFFSET 29 LIMIT 1',
            [project],
          )
        ).rowCount
      )
        throw new HttpError(422, 'automation_limit', 'El proyecto admite hasta 30 programaciones.');
      const result = await db.query(
        `INSERT INTO automation_schedules(project_id,plan_id,request_id,request_hash,snapshot,hash,next_run_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          project,
          input.planId,
          requestId,
          requestHash,
          JSON.stringify(snapshot),
          snapshotHash(snapshot),
          nextOccurrence(snapshot.calendar, this.clock()),
        ],
      );
      return schedule(result.rows[0]);
    });
  }

  private async assertSqlGrant(
    db: PoolClient,
    project: string,
    policyVersion: number,
    snapshot: AutomationSchedule['snapshot'],
  ) {
    if (policyVersion !== snapshot.teamPolicyVersion) throw changed('automation_policy_changed');
    const row = (
      await db.query(
        `SELECT t.version AS task_version,p.hash,p.approval_hash,p.changes_requested,
         g.version AS link_version,g.repository_id,g.stale,g.revoked,g.snapshot->>'commit' AS commit
         FROM prepared_team_plans p JOIN tasks t ON t.id=p.task_id AND t.project_id=p.project_id
         JOIN github_links g ON g.project_id=p.project_id
         WHERE p.project_id=$1 AND p.id=$2 AND t.id=$3 FOR SHARE OF p,t,g`,
        [project, snapshot.planId, snapshot.taskId],
      )
    ).rows[0];
    if (
      !row ||
      row.hash !== snapshot.planHash ||
      row.approval_hash !== snapshot.planHash ||
      row.changes_requested ||
      row.task_version !== snapshot.taskVersion ||
      row.link_version !== snapshot.linkVersion ||
      Number(row.repository_id) !== snapshot.repositoryId ||
      row.stale ||
      row.revoked ||
      row.commit !== snapshot.commit
    )
      throw changed();
  }

  async change(owner: string, project: string, id: string, input: AutomationAction) {
    const enabling = input.action === 'approve' || input.action === 'resume';
    // Availability and provider discovery stay outside the short SQL transaction.
    if (enabling) {
      const info = await this.coding.projects.get(owner, project);
      if (info.archivedAt) throw changed('project_archived');
      const initial = await this.lockedSchedule(this.coding.pool, project, id, false);
      this.assertAction(initial, input);
      const { plan } = await this.teams.readPlan(owner, project, initial.snapshot.planId);
      await this.teams.validateSnapshot(owner, project, plan.snapshot);
      const { link } = await this.coding.github.read(owner, project);
      if (!link || link.revoked || link.stale || link.version !== initial.snapshot.linkVersion)
        throw changed('team_source_changed');
    }
    return this.coding.projects.locked(owner, project, async (db, projectRow) => {
      if (projectRow.archived_at && input.action !== 'cancel') throw changed('project_archived');
      const current = await this.lockedSchedule(db, project, id);
      this.assertAction(current, input);
      if (enabling)
        await this.assertSqlGrant(db, project, projectRow.team_policy_version, current.snapshot);
      if (input.action === 'cancel') {
        const executions = await db.query(
          `SELECT r.id FROM team_executions r JOIN automation_occurrences o ON o.id=r.automation_occurrence_id
           WHERE o.schedule_id=$1 AND r.project_id=$2 AND r.state IN ('pending','running')`,
          [id, project],
        );
        for (const run of executions.rows) await this.executions.requestCancellation(db, run.id);
      }
      const result = await db.query(
        `UPDATE automation_schedules SET state=$3,revision=revision+1,reason=NULL,
         approval_hash=CASE WHEN $4 THEN hash ELSE approval_hash END,next_run_at=$5
         WHERE project_id=$1 AND id=$2 RETURNING *`,
        [
          project,
          id,
          enabling ? 'active' : input.action === 'pause' ? 'paused' : 'cancelled',
          input.action === 'approve',
          enabling ? nextOccurrence(current.snapshot.calendar, this.clock()) : null,
        ],
      );
      return schedule(result.rows[0]);
    });
  }

  private assertAction(current: AutomationSchedule, input: AutomationAction) {
    if (
      current.revision !== input.revision ||
      (input.action === 'approve' && (current.state !== 'draft' || input.hash !== current.hash)) ||
      (input.action === 'resume' && current.state !== 'paused') ||
      (input.action === 'pause' && current.state !== 'active') ||
      (input.action === 'cancel' && current.state === 'cancelled')
    )
      throw changed();
  }

  private async lockedSchedule(
    db: Pick<PoolClient, 'query'>,
    project: string,
    id: string,
    lock = true,
  ) {
    const row = (
      await db.query(
        'SELECT * FROM automation_schedules WHERE project_id=$1 AND id=$2' +
          (lock ? ' FOR UPDATE' : ''),
        [project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    return schedule(row);
  }

  async markRead(owner: string, project: string, id: string) {
    return this.coding.projects.locked(owner, project, async (db, row) => {
      if (row.archived_at) throw changed('project_archived');
      const result = await db.query(
        'UPDATE automation_notifications SET read_at=COALESCE(read_at,now()) WHERE project_id=$1 AND id=$2',
        [project, id],
      );
      if (!result.rowCount) throw missing();
      return { read: true };
    });
  }

  private async record(
    db: PoolClient,
    project: string,
    current: AutomationSchedule,
    now: Date,
    disposition: 'admitted' | 'skipped' | 'blocked',
    reason: string | null,
  ) {
    const locked = await this.lockedSchedule(db, project, current.id);
    if (
      locked.state !== 'active' ||
      locked.revision !== current.revision ||
      locked.hash !== current.hash ||
      !locked.nextRunAt ||
      locked.nextRunAt !== current.nextRunAt ||
      Date.parse(locked.nextRunAt) > now.getTime()
    )
      throw changed('automation_slot_changed');
    const used = locked.observedCount + 1;
    const state =
      disposition === 'blocked'
        ? 'blocked'
        : used >= locked.snapshot.maxOccurrences
          ? 'exhausted'
          : 'active';
    await db.query(
      'INSERT INTO automation_occurrences(id,project_id,schedule_id,due_at,disposition,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [
        occurrenceId(locked.id, locked.nextRunAt),
        project,
        locked.id,
        locked.nextRunAt,
        disposition,
        reason,
      ],
    );
    await db.query(
      `UPDATE automation_schedules SET state=$2,reason=$3,next_run_at=$4,observed_count=$5,revision=revision+1
       WHERE id=$1`,
      [
        locked.id,
        state,
        state === 'blocked' ? reason : null,
        state === 'active' ? nextOccurrence(locked.snapshot.calendar, now) : null,
        used,
      ],
    );
  }

  private async processDue(row: QueryResultRow, now: Date) {
    const current = schedule(row);
    const { snapshot, nextRunAt } = current;
    if (!nextRunAt) return;
    const { owner_id: owner, project_id: project } = row;
    const record = (disposition: 'skipped' | 'blocked', reason: string) =>
      this.coding.projects.locked(owner, project, (db) =>
        this.record(db, project, current, now, disposition, reason),
      );
    const id = occurrenceId(current.id, nextRunAt);
    try {
      if (row.archived_at) {
        await record('blocked', 'project_archived');
      } else if (now.getTime() - Date.parse(nextRunAt) >= graceMs) {
        await record('skipped', 'missed_window');
      } else {
        await this.executions.admit(
          owner,
          project,
          snapshot.planId,
          {
            requestId: id,
            hash: snapshot.planHash,
            version: snapshot.planVersion,
            commit: snapshot.commit,
          },
          {
            occurrenceId: id,
            linkVersion: snapshot.linkVersion,
            policyVersion: snapshot.teamPolicyVersion,
            reserve: async (db) => {
              await this.assertSqlGrant(db, project, snapshot.teamPolicyVersion, snapshot);
              await this.record(db, project, current, now, 'admitted', null);
            },
          },
        );
      }
    } catch (error) {
      if (!(error instanceof HttpError) || error.status >= 500) throw error;
      if (error.code === 'automation_slot_changed') return;
      try {
        await record(error.code === 'automation_overlap' ? 'skipped' : 'blocked', error.code);
      } catch (race) {
        if (!(race instanceof HttpError) || race.code !== 'automation_slot_changed') throw race;
      }
    }
  }

  async tick() {
    const now = this.clock();
    const due = await this.coding.pool.query(
      `SELECT s.*,p.owner_id,p.archived_at FROM automation_schedules s JOIN projects p ON p.id=s.project_id
       WHERE s.state='active' AND s.next_run_at <= $1 ORDER BY s.next_run_at,s.id LIMIT 8`,
      [now],
    );
    let deferred = 0;
    for (const row of due.rows) {
      try {
        await this.processDue(row, now);
      } catch {
        deferred++;
      }
    }
    const notices = await this.coding.pool.query(
      `WITH observations AS (
         SELECT o.id,o.project_id,
           CASE WHEN o.reason='team_environment_changed' THEN 'action_required' ELSE 'blocked' END AS kind,
           '' AS suffix
         FROM automation_occurrences o WHERE o.disposition='blocked'
         UNION ALL
         SELECT r.automation_occurrence_id,r.project_id,r.state,''
         FROM team_executions r WHERE r.automation_occurrence_id IS NOT NULL AND r.state IN ('completed','failed')
         UNION ALL
         SELECT r.automation_occurrence_id,r.project_id,'action_required',':'||i.hash
         FROM team_executions r JOIN LATERAL (
           SELECT state,hash FROM team_integrations WHERE execution_id=r.id ORDER BY version DESC LIMIT 1
         ) i ON i.state='conflict'
         WHERE r.automation_occurrence_id IS NOT NULL AND r.state IN ('pending','running') AND NOT r.cancel_requested
       ), pending AS (
         SELECT id::text||':'||kind||suffix AS notice_id,project_id,id,kind FROM observations
       )
       INSERT INTO automation_notifications(id,project_id,occurrence_id,kind)
       SELECT p.notice_id,p.project_id,p.id,p.kind FROM pending p
       WHERE NOT EXISTS (SELECT 1 FROM automation_notifications n WHERE n.id=p.notice_id)
       ORDER BY p.notice_id LIMIT 200 ON CONFLICT (id) DO NOTHING`,
    );
    return { checked: due.rowCount ?? 0, deferred, notices: notices.rowCount ?? 0 };
  }
}
