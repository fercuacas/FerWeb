import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  labCaseSchema,
  tariffSchema,
  labConditionsSchema,
  labBatchSchema,
  labRunSchema,
  unknownUsage,
  type LabCase,
  type LabBatch,
  type LabRun,
  type Usage,
  type labCaseInput,
  type tariffInput,
  type labBatchInput,
  type labReviewInput,
  type ContextPlan,
  type ContextMetrics,
  type contextAdoptionInput,
} from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { AiClient } from '../chat/client.js';
import { RetrievalService } from '../retrieval/service.js';
import {
  digest,
  messagesFor,
  estimateCost,
  automaticAssessment,
  summarize,
  exportCsv,
} from './analysis.js';
import { ContextEngine, strategyOrder, contextPolicyRevision } from './context-engine.js';
import { contextReport, adoptionEvidence } from './context-analysis.js';

const missing = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const stamp = (value: Date | null) => value?.toISOString() ?? null;
function runDto(row: QueryResultRow, reviews: QueryResultRow[]): LabRun {
  return labRunSchema.parse({
    id: row.id,
    caseId: row.case_id,
    target: row.target,
    repetition: row.repetition,
    ordinal: row.ordinal,
    status: row.status,
    response: row.response,
    reportedModel: row.reported_model,
    catalogRevision: row.catalog_revision,
    startedAt: stamp(row.started_at),
    finishedAt: stamp(row.finished_at),
    firstTokenMs: row.first_token_ms,
    durationMs: row.duration_ms,
    usage: row.usage,
    estimatedCostUsd: row.estimated_cost_usd,
    costReason: row.cost_reason,
    cacheObserved:
      row.usage.cachedTokens === null ? 'unknown' : row.usage.cachedTokens > 0 ? 'hit' : 'no_hit',
    automatic: row.automatic,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    reviewVersion: row.review_version,
    reviews: reviews
      .filter((r) => r.run_id === row.id)
      .map((r) => ({
        ...r.assessment,
        version: r.version,
        reviewerId: r.reviewer_id,
        createdAt: stamp(r.created_at),
      })),
    contextMetrics: row.context_metrics,
  });
}
export class LaboratoryService {
  private active = new Map<string, AbortController>();
  constructor(
    readonly pool: Pool,
    readonly ai: AiClient | null,
    readonly retrieval?: RetrievalService,
  ) {}
  private client() {
    if (!this.ai) throw new HttpError(503, 'ai_unconfigured', 'Configura el servicio IA.');
    return this.ai;
  }
  contextEngine() {
    if (!this.retrieval)
      throw new HttpError(503, 'context_unconfigured', 'Configura el índice de contexto.');
    return new ContextEngine(this.pool, this.client(), this.retrieval);
  }
  private async tx<T>(action: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const value = await action(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  private async project(
    owner: string,
    project: string,
    write = false,
    db: Pool | PoolClient = this.pool,
  ) {
    const row = (
      await db.query(
        `SELECT * FROM projects WHERE owner_id=$1 AND id=$2${write ? ' FOR UPDATE' : ''}`,
        [owner, project],
      )
    ).rows[0];
    if (!row) throw missing();
    if (write && row.archived_at)
      throw new HttpError(
        409,
        'project_archived',
        'Restaura el proyecto antes de modificar el laboratorio.',
      );
    return row;
  }
  private async access(owner: string, project: string, cases: LabCase[]) {
    const sources = cases.flatMap((c) => c.sources);
    if (sources.length) {
      if (!this.retrieval)
        throw new HttpError(503, 'context_unconfigured', 'No se puede revalidar el contexto.');
      await this.retrieval.authorizeSources(owner, project, sources, true);
    }
  }
  private async recover(project: string) {
    await this.tx(async (db) => {
      const expired = await db.query(
        "UPDATE lab_batches SET status='interrupted',finished_at=now(),lease_until=NULL WHERE project_id=$1 AND status='running' AND lease_until<now() RETURNING id",
        [project],
      );
      if (expired.rowCount)
        await db.query(
          "UPDATE lab_runs SET status=CASE WHEN status='running' THEN 'interrupted' ELSE 'skipped' END,finished_at=now(),error_code='batch_interrupted',error_message='La ejecución se interrumpió; no se reintenta automáticamente.' WHERE batch_id=ANY($1::uuid[]) AND status IN ('pending','running')",
          [expired.rows.map((r) => r.id)],
        );
    });
  }
  async overview(owner: string, project: string) {
    await this.project(owner, project);
    await this.recover(project);
    const cases = (
      await this.pool.query(
        'SELECT snapshot FROM lab_cases WHERE project_id=$1 ORDER BY created_at DESC,id',
        [project],
      )
    ).rows.map((r) => labCaseSchema.parse(r.snapshot));
    return {
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        question: c.question,
        contextHash: c.contextHash,
        createdAt: c.createdAt,
        sourceCount: c.sources.length,
      })),
      tariffs: (
        await this.pool.query(
          'SELECT snapshot FROM lab_tariffs WHERE project_id=$1 ORDER BY created_at DESC,id',
          [project],
        )
      ).rows.map((r) => tariffSchema.parse(r.snapshot)),
      batches: (
        await this.pool.query(
          'SELECT * FROM lab_batches WHERE project_id=$1 ORDER BY created_at DESC,id',
          [project],
        )
      ).rows.map((r) => ({
        id: r.id,
        title: r.conditions.title,
        status: r.status,
        createdAt: stamp(r.created_at),
      })),
    };
  }
  async caseDetail(owner: string, project: string, id: string) {
    await this.project(owner, project);
    const row = (
      await this.pool.query('SELECT snapshot FROM lab_cases WHERE project_id=$1 AND id=$2', [
        project,
        id,
      ])
    ).rows[0];
    if (!row) throw missing();
    const value = labCaseSchema.parse(row.snapshot);
    await this.access(owner, project, [value]);
    return value;
  }
  async createCase(owner: string, project: string, input: z.infer<typeof labCaseInput>) {
    await this.project(owner, project);
    const sources = input.repositoryContext
      ? await this.retrieve(owner, project, input.question)
      : [];
    const { repositoryContext: _ignored, ...fields } = input;
    const value = labCaseSchema.parse({
      ...fields,
      id: randomUUID(),
      projectId: project,
      version: 1,
      sources,
      contextHash: digest({ context: input.context, sources }),
      createdAt: new Date().toISOString(),
    });
    await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const count = (
        await db.query('SELECT count(*)::int AS n FROM lab_cases WHERE project_id=$1', [project])
      ).rows[0].n;
      if (count >= 50) throw new HttpError(422, 'lab_limit', 'Máximo 50 casos por proyecto.');
      await db.query('INSERT INTO lab_cases(id,project_id,snapshot) VALUES($1,$2,$3)', [
        value.id,
        project,
        JSON.stringify(value),
      ]);
    });
    return value;
  }
  private async retrieve(owner: string, project: string, question: string) {
    if (!this.retrieval)
      throw new HttpError(503, 'context_unconfigured', 'Configura la recuperación de fuentes.');
    const result = await this.retrieval.search(owner, project, question);
    if (result.insufficient)
      throw new HttpError(
        422,
        'insufficient_context',
        'No hay fuentes suficientes para congelar. Prueba otra pregunta o aporta contexto manual.',
      );
    return result.sources;
  }
  async createTariff(owner: string, project: string, input: z.infer<typeof tariffInput>) {
    const value = tariffSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    const today = new Date().toISOString().slice(0, 10);
    if (input.verifiedOn > today)
      throw new HttpError(
        422,
        'tariff_date',
        'La fecha de verificación no puede estar en el futuro.',
      );
    await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const n = (
        await db.query('SELECT count(*)::int AS n FROM lab_tariffs WHERE project_id=$1', [project])
      ).rows[0].n;
      if (n >= 50) throw new HttpError(422, 'lab_limit', 'Máximo 50 tarifas por proyecto.');
      await db.query('INSERT INTO lab_tariffs(id,project_id,snapshot) VALUES($1,$2,$3)', [
        value.id,
        project,
        JSON.stringify(value),
      ]);
    });
    return value;
  }
  async createBatch(owner: string, project: string, input: z.infer<typeof labBatchInput>) {
    await this.project(owner, project);
    if (input.contextExperiment) {
      if (
        input.targets.length !== 4 ||
        input.targets.some((t, i) => t.contextStrategy !== strategyOrder[i]) ||
        input.targets.some(
          (t) =>
            digest({ ...t, contextStrategy: undefined }) !==
            digest({ ...input.targets[0], contextStrategy: undefined }),
        )
      )
        throw new HttpError(
          400,
          'context_conditions',
          'Las cuatro estrategias deben compartir proveedor, modelo, configuración, tarifa y condición de caché.',
        );
    } else if (input.targets.some((t) => t.contextStrategy))
      throw new HttpError(
        400,
        'context_conditions',
        'Prepara un experimento de contexto para usar estrategias.',
      );
    const prior = (
      await this.pool.query(
        'SELECT id,request_hash FROM lab_batches WHERE project_id=$1 AND request_id=$2',
        [project, input.requestId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== digest(input))
        throw new HttpError(
          409,
          'request_conflict',
          'El identificador ya corresponde a otras condiciones.',
        );
      return this.detail(owner, project, prior.id);
    }
    if (input.targets.some((t) => t.provider === 'openai') && !input.allowExternal)
      throw new HttpError(
        422,
        'external_selection_required',
        'Confirma el envío de contexto a los modelos API seleccionados.',
      );
    const cases = await Promise.all(input.caseIds.map((id) => this.caseDetail(owner, project, id)));
    const targets: LabBatch['conditions']['targets'] = [];
    let simulated = false;
    let providerConfigurationRevision: string | null = null;
    for (const target of input.targets) {
      const catalog = await this.client().catalog(target.provider),
        model = catalog.models.find((m) => m.id === target.model);
      if (!catalog.available || !model)
        throw new HttpError(
          422,
          'ai_model_unavailable',
          'Selecciona modelos disponibles en el catálogo.',
        );
      simulated ||= catalog.simulated;
      if (
        input.contextExperiment &&
        targets.length &&
        providerConfigurationRevision !== catalog.configurationRevision
      )
        throw new HttpError(
          409,
          'context_configuration_changed',
          'La configuración cambió durante la preparación.',
        );
      providerConfigurationRevision = catalog.configurationRevision;
      let tariff = null;
      if (target.tariffId) {
        const row = (
          await this.pool.query('SELECT snapshot FROM lab_tariffs WHERE project_id=$1 AND id=$2', [
            project,
            target.tariffId,
          ])
        ).rows[0];
        if (!row) throw missing();
        tariff = tariffSchema.parse(row.snapshot);
        if (tariff.provider !== target.provider || tariff.model !== target.model)
          throw new HttpError(
            422,
            'tariff_model',
            'La tarifa no corresponde al modelo seleccionado.',
          );
      }
      targets.push({ ...target, tariff, catalogRevision: model.revision });
    }
    let contextPlan: ContextPlan | null = null;
    if (input.contextExperiment) {
      const corpus = await this.contextEngine().retrieval.optimizationSnapshot(owner, project);
      if (
        cases.some((c) =>
          c.sources.some(
            (s) => !corpus.sources.some((f) => f.id === s.id && f.excerpt === s.excerpt),
          ),
        )
      )
        throw new HttpError(
          409,
          'context_case_stale',
          'Un caso conserva fuentes distintas del corpus actual. Crea un caso actualizado.',
        );
      contextPlan = {
        protocol: 'ferweb-context-v1',
        corpus,
        simulated: simulated || corpus.simulated,
        providerConfigurationRevision,
        policyRevision: contextPolicyRevision(),
        summaryMaxOutputTokens: 512,
        maxRetries: 0,
        cacheScope: 'experiment',
      };
    }
    const conditions = labConditionsSchema.parse({
      contextPlan,
      title: input.title,
      cases,
      targets,
      repetitions: input.repetitions,
      environment: input.environment,
      allowExternal: input.allowExternal,
      protocol: 'ferweb-lab-v1',
      order: input.contextExperiment ? 'counterbalanced_context_v1' : 'repetition_case_target',
      timeoutMs: 120000,
      messagesHash: Object.fromEntries(cases.map((c) => [c.id, digest(messagesFor(c))])),
      messages: Object.fromEntries(cases.map((c) => [c.id, messagesFor(c)])),
      costScope: 'text_tokens_only',
    });
    const id = await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const existing = (
        await db.query(
          'SELECT id,request_hash FROM lab_batches WHERE project_id=$1 AND request_id=$2',
          [project, input.requestId],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== digest(input))
          throw new HttpError(
            409,
            'request_conflict',
            'El identificador ya corresponde a otras condiciones.',
          );
        return existing.id as string;
      }
      const n = (
        await db.query('SELECT count(*)::int AS n FROM lab_batches WHERE project_id=$1', [project])
      ).rows[0].n;
      if (n >= 50) throw new HttpError(422, 'lab_limit', 'Máximo 50 lotes por proyecto.');
      const row = (
        await db.query(
          'INSERT INTO lab_batches(project_id,request_id,request_hash,conditions) VALUES($1,$2,$3,$4) RETURNING id',
          [project, input.requestId, digest(input), JSON.stringify(conditions)],
        )
      ).rows[0];
      let ordinal = 0;
      for (let repetition = 1; repetition <= input.repetitions; repetition++)
        for (const [caseIndex, c] of cases.entries()) {
          const order = targets.map((_, i) =>
            input.contextExperiment ? (i + repetition - 1 + caseIndex) % targets.length : i,
          );
          for (const target of order)
            await db.query(
              'INSERT INTO lab_runs(batch_id,case_id,target,repetition,ordinal,usage) VALUES($1,$2,$3,$4,$5,$6)',
              [row.id, c.id, target, repetition, ++ordinal, JSON.stringify(unknownUsage())],
            );
        }
      return row.id as string;
    });
    return this.detail(owner, project, id);
  }
  private async load(owner: string, project: string, id: string): Promise<LabBatch> {
    await this.project(owner, project);
    const row = (
      await this.pool.query('SELECT * FROM lab_batches WHERE project_id=$1 AND id=$2', [
        project,
        id,
      ])
    ).rows[0];
    if (!row) throw missing();
    const conditions = labConditionsSchema.parse(row.conditions);
    await this.access(owner, project, conditions.cases);
    if (conditions.contextPlan)
      await this.retrieval!.authorizeSources(
        owner,
        project,
        conditions.contextPlan.corpus.sources,
        true,
      );
    const runs = (
        await this.pool.query('SELECT * FROM lab_runs WHERE batch_id=$1 ORDER BY ordinal', [id])
      ).rows,
      reviews = (
        await this.pool.query(
          'SELECT v.* FROM lab_reviews v JOIN lab_runs r ON r.id=v.run_id WHERE r.batch_id=$1 ORDER BY v.version',
          [id],
        )
      ).rows;
    return labBatchSchema.parse({
      id: row.id,
      projectId: project,
      requestId: row.request_id,
      conditions,
      status: row.status,
      cancelRequested: row.cancel_requested,
      createdAt: stamp(row.created_at),
      startedAt: stamp(row.started_at),
      finishedAt: stamp(row.finished_at),
      runs: runs.map((r) => runDto(r, reviews)),
    });
  }
  async detail(owner: string, project: string, id: string) {
    await this.project(owner, project);
    await this.recover(project);
    const batch = await this.load(owner, project, id);
    return { batch, summary: summarize(batch) };
  }
  async contextComparison(owner: string, project: string, id: string) {
    const { batch } = await this.detail(owner, project, id);
    if (!batch.conditions.contextPlan)
      throw new HttpError(409, 'not_context_experiment', 'Selecciona un experimento de contexto.');
    let valid = true;
    try {
      await this.contextEngine().guard(
        owner,
        project,
        batch.conditions.contextPlan,
        batch.conditions.targets[0],
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) valid = false;
      else throw error;
    }
    return {
      report: contextReport(batch),
      valid,
      adoption: batch.conditions.targets.map((_, target) =>
        adoptionEvidence(batch, target, 'latency'),
      ),
    };
  }
  async adoptContext(owner: string, project: string, input: z.infer<typeof contextAdoptionInput>) {
    const { batch } = await this.detail(owner, project, input.batchId),
      evidence = adoptionEvidence(batch, input.target, input.metric);
    if (!evidence.eligible)
      throw new HttpError(
        409,
        'context_evidence_insufficient',
        'No se cumplen las condiciones: ' + evidence.reasons.join(', '),
      );
    const plan = batch.conditions.contextPlan!,
      target = batch.conditions.targets[input.target]!;
    await this.contextEngine().guard(owner, project, plan, target);
    const catalog = await this.client().catalog(target.provider);
    if (
      catalog.simulated ||
      catalog.configurationRevision !== plan.providerConfigurationRevision ||
      !catalog.models.some((m) => m.id === target.model && m.revision === target.catalogRevision)
    )
      throw new HttpError(
        409,
        'context_configuration_changed',
        'La configuración ya no coincide con la evaluación.',
      );
    const versions = batch.runs
      .filter((r) => r.target === 0 || r.target === input.target)
      .map((r) => ({ id: r.id, review_version: r.reviewVersion, status: r.status }));
    await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const old = (
        await db.query('SELECT version FROM context_policies WHERE project_id=$1 FOR UPDATE', [
          project,
        ])
      ).rows[0];
      if ((old?.version ?? 0) !== input.version)
        throw new HttpError(
          409,
          'context_policy_changed',
          'La política cambió. Actualiza antes de adoptar.',
        );
      const current = (
        await db.query(
          'SELECT id,review_version,status FROM lab_runs WHERE batch_id=$1 AND target IN (0,$2) ORDER BY ordinal FOR SHARE',
          [batch.id, input.target],
        )
      ).rows;
      if (digest(current) !== digest(versions))
        throw new HttpError(409, 'context_reviews_changed', 'Las revisiones han cambiado.');
      const selection = {
        batchId: batch.id,
        target: input.target,
        strategy: target.contextStrategy,
        metric: input.metric,
        fingerprint: plan.corpus.fingerprint,
        adoptedAt: new Date().toISOString(),
        reviewStateHash: digest(versions),
        plan,
        modelTarget: target,
      };
      await db.query(
        'INSERT INTO context_policies(project_id,selection) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET selection=$2,version=context_policies.version+1,updated_at=now()',
        [project, JSON.stringify(selection)],
      );
    });
    return this.contextPolicy(owner, project);
  }
  async contextPolicy(owner: string, project: string) {
    await this.project(owner, project);
    const row = (
      await this.pool.query('SELECT version,selection FROM context_policies WHERE project_id=$1', [
        project,
      ])
    ).rows[0];
    if (!row?.selection) return { policy: null, version: row?.version ?? 0 };
    const { plan: _plan, modelTarget: _target, reviewStateHash: _hash, ...fields } = row.selection;
    return { policy: { ...fields, version: row.version }, version: row.version };
  }
  async resetContextPolicy(owner: string, project: string, version: number) {
    await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const result = await db.query(
        "UPDATE context_policies SET selection='null'::jsonb,version=version+1,updated_at=now() WHERE project_id=$1 AND version=$2",
        [project, version],
      );
      if (!result.rowCount)
        throw new HttpError(409, 'context_policy_changed', 'La política ha cambiado.');
    });
    return this.contextPolicy(owner, project);
  }
  async start(owner: string, project: string, id: string, sessionHash: string) {
    const { batch } = await this.detail(owner, project, id);
    if (batch.status !== 'draft') return { id: batch.id, status: batch.status };
    if (batch.conditions.contextPlan)
      await this.contextEngine().guard(
        owner,
        project,
        batch.conditions.contextPlan,
        batch.conditions.targets[0],
      );
    if (this.active.size)
      throw new HttpError(
        409,
        'lab_busy',
        'Ya hay un lote activo en esta API. No hay cola automática.',
      );
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      await this.tx(async (db) => {
        await this.project(owner, project, true, db);
        if (
          !(
            await db.query(
              'SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()',
              [sessionHash, owner],
            )
          ).rowCount
        )
          throw new HttpError(401, 'unauthenticated', 'La sesión ha terminado.');
        if (
          (
            await db.query("SELECT 1 FROM lab_batches WHERE project_id=$1 AND status='running'", [
              project,
            ])
          ).rowCount
        )
          throw new HttpError(409, 'lab_busy', 'Ya hay un lote activo.');
        const row = await db.query(
          "UPDATE lab_batches SET status='running',started_at=now(),lease_until=now()+interval '30 seconds' WHERE id=$1 AND status='draft'",
          [id],
        );
        if (!row.rowCount) throw new HttpError(409, 'batch_changed', 'El lote ya ha cambiado.');
      });
    } catch (error) {
      this.active.delete(id);
      throw error;
    }
    void this.execute(owner, project, batch, sessionHash, controller)
      .catch(() => {
        /* SQL lease recovery exposes interruption; never retry inference. */
      })
      .finally(() => this.active.delete(id));
    return { id, status: 'running' };
  }
  private async localAccess(owner: string, project: string, batch: LabBatch, sessionHash: string) {
    const result = (
      await this.pool.query(
        `SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()) AND EXISTS(SELECT 1 FROM projects WHERE id=$3 AND owner_id=$2 AND archived_at IS NULL) AS allowed`,
        [sessionHash, owner, project],
      )
    ).rows[0];
    if (!result.allowed) return false;
    const sources = [
      ...batch.conditions.cases.flatMap((c) => c.sources),
      ...(batch.conditions.contextPlan?.corpus.sources ?? []),
    ];
    if (!sources.length) return true;
    const row = (
      await this.pool.query(
        'SELECT l.* FROM github_links l JOIN github_installations i ON i.owner_id=l.owner_id AND i.installation_id=l.installation_id JOIN github_connections c ON c.owner_id=l.owner_id WHERE l.project_id=$1 AND l.owner_id=$2 AND NOT l.revoked AND i.active AND c.encrypted_token IS NOT NULL AND (c.expires_at IS NULL OR c.expires_at>now())',
        [project, owner],
      )
    ).rows[0];
    return (
      !!row &&
      sources.every((s) => s.repositoryId === Number(row.repository_id)) &&
      (!batch.conditions.contextPlan ||
        (!row.stale && row.version === batch.conditions.contextPlan.corpus.linkVersion))
    );
  }
  private async execute(
    owner: string,
    project: string,
    batch: LabBatch,
    sessionHash: string,
    controller: AbortController,
  ) {
    let current: string | null = null,
      partial = '',
      first: number | null = null,
      reported: string | null = null,
      flushChain = Promise.resolve();
    const checkpoint = () => {
      flushChain = flushChain.then(async () => {
        const saved = await this.pool.query(
          "UPDATE lab_batches SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND status='running' RETURNING cancel_requested",
          [batch.id],
        );
        if (
          !saved.rows[0] ||
          saved.rows[0].cancel_requested ||
          !(await this.localAccess(owner, project, batch, sessionHash))
        )
          controller.abort('cancelled');
        if (current)
          await this.pool.query(
            "UPDATE lab_runs SET response=$2,first_token_ms=$3,reported_model=$4 WHERE id=$1 AND status='running'",
            [current, partial, first, reported],
          );
      });
      return flushChain;
    };
    const heartbeat = setInterval(
      () => void checkpoint().catch(() => controller.abort('persistence_error')),
      2000,
    ).unref();
    try {
      for (const run of batch.runs) {
        await checkpoint();
        if (controller.signal.aborted) break;
        current = run.id;
        partial = '';
        first = null;
        reported = null;
        const c = batch.conditions.cases.find((c) => c.id === run.caseId)!,
          target = batch.conditions.targets[run.target]!,
          started = performance.now();
        const admitted = await this.pool.query(
          "UPDATE lab_runs SET status='running',started_at=now() WHERE id=$1 AND status='pending' RETURNING started_at",
          [run.id],
        );
        if (!admitted.rowCount) throw new Error('run_changed');
        let status: LabRun['status'] = 'error',
          usage: Usage = unknownUsage(),
          code: string | null = null,
          message: string | null = null,
          terminal = false,
          revision: string | null = null;
        const timeout = new AbortController(),
          timer = setTimeout(() => timeout.abort('timeout'), 120000).unref(),
          signal = AbortSignal.any([controller.signal, timeout.signal]);
        const cancelUpstream = () => void this.ai?.cancel(run.id).catch(() => {});
        signal.addEventListener('abort', cancelUpstream, { once: true });
        try {
          await this.access(owner, project, [c]);
          const catalog = await this.client().catalog(target.provider),
            model = catalog.models.find((m) => m.id === target.model);
          if (!catalog.available || !model)
            throw new HttpError(422, 'ai_model_unavailable', 'El modelo ya no está disponible.');
          revision = model.revision;
          if (target.catalogRevision !== null && revision !== target.catalogRevision)
            throw new HttpError(
              409,
              'model_revision_changed',
              'La revisión del modelo ha cambiado desde la preparación. Crea otro lote.',
            );
          await checkpoint();
          if (signal.aborted) throw new Error('aborted');
          let flushed = performance.now();
          const events = batch.conditions.contextPlan
            ? this.contextEngine().events({
                owner,
                project,
                scope: batch.id,
                id: run.id,
                plan: batch.conditions.contextPlan,
                strategy: target.contextStrategy!,
                question: c.question,
                context: c.context,
                target,
                signal,
                save: async (metrics: ContextMetrics) => {
                  const saved = await this.pool.query(
                    "UPDATE lab_runs SET context_metrics=$2 WHERE id=$1 AND status='running'",
                    [run.id, JSON.stringify(metrics)],
                  );
                  if (!saved.rowCount)
                    throw new HttpError(
                      409,
                      'context_lease_lost',
                      'La ejecución ya no acepta resultados.',
                    );
                },
              })
            : this.client().generate(
                {
                  id: run.id,
                  provider: target.provider,
                  model: target.model,
                  messages: batch.conditions.messages[c.id]!,
                  maxOutputTokens: target.configuration.maxOutputTokens,
                },
                signal,
              );
          for await (const event of events) {
            if (signal.aborted) break;
            if (event.type === 'meta') reported = event.reportedModel;
            else if (event.type === 'delta' && event.text) {
              if (first === null) first = performance.now() - started;
              partial += event.text;
              if (partial.length > 20000) {
                partial = partial.slice(0, 20000);
                throw new HttpError(
                  422,
                  'output_limit',
                  'La respuesta supera el límite de 20 000 caracteres.',
                );
              }
              if (performance.now() - flushed > 250) {
                await checkpoint();
                flushed = performance.now();
              }
              if (signal.aborted) break;
            } else if (event.type === 'finish') {
              usage = event.usage;
              status = event.status;
              code = event.error?.code ?? null;
              message = event.error?.message ?? null;
              terminal = true;
              break;
            } else if (event.type === 'cancelled') {
              controller.abort('cancelled');
              break;
            }
          }
          if (!terminal && !signal.aborted)
            throw new HttpError(502, 'ai_stream_incomplete', 'El flujo terminó sin confirmación.');
        } catch (error) {
          code = error instanceof HttpError ? error.code : 'lab_generation_error';
          message =
            error instanceof HttpError ? error.message : 'No se ha podido completar la ejecución.';
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancelUpstream);
          await flushChain.catch(() => {});
        }
        if (signal.aborted) {
          status =
            controller.signal.reason === 'server_shutdown'
              ? 'interrupted'
              : timeout.signal.aborted
                ? 'error'
                : 'cancelled';
          code = timeout.signal.aborted ? 'lab_timeout' : 'batch_cancelled';
          message = timeout.signal.aborted
            ? 'Se ha agotado el límite de dos minutos.'
            : 'La ejecución se ha detenido; se conserva el parcial.';
          cancelUpstream();
        }
        const cost = estimateCost(
          usage,
          target.tariff,
          admitted.rows[0].started_at.toISOString().slice(0, 10),
        );
        await this.pool.query(
          `UPDATE lab_runs SET status=$2,response=$3,reported_model=$4,catalog_revision=$5,finished_at=now(),first_token_ms=$6,duration_ms=$7,usage=$8,estimated_cost_usd=$9,cost_reason=$10,automatic=$11,error_code=$12,error_message=$13 WHERE id=$1 AND status='running'`,
          [
            run.id,
            status,
            partial,
            reported,
            revision,
            first,
            performance.now() - started,
            JSON.stringify(usage),
            cost.amount,
            cost.reason,
            JSON.stringify(
              automaticAssessment(
                c,
                partial,
                status,
                batch.conditions.contextPlan
                  ? (
                      (
                        await this.pool.query('SELECT context_metrics FROM lab_runs WHERE id=$1', [
                          run.id,
                        ])
                      ).rows[0]?.context_metrics?.sources ?? []
                    ).map((s: { path: string }) => s.path)
                  : undefined,
              ),
            ),
            code,
            message,
          ],
        );
        current = null;
      }
    } catch (error) {
      controller.abort('persistence_error');
      throw error;
    } finally {
      clearInterval(heartbeat);
      await flushChain.catch(() => {});
      await this.tx(async (db) => {
        await db.query(
          "UPDATE lab_runs SET status=CASE WHEN status='running' THEN 'interrupted' ELSE 'skipped' END,finished_at=now(),error_code='batch_stopped',error_message='No se reintenta automáticamente.' WHERE batch_id=$1 AND status IN ('pending','running')",
          [batch.id],
        );
        await db.query(
          "UPDATE lab_batches SET status=$2,finished_at=now(),lease_until=NULL WHERE id=$1 AND status='running'",
          [
            batch.id,
            controller.signal.aborted
              ? ['server_shutdown', 'persistence_error'].includes(String(controller.signal.reason))
                ? 'interrupted'
                : 'cancelled'
              : 'completed',
          ],
        );
      });
    }
  }
  async cancel(owner: string, project: string, id: string) {
    await this.project(owner, project);
    const row = (
      await this.pool.query(
        "UPDATE lab_batches SET cancel_requested=true,status=CASE WHEN status='draft' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='draft' THEN now() ELSE finished_at END WHERE project_id=$1 AND id=$2 RETURNING status",
        [project, id],
      )
    ).rows[0];
    if (!row) throw missing();
    this.active.get(id)?.abort('cancelled');
    if (row.status === 'cancelled')
      await this.pool.query(
        "UPDATE lab_runs SET status='skipped',finished_at=now() WHERE batch_id=$1 AND status='pending'",
        [id],
      );
    return { id, status: row.status };
  }
  async review(
    owner: string,
    project: string,
    batchId: string,
    runId: string,
    input: z.infer<typeof labReviewInput>,
  ) {
    const { batch } = await this.detail(owner, project, batchId),
      run = batch.runs.find((r) => r.id === runId);
    if (!run) throw missing();
    const c = batch.conditions.cases.find((c) => c.id === run.caseId)!;
    if (['pending', 'running'].includes(run.status))
      throw new HttpError(409, 'run_active', 'Espera a que termine la ejecución.');
    if (
      input.verdicts.length !== c.criteria.length ||
      (input.accepted && (run.status !== 'completed' || input.verdicts.some((v) => v !== 'pass')))
    )
      throw new HttpError(
        422,
        'review_criteria',
        'Para aceptar deben cumplirse todos los criterios y completarse la ejecución.',
      );
    await this.tx(async (db) => {
      await this.project(owner, project, true, db);
      const updated = await db.query(
        'UPDATE lab_runs SET review_version=review_version+1 WHERE id=$1 AND review_version=$2 RETURNING review_version',
        [runId, input.version],
      );
      if (!updated.rowCount)
        throw new HttpError(
          409,
          'review_changed',
          'La valoración ha cambiado. Actualiza antes de guardar.',
        );
      await db.query(
        'INSERT INTO lab_reviews(run_id,version,reviewer_id,assessment) VALUES($1,$2,$3,$4)',
        [
          runId,
          updated.rows[0].review_version,
          owner,
          JSON.stringify({ ...input, version: updated.rows[0].review_version }),
        ],
      );
    });
    return this.detail(owner, project, batchId);
  }
  async export(owner: string, project: string, id: string, format: 'json' | 'csv') {
    const value = await this.detail(owner, project, id);
    return format === 'csv'
      ? exportCsv(value.batch)
      : JSON.stringify(
          { format: 'ferweb-lab-export-v1', exportedAt: new Date().toISOString(), ...value },
          null,
          2,
        );
  }
  shutdown() {
    for (const controller of this.active.values()) controller.abort('server_shutdown');
  }
}
