import type { QueryResultRow } from 'pg';
import {
  codingInput,
  codingPath,
  recipeOverview,
  recipePlan,
  recipeSnapshot,
  supportsAgent,
  type RecipeInput,
  type RecipePlan,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { AgentCatalog } from '../agents/catalog.js';
import { agentTemplates } from '../agents/templates.js';
import { indexable } from '../retrieval/chunking.js';
import type { CodingService } from './coding-service.js';
import { freezeReviewTarget } from './dimension-reviews.js';
import { canonical, digest } from './review-artifacts.js';
import { recipes } from './recipe-catalog.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el plan de receta.');
const changed = () =>
  new HttpError(
    409,
    'recipe_changed',
    'La tarea, el alcance o las condiciones de la receta cambiaron. Prepara una copia nueva.',
  );
const invalid = (message: string) => new HttpError(422, 'recipe_arguments', message);

export function readRecipePlan(row: QueryResultRow): RecipePlan {
  const snapshot = recipeSnapshot.parse(row.snapshot);
  if (digest(canonical(snapshot)) !== row.hash) throw changed();
  return recipePlan.parse({
    id: row.id,
    hash: row.hash,
    snapshot,
    jobId: row.job_id,
    createdAt: row.created_at.toISOString(),
  });
}

export async function recipeTarget(
  coding: CodingService,
  owner: string,
  project: string,
  jobId: string,
) {
  const run = await coding.read(owner, project, jobId);
  const row = (
    await coding.pool.query(
      'SELECT c.*,j.state,j.configuration FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE c.job_id=$1 AND j.project_id=$2 AND c.owner_id=$3',
      [jobId, project, owner],
    )
  ).rows[0];
  if (!row) throw missing();
  return { row, run, target: freezeReviewTarget(row) };
}

export class RecipeService {
  private readonly agents: AgentCatalog;
  constructor(private readonly coding: CodingService) {
    this.agents = new AgentCatalog(coding.pool);
  }

  async list(owner: string, project: string, task: string) {
    await this.coding.projects.getTask(owner, project, task);
    const { rows } = await this.coding.pool.query(
      `SELECT id,hash,job_id,created_at,snapshot->'definition' AS definition
       FROM recipe_plans WHERE project_id=$1 AND task_id=$2 ORDER BY created_at DESC,id LIMIT 50`,
      [project, task],
    );
    return recipeOverview.parse({
      recipes,
      plans: rows.map((row) => ({
        id: row.id,
        key: row.definition.key,
        version: row.definition.version,
        jobId: row.job_id,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }

  private async owned(owner: string, project: string, task: string, id: string) {
    const row = (
      await this.coding.pool.query(
        'SELECT r.* FROM recipe_plans r JOIN projects p ON p.id=r.project_id WHERE r.project_id=$1 AND p.owner_id=$2 AND r.task_id=$3 AND r.id=$4',
        [project, owner, task, id],
      )
    ).rows[0];
    if (!row) throw missing();
    return row;
  }

  async read(owner: string, project: string, task: string, id: string) {
    const plan = readRecipePlan(await this.owned(owner, project, task, id));
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.repositoryId !== plan.snapshot.repositoryId)
      throw new HttpError(
        403,
        'recipe_source_denied',
        'No se puede confirmar acceso al repositorio de la receta.',
      );
    if (plan.snapshot.source) await this.coding.read(owner, project, plan.snapshot.source.jobId);
    return plan;
  }

  async prepare(owner: string, project: string, taskId: string, raw: RecipeInput) {
    const { requestId, ...input } = raw;
    const requestHash = digest(canonical([taskId, input]));
    const prior = (
      await this.coding.pool.query(
        'SELECT r.id,r.request_hash FROM recipe_plans r JOIN projects p ON p.id=r.project_id WHERE r.project_id=$1 AND r.request_id=$2 AND p.owner_id=$3',
        [project, requestId, owner],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw changed();
      return this.read(owner, project, taskId, prior.id);
    }
    const task = await this.coding.projects.getTask(owner, project, taskId);
    if (task.version !== input.taskVersion) throw changed();
    const definition = recipes.find(
      (item) => item.key === input.key && item.version === input.version,
    );
    if (!definition) throw invalid('La versión de la receta no está disponible para preparar.');
    const { mode } = definition;
    const launches = mode === 'read' || mode === 'write';
    const usesDiff = input.key === 'review' || input.key === 'pr-draft';
    if (usesDiff !== Boolean(input.sourceJobId) || (usesDiff && input.paths.length))
      throw invalid('Selecciona el informe con diff para fijar su alcance.');
    if (
      launches !== Boolean(input.model) ||
      (!launches && (input.profile || input.agent)) ||
      (mode === 'read' && input.profile) ||
      (mode !== 'plan' && input.format)
    )
      throw invalid('Los parámetros no corresponden al efecto de la receta.');
    if (mode === 'write' && !input.paths.length)
      throw invalid('Selecciona al menos un archivo existente para limitar la escritura.');
    if (input.key === 'docs' && input.paths.some((path) => !/\.md$/i.test(path)))
      throw invalid('La receta de documentación admite archivos Markdown.');
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.stale || !link.snapshot || link.snapshot.treeTruncated)
      throw changed();
    const tree = link.snapshot.tree;
    for (const path of input.paths)
      if (
        !codingPath(path) ||
        !indexable(path) ||
        /^(?:\.github|\.npmrc)(?:\/|$)/i.test(path) ||
        !tree.some(
          (entry) =>
            entry.path === path &&
            entry.type === 'blob' &&
            ['100644', '100755'].includes(entry.mode),
        )
      )
        throw invalid('Usa rutas regulares admitidas del snapshot sincronizado.');
    const role = input.agent
      ? await this.agents.select(this.coding.pool, owner, project, input.agent)
      : agentTemplates.find((entry) => entry.id === definition.role)!.definition;
    let runtimeRevision: string | null = null;
    let simulated: boolean | null = null;
    if (launches) {
      const capabilities = await this.coding.capabilities(owner, project);
      const option =
        mode === 'read'
          ? capabilities.readOnlyExecution
          : input.profile === 'typescript-react-v1'
            ? capabilities.typescriptExecution
            : capabilities.execution;
      if (
        !option.available ||
        !option.configurationRevision ||
        !option.models.some(({ id }) => id === input.model) ||
        option.capabilities.toolCalls !== 'supported' ||
        (mode === 'write' && option.capabilities.workspaceWrite !== 'supported') ||
        (input.agent && !supportsAgent(role, option))
      )
        throw invalid('El modelo, rol o perfil no admite el efecto de esta receta.');
      runtimeRevision = option.configurationRevision;
      simulated = option.simulated;
    }
    let source: RecipePlan['snapshot']['source'] = null;
    if (input.sourceJobId) {
      const { target, row, run } = await recipeTarget(
        this.coding,
        owner,
        project,
        input.sourceJobId,
      );
      if (
        row.task_id !== taskId ||
        row.task_snapshot.version !== task.version ||
        row.commit_sha !== link.snapshot.commit ||
        target.diff.length > 12 ||
        Buffer.byteLength(JSON.stringify([target.files, target.diff])) > 1_050_000 ||
        (mode === 'draft' &&
          (row.state !== 'completed' ||
            run.teamExecutionId ||
            row.configuration.workspaceAccess ||
            row.report.controls?.events.some(
              (event: { status: string }) => event.status !== 'passed',
            )))
      )
        throw invalid(
          'El informe debe tener un diff íntegro de la misma tarea y snapshot dentro del límite de rutas.',
        );
      source = {
        jobId: target.jobId,
        artifactHash: target.artifactHash,
        paths: target.diff.map((file) => file.path),
      };
    }
    const scope = input.paths.length ? input.paths.join(', ') : 'Snapshot de la tarea';
    const steps = definition.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
    const acceptance = task.acceptanceCriteria.length
      ? task.acceptanceCriteria.map((criterion) => '- ' + criterion).join('\n')
      : 'Define la comprobación antes de ejecutar.';
    let preview: string | null = null;
    if (mode === 'plan') {
      const sections = {
        steps: [
          ['Objetivo', task.description],
          ['Alcance', scope],
          ['Pasos', steps],
          ['Criterios y validación', acceptance],
        ],
        adr: [
          ['Contexto', task.description],
          ['Decisión propuesta', 'Registra el cambio y el criterio que justifica adoptarlo.'],
          ['Alternativas', 'Indica las opciones consideradas y las razones de la elección.'],
          ['Consecuencias', 'Identifica los efectos en contratos y dependencias.'],
          ['Alcance', scope],
          ['Validación', acceptance],
        ],
        impact: [
          ['Cambio previsto', task.description],
          ['Rutas y contratos', scope],
          ['Impacto y riesgos', 'Identifica consumidores, datos y operaciones afectados.'],
          [
            'Verificación y reversión',
            acceptance + '\n\nDefine cómo restaurar el comportamiento anterior.',
          ],
        ],
      }[input.format ?? 'steps'];
      preview = `# ${task.title}\n\n${sections.map(([heading, content]) => `## ${heading}\n\n${content}`).join('\n\n')}`;
    } else if (mode === 'draft') {
      preview = `# ${task.title}\n\n## Resumen\n\n${task.description}\n\n## Cambios\n\n${source!.paths.map((path) => '- ' + path).join('\n')}\n\n## Verificación\n\nCompletar con las comprobaciones observadas del informe ${source!.jobId}.\n`;
    }
    const snapshot = recipeSnapshot.parse({
      definition,
      input,
      task,
      repository: link.fullName,
      repositoryId: link.repositoryId,
      commit: link.snapshot.commit,
      runtimeRevision,
      simulated,
      role,
      source,
      preview,
    });
    const id = await this.coding.projects.locked(owner, project, async (db, row) => {
      if (row.archived_at) throw changed();
      const old = (
        await db.query(
          'SELECT id,request_hash FROM recipe_plans WHERE project_id=$1 AND request_id=$2',
          [project, requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw changed();
        return old.id as string;
      }
      const locked = (
        await db.query(
          `SELECT t.version,g.version AS link_version,g.stale,g.revoked
         FROM tasks t JOIN github_links g ON g.project_id=t.project_id
         WHERE t.id=$1 AND t.project_id=$2 FOR SHARE OF t,g`,
          [taskId, project],
        )
      ).rows[0];
      if (
        locked?.version !== input.taskVersion ||
        locked.link_version !== link.version ||
        locked.stale ||
        locked.revoked
      )
        throw changed();
      if (
        (
          await db.query('SELECT 1 FROM recipe_plans WHERE project_id=$1 OFFSET 999 LIMIT 1', [
            project,
          ])
        ).rowCount
      )
        throw invalid('El proyecto admite hasta 1000 planes de receta.');
      return (
        await db.query(
          'INSERT INTO recipe_plans(project_id,task_id,request_id,request_hash,hash,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            project,
            taskId,
            requestId,
            requestHash,
            digest(canonical(snapshot)),
            JSON.stringify(snapshot),
          ],
        )
      ).rows[0].id as string;
    });
    return this.read(owner, project, taskId, id);
  }

  async execute(owner: string, project: string, task: string, id: string, hash: string) {
    const plan = await this.read(owner, project, task, id);
    if (plan.hash !== hash) throw changed();
    const { input, definition, commit } = plan.snapshot;
    if (definition.mode !== 'read' && definition.mode !== 'write')
      throw invalid('Esta receta entrega un borrador o un plan para consultar.');
    await this.coding.create(
      owner,
      project,
      codingInput.parse({
        requestId: id,
        taskId: task,
        taskVersion: input.taskVersion,
        commit,
        model: input.model,
        toolProfile: input.profile,
        agent: input.agent,
        timeoutMs: definition.timeoutMs,
        maxRequests: definition.maxRequests,
        maxOutputTokens: definition.maxOutputTokens,
      }),
      undefined,
      plan,
    );
    return this.read(owner, project, task, id);
  }
}
