import express from 'express';
import { z } from 'zod';
import { canvasEntryInput, canvasKind } from '@ferweb/contracts';
import type { ReviewCanvas } from './canvas.js';

export function canvasRouter(service: ReviewCanvas) {
  const router = express.Router();
  const path = '/projects/:projectId/canvas/:kind/:targetId';
  const scope = (req: express.Request, res: express.Response) =>
    [
      res.locals.user.id as string,
      z.uuid().parse(req.params.projectId),
      canvasKind.parse(req.params.kind),
      z.uuid().parse(req.params.targetId),
    ] as const;
  router.get(path, async (req, res) => res.json(await service.read(...scope(req, res))));
  router.post(path, async (req, res) =>
    res.status(201).json(await service.add(...scope(req, res), canvasEntryInput.parse(req.body))),
  );
  router.get(path + '/html-source', async (req, res) => {
    const [owner, project, kind, id] = scope(req, res);
    z.literal('diff').parse(kind);
    const { element, hash } = z
      .strictObject({
        element: z.string().regex(/^file:[a-f0-9]{64}$/),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(req.query);
    const source = await service.htmlSource(owner, project, id, element, hash);
    res
      .set({
        'Content-Security-Policy':
          "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Disposition': 'attachment; filename="artefacto.html.txt"',
      })
      .type('text/plain')
      .send(source);
  });
  return router;
}
