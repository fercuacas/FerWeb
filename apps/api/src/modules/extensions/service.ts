import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  extensionDetail,
  extensionManifest,
  extensionPreview,
  extensionRun,
  type ExtensionDetail,
  type ExtensionManifest,
  type extensionAction,
  type extensionImport,
  type extensionOperation,
  type extensionPreviewKind,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { ProjectRepository } from '../projects/repository.js';

const missing = () =>
  new HttpError(404, 'not_found', 'No se ha encontrado la extensión o el recurso.');
const conflict = () =>
  new HttpError(
    409,
    'extension_conflict',
    'La extensión o la vista previa han cambiado. Vuelve a revisar la copia actual.',
  );
const blocked = (message: string) => new HttpError(409, 'extension_blocked', message);
const invalid = (message: string) => new HttpError(422, 'extension_invalid', message);
type Action = z.infer<typeof extensionAction>;
type Resource = ExtensionDetail['resources'][number];
type PreviewKind = z.infer<typeof extensionPreviewKind>;
type Event = ExtensionDetail['events'][number];
type ExtensionRow = QueryResultRow & {
  id: string;
  selected_version: string;
  revision: number;
  state: ExtensionDetail['state'];
  config: ExtensionDetail['config'];
  approval_hash: string | null;
  manifest: ExtensionManifest;
  sha256: string;
};

const fixtureText =
  '# Ficha local de ejemplo\n\nEl conector devuelve solo el documento aprobado de esta extensión.';
const fixture: ExtensionManifest = {
  format: 1,
  slug: 'fixture-reader',
  name: 'Lector de ficha local',
  version: '1.0.0',
  origin: { kind: 'upload', label: 'Ejemplo de FerWeb' },
  license: 'MIT',
  notice: 'Ejemplo original de FerWeb disponible bajo licencia MIT.',
  resources: [{ path: 'ficha.md', text: fixtureText, sha256: digest(fixtureText) }],
  capabilities: ['read-resource'],
  dependencies: [{ kind: 'builtin', name: 'fixture-reader', version: '1.0.0' }],
  destinations: ['project-local'],
};

function validateResource(text: string) {
  if (!text.trim() || Buffer.byteLength(text) > 8192)
    throw invalid('El recurso debe contener texto UTF-8 y ocupar como máximo 8 KiB.');
}

function preview(row: ExtensionRow, resources: Resource[], operation: PreviewKind) {
  const wanted = new Map(
    (operation === 'enable' ? row.manifest.resources : []).map(({ path, sha256 }) => [
      path,
      sha256,
    ]),
  );
  const existing = new Map(
    resources.filter(({ visible }) => visible).map((resource) => [resource.path, resource]),
  );
  const changes = [...new Set([...existing.keys(), ...wanted.keys()])].sort().map((path) => {
    const previous = existing.get(path);
    const before = previous?.sha256 ?? null;
    const after = wanted.get(path) ?? null;
    if (previous?.owner === 'project') return { path, action: 'preserve', before, after: before };
    return {
      path,
      before,
      after,
      action: !before ? 'add' : !after ? 'hide' : before === after ? 'keep' : 'update',
    };
  });
  return extensionPreview.parse({
    operation,
    revision: row.revision,
    changes,
    sha256: digest(canonical([operation, row.id, row.revision, row.sha256, row.config, changes])),
  });
}

// The known connector receives one validated resource. It has no transport, credentials, or executable input.
function readResource(file: Pick<Resource, 'path' | 'sha256' | 'text'>) {
  return {
    path: file.path,
    resourceHash: file.sha256,
    text: file.text,
    destination: 'project-local' as const,
  };
}

export class ProjectExtensions {
  private readonly projects: ProjectRepository;
  constructor(private readonly pool: Pool) {
    this.projects = new ProjectRepository(pool);
  }

  private write<T>(owner: string, project: string, action: (db: PoolClient) => Promise<T>) {
    return this.projects.locked(owner, project, (db, row) => {
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de cambiar o ejecutar extensiones.',
        );
      return action(db);
    });
  }

  async list(owner: string, project: string) {
    await this.projects.get(owner, project);
    const { rows } = await this.pool.query(
      `SELECT e.id,e.slug,e.state,e.revision,v.version,v.manifest->>'name' AS name
      FROM project_extensions e JOIN extension_versions v ON v.extension_id=e.id AND v.version=e.selected_version
      WHERE e.project_id=$1 ORDER BY e.slug`,
      [project],
    );
    return { extensions: rows };
  }

  private async row(db: Pool | PoolClient, project: string, id: string): Promise<ExtensionRow> {
    const row = (
      await db.query(
        `SELECT e.*,v.manifest,v.sha256 FROM project_extensions e
      JOIN extension_versions v ON v.extension_id=e.id AND v.version=e.selected_version
      WHERE e.project_id=$1 AND e.id=$2`,
        [project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    const manifest = extensionManifest.parse(row.manifest);
    if (digest(canonical(manifest)) !== row.sha256) throw conflict();
    return { ...row, manifest } as ExtensionRow;
  }

  private async resources(db: Pool | PoolClient, id: string): Promise<Resource[]> {
    return (
      await db.query(
        'SELECT path,content AS text,sha256,owner,visible FROM extension_resources WHERE extension_id=$1 ORDER BY path',
        [id],
      )
    ).rows as Resource[];
  }

  private async detail(db: Pool | PoolClient, project: string, id: string) {
    const row = await this.row(db, project, id);
    const [resources, releases, events] = await Promise.all([
      this.resources(db, id),
      db.query(
        'SELECT version,sha256 FROM extension_versions WHERE extension_id=$1 ORDER BY version COLLATE "C" DESC',
        [id],
      ),
      db.query(
        `SELECT id,action,version,revision,recorded_at,path,resource_hash FROM extension_events
        WHERE extension_id=$1 ORDER BY recorded_at DESC,id LIMIT 100`,
        [id],
      ),
    ]);
    return extensionDetail.parse({
      id,
      slug: row.manifest.slug,
      version: row.selected_version,
      name: row.manifest.name,
      state: row.state,
      revision: row.revision,
      manifest: row.manifest,
      sha256: row.sha256,
      config: row.config,
      resources,
      releases: releases.rows,
      events: events.rows.map((event) => ({
        ...event,
        recordedAt: event.recorded_at.toISOString(),
        resourceHash: event.resource_hash,
      })),
      enablePreview: preview(row, resources, 'enable'),
      withdrawPreview: preview(row, resources, 'withdraw'),
    });
  }

  async read(owner: string, project: string, id: string) {
    await this.projects.get(owner, project);
    return this.detail(this.pool, project, id);
  }

  async import(owner: string, project: string, input: z.infer<typeof extensionImport>) {
    const manifest = extensionManifest.parse('manifest' in input ? input.manifest : fixture);
    for (const file of manifest.resources) {
      validateResource(file.text);
      if (digest(file.text) !== file.sha256) throw invalid('El SHA-256 del recurso no coincide.');
    }
    if (manifest.resources.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0) > 32768)
      throw invalid('El paquete ocupa más de 32 KiB.');
    const sha = digest(canonical(manifest));
    return this.write(owner, project, async (db) => {
      let existing = (
        await db.query(
          'SELECT id,revision FROM project_extensions WHERE project_id=$1 AND slug=$2',
          [project, manifest.slug],
        )
      ).rows[0];
      if (existing) {
        const old = (
          await db.query(
            'SELECT sha256 FROM extension_versions WHERE extension_id=$1 AND version=$2',
            [existing.id, manifest.version],
          )
        ).rows[0];
        if (old) {
          if (old.sha256 !== sha) throw conflict();
          return this.detail(db, project, existing.id);
        }
        if (
          (
            await db.query(
              'SELECT 1 FROM extension_versions WHERE extension_id=$1 OFFSET 29 LIMIT 1',
              [existing.id],
            )
          ).rowCount
        )
          throw invalid('Límite de versiones de la extensión alcanzado.');
        existing = (
          await db.query(
            `UPDATE project_extensions SET selected_version=$2,revision=revision+1,state='imported',config=NULL,approval_hash=NULL
          WHERE id=$1 RETURNING id,revision`,
            [existing.id, manifest.version],
          )
        ).rows[0]!;
      } else {
        if (
          (
            await db.query(
              'SELECT 1 FROM project_extensions WHERE project_id=$1 OFFSET 29 LIMIT 1',
              [project],
            )
          ).rowCount
        )
          throw invalid('Límite de extensiones del proyecto alcanzado.');
        existing = (
          await db.query(
            `INSERT INTO project_extensions(project_id,slug,selected_version,state)
          VALUES($1,$2,$3,'imported') RETURNING id,revision`,
            [project, manifest.slug, manifest.version],
          )
        ).rows[0]!;
      }
      await db.query(
        'INSERT INTO extension_versions(extension_id,version,manifest,sha256) VALUES($1,$2,$3,$4)',
        [existing.id, manifest.version, manifest, sha],
      );
      await this.event(db, existing.id, manifest.version, existing.revision, 'import');
      return this.detail(db, project, existing.id);
    });
  }

  private async event(
    db: PoolClient,
    id: string,
    version: string,
    revision: number,
    action: Event['action'],
    path: string | null = null,
    resourceHash: string | null = null,
    requestId: string | null = null,
  ) {
    return (
      await db.query(
        `INSERT INTO extension_events(extension_id,version,revision,action,path,resource_hash,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, version, revision, action, path, resourceHash, requestId],
      )
    ).rows[0]!.id as string;
  }

  private async applyResources(
    db: PoolClient,
    row: ExtensionRow,
    resources: Resource[],
    operation: PreviewKind,
  ) {
    const wanted = new Set(
      operation === 'enable' ? row.manifest.resources.map(({ path }) => path) : [],
    );
    for (const current of resources) {
      if (current.visible && current.owner === 'extension' && !wanted.has(current.path))
        await db.query(
          'UPDATE extension_resources SET visible=false WHERE extension_id=$1 AND path=$2',
          [row.id, current.path],
        );
    }
    if (operation === 'withdraw') return;
    for (const file of row.manifest.resources) {
      await db.query(
        `INSERT INTO extension_resources(extension_id,path,content,sha256,owner,visible)
        VALUES($1,$2,$3,$4,'extension',true) ON CONFLICT (extension_id,path) DO UPDATE
        SET content=EXCLUDED.content,sha256=EXCLUDED.sha256,visible=true WHERE extension_resources.owner='extension'`,
        [row.id, file.path, file.text, file.sha256],
      );
    }
  }

  async change(owner: string, project: string, id: string, input: Action) {
    return this.write(owner, project, async (db) => {
      const row = await this.row(db, project, id);
      if (row.revision !== input.revision) throw conflict();
      const resources = await this.resources(db, id);
      let state = row.state,
        config = row.config,
        approval = row.approval_hash,
        version = row.selected_version;
      let path: string | null = null,
        hash: string | null = null;
      switch (input.action) {
        case 'select': {
          if (
            !(
              await db.query(
                'SELECT 1 FROM extension_versions WHERE extension_id=$1 AND version=$2',
                [id, input.version],
              )
            ).rowCount
          )
            throw missing();
          version = input.version;
          state = 'imported';
          config = null;
          approval = null;
          break;
        }
        case 'configure': {
          if (
            !row.manifest.resources.some((file) => file.path === input.config.path) ||
            resources.some(
              (resource) => resource.path === input.config.path && resource.owner === 'project',
            )
          )
            throw invalid('Elige un recurso declarado que gestione la extensión.');
          path = input.config.path;
          state = 'configured';
          config = input.config;
          approval = null;
          break;
        }
        case 'review': {
          if (state !== 'configured' || !config)
            throw blocked('Configura un recurso antes de revisarlo.');
          if (preview(row, resources, 'enable').sha256 !== input.previewHash) throw conflict();
          state = 'reviewed';
          approval = digest(canonical([row.sha256, config]));
          hash = input.previewHash;
          break;
        }
        case 'enable': {
          if (
            state !== 'reviewed' ||
            !config ||
            approval !== digest(canonical([row.sha256, config]))
          )
            throw blocked('Revisa la configuración y los cambios antes de habilitar.');
          if (preview(row, resources, 'enable').sha256 !== input.previewHash) throw conflict();
          await this.applyResources(db, row, resources, 'enable');
          state = 'enabled';
          hash = input.previewHash;
          break;
        }
        case 'withdraw': {
          if (preview(row, resources, 'withdraw').sha256 !== input.previewHash) throw conflict();
          await this.applyResources(db, row, resources, 'withdraw');
          state = 'withdrawn';
          config = null;
          approval = null;
          hash = input.previewHash;
          break;
        }
        case 'edit': {
          if (!resources.some((resource) => resource.path === input.path && resource.visible))
            throw missing();
          validateResource(input.text);
          path = input.path;
          hash = digest(input.text);
          await db.query(
            `UPDATE extension_resources SET content=$3,sha256=$4,owner='project' WHERE extension_id=$1 AND path=$2`,
            [id, path, input.text, hash],
          );
          if (config?.path === path) config = null;
          state = config ? 'configured' : 'imported';
          approval = null;
          break;
        }
      }
      const revision = row.revision + 1;
      await db.query(
        'UPDATE project_extensions SET selected_version=$2,revision=$3,state=$4,config=$5,approval_hash=$6 WHERE id=$1',
        [id, version, revision, state, config, approval],
      );
      await this.event(db, id, version, revision, input.action, path, hash);
      return this.detail(db, project, id);
    });
  }

  async run(owner: string, project: string, id: string, input: z.infer<typeof extensionOperation>) {
    return this.write(owner, project, async (db) => {
      const row = await this.row(db, project, id);
      const prior = (
        await db.query(
          `SELECT e.id,e.revision,e.version,e.path,e.resource_hash,v.manifest,v.sha256
        FROM extension_events e JOIN extension_versions v ON v.extension_id=e.extension_id AND v.version=e.version
        WHERE e.extension_id=$1 AND e.request_id=$2 AND e.action='run'`,
          [id, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.revision !== input.revision) throw conflict();
        const manifest = extensionManifest.parse(prior.manifest);
        const file = manifest.resources.find(
          ({ path, sha256 }) => path === prior.path && sha256 === prior.resource_hash,
        );
        if (!file || digest(canonical(manifest)) !== prior.sha256) throw conflict();
        return extensionRun.parse({
          id: prior.id,
          version: prior.version,
          manifestHash: prior.sha256,
          ...readResource(file),
        });
      }
      if (row.revision !== input.revision) throw conflict();
      if (
        row.state !== 'enabled' ||
        !row.config ||
        row.approval_hash !== digest(canonical([row.sha256, row.config]))
      )
        throw blocked('Habilita la configuración revisada antes de ejecutar.');
      const file = row.manifest.resources.find(({ path }) => path === row.config!.path);
      const projected = (await this.resources(db, id)).find(
        ({ path, visible, owner }) => path === row.config!.path && visible && owner === 'extension',
      );
      if (
        !file ||
        !projected ||
        projected.sha256 !== file.sha256 ||
        digest(projected.text) !== file.sha256
      )
        throw conflict();
      if (
        (
          await db.query(
            "SELECT 1 FROM extension_events WHERE extension_id=$1 AND action='run' OFFSET 999 LIMIT 1",
            [id],
          )
        ).rowCount
      )
        throw invalid('Límite de ejecuciones del conector alcanzado.');
      const receipt = await this.event(
        db,
        id,
        row.selected_version,
        row.revision,
        'run',
        file.path,
        file.sha256,
        input.requestId,
      );
      return extensionRun.parse({
        id: receipt,
        version: row.selected_version,
        manifestHash: row.sha256,
        ...readResource(file),
      });
    });
  }
}
