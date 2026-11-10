import express from 'express';
import { z } from 'zod';
import {
  learningAction,
  learningComplianceInput,
  learningInput,
  learningReview,
} from '@ferweb/contracts';
import type { ProjectLearning } from './learning.js';

export function learningRouter(service: ProjectLearning) {
  const router = express.Router();
  const path = '/projects/:projectId/lab/learning';
  const scope = (req: express.Request, res: express.Response) =>
    [(res.locals.user as { id: string }).id, z.uuid().parse(req.params.projectId)] as const;
  const id = (req: express.Request) => z.uuid().parse(req.params.proposalId);
  router.get(path, async (req, res) => res.json(await service.list(...scope(req, res))));
  router.get(path + '/health', async (req, res) =>
    res.json(await service.health(...scope(req, res))),
  );
  router.post(path + '/compliance', async (req, res) =>
    res.json(await service.comply(...scope(req, res), learningComplianceInput.parse(req.body))),
  );
  router.post(path, async (req, res) =>
    res.json(await service.propose(...scope(req, res), learningInput.parse(req.body))),
  );
  router.get(path + '/:proposalId', async (req, res) =>
    res.json(await service.read(...scope(req, res), id(req))),
  );
  router.post(path + '/:proposalId/review', async (req, res) => {
    const { version, decision } = learningReview.parse(req.body);
    res.json(await service.review(...scope(req, res), id(req), version, decision));
  });
  router.post(path + '/:proposalId/adopt', async (req, res) => {
    const { version } = learningAction.parse(req.body);
    res.json(await service.adopt(...scope(req, res), id(req), version));
  });
  router.post(path + '/:proposalId/revert', async (req, res) => {
    const { version } = learningAction.parse(req.body);
    res.json(await service.revert(...scope(req, res), id(req), version));
  });
  return router;
}
