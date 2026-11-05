import { TextDecoder } from 'node:util';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  skillContent,
  skillIsPortable,
  skillPromptLimit,
  skillPromptMaterial,
  skillSummary,
  skillVersion,
  type SkillContent,
  type SkillManifest,
  type skillImportInput,
  type skillReviewInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
import { ProjectRepository } from '../projects/repository.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { curatedSkills } from './curated.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const invalid = (message: string) => new HttpError(422, 'skill_invalid', message);
const scopedVersions = `FROM skill_versions v
  JOIN skill_packages k ON k.id=v.package_id JOIN projects p ON p.id=k.project_id
  WHERE p.owner_id=$1 AND p.id=$2`;

function version(row: QueryResultRow) {
  return skillVersion.parse({
    ...row.content,
    id: row.id,
    version: row.version,
    sha256: row.sha256,
    review: row.review,
  });
}

function unpack(manifest: SkillManifest): SkillContent {
  const { format: _format, source, files, ...metadata } = manifest;
  const paths = new Set<string>();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let total = 0;
  const decoded = files.map(({ path, sha256, contentBase64 }) => {
    const key = path.toLowerCase();
    if (paths.has(key)) throw invalid('El paquete contiene rutas repetidas.');
    paths.add(key);
    const bytes = Buffer.from(contentBase64, 'base64');
    total += bytes.length;
    if (bytes.toString('base64') !== contentBase64 || bytes.length > 12288 || total > 36864)
      throw invalid('El archivo no tiene Base64 canónico o supera el límite de tamaño.');
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw invalid('El archivo debe estar codificado en UTF-8.');
    }
    if (!text.trim() || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text))
      throw invalid('El archivo debe contener texto sin caracteres de control.');
    if (digest(text) !== sha256) throw invalid('El SHA-256 del archivo no coincide.');
    return { path, sha256, text };
  });
  const names = new Set(decoded.map((file) => file.path));
  if (metadata.resources.some((item) => item.kind === 'file' && !names.has(item.name)))
    throw invalid('Falta un recurso de texto declarado en el paquete.');
  return skillContent.parse({ ...metadata, origin: { kind: 'upload', source }, files: decoded });
}

export class SkillLibrary {
  private readonly projects: ProjectRepository;

  constructor(private readonly pool: Pool) {
    this.projects = new ProjectRepository(pool);
  }

  async list(owner: string, project: string) {
    await this.projects.get(owner, project);
    const result = await this.pool.query(
      `SELECT v.id, v.version, v.sha256, v.review, v.content - 'files' - 'notice' AS content
       ${scopedVersions} ORDER BY k.slug, v.version DESC`,
      [owner, project],
    );
    return {
      versions: result.rows.map((row) =>
        skillSummary.parse({
          ...row.content,
          id: row.id,
          version: row.version,
          sha256: row.sha256,
          review: row.review,
        }),
      ),
      curated: curatedSkills.map(({ files: _files, notice: _notice, ...summary }) => summary),
    };
  }

  async read(owner: string, project: string, id: string, db: Pool | PoolClient = this.pool) {
    const result = await db.query(`SELECT v.* ${scopedVersions} AND v.id=$3`, [owner, project, id]);
    if (!result.rows[0]) throw missing();
    return version(result.rows[0]);
  }

  import(owner: string, project: string, input: z.infer<typeof skillImportInput>) {
    return this.write(owner, project, async (db) => {
      const content =
        'manifest' in input
          ? unpack(input.manifest)
          : curatedSkills.find((item) => item.slug === input.curated);
      if (!content) throw missing();
      const sha = digest(canonical(content));
      let pack = (
        await db.query('SELECT id FROM skill_packages WHERE project_id=$1 AND slug=$2', [
          project,
          content.slug,
        ])
      ).rows[0];
      if (!pack) {
        const count = await db.query(
          'SELECT count(*)::int AS count FROM skill_packages WHERE project_id=$1',
          [project],
        );
        if (count.rows[0].count >= 50) throw invalid('Límite de paquetes del proyecto alcanzado.');
        pack = (
          await db.query('INSERT INTO skill_packages(project_id,slug) VALUES($1,$2) RETURNING id', [
            project,
            content.slug,
          ])
        ).rows[0]!;
      }
      const existing = (
        await db.query('SELECT * FROM skill_versions WHERE package_id=$1 AND sha256=$2', [
          pack.id,
          sha,
        ])
      ).rows[0];
      if (existing) return version(existing);
      const latest = (
        await db.query(
          'SELECT COALESCE(max(version),0) AS version FROM skill_versions WHERE package_id=$1',
          [pack.id],
        )
      ).rows[0].version as number;
      if (latest >= 50) throw invalid('Límite de versiones del paquete alcanzado.');
      const saved = await db.query(
        'INSERT INTO skill_versions(package_id,version,content,sha256) VALUES($1,$2,$3,$4) RETURNING *',
        [pack.id, latest + 1, JSON.stringify(content), sha],
      );
      return version(saved.rows[0]!);
    });
  }

  review(owner: string, project: string, id: string, input: z.infer<typeof skillReviewInput>) {
    return this.write(owner, project, async (db) => {
      const current = await this.read(owner, project, id, db);
      if (
        current.sha256 !== input.sha256 ||
        (current.review !== 'pending' && current.review !== input.state)
      )
        throw new HttpError(
          409,
          'skill_review_conflict',
          'El contenido o la revisión han cambiado.',
        );
      if (current.review === input.state) return current;
      if (input.state === 'approved' && !skillIsPortable(current))
        throw invalid('Esta versión requiere recursos que FerWeb no puede activar.');
      await db.query('UPDATE skill_versions SET review=$2 WHERE id=$1', [id, input.state]);
      return { ...current, review: input.state };
    });
  }

  async resolve(owner: string, project: string, ids: string[], db: Pool | PoolClient = this.pool) {
    if (!ids.length) return [];
    const result = await db.query(`SELECT v.* ${scopedVersions} AND v.id=ANY($3::uuid[])`, [
      owner,
      project,
      ids,
    ]);
    const byId = new Map(result.rows.map((row) => [row.id, version(row)]));
    const materials = ids.map((id) => {
      const item = byId.get(id);
      if (!item) throw missing();
      if (item.review !== 'approved' || !skillIsPortable(item))
        throw invalid('Vincula solo versiones de texto aprobadas.');
      return item;
    });
    const bytes = Buffer.byteLength(JSON.stringify(materials.map(skillPromptMaterial)));
    if (bytes > skillPromptLimit) throw invalid('El material del rol supera 24 KiB.');
    return materials;
  }

  private write<T>(owner: string, project: string, action: (db: PoolClient) => Promise<T>) {
    return this.projects.locked(owner, project, (db, row) => {
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de cambiar su biblioteca.',
        );
      return action(db);
    });
  }
}
