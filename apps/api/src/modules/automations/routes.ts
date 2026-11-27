import express from 'express';
import { z } from 'zod';
import { automationAction, automationCreate, automationNotificationId } from '@ferweb/contracts';
import type { Automations } from './service.js';

export function automationRouter(service: Automations) {
  const router = express.Router();
  const base = '/projects/:projectId/automations';
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  router.get(base, async (req, res) => res.json(await service.list(...scope(req, res))));
  router.post(base, async (req, res) =>
    res
      .status(201)
      .json(await service.create(...scope(req, res), automationCreate.parse(req.body))),
  );
  router.post(base + '/:scheduleId/actions', async (req, res) =>
    res.json(
      await service.change(
        ...scope(req, res),
        z.uuid().parse(req.params.scheduleId),
        automationAction.parse(req.body),
      ),
    ),
  );
  router.post(base + '/notifications/:notificationId/read', async (req, res) => {
    z.strictObject({}).parse(req.body);
    res.json(
      await service.markRead(
        ...scope(req, res),
        automationNotificationId.parse(req.params.notificationId),
      ),
    );
  });
  return router;
}
