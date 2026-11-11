import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});

test('P15 task recipes preview, confirm, run and reopen scoped reports on mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
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
    name: 'Recetas P15',
    description: 'Prueba de recetas por tarea.',
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  await post(`/projects/${project.id}/tasks`, {
    title: 'P15 browser addition',
    description: 'Corregir la suma.',
    priority: 'medium',
    status: 'todo',
    acceptanceCriteria: ['Suma correcta.'],
  });
  const projectUrl = `/#/projects/${project.id}`;
  await page.setViewportSize({ width: 390, height: 844 });
  const open = async () => {
    await page.goto(projectUrl);
    await page.getByRole('button', { name: /P15 browser addition/ }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Detalle de tarea' });
    await dialog.getByText('Recetas de la tarea', { exact: true }).press('Enter');
    return dialog;
  };
  let dialog = await open();
  await dialog.getByRole('combobox', { name: 'Elegir receta' }).selectOption('investigate');
  await dialog.getByLabel('Rutas de referencia (opcional)').fill('src/add.cjs');
  const prepare = dialog.getByRole('button', { name: 'Preparar receta' });
  await expect(prepare).toBeEnabled();
  await prepare.press('Enter');
  const plan = dialog.getByRole('region', { name: 'Plan de receta guardado' });
  await expect(plan.getByText(/Solo lectura/)).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Ejecutar receta' })).toBeDisabled();
  await plan.getByRole('checkbox').check();
  await plan.getByRole('button', { name: 'Ejecutar receta' }).press('Enter');
  await plan.getByRole('link', { name: 'Ver ejecución de la receta' }).click();
  const report = page.getByRole('region', { name: 'Ejecución de código' });
  await expect(report.getByRole('status').first()).toContainText('Completado', { timeout: 25000 });
  await expect(report.getByText(/Investigación terminada/)).toBeVisible();
  dialog = await open();
  await dialog
    .getByRole('combobox', { name: 'Planes de receta guardados' })
    .selectOption({ index: 1 });
  await expect(dialog.getByRole('link', { name: 'Ver ejecución de la receta' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Elegir receta' }).selectOption('fix');
  await dialog.getByLabel('Rutas editables').fill('src/add.cjs');
  await dialog.getByRole('button', { name: 'Preparar receta' }).click();
  await expect(plan.getByRole('heading', { name: 'Corregir defecto · v1' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await plan.getByRole('checkbox').check();
  await plan.getByRole('button', { name: 'Ejecutar receta' }).click();
  await plan.getByRole('link', { name: 'Ver ejecución de la receta' }).click();
  await expect(report.getByRole('status').first()).toContainText('Completado', { timeout: 25000 });
  await expect(report.getByText('src/add.cjs', { exact: true })).toBeVisible();
  await page.reload();
  await expect(report.getByRole('status').first()).toContainText('Completado');
});
