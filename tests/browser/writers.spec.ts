import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});

test('P17 writers UI approves exact scopes, restores conflicts, resolves by keyboard and reviews the independently verified combination on mobile', async ({
  page,
}) => {
  test.setTimeout(150000);
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
    name: 'P17 browser writers',
    description: 'Isolated writers and explicit conflicts.',
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  for (const template of ['implementer', 'tester'])
    await post(`/projects/${project.id}/agents`, { template });
  const { task } = await post(`/projects/${project.id}/tasks`, {
    title: 'P17 browser conflict',
    description: 'Fix addition within the approved scopes.',
    priority: 'medium',
    status: 'todo',
    acceptanceCriteria: ['Combined tests pass.'],
  });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  const teams = page.getByRole('region', { name: 'Equipos y plantillas', exact: true });
  await teams.getByRole('button', { name: 'Usar Escritores e integración' }).press('Enter');
  const editor = teams.getByRole('form', { name: 'Editar plantilla de equipo' });
  await expect(editor.getByLabel('Estrategia del equipo')).toHaveValue('writers');
  await editor.getByLabel('Nombre del equipo').fill('P17 browser writers');
  const paths = editor.getByLabel('Rutas exactas del escritor (una por línea)');
  await paths.nth(0).fill('src/add.cjs');
  await paths.nth(1).fill('src/add.cjs');
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).press('Enter');
  await expect(editor).toHaveCount(0);
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Preparar plan' });
  await form.getByLabel('Tarea del plan').selectOption(task.id);
  await form.getByLabel('Plantilla del plan').selectOption({ label: 'P17 browser writers' });
  await expect(form.getByLabel('Modo del plan')).toBeDisabled();
  await expect(form.getByLabel('Modo del plan')).toHaveValue('team');
  await form.getByRole('button', { name: 'Preparar copia del plan' }).press('Enter');
  const plan = page.getByRole('region', { name: 'Detalle del plan' });
  await expect(plan.getByText('Rutas aprobadas: src/add.cjs', { exact: true })).toHaveCount(2);
  await plan.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
  await plan.getByRole('button', { name: 'Aprobar este plan' }).press('Enter');
  await plan.getByRole('checkbox', { name: /Confirmo la ejecución/ }).check();
  await plan.getByRole('button', { name: 'Ejecutar escritores' }).press('Enter');
  const run = page.getByRole('region', { name: 'Ejecución del equipo' });
  let integration = run.getByRole('region', { name: 'Integración de escritores' });
  await expect(
    integration.getByRole('heading', { name: 'Integración v1 · Conflictos pendientes' }),
  ).toBeVisible({ timeout: 50000 });
  await run.getByRole('link', { name: 'Abrir seguimiento del equipo' }).click();
  await page.reload();
  integration = run.getByRole('region', { name: 'Integración de escritores' });
  await expect(integration.getByLabel('Resolver src/add.cjs')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const resolve = integration.getByRole('button', { name: 'Guardar resolución y verificar' });
  await expect(resolve).toBeDisabled();
  await integration.getByLabel('Resolver src/add.cjs').selectOption('__base__');
  await expect(integration.getByLabel('Resolver src/add.cjs')).toHaveValue('__base__');
  await integration.getByLabel('Resolver src/add.cjs').selectOption('writer-one');
  await integration.getByRole('checkbox', { name: /Confirmo esta resolución/ }).check();
  await resolve.press('Enter');
  await expect(run.getByText('Equipo: Completado', { exact: true })).toBeVisible({
    timeout: 50000,
  });
  await expect(
    integration.getByRole('heading', { name: 'Integración v2 · Verificada' }),
  ).toBeVisible();
  await expect(run.getByText('Integración anterior v1', { exact: true })).toBeVisible();
  await integration
    .getByRole('link', { name: 'Verificación y revisión del resultado' })
    .press('Enter');
  const report = run.getByRole('region', { name: 'Ejecución de código' });
  await expect(report.getByRole('button', { name: 'Guardar revisión y borrador' })).toBeVisible();
  await expect(
    report.getByRole('button', { name: 'Publicar PR borrador en GitHub' }),
  ).toBeDisabled();
  await page.reload();
  await expect(report.getByText('src/add.cjs', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await integration.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/p17-writers-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
