import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

type Sample = { count: number; seconds: number; buckets: number[] };
const boundaries = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10];

// One collector per application/process. Never label metrics with resource/user IDs.
export function observability(token?: string, pool?: Pool) {
  const samples = new Map<string, Sample>();
  const middleware: RequestHandler = (request, response, next) => {
    const started = performance.now();
    response.once('finish', () => {
      const seconds = (performance.now() - started) / 1000;
      // Express route patterns are static; unmatched URLs/queries are never logged.
      const route: string = request.route?.path ?? 'unmatched';
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
        request.method,
      )
        ? request.method
        : 'OTHER';
      const labels = `method=${JSON.stringify(method)},route=${JSON.stringify(route)},status="${response.statusCode}"`;
      const sample = samples.get(labels) ?? {
        count: 0,
        seconds: 0,
        buckets: boundaries.map(() => 0),
      };
      sample.count++;
      sample.seconds += seconds;
      boundaries.forEach((limit, index) => {
        if (seconds <= limit) sample.buckets[index]!++;
      });
      samples.set(labels, sample);
      if (!route.startsWith('/api/health/') && route !== '/internal/metrics')
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'api',
            event: 'http_request',
            requestId: response.getHeader('X-Request-Id'),
            method,
            route,
            status: response.statusCode,
            durationMs: Math.round(seconds * 1000),
            ...(response.getHeader('X-FerWeb-Job')
              ? { jobId: response.getHeader('X-FerWeb-Job') }
              : {}),
          }),
        );
    });
    next();
  };
  const metrics: RequestHandler = async (request, response) => {
    const received = Buffer.from(request.get('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${token ?? ''}`);
    if (!token || received.length !== expected.length || !timingSafeEqual(received, expected)) {
      response.status(404).end();
      return;
    }
    const lines = [
      '# TYPE ferweb_http_requests_total counter',
      '# TYPE ferweb_http_request_duration_seconds histogram',
      '# TYPE ferweb_process_uptime_seconds gauge',
      `ferweb_process_uptime_seconds ${process.uptime()}`,
      '# TYPE ferweb_process_resident_memory_bytes gauge',
      `ferweb_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    ];
    if (pool) {
      const jobs = await pool.query<{ state: string; count: string }>(
        'SELECT state,count(*)::text AS count FROM jobs GROUP BY state',
      );
      lines.push('# TYPE ferweb_jobs gauge');
      for (const state of ['pending', 'running', 'completed', 'failed', 'cancelled'])
        lines.push(
          `ferweb_jobs{state="${state}"} ${jobs.rows.find((row) => row.state === state)?.count ?? '0'}`,
        );
    }
    for (const [labels, sample] of samples) {
      lines.push(`ferweb_http_requests_total{${labels}} ${sample.count}`);
      boundaries.forEach((limit, index) =>
        lines.push(
          `ferweb_http_request_duration_seconds_bucket{${labels},le="${limit}"} ${sample.buckets[index]}`,
        ),
      );
      lines.push(
        `ferweb_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${sample.count}`,
        `ferweb_http_request_duration_seconds_count{${labels}} ${sample.count}`,
        `ferweb_http_request_duration_seconds_sum{${labels}} ${sample.seconds}`,
      );
    }
    response.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  };
  return { middleware, metrics };
}
