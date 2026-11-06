import type { Pool, PoolClient } from 'pg';
import { type Source, sourceSchema, contextCorpus, hybridResponse } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { AiClient } from '../chat/client.js';
import { GitHubService } from '../github/service.js';
import { VectorStore } from './vector-store.js';
import { fragment, hash, indexable, stableId } from './chunking.js';
import { rankSources, fuseRanks } from './ranking.js';

const changed = () =>
  new HttpError(
    409,
    'context_stale',
    'Sincroniza GitHub y actualiza el índice de contexto antes de consultar.',
  );
type Document = {
  id: string;
  path: string;
  kind: string;
  fingerprint: string;
  commit: string;
  observedAt: string | null;
  chunks: { id: string; ordinal: number; content: string; startLine: number; endLine: number }[];
};
export class RetrievalService {
  constructor(
    readonly pool: Pool,
    readonly github: GitHubService,
    readonly ai: AiClient,
    readonly vectors = new VectorStore(),
  ) {}
  private async current(owner: string, project: string) {
    const { link } = await this.github.read(owner, project);
    if (!link || link.revoked || link.stale || !link.snapshot) throw changed();
    return { ...link, snapshot: link.snapshot };
  }
  private store(space: string) {
    return new VectorStore(this.vectors.base, `${this.vectors.collection}_${space.slice(0, 24)}`);
  }
  private async description() {
    const value = await this.ai.embeddings();
    return {
      ...value,
      space: hash(
        JSON.stringify([
          value.provider,
          value.model,
          value.revision,
          value.dimensions,
          'chunks-v1',
        ]),
      ),
    };
  }
  async status(owner: string, project: string) {
    const { link } = await this.github.read(owner, project);
    const row = (
      await this.pool.query('SELECT * FROM repository_indexes WHERE project_id=$1', [project])
    ).rows[0];
    const counts = (
      await this.pool.query(
        'SELECT count(DISTINCT d.id)::int AS documents,count(c.id)::int AS chunks FROM repository_documents d LEFT JOIN repository_chunks c ON c.document_id=d.id WHERE d.project_id=$1',
        [project],
      )
    ).rows[0];
    return {
      strategy: !row
        ? ('none' as const)
        : row.embedding_space === 'lexical-v1'
          ? ('lexical' as const)
          : ('vector' as const),
      partial: row?.partial ?? false,
      available: !!row,
      stale: !row || !link || link.stale || link.revoked || link.version !== row.link_version,
      commit: row?.commit_sha ?? null,
      indexedAt: row?.indexed_at.toISOString() ?? null,
      documents: counts.documents,
      chunks: counts.chunks,
      skipped: row?.skipped ?? [],
    };
  }
  async index(owner: string, project: string, lexicalOnly = false) {
    const projectRow = await this.github.project(owner, project);
    if (projectRow.archived_at)
      throw new HttpError(409, 'project_archived', 'Restaura el proyecto antes de indexar.');
    const lock = await this.pool.connect();
    let locked = false;
    try {
      locked = (
        await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,5)) AS locked', [project])
      ).rows[0].locked;
      if (!locked) throw new HttpError(409, 'index_active', 'Ya se está actualizando este índice.');
      const link = await this.current(owner, project),
        snapshot = link.snapshot;
      const description = lexicalOnly
          ? { space: 'lexical-v1', dimensions: 0 }
          : await this.description(),
        store = this.store(description.space);
      if (!lexicalOnly) await store.ensure(description.dimensions);
      const oldIndex = (
        await this.pool.query('SELECT * FROM repository_indexes WHERE project_id=$1', [project])
      ).rows[0];
      const oldDocuments = (
        await this.pool.query('SELECT * FROM repository_documents WHERE project_id=$1', [project])
      ).rows;
      const oldChunks = (
        await this.pool.query(
          'SELECT c.* FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE d.project_id=$1',
          [project],
        )
      ).rows;
      const present = new Set<string>();
      if (lexicalOnly) for (const chunk of oldChunks) present.add(chunk.id);
      for (let offset = 0; !lexicalOnly && offset < oldChunks.length; offset += 128) {
        const response = await store.request('/points', 'POST', {
          ids: oldChunks.slice(offset, offset + 128).map((c) => c.id),
          with_payload: false,
          with_vector: false,
        });
        for (const point of response.result) present.add(point.id);
      }
      const documents: Document[] = [],
        skipped: string[] = [],
        deadline = Date.now() + 600000;
      let bytes = 0,
        embedded = 0,
        reused = 0;
      const append = async (
        path: string,
        kind: string,
        fingerprint: string,
        observedAt: string | null,
        load: () => Promise<string>,
      ) => {
        if (Date.now() > deadline)
          throw new HttpError(
            503,
            'index_timeout',
            'La indexación ha agotado su plazo; el índice anterior se conserva.',
          );
        const old = oldDocuments.find((d) => d.path === path);
        const chunks = oldChunks.filter((c) => c.document_id === old?.id);
        if (
          old &&
          old.fingerprint === fingerprint &&
          oldIndex?.embedding_space === description.space &&
          chunks.every((c) => present.has(c.id))
        ) {
          documents.push({
            id: old.id,
            path,
            kind,
            fingerprint,
            commit: snapshot.commit,
            observedAt,
            chunks: chunks.map((c) => ({
              id: c.id,
              ordinal: c.ordinal,
              content: c.content,
              startLine: c.start_line,
              endLine: c.end_line,
            })),
          });
          reused++;
          return;
        }
        let content: string;
        try {
          content = await load();
        } catch (error) {
          if (error instanceof HttpError && error.status === 415) {
            skipped.push(path);
            return;
          }
          throw error;
        }
        bytes += Buffer.byteLength(content);
        if (bytes > 2_000_000 || content.length > 200_000)
          throw new HttpError(
            422,
            'index_limit',
            'El contenido supera el límite de 2 MB por actualización o 200 000 caracteres por documento.',
          );
        const id = stableId(
          JSON.stringify([project, link.repositoryId, path, fingerprint, description.space]),
        );
        const parts = fragment(content);
        if (parts.length > 100)
          throw new HttpError(422, 'index_limit', 'Un documento supera los 100 fragmentos.');
        const document: Document = {
          id,
          path,
          kind,
          fingerprint,
          commit: snapshot.commit,
          observedAt,
          chunks: parts.map((part, ordinal) => ({
            ...part,
            ordinal,
            id: stableId(id + ':' + ordinal + ':' + hash(part.content)),
          })),
        };
        for (let offset = 0; !lexicalOnly && offset < document.chunks.length; offset += 16) {
          const batch = document.chunks.slice(offset, offset + 16),
            embeddings = await this.ai.embeddings(batch.map((part) => part.content));
          if (
            hash(
              JSON.stringify([
                embeddings.provider,
                embeddings.model,
                embeddings.revision,
                embeddings.dimensions,
                'chunks-v1',
              ]),
            ) !== description.space
          )
            throw changed();
          await store.upsert(
            batch.map((part, i) => ({
              id: part.id,
              vector: embeddings.vectors[i]!,
              payload: {
                project,
                repository: String(link.repositoryId),
                path,
                commit: snapshot.commit,
                document: id,
              },
            })),
          );
          embedded += batch.length;
        }
        documents.push(document);
      };
      const files = snapshot.tree.filter(
        (e) =>
          e.type === 'blob' &&
          ['100644', '100755'].includes(e.mode) &&
          indexable(e.path) &&
          (e.size ?? 0) <= 200_000,
      );
      if (files.length + snapshot.issues.length + snapshot.pullRequests.length > 200)
        throw new HttpError(
          422,
          'index_limit',
          'El snapshot supera los 200 documentos. No se publica un índice incompleto silenciosamente.',
        );
      for (const entry of snapshot.tree)
        if (entry.type === 'blob' && !files.includes(entry)) skipped.push(entry.path);
      for (const file of files)
        await append(
          file.path,
          'file',
          file.sha,
          null,
          async () => (await this.github.file(owner, project, file.path, link.version)).content,
        );
      for (const [kind, items] of [
        ['issue', snapshot.issues],
        ['pull_request', snapshot.pullRequests],
      ] as const)
        for (const item of items) {
          const content = `${item.title}\nEstado: ${item.state}\n${item.body}`;
          await append(
            `${kind === 'issue' ? 'issues' : 'pulls'}/${item.number}`,
            kind,
            hash(content + '\n' + item.updatedAt),
            snapshot.observedAt,
            async () => content,
          );
        }
      if (documents.reduce((n, d) => n + d.chunks.length, 0) > 3000)
        throw new HttpError(422, 'index_limit', 'El índice supera los 3000 fragmentos.');
      const again = await this.current(owner, project);
      if (again.version !== link.version) throw changed();
      await lock.query('BEGIN');
      try {
        const live = (
          await lock.query(
            `SELECT l.version,l.stale,l.revoked FROM github_links l JOIN projects p ON p.id=l.project_id WHERE l.project_id=$1 AND p.owner_id=$2 AND p.archived_at IS NULL AND l.snapshot=$3::jsonb FOR UPDATE OF l,p`,
            [project, owner, JSON.stringify(snapshot)],
          )
        ).rows[0];
        if (!live || live.version !== link.version || live.stale || live.revoked) throw changed();
        await lock.query(
          `INSERT INTO repository_indexes(project_id,repository_id,link_version,commit_sha,embedding_space,skipped,partial) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id) DO UPDATE SET repository_id=$2,link_version=$3,commit_sha=$4,embedding_space=$5,skipped=$6,partial=$7,indexed_at=now()`,
          [
            project,
            link.repositoryId,
            link.version,
            snapshot.commit,
            description.space,
            JSON.stringify(skipped),
            snapshot.treeTruncated || snapshot.issuesTruncated || snapshot.pullRequestsTruncated,
          ],
        );
        const retained = documents.map((d) => d.id);
        await lock.query(
          'DELETE FROM repository_documents WHERE project_id=$1 AND NOT(id=ANY($2::uuid[]))',
          [project, retained],
        );
        for (const doc of documents) {
          // Unchanged content retains its row/chunks and embeddings; only provenance advances.
          await lock.query(
            `INSERT INTO repository_documents(id,project_id,path,kind,fingerprint,commit_sha,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET commit_sha=$6,observed_at=$7`,
            [doc.id, project, doc.path, doc.kind, doc.fingerprint, doc.commit, doc.observedAt],
          );
          for (const c of doc.chunks)
            await lock.query(
              'INSERT INTO repository_chunks(id,document_id,ordinal,start_line,end_line,content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
              [c.id, doc.id, c.ordinal, c.startLine, c.endLine, c.content],
            );
        }
        await lock.query('COMMIT');
      } catch (error) {
        await lock.query('ROLLBACK');
        throw error;
      }
      // SQL is authoritative even if this bounded derived-cache cleanup fails.
      let cleanupPending = false;
      try {
        if (!lexicalOnly)
          await store.prune(
            project,
            documents.flatMap((d) => d.chunks.map((c) => c.id)),
          );
        if (
          oldIndex &&
          oldIndex.embedding_space !== 'lexical-v1' &&
          oldIndex.embedding_space !== description.space
        )
          await this.store(oldIndex.embedding_space).prune(project, []);
      } catch {
        cleanupPending = true;
      }
      return {
        ...(await this.status(owner, project)),
        embeddedChunks: embedded,
        reusedDocuments: reused,
        cleanupPending,
        partial:
          snapshot.treeTruncated || snapshot.issuesTruncated || snapshot.pullRequestsTruncated,
      };
    } finally {
      try {
        if (locked)
          await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,5))', [project]);
      } finally {
        lock.release();
      }
    }
  }
  async catalog(owner: string, project: string, includeText = false) {
    const stamp = await this.github.contextStamp(owner, project),
      link = stamp.link;
    if (link.stale || link.revoked || !link.snapshot) throw changed();
    const index = (
      await this.pool.query('SELECT * FROM repository_indexes WHERE project_id=$1', [project])
    ).rows[0];
    if (
      !index ||
      index.link_version !== link.version ||
      Number(index.repository_id) !== link.repositoryId
    )
      throw changed();
    const rows = (
      await this.pool.query(
        'SELECT c.*,d.path,d.kind,d.fingerprint,d.commit_sha,d.observed_at FROM repository_documents d LEFT JOIN repository_chunks c ON c.document_id=d.id WHERE d.project_id=$1 ORDER BY d.path,c.ordinal',
        [project],
      )
    ).rows.filter((r) => r.kind !== 'file' || indexable(r.path));
    const documents = new Map<
      string,
      {
        path: string;
        kind: string;
        fingerprint: string;
        commit: string;
        chunks: {
          id: string;
          startLine: number;
          endLine: number;
          hash: string;
          content?: string;
        }[];
      }
    >();
    for (const r of rows) {
      let doc = documents.get(r.path);
      if (!doc) {
        doc = {
          path: r.path,
          kind: r.kind,
          fingerprint: r.fingerprint,
          commit: r.commit_sha,
          chunks: [],
        };
        documents.set(r.path, doc);
      }
      if (r.id)
        doc.chunks.push({
          id: r.id,
          startLine: r.start_line,
          endLine: r.end_line,
          hash: hash(r.content),
          ...(includeText && { content: r.content }),
        });
    }
    const after = await this.github.contextStamp(owner, project);
    if (
      after.permissionHash !== stamp.permissionHash ||
      after.generation !== stamp.generation ||
      after.link.version !== link.version
    )
      throw changed();
    let embeddingIdentity: string | null = null,
      embeddingSimulated = false;
    if (index.embedding_space !== 'lexical-v1')
      try {
        const description = await this.description();
        embeddingIdentity = hash(
          JSON.stringify([description.space, description.configurationRevision]),
        );
        embeddingSimulated = description.simulated;
      } catch (error) {
        if (!(error instanceof HttpError && error.code === 'embedding_unavailable')) throw error;
      }
    const manifest = [...documents.values()];
    return {
      protocol: 'ferweb-catalog-v1' as const,
      projectId: project,
      repositoryId: link.repositoryId,
      repository: link.fullName,
      commit: link.snapshot.commit,
      linkVersion: link.version,
      embeddingSpace: index.embedding_space as string,
      embeddingIdentity,
      embeddingSimulated,
      partial: index.partial as boolean,
      documents: manifest,
      fingerprint: hash(
        JSON.stringify([
          stamp.permissionHash,
          stamp.generation,
          link.version,
          index.embedding_space,
          embeddingIdentity,
          manifest.map((d) => ({ ...d, chunks: d.chunks.map(({ content: _text, ...c }) => c) })),
        ]),
      ),
    };
  }
  async authorizePackSources(owner: string, project: string, sources: Source[], current = false) {
    const { link } = await this.github.read(owner, project);
    if (!link || link.revoked || !link.snapshot)
      throw new HttpError(
        403,
        'context_source_unavailable',
        'No se puede confirmar acceso a las fuentes del contexto.',
      );
    for (const source of sources) {
      const exists =
        source.kind === 'file'
          ? link.snapshot.tree.some(
              (f) =>
                f.path === source.path &&
                f.type === 'blob' &&
                ['100644', '100755'].includes(f.mode) &&
                indexable(f.path),
            )
          : (source.kind === 'issue' ? link.snapshot.issues : link.snapshot.pullRequests).some(
              (x) => `${source.kind === 'issue' ? 'issues' : 'pulls'}/${x.number}` === source.path,
            );
      if (source.projectId !== project || source.repositoryId !== link.repositoryId || !exists)
        throw new HttpError(
          403,
          'context_source_unavailable',
          'Una fuente fue retirada o no está autorizada.',
        );
      if (current) {
        if (
          link.stale ||
          link.version !== source.linkVersion ||
          link.snapshot.commit !== source.commit
        )
          throw changed();
        const row = (
          await this.pool.query(
            'SELECT c.content,c.start_line,c.end_line,d.path FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE c.id=$1 AND d.project_id=$2',
            [source.id, project],
          )
        ).rows[0];
        if (
          !row ||
          row.content !== source.excerpt ||
          row.path !== source.path ||
          row.start_line !== source.startLine ||
          row.end_line !== source.endLine
        )
          throw changed();
      }
    }
  }
  async hybrid(
    owner: string,
    project: string,
    query: string,
    options: {
      limit?: number;
      path?: string;
      vectorOnly?: boolean;
      observer?: (phase: 'start' | 'completed' | 'error') => Promise<void>;
    } = {},
  ) {
    const start = performance.now(),
      catalog = await this.catalog(owner, project),
      limit = options.limit ?? 5;
    const rows = (
      await this.pool.query(
        'SELECT c.*,d.path,d.kind,d.commit_sha,d.observed_at FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE d.project_id=$1 ORDER BY d.path,c.ordinal',
        [project],
      )
    ).rows.filter(
      (r) => (r.kind !== 'file' || indexable(r.path)) && (!options.path || r.path === options.path),
    );
    const lexical = options.vectorOnly ? [] : rankSources(query, rows).slice(0, 60);
    let vector: { id: string; score: number }[] = [],
      fallback: string | null = null,
      embeddingUsed = false,
      simulated = catalog.embeddingSimulated;
    if (catalog.embeddingSpace === 'lexical-v1') fallback = 'lexical_index';
    else
      try {
        await options.observer?.('start');
        const embedding = await this.ai.embeddings([query]);
        embeddingUsed = true;
        simulated ||= embedding.simulated;
        const space = hash(
          JSON.stringify([
            embedding.provider,
            embedding.model,
            embedding.revision,
            embedding.dimensions,
            'chunks-v1',
          ]),
        );
        if (space !== catalog.embeddingSpace) throw changed();
        await options.observer?.('completed');
        vector = await this.store(space).search(
          project,
          String(catalog.repositoryId),
          embedding.vectors[0]!,
          rows.map((r) => r.id),
        );
      } catch (error) {
        if (
          !(error instanceof HttpError) ||
          !['embedding_unavailable', 'vector_unavailable'].includes(error.code)
        )
          throw error;
        fallback = error.code;
        await options.observer?.('error');
      }
    if (options.vectorOnly && fallback)
      throw new HttpError(
        503,
        fallback,
        'La referencia vectorial requiere embeddings e índice disponibles.',
      );
    const ranked = fuseRanks(
      lexical.map((x) => ({ id: x.row.id, exact: x.reason.some((r) => r.startsWith('exact')) })),
      vector,
    );
    const seen = new Set<string>();
    const hits = ranked
      .flatMap((hit) => {
        const row = rows.find((r) => r.id === hit.id);
        if (!row) return [];
        const key = JSON.stringify([row.path, row.start_line, row.end_line, hash(row.content)]);
        if (seen.has(key)) return [];
        seen.add(key);
        const item = lexical.find((x) => x.row.id === hit.id);
        return [
          {
            source: sourceSchema.parse({
              id: row.id,
              projectId: project,
              repositoryId: catalog.repositoryId,
              repository: catalog.repository,
              path: row.path,
              commit: row.commit_sha,
              linkVersion: catalog.linkVersion,
              kind: row.kind,
              startLine: row.start_line,
              endLine: row.end_line,
              observedAt: row.observed_at,
              score: vector.find((x) => x.id === hit.id)?.score ?? null,
              excerpt: row.content,
            }),
            reason: [...(item?.reason ?? []), ...(hit.vectorRank ? ['vector' as const] : [])],
            lexicalRank: hit.lexicalRank,
            vectorRank: hit.vectorRank,
            fusionScore: hit.score,
          },
        ];
      })
      .slice(0, limit);
    if ((await this.catalog(owner, project)).fingerprint !== catalog.fingerprint) throw changed();
    return hybridResponse.parse({
      sources: hits.map((x) => x.source),
      hits,
      insufficient: !hits.length,
      strategy: options.vectorOnly ? 'vector-v1' : fallback ? 'lexical-v1' : 'hybrid-rrf-v1',
      fallback,
      embeddingUsed,
      simulated,
      elapsedMs: performance.now() - start,
      fingerprint: catalog.fingerprint,
      partial: catalog.partial,
    });
  }
  async optimizationSnapshot(owner: string, project: string) {
    const stamp = await this.github.contextStamp(owner, project),
      link = stamp.link;
    if (link.stale || !link.snapshot || link.snapshot.treeTruncated) throw changed();
    const index = (
      await this.pool.query('SELECT * FROM repository_indexes WHERE project_id=$1', [project])
    ).rows[0];
    const description = await this.description();
    if (
      !index ||
      index.partial ||
      index.link_version !== link.version ||
      index.embedding_space !== description.space
    )
      throw changed();
    const rows = (
      await this.pool.query(
        'SELECT c.*,d.path,d.kind,d.commit_sha,d.observed_at FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE d.project_id=$1 ORDER BY d.path,c.ordinal',
        [project],
      )
    ).rows;
    const sources = rows
      .filter((r) => r.kind !== 'file' || indexable(r.path))
      .map((r) =>
        sourceSchema.parse({
          id: r.id,
          projectId: project,
          repositoryId: link.repositoryId,
          repository: link.fullName,
          path: r.path,
          commit: r.commit_sha,
          linkVersion: link.version,
          kind: r.kind,
          startLine: r.start_line,
          endLine: r.end_line,
          observedAt: r.observed_at,
          score: null,
          excerpt: r.content,
        }),
      );
    if (!sources.length || sources.length > 60 || JSON.stringify(sources).length > 65000)
      throw new HttpError(
        422,
        'context_reference_limit',
        'La referencia amplia admite hasta 60 fragmentos y 65 000 caracteres serializados; usa un corpus de evaluación acotado. No se trunca en silencio.',
      );
    const after = await this.github.contextStamp(owner, project);
    if (
      after.link.version !== link.version ||
      after.generation !== stamp.generation ||
      after.permissionHash !== stamp.permissionHash
    )
      throw changed();
    return contextCorpus.parse({
      sources,
      commit: link.snapshot.commit,
      linkVersion: link.version,
      repositoryId: link.repositoryId,
      embeddingSpace: description.space,
      simulated: description.simulated,
      fingerprint: hash(
        JSON.stringify([
          stamp.permissionHash,
          stamp.generation,
          link.version,
          index.embedding_space,
          description.configurationRevision,
          sources,
        ]),
      ),
    });
  }
  async search(
    owner: string,
    project: string,
    query: string,
    embeddingObserver?: (phase: 'start' | 'completed' | 'error') => Promise<void>,
  ) {
    const link = await this.current(owner, project);
    const index = (
      await this.pool.query('SELECT * FROM repository_indexes WHERE project_id=$1', [project])
    ).rows[0];
    if (
      !index ||
      index.link_version !== link.version ||
      Number(index.repository_id) !== link.repositoryId
    )
      throw changed();
    await embeddingObserver?.('start');
    let embedding;
    try {
      embedding = await this.ai.embeddings([query]);
      await embeddingObserver?.('completed');
    } catch (error) {
      await embeddingObserver?.('error');
      throw error;
    }
    const space = hash(
      JSON.stringify([
        embedding.provider,
        embedding.model,
        embedding.revision,
        embedding.dimensions,
        'chunks-v1',
      ]),
    );
    if (space !== index.embedding_space) throw changed();
    const rows = (
      await this.pool.query(
        'SELECT c.*,d.path,d.kind,d.commit_sha,d.observed_at FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE d.project_id=$1',
        [project],
      )
    ).rows;
    const allowed = rows.filter((row) => row.kind !== 'file' || indexable(row.path));
    const hits = await this.store(space).search(
      project,
      String(link.repositoryId),
      embedding.vectors[0]!,
      allowed.map((row) => row.id),
    );
    const sources: Source[] = hits.slice(0, 5).flatMap((hit) => {
      const row = allowed.find((row) => row.id === hit.id);
      if (!row) return [];
      return [
        sourceSchema.parse({
          id: row.id,
          projectId: project,
          repositoryId: link.repositoryId,
          repository: link.fullName,
          path: row.path,
          commit: row.commit_sha,
          linkVersion: link.version,
          kind: row.kind,
          startLine: row.start_line,
          endLine: row.end_line,
          observedAt: row.observed_at,
          score: hit.score,
          excerpt: row.content,
        }),
      ];
    });
    const after = await this.current(owner, project);
    const currentIndex = (
      await this.pool.query(
        'SELECT link_version,embedding_space FROM repository_indexes WHERE project_id=$1',
        [project],
      )
    ).rows[0];
    if (
      after.version !== link.version ||
      currentIndex?.link_version !== index.link_version ||
      currentIndex?.embedding_space !== space
    )
      throw changed();
    return { sources, insufficient: sources.length === 0 };
  }
  async authorizeSources(owner: string, project: string, sources: Source[], frozen = false) {
    if (!sources.length) return;
    const link = frozen
      ? (await this.github.read(owner, project)).link
      : await this.current(owner, project);
    if (!link || link.revoked) throw changed();
    if (
      sources.some(
        (source) =>
          source.projectId !== project ||
          source.repositoryId !== link.repositoryId ||
          (source.kind === 'file' && !indexable(source.path)),
      )
    )
      throw changed();
  }
  async localGuard(
    owner: string,
    project: string,
    sources: Source[],
    db: Pool | PoolClient = this.pool,
  ) {
    if (!sources.length) return true;
    const row = (
      await db.query(
        'SELECT l.* FROM github_links l JOIN projects p ON p.id=l.project_id JOIN github_installations i ON i.owner_id=l.owner_id AND i.installation_id=l.installation_id JOIN github_connections c ON c.owner_id=l.owner_id WHERE l.project_id=$1 AND p.owner_id=$2 AND i.active AND c.encrypted_token IS NOT NULL AND (c.expires_at IS NULL OR c.expires_at>now())',
        [project, owner],
      )
    ).rows[0];
    return (
      !!row &&
      !row.revoked &&
      !row.stale &&
      sources.every(
        (source) =>
          Number(row.repository_id) === source.repositoryId &&
          row.version === source.linkVersion &&
          row.snapshot?.commit === source.commit,
      )
    );
  }
}
