import type { Pool } from 'pg';

// A single statement gives a consistent observation. Route and runtime dimensions stay finite.
const observations = `
WITH settings AS (SELECT statement_timestamp() AS now, statement_timestamp()-interval '24 hours' AS since),
work AS (
  SELECT j.id,j.state,j.updated_at,j.created_at,j.cancel_requested,j.lease_until,j.fence,
    CASE
      WHEN j.kind='simulation-v1' THEN 'simulator'
      WHEN j.kind='local-readonly-v1' THEN 'ollama_read'
      WHEN j.kind='codex-v1' AND j.configuration->>'executionId'='codex-local-v1' THEN 'codex_local'
      WHEN j.kind='codex-v1' THEN 'codex_api'
      ELSE 'unknown'
    END AS runtime
  FROM jobs j
), attempts AS (
  SELECT w.runtime,w.cancel_requested,a.state,a.termination_confirmed,
    extract(epoch FROM a.finished_at-a.started_at) AS seconds
  FROM job_attempts a JOIN work w ON w.id=a.job_id CROSS JOIN settings s
  WHERE COALESCE(a.finished_at,s.now)>=s.since
), admissions AS (
  SELECT w.runtime||':'||CASE COALESCE(c.report->>'simulated',l.report->>'simulated')
    WHEN 'true' THEN 'simulated' WHEN 'false' THEN 'provider' ELSE 'unknown' END AS runtime,
    CASE WHEN a.settled THEN 'settled' ELSE 'unsettled' END AS settlement,
    (a.usage->>'inputTokens')::numeric AS input_tokens,
    (a.usage->>'outputTokens')::numeric AS output_tokens
  FROM execution_request_admissions a JOIN work w ON w.id=a.job_id
  LEFT JOIN coding_runs c ON c.job_id=w.id LEFT JOIN local_read_runs l ON l.job_id=w.id
  CROSS JOIN settings s
  WHERE a.created_at>=s.since
), reports AS (
  SELECT w.runtime, (c.report IS NOT NULL OR l.report IS NOT NULL) AS present,
    (c.context_receipt_id IS NOT NULL OR l.context_receipt_id IS NOT NULL) AS context
  FROM work w LEFT JOIN coding_runs c ON c.job_id=w.id LEFT JOIN local_read_runs l ON l.job_id=w.id
  CROSS JOIN settings s
  WHERE w.runtime<>'simulator' AND w.state IN ('completed','failed','cancelled') AND w.updated_at>=s.since
), observations AS (
  SELECT 'queue' AS metric, runtime AS first, state AS second, count(*) AS value
  FROM work WHERE state IN ('pending','running') GROUP BY runtime,state
  UNION ALL SELECT 'oldest_pending_seconds',runtime,'',max(extract(epoch FROM s.now-created_at))
  FROM work CROSS JOIN settings s WHERE state='pending' GROUP BY runtime
  UNION ALL SELECT 'attempts',runtime,state,count(*) FROM attempts GROUP BY runtime,state
  UNION ALL SELECT 'attempt_duration_count',runtime,state,count(seconds)
  FROM attempts WHERE seconds IS NOT NULL GROUP BY runtime,state
  UNION ALL SELECT 'attempt_duration_sum',runtime,state,sum(seconds)
  FROM attempts WHERE seconds IS NOT NULL GROUP BY runtime,state
  UNION ALL SELECT 'cancellation',runtime,CASE termination_confirmed
    WHEN true THEN 'confirmed' WHEN false THEN 'unconfirmed' ELSE 'unknown' END,count(*)
  FROM attempts WHERE cancel_requested OR state='cancelled' GROUP BY runtime,termination_confirmed
  UNION ALL SELECT 'admissions',runtime,settlement,count(*) FROM admissions GROUP BY runtime,settlement
  UNION ALL SELECT 'input_coverage',runtime,'reported',count(input_tokens) FROM admissions GROUP BY runtime
  UNION ALL SELECT 'input_coverage',runtime,'unknown',count(*)-count(input_tokens) FROM admissions GROUP BY runtime
  UNION ALL SELECT 'output_coverage',runtime,'reported',count(output_tokens) FROM admissions GROUP BY runtime
  UNION ALL SELECT 'output_coverage',runtime,'unknown',count(*)-count(output_tokens) FROM admissions GROUP BY runtime
  UNION ALL SELECT 'known_tokens',runtime,'input',sum(input_tokens) FROM admissions GROUP BY runtime HAVING count(input_tokens)>0
  UNION ALL SELECT 'known_tokens',runtime,'output',sum(output_tokens) FROM admissions GROUP BY runtime HAVING count(output_tokens)>0
  UNION ALL SELECT 'report_coverage',runtime,CASE WHEN present THEN 'stored' ELSE 'missing' END,count(*) FROM reports GROUP BY runtime,present
  UNION ALL SELECT 'context_coverage',runtime,CASE WHEN context THEN 'stored' ELSE 'missing' END,count(*) FROM reports GROUP BY runtime,context
  UNION ALL SELECT 'teams','',state,count(*) FROM team_executions GROUP BY state
  UNION ALL SELECT 'automations','',state,count(*) FROM automation_schedules GROUP BY state
  UNION ALL SELECT 'oldest_due_seconds','','',max(extract(epoch FROM s.now-a.next_run_at))
  FROM automation_schedules a CROSS JOIN settings s WHERE a.state='active' AND a.next_run_at<=s.now
  UNION ALL SELECT 'orphans','','terminal_lease',count(*) FROM work
  WHERE state NOT IN ('pending','running') AND (lease_until IS NOT NULL OR fence IS NOT NULL)
  UNION ALL SELECT 'orphans','','active_attempt',count(*) FROM job_attempts a JOIN work w ON w.id=a.job_id
  WHERE w.state NOT IN ('pending','running') AND a.state='running'
  UNION ALL SELECT 'orphans','','reserved_step',count(*) FROM execution_budget_steps b JOIN work w ON w.id=b.job_id
  WHERE w.state NOT IN ('pending','running') AND NOT b.released
)
SELECT metric,first,second,value::text FROM observations WHERE value IS NOT NULL ORDER BY metric,first,second`;

const families = {
  queue: ['queue_jobs', 'runtime', 'state'],
  oldest_pending_seconds: ['oldest_pending_seconds', 'runtime'],
  attempts: ['job_attempts_24h', 'runtime', 'state'],
  attempt_duration_count: ['attempt_duration_observations_24h', 'runtime', 'state'],
  attempt_duration_sum: ['attempt_duration_seconds_sum_24h', 'runtime', 'state'],
  cancellation: ['cancellation_attempts_24h', 'runtime', 'confirmation'],
  admissions: ['request_admissions_24h', 'runtime', 'settlement'],
  input_coverage: ['input_usage_coverage_24h', 'runtime', 'provenance'],
  output_coverage: ['output_usage_coverage_24h', 'runtime', 'provenance'],
  known_tokens: ['known_provider_tokens_24h', 'runtime', 'field'],
  report_coverage: ['report_coverage_24h', 'runtime', 'evidence'],
  context_coverage: ['context_receipt_coverage_24h', 'runtime', 'evidence'],
  teams: ['team_executions', '', 'state'],
  automations: ['automation_schedules', '', 'state'],
  oldest_due_seconds: ['oldest_due_seconds'],
  orphans: ['queue_inconsistencies', '', 'kind'],
} as const;
const dimensions = new Set([
  '',
  'simulator',
  'ollama_read',
  'codex_local',
  'codex_api',
  'unknown',
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'lost',
  'draft',
  'active',
  'paused',
  'blocked',
  'exhausted',
  'confirmed',
  'unconfirmed',
  'settled',
  'unsettled',
  'reported',
  'input',
  'output',
  'stored',
  'missing',
  'terminal_lease',
  'active_attempt',
  'reserved_step',
]);
const scopes = new Set(['simulated', 'provider', 'unknown']);

export async function operationMetrics(pool: Pool): Promise<string[]> {
  const result = await pool.query<{
    metric: keyof typeof families;
    first: string;
    second: string;
    value: string;
  }>(observations);
  const lines: string[] = [];
  const declared = new Set<string>();
  for (const { metric, first, second, value } of result.rows) {
    const [runtime = '', scope, extra] = first.split(':');
    if (
      !Object.hasOwn(families, metric) ||
      !dimensions.has(runtime) ||
      !dimensions.has(second) ||
      extra !== undefined ||
      (scope !== undefined && !scopes.has(scope)) ||
      !/^-?\d+(?:\.\d+)?$/.test(value)
    )
      continue;
    const [suffix, a, b] = families[metric];
    const name = 'ferweb_operations_' + suffix;
    if (!declared.has(name)) {
      lines.push(`# TYPE ${name} gauge`);
      declared.add(name);
    }
    const labels = [a && `${a}="${runtime}"`, b && `${b}="${second}"`, scope && `scope="${scope}"`]
      .filter(Boolean)
      .join(',');
    lines.push(`${name}${labels ? '{' + labels + '}' : ''} ${value}`);
  }
  return lines;
}
