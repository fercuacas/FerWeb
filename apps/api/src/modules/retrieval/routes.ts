import express from 'express';
import { z } from 'zod';
import { RetrievalService } from './service.js';
export function createRetrievalRouter(service: RetrievalService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) => ({
    owner: (res.locals.user as { id: string }).id,
    project: z.uuid().parse(req.params.projectId),
  });
  router.get('/projects/:projectId/context', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.status(owner, project));
  });
  router.post('/projects/:projectId/context/index', async (req, res) => {
    const { owner, project } = scope(req, res);
    z.strictObject({}).parse(req.body);
    res.json(await service.index(owner, project));
  });
  router.post('/projects/:projectId/context/search', async (req, res) => {
    const { owner, project } = scope(req, res);
    const { query } = z.strictObject({ query: z.string().trim().min(1).max(4000) }).parse(req.body);
    res.json(await service.search(owner, project, query));
  });
  return router;
}
