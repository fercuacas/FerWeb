import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  codingInput,
  repeatCodingInput,
  reviewInput,
  reviewPublishInput,
  requestAdmissionInput,
  requestUsageInput,
  sendTeamMessageInput,
} from '@ferweb/contracts';
import { CodingService } from './coding-service.js';
import { ReviewService } from './review-service.js';
import { TeamExecutions } from '../teams/executions.js';
import { TeamMessages } from '../teams/messages.js';
export function codingRouter(service: CodingService) {
  const router = express.Router();
  const reviews = new ReviewService(service);
  const scope = (req: express.Request, res: express.Response) => ({
    owner: (res.locals.user as { id: string }).id,
    project: z.uuid().parse(req.params.projectId),
  });
  router.get('/projects/:projectId/coding/capabilities', async (req, res) => {
    const s = scope(req, res);
    res.json(await service.capabilities(s.owner, s.project));
  });
  router.post('/projects/:projectId/coding', async (req, res) => {
    const s = scope(req, res),
      result = await service.create(s.owner, s.project, codingInput.parse(req.body));
    res.setHeader('X-FerWeb-Job', result.job.id);
    res.status(202).json(result);
  });
  router.get('/projects/:projectId/coding/:jobId', async (req, res) => {
    const s = scope(req, res);
    res.json(await service.read(s.owner, s.project, z.uuid().parse(req.params.jobId)));
  });
  router.get('/projects/:projectId/coding/:jobId/review', async (req, res) => {
    const s = scope(req, res);
    res.json(await reviews.read(s.owner, s.project, z.uuid().parse(req.params.jobId)));
  });
  router.put('/projects/:projectId/coding/:jobId/review', async (req, res) => {
    const s = scope(req, res);
    res.json(
      await reviews.save(
        s.owner,
        s.project,
        z.uuid().parse(req.params.jobId),
        reviewInput.parse(req.body),
      ),
    );
  });
  router.post('/projects/:projectId/coding/:jobId/review/publish', async (req, res) => {
    const s = scope(req, res);
    res.json(
      await reviews.publish(
        s.owner,
        s.project,
        z.uuid().parse(req.params.jobId),
        reviewPublishInput.parse(req.body).version,
      ),
    );
  });
  router.get('/projects/:projectId/coding/:jobId/comparisons', async (req, res) => {
    const s = scope(req, res);
    res.json(await reviews.comparisons(s.owner, s.project, z.uuid().parse(req.params.jobId)));
  });
  router.post('/projects/:projectId/coding/:jobId/repeat', async (req, res) => {
    const s = scope(req, res);
    res
      .status(202)
      .json(
        await service.repeat(
          s.owner,
          s.project,
          z.uuid().parse(req.params.jobId),
          repeatCodingInput.parse(req.body),
        ),
      );
  });
  return router;
}
export function codingInternalRouter(service: CodingService, token: string) {
  const router = express.Router();
  router.use((req, res, next) => {
    const auth = Buffer.from(req.get('Authorization') ?? ''),
      expected = Buffer.from('Bearer ' + token);
    if (!token || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.status(401).json({});
      return;
    }
    next();
  });
  router.use(express.json({ limit: '16kb' }));
  const teams = new TeamExecutions(service.pool, service);
  const messages = new TeamMessages(service.pool, service);
  router.post('/coding/:jobId/messages', async (req, res) => {
    const body = z.strictObject({ fence: z.uuid(), message: sendTeamMessageInput }).parse(req.body);
    res.json(await messages.send(z.uuid().parse(req.params.jobId), body.fence, body.message));
  });
  router.post('/coding/:jobId/inbox', async (req, res) => {
    const body = z
      .strictObject({ fence: z.uuid(), after: z.number().int().min(0).max(2147483647) })
      .parse(req.body);
    res.json(await messages.inbox(z.uuid().parse(req.params.jobId), body.fence, body.after));
  });
  router.post('/teams/tick', async (req, res) => {
    z.strictObject({}).parse(req.body);
    res.json(await teams.tick());
  });
  router.post('/coding/:jobId/admit', async (req, res) => {
    res.json(
      await service.jobs.queue.budgets.admit(
        z.uuid().parse(req.params.jobId),
        requestAdmissionInput.parse(req.body),
      ),
    );
  });
  router.post('/coding/:jobId/usage', async (req, res) => {
    await service.jobs.queue.budgets.recordUsage(
      z.uuid().parse(req.params.jobId),
      requestUsageInput.parse(req.body),
    );
    res.json({ recorded: true });
  });
  router.post('/coding/:jobId/input', async (req, res) => {
    const b = z
      .strictObject({ fence: z.uuid(), checkOnly: z.boolean().default(false) })
      .parse(req.body);
    res.json(await service.executionInput(z.uuid().parse(req.params.jobId), b.fence, b.checkOnly));
  });
  return router;
}
