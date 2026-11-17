import type { PoolClient } from 'pg';
import { canvasResponse, type CanvasEntryInput, type CanvasKind } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { rejectMemorySecrets } from '../memory/codec.js';
import type { TeamService } from '../teams/service.js';
import type { CodingService } from './coding-service.js';
import { freezeReviewTarget } from './dimension-reviews.js';
import { recipeTarget, type RecipeService } from './recipe-service.js';
import { canonical, digest } from './review-artifacts.js';

const missing = () =>
  new HttpError(404, 'not_found', 'No se ha encontrado el elemento de revisión.');
const changed = () =>
  new HttpError(409, 'canvas_changed', 'La copia o la revisión cambió. Vuelve a abrirla.');
const fingerprint = (value: unknown) => digest(canonical(value));
const whole = { id: 'overview', title: 'Vista completa' };
const fileElement = (path: string) => ({ id: 'file:' + digest(path), title: path });

export class ReviewCanvas {
  constructor(
    private readonly coding: CodingService,
    private readonly teams: TeamService,
    private readonly recipes: RecipeService,
  ) {}

  private async target(owner: string, project: string, kind: CanvasKind, id: string) {
    if (kind === 'plan') {
      const { plan } = await this.teams.readPlan(owner, project, id);
      const task = await this.coding.projects.getTask(owner, project, plan.snapshot.task.id);
      return {
        hash: plan.hash,
        version: plan.snapshot.version,
        approved: plan.approval?.hash === plan.hash && task.version === plan.snapshot.task.version,
        elements: [
          whole,
          ...plan.snapshot.steps.map(({ key, title }) => ({ id: 'step:' + key, title })),
          ...(plan.snapshot.reviewTarget?.diff.slice(0, 100).map(({ path }) => fileElement(path)) ??
            []),
        ],
      };
    }
    if (kind === 'recipe') {
      const row = (
        await this.coding.pool.query(
          'SELECT task_id FROM recipe_plans WHERE project_id=$1 AND id=$2',
          [project, id],
        )
      ).rows[0];
      if (!row) throw missing();
      const plan = await this.recipes.read(owner, project, row.task_id, id);
      return {
        hash: plan.hash,
        version: plan.snapshot.definition.version,
        approved: false,
        elements: [
          whole,
          ...plan.snapshot.definition.steps.map((title, index) => ({
            id: 'step:' + (index + 1),
            title,
          })),
          ...(plan.snapshot.source?.paths ?? plan.snapshot.input.paths).map(fileElement),
        ],
      };
    }
    const { target } = await recipeTarget(this.coding, owner, project, id);
    return {
      hash: target.artifactHash,
      version: 1,
      approved: false,
      elements: [
        whole,
        ...target.diff.map(({ path, afterHash }) => ({
          ...fileElement(path),
          ...(afterHash && /\.html?$/i.test(path) && { htmlDownload: true as const }),
        })),
      ],
      artifact: target,
    };
  }

  async read(owner: string, project: string, kind: CanvasKind, id: string) {
    const target = await this.target(owner, project, kind, id);
    const { rows } = await this.coding.pool.query(
      `SELECT c.*,u.email FROM canvas_entries c JOIN app_users u ON u.id=c.owner_id
       WHERE c.project_id=$1 AND c.owner_id=$2 AND c.kind=$3 AND c.target_id=$4 ORDER BY c.sequence LIMIT 200`,
      [project, owner, kind, id],
    );
    const latest = rows.findLast(
      (row) => row.hash === target.hash && ['request_changes', 'approve'].includes(row.action),
    );
    return canvasResponse.parse({
      hash: target.hash,
      version: target.version,
      elements: target.elements,
      decision: latest?.action ?? (target.approved ? 'approve' : null),
      entries: rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        hash: row.hash,
        element: row.element,
        action: row.action,
        text: row.body,
        replyTo: row.reply_to,
        author: row.email,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }

  private async assertCurrent(
    db: PoolClient,
    project: string,
    kind: CanvasKind,
    id: string,
    target: Awaited<ReturnType<ReviewCanvas['target']>>,
  ) {
    const table = kind === 'plan' ? 'prepared_team_plans' : 'recipe_plans';
    if (kind !== 'diff') {
      const row = (
        await db.query(`SELECT * FROM ${table} WHERE project_id=$1 AND id=$2 FOR UPDATE`, [
          project,
          id,
        ])
      ).rows[0];
      if (!row || row.hash !== target.hash || fingerprint(row.snapshot) !== target.hash)
        throw changed();
      return row;
    }
    const row = (
      await db.query(
        `SELECT c.*,j.state,j.configuration FROM coding_runs c JOIN jobs j ON j.id=c.job_id
       WHERE j.project_id=$1 AND c.job_id=$2 FOR SHARE OF c,j`,
        [project, id],
      )
    ).rows[0];
    if (!row || freezeReviewTarget(row).artifactHash !== target.hash) throw changed();
    return row;
  }

  async add(owner: string, project: string, kind: CanvasKind, id: string, input: CanvasEntryInput) {
    rejectMemorySecrets(input.text);
    const target = await this.target(owner, project, kind, id);
    if (input.hash !== target.hash || !target.elements.some(({ id }) => id === input.element))
      throw changed();
    if (kind === 'plan' && input.action === 'approve')
      throw new HttpError(
        422,
        'canvas_plan_approval',
        'Aprueba el plan con la acción de ejecución del equipo.',
      );
    const requestHash = fingerprint([kind, id, input]);
    await this.coding.projects.locked(owner, project, async (db, scope) => {
      if (scope.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto para añadir una revisión.',
        );
      const previous = (
        await db.query(
          'SELECT request_hash FROM canvas_entries WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw changed();
        return;
      }
      const row = await this.assertCurrent(db, project, kind, id, target);
      if (
        input.replyTo &&
        !(
          await db.query(
            'SELECT 1 FROM canvas_entries WHERE id=$1 AND project_id=$2 AND kind=$3 AND target_id=$4 AND hash=$5 AND element=$6',
            [input.replyTo, project, kind, id, input.hash, input.element],
          )
        ).rowCount
      )
        throw missing();
      if (
        (
          await db.query(
            'SELECT 1 FROM canvas_entries WHERE project_id=$1 AND kind=$2 AND target_id=$3 OFFSET 199 LIMIT 1',
            [project, kind, id],
          )
        ).rowCount
      )
        throw new HttpError(409, 'canvas_limit', 'La revisión admite hasta 200 anotaciones.');
      if (kind === 'plan' && input.action === 'request_changes') {
        if (row.execution_id) throw changed();
        await db.query('UPDATE prepared_team_plans SET changes_requested=true WHERE id=$1', [id]);
      }
      await db.query(
        'INSERT INTO canvas_entries(project_id,owner_id,kind,target_id,hash,element,action,body,reply_to,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          project,
          owner,
          kind,
          id,
          input.hash,
          input.element,
          input.action,
          input.text ?? null,
          input.replyTo ?? null,
          input.requestId,
          requestHash,
        ],
      );
    });
    return this.read(owner, project, kind, id);
  }

  async htmlSource(owner: string, project: string, id: string, element: string, hash: string) {
    const target = await this.target(owner, project, 'diff', id);
    if (hash !== target.hash) throw changed();
    const path = target.artifact?.diff.find(
      ({ path }) => /\.html?$/i.test(path) && fileElement(path).id === element,
    )?.path;
    const file = target.artifact?.files.find((file) => file.path === path);
    if (!file) throw missing();
    return file.content;
  }
}
