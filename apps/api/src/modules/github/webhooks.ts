import { createHash } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { githubId } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { validSignature } from './crypto.js';
import type { GitHubService } from './service.js';

const entity = z.object({ id: githubId });
const schema = z.object({
  action: z.string().optional(),
  installation: entity.optional(),
  repository: entity.optional(),
  sender: entity.optional(),
  repositories_removed: z.array(entity).max(5000).optional(),
});
const repositoryEvents = new Set([
  'push',
  'issues',
  'pull_request',
  'repository',
  'create',
  'delete',
]);
export function createGitHubPublicRouter(service: GitHubService, appOrigin: string) {
  const router = express.Router();
  router.get('/github/callback', async (request, response) => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    const input = z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code: z.string().min(1).max(500).optional(),
      })
      .safeParse(request.query);
    try {
      if (!input.success) throw new Error('Invalid callback');
      await service.callback(input.data.state, input.data.code);
      response.redirect(303, `${appOrigin}/#/github?authorization=connected`);
    } catch {
      // Never reflect code, state, provider errors or credentials into URLs/logs.
      response.redirect(303, `${appOrigin}/#/github?authorization=failed`);
    }
  });
  router.post(
    '/github/webhook',
    (request, _response, next) => {
      if (request.get('Content-Encoding') && request.get('Content-Encoding') !== 'identity')
        throw new HttpError(415, 'github_encoding', 'Envía el webhook como JSON sin comprimir.');
      next();
    },
    express.raw({ type: 'application/json', limit: '2mb', inflate: false }),
    async (request, response) => {
      if (!service.config)
        throw new HttpError(503, 'github_unconfigured', 'GitHub App no está configurada.');
      if (
        !Buffer.isBuffer(request.body) ||
        !validSignature(
          service.config.webhookSecret,
          request.body,
          request.get('X-Hub-Signature-256'),
        )
      )
        throw new HttpError(401, 'github_signature', 'La firma del webhook no es válida.');
      const delivery = z.uuid().parse(request.get('X-GitHub-Delivery'));
      const event = z
        .string()
        .regex(/^[a-z_]{1,80}$/)
        .parse(request.get('X-GitHub-Event'));
      let parsed: unknown;
      try {
        parsed = JSON.parse(request.body.toString('utf8'));
      } catch {
        throw new HttpError(400, 'invalid_json', 'El JSON no es válido.');
      }
      const payload = schema.parse(parsed);
      if (
        (repositoryEvents.has(event) && (!payload.installation || !payload.repository)) ||
        (['installation', 'installation_repositories'].includes(event) && !payload.installation) ||
        (event === 'github_app_authorization' && !payload.sender)
      )
        throw new HttpError(400, 'github_payload', 'Faltan identificadores del evento.');
      const hash = createHash('sha256').update(request.body).digest('hex');
      const outcome =
        repositoryEvents.has(event) ||
        ['installation', 'installation_repositories', 'github_app_authorization'].includes(event)
          ? 'processed'
          : 'ignored';
      const duplicate = await service.transaction(async (client) => {
        const inserted = await client.query(
          'INSERT INTO github_deliveries (delivery_id,event,payload_hash,outcome) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING delivery_id',
          [delivery, event, hash, outcome],
        );
        if (!inserted.rowCount) {
          const previous = (
            await client.query(
              'SELECT event,payload_hash FROM github_deliveries WHERE delivery_id=$1',
              [delivery],
            )
          ).rows[0]!;
          if (previous.event !== event || previous.payload_hash !== hash)
            throw new HttpError(
              409,
              'github_delivery_conflict',
              'El identificador ya corresponde a otra entrega.',
            );
          return true;
        }
        if (event === 'github_app_authorization' && payload.action === 'revoked') {
          await client.query(
            'UPDATE github_connections SET encrypted_token=NULL WHERE github_user_id=$1',
            [payload.sender!.id],
          );
          await client.query(
            'UPDATE github_installations i SET active=false FROM github_connections c WHERE i.owner_id=c.owner_id AND c.github_user_id=$1',
            [payload.sender!.id],
          );
          await client.query(
            'UPDATE github_links l SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 FROM github_connections c WHERE l.owner_id=c.owner_id AND c.github_user_id=$1',
            [payload.sender!.id],
          );
        } else if (event === 'installation') {
          // Re-enabling always requires explicit reconnection and fresh provider validation.
          if (payload.action !== 'created') {
            await client.query(
              'UPDATE github_installations SET active=false WHERE installation_id=$1',
              [payload.installation!.id],
            );
            await client.query(
              'UPDATE github_links SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 WHERE installation_id=$1',
              [payload.installation!.id],
            );
          }
        } else if (event === 'installation_repositories') {
          const removed = (payload.repositories_removed ?? []).map((repo) => repo.id);
          await client.query(
            'UPDATE github_links SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 WHERE installation_id=$1 AND repository_id=ANY($2::bigint[])',
            [payload.installation!.id, removed],
          );
          await client.query(
            'UPDATE github_links SET stale=true,generation=generation+1 WHERE installation_id=$1 AND NOT(repository_id=ANY($2::bigint[]))',
            [payload.installation!.id, removed],
          );
        } else if (repositoryEvents.has(event)) {
          const removed =
            event === 'repository' &&
            ['deleted', 'privatized', 'transferred'].includes(payload.action ?? '');
          await client.query(
            `UPDATE github_links SET stale=true,generation=generation+1,revoked=revoked OR $3,snapshot=CASE WHEN $3 THEN NULL ELSE snapshot END,synced_at=CASE WHEN $3 THEN NULL ELSE synced_at END WHERE installation_id=$1 AND repository_id=$2`,
            [payload.installation!.id, payload.repository!.id, removed],
          );
        }
        return false;
      });
      response.json({ accepted: true, duplicate, outcome });
    },
  );
  return router;
}
