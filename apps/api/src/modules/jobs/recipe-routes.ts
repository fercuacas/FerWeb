import express from 'express';
import { z } from 'zod';
import { recipeExecuteInput, recipeInput } from '@ferweb/contracts';
import type { RecipeService } from './recipe-service.js';

export function recipeRouter(service: RecipeService) {
  const router = express.Router();
  const path = '/projects/:projectId/tasks/:taskId/recipes';
  const scope = (req: express.Request, res: express.Response) =>
    [
      (res.locals.user as { id: string }).id,
      z.uuid().parse(req.params.projectId),
      z.uuid().parse(req.params.taskId),
    ] as const;
  const plan = (req: express.Request) => z.uuid().parse(req.params.planId);
  router.get(path, async (req, res) => res.json(await service.list(...scope(req, res))));
  router.post(path, async (req, res) =>
    res.status(201).json(await service.prepare(...scope(req, res), recipeInput.parse(req.body))),
  );
  router.get(path + '/:planId', async (req, res) =>
    res.json(await service.read(...scope(req, res), plan(req))),
  );
  router.post(path + '/:planId/execute', async (req, res) =>
    res
      .status(202)
      .json(
        await service.execute(
          ...scope(req, res),
          plan(req),
          recipeExecuteInput.parse(req.body).hash,
        ),
      ),
  );
  return router;
}
