import express from 'express';
import { z } from 'zod';
import {
  memoryMutation,
  memoryCorrection,
  memorySearchInput,
  memoryImportInput,
  memoryExportInput,
} from '@ferweb/contracts';
import { MemoryService } from './service.js';
export function memoryRouter(service: MemoryService) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  const id = (req: express.Request) => z.uuid().parse(req.params.memoryId);
  router.post('/projects/:projectId/memory/search', async (req, res) =>
    res.json(await service.search(...scope(req, res), memorySearchInput.parse(req.body))),
  );
  router.post('/projects/:projectId/memory/import', async (req, res) => {
    const input = memoryImportInput.parse(req.body);
    res
      .status(201)
      .json(await service.import(...scope(req, res), input.requestId, input.format, input.content));
  });
  router.post('/projects/:projectId/memory/export', async (req, res) => {
    const input = memoryExportInput.parse(req.body);
    res.json(await service.export(...scope(req, res), input.selections, input.format));
  });
  router.post('/projects/:projectId/memory', async (req, res) => {
    const input = memoryMutation.parse(req.body);
    res.status(201).json(await service.create(...scope(req, res), input.requestId, input.entry));
  });
  router.get('/projects/:projectId/memory/:memoryId/history', async (req, res) =>
    res.json(await service.history(...scope(req, res), id(req))),
  );
  router.get('/projects/:projectId/memory/:memoryId', async (req, res) => {
    const { revision } = z
      .strictObject({ revision: z.coerce.number().int().min(1).max(50).optional() })
      .parse(req.query);
    res.json(await service.read(...scope(req, res), id(req), revision));
  });
  router.put('/projects/:projectId/memory/:memoryId', async (req, res) => {
    const input = memoryCorrection.parse(req.body);
    res.json(await service.correct(...scope(req, res), id(req), input.version, input.entry));
  });
  return router;
}
