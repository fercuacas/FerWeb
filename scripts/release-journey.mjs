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
const load = await loadTest({ url, origin, cookie, projectId });
await writeFile(
  '/app/test-results/release-journey.json',
  JSON.stringify(
    {
      browser: 'passed',
      authorization: 'passed',
      simulation: { jobId: job.id, idempotency: 'passed', state },
      load,
    },
    null,
    2,
  ),
);
console.log('PASS: compiled web journey, authorization, durable simulated job and bounded load.');
