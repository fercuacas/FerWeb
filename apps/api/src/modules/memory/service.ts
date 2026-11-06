import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  memoryDraft,
  memoryEntry,
  memorySelection,
  memorySelections,
  memorySource,
  memorySearchResponse,
  type memorySourceInput,
  type memorySearchInput,
  type GitHubLink,
} from '@ferweb/contracts';
import { GitHubService } from '../github/service.js';
import { ProjectRepository } from '../projects/repository.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { indexable } from '../retrieval/chunking.js';
import { codingPath } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { memoryNotice, rejectMemorySecrets, parseMemoryImport, exportMemory } from './codec.js';

type Draft = z.infer<typeof memoryDraft>;
type Source = z.infer<typeof memorySource>;
type Selection = z.infer<typeof memorySelection>;
type Mode = 'current' | 'history';
type Issue = 'source_stale' | 'source_unavailable' | 'provenance_limit' | 'revision_changed';
class SourceError extends HttpError {
  constructor(readonly issue: Issue) {
    super(
      issue === 'source_unavailable' ? 403 : 409,
      'memory_' + issue,
      'No se puede confirmar la vigencia o autorización de las fuentes de este recuerdo.',
    );
  }
}
type Context = {
  checks: number;
  seen: Set<string>;
  sources: Set<string>;
  link?: GitHubLink;
  linkFailure?: SourceError;
  references: Map<string, Selection>;
  tasks: Map<string, number>;
  jobs: Map<string, string>;
};
const context = (): Context => ({
  checks: 0,
  seen: new Set(),
  sources: new Set(),
  references: new Map(),
  tasks: new Map(),
  jobs: new Map(),
});
const conflict = () =>
  new HttpError(
    409,
    'memory_revision_changed',
    'La memoria cambió. Actualiza y revisa la versión vigente.',
  );
const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recuerdo.');
const selection = (row: QueryResultRow) =>
  memorySelection.parse({ id: row.entry_id, revision: row.revision, hash: row.hash });
const timeFields = `to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_iso,to_char(r.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS valid_iso`;
export class MemoryService {
  readonly projects: ProjectRepository;
  constructor(
    readonly pool: Pool,
    readonly github: GitHubService,
  ) {
    this.projects = new ProjectRepository(pool);
  }
  private async link(owner: string, project: string, ctx: Context) {
    if (ctx.link) return ctx.link;
    if (ctx.linkFailure) throw ctx.linkFailure;
    try {
      const { link } = await this.github.read(owner, project);
      if (!link || link.revoked) throw new SourceError('source_unavailable');
      if (link.stale || !link.snapshot) throw new SourceError('source_stale');
      ctx.link = link;
      return link;
    } catch (error) {
      if (error instanceof HttpError) {
        ctx.linkFailure =
          error instanceof SourceError ? error : new SourceError('source_unavailable');
        throw ctx.linkFailure;
      }
      throw error;
    }
  }
  private async row(project: string, id: string, revision?: number) {
    return (
      await this.pool.query(
        `SELECT r.*,e.project_id,e.current_revision,${timeFields} FROM project_memory_entries e JOIN project_memory_revisions r ON r.entry_id=e.id AND r.revision=COALESCE($3,e.current_revision) WHERE e.project_id=$1 AND e.id=$2`,
        [project, id, revision ?? null],
      )
    ).rows[0];
  }
  private dto(row: QueryResultRow, mode: Mode) {
    const draft = memoryDraft.parse(row.data),
      evidence = zSources(row.evidence);
    return memoryEntry.parse({
      ...draft,
      id: row.entry_id,
      projectId: row.project_id,
      revision: row.revision,
      previousRevision: row.previous_revision,
      hash: row.hash,
      recordedAt: row.recorded_iso,
      validUntil: row.valid_iso,
      current: row.current_revision === row.revision,
      validity: mode === 'history' ? 'historical' : 'current',
      trust: 'unreviewed',
      evidenceState: evidence.length ? 'referenced' : 'none',
      origin: row.origin,
      evidence,
    });
  }
  private async source(
    owner: string,
    project: string,
    source: Source,
    mode: Mode,
    ctx: Context,
    depth: number,
  ) {
    const key = mode + canonical(source);
    if (ctx.sources.has(key)) return;
    if (++ctx.checks > 256 || depth > 4) throw new SourceError('provenance_limit');
    await this.verifySource(owner, project, source, mode, ctx, depth);
    ctx.sources.add(key);
  }
  private async verifySource(
    owner: string,
    project: string,
    source: Source,
    mode: Mode,
    ctx: Context,
    depth: number,
  ) {
    const input = source.input;
    if (input.kind === 'code') {
      const link = await this.link(owner, project, ctx),
        file = link.snapshot!.tree.find((f) => f.path === input.path);
      if (
        link.repositoryId !== source.repositoryId ||
        !file ||
        file.type !== 'blob' ||
        !['100644', '100755'].includes(file.mode) ||
        !codingPath(input.path) ||
        !indexable(input.path)
      )
        throw new SourceError('source_unavailable');
      if (
        mode === 'current' &&
        (link.snapshot!.commit !== input.commit || file.sha !== source.blobSha)
      )
        throw new SourceError('source_stale');
      return;
    }
    if (input.kind === 'task') {
      const task = (
        await this.pool.query('SELECT version FROM tasks WHERE project_id=$1 AND id=$2', [
          project,
          input.id,
        ])
      ).rows[0];
      if (!task) throw new SourceError('source_unavailable');
      if (mode === 'current' && task.version !== input.version)
        throw new SourceError('source_stale');
      if (mode === 'current') ctx.tasks.set(input.id, input.version);
      return;
    }
    const row = (
      await this.pool.query(
        input.kind === 'job'
          ? 'SELECT c.*,j.state FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE j.project_id=$1 AND j.id=$2 AND c.owner_id=$3'
          : 'SELECT c.*,j.state,s.delivery,s.execution_id FROM team_execution_steps s JOIN team_executions r ON r.id=s.execution_id JOIN jobs j ON j.id=s.job_id JOIN coding_runs c ON c.job_id=j.id WHERE r.project_id=$1 AND s.id=$2 AND c.owner_id=$3 AND r.id=$4',
        input.kind === 'job'
          ? [project, input.id, owner]
          : [project, input.stepId, owner, input.executionId],
      )
    ).rows[0];
    if (
      !row ||
      !row.report ||
      !['completed', 'failed', 'cancelled'].includes(row.state) ||
      (input.kind === 'delivery' && !row.delivery?.verified)
    )
      throw new SourceError('source_unavailable');
    const link = await this.link(owner, project, ctx);
    if (link.repositoryId !== Number(row.repository_id))
      throw new SourceError('source_unavailable');
    const sourceHash = digest(canonical(input.kind === 'job' ? row.report : row.delivery));
    if (sourceHash !== source.hash) throw new SourceError('source_stale');
    const task = (
      await this.pool.query('SELECT version FROM tasks WHERE id=$1 AND project_id=$2', [
        row.task_id,
        project,
      ])
    ).rows[0];
    if (!task) throw new SourceError('source_unavailable');
    if (mode === 'current' && task.version !== row.task_snapshot.version)
      throw new SourceError('source_stale');
    if (mode === 'current') {
      ctx.tasks.set(row.task_id, task.version);
      ctx.jobs.set(row.job_id, digest(canonical(row.report)));
    }
    await this.selected(
      owner,
      project,
      memorySelections.parse(row.memory_snapshot),
      mode,
      ctx,
      depth + 1,
    );
  }
  private async visible(
    owner: string,
    project: string,
    row: QueryResultRow,
    mode: Mode,
    ctx: Context,
    depth = 0,
  ) {
    const key = `${row.entry_id}:${row.revision}`;
    if (depth > 4 || ctx.seen.has(key)) throw new SourceError('provenance_limit');
    ctx.seen.add(key);
    try {
      for (const source of zSources(row.evidence))
        await this.source(owner, project, source, mode, ctx, depth);
    } finally {
      ctx.seen.delete(key);
    }
  }
  private async selected(
    owner: string,
    project: string,
    refs: Selection[],
    mode: Mode,
    ctx: Context,
    depth = 0,
  ) {
    const result = [];
    for (const ref of refs) {
      const row = await this.row(project, ref.id, ref.revision);
      if (!row || row.hash !== ref.hash) throw new SourceError('source_unavailable');
      if (
        mode === 'current' &&
        (row.current_revision !== ref.revision || row.data.status !== 'active')
      )
        throw new SourceError('revision_changed');
      await this.visible(owner, project, row, mode, ctx, depth);
      if (mode === 'current') ctx.references.set(ref.id, ref);
      result.push(this.dto(row, mode));
    }
    return result;
  }
  private async localGuards(db: Pool | PoolClient, project: string, ctx: Context) {
    if (ctx.link) {
      const row = (
        await db.query(
          'SELECT repository_id,version,revoked,stale,snapshot FROM github_links WHERE project_id=$1',
          [project],
        )
      ).rows[0];
      if (!row || row.revoked || Number(row.repository_id) !== ctx.link.repositoryId)
        throw new SourceError('source_unavailable');
      if (
        row.stale ||
        row.version !== ctx.link.version ||
        row.snapshot?.commit !== ctx.link.snapshot?.commit
      )
        throw new SourceError('source_stale');
    }
    for (const [id, version] of ctx.tasks)
      if (
        !(
          await db.query('SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2 AND version=$3', [
            id,
            project,
            version,
          ])
        ).rowCount
      )
        throw new SourceError('source_stale');
    for (const ref of ctx.references.values())
      if (
        !(
          await db.query(
            "SELECT 1 FROM project_memory_entries e JOIN project_memory_revisions r ON r.entry_id=e.id AND r.revision=e.current_revision WHERE e.project_id=$1 AND e.id=$2 AND e.current_revision=$3 AND r.hash=$4 AND r.data->>'status'='active'",
            [project, ref.id, ref.revision, ref.hash],
          )
        ).rowCount
      )
        throw new SourceError('revision_changed');
    for (const [id, hash] of ctx.jobs) {
      const row = (await db.query('SELECT report FROM coding_runs WHERE job_id=$1', [id])).rows[0];
      if (!row || digest(canonical(row.report)) !== hash) throw new SourceError('source_stale');
    }
  }
  async selections(owner: string, project: string, refs: Selection[], mode: Mode = 'current') {
    await this.projects.get(owner, project);
    const ctx = context();
    const entries = await this.selected(owner, project, memorySelections.parse(refs), mode, ctx);
    await this.localGuards(this.pool, project, ctx);
    return entries;
  }
  async read(owner: string, project: string, id: string, revision?: number) {
    await this.projects.get(owner, project);
    const ctx = context(),
      row = await this.row(project, id, revision);
    if (!row) throw missing();
    const mode = revision === undefined ? 'current' : 'history';
    await this.visible(owner, project, row, mode, ctx);
    if (mode === 'current') ctx.references.set(id, selection(row));
    // Explicit ID inspection can show a retired head, but never reuse it as context.
    if (row.data.status === 'retired') ctx.references.delete(id);
    await this.localGuards(this.pool, project, ctx);
    if (mode === 'current' && (await this.row(project, id))?.revision !== row.revision)
      throw conflict();
    return { entry: this.dto(row, mode) };
  }
  async history(owner: string, project: string, id: string) {
    await this.projects.get(owner, project);
    if (!(await this.row(project, id))) throw missing();
    const rows = (
      await this.pool.query(
        `SELECT r.*,e.project_id,e.current_revision,${timeFields} FROM project_memory_entries e JOIN project_memory_revisions r ON r.entry_id=e.id WHERE e.id=$1 AND e.project_id=$2 ORDER BY r.revision DESC LIMIT 50`,
        [id, project],
      )
    ).rows;
    const ctx = context(),
      entries = [];
    let unavailable = false;
    for (const row of rows)
      try {
        await this.visible(owner, project, row, 'history', ctx);
        entries.push(this.dto(row, 'history'));
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        unavailable = true;
      }
    try {
      await this.localGuards(this.pool, project, ctx);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      return { entries: [], complete: false, unavailable: true };
    }
    return { entries, complete: !unavailable, unavailable };
  }
  async search(owner: string, project: string, input: z.infer<typeof memorySearchInput>) {
    await this.projects.get(owner, project);
    if (input.asOf && Date.parse(input.asOf) > Date.now())
      throw new HttpError(
        400,
        'memory_time_invalid',
        'La fecha histórica no puede estar en el futuro.',
      );
    // Authorize the bounded inventory before matching private text. Hidden words
    // must not distinguish a complete empty query from an inaccessible match.
    const inventory = (
      await this.pool.query(
        "SELECT r.entry_id,r.revision,r.hash,r.evidence,e.project_id,e.current_revision FROM project_memory_entries e JOIN project_memory_revisions r ON r.entry_id=e.id WHERE e.project_id=$1 AND r.data->>'status'='active' AND (($2::timestamptz IS NULL AND r.revision=e.current_revision) OR ($2::timestamptz IS NOT NULL AND r.recorded_at<=$2 AND (r.valid_until IS NULL OR r.valid_until>$2))) ORDER BY r.recorded_at DESC,e.id LIMIT 21 OFFSET $3",
        [project, input.asOf ?? null, input.cursor],
      )
    ).rows;
    const ctx = context(),
      accepted: Selection[] = [],
      issues = new Set<Issue | 'scan_limit'>();
    for (const row of inventory.slice(0, 20)) {
      try {
        await this.visible(owner, project, row, input.asOf ? 'history' : 'current', ctx);
        const ref = selection(row);
        accepted.push(ref);
        if (!input.asOf) ctx.references.set(row.entry_id, ref);
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        issues.add(error.issue);
      }
    }
    const rows = (
      await this.pool.query(
        `SELECT r.*,e.project_id,e.current_revision,${timeFields} FROM jsonb_to_recordset($2::jsonb) AS a(id uuid,revision integer,hash text) JOIN project_memory_revisions r ON r.entry_id=a.id AND r.revision=a.revision AND r.hash=a.hash JOIN project_memory_entries e ON e.id=r.entry_id WHERE e.project_id=$1 AND ($3='' OR r.search_text@@plainto_tsquery('simple',$3)) AND ($4::text IS NULL OR r.data->'targets' ? $4 OR r.data->'targets' ? 'all') ORDER BY CASE WHEN $3='' THEN 0 ELSE ts_rank_cd(r.search_text,plainto_tsquery('simple',$3)) END DESC,r.recorded_at DESC,e.id LIMIT 21`,
        [project, JSON.stringify(accepted), input.query, input.target ?? null],
      )
    ).rows;
    if (inventory.length > 20 || input.cursor > 0 || rows.length > 20) issues.add('scan_limit');
    const entries = rows
      .slice(0, 20)
      .map((row) => this.dto(row, input.asOf ? 'history' : 'current'));
    try {
      await this.localGuards(this.pool, project, ctx);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      return memorySearchResponse.parse({
        entries: [],
        complete: false,
        state: 'unavailable',
        issues: [error.issue],
        nextCursor: null,
        notice: memoryNotice,
      });
    }
    const complete = !issues.size;
    return memorySearchResponse.parse({
      entries,
      complete,
      state: complete
        ? entries.length
          ? 'results'
          : 'empty'
        : !entries.length && [...issues].some((i) => i !== 'scan_limit')
          ? 'unavailable'
          : 'incomplete',
      issues: [...issues],
      nextCursor: inventory.length > 20 ? input.cursor + 20 : null,
      notice: memoryNotice,
    });
  }
  private async prepare(owner: string, project: string, input: Draft) {
    const data = memoryDraft.parse(input);
    rejectMemorySecrets(data);
    if (Date.parse(data.observedAt) > Date.now() + 300000)
      throw new HttpError(
        422,
        'memory_observation_invalid',
        'La observación no puede estar en el futuro.',
      );
    const ctx = context(),
      evidence: Source[] = [];
    for (const reference of data.sources) {
      let source: Source;
      if (reference.kind === 'code') {
        if (
          reference.endLine < reference.startLine ||
          reference.endLine - reference.startLine >= 50 ||
          !codingPath(reference.path) ||
          !indexable(reference.path) ||
          (reference.canonical && !/\.md$/i.test(reference.path))
        )
          throw new SourceError('source_unavailable');
        const link = await this.link(owner, project, ctx);
        if (link.snapshot!.commit !== reference.commit) throw new SourceError('source_stale');
        const file = await this.github.file(owner, project, reference.path, link.version),
          lines = file.content.split('\n');
        if (reference.endLine > lines.length) throw new SourceError('source_stale');
        const hash = digest(lines.slice(reference.startLine - 1, reference.endLine).join('\n'));
        if (reference.expectedHash && reference.expectedHash !== hash)
          throw new SourceError('source_stale');
        source = {
          input: reference,
          hash,
          repositoryId: link.repositoryId,
          linkVersion: link.version,
          blobSha: file.sha,
          url: `https://github.com/${link.fullName}/blob/${reference.commit}/${reference.path.split('/').map(encodeURIComponent).join('/')}#L${reference.startLine}-L${reference.endLine}`,
        };
      } else if (reference.kind === 'task') {
        const task = await this.projects.getTask(owner, project, reference.id);
        if (task.version !== reference.version) throw new SourceError('source_stale');
        source = {
          input: reference,
          hash: digest(canonical(task)),
          repositoryId: null,
          linkVersion: null,
          blobSha: null,
          url: null,
        };
      } else {
        const row = (
          await this.pool.query(
            reference.kind === 'job'
              ? 'SELECT c.*,j.state FROM coding_runs c JOIN jobs j ON j.id=c.job_id WHERE j.project_id=$1 AND j.id=$2 AND c.owner_id=$3'
              : 'SELECT c.*,j.state,s.delivery FROM team_execution_steps s JOIN team_executions r ON r.id=s.execution_id JOIN jobs j ON j.id=s.job_id JOIN coding_runs c ON c.job_id=j.id WHERE r.project_id=$1 AND s.id=$2 AND c.owner_id=$3 AND r.id=$4',
            reference.kind === 'job'
              ? [project, reference.id, owner]
              : [project, reference.stepId, owner, reference.executionId],
          )
        ).rows[0];
        if (!row || !row.report || (reference.kind === 'delivery' && !row.delivery?.verified))
          throw new SourceError('source_unavailable');
        const hash = digest(canonical(reference.kind === 'job' ? row.report : row.delivery));
        if (reference.expectedHash && reference.expectedHash !== hash)
          throw new SourceError('source_stale');
        source = {
          input: reference,
          hash,
          repositoryId: Number(row.repository_id),
          linkVersion: null,
          blobSha: null,
          url: null,
        };
      }
      if (source.input.kind !== 'task')
        source = { ...source, input: { ...source.input, expectedHash: source.hash } };
      await this.source(owner, project, source, 'current', ctx, 0);
      evidence.push(source);
    }
    const normalized = { ...data, sources: evidence.map((s) => s.input) };
    return {
      data: normalized,
      evidence,
      ctx,
      hash: digest(canonical({ data: normalized, evidence })),
    };
  }
  private async insert(
    db: PoolClient,
    project: string,
    requestId: string,
    requestHash: string,
    prepared: Awaited<ReturnType<MemoryService['prepare']>>,
    origin: unknown,
  ) {
    const count = (
      await db.query('SELECT count(*)::int AS n FROM project_memory_entries WHERE project_id=$1', [
        project,
      ])
    ).rows[0].n;
    if (count >= 500)
      throw new HttpError(422, 'memory_limit', 'El proyecto admite hasta 500 recuerdos.');
    const id = (
      await db.query(
        'INSERT INTO project_memory_entries(project_id,request_id,request_hash) VALUES($1,$2,$3) RETURNING id',
        [project, requestId, requestHash],
      )
    ).rows[0].id;
    await this.revision(db, id, 1, prepared, origin);
    return { id, revision: 1, hash: prepared.hash };
  }
  private async revision(
    db: PoolClient,
    id: string,
    revision: number,
    prepared: Awaited<ReturnType<MemoryService['prepare']>>,
    origin: unknown,
    at?: string,
  ) {
    const text = [
      prepared.data.title,
      prepared.data.content,
      JSON.stringify(prepared.data.lesson),
      ...prepared.data.tags,
      ...prepared.data.targets,
    ].join(' ');
    await db.query(
      "INSERT INTO project_memory_revisions(entry_id,revision,previous_revision,data,evidence,origin,hash,recorded_at,search_text) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,clock_timestamp()),to_tsvector('simple',$9))",
      [
        id,
        revision,
        revision === 1 ? null : revision - 1,
        JSON.stringify(prepared.data),
        JSON.stringify(prepared.evidence),
        JSON.stringify(origin),
        prepared.hash,
        at ?? null,
        text,
      ],
    );
  }
  async create(owner: string, project: string, requestId: string, input: Draft) {
    const projectData = await this.projects.get(owner, project);
    if (projectData.archivedAt)
      throw new HttpError(
        409,
        'project_archived',
        'Restaura el proyecto antes de cambiar memoria.',
      );
    const requestHash = digest(canonical(input));
    const prior = (
      await this.pool.query(
        'SELECT id,request_hash FROM project_memory_entries WHERE project_id=$1 AND request_id=$2',
        [project, requestId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw conflict();
      const { entry } = await this.read(owner, project, prior.id, 1);
      return { selection: { id: entry.id, revision: entry.revision, hash: entry.hash } };
    }
    const prepared = await this.prepare(owner, project, input);
    return this.projects.locked(owner, project, async (db, row) => {
      await db.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de cambiar memoria.',
        );
      const old = (
        await db.query(
          'SELECT id,request_hash FROM project_memory_entries WHERE project_id=$1 AND request_id=$2',
          [project, requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw conflict();
        const current = (
          await db.query(
            'SELECT * FROM project_memory_revisions WHERE entry_id=$1 AND revision=1',
            [old.id],
          )
        ).rows[0];
        return { selection: selection(current) };
      }
      await this.localGuards(db, project, prepared.ctx);
      return {
        selection: await this.insert(db, project, requestId, requestHash, prepared, {
          kind: 'operator',
          userId: owner,
          label: 'operator',
          externalId: null,
          reported: null,
        }),
      };
    });
  }
  async correct(owner: string, project: string, id: string, version: number, input: Draft) {
    await this.projects.get(owner, project);
    if (!(await this.row(project, id))) throw missing();
    const prepared = await this.prepare(owner, project, input);
    return this.projects.locked(owner, project, async (db, projectRow) => {
      await db.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
      if (projectRow.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de corregir memoria.',
        );
      const row = (
        await db.query(
          'SELECT * FROM project_memory_entries WHERE id=$1 AND project_id=$2 FOR UPDATE',
          [id, project],
        )
      ).rows[0];
      if (!row) throw missing();
      if (row.current_revision !== version || version >= 50) throw conflict();
      await this.localGuards(db, project, prepared.ctx);
      const at = (await db.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
      await db.query(
        'UPDATE project_memory_revisions SET valid_until=$3 WHERE entry_id=$1 AND revision=$2',
        [id, version, at],
      );
      await this.revision(
        db,
        id,
        version + 1,
        prepared,
        { kind: 'operator', userId: owner, label: 'operator', externalId: null, reported: null },
        at,
      );
      await db.query('UPDATE project_memory_entries SET current_revision=$2 WHERE id=$1', [
        id,
        version + 1,
      ]);
      return { selection: { id, revision: version + 1, hash: prepared.hash } };
    });
  }
  async import(
    owner: string,
    project: string,
    requestId: string,
    format: 'json' | 'markdown',
    content: string,
  ) {
    await this.projects.get(owner, project);
    const records = parseMemoryImport(format, content),
      hash = digest(canonical({ format, content }));
    const prepared: {
      record: ReturnType<typeof parseMemoryImport>[number];
      value: Awaited<ReturnType<MemoryService['prepare']>>;
    }[] = [];
    for (const record of records)
      prepared.push({ record, value: await this.prepare(owner, project, record.entry) });
    return this.projects.locked(owner, project, async (db, row) => {
      await db.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
      if (row.archived_at)
        throw new HttpError(
          409,
          'project_archived',
          'Restaura el proyecto antes de importar memoria.',
        );
      const prior = (
        await db.query(
          'SELECT * FROM project_memory_imports WHERE project_id=$1 AND request_id=$2',
          [project, requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.hash !== hash) throw conflict();
        return { selections: prior.selections };
      }
      const selections = [];
      for (const { record, value } of prepared) {
        await this.localGuards(db, project, value.ctx);
        selections.push(
          await this.insert(db, project, randomUUID(), digest(canonical(record.entry)), value, {
            kind: 'import',
            userId: owner,
            label: record.sourceHarness,
            externalId: record.externalId,
            reported: record.reported,
          }),
        );
      }
      await db.query(
        'INSERT INTO project_memory_imports(project_id,request_id,hash,selections) VALUES($1,$2,$3,$4)',
        [project, requestId, hash, JSON.stringify(selections)],
      );
      return { selections };
    });
  }
  async export(owner: string, project: string, refs: Selection[], format: 'json' | 'markdown') {
    await this.projects.get(owner, project);
    const ctx = context(),
      entries = [];
    for (const ref of refs) {
      const row = await this.row(project, ref.id, ref.revision);
      if (!row || row.hash !== ref.hash || row.current_revision !== ref.revision) throw conflict();
      await this.visible(owner, project, row, 'current', ctx);
      if (row.data.status === 'active') ctx.references.set(ref.id, ref);
      entries.push(this.dto(row, 'current'));
    }
    await this.localGuards(this.pool, project, ctx);
    for (const entry of entries) {
      const head = await this.row(project, entry.id);
      if (!head || head.revision !== entry.revision || head.hash !== entry.hash) throw conflict();
    }
    return exportMemory(entries, format);
  }
}
function zSources(value: unknown) {
  return (value as unknown[]).map((item) => memorySource.parse(item));
}
