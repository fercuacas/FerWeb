import express from 'express';
import { z } from 'zod';
import { archiveAgentInput, createAgentInput, updateAgentInput } from '@ferweb/contracts';
import { AgentCatalog } from './catalog.js';

export function agentRouter(catalog: AgentCatalog) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  const id = (req: express.Request) => z.uuid().parse(req.params.agentId);

  router.get('/projects/:projectId/agents', async (req, res) => {
    res.json(await catalog.list(...scope(req, res)));
  });
  router.post('/projects/:projectId/agents', async (req, res) => {
    const role = await catalog.create(...scope(req, res), createAgentInput.parse(req.body));
    res.status(201).json({ role });
  });
  router.get('/projects/:projectId/agents/:agentId', async (req, res) => {
    res.json(await catalog.read(...scope(req, res), id(req)));
  });
  router.patch('/projects/:projectId/agents/:agentId', async (req, res) => {
    const role = await catalog.update(
      ...scope(req, res),
      id(req),
      updateAgentInput.parse(req.body),
    );
    res.json({ role });
  });
  router.post('/projects/:projectId/agents/:agentId/archive', async (req, res) => {
    const { version } = archiveAgentInput.parse(req.body);
    res.json({ role: await catalog.archive(...scope(req, res), id(req), version) });
  });
  return router;
}
