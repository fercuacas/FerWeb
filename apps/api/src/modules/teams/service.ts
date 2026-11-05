import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  teamTemplateVersion,
  teamTemplate,
  teamPlan,
  teamPlanSnapshot,
  teamPlanSummary,
  classifyPlanTask,
  teamStepOrder,
  type TeamDefinition,
  type TeamPlan,
  type ExecutionOption,
  type createTeamTemplateInput,
  type updateTeamTemplateInput,
  type prepareTeamPlanInput,
  type approveTeamPlanInput,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { ProjectRepository } from '../projects/repository.js';
import { AgentCatalog } from '../agents/catalog.js';
import { SkillLibrary } from '../skills/library.js';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { teamPresets } from './presets.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const conflict = () =>
  new HttpError(409, 'version_conflict', 'El recurso ha cambiado. Actualiza antes de continuar.');
const versionDto = (row: QueryResultRow) =>
  teamTemplateVersion.parse({
    id: row.id,
    version: row.version,
    definition: row.definition,
    origin: row.origin,
  });
const templateDto = (row: QueryResultRow) =>
  teamTemplate.parse({
    id: row.id,
    archivedAt: row.archived_at?.toISOString() ?? null,
    latest: versionDto(row),
  });
function planDto(row: QueryResultRow) {
  return teamPlan.parse({
    id: row.id,
    hash: row.hash,
    state: row.execution_id ? 'executed' : row.approved_at ? 'approved' : 'prepared',
    createdAt: row.created_at.toISOString(),
    executionId: row.execution_id ?? null,
    snapshot: row.snapshot,
    approval: row.approved_at
      ? { hash: row.approval_hash, version: 1, approvedAt: row.approved_at.toISOString() }
      : null,
  });
}
function compatible(
  item: {
    requiredCapabilities: (keyof ExecutionOption['capabilities'])[];
    allowedToolProfiles?: ExecutionOption['toolProfile'][];
  },
  option: ExecutionOption,
) {
  return (
    (!item.allowedToolProfiles || item.allowedToolProfiles.includes(option.toolProfile)) &&
    item.requiredCapabilities.every((capability) => option.capabilities[capability] === 'supported')
  );
}
export class TeamService {
  private readonly projects: ProjectRepository;
  private readonly agents: AgentCatalog;
  private readonly skills: SkillLibrary;
  constructor(
    private readonly pool: Pool,
    private readonly coding: CodingService,
  ) {
    this.projects = new ProjectRepository(pool);
    this.agents = new AgentCatalog(pool);
    this.skills = new SkillLibrary(pool);
  }
  async templates(owner: string, project: string) {
    await this.projects.get(owner, project);
    const rows = (
      await this.pool.query(
        `SELECT t.id,t.archived_at,v.* FROM team_templates t JOIN projects p ON p.id=t.project_id
       JOIN team_template_versions v ON v.template_id=t.id AND v.version=t.latest_version
       WHERE p.owner_id=$1 AND p.id=$2 ORDER BY t.archived_at NULLS FIRST,t.id`,
        [owner, project],
      )
    ).rows;
    return { templates: rows.map(templateDto), presets: teamPresets };
  }
  async template(owner: string, project: string, id: string) {
    const rows = (
      await this.pool.query(
        `SELECT t.id,t.archived_at,v.* FROM team_templates t JOIN projects p ON p.id=t.project_id
       JOIN team_template_versions v ON v.template_id=t.id
       WHERE p.owner_id=$1 AND p.id=$2 AND t.id=$3 ORDER BY v.version DESC`,
        [owner, project, id],
      )
    ).rows;
    if (!rows[0]) throw missing();
    return { template: templateDto(rows[0]), versions: rows.map(versionDto) };
  }
  private async templateVersion(
    db: PoolClient,
    owner: string,
    project: string,
    id: string,
    version: number,
  ) {
    const row = (
      await db.query(
        `SELECT t.id,t.archived_at,v.* FROM team_templates t JOIN projects p ON p.id=t.project_id
       JOIN team_template_versions v ON v.template_id=t.id
       WHERE p.owner_id=$1 AND p.id=$2 AND t.id=$3 AND v.version=$4`,
        [owner, project, id, version],
      )
    ).rows[0];
    if (!row) throw missing();
    if (row.archived_at)
      throw new HttpError(409, 'template_archived', 'La plantilla está archivada.');
    return versionDto(row);
  }
  private async resolve(
    db: PoolClient,
    owner: string,
    project: string,
    definition: TeamDefinition,
    option: ExecutionOption,
  ) {
    const steps = [];
    const order = teamStepOrder(definition.steps)!;
    for (const key of order) {
      const step = definition.steps.find((item) => item.key === key)!;
      const agent = await this.agents.select(db, owner, project, step.role);
      const materials = await this.skills.resolve(
        owner,
        project,
        (agent.skills ?? []).map((item) => item.id),
        db,
      );
      if (materials.some((item, index) => item.sha256 !== agent.skills?.[index]?.sha256))
        throw conflict();
      if (![step, agent, ...materials].every((item) => compatible(item, option)))
        throw new HttpError(
          422,
          'team_incompatible',
          'Un paso, rol o material requiere capacidades que el ejecutor no confirma.',
        );
      steps.push({ ...step, agent: { ...agent, ...(materials.length && { materials }) } });
    }
    return steps;
  }
  private write<T>(owner: string, project: string, action: (db: PoolClient) => Promise<T>) {
    return this.projects.locked(owner, project, (db, row) => {
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de preparar equipos.',
        );
      return action(db);
    });
  }
  async create(owner: string, project: string, input: z.infer<typeof createTeamTemplateInput>) {
    const caps = await this.coding.capabilities(owner, project);
    const execution =
      input.definition.strategy === 'specialists' ? caps.readOnlyExecution : caps.execution;
    return this.write(owner, project, async (db) => {
      await this.resolve(db, owner, project, input.definition, execution);
      const count = (
        await db.query('SELECT count(*)::int AS n FROM team_templates WHERE project_id=$1', [
          project,
        ])
      ).rows[0].n;
      if (count >= 50)
        throw new HttpError(422, 'team_limit', 'Límite de plantillas del proyecto alcanzado.');
      const row = (
        await db.query('INSERT INTO team_templates(project_id) VALUES($1) RETURNING id', [project])
      ).rows[0]!;
      const origin = { preset: input.preset ?? null, revision: 1 };
      await db.query(
        'INSERT INTO team_template_versions(template_id,version,definition,origin) VALUES($1,1,$2,$3)',
        [row.id, JSON.stringify(input.definition), JSON.stringify(origin)],
      );
      return {
        template: templateDto({ id: row.id, version: 1, definition: input.definition, origin }),
      };
    });
  }
  async update(
    owner: string,
    project: string,
    id: string,
    input: z.infer<typeof updateTeamTemplateInput>,
  ) {
    const caps = await this.coding.capabilities(owner, project);
    const execution =
      input.definition.strategy === 'specialists' ? caps.readOnlyExecution : caps.execution;
    return this.write(owner, project, async (db) => {
      const current = await this.templateVersion(db, owner, project, id, input.version);
      const head = (await db.query('SELECT latest_version FROM team_templates WHERE id=$1', [id]))
        .rows[0];
      if (head.latest_version !== input.version) throw conflict();
      if (input.version >= 50)
        throw new HttpError(
          422,
          'team_version_limit',
          'Límite de versiones de la plantilla alcanzado.',
        );
      await this.resolve(db, owner, project, input.definition, execution);
      const version = input.version + 1;
      await db.query(
        'INSERT INTO team_template_versions(template_id,version,definition,origin) VALUES($1,$2,$3,$4)',
        [id, version, JSON.stringify(input.definition), JSON.stringify(current.origin)],
      );
      await db.query('UPDATE team_templates SET latest_version=$2 WHERE id=$1', [id, version]);
      return {
        template: templateDto({
          id,
          version,
          definition: input.definition,
          origin: current.origin,
        }),
      };
    });
  }
  archive(owner: string, project: string, id: string, version: number) {
    return this.write(owner, project, async (db) => {
      await this.templateVersion(db, owner, project, id, version);
      const result = await db.query(
        'UPDATE team_templates SET archived_at=now() WHERE id=$1 AND latest_version=$2 RETURNING id',
        [id, version],
      );
      if (!result.rowCount) throw conflict();
      return { archived: true };
    });
  }
  async plans(owner: string, project: string) {
    await this.projects.get(owner, project);
    const rows = (
      await this.pool.query(
        `SELECT r.id,r.hash,r.created_at,r.approved_at,r.approval_hash,r.task_id,r.execution_id,
       r.snapshot->'task'->>'title' AS title,r.snapshot->'template'->'definition'->>'name' AS template_name,
       (r.snapshot->'template'->>'version')::int AS template_version
       FROM prepared_team_plans r JOIN projects p ON p.id=r.project_id
       WHERE p.owner_id=$1 AND p.id=$2 ORDER BY r.created_at DESC,r.id LIMIT 100`,
        [owner, project],
      )
    ).rows;
    return {
      plans: rows.map((row) =>
        teamPlanSummary.parse({
          id: row.id,
          hash: row.hash,
          state: row.execution_id ? 'executed' : row.approved_at ? 'approved' : 'prepared',
          createdAt: row.created_at.toISOString(),
          approval: row.approved_at
            ? { hash: row.approval_hash, version: 1, approvedAt: row.approved_at.toISOString() }
            : null,
          executionId: row.execution_id ?? null,
          taskId: row.task_id,
          title: row.title,
          templateName: row.template_name,
          templateVersion: row.template_version,
        }),
      ),
    };
  }
  private async planRow(db: Pool | PoolClient, owner: string, project: string, id: string) {
    const row = (
      await db.query(
        'SELECT r.* FROM prepared_team_plans r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND p.id=$2 AND r.id=$3',
        [owner, project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }
  async readPlan(owner: string, project: string, id: string) {
    return { plan: planDto(await this.planRow(this.pool, owner, project, id)) };
  }
  async validateSnapshot(owner: string, project: string, snapshot: TeamPlan['snapshot']) {
    const task = await this.projects.getTask(owner, project, snapshot.task.id);
    if (task.version !== snapshot.task.version) throw conflict();
    const caps = await this.coding.capabilities(owner, project);
    const execution =
      snapshot.template.definition.strategy === 'specialists'
        ? caps.readOnlyExecution
        : caps.execution;
    if (!execution.available || canonical(execution) !== canonical(snapshot.execution))
      throw new HttpError(
        409,
        'team_environment_changed',
        'El ejecutor ha cambiado; prepara un plan nuevo.',
      );
    await this.write(owner, project, async (db) => {
      const template = await this.templateVersion(
        db,
        owner,
        project,
        snapshot.template.id,
        snapshot.template.version,
      );
      if (canonical(template) !== canonical(snapshot.template)) throw conflict();
      const resolved = await this.resolve(db, owner, project, template.definition, execution);
      for (const step of snapshot.steps) {
        if (
          canonical(resolved.find((item) => item.key === step.key)?.agent) !== canonical(step.agent)
        )
          throw conflict();
      }
    });
  }
  async prepare(owner: string, project: string, input: z.infer<typeof prepareTeamPlanInput>) {
    await this.projects.get(owner, project);
    const requestHash = digest(canonical(input));
    const existing = (
      await this.pool.query(
        'SELECT id,request_hash FROM prepared_team_plans WHERE project_id=$1 AND request_id=$2',
        [project, input.requestId],
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw conflict();
      return this.readPlan(owner, project, existing.id);
    }
    const task = await this.projects.getTask(owner, project, input.taskId);
    if (task.version !== input.taskVersion) throw conflict();
    const selected = (await this.template(owner, project, input.templateId)).versions.find(
      (item) => item.version === input.templateVersion,
    );
    if (!selected) throw missing();
    if (selected.definition.strategy === 'specialists' && input.mode !== 'team')
      throw new HttpError(422, 'team_mode_required', 'Especialistas requiere el equipo completo.');
    const caps = await this.coding.capabilities(owner, project);
    const execution =
      selected.definition.strategy === 'specialists' ? caps.readOnlyExecution : caps.execution;
    if (
      input.model
        ? !execution.models.some((model) => model.id === input.model)
        : execution.models.length > 0
    )
      throw new HttpError(
        422,
        'team_model_invalid',
        'Selecciona un modelo permitido por el ejecutor.',
      );
    return this.write(owner, project, async (db) => {
      const prior = (
        await db.query('SELECT * FROM prepared_team_plans WHERE project_id=$1 AND request_id=$2', [
          project,
          input.requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash) throw conflict();
        return { plan: planDto(prior) };
      }
      const currentTask = (
        await db.query('SELECT version FROM tasks WHERE id=$1 AND project_id=$2', [
          task.id,
          project,
        ])
      ).rows[0];
      if (currentTask?.version !== task.version) throw conflict();
      const template = await this.templateVersion(
        db,
        owner,
        project,
        input.templateId,
        input.templateVersion,
      );
      const allSteps = await this.resolve(db, owner, project, template.definition, execution);
      const classification = classifyPlanTask(task);
      const mode = input.mode === 'auto' ? classification.recommendedMode : input.mode;
      const single = input.singleStep ?? allSteps[0]!.key;
      if (mode === 'single' && !allSteps.some((step) => step.key === single))
        throw new HttpError(422, 'team_step_missing', 'El paso elegido no existe en la plantilla.');
      const steps =
        mode === 'single'
          ? allSteps
              .filter((step) => step.key === single)
              .map((step) => ({ ...step, dependsOn: [] }))
          : allSteps;
      const snapshot = teamPlanSnapshot.parse({
        version: 1,
        template,
        task: {
          id: task.id,
          version: task.version,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
        },
        classification,
        mode,
        execution,
        model: input.model,
        limits: template.definition.limits,
        maxIterations: template.definition.maxIterations,
        plannedRequests:
          steps.reduce((sum, step) => sum + step.maxRequests, 0) *
          template.definition.maxIterations,
        steps,
      });
      const count = (
        await db.query('SELECT count(*)::int AS n FROM prepared_team_plans WHERE project_id=$1', [
          project,
        ])
      ).rows[0].n;
      if (count >= 1000)
        throw new HttpError(
          422,
          'plan_limit',
          'Límite de planes preparados del proyecto alcanzado.',
        );
      const row = (
        await db.query(
          'INSERT INTO prepared_team_plans(project_id,task_id,request_id,request_hash,snapshot,hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [
            project,
            task.id,
            input.requestId,
            requestHash,
            JSON.stringify(snapshot),
            digest(canonical(snapshot)),
          ],
        )
      ).rows[0]!;
      return { plan: planDto(row) };
    });
  }
  async approve(
    owner: string,
    project: string,
    id: string,
    input: z.infer<typeof approveTeamPlanInput>,
  ) {
    const initial = planDto(await this.planRow(this.pool, owner, project, id));
    const caps = await this.coding.capabilities(owner, project);
    const execution =
      initial.snapshot.template.definition.strategy === 'specialists'
        ? caps.readOnlyExecution
        : caps.execution;
    return this.write(owner, project, async (db) => {
      const row = await this.planRow(db, owner, project, id);
      const plan = planDto(row);
      if (
        plan.hash !== input.hash ||
        plan.snapshot.version !== input.version ||
        digest(canonical(plan.snapshot)) !== input.hash
      )
        throw conflict();
      if (plan.approval) return { plan };
      if (
        !plan.snapshot.execution.available ||
        !plan.snapshot.model ||
        !execution.available ||
        canonical(execution) !== canonical(plan.snapshot.execution)
      )
        throw new HttpError(
          409,
          'plan_blocked',
          'Configura el ejecutor y prepara un plan con un modelo disponible.',
        );
      const updated = (
        await db.query(
          'UPDATE prepared_team_plans SET approved_at=COALESCE(approved_at,now()),approval_hash=hash WHERE id=$1 RETURNING *',
          [id],
        )
      ).rows[0]!;
      return { plan: planDto(updated) };
    });
  }
}
