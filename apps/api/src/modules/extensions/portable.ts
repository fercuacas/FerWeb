import { crc32 } from 'node:zlib';
import type { Pool } from 'pg';
import type { z } from 'zod';
import {
  portableBundle,
  portablePreview,
  skillIsPortable,
  teamTemplateVersion,
  type PortableBundle,
  type portableSelection,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { AgentCatalog } from '../agents/catalog.js';
import { SkillLibrary } from '../skills/library.js';
import { ProjectRepository } from '../projects/repository.js';
import { canonical, digest } from '../jobs/review-artifacts.js';

type File = { path: string; text: string };
const roleId = (id: string, version: number) => `ferweb_role_${id.replaceAll('-', '')}_v${version}`;
const skillId = (id: string) => `ferweb-skill-${id.replaceAll('-', '')}`;
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
function toml(value: string) {
  if (/[\uD800-\uDFFF]/u.test(value))
    throw new HttpError(
      422,
      'portable_text_invalid',
      'Corrige el texto Unicode del rol antes de exportarlo.',
    );
  return JSON.stringify(value).replaceAll('\x7f', '\\u007f');
}

export class PortableCatalog {
  private readonly projects: ProjectRepository;
  private readonly agents: AgentCatalog;
  private readonly skills: SkillLibrary;

  constructor(private readonly pool: Pool) {
    this.projects = new ProjectRepository(pool);
    this.agents = new AgentCatalog(pool);
    this.skills = new SkillLibrary(pool);
  }

  async build(owner: string, project: string, input: z.infer<typeof portableSelection>) {
    await this.projects.get(owner, project);
    let workflow: PortableBundle['workflow'] = null;
    if (input.workflow) {
      const row = (
        await this.pool.query(
          `SELECT t.id,v.version,v.definition,v.origin FROM team_templates t
        JOIN team_template_versions v ON v.template_id=t.id WHERE t.project_id=$1 AND t.id=$2 AND v.version=$3`,
          [project, input.workflow.id, input.workflow.version],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(404, 'not_found', 'No se ha encontrado la versión de la plantilla.');
      workflow = teamTemplateVersion.parse(row);
    }
    const selections = [
      ...(input.role ? [input.role] : []),
      ...(workflow?.definition.steps.map(({ role }) => role) ?? []),
    ];
    const unique = new Map(selections.map((item) => [roleId(item.id, item.version), item]));
    const roles = await Promise.all(
      [...unique.values()].map((item) => this.agents.select(this.pool, owner, project, item)),
    );
    const references = roles.flatMap((role) => role.skills ?? []);
    const ids = new Set([
      ...references.map(({ id }) => id),
      ...(input.skillId ? [input.skillId] : []),
    ]);
    const skills = await Promise.all([...ids].map((id) => this.skills.read(owner, project, id)));
    if (
      skills.some(
        (item) =>
          item.review !== 'approved' ||
          !skillIsPortable(item) ||
          item.files.some((file) => digest(file.text) !== file.sha256),
      ) ||
      references.some(
        (item) =>
          !skills.some(
            (skill) =>
              skill.id === item.id &&
              skill.version === item.version &&
              skill.sha256 === item.sha256,
          ),
      )
    )
      throw new HttpError(
        422,
        'portable_unapproved_skill',
        'Exporta solo skills de texto aprobadas con archivos y versiones íntegros.',
      );

    const bundle = portableBundle.parse({ format: 'ferweb-portable-v1', roles, skills, workflow });
    const files = codexFiles(bundle);
    const checksums = files.map(({ path, text }) => ({ path, sha256: digest(text) }));
    const summary = portablePreview.parse({
      sha256: digest(canonical(checksums)),
      roles: roles.length,
      skills: skills.length,
      workflow: !!workflow,
      files: checksums,
    });
    return { bundle, files, summary };
  }
}

function codexFiles(bundle: PortableBundle): File[] {
  const files: File[] = [
    { path: 'ferweb-portable.json', text: json(bundle) },
    {
      path: 'LEEME-FERWEB.md',
      text: [
        '# Exportación FerWeb para Codex',
        '',
        'Revisa las instrucciones y las rutas en un directorio vacío antes de copiarlas a un proyecto.',
        'Los roles se guardan en `.codex/agents` y las skills en `.agents/skills`.',
        'El workflow en `ferweb-portable.json` describe el orden y los requisitos para el operador.',
        'Aplica tus propios permisos, proveedor, presupuesto y revisiones antes de usar el material.',
        '',
      ].join('\n'),
    },
  ];
  for (const role of bundle.roles) {
    const name = roleId(role.id, role.version);
    const linked = (role.skills ?? []).map(({ id }) => '$' + skillId(id));
    const instructions = [
      role.instructions,
      'Salida: ' + role.outputFormat,
      ...(linked.length ? ['Skills aprobadas: ' + linked.join(', ')] : []),
    ].join('\n\n');
    files.push({
      path: `.codex/agents/${name}.toml`,
      text: `name = ${toml(name)}\ndescription = ${toml(role.purpose)}\ndeveloper_instructions = ${toml(instructions)}\n`,
    });
  }
  for (const skill of bundle.skills) {
    const name = skillId(skill.id);
    const root = `.agents/skills/${name}`;
    const references = skill.files.map((file, index) => {
      const path = `references/resource-${index + 1}.md`;
      files.push({ path: `${root}/${path}`, text: file.text });
      return `- [${file.path}](${path})`;
    });
    files.push({
      path: `${root}/SKILL.md`,
      text: [
        '---',
        `name: ${JSON.stringify(name)}`,
        `description: ${JSON.stringify(skill.description)}`,
        '---',
        '',
        '# ' + skill.name,
        '',
        'Consulta el material revisado según la tarea y los permisos vigentes.',
        '',
        ...references,
        '',
      ].join('\n'),
    });
    files.push({ path: `${root}/LICENSE.txt`, text: `${skill.license}\n\n${skill.notice}\n` });
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

// Stored ZIP entries with generated ASCII paths and no executable file modes.
export function codexArchive(files: File[]) {
  const safePath =
    /^(?:ferweb-portable\.json|LEEME-FERWEB\.md|\.codex\/agents\/ferweb_role_[a-f0-9]{32}_v[1-9][0-9]*\.toml|\.agents\/skills\/ferweb-skill-[a-f0-9]{32}\/(?:SKILL\.md|LICENSE\.txt|references\/resource-[1-6]\.md))$/;
  if (
    new Set(files.map(({ path }) => path)).size !== files.length ||
    files.some(({ path }) => !safePath.test(path))
  )
    throw new HttpError(422, 'portable_path_invalid', 'Hay rutas no admitidas en la exportación.');
  const chunks: Buffer[] = [],
    entries: Buffer[] = [];
  let offset = 0;
  for (const { path, text } of files) {
    const name = Buffer.from(path, 'ascii'),
      body = Buffer.from(text),
      crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); // DOS date 1980-01-01.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    entries.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(entries),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
