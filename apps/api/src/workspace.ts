import express from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  executionCatalogSchema,
  loginInputSchema,
  projectInputSchema,
  projectPatchSchema,
  taskInputSchema,
  taskPatchSchema,
  taskFilterSchema,
  type User,
} from '@ferweb/contracts';
import { HttpError } from './http-error.js';
import { currentUser, signIn, signOut } from './modules/identity/sessions.js';
import { ProjectRepository } from './modules/projects/repository.js';
import { GitHubService } from './modules/github/service.js';
import { createGitHubRouter } from './modules/github/routes.js';
import { ChatService } from './modules/chat/service.js';
import { createChatRouter } from './modules/chat/routes.js';
import { RetrievalService } from './modules/retrieval/service.js';
import { createRetrievalRouter } from './modules/retrieval/routes.js';
import { LaboratoryService } from './modules/laboratory/service.js';
import { createLaboratoryRouter } from './modules/laboratory/routes.js';
import { JobService } from './modules/jobs/service.js';
import { createJobRouter } from './modules/jobs/routes.js';
import { CodingService } from './modules/jobs/coding-service.js';
import { codingRouter } from './modules/jobs/coding-routes.js';
import { RunnerClient } from './modules/jobs/runner-client.js';
import { describeChat, describeCoding } from './execution-capabilities.js';
import { AgentCatalog } from './modules/agents/catalog.js';
import { agentRouter } from './modules/agents/routes.js';
import { SkillLibrary } from './modules/skills/library.js';
import { skillRouter } from './modules/skills/routes.js';
import { TeamService } from './modules/teams/service.js';
import { teamRouter } from './modules/teams/routes.js';
import { TeamExecutions } from './modules/teams/executions.js';

export interface WorkspaceOptions {
  pool: Pool;
  appOrigin: string;
  secureCookies: boolean;
  github?: GitHubService;
  chats?: ChatService;
  retrieval?: RetrievalService;
  laboratory?: LaboratoryService;
  coding?: CodingService;
  runnerToken?: string;
}
function uuid(value: unknown) {
  return z.uuid().parse(value);
}

export function createWorkspaceRouter({
  pool,
  appOrigin,
  secureCookies,
  github,
  chats,
  retrieval,
  laboratory,
  coding,
}: WorkspaceOptions) {
  const router = express.Router();
  const projects = new ProjectRepository(pool);
  router.use((request, _response, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.get('Origin') !== appOrigin ||
        request.get('X-FerWeb-Request') !== '1' ||
        request.get('Sec-Fetch-Site') === 'cross-site'
      )
        throw new HttpError(403, 'origin_rejected', 'La solicitud no procede de esta aplicación.');
      if (!request.is('application/json'))
        throw new HttpError(415, 'json_required', 'Envía la solicitud como JSON.');
    }
    next();
  });
  router.use(express.json({ limit: '96kb' }));
  router.get('/auth/session', async (request, response) => {
    response.json({ user: await currentUser(pool, request) });
  });
  router.post('/auth/login', async (request, response) => {
    const user = await signIn(
      pool,
      request,
      response,
      loginInputSchema.parse(request.body),
      secureCookies,
    );
    response.json({ user });
  });
  router.post('/auth/logout', async (request, response) => {
    await signOut(pool, request, response, secureCookies);
    response.status(204).end();
  });
  router.use(async (request, response, next) => {
    const user = await currentUser(pool, request);
    if (!user)
      throw new HttpError(401, 'unauthenticated', 'Tu sesión ha terminado. Vuelve a entrar.');
    response.locals.user = user;
    next();
  });
  const owner = (response: express.Response) => (response.locals.user as User).id;
  const githubService = github ?? new GitHubService(pool, null);
  const chatService = chats ?? new ChatService(pool, null);
  const codingService = coding ?? new CodingService(pool, githubService, new RunnerClient('', ''));
  router.get('/execution/capabilities', async (_request, response) => {
    const [runner, openai, ollama] = await Promise.all([
      codingService.runner.capabilities(),
      describeChat(chatService, 'openai'),
      describeChat(chatService, 'ollama'),
    ]);
    response.json(
      executionCatalogSchema.parse({ options: [describeCoding(runner), openai, ollama] }),
    );
  });
  router.use(createGitHubRouter(githubService));
  router.use(createChatRouter(chatService));
  if (retrieval) router.use(createRetrievalRouter(retrieval));
  if (laboratory) router.use(createLaboratoryRouter(laboratory));
  router.use(createJobRouter(new JobService(pool)));
  router.use(agentRouter(new AgentCatalog(pool)));
  router.use(skillRouter(new SkillLibrary(pool)));
  router.use(
    teamRouter(new TeamService(pool, codingService), new TeamExecutions(pool, codingService)),
  );
  router.use(codingRouter(codingService));
  router.get('/projects', async (_request, response) => {
    response.json({ projects: await projects.list(owner(response)) });
  });
  router.post('/projects', async (request, response) => {
    response.status(201).json({
      project: await projects.create(owner(response), projectInputSchema.parse(request.body)),
    });
  });
  router.get('/projects/:projectId', async (request, response) => {
    response.json({ project: await projects.get(owner(response), uuid(request.params.projectId)) });
  });
  router.patch('/projects/:projectId', async (request, response) => {
    response.json({
      project: await projects.update(
        owner(response),
        uuid(request.params.projectId),
        projectPatchSchema.parse(request.body),
      ),
    });
  });
  router.get('/projects/:projectId/tasks', async (request, response) => {
    response.json({
      tasks: await projects.listTasks(
        owner(response),
        uuid(request.params.projectId),
        taskFilterSchema.parse(request.query),
      ),
    });
  });
  router.post('/projects/:projectId/tasks', async (request, response) => {
    response.status(201).json({
      task: await projects.saveTask(
        owner(response),
        uuid(request.params.projectId),
        taskInputSchema.parse(request.body),
      ),
    });
  });
  router.get('/projects/:projectId/tasks/:taskId', async (request, response) => {
    response.json({
      task: await projects.getTask(
        owner(response),
        uuid(request.params.projectId),
        uuid(request.params.taskId),
      ),
    });
  });
  router.patch('/projects/:projectId/tasks/:taskId', async (request, response) => {
    response.json({
      task: await projects.saveTask(
        owner(response),
        uuid(request.params.projectId),
        taskPatchSchema.parse(request.body),
        uuid(request.params.taskId),
      ),
    });
  });
  return router;
}
