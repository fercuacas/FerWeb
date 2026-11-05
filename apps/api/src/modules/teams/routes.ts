import express from 'express';
import { z } from 'zod';
import {
  createTeamTemplateInput,
  updateTeamTemplateInput,
  archiveTeamTemplateInput,
  prepareTeamPlanInput,
  approveTeamPlanInput,
} from '@ferweb/contracts';
import { TeamService } from './service.js';

export function teamRouter(service: TeamService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  const templateId = (req: express.Request) => z.uuid().parse(req.params.templateId);
  const planId = (req: express.Request) => z.uuid().parse(req.params.planId);
  router.get('/projects/:projectId/team-templates', async (req, res) =>
    res.json(await service.templates(...scope(req, res))),
  );
  router.post('/projects/:projectId/team-templates', async (req, res) =>
    res
      .status(201)
      .json(await service.create(...scope(req, res), createTeamTemplateInput.parse(req.body))),
  );
  router.get('/projects/:projectId/team-templates/:templateId', async (req, res) =>
    res.json(await service.template(...scope(req, res), templateId(req))),
  );
  router.patch('/projects/:projectId/team-templates/:templateId', async (req, res) =>
    res.json(
      await service.update(
        ...scope(req, res),
        templateId(req),
        updateTeamTemplateInput.parse(req.body),
      ),
    ),
  );
  router.post('/projects/:projectId/team-templates/:templateId/archive', async (req, res) => {
    res.json(
      await service.archive(
        ...scope(req, res),
        templateId(req),
        archiveTeamTemplateInput.parse(req.body).version,
      ),
    );
  });
  router.get('/projects/:projectId/team-plans', async (req, res) =>
    res.json(await service.plans(...scope(req, res))),
  );
  router.post('/projects/:projectId/team-plans', async (req, res) =>
    res
      .status(201)
      .json(await service.prepare(...scope(req, res), prepareTeamPlanInput.parse(req.body))),
  );
  router.get('/projects/:projectId/team-plans/:planId', async (req, res) =>
    res.json(await service.readPlan(...scope(req, res), planId(req))),
  );
  router.post('/projects/:projectId/team-plans/:planId/approve', async (req, res) =>
    res.json(
      await service.approve(...scope(req, res), planId(req), approveTeamPlanInput.parse(req.body)),
    ),
  );
  return router;
}
