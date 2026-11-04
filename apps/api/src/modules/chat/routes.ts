import express from 'express';
import { z } from 'zod';
import { conversationInput, turnInput, aiProviderSchema } from '@ferweb/contracts';
import { readToken, tokenHash } from '../identity/sessions.js';
import { ChatService } from './service.js';
export function createChatRouter(service: ChatService) {
  const router = express.Router();
  const owner = (res: express.Response) => (res.locals.user as { id: string }).id;
  const ids = (req: express.Request) => ({
    project: z.uuid().parse(req.params.projectId),
    conversation: z.uuid().parse(req.params.conversationId),
  });
  router.get('/projects/:projectId/ai/models', async (req, res) => {
    res.json(
      await service.catalog(
        owner(res),
        z.uuid().parse(req.params.projectId),
        aiProviderSchema.parse(req.query.provider),
      ),
    );
  });
  router.get('/projects/:projectId/conversations', async (req, res) => {
    res.json(await service.list(owner(res), z.uuid().parse(req.params.projectId)));
  });
  router.post('/projects/:projectId/conversations', async (req, res) => {
    res
      .status(201)
      .json(
        await service.create(
          owner(res),
          z.uuid().parse(req.params.projectId),
          conversationInput.parse(req.body),
        ),
      );
  });
  router.get('/projects/:projectId/conversations/:conversationId', async (req, res) => {
    const id = ids(req);
    res.json(await service.detail(owner(res), id.project, id.conversation));
  });
  router.post(
    '/projects/:projectId/conversations/:conversationId/turns/:turnId/cancel',
    async (req, res) => {
      const id = ids(req);
      res.json(
        await service.cancel(
          owner(res),
          id.project,
          id.conversation,
          z.uuid().parse(req.params.turnId),
        ),
      );
    },
  );
  router.post('/projects/:projectId/conversations/:conversationId/turns', async (req, res) => {
    const id = ids(req),
      user = owner(res);
    const initial = await service.begin(
      user,
      id.project,
      id.conversation,
      turnInput.parse(req.body),
    );
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const emit = (value: unknown) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`);
    };
    const disconnected = () => {
      if (!res.writableEnded)
        void service.cancel(user, id.project, id.conversation, initial.turn.id).catch(() => {});
    };
    res.on('close', disconnected);
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': heartbeat\n\n');
    }, 5000).unref();
    try {
      emit({ type: 'started', turn: initial.turn });
      const result = await service.generate(
        user,
        id.project,
        initial,
        tokenHash(readToken(req) ?? ''),
        (text) => emit({ type: 'delta', text }),
        () => res.destroyed,
      );
      emit({ type: 'done', turn: result });
    } catch {
      emit({
        type: 'error',
        code: 'generation_persistence',
        message:
          'No se ha podido confirmar el guardado. Actualiza la conversación para comprobar su estado.',
      });
    } finally {
      clearInterval(heartbeat);
      res.off('close', disconnected);
      res.end();
    }
  });
  return router;
}
