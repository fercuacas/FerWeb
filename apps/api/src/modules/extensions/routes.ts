import express from 'express';
import { z } from 'zod';
import {
  extensionAction,
  extensionImport,
  extensionOperation,
  extensionsResponse,
  portableDownload,
  portableSelection,
} from '@ferweb/contracts';
import type { Pool } from 'pg';
import { ProjectExtensions } from './service.js';
import { codexArchive, PortableCatalog } from './portable.js';
import { HttpError } from '../../http-error.js';

export function extensionRouter(pool: Pool) {
  const router = express.Router();
  const extensions = new ProjectExtensions(pool),
    catalog = new PortableCatalog(pool);
  const project = '/projects/:projectId';
  const path = project + '/extensions',
    id = path + '/:extensionId';
  const scope = (req: express.Request, res: express.Response) =>
    [res.locals.user.id as string, z.uuid().parse(req.params.projectId)] as const;
  const selection = (req: express.Request, res: express.Response) =>
    [...scope(req, res), z.uuid().parse(req.params.extensionId)] as const;
  router.get(path, async (req, res) =>
    res.json(extensionsResponse.parse(await extensions.list(...scope(req, res)))),
  );
  router.post(path, async (req, res) =>
    res
      .status(201)
      .json(await extensions.import(...scope(req, res), extensionImport.parse(req.body))),
  );
  router.get(id, async (req, res) => res.json(await extensions.read(...selection(req, res))));
  router.post(id + '/actions', async (req, res) =>
    res.json(await extensions.change(...selection(req, res), extensionAction.parse(req.body))),
  );
  router.post(id + '/runs', async (req, res) =>
    res.json(await extensions.run(...selection(req, res), extensionOperation.parse(req.body))),
  );
  router.post(project + '/portable/:format', async (req, res) => {
    const format = z.enum(['preview', 'json', 'codex']).parse(req.params.format);
    if (format === 'preview')
      return res.json(
        (await catalog.build(...scope(req, res), portableSelection.parse(req.body))).summary,
      );
    const input = portableDownload.parse(req.body);
    const result = await catalog.build(...scope(req, res), input.selection);
    if (result.summary.sha256 !== input.sha256)
      throw new HttpError(409, 'portable_changed', 'Prepara otra vista previa de la exportación.');
    if (format === 'json') return res.attachment('ferweb-portable.json').json(result.bundle);
    return res.attachment('ferweb-codex.zip').send(codexArchive(result.files));
  });
  return router;
}
