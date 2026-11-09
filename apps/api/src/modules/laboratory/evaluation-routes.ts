import express from 'express';
import { z } from 'zod';
import { agentEvaluationInput, agentEvaluationReviewInput } from '@ferweb/contracts';
import type { AgentEvaluations } from './evaluations.js';

export function agentEvaluationRouter(service: AgentEvaluations) {
  const router = express.Router();
  const path = '/projects/:projectId/lab/agent-evaluations';
  const scope = (req: express.Request, res: express.Response) =>
    [(res.locals.user as { id: string }).id, z.uuid().parse(req.params.projectId)] as const;
  const id = (req: express.Request) => z.uuid().parse(req.params.evaluationId);
  router.get(path, async (req, res) => {
    res.json(await service.list(...scope(req, res)));
  });
  router.post(path, async (req, res) => {
    res.json(await service.compare(...scope(req, res), agentEvaluationInput.parse(req.body)));
  });
  router.get(path + '/:evaluationId', async (req, res) => {
    res.json(await service.read(...scope(req, res), id(req)));
  });
  router.post(path + '/:evaluationId/reviews', async (req, res) => {
    res.json(
      await service.review(...scope(req, res), id(req), agentEvaluationReviewInput.parse(req.body)),
    );
  });
  router.get(path + '/:evaluationId/export', async (req, res) => {
    const result = await service.read(...scope(req, res), id(req));
    res.attachment(`ferweb-agent-evaluation-${result.id}.json`).json(result);
  });
  return router;
}
