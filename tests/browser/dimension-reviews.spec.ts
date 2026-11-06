import { test, expect } from '@playwright/test';
test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});
test('dimensional review UI freezes a diff, preserves duplicates and evidence, reloads and keeps human publication separate', async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const headers = { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post('/api' + path, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.status() === 204 ? null : r.json();
  };
  const auth = await post('/github/authorize', {});
  await page.goto(
    '/api/github/callback?state=' +
      new URL(auth.url).searchParams.get('state') +
      '&code=fixture-code',
  );
  await post('/github/installations', { installationId: 71 });
  const { project } = await post('/projects', {
    name: 'Revisión P08',
    description: 'Diff y evidencia congelados.',
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  for (const template of ['reviewer', 'explorer', 'security', 'tester'])
    await post(`/projects/${project.id}/agents`, { template });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Usar Revisión por dimensiones', exact: true })
    .press('Enter');
  const editor = page.getByRole('form', { name: 'Editar plantilla de equipo' });
  await expect(editor.getByLabel('Máximo de iteraciones')).toHaveValue('1');
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).click();
  await expect(editor).toHaveCount(0);
  const { task } = await post(`/projects/${project.id}/tasks`, {
    title: 'P08 browser review',
    description: 'Corregir la suma y revisar el diff sin modificar criterios.',
    priority: 'high',
    status: 'todo',
    acceptanceCriteria: ['Suma correcta y evidencia trazable.'],
  });
  const { job } = await post(`/projects/${project.id}/coding`, {
    requestId: crypto.randomUUID(),
    taskId: task.id,
    taskVersion: task.version,
    commit: 'a'.repeat(40),
    model: 'fixture-codex',
    maxRequests: 2,
    maxOutputTokens: 1024,
    timeoutMs: 60000,
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}/jobs/${job.id}`)).json()).job
          .state,
      { timeout: 45000 },
    )
    .toBe('completed');
  await page.goto(`/#/projects/${project.id}`);
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Trabajos del proyecto' })
    .getByRole('button', { name: /P08 browser review/ })
    .last()
    .click();
  const panel = page.getByRole('region', { name: 'Revisión por dimensiones', exact: true });
  const human = page.getByRole('checkbox', {
    name: 'He revisado el diff, los resultados de pruebas y los criterios de aceptación.',
  });
  await expect(human).not.toBeChecked();
  await panel
    .getByLabel('Plantilla de revisores')
    .selectOption({ label: 'Revisión por dimensiones · v1' });
  await panel.getByRole('button', { name: 'Preparar revisión del diff' }).click();
  const plan = panel.getByRole('region', { name: 'Detalle del plan' });
  await plan.getByText('Diff congelado de la revisión', { exact: true }).click();
  await expect(plan.getByText(/Ejecución:.*Diff:.*Artefacto:/)).toBeVisible();
  await plan.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
  await plan.getByRole('button', { name: 'Aprobar este plan' }).click();
  await plan.getByRole('checkbox', { name: /Confirmo la ejecución/ }).check();
  await plan.getByRole('button', { name: 'Ejecutar especialistas' }).click();
  await expect(human).toBeDisabled();
  await expect(panel.getByRole('heading', { name: 'Revisión Completa · ronda 1/1' })).toBeVisible({
    timeout: 60000,
  });
  const finding = panel.getByRole('region', { name: 'Hallazgo de revisión' });
  await expect(finding).toHaveCount(1);
  await expect(
    finding.getByText(/Verificación: Refutado.*Prueba independiente del controlador/),
  ).toBeVisible();
  await expect(finding.getByText(/Discrepancias conservadas:.*severity.*impact/)).toBeVisible();
  await finding.getByText('Procedencia: 2 aportaciones', { exact: true }).click();
  await expect(finding.getByText(/Duplicate with a different title/)).toBeVisible();
  await expect(human).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Publicar PR borrador en GitHub' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Trabajos del proyecto' })
    .getByRole('button', { name: /P08 browser review/ })
    .last()
    .click();
  await expect(panel.getByRole('heading', { name: 'Revisión Completa · ronda 1/1' })).toBeVisible();
  await expect(panel.getByText(/Verificación: Refutado/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
  const route = `**/api/projects/${project.id}/coding/${job.id}/review`;
  await page.route(route, (r) =>
    r.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'denied', message: 'Revisión retirada de prueba.' } }),
    }),
  );
  await expect(page.getByText('Revisión retirada de prueba.', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(panel).toHaveCount(0);
  await page.unroute(route);
  expect(errors).toEqual([]);
});
