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
    const input = z.strictObject({ lexicalOnly: z.boolean().optional() }).parse(req.body);
    res.json(await service.index(owner, project, input.lexicalOnly));
  });
  router.post('/projects/:projectId/context/search', async (req, res) => {
    const { owner, project } = scope(req, res);
    const { query } = z.strictObject({ query: z.string().trim().min(1).max(4000) }).parse(req.body);
    res.json(await service.search(owner, project, query));
  });
  router.get('/projects/:projectId/context/catalog', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.catalog(owner, project));
  });
  router.post('/projects/:projectId/context/catalog/export', async (req, res) => {
    z.strictObject({}).parse(req.body);
    const { owner, project } = scope(req, res);
    res.json(await service.catalog(owner, project, true));
  });
  router.post('/projects/:projectId/context/hybrid/search', async (req, res) => {
    const { owner, project } = scope(req, res);
    const input = z
      .strictObject({
        query: z.string().trim().min(1).max(4000),
        path: z.string().min(1).max(300).optional(),
        limit: z.number().int().min(1).max(12).optional(),
      })
      .parse(req.body);
    res.json(
      await service.hybrid(owner, project, input.query, {
        ...(input.path && { path: input.path }),
        ...(input.limit && { limit: input.limit }),
      }),
    );
  });
  return router;
}
