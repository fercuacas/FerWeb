import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export async function loadTest({
  url,
  origin,
  cookie,
  projectId,
  users = 8,
  iterations = 100,
  pauseMs = 100,
}) {
  assert.ok(
    users >= 1 &&
      users <= 32 &&
      iterations >= 1 &&
      iterations <= 200 &&
      pauseMs >= 0 &&
      pauseMs <= 1000,
  );
  const samples = [];
  const groups = { reads: [], writes: [] };
  let errors = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: users }, async (_, user) => {
      for (let iteration = 0; iteration < iterations; iteration++) {
        const write = iteration % 5 === 0;
        const before = performance.now();
        try {
          const result = await fetch(`${url}/api/projects/${projectId}/tasks`, {
            method: write ? 'POST' : 'GET',
            headers: {
              Cookie: cookie,
              Origin: origin,
              'X-FerWeb-Request': '1',
              'Content-Type': 'application/json',
            },
            ...(write
              ? {
                  body: JSON.stringify({
                    title: `Load ${user}-${iteration}`,
                    description: 'Synthetic release check',
                    priority: 'medium',
                    status: 'todo',
                    acceptanceCriteria: ['Persisted'],
                  }),
                }
              : {}),
            signal: AbortSignal.timeout(5000),
          });
          const body = await result.json();
          if (
            result.status !== (write ? 201 : 200) ||
            (write ? !body.task?.id : !Array.isArray(body.tasks))
          )
            errors++;
        } catch {
          errors++;
        }
        const elapsed = performance.now() - before;
        samples.push(elapsed);
        groups[write ? 'writes' : 'reads'].push(elapsed);
        await delay(pauseMs);
      }
    }),
  );
  const summary = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p) =>
      +(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0).toFixed(2);
    return {
      requests: sorted.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: percentile(1),
    };
  };
  const durationMs = performance.now() - started;
  const report = {
    kind: 'authenticated-project-crud',
    users,
    iterations,
    pauseMs,
    errors,
    durationMs: +durationMs.toFixed(2),
    requestsPerSecond: +((samples.length * 1000) / durationMs).toFixed(2),
    overall: summary(samples),
    reads: summary(groups.reads),
    writes: summary(groups.writes),
    thresholds: { maxErrors: 0, p95Ms: 1000, maxMs: 5000 },
    passed: errors === 0 && summary(samples).p95Ms < 1000 && summary(samples).maxMs < 5000,
  };
  assert.ok(report.passed, `Load thresholds failed: ${JSON.stringify(report)}`);
  return report;
}
