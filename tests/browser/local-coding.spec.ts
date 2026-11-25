import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});

test('P20 local coding: select native inference, execute sandbox tools, review evidence and retain local repeat on mobile', async ({
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
    expect(response.ok(), await response.text()).toBeTruthy();
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
    name: 'P20 browser local coding',
    description: 'Native inference and independently verified changes.',
  });
  const root = `/projects/${project.id}`;
  await post(root + '/github', { installationId: 71, repositoryId: 101, version: 0 });
  await post(root + '/github/sync', { version: 1 });
  const { task } = await post(root + '/tasks', {
    title: 'P20 browser fix addition',
    description: 'Fix the addition defect and preserve tests.',
    priority: 'high',
    status: 'todo',
    acceptanceCriteria: ['Correct addition and passing independent tests.'],
  });
  await page.goto('/#/projects/' + project.id);
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Nueva tarea con Codex', { exact: true }).click();
  const destination = page.getByRole('combobox', { name: 'Destino de inferencia Codex' });
  await destination.selectOption('codex-local-v1');
  await expect(page.getByText(/Requiere Ollama 0.13.4/)).toBeVisible();
  const model = page.getByRole('combobox', { name: 'Modelo Codex', exact: true });
  await expect(model.locator('option[value="fixture-local"]')).toHaveCount(1);
  await expect(model.locator('option[value="fixture-codex"]')).toHaveCount(0);
  await model.selectOption('fixture-local');
  await page
    .getByRole('combobox', { name: 'Tarea de programación', exact: true })
    .selectOption(task.id);
  await page.getByRole('button', { name: 'Ejecutar tarea con Codex', exact: true }).press('Enter');
  const report = page.getByRole('region', { name: 'Ejecución de código', exact: true });
  await expect(report.getByText('Estado: Completado', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(report.getByText(/Ollama local · sin fallback externo/)).toBeVisible();
  await expect(
    report.getByText(/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/),
  ).toBeVisible();
  await expect(report.getByText('Snapshot final recogido.', { exact: true })).toBeVisible();
  await report.getByText('src/add.cjs', { exact: true }).click();
  await expect(report.locator('pre').filter({ hasText: 'diff --git' })).toContainText(
    '+exports.add = (a, b) => a + b;',
  );
  await report.getByText('Controles de ejecución', { exact: true }).press('Enter');
  await expect(report.getByText('Verificación del perfil · Superado')).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Modelo para repetir las mismas condiciones' }),
  ).toHaveValue('fixture-local');
  await page.getByLabel('Título de la PR', { exact: true }).fill('P20 suma local revisada');
  await page
    .getByLabel('Descripción de la PR', { exact: true })
    .fill('Cambio y pruebas independientes revisados.');
  await page
    .getByLabel('Valoración humana y limitaciones')
    .fill('Proveedor simulado; sin aceptación de un modelo real.');
  await page
    .getByLabel('He revisado el diff, los resultados de pruebas y los criterios de aceptación.')
    .check();
  await page.getByRole('button', { name: 'Guardar revisión y borrador' }).click();
  await expect(page.getByText(/Revisión guardada · versión 1/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Abrir PR #/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/p20-local-coding-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await post('/github/disconnect', {});
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByRole('button', { name: /P20 browser fix addition.*Completado/ }).click();
  await expect(report.getByRole('alert').first()).toBeVisible();
  await expect(
    report.getByRole('heading', { name: 'Resumen del trabajo', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
