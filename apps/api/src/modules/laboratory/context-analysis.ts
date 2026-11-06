import type { LabBatch, LabRun } from '@ferweb/contracts';
const sumKnown = (values: (number | null)[]) =>
  values.length && values.every((v): v is number => v !== null)
    ? values.reduce((a, b) => a + b, 0)
    : null;
export function contextTotals(run: LabRun) {
  const metrics = run.contextMetrics;
  if (!metrics) return null;
  const generation = metrics.operations.filter((o) => o.kind === 'summary' || o.kind === 'answer');
  const inference = metrics.operations.filter((o) => o.inference);
  const input = generation.length ? sumKnown(generation.map((o) => o.usage.inputTokens)) : 0;
  const output = generation.length ? sumKnown(generation.map((o) => o.usage.outputTokens)) : 0;
  const tokens = input !== null && output !== null ? input + output : null;
  const cacheReads = generation.length ? sumKnown(generation.map((o) => o.usage.cachedTokens)) : 0;
  const textCost = metrics.operations.length
    ? sumKnown(metrics.operations.map((o) => o.estimatedTextCostUsd))
    : null;
  return {
    generationInputTokens: input,
    generationOutputTokens: output,
    generationTokens: tokens,
    allInferenceInputTokens: inference.length
      ? sumKnown(inference.map((o) => o.usage.inputTokens))
      : metrics.reuseStatus === 'hit'
        ? 0
        : null,
    providerCachedTokens: cacheReads,
    auxiliaryCalls: metrics.operations.filter(
      (o) =>
        o.kind === 'summary' ||
        o.kind === 'retrieval' ||
        o.kind === 'memory_lookup' ||
        o.kind === 'source_lookup',
    ).length,
    summaryCalls: generation.filter((o) => o.kind === 'summary').length,
    generationCalls: generation.length,
    retries: metrics.operations.filter((o) => o.attempt > 1).length,
    estimatedTextCostUsd: textCost,
    knownTextCostSubtotalUsd: metrics.operations.reduce(
      (s, o) => s + (o.estimatedTextCostUsd ?? 0),
      0,
    ),
    knownCostOperations: metrics.operations.filter((o) => o.estimatedTextCostUsd !== null).length,
    operations: metrics.operations.length,
    // Infrastructure, embedding charges and provider cache-write charges have no
    // complete tariff in E6. Never label the text subtotal as a total bill.
    totalCostUsd: null,
  };
}
export function contextReport(batch: LabBatch) {
  const baselineRuns = batch.runs.filter((r) => r.target === 0);
  return {
    protocol: 'ferweb-context-comparison-v1',
    simulated: batch.conditions.contextPlan?.simulated ?? true,
    sourceFingerprint: batch.conditions.contextPlan?.corpus.fingerprint ?? null,
    rows: batch.conditions.targets.map((target, i) => {
      const runs = batch.runs.filter((r) => r.target === i),
        totals = runs.map(contextTotals);
      const baseline = baselineRuns.map(contextTotals);
      const tokens = sumKnown(totals.map((t) => t?.generationTokens ?? null));
      const before = sumKnown(baseline.map((t) => t?.generationTokens ?? null));
      const latency = sumKnown(runs.map((r) => r.durationMs)),
        beforeLatency = sumKnown(baselineRuns.map((r) => r.durationMs));
      const cost = sumKnown(totals.map((t) => t?.estimatedTextCostUsd ?? null));
      const reviewed = runs.filter((r) => r.reviews.length),
        accepted = runs.filter((r) => r.status === 'completed' && r.reviews.at(-1)?.accepted);
      const scored = reviewed.map((r) => r.reviews.at(-1)!.score);
      const dependencies = new Set(runs.map((r) => r.contextMetrics?.reusedFrom).filter(Boolean));
      const creationCostsIncluded = [...dependencies].every((id) => runs.some((r) => r.id === id));
      const reads = runs.flatMap(
        (r) =>
          r.contextMetrics?.operations.filter((o) => o.kind === 'summary' || o.kind === 'answer') ??
          [],
      );
      const discount =
        target.tariff &&
        reads.length &&
        reads.every((o) => o.usage.cachedTokens !== null && o.costReason === 'text_tokens_only')
          ? reads.reduce(
              (total, o) =>
                total +
                (o.usage.cachedTokens! *
                  (target.tariff!.inputPerMillion - target.tariff!.cachedInputPerMillion)) /
                  1000000,
              0,
            )
          : null;
      return {
        target: i,
        expectedPathCoverage: (() => {
          const values = runs
            .filter((r) => r.status === 'completed')
            .flatMap((r) => {
              const expected = [
                ...new Set(
                  batch.conditions.cases
                    .find((c) => c.id === r.caseId)
                    ?.criteria.flatMap((c) => c.expectedPaths ?? []) ?? [],
                ),
              ];
              return expected.length
                ? [
                    expected.filter((p) => r.contextMetrics?.sources.some((s) => s.path === p))
                      .length / expected.length,
                  ]
                : [];
            });
          return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        })(),
        citationValidity: (() => {
          const audits = runs.flatMap((r) =>
            r.contextMetrics?.citationAudit ? [r.contextMetrics.citationAudit] : [],
          );
          const valid = audits.reduce((n, a) => n + a.validLabels.length, 0),
            invalid = audits.reduce((n, a) => n + a.invalidLabels.length, 0);
          return valid + invalid ? valid / (valid + invalid) : null;
        })(),
        searchLatencyMs: sumKnown(
          runs.flatMap(
            (r) =>
              r.contextMetrics?.operations
                .filter((o) =>
                  r.contextMetrics?.retrieval
                    ? ['source_lookup', 'memory_lookup'].includes(o.kind)
                    : o.kind === 'retrieval',
                )
                .map((o) => o.durationMs) ?? [],
          ),
        ),
        retrievalStrategies: [
          ...new Set(
            runs.flatMap((r) =>
              r.contextMetrics?.retrieval ? [r.contextMetrics.retrieval.strategy] : [],
            ),
          ),
        ],
        strategy: target.contextStrategy ?? null,
        attempts: runs.length,
        completed: runs.filter((r) => r.status === 'completed').length,
        reviewed: reviewed.length,
        accepted: accepted.length,
        meanQuality: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
        generationTokens: tokens,
        baselineGenerationTokens: before,
        generationTokenDelta: tokens !== null && before !== null ? before - tokens : null,
        tokenReductionRatio:
          tokens !== null && before !== null && before > 0 ? (before - tokens) / before : null,
        providerCachedTokens: sumKnown(totals.map((t) => t?.providerCachedTokens ?? null)),
        latencyMs: latency,
        baselineLatencyMs: beforeLatency,
        estimatedTextCostUsd: cost,
        totalCostUsd: null,
        costPerAcceptedUsd: cost !== null && accepted.length ? cost / accepted.length : null,
        knownTextCostSubtotalUsd: totals.reduce(
          (a, t) => a + (t?.knownTextCostSubtotalUsd ?? 0),
          0,
        ),
        auxiliaryCalls: totals.reduce((a, t) => a + (t?.auxiliaryCalls ?? 0), 0),
        summaryCalls: totals.reduce((a, t) => a + (t?.summaryCalls ?? 0), 0),
        resultCacheHits: runs.filter((r) => r.contextMetrics?.reuseStatus === 'hit').length,
        creationCostsIncluded,
        estimatedCacheReadDiscountUsd: discount,
        pairs: runs.map((r) => ({
          id: r.id,
          caseId: r.caseId,
          repetition: r.repetition,
          totals: contextTotals(r),
          reusedFrom: r.contextMetrics?.reusedFrom ?? null,
        })),
      };
    }),
  };
}
export function adoptionEvidence(
  batch: LabBatch,
  target: number,
  metric: 'latency' | 'generation_tokens' | 'text_cost',
) {
  const reasons: string[] = [];
  if (!batch.conditions.contextPlan) reasons.push('not_context_experiment');
  if (batch.conditions.contextPlan?.simulated) reasons.push('simulated_evidence');
  if (
    batch.conditions.contextPlan?.memoryComplete === false ||
    batch.runs.some((r) => r.contextMetrics?.memoryComplete === false)
  )
    reasons.push('memory_selection_incomplete');
  if (!batch.conditions.contextPlan?.providerConfigurationRevision)
    reasons.push('unknown_provider_configuration');
  if (batch.status !== 'completed') reasons.push('batch_not_completed');
  if (batch.conditions.cases.length < 2 || batch.conditions.repetitions < 2)
    reasons.push('insufficient_pairs');
  if (
    new Set(batch.conditions.cases.map((c) => JSON.stringify([c.question, c.contextHash]))).size < 2
  )
    reasons.push('insufficient_distinct_cases');
  const baseline = batch.runs.filter((r) => r.target === 0),
    candidate = batch.runs.filter((r) => r.target === target);
  if (!target || candidate.length !== baseline.length || !candidate.length)
    reasons.push('unpaired_results');
  for (const r of candidate) {
    const b = baseline.find((b) => b.caseId === r.caseId && b.repetition === r.repetition),
      review = r.reviews.at(-1),
      before = b?.reviews.at(-1);
    if (!b || r.status !== 'completed' || b.status !== 'completed' || !review || !before)
      reasons.push('incomplete_quality_review');
    else if (!review.accepted || !before.accepted || review.score < before.score)
      reasons.push('quality_regression_or_rejection');
  }
  const report = contextReport(batch),
    row = report.rows[target],
    before = report.rows[0];
  const value = (r: typeof row) =>
    metric === 'latency'
      ? r?.latencyMs
      : metric === 'generation_tokens'
        ? r?.generationTokens
        : r?.estimatedTextCostUsd;
  const a = value(before),
    b = value(row);
  if (a === null || a === undefined || b === null || b === undefined || a <= 0 || b > a * 0.95)
    reasons.push('no_measured_improvement_at_least_5_percent');
  if (!row?.creationCostsIncluded) reasons.push('cache_creation_cost_missing');
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    metric,
    before: a ?? null,
    after: b ?? null,
    scope:
      metric === 'generation_tokens'
        ? 'summary_and_answer_tokens_excludes_unknown_embeddings'
        : metric === 'text_cost'
          ? 'all_operations_text_cost'
          : 'observed_end_to_end_latency',
  };
}
