import express from 'express';
import { z } from 'zod';
import { jobInput } from '@ferweb/contracts';
import { JobService } from './service.js';
export function createJobRouter(service: JobService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) => ({
    owner: (res.locals.user as { id: string }).id,
    project: z.uuid().parse(req.params.projectId),
  });
  router.get('/projects/:projectId/jobs', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.list(owner, project));
  });
  router.post('/projects/:projectId/jobs', async (req, res) => {
    const { owner, project } = scope(req, res),
      result = await service.create(owner, project, jobInput.parse(req.body));
    res.setHeader('X-FerWeb-Job', result.job.id);
    res.status(202).json(result);
  });
  router.get('/projects/:projectId/jobs/:jobId', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.detail(owner, project, z.uuid().parse(req.params.jobId)));
  });
  router.get('/projects/:projectId/jobs/:jobId/events', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(
      await service.events(
        owner,
        project,
        z.uuid().parse(req.params.jobId),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .default(0)
          .parse(req.query.after),
      ),
    );
  });
  router.post('/projects/:projectId/jobs/:jobId/cancel', async (req, res) => {
    const { owner, project } = scope(req, res);
    z.strictObject({}).parse(req.body);
    res.json(await service.cancel(owner, project, z.uuid().parse(req.params.jobId)));
  });
  return router;
}
