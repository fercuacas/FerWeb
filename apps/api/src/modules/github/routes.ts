import express from 'express';
import { z } from 'zod';
import { githubId, githubPath, githubLinkInput } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { readToken } from '../identity/sessions.js';
import type { GitHubService } from './service.js';

export function createGitHubRouter(service: GitHubService) {
  const router = express.Router();
  const owner = (response: express.Response) => (response.locals.user as { id: string }).id;
  const project = (request: express.Request) => z.uuid().parse(request.params.projectId);
  router.get('/github/status', async (_request, response) => {
    response.json(await service.status(owner(response)));
  });
  router.post('/github/authorize', async (request, response) => {
    const token = readToken(request);
    if (!token) throw new HttpError(401, 'unauthenticated', 'Vuelve a entrar.');
    response.json(await service.start(owner(response), token));
  });
  router.post('/github/disconnect', async (_request, response) => {
    await service.disconnect(owner(response));
    response.status(204).end();
  });
  router.get('/github/installations', async (_request, response) => {
    response.json(await service.installations(owner(response)));
  });
  router.post('/github/installations', async (request, response) => {
    const input = z.strictObject({ installationId: githubId }).parse(request.body);
    await service.connect(owner(response), input.installationId);
    response.status(204).end();
  });
  router.get('/github/installations/:installationId/repositories', async (request, response) => {
    const page = z.coerce.number().int().min(1).max(10).default(1).parse(request.query.page);
    response.json(
      await service.repositories(
        owner(response),
        githubId.parse(Number(request.params.installationId)),
        page,
      ),
    );
  });
  router.get('/projects/:projectId/github', async (request, response) => {
    response.json(await service.read(owner(response), project(request)));
  });
  router.post('/projects/:projectId/github', async (request, response) => {
    response.json(
      await service.link(owner(response), project(request), githubLinkInput.parse(request.body)),
    );
  });
  router.delete('/projects/:projectId/github', async (request, response) => {
    const { version } = z
      .strictObject({ version: z.number().int().positive() })
      .parse(request.body);
    await service.unlink(owner(response), project(request), version);
    response.status(204).end();
  });
  router.post('/projects/:projectId/github/sync', async (request, response) => {
    const { version } = z
      .strictObject({ version: z.number().int().positive() })
      .parse(request.body);
    response.json(await service.sync(owner(response), project(request), version));
  });
  router.get('/projects/:projectId/github/file', async (request, response) => {
    response.json(
      await service.file(
        owner(response),
        project(request),
        githubPath.parse(request.query.path),
        z.coerce.number().int().positive().parse(request.query.version),
      ),
    );
  });
  return router;
}
