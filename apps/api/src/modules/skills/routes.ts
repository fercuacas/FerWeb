import express from 'express';
import { z } from 'zod';
import { skillImportInput, skillReviewInput } from '@ferweb/contracts';
import { SkillLibrary } from './library.js';

export function skillRouter(library: SkillLibrary) {
  const router = express.Router();
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  const id = (req: express.Request) => z.uuid().parse(req.params.skillId);
  router.get('/projects/:projectId/skills', async (req, res) => {
    res.json(await library.list(...scope(req, res)));
  });
  router.post('/projects/:projectId/skills', async (req, res) => {
    res
      .status(201)
      .json({ skill: await library.import(...scope(req, res), skillImportInput.parse(req.body)) });
  });
  router.get('/projects/:projectId/skills/:skillId', async (req, res) => {
    res.json({ skill: await library.read(...scope(req, res), id(req)) });
  });
  router.post('/projects/:projectId/skills/:skillId/review', async (req, res) => {
    res.json({
      skill: await library.review(...scope(req, res), id(req), skillReviewInput.parse(req.body)),
    });
  });
  return router;
}
