import express from 'express';
import { z } from 'zod';
import {
  labCaseInput,
  tariffInput,
  labBatchInput,
  labReviewInput,
  contextAdoptionInput,
} from '@ferweb/contracts';
import { readToken, tokenHash } from '../identity/sessions.js';
import { LaboratoryService } from './service.js';
export function createLaboratoryRouter(service: LaboratoryService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) => ({
    owner: (res.locals.user as { id: string }).id,
    project: z.uuid().parse(req.params.projectId),
  });
  router.get('/projects/:projectId/lab', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.overview(owner, project));
  });
  router.get('/projects/:projectId/lab/context-policy', async (req, res) => {
    const s = scope(req, res);
    res.json(await service.contextPolicy(s.owner, s.project));
  });
  router.post('/projects/:projectId/lab/context-policy', async (req, res) => {
    const s = scope(req, res);
    res.json(await service.adoptContext(s.owner, s.project, contextAdoptionInput.parse(req.body)));
  });
  router.delete('/projects/:projectId/lab/context-policy', async (req, res) => {
    const s = scope(req, res);
    res.json(
      await service.resetContextPolicy(
        s.owner,
        s.project,
        z.strictObject({ version: z.number().int().positive() }).parse(req.body).version,
      ),
    );
  });
  router.get('/projects/:projectId/lab/batches/:batchId/context-comparison', async (req, res) => {
    const s = scope(req, res);
    res.json(
      await service.contextComparison(s.owner, s.project, z.uuid().parse(req.params.batchId)),
    );
  });
  router.post('/projects/:projectId/lab/cases', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.status(201).json(await service.createCase(owner, project, labCaseInput.parse(req.body)));
  });
  router.get('/projects/:projectId/lab/cases/:caseId', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.caseDetail(owner, project, z.uuid().parse(req.params.caseId)));
  });
  router.post('/projects/:projectId/lab/tariffs', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.status(201).json(await service.createTariff(owner, project, tariffInput.parse(req.body)));
  });
  router.post('/projects/:projectId/lab/batches', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.status(201).json(await service.createBatch(owner, project, labBatchInput.parse(req.body)));
  });
  router.get('/projects/:projectId/lab/batches/:batchId', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(await service.detail(owner, project, z.uuid().parse(req.params.batchId)));
  });
  router.post('/projects/:projectId/lab/batches/:batchId/execute', async (req, res) => {
    const { owner, project } = scope(req, res);
    z.strictObject({}).parse(req.body);
    res
      .status(202)
      .json(
        await service.start(
          owner,
          project,
          z.uuid().parse(req.params.batchId),
          tokenHash(readToken(req) ?? ''),
        ),
      );
  });
  router.post('/projects/:projectId/lab/batches/:batchId/cancel', async (req, res) => {
    const { owner, project } = scope(req, res);
    z.strictObject({}).parse(req.body);
    res.json(await service.cancel(owner, project, z.uuid().parse(req.params.batchId)));
  });
  router.post('/projects/:projectId/lab/batches/:batchId/runs/:runId/reviews', async (req, res) => {
    const { owner, project } = scope(req, res);
    res.json(
      await service.review(
        owner,
        project,
        z.uuid().parse(req.params.batchId),
        z.uuid().parse(req.params.runId),
        labReviewInput.parse(req.body),
      ),
    );
  });
  router.get('/projects/:projectId/lab/batches/:batchId/export', async (req, res) => {
    const { owner, project } = scope(req, res),
      id = z.uuid().parse(req.params.batchId),
      format = z.enum(['json', 'csv']).parse(req.query.format);
    const value = await service.export(owner, project, id, format);
    res.setHeader('Content-Disposition', `attachment; filename="ferweb-lab-${id}.${format}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(format === 'csv' ? 'text/csv' : 'application/json').send(value);
  });
  return router;
}
