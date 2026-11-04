import { randomUUID } from 'node:crypto';
import express from 'express';
import { readinessSchema } from '@ferweb/contracts';
import type { DatabaseSnapshot } from './health.js';
import { ZodError } from 'zod';
import { HttpError } from './http-error.js';
import { createWorkspaceRouter, type WorkspaceOptions } from './workspace.js';
import { createGitHubPublicRouter } from './modules/github/webhooks.js';
import { GitHubService } from './modules/github/service.js';
import { codingInternalRouter } from './modules/jobs/coding-routes.js';
import { observability } from './observability.js';

export function createApp(
  inspect: () => Promise<DatabaseSnapshot>,
  requiredMigrations: number,
  workspace?: WorkspaceOptions,
  metricsToken?: string,
) {
  const app = express();
  app.disable('x-powered-by');
  const monitoring = observability(metricsToken, workspace?.pool);
  app.use((_request, response, next) => {
    response.setHeader('X-Request-Id', randomUUID());
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(monitoring.middleware);
  app.get('/internal/metrics', monitoring.metrics);
  app.get('/api/health/live', (_request, response) => {
    response.json({ service: 'ferweb-api', status: 'alive' });
  });
  app.get('/api/health/ready', async (_request, response) => {
    let snapshot: DatabaseSnapshot;
    try {
      snapshot = await inspect();
    } catch {
      snapshot = {
        checks: {
          database: 'unavailable',
          migrations: 'unavailable',
          appliedMigrations: null,
          requiredMigrations,
        },
        installation: null,
      };
    }
    const ready =
      snapshot.checks.database === 'ready' &&
      snapshot.checks.migrations === 'ready' &&
      snapshot.installation !== null;
    const payload = readinessSchema.parse({
      service: 'ferweb-api',
      status: ready ? 'ready' : 'unavailable',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      ...snapshot,
    });
    response.status(ready ? 200 : 503).json(payload);
  });
  if (workspace) {
    if (workspace.coding && workspace.runnerToken)
      app.use('/internal', codingInternalRouter(workspace.coding, workspace.runnerToken));
    app.use(
      '/api',
      createGitHubPublicRouter(
        workspace.github ?? new GitHubService(workspace.pool, null),
        workspace.appOrigin,
      ),
    );
    app.use('/api', createWorkspaceRouter(workspace));
  }
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use(
    (
      _error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (_error instanceof HttpError) {
        response
          .status(_error.status)
          .json({ error: { code: _error.code, message: _error.message } });
        return;
      }
      if (_error instanceof ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Revisa los campos y sus límites.' },
        });
        return;
      }
      if (_error instanceof SyntaxError && 'body' in _error) {
        response
          .status(400)
          .json({ error: { code: 'invalid_json', message: 'El JSON no es válido.' } });
        return;
      }
      if (
        typeof _error === 'object' &&
        _error !== null &&
        'type' in _error &&
        _error.type === 'entity.too.large'
      ) {
        response.status(413).json({
          error: { code: 'body_too_large', message: 'La solicitud supera el tamaño permitido.' },
        });
        return;
      }
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'request_failed',
          timestamp: new Date().toISOString(),
          service: 'api',
          requestId: response.getHeader('X-Request-Id'),
        }),
      );
      response.status(500).json({ error: 'internal_error' });
    },
  );
  return app;
}
