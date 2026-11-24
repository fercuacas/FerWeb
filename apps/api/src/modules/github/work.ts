import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  gitHubWorkResponse,
  gitHubIssueAction,
  githubItemSchema,
  type GitHubSnapshot,
  type linkGitHubWorkInput,
  type prepareGitHubIssueInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import type { GitHubService } from './service.js';
import { ProjectRepository } from '../projects/repository.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { HttpError } from '../../http-error.js';

const changed = () =>
  new HttpError(
    409,
    'github_work_changed',
    'Las condiciones han cambiado. Actualiza y prepara otra vista previa.',
  );
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado la acción.');
export async function observeGitHubWork(
  db: PoolClient,
  project: string,
  repository: number,
  snapshot: GitHubSnapshot,
) {
  for (const [kind, items] of [
    ['issue', snapshot.issues],
    ['pull', snapshot.pullRequests],
  ] as const)
    for (const item of items)
      if (item.id)
        await db.query(
          'UPDATE task_remote_links SET number=$4,observation=$5,observed_at=$6 WHERE project_id=$1 AND repository_id=$2 AND kind=$3 AND item_id=$7',
          [
            project,
            repository,
            kind,
            item.number,
            JSON.stringify(item),
            snapshot.observedAt,
            item.id,
          ],
        );
}

export class GitHubWork {
  private readonly projects: ProjectRepository;
  constructor(private readonly github: GitHubService) {
    this.projects = new ProjectRepository(github.pool);
  }
  private async source(owner: string, project: string) {
    const { link } = await this.github.read(owner, project);
    if (!link || link.revoked)
      throw new HttpError(
        403,
        'github_work_denied',
        'Vincula y autoriza el repositorio para consultar su coordinación.',
      );
    return link;
  }
  private action(
    row: QueryResultRow,
    current: { version: number; stale: boolean; archivedAt: string | null },
    taskVersion: number,
  ) {
    return gitHubIssueAction.parse({
      id: row.id,
      taskId: row.task_id,
      hash: row.hash,
      state: row.state,
      snapshot: row.snapshot,
      item: row.item,
      errorCode: row.error_code,
      conditionsCurrent:
        !current.archivedAt &&
        !current.stale &&
        current.version === row.snapshot.linkVersion &&
        taskVersion === row.snapshot.taskVersion &&
        digest(canonical(row.snapshot)) === row.hash,
    });
  }
  async read(owner: string, project: string) {
    const p = await this.projects.get(owner, project),
      link = await this.source(owner, project);
    const links = (
      await this.github.pool.query(
        'SELECT * FROM task_remote_links WHERE project_id=$1 AND repository_id=$2 ORDER BY task_id,kind,item_id LIMIT 1001',
        [project, link.repositoryId],
      )
    ).rows;
    if (links.length > 1000)
      throw new HttpError(422, 'github_work_limit', 'Límite de vínculos alcanzado.');
    const actions = (
      await this.github.pool.query(
        'SELECT a.*,t.version AS task_version FROM github_issue_actions a JOIN tasks t ON t.id=a.task_id WHERE a.project_id=$1 AND a.repository_id=$2 ORDER BY a.created_at DESC LIMIT 100',
        [project, link.repositoryId],
      )
    ).rows;
    const publications = (
      await this.github.pool.query(
        "SELECT r.job_id,c.task_id,r.pull_number,r.pull_url,r.report_hash FROM coding_reviews r JOIN coding_runs c ON c.job_id=r.job_id WHERE r.project_id=$1 AND r.repository_id=$2 AND r.state='published' ORDER BY r.updated_at DESC LIMIT 100",
        [project, link.repositoryId],
      )
    ).rows;
    return gitHubWorkResponse.parse({
      repositoryId: link.repositoryId,
      linkVersion: link.version,
      stale: link.stale,
      links: links.map((row) => {
        const list = row.kind === 'issue' ? link.snapshot?.issues : link.snapshot?.pullRequests;
        const found = list?.some((item) => item.id === Number(row.item_id));
        const partial =
          row.kind === 'issue'
            ? link.snapshot?.issuesTruncated
            : link.snapshot?.pullRequestsTruncated;
        return {
          id: row.id,
          taskId: row.task_id,
          kind: row.kind,
          itemId: Number(row.item_id),
          number: Number(row.number),
          origin: row.origin,
          observation: row.observation,
          observedAt: row.observed_at?.toISOString() ?? null,
          state:
            link.stale || !link.snapshot || row.observed_at > new Date(link.snapshot.observedAt)
              ? 'unconfirmed'
              : found
                ? 'present'
                : partial
                  ? 'unconfirmed'
                  : 'missing',
        };
      }),
      actions: actions.map((row) =>
        this.action(row, { ...link, archivedAt: p.archivedAt }, row.task_version),
      ),
      publications: publications.map((row) => ({
        jobId: row.job_id,
        taskId: row.task_id,
        number: Number(row.pull_number),
        url: row.pull_url,
        reportHash: row.report_hash,
      })),
    });
  }
  async link(owner: string, project: string, input: z.infer<typeof linkGitHubWorkInput>) {
    const task = await this.projects.getTask(owner, project, input.taskId),
      link = await this.source(owner, project);
    if (
      task.version !== input.taskVersion ||
      link.version !== input.linkVersion ||
      link.stale ||
      !link.snapshot
    )
      throw changed();
    const item = (input.kind === 'issue' ? link.snapshot.issues : link.snapshot.pullRequests).find(
      (i) => i.id === input.itemId,
    );
    if (!item) throw changed();
    await this.projects.locked(owner, project, async (db, p) => {
      if (p.archived_at) throw changed();
      const current = (
        await db.query('SELECT version FROM tasks WHERE project_id=$1 AND id=$2', [
          project,
          task.id,
        ])
      ).rows[0];
      const source = (
        await db.query('SELECT version,stale,revoked FROM github_links WHERE project_id=$1', [
          project,
        ])
      ).rows[0];
      if (
        current?.version !== task.version ||
        source?.version !== link.version ||
        source.stale ||
        source.revoked
      )
        throw changed();
      const old = (
        await db.query(
          'SELECT task_id FROM task_remote_links WHERE project_id=$1 AND repository_id=$2 AND kind=$3 AND item_id=$4',
          [project, link.repositoryId, input.kind, item.id],
        )
      ).rows[0];
      if (old) {
        if (old.task_id !== task.id) throw changed();
        return;
      }
      if (
        (
          await db.query('SELECT count(*)::int AS n FROM task_remote_links WHERE project_id=$1', [
            project,
          ])
        ).rows[0].n >= 1000
      )
        throw new HttpError(422, 'github_work_limit', 'Límite de vínculos alcanzado.');
      await db.query(
        "INSERT INTO task_remote_links(project_id,task_id,repository_id,kind,item_id,number,origin,observation,observed_at) VALUES($1,$2,$3,$4,$5,$6,'linked',$7,$8)",
        [
          project,
          task.id,
          link.repositoryId,
          input.kind,
          item.id,
          item.number,
          JSON.stringify(item),
          link.snapshot!.observedAt,
        ],
      );
    });
    return this.read(owner, project);
  }
  async prepare(owner: string, project: string, input: z.infer<typeof prepareGitHubIssueInput>) {
    const task = await this.projects.getTask(owner, project, input.taskId),
      link = await this.source(owner, project);
    if (
      task.version !== input.taskVersion ||
      link.version !== input.linkVersion ||
      link.stale ||
      !link.snapshot
    )
      throw changed();
    const requestHash = digest(canonical(input));
    const actionId = await this.projects.locked(owner, project, async (db, p) => {
      if (p.archived_at) throw changed();
      const old = (
        await db.query(
          'SELECT id,request_hash FROM github_issue_actions WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw changed();
        return old.id as string;
      }
      if (
        (
          await db.query(
            'SELECT count(*)::int AS n FROM github_issue_actions WHERE project_id=$1',
            [project],
          )
        ).rows[0].n >= 100
      )
        throw new HttpError(422, 'github_work_limit', 'Límite de vistas previas alcanzado.');
      const current = (
        await db.query('SELECT version FROM tasks WHERE project_id=$1 AND id=$2', [
          project,
          task.id,
        ])
      ).rows[0];
      const source = (
        await db.query('SELECT version,stale,revoked FROM github_links WHERE project_id=$1', [
          project,
        ])
      ).rows[0];
      if (
        current?.version !== task.version ||
        source?.version !== link.version ||
        source.stale ||
        source.revoked
      )
        throw changed();
      const identity = (
        await db.query('SELECT github_user_id FROM github_connections WHERE owner_id=$1', [owner])
      ).rows[0];
      const coord = (
        await db.query('SELECT parent_epic_id FROM task_coordination WHERE task_id=$1', [task.id])
      ).rows[0];
      const deps = (
        await db.query(
          'SELECT dependency_id FROM task_dependencies WHERE project_id=$1 AND task_id=$2 ORDER BY dependency_id',
          [project, task.id],
        )
      ).rows.map((r) => r.dependency_id as string);
      const runs = (
        await db.query(
          "SELECT id FROM team_executions WHERE project_id=$1 AND snapshot->'plan'->'task'->>'id'=$2 ORDER BY created_at DESC LIMIT 10",
          [project, task.id],
        )
      ).rows.map((r) => r.id as string);
      const id = randomUUID();
      const body =
        input.body +
        `\n\n---\nFerWeb task: ${task.id} v${task.version}\nEpic: ${coord?.parent_epic_id ?? 'none'}\nDependencies: ${deps.join(', ') || 'none'}\nTeam executions: ${runs.join(', ') || 'none'}\n<!-- ferweb-issue:${id} -->`;
      if (body.length > 20000)
        throw new HttpError(
          422,
          'github_work_limit',
          'Reduce el cuerpo de la issue antes de preparar la vista previa.',
        );
      const snapshot = {
        version: 1,
        taskVersion: task.version,
        repositoryId: link.repositoryId,
        repository: link.fullName,
        linkVersion: link.version,
        authorId: Number(identity.github_user_id),
        title: input.title,
        body,
      };
      await db.query(
        'INSERT INTO github_issue_actions(id,project_id,task_id,repository_id,request_id,request_hash,snapshot,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          project,
          task.id,
          link.repositoryId,
          input.requestId,
          requestHash,
          JSON.stringify(snapshot),
          digest(canonical(snapshot)),
        ],
      );
      return id;
    });
    return { action: await this.detail(owner, project, actionId) };
  }
  private async row(owner: string, project: string, id: string) {
    await this.projects.get(owner, project);
    const row = (
      await this.github.pool.query(
        'SELECT * FROM github_issue_actions WHERE project_id=$1 AND id=$2',
        [project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    const link = await this.source(owner, project);
    if (Number(row.repository_id) !== link.repositoryId)
      throw new HttpError(
        403,
        'github_work_denied',
        'La acción pertenece a otro vínculo de repositorio.',
      );
    return { row, link };
  }
  async detail(owner: string, project: string, id: string) {
    const { row, link } = await this.row(owner, project, id),
      p = await this.projects.get(owner, project),
      task = await this.projects.getTask(owner, project, row.task_id);
    return this.action(row, { ...link, archivedAt: p.archivedAt }, task.version);
  }
  private async record(
    owner: string,
    project: string,
    row: QueryResultRow,
    token: string,
    item: z.infer<typeof githubItemSchema>,
  ) {
    if (
      !item.id ||
      item.authorId !== row.snapshot.authorId ||
      item.title !== row.snapshot.title ||
      item.body !== row.snapshot.body
    )
      throw new HttpError(
        409,
        'github_work_response_changed',
        'La issue no coincide con el contenido revisado. Requiere reconciliación.',
      );
    await this.projects.locked(owner, project, async (db) => {
      const saved = await db.query(
        "UPDATE github_issue_actions SET state='published',item=$4,error_code=NULL,lease_until=NULL WHERE project_id=$1 AND id=$2 AND attempt_token=$3 RETURNING id",
        [project, row.id, token, JSON.stringify(item)],
      );
      if (!saved.rowCount) throw changed();
      const existing = (
        await db.query(
          "SELECT task_id FROM task_remote_links WHERE project_id=$1 AND repository_id=$2 AND kind='issue' AND item_id=$3",
          [project, row.repository_id, item.id],
        )
      ).rows[0];
      if (existing && existing.task_id !== row.task_id) throw changed();
      await db.query(
        "INSERT INTO task_remote_links(project_id,task_id,repository_id,kind,item_id,number,origin,observation,observed_at) VALUES($1,$2,$3,'issue',$4,$5,'created',$6,now()) ON CONFLICT(project_id,repository_id,kind,item_id) DO UPDATE SET observation=$6,observed_at=now()",
        [project, row.task_id, row.repository_id, item.id, item.number, JSON.stringify(item)],
      );
    });
  }
  async execute(owner: string, project: string, id: string, hash: string) {
    const { row, link } = await this.row(owner, project, id);
    if (hash !== row.hash || digest(canonical(row.snapshot)) !== hash) throw changed();
    if (row.state === 'published') return { action: await this.detail(owner, project, id) };
    if (row.state !== 'prepared')
      throw new HttpError(
        409,
        'github_work_reconcile',
        'Esta acción ya se intentó. Reconcilia su resultado; no se creará otra issue.',
      );
    if (link.stale || link.version !== row.snapshot.linkVersion) throw changed();
    const access = await this.github.issueAccess(
      owner,
      project,
      link.repositoryId,
      link.version,
      true,
    );
    if (access.authorId !== row.snapshot.authorId) throw changed();
    const token = randomUUID();
    await this.projects.locked(owner, project, async (db, p) => {
      if (p.archived_at) throw changed();
      const current = (
        await db.query('SELECT state,hash FROM github_issue_actions WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      const task = (
        await db.query('SELECT version FROM tasks WHERE project_id=$1 AND id=$2', [
          project,
          row.task_id,
        ])
      ).rows[0];
      const source = (
        await db.query('SELECT version,revoked,stale FROM github_links WHERE project_id=$1', [
          project,
        ])
      ).rows[0];
      if (
        current.state !== 'prepared' ||
        current.hash !== hash ||
        task?.version !== row.snapshot.taskVersion ||
        source?.version !== link.version ||
        source.revoked ||
        source.stale
      )
        throw changed();
      if (
        (
          await db.query(
            "SELECT 1 FROM github_issue_actions WHERE project_id=$1 AND task_id=$2 AND repository_id=$3 AND state<>'prepared' UNION ALL SELECT 1 FROM task_remote_links WHERE project_id=$1 AND task_id=$2 AND repository_id=$3 AND kind='issue'",
            [project, row.task_id, row.repository_id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          'github_work_exists',
          'Ya existe una issue vinculada o una creación pendiente de reconciliar.',
        );
      await db.query(
        "UPDATE github_issue_actions SET state='sending',approved_hash=hash,attempt_token=$2,attempted_at=now(),lease_until=clock_timestamp()+interval '180 seconds' WHERE id=$1",
        [id, token],
      );
    });
    try {
      await access.check();
      if (
        (await this.projects.getTask(owner, project, row.task_id)).version !==
        row.snapshot.taskVersion
      )
        throw changed();
      const item = await access.api.createIssue(
        access.token,
        access.fullName,
        row.snapshot.title,
        row.snapshot.body,
      );
      await this.record(owner, project, row, token, item);
    } catch (error) {
      await this.github.pool.query(
        "UPDATE github_issue_actions SET state='uncertain',error_code=$4,lease_until=NULL WHERE project_id=$1 AND id=$2 AND attempt_token=$3 AND state<>'published'",
        [project, id, token, error instanceof HttpError ? error.code : 'github_work_uncertain'],
      );
      throw new HttpError(
        409,
        'github_work_uncertain',
        'No se pudo confirmar el efecto remoto. Reconcilia esta misma acción antes de crear nada más.',
      );
    }
    return { action: await this.detail(owner, project, id) };
  }
  async reconcile(owner: string, project: string, id: string, hash: string) {
    const { row, link } = await this.row(owner, project, id);
    if (row.hash !== hash || digest(canonical(row.snapshot)) !== hash) throw changed();
    if (row.state === 'published') return { action: await this.detail(owner, project, id) };
    const token = randomUUID();
    await this.projects.locked(owner, project, async (db, p) => {
      if (p.archived_at) throw changed();
      const current = (
        await db.query(
          'SELECT *,lease_until>clock_timestamp() AS busy FROM github_issue_actions WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!['sending', 'uncertain'].includes(current.state) || current.busy)
        throw new HttpError(
          409,
          'github_work_busy',
          'La creación sigue en curso o aún no se ha intentado. Actualiza y espera.',
        );
      await db.query(
        "UPDATE github_issue_actions SET state='uncertain',attempt_token=$2,lease_until=clock_timestamp()+interval '180 seconds' WHERE id=$1",
        [id, token],
      );
    });
    try {
      const access = await this.github.issueAccess(
        owner,
        project,
        link.repositoryId,
        link.version,
        false,
      );
      const candidates = await access.api.issueCandidates(access.token, access.fullName);
      await access.check();
      const matches = candidates.items.filter(
        (item) =>
          item.id &&
          item.authorId === row.snapshot.authorId &&
          item.title === row.snapshot.title &&
          item.body === row.snapshot.body,
      );
      if (candidates.truncated || matches.length !== 1)
        throw new HttpError(
          409,
          'github_work_unconfirmed',
          candidates.truncated
            ? 'La lista es parcial; no se puede confirmar la creación.'
            : 'No hay una única issue que coincida. Conserva la acción y revisa GitHub; no se repetirá el POST.',
        );
      await this.record(owner, project, row, token, matches[0]!);
    } catch (error) {
      await this.github.pool.query(
        "UPDATE github_issue_actions SET lease_until=NULL,error_code=$4 WHERE project_id=$1 AND id=$2 AND attempt_token=$3 AND state='uncertain'",
        [project, id, token, error instanceof HttpError ? error.code : 'github_work_uncertain'],
      );
      throw error;
    }
    return { action: await this.detail(owner, project, id) };
  }
}
