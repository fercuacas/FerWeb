import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});
test('sequential team UI executes approved task, restores deliveries and reports after reload and cancels its active child', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const headers = { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok()).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  };
  const auth = await post('/github/authorize', {});
  await page.goto(
    '/api/github/callback?state=' +
      new URL(auth.url).searchParams.get('state') +
      '&code=fixture-code',
  );
  await post('/github/installations', { installationId: 71 });
  const { project } = await post('/projects', {
    name: 'Equipo secuencial P06',
    description: 'Ejecución de equipo con proveedor simulado.',
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  const implementer = await post(`/projects/${project.id}/agents`, { template: 'implementer' });
  const reviewer = await post(`/projects/${project.id}/agents`, { template: 'reviewer' });
  const { template } = await post(`/projects/${project.id}/team-templates`, {
    definition: {
      name: 'Implementar y revisar P06',
      description: 'Entrega secuencial.',
      maxIterations: 1,
      limits: { maxRequests: 8, timeoutMs: 120000, concurrency: 1 },
      steps: [
        {
          key: 'implement',
          title: 'Implementar',
          role: { id: implementer.role.id, version: 1 },
          dependsOn: [],
          exitCriteria: ['Cambio verificado.'],
          requiredCapabilities: ['text', 'toolCalls', 'workspaceWrite'],
          maxRequests: 4,
        },
        {
          key: 'review',
          title: 'Revisar',
          role: { id: reviewer.role.id, version: 1 },
          dependsOn: ['implement'],
          exitCriteria: ['Revisar la entrega real.'],
          requiredCapabilities: ['text', 'toolCalls'],
          maxRequests: 2,
        },
      ],
    },
  });
  const createTask = async (title: string) =>
    (
      await post(`/projects/${project.id}/tasks`, {
        title,
        description: 'Corregir la suma y revisar las pruebas.',
        priority: 'medium',
        status: 'todo',
        acceptanceCriteria: ['Suma correcta.'],
      })
    ).task;
  const task = await createTask('P06 browser team');
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Preparar plan' });
  await form.getByLabel('Tarea del plan').selectOption(task.id);
  await form.getByLabel('Plantilla del plan').selectOption(template.id);
  await form.getByLabel('Modo del plan').selectOption('team');
  await form.getByRole('button', { name: 'Preparar copia del plan' }).click();
  const plan = page.getByRole('region', { name: 'Detalle del plan' });
  await plan.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
  await plan.getByRole('button', { name: 'Aprobar este plan' }).click();
  const launch = plan.getByRole('button', { name: 'Ejecutar equipo secuencial' });
  await expect(launch).toBeDisabled();
  await plan.getByRole('checkbox', { name: /Confirmo la ejecución/ }).check();
  await launch.press('Enter');
  const run = page.getByRole('region', { name: 'Ejecución del equipo' });
  await expect(run.getByText('Equipo: Completado', { exact: true })).toBeVisible({
    timeout: 40000,
  });
  await expect(run.getByRole('button', { name: 'Informe Codex · review' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  const teams = page.getByRole('region', { name: 'Equipos en segundo plano' });
  await teams.getByRole('button', { name: /^Ver equipo/ }).click();
  await expect(run.getByText('Equipo: Completado', { exact: true })).toBeVisible();
  await run.getByText('Entrega de implement', { exact: true }).click();
  await expect(
    run
      .locator('details')
      .filter({ has: page.getByText('Entrega de implement', { exact: true }) })
      .getByText('Controlador: pruebas y recogida confirmadas.', { exact: true }),
  ).toBeVisible();
  await run.getByRole('button', { name: 'Informe Codex · review' }).click();
  await run
    .getByRole('region', { name: 'Ejecución de código' })
    .getByText('node --test · salida 0', { exact: true })
    .click();
  await expect(
    run
      .getByRole('region', { name: 'Ejecución de código' })
      .getByText('controller-verification', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const cancellationTask = await createTask('P06 cancel browser team');
  const prepared = await post(`/projects/${project.id}/team-plans`, {
    requestId: crypto.randomUUID(),
    taskId: cancellationTask.id,
    taskVersion: cancellationTask.version,
    templateId: template.id,
    templateVersion: 1,
    mode: 'team',
    executionId: 'codex-v1',
    model: 'fixture-codex',
  });
  await post(`/projects/${project.id}/team-plans/${prepared.plan.id}/approve`, {
    hash: prepared.plan.hash,
    version: 1,
  });
  await page.reload();
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  await page
    .getByRole('button', { name: `Ver plan · ${prepared.plan.hash.slice(0, 12)}`, exact: true })
    .click();
  await plan.getByRole('checkbox', { name: /Confirmo la ejecución/ }).check();
  await launch.click();
  await expect(run.getByRole('button', { name: 'Informe Codex · implement' })).toBeVisible({
    timeout: 15000,
  });
  await run.getByRole('button', { name: 'Cancelar equipo' }).click();
  await expect(run.getByText('Equipo: Cancelado', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(run.getByText('Revisar · Omitido', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
