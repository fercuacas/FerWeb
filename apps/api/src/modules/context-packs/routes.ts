import express from 'express';
import { z } from 'zod';
import { contextPackPrepare, contextPackPolicyInput, projectMapInput } from '@ferweb/contracts';
import { ContextPackService } from './service.js';
export function contextPackRouter(service: ContextPackService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  router.get('/projects/:projectId/context-packs', async (req, res) =>
    res.json(await service.overview(...scope(req, res))),
  );
  router.post('/projects/:projectId/context-packs/map/draft', async (req, res) => {
    z.strictObject({}).parse(req.body);
    res.json(await service.draftMap(...scope(req, res)));
  });
  router.put('/projects/:projectId/context-packs/map', async (req, res) =>
    res.json(await service.saveMap(...scope(req, res), projectMapInput.parse(req.body))),
  );
  router.put('/projects/:projectId/context-packs/policy', async (req, res) =>
    res.json(await service.savePolicy(...scope(req, res), contextPackPolicyInput.parse(req.body))),
  );
  router.post('/projects/:projectId/context-packs/prepare', async (req, res) =>
    res
      .status(201)
      .json(await service.prepare(...scope(req, res), contextPackPrepare.parse(req.body))),
  );
  router.get('/projects/:projectId/context-packs/receipts/:receiptId', async (req, res) =>
    res.json({
      receipt: await service.read(...scope(req, res), z.uuid().parse(req.params.receiptId)),
    }),
  );
  return router;
}
