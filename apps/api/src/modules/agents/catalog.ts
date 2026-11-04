import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  agentRole,
  agentSnapshot,
  type agentSelection,
  type createAgentInput,
  type updateAgentInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
import { ProjectRepository } from '../projects/repository.js';
import { agentTemplates, templateReference, templateRevision } from './templates.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const archived = () => new HttpError(409, 'agent_archived', 'El rol está archivado.');
const versionConflict = () =>
  new HttpError(409, 'version_conflict', 'El rol ha cambiado. Vuelve a abrir la última versión.');

function snapshot(row: QueryResultRow) {
  return agentSnapshot.parse({
    ...row.definition,
    id: row.id,
    version: row.version,
    origin: row.origin,
  });
}

function role(row: QueryResultRow) {
  return agentRole.parse({
    id: row.id,
    archivedAt: row.archived_at?.toISOString() ?? null,
    latest: snapshot(row),
  });
}

export class AgentCatalog {
  private readonly projects: ProjectRepository;

  constructor(private readonly pool: Pool) {
    this.projects = new ProjectRepository(pool);
  }

  async list(owner: string, project: string) {
    await this.projects.get(owner, project);
    const result = await this.pool.query(
      `SELECT r.id, r.archived_at, v.version, v.definition, v.origin
       FROM agent_roles r JOIN projects p ON p.id=r.project_id
       JOIN agent_versions v ON v.role_id=r.id AND v.version=r.latest_version
       WHERE p.id=$1 AND p.owner_id=$2
       ORDER BY r.archived_at NULLS FIRST, lower(v.definition->>'name'), r.id`,
      [project, owner],
    );
    return { roles: result.rows.map(role), templates: agentTemplates };
  }

  async read(owner: string, project: string, id: string) {
    const result = await this.pool.query(
      `SELECT r.id, r.archived_at, v.version, v.definition, v.origin
       FROM agent_roles r JOIN projects p ON p.id=r.project_id
       JOIN agent_versions v ON v.role_id=r.id
       WHERE p.id=$1 AND p.owner_id=$2 AND r.id=$3 ORDER BY v.version DESC`,
      [project, owner, id],
    );
    if (!result.rows[0]) throw missing();
    return { role: role(result.rows[0]), versions: result.rows.map(snapshot) };
  }

  async select(
    db: Pool | PoolClient,
    owner: string,
    project: string,
    selection: z.infer<typeof agentSelection>,
  ) {
    const result = await db.query(
      `SELECT r.id, r.archived_at, v.version, v.definition, v.origin
       FROM agent_roles r JOIN projects p ON p.id=r.project_id
       JOIN agent_versions v ON v.role_id=r.id
       WHERE p.id=$1 AND p.owner_id=$2 AND r.id=$3 AND v.version=$4`,
      [project, owner, selection.id, selection.version],
    );
    const row = result.rows[0];
    if (!row) throw missing();
    if (row.archived_at) throw archived();
    return snapshot(row);
  }

  private write<T>(owner: string, project: string, action: (db: PoolClient) => Promise<T>) {
    return this.projects.locked(owner, project, async (db, row) => {
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de cambiar roles.',
        );
      return action(db);
    });
  }

  create(owner: string, project: string, input: z.infer<typeof createAgentInput>) {
    const definition =
      'template' in input
        ? agentTemplates.find((item) => item.id === input.template)!.definition
        : input;
    const origin =
      'template' in input
        ? {
            kind: 'template',
            template: input.template,
            revision: templateRevision,
            reference: templateReference,
          }
        : { kind: 'custom' };
    return this.write(owner, project, async (db) => {
      const count = await db.query(
        'SELECT count(*)::int AS count FROM agent_roles WHERE project_id=$1',
        [project],
      );
      if (count.rows[0].count >= 50)
        throw new HttpError(422, 'agent_limit', 'Límite de roles del proyecto alcanzado.');
      const { id } = (
        await db.query('INSERT INTO agent_roles(project_id) VALUES($1) RETURNING id', [project])
      ).rows[0];
      await db.query(
        'INSERT INTO agent_versions(role_id,version,definition,origin) VALUES($1,1,$2,$3)',
        [id, JSON.stringify(definition), JSON.stringify(origin)],
      );
      return role({ id, version: 1, definition, origin });
    });
  }

  update(owner: string, project: string, id: string, input: z.infer<typeof updateAgentInput>) {
    return this.write(owner, project, async (db) => {
      const current = await this.current(db, project, id, input.version);
      if (input.version >= 50)
        throw new HttpError(422, 'agent_version_limit', 'Límite de versiones del rol alcanzado.');
      const version = input.version + 1;
      await db.query('UPDATE agent_roles SET latest_version=$2 WHERE id=$1', [id, version]);
      await db.query(
        'INSERT INTO agent_versions(role_id,version,definition,origin) VALUES($1,$2,$3,$4)',
        [id, version, JSON.stringify(input.definition), JSON.stringify(current.origin)],
      );
      return role({ ...current, version, definition: input.definition });
    });
  }

  archive(owner: string, project: string, id: string, version: number) {
    return this.write(owner, project, async (db) => {
      const current = await this.current(db, project, id, version);
      const result = await db.query(
        'UPDATE agent_roles SET archived_at=now() WHERE id=$1 RETURNING archived_at',
        [id],
      );
      return role({ ...current, archived_at: result.rows[0].archived_at });
    });
  }

  private async current(db: PoolClient, project: string, id: string, version: number) {
    const result = await db.query(
      `SELECT r.id, r.archived_at, v.version, v.definition, v.origin
       FROM agent_roles r JOIN agent_versions v ON v.role_id=r.id AND v.version=r.latest_version
       WHERE r.project_id=$1 AND r.id=$2`,
      [project, id],
    );
    const row = result.rows[0];
    if (!row) throw missing();
    if (row.archived_at) throw archived();
    if (row.version !== version) throw versionConflict();
    return row;
  }
}
