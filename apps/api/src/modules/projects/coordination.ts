import type { Pool } from 'pg';
import { taskCoordinationGraph, type taskCoordinationInput } from '@ferweb/contracts';
import type { z } from 'zod';
import { ProjectRepository } from './repository.js';
import { HttpError } from '../../http-error.js';

const conflict = () =>
  new HttpError(
    409,
    'coordination_changed',
    'La tarea o su coordinación han cambiado. Actualiza antes de guardar.',
  );
export class TaskCoordination {
  readonly projects: ProjectRepository;
  constructor(private readonly pool: Pool) {
    this.projects = new ProjectRepository(pool);
  }
  async read(owner: string, project: string) {
    await this.projects.get(owner, project);
    const tasks = (
      await this.pool.query(
        `SELECT t.id,t.title,t.status,t.version,c.kind,c.parent_epic_id,c.blocker,c.claimed_template_id,c.claimed_template_version,
      u.email AS claimant,v.definition->>'name' AS team_name,COALESCE((SELECT array_agg(dependency_id ORDER BY dependency_id) FROM task_dependencies d WHERE d.project_id=t.project_id AND d.task_id=t.id),'{}') AS depends_on
      FROM tasks t LEFT JOIN task_coordination c ON c.task_id=t.id LEFT JOIN app_users u ON u.id=c.claimed_by
      LEFT JOIN team_template_versions v ON v.template_id=c.claimed_template_id AND v.version=c.claimed_template_version
      WHERE t.project_id=$1 ORDER BY t.created_at,t.id LIMIT 1001`,
        [project],
      )
    ).rows;
    if (tasks.length > 1000)
      throw new HttpError(
        422,
        'coordination_limit',
        'La vista admite hasta mil tareas por proyecto.',
      );
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const children = new Map<string, string[]>();
    for (const t of tasks)
      if (t.parent_epic_id)
        children.set(t.parent_epic_id, [...(children.get(t.parent_epic_id) ?? []), t.id]);
    const blocked = (id: string, seen = new Set<string>()): string[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      const node = byId.get(id);
      return [
        ...new Set(
          [...(node?.depends_on ?? []), ...(children.get(id) ?? [])].flatMap((next: string) => {
            const other = byId.get(next);
            return [
              ...(!other || other.status !== 'done' || other.blocker ? [next] : []),
              ...blocked(next, seen),
            ];
          }),
        ),
      ];
    };
    const executions = (
      await this.pool.query(
        `SELECT j.id,c.task_id,'coding' AS kind,j.state,c.task_snapshot->>'title' AS title,j.created_at FROM jobs j JOIN coding_runs c ON c.job_id=j.id WHERE j.project_id=$1
      UNION ALL SELECT r.id,(r.snapshot->'plan'->'task'->>'id')::uuid,'team',r.state,r.snapshot->'plan'->'task'->>'title',r.created_at FROM team_executions r WHERE r.project_id=$1
      ORDER BY created_at DESC LIMIT 200`,
        [project],
      )
    ).rows;
    return taskCoordinationGraph.parse({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        version: t.version,
        kind: t.kind ?? 'task',
        parentEpicId: t.parent_epic_id ?? null,
        dependsOn: t.depends_on,
        blocker: t.blocker ?? null,
        blockedBy: blocked(t.id),
        claim: {
          owner: t.claimant ?? null,
          templateId: t.claimed_template_id ?? null,
          templateVersion: t.claimed_template_version ?? null,
          name: t.team_name ?? null,
        },
      })),
      executions: executions.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        kind: r.kind,
        state: r.state,
        title: r.title,
      })),
    });
  }
  async save(
    owner: string,
    project: string,
    task: string,
    input: z.infer<typeof taskCoordinationInput>,
  ) {
    await this.projects.locked(owner, project, async (db, p) => {
      if (p.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de coordinar tareas.',
        );
      const rows = (
        await db.query(
          'SELECT t.id,t.version,c.kind,c.parent_epic_id FROM tasks t LEFT JOIN task_coordination c ON c.task_id=t.id WHERE t.project_id=$1 LIMIT 1001',
          [project],
        )
      ).rows;
      if (rows.length > 1000)
        throw new HttpError(422, 'coordination_limit', 'Límite de coordinación alcanzado.');
      const target = rows.find((r) => r.id === task);
      if (!target) throw new HttpError(404, 'not_found', 'No se ha encontrado la tarea.');
      if (target.version !== input.version) throw conflict();
      if (
        new Set(input.dependsOn).size !== input.dependsOn.length ||
        input.dependsOn.some((id) => !rows.some((r) => r.id === id)) ||
        (input.parentEpicId &&
          !rows.some((r) => r.id === input.parentEpicId && r.kind === 'epic')) ||
        (input.kind !== 'epic' && rows.some((r) => r.parent_epic_id === task))
      )
        throw conflict();
      const edges = new Map<string, string[]>();
      for (const r of (
        await db.query('SELECT task_id,dependency_id FROM task_dependencies WHERE project_id=$1', [
          project,
        ])
      ).rows)
        if (r.task_id !== task)
          edges.set(r.task_id, [...(edges.get(r.task_id) ?? []), r.dependency_id]);
      edges.set(task, [...input.dependsOn]);
      for (const r of rows) {
        const parent = r.id === task ? input.parentEpicId : r.parent_epic_id;
        if (parent) edges.set(parent, [...(edges.get(parent) ?? []), r.id]);
      }
      const visited = new Set<string>(),
        visiting = new Set<string>();
      const visit = (id: string): boolean => {
        if (visiting.has(id)) return false;
        if (visited.has(id)) return true;
        visiting.add(id);
        if ((edges.get(id) ?? []).some((next) => !visit(next))) return false;
        visiting.delete(id);
        visited.add(id);
        return true;
      };
      if (rows.some((r) => !visit(r.id)))
        throw new HttpError(
          422,
          'dependency_cycle',
          'La jerarquía y las dependencias no pueden formar un ciclo.',
        );
      if (input.claim.kind === 'team') {
        const team = (
          await db.query(
            'SELECT 1 FROM team_templates t JOIN team_template_versions v ON v.template_id=t.id WHERE t.project_id=$1 AND t.id=$2 AND v.version=$3 AND t.archived_at IS NULL',
            [project, input.claim.templateId, input.claim.templateVersion],
          )
        ).rowCount;
        if (!team) throw conflict();
      }
      await db.query(
        `INSERT INTO task_coordination(project_id,task_id,kind,parent_epic_id,blocker,claimed_by,claimed_template_id,claimed_template_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(task_id) DO UPDATE SET kind=$3,parent_epic_id=$4,blocker=$5,claimed_by=$6,claimed_template_id=$7,claimed_template_version=$8`,
        [
          project,
          task,
          input.kind,
          input.parentEpicId,
          input.blocker,
          input.claim.kind === 'owner' ? owner : null,
          input.claim.kind === 'team' ? input.claim.templateId : null,
          input.claim.kind === 'team' ? input.claim.templateVersion : null,
        ],
      );
      await db.query('DELETE FROM task_dependencies WHERE project_id=$1 AND task_id=$2', [
        project,
        task,
      ]);
      for (const dep of input.dependsOn)
        await db.query(
          'INSERT INTO task_dependencies(project_id,task_id,dependency_id) VALUES($1,$2,$3)',
          [project, task, dep],
        );
      await db.query(
        'UPDATE tasks SET version=version+1,updated_at=now() WHERE id=$1 AND project_id=$2',
        [task, project],
      );
    });
    return this.read(owner, project);
  }
}
