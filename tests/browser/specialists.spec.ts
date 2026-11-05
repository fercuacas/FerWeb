import { test, expect } from '@playwright/test';
test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});
test('specialists UI explicitly configures parallelism, streams scoped messages and restores complete or missing results', async ({
  page,
}) => {
  test.setTimeout(120000);
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
    name: 'Especialistas P07',
    description: 'Solo lectura y mensajes autenticados.',
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  for (const template of ['explorer', 'reviewer', 'planner'])
    await post(`/projects/${project.id}/agents`, { template });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  const templates = page.getByRole('region', { name: 'Equipos y plantillas', exact: true });
  await templates.getByRole('button', { name: 'Usar Especialistas y resumen' }).press('Enter');
  const editor = templates.getByRole('form', { name: 'Editar plantilla de equipo' });
  await expect(editor.getByLabel('Estrategia del equipo')).toHaveValue('specialists');
  await editor.getByLabel('Concurrencia solicitada').selectOption('2');
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).click();
  await expect(editor).toHaveCount(0);
  const task = (
    await post(`/projects/${project.id}/tasks`, {
      title: 'P07 messaging browser',
      description: 'Inspeccionar fuentes sin modificarlas.',
      priority: 'medium',
      status: 'todo',
      acceptanceCriteria: ['Resultados independientes y resumen.'],
    })
  ).task;
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Preparar plan' });
  await form.getByLabel('Tarea del plan').selectOption(task.id);
  await form.getByLabel('Plantilla del plan').selectOption({ label: 'Especialistas y resumen' });
  await expect(form.getByLabel('Modo del plan')).toHaveValue('team');
  await expect(form.getByLabel('Modo del plan')).toBeDisabled();
  await expect(form.getByText(/Node · fuentes de solo lectura/)).toBeVisible();
  await form.getByRole('button', { name: 'Preparar copia del plan' }).click();
  const plan = page.getByRole('region', { name: 'Detalle del plan' });
  await plan.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
  await plan.getByRole('button', { name: 'Aprobar este plan' }).click();
  await expect(plan.getByRole('button', { name: 'Ejecutar especialistas' })).toBeDisabled();
  await expect(plan.getByText(/Configura la concurrencia solicitada/)).toBeVisible();
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  const policy = page.getByRole('region', { name: 'Concurrencia de especialistas' });
  await expect(
    policy.getByText('Configuración actual: 1 · Versión 1', { exact: true }),
  ).toBeVisible();
  await policy.getByLabel('Límite del proyecto').selectOption('2');
  const save = policy.getByRole('button', { name: 'Guardar concurrencia del proyecto' });
  await expect(save).toBeDisabled();
  await policy.getByRole('checkbox', { name: /Confirmo permitir dos especialistas/ }).check();
  await save.click();
  await expect(
    policy.getByText('Configuración actual: 2 · Versión 2', { exact: true }),
  ).toBeVisible();
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  await page.getByRole('button', { name: /^Ver plan/ }).click();
  await plan.getByRole('checkbox', { name: /Confirmo la ejecución/ }).check();
  await plan.getByRole('button', { name: 'Ejecutar especialistas' }).click();
  const run = page.getByRole('region', { name: 'Ejecución del equipo' });
  await expect(run.getByText('Equipo: Completado', { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(
    run
      .getByRole('region', { name: 'Resultados reunidos' })
      .getByText(/Recogida completa.*Ausentes: ninguno/),
  ).toBeVisible();
  const messages = run.getByRole('region', { name: 'Mensajes del equipo' });
  await expect(
    messages.getByText('P07 authenticated query: inspect the independent snapshot.', {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    messages.getByText('P07 independent response: source writes are rejected.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page
    .getByRole('region', { name: 'Equipos en segundo plano' })
    .getByRole('button', { name: /^Ver equipo/ })
    .click();
  await expect(
    messages.getByText('P07 authenticated query: inspect the independent snapshot.', {
      exact: true,
    }),
  ).toHaveCount(1);
  await run.getByRole('button', { name: 'Informe Codex · explore' }).click();
  const report = run.getByRole('region', { name: 'Ejecución de código' });
  await report.getByText('verify-readonly-snapshot · salida 0', { exact: true }).click();
  await expect(report.getByText('controller-readonly-verification', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const catalog = await (
    await page.request.get(`/api/projects/${project.id}/team-templates`)
  ).json();
  const failedTask = (
    await post(`/projects/${project.id}/tasks`, {
      title: 'P07 specialist failure browser',
      description: 'Fallo simulado de un especialista.',
      priority: 'medium',
      status: 'todo',
      acceptanceCriteria: ['Señalar resultados ausentes.'],
    })
  ).task;
  const prepared = await post(`/projects/${project.id}/team-plans`, {
    requestId: crypto.randomUUID(),
    taskId: failedTask.id,
    taskVersion: failedTask.version,
    templateId: catalog.templates[0].id,
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
  await plan.getByRole('button', { name: 'Ejecutar especialistas' }).click();
  await expect(run.getByText('Equipo: Fallido', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(
    run
      .getByRole('region', { name: 'Resultados reunidos' })
      .getByText(/Recogida incompleta.*Ausentes:.*audit/),
  ).toBeVisible();
  await expect(run.getByRole('button', { name: 'Informe Codex · summary' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
