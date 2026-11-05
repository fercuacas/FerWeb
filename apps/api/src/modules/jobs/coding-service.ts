import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { z } from 'zod';
import {
  codingInput,
  codingConfiguration,
  codingRunSchema,
  codingPath,
  codingAgentSnapshot,
  skillPromptMaterial,
  supportsAgent,
  type repeatCodingInput,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { describeCoding } from '../../execution-capabilities.js';
import { GitHubService } from '../github/service.js';
import { ProjectRepository } from '../projects/repository.js';
import { JobService } from './service.js';
import { RunnerClient } from './runner-client.js';
import { indexable } from '../retrieval/chunking.js';
import { canonical } from './review-artifacts.js';
import { AgentCatalog } from '../agents/catalog.js';
import { SkillLibrary } from '../skills/library.js';
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const changed = () =>
  new HttpError(
    409,
    'coding_source_changed',
    'La tarea o el repositorio han cambiado. Actualiza antes de ejecutar.',
  );
const incompatible = () =>
  new HttpError(
    422,
    'agent_incompatible',
    'La versión del rol requiere capacidades o herramientas que Codex no ofrece.',
  );
export class CodingService {
  readonly projects: ProjectRepository;
  readonly jobs: JobService;
  private readonly agents: AgentCatalog;
  private readonly skills: SkillLibrary;
  constructor(
    readonly pool: Pool,
    readonly github: GitHubService,
    readonly runner: RunnerClient,
  ) {
    this.projects = new ProjectRepository(pool);
    this.jobs = new JobService(pool);
    this.agents = new AgentCatalog(pool);
    this.skills = new SkillLibrary(pool);
  }
  async capabilities(owner: string, project: string) {
    await this.projects.get(owner, project);
    const caps = await this.runner.capabilities();
    return {
      available: caps.available,
      models: caps.models,
      simulated: caps.simulated,
      environment: caps.environment,
      execution: describeCoding(caps),
    };
  }
  private async access(owner: string, project: string, repositoryId: number) {
    const { link } = await this.github.read(owner, project);
    if (!link || link.revoked || link.repositoryId !== repositoryId)
      throw new HttpError(
        403,
        'coding_source_denied',
        'No se puede confirmar acceso al repositorio de esta ejecución.',
      );
    return link;
  }
  async read(owner: string, project: string, id: string) {
    await this.projects.get(owner, project);
    const row = (
      await this.pool.query(
        'SELECT c.* FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1 AND j.project_id=$2 AND c.owner_id=$3',
        [id, project, owner],
      )
    ).rows[0];
    if (!row) throw missing();
    await this.access(owner, project, Number(row.repository_id));
    return codingRunSchema.parse({
      jobId: id,
      task: row.task_snapshot,
      commit: row.commit_sha,
      repository: row.repository,
      baseBranch: row.base_branch,
      environment: row.environment,
      manifest: row.manifest,
      excluded: row.excluded,
      report: row.report,
      agent: row.agent_snapshot,
      budget: await this.jobs.queue.budgets.forJob(owner, project, id),
    });
  }
  async create(owner: string, project: string, input: z.infer<typeof codingInput>) {
    const p = await this.projects.get(owner, project);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const old = (
      await this.pool.query(
        'SELECT id,request_hash FROM jobs WHERE project_id=$1 AND request_id=$2',
        [project, input.requestId],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== requestHash)
        throw new HttpError(
          409,
          'request_conflict',
          'Este identificador corresponde a otra ejecución.',
        );
      await this.read(owner, project, old.id);
      return this.jobs.detail(owner, project, old.id);
    }
    if (p.archivedAt)
      throw new HttpError(409, 'project_archived', 'Restaura el proyecto antes de ejecutar.');
    const task = await this.projects.getTask(owner, project, input.taskId);
    if (task.version !== input.taskVersion) throw changed();
    const agent = input.agent
      ? await this.agents.select(this.pool, owner, project, input.agent)
      : null;
    const materials = await this.skills.resolve(
      owner,
      project,
      (agent?.skills ?? []).map((item) => item.id),
    );
    if (materials.some((item, index) => item.sha256 !== agent?.skills?.[index]?.sha256))
      throw new HttpError(
        409,
        'skill_content_changed',
        'El material ya no coincide con la versión del rol.',
      );
    const capabilities = await this.runner.capabilities();
    if (
      !capabilities.available ||
      !capabilities.models.includes(input.model) ||
      !capabilities.environment
    )
      throw new HttpError(
        503,
        'codex_unconfigured',
        capabilities.available &&
          capabilities.models.length &&
          !capabilities.models.includes(input.model)
          ? 'El modelo no está permitido para el ejecutor Codex.'
          : 'Configura Codex en el servidor y selecciona un modelo permitido.',
      );
    const option = describeCoding(capabilities);
    if (agent && ![agent, ...materials].every((item) => supportsAgent(item, option)))
      throw incompatible();
    const { link } = await this.github.read(owner, project);
    if (
      !link ||
      link.revoked ||
      link.stale ||
      !link.snapshot ||
      link.snapshot.commit !== input.commit ||
      link.snapshot.treeTruncated
    )
      throw changed();
    const sourceTree = link.snapshot.tree;
    const files: { path: string; content: string }[] = [],
      manifest: { path: string; sha: string; contentHash: string }[] = [],
      excluded: string[] = [];
    let bytes = 0;
    for (const entry of link.snapshot.tree) {
      if (entry.type === 'tree') continue;
      if (
        !codingPath(entry.path) ||
        !indexable(entry.path) ||
        !['100644', '100755'].includes(entry.mode) ||
        (entry.size ?? 0) > 200000
      ) {
        excluded.push(entry.path);
        continue;
      }
      if (files.length >= 100)
        throw new HttpError(
          422,
          'coding_source_limit',
          'E8 admite hasta 100 archivos y 1 MB por snapshot.',
        );
      const file = await this.github.file(owner, project, entry.path, link.version);
      if (file.content.includes('\0')) {
        excluded.push(entry.path);
        continue;
      }
      bytes += Buffer.byteLength(file.content);
      if (bytes > 1000000 || Buffer.byteLength(file.content) > 200000)
        throw new HttpError(
          422,
          'coding_source_limit',
          'Snapshot demasiado grande para el perfil E8.',
        );
      files.push({ path: entry.path, content: file.content });
      manifest.push({
        path: entry.path,
        sha: entry.sha,
        contentHash: createHash('sha256').update(file.content).digest('hex'),
      });
    }
    if (!files.length)
      throw new HttpError(
        422,
        'coding_source_empty',
        'No hay archivos de texto permitidos para ejecutar.',
      );
    const fresh = await this.access(owner, project, link.repositoryId);
    if (fresh.version !== link.version || fresh.stale || fresh.snapshot?.commit !== input.commit)
      throw changed();
    const configuration = codingConfiguration.parse({
      taskId: task.id,
      commit: input.commit,
      model: input.model,
      maxRequests: input.maxRequests,
      maxOutputTokens: input.maxOutputTokens,
      limits: { timeoutMs: input.timeoutMs, maxAttempts: 1 },
    });
    const id = await this.jobs.queue.tx(async (db) => {
      const current = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!current) throw missing();
      const prior = (
        await db.query('SELECT id,request_hash FROM jobs WHERE project_id=$1 AND request_id=$2', [
          project,
          input.requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new HttpError(
            409,
            'request_conflict',
            'Identificador reutilizado con otras condiciones.',
          );
        return prior.id as string;
      }
      if (current.archived_at) throw changed();
      if (input.agent) await this.agents.select(db, owner, project, input.agent);
      const currentTask = (
        await db.query('SELECT version FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE', [
          task.id,
          project,
        ])
      ).rows[0];
      const source = (
        await db.query(
          'SELECT version,revoked,stale FROM github_links WHERE project_id=$1 AND repository_id=$2',
          [project, link.repositoryId],
        )
      ).rows[0];
      if (
        currentTask?.version !== task.version ||
        !source ||
        source.version !== link.version ||
        source.revoked ||
        source.stale
      )
        throw changed();
      const counts = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('pending','running'))::int AS active FROM jobs WHERE project_id=$1",
          [project],
        )
      ).rows[0];
      if (counts.total >= 1000 || counts.active >= 50)
        throw new HttpError(422, 'job_limit', 'Límite de trabajos del proyecto alcanzado.');
      const job = (
        await db.query(
          "INSERT INTO jobs(project_id,request_id,request_hash,title,kind,configuration) VALUES($1,$2,$3,$4,'codex-v1',$5) RETURNING id",
          [project, input.requestId, requestHash, task.title, JSON.stringify(configuration)],
        )
      ).rows[0];
      const budgetLimits = await this.jobs.queue.budgets.allocate(
        db,
        project,
        job.id,
        task.title,
        { maxRequests: input.maxRequests, timeoutMs: input.timeoutMs, concurrency: 1 },
        input.budgetId,
        input.attribution,
      );
      await db.query('UPDATE jobs SET configuration=$2 WHERE id=$1', [
        job.id,
        JSON.stringify({
          ...configuration,
          budgetLimits,
          budgetAttribution: input.attribution ?? 'agent',
        }),
      ]);
      await db.query(
        'INSERT INTO coding_runs(job_id,task_id,task_snapshot,owner_id,repository_id,repository,commit_sha,files,manifest,excluded,base_branch,source_tree,environment,agent_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          job.id,
          task.id,
          JSON.stringify(task),
          owner,
          link.repositoryId,
          link.fullName,
          input.commit,
          JSON.stringify(files),
          JSON.stringify(manifest),
          JSON.stringify(excluded),
          link.branch,
          JSON.stringify(sourceTree),
          JSON.stringify(capabilities.environment),
          agent ? JSON.stringify({ ...agent, ...(materials.length && { materials }) }) : null,
        ],
      );
      await this.jobs.queue.event(db, job.id, 'queued', 'Tarea y snapshot del commit guardados.');
      return job.id as string;
    });
    return this.jobs.detail(owner, project, id);
  }
  async executionInput(id: string, fence: string, checkOnly: boolean) {
    const row = (
      await this.pool.query(
        "SELECT j.*,c.owner_id,c.repository_id,c.repository,c.commit_sha,c.files,c.task_snapshot,c.environment,c.agent_snapshot FROM jobs j JOIN coding_runs c ON c.job_id=j.id JOIN projects p ON p.id=j.project_id WHERE j.id=$1 AND j.fence=$2 AND j.state='running' AND j.lease_until>clock_timestamp() AND NOT j.cancel_requested AND p.archived_at IS NULL",
        [id, fence],
      )
    ).rows[0];
    if (!row) throw missing();
    await this.access(row.owner_id, row.project_id, Number(row.repository_id));
    if (checkOnly) return { authorized: true };
    const agent = row.agent_snapshot ? codingAgentSnapshot.parse(row.agent_snapshot) : null;
    return {
      jobId: id,
      fence,
      repository: row.repository,
      commit: row.commit_sha,
      task: row.task_snapshot,
      ...(agent && {
        role: {
          purpose: agent.purpose,
          instructions: agent.instructions,
          outputFormat: agent.outputFormat,
          ...(agent.materials?.length && { materials: agent.materials.map(skillPromptMaterial) }),
        },
      }),
      files: row.files,
      environment: row.environment,
      model: row.configuration.model,
      maxRequests: row.configuration.maxRequests,
      maxOutputTokens: row.configuration.maxOutputTokens,
      deadlineAt: row.deadline_at.toISOString(),
      leaseExpiresAt: row.lease_until.toISOString(),
    };
  }
  async repeat(
    owner: string,
    project: string,
    baseline: string,
    input: z.infer<typeof repeatCodingInput>,
  ) {
    await this.read(owner, project, baseline);
    const source = (
      await this.pool.query(
        'SELECT c.*,j.configuration FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1',
        [baseline],
      )
    ).rows[0]!;
    const hash = createHash('sha256')
      .update(canonical({ baseline, ...input }))
      .digest('hex');
    const prior = (
      await this.pool.query(
        'SELECT id,request_hash FROM jobs WHERE project_id=$1 AND request_id=$2',
        [project, input.requestId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw changed();
      return this.jobs.detail(owner, project, prior.id);
    }
    const caps = await this.runner.capabilities();
    if (
      !caps.available ||
      !caps.models.includes(input.model) ||
      !source.environment ||
      canonical(caps.environment) !== canonical(source.environment)
    )
      throw new HttpError(
        409,
        'coding_environment_changed',
        'No se puede repetir con las mismas herramientas y límites. El modelo o el entorno ya no están disponibles.',
      );
    const configuration = codingConfiguration.parse({
      ...source.configuration,
      model: input.model,
    });
    const agent = source.agent_snapshot ? codingAgentSnapshot.parse(source.agent_snapshot) : null;
    const option = describeCoding(caps);
    if (agent && ![agent, ...(agent.materials ?? [])].every((item) => supportsAgent(item, option)))
      throw incompatible();
    const id = await this.jobs.queue.tx(async (db) => {
      const p = (
        await db.query('SELECT archived_at FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          project,
          owner,
        ])
      ).rows[0];
      if (!p || p.archived_at) throw changed();
      const old = (
        await db.query('SELECT id,request_hash FROM jobs WHERE project_id=$1 AND request_id=$2', [
          project,
          input.requestId,
        ])
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw changed();
        return old.id as string;
      }
      if (agent) await this.agents.select(db, owner, project, agent);
      const counts = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('pending','running'))::int AS active FROM jobs WHERE project_id=$1",
          [project],
        )
      ).rows[0];
      if (counts.total >= 1000 || counts.active >= 50)
        throw new HttpError(422, 'job_limit', 'Límite de trabajos alcanzado.');
      const job = (
        await db.query(
          "INSERT INTO jobs(project_id,request_id,request_hash,title,kind,configuration) VALUES($1,$2,$3,$4,'codex-v1',$5) RETURNING id",
          [
            project,
            input.requestId,
            hash,
            source.task_snapshot.title,
            JSON.stringify(configuration),
          ],
        )
      ).rows[0]!;
      await this.jobs.queue.budgets.allocate(
        db,
        project,
        job.id,
        source.task_snapshot.title,
        {
          maxRequests: configuration.maxRequests,
          timeoutMs: configuration.limits.timeoutMs,
          concurrency: 1,
        },
        undefined,
        configuration.budgetAttribution,
        configuration.budgetLimits,
      );
      await db.query(
        'INSERT INTO coding_runs(job_id,task_id,task_snapshot,owner_id,repository_id,repository,commit_sha,files,manifest,excluded,base_branch,source_tree,environment,agent_snapshot,baseline_job_id) SELECT $1,task_id,task_snapshot,owner_id,repository_id,repository,commit_sha,files,manifest,excluded,base_branch,source_tree,environment,agent_snapshot,job_id FROM coding_runs WHERE job_id=$2',
        [job.id, baseline],
      );
      await this.jobs.queue.event(
        db,
        job.id,
        'queued',
        'Comparación con tarea, archivos, commit, herramientas y límites congelados.',
        { baseline },
      );
      return job.id as string;
    });
    return this.jobs.detail(owner, project, id);
  }
}
