import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});
test('P19 native local specialists: configure per role, approve immutable plan, inspect structure-only delivery on mobile', async ({
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
    name: 'P19 browser local specialists',
    description: 'Native Ollama, bounded excerpts and deterministic checks',
  });
  const root = `/projects/${project.id}`;
  await post(root + '/github', { installationId: 71, repositoryId: 101, version: 0 });
  await post(root + '/github/sync', { version: 1 });
  const { task } = await post(root + '/tasks', {
    title: 'P19 browser local analysis',
    description: 'Plan and review without changing files.',
    priority: 'medium',
    status: 'todo',
    acceptanceCriteria: [],
  });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  const setup = page.getByRole('region', { name: 'Especialistas locales', exact: true });
  await setup.getByRole('button', { name: 'Crear workflow local de lectura' }).press('Enter');
  await expect(setup.getByRole('button', { name: 'Workflow local creado' })).toBeDisabled();
  const templates = await (await page.request.get('/api' + root + '/team-templates')).json();
  const template = templates.templates.find(
    (t: any) => t.latest.definition.inferenceMode === 'local-only',
  );
  expect(template).toBeTruthy();
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Preparar plan' });
  await form.getByRole('combobox', { name: 'Tarea del plan', exact: true }).selectOption(task.id);
  await form
    .getByRole('combobox', { name: 'Plantilla del plan', exact: true })
    .selectOption(template.id);
  await expect(form.getByLabel('Modelo local: Planificar')).toHaveValue('fixture-chat');
  await expect(form.getByLabel('Modelo local: Revisar')).toHaveValue('fixture-chat');
  await expect(form.getByLabel('Modelo local: Reunir entregas')).toHaveValue('fixture-chat');
  await form.getByRole('button', { name: 'Preparar copia del plan' }).press('Enter');
  const plan = page.getByRole('region', { name: 'Detalle del plan', exact: true });
  await expect(plan.getByRole('region', { name: 'Inferencia local del plan' })).toContainText(
    'fixture-revision',
  );
  await plan.getByRole('checkbox', { name: /He revisado/ }).check();
  await plan.getByRole('button', { name: /Aprobar/ }).press('Enter');
  const source = await (await page.request.get('/api' + root + '/github')).json();
  const plans = await (await page.request.get('/api' + root + '/team-plans')).json();
  const selected = plans.plans.find((p: any) => p.taskId === task.id);
  const executed = await post(root + `/team-plans/${selected.id}/execute`, {
    requestId: crypto.randomUUID(),
    hash: selected.hash,
    version: 1,
    commit: source.link.snapshot.commit,
  });
  await page.goto(`/#/projects/${project.id}/teams/${executed.execution.id}`);
  await expect(
    page.getByText('Entrega local simulada; 2 entregas previas.', { exact: false }).first(),
  ).toBeVisible({ timeout: 45000 });
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get('/api' + root + `/team-executions/${executed.execution.id}`)
          ).json()
        ).execution.state,
      { timeout: 45000 },
    )
    .toBe('completed');
  const data = await (
    await page.request.get('/api' + root + `/team-executions/${executed.execution.id}`)
  ).json();
  expect(data.execution.state).toBe('completed');
  await page.goto(`/#/projects/${project.id}/jobs/${data.steps[0].jobId}`);
  const report = page.getByRole('region', { name: 'Informe del especialista local' });
  await expect(report).toContainText('Proveedor simulado');
  await expect(report).toContainText('No se ejecutaron comandos ni pruebas');
  await expect(report).toContainText('Coste: Desconocido');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(report).toContainText('fixture-revision');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/p19-local-specialists-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await post('/github/disconnect', {});
  await page.reload();
  await expect(report.getByRole('alert')).toBeVisible();
  await expect(
    report.getByText('Entrega local simulada; 0 entregas previas.', { exact: false }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
