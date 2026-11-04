import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  projectSchema,
  taskSchema,
  type ProjectInput,
  type ProjectPatch,
  type TaskInput,
  type TaskPatch,
  type TaskFilters,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';

const notFound = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const conflict = () =>
  new HttpError(
    409,
    'version_conflict',
    'El recurso ha cambiado. Cierra el editor y vuelve a abrirlo para revisar la última versión.',
  );
function project(row: QueryResultRow) {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  });
}
function task(row: QueryResultRow) {
  return taskSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    acceptanceCriteria: row.acceptance_criteria,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  });
}
export class ProjectRepository {
  constructor(private readonly pool: Pool) {}
  async list(owner: string) {
    const result = await this.pool.query(
      'SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC, id',
      [owner],
    );
    return result.rows.map(project);
  }
  async get(owner: string, id: string) {
    const result = await this.pool.query('SELECT * FROM projects WHERE owner_id = $1 AND id = $2', [
      owner,
      id,
    ]);
    if (!result.rows[0]) throw notFound();
    return project(result.rows[0]);
  }
  async create(owner: string, input: ProjectInput) {
    const result = await this.pool.query(
      'INSERT INTO projects (owner_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [owner, input.name, input.description],
    );
    return project(result.rows[0]!);
  }
  async locked<T>(
    owner: string,
    id: string,
    action: (client: PoolClient, row: QueryResultRow) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM projects WHERE owner_id = $1 AND id = $2 FOR UPDATE',
        [owner, id],
      );
      if (!result.rows[0]) throw notFound();
      const value = await action(client, result.rows[0]);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async update(owner: string, id: string, input: ProjectPatch) {
    return this.locked(owner, id, async (client, row) => {
      if (row.version !== input.version) throw conflict();
      if (
        row.archived_at &&
        (input.archived !== false || input.name !== undefined || input.description !== undefined)
      )
        throw new HttpError(409, 'project_archived', 'Restaura el proyecto antes de editarlo.');
      const result = await client.query(
        `UPDATE projects SET name = COALESCE($3, name), description = COALESCE($4, description),
        archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN COALESCE(archived_at, now()) ELSE NULL END,
        updated_at = now(), version = version + 1 WHERE owner_id = $1 AND id = $2 RETURNING *`,
        [owner, id, input.name, input.description, input.archived],
      );
      return project(result.rows[0]!);
    });
  }
  async listTasks(owner: string, id: string, filters: TaskFilters) {
    // The join scopes tasks even if project ownership changes between queries.
    await this.get(owner, id);
    const result = await this.pool.query(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE p.owner_id = $1 AND p.id = $2
      AND ($3::text IS NULL OR strpos(lower(t.title || ' ' || t.description), lower($3)) > 0)
      AND ($4::text IS NULL OR t.priority = $4) AND ($5::text IS NULL OR t.status = $5)
      ORDER BY t.created_at, t.id`,
      [owner, id, filters.q, filters.priority, filters.status],
    );
    return result.rows.map(task);
  }
  async getTask(owner: string, projectId: string, taskId: string) {
    const result = await this.pool.query(
      'SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.owner_id = $1 AND p.id = $2 AND t.id = $3',
      [owner, projectId, taskId],
    );
    if (!result.rows[0]) throw notFound();
    return task(result.rows[0]);
  }
  async saveTask(owner: string, projectId: string, input: TaskInput | TaskPatch, taskId?: string) {
    return this.locked(owner, projectId, async (client, row) => {
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'El proyecto está archivado. Restaúralo antes de cambiar tareas.',
        );
      if (taskId) {
        const result = await client.query(
          `UPDATE tasks SET title=$3, description=$4, priority=$5, status=$6, acceptance_criteria=$7::jsonb,
          updated_at=now(), version=version+1 WHERE project_id=$1 AND id=$2 AND version=$8 RETURNING *`,
          [
            projectId,
            taskId,
            input.title,
            input.description,
            input.priority,
            input.status,
            JSON.stringify(input.acceptanceCriteria),
            (input as TaskPatch).version,
          ],
        );
        if (result.rows[0]) return task(result.rows[0]);
        const exists = await client.query('SELECT 1 FROM tasks WHERE project_id=$1 AND id=$2', [
          projectId,
          taskId,
        ]);
        throw exists.rowCount ? conflict() : notFound();
      }
      const result = await client.query(
        'INSERT INTO tasks (project_id, title, description, priority, status, acceptance_criteria) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
        [
          projectId,
          input.title,
          input.description,
          input.priority,
          input.status,
          JSON.stringify(input.acceptanceCriteria),
        ],
      );
      return task(result.rows[0]!);
    });
  }
}
