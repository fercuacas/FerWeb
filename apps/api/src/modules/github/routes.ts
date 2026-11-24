import express from 'express';
import { z } from 'zod';
import {
  githubId,
  githubPath,
  githubLinkInput,
  linkGitHubWorkInput,
  prepareGitHubIssueInput,
  gitHubIssueActionInput,
} from '@ferweb/contracts';
import { GitHubWork } from './work.js';
import { HttpError } from '../../http-error.js';
import { readToken } from '../identity/sessions.js';
import type { GitHubService } from './service.js';

export function createGitHubRouter(service: GitHubService) {
  const router = express.Router();
  const owner = (response: express.Response) => (response.locals.user as { id: string }).id;
  const project = (request: express.Request) => z.uuid().parse(request.params.projectId);
  const work = new GitHubWork(service);
  router.get('/projects/:projectId/github/work', async (req, res) =>
    res.json(await work.read(owner(res), project(req))),
  );
  router.post('/projects/:projectId/github/work/link', async (req, res) =>
    res.json(await work.link(owner(res), project(req), linkGitHubWorkInput.parse(req.body))),
  );
  router.post('/projects/:projectId/github/work/issues/prepare', async (req, res) =>
    res
      .status(201)
      .json(await work.prepare(owner(res), project(req), prepareGitHubIssueInput.parse(req.body))),
  );
  router.get('/projects/:projectId/github/work/actions/:actionId', async (req, res) =>
    res.json({
      action: await work.detail(owner(res), project(req), z.uuid().parse(req.params.actionId)),
    }),
  );
  router.post('/projects/:projectId/github/work/actions/:actionId/execute', async (req, res) =>
    res.json(
      await work.execute(
        owner(res),
        project(req),
        z.uuid().parse(req.params.actionId),
        gitHubIssueActionInput.parse(req.body).hash,
      ),
    ),
  );
  router.post('/projects/:projectId/github/work/actions/:actionId/reconcile', async (req, res) =>
    res.json(
      await work.reconcile(
        owner(res),
        project(req),
        z.uuid().parse(req.params.actionId),
        gitHubIssueActionInput.parse(req.body).hash,
      ),
    ),
  );
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
