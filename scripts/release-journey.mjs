import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadTest } from './load-test.mjs';

const url = process.env.FERWEB_URL ?? 'http://web:5173';
const origin = process.env.FERWEB_TEST_ORIGIN ?? url;
async function request(path, method = 'GET', body, cookie) {
  return fetch(url + '/api' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-FerWeb-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
}
async function login(email) {
  const response = await request('/auth/login', 'POST', {
    email,
    password: process.env.FERWEB_TEST_PASSWORD,
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const cookie = await login('release@ferweb.test');
const existing = await (await request('/projects', 'GET', undefined, cookie)).json();
if (process.env.FERWEB_VERIFY_RESTORE === 'true') {
  assert.ok(existing.projects.some((project) => project.name === 'Release journey'));
  const project = existing.projects.find((project) => project.name === 'Release journey');
  const tasks = await (
    await request(`/projects/${project.id}/tasks`, 'GET', undefined, cookie)
  ).json();
  assert.ok(tasks.tasks.some((task) => task.title === 'Release task' && task.status === 'done'));
  console.log('PASS: restored owner login, project and completed task through release proxy.');
  process.exit(0);
}
assert.equal(existing.projects.length, 0, 'Acceptance must start from an empty application');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel('Correo electrónico').fill('release@ferweb.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Release journey');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Release journey/ }).click();
  await page.getByRole('button', { name: /Nueva tarea/ }).click();
  await page.getByLabel('Título de la tarea').fill('Release task');
  await page
    .getByLabel('Descripción de la tarea')
    .fill('Verified against compiled production images');
  await page
    .getByLabel('Criterios de aceptación')
    .fill('Survives restore\nOwner authorization enforced');
  await page.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await page.getByRole('button', { name: /Release task/ }).click();
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('done');
  await page.getByRole('button', { name: 'Guardar tarea', exact: true }).click();
  await page.reload();
  await page
    .getByRole('region', { name: 'Hecho', exact: true })
    .getByRole('button', { name: /Release task/ })
    .waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
const projects = await (await request('/projects', 'GET', undefined, cookie)).json();
const projectId = projects.projects[0].id;
const stranger = await login('other@ferweb.test');
assert.equal((await request(`/projects/${projectId}`, 'GET', undefined, stranger)).status, 404);
assert.equal(
  (await request(`/projects/${projectId}`, 'PATCH', { name: 'Stolen', version: 1 }, stranger))
    .status,
  404,
);
assert.equal((await fetch(`${url}/internal/metrics`)).status, 404);
assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404);
const requestId = randomUUID();
const input = {
  requestId,
  title: 'Release simulation',
  simulation: {
    steps: 3,
    stepDelayMs: 50,
    unitsPerStep: 1,
    costMicrosPerStep: 0,
    failure: 'none',
    failureStep: 1,
    failuresBeforeSuccess: 0,
    ignoreTermination: false,
  },
  limits: { timeoutMs: 10000, maxAttempts: 1, budgetUnits: 20, budgetMicros: 0 },
};
const jobResponse = await request(`/projects/${projectId}/jobs`, 'POST', input, cookie);
assert.equal(jobResponse.status, 202);
const { job } = await jobResponse.json();
assert.equal(jobResponse.headers.get('x-ferweb-job'), job.id);
const duplicate = await (
  await request(`/projects/${projectId}/jobs`, 'POST', input, cookie)
).json();
assert.equal(duplicate.job.id, job.id);
let state;
for (let attempt = 0; attempt < 50; attempt++) {
  const detail = await (
    await request(`/projects/${projectId}/jobs/${job.id}`, 'GET', undefined, cookie)
  ).json();
  state = detail.job.state;
  if (state === 'completed') break;
  await delay(200);
}
assert.equal(state, 'completed');

async function queueLoad() {
  const another = await request(
    '/projects',
    'POST',
    { name: 'Release queue load', description: '' },
    cookie,
  );
  assert.equal(another.status, 201);
  const { project: second } = await another.json();
  async function enqueue(project, title, steps, wait) {
    const response = await request(
      `/projects/${project}/jobs`,
      'POST',
      {
        ...input,
        requestId: randomUUID(),
        title,
        simulation: { ...input.simulation, steps, stepDelayMs: wait },
        limits: { ...input.limits, timeoutMs: 20000 },
      },
      cookie,
    );
    assert.equal(response.status, 202);
    return { project, job: (await response.json()).job.id };
  }
  async function detail(target) {
    const response = await request(
      `/projects/${target.project}/jobs/${target.job}`,
      'GET',
      undefined,
      cookie,
    );
    assert.equal(response.status, 200);
    return response.json();
  }
  async function observe(target, predicate) {
    for (let retry = 0; retry < 80; retry++) {
      const result = await detail(target);
      if (predicate(result)) return result;
      await delay(100);
    }
    assert.fail('Bounded load job did not reach its expected state.');
  }
  async function stop(target) {
    const response = await request(
      `/projects/${target.project}/jobs/${target.job}/cancel`,
      'POST',
      {},
      cookie,
    );
    assert.equal(response.status, 200);
    return observe(target, ({ job }) => job.state === 'cancelled');
  }
  const first = await enqueue(projectId, 'Release load running', 12, 750);
  await observe(first, ({ job, attempts }) => job.state === 'running' && attempts[0]?.processPid);
  const [waiting, parallel] = await Promise.all([
    enqueue(projectId, 'Release load waiting', 3, 50),
    enqueue(second.id, 'Release load concurrent', 5, 180),
  ]);
  assert.equal((await detail(waiting)).job.state, 'pending');
  const cancelledPending = await stop(waiting);
  assert.equal(cancelledPending.attempts.length, 0);
  await observe(parallel, ({ attempts }) => attempts[0]?.processPid);
  const cancelledActive = await stop(first);
  assert.equal(cancelledActive.attempts[0].terminationConfirmed, true);
  const completed = await observe(parallel, ({ job }) => job.state === 'completed');
  assert.equal(completed.attempts[0].terminationConfirmed, true);
  const a = cancelledActive.attempts[0];
  const b = completed.attempts[0];
  assert.ok(
    Math.max(Date.parse(a.startedAt), Date.parse(b.startedAt)) <
      Math.min(Date.parse(a.finishedAt), Date.parse(b.finishedAt)),
  );
  return {
    enqueued: 3,
    cancelledPending: 1,
    cancelledActive: 1,
    completed: 1,
    concurrentOverlap: true,
  };
}
const [load, queue] = await Promise.all([
  loadTest({ url, origin, cookie, projectId }),
  queueLoad(),
]);
await writeFile(
  '/app/test-results/release-journey.json',
  JSON.stringify(
    {
      browser: 'passed',
      authorization: 'passed',
      simulation: { jobId: job.id, idempotency: 'passed', state },
      load,
      queue,
    },
    null,
    2,
  ),
);
console.log('PASS: compiled web journey, authorization, durable simulated job and bounded load.');
