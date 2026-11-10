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
  const { job: solo } = await post(`/projects/${project.id}/coding`, {
    requestId: crypto.randomUUID(),
    taskId: task.id,
    taskVersion: task.version,
    commit: 'a'.repeat(40),
    model: 'fixture-codex',
    maxRequests: 8,
    maxOutputTokens: 4096,
    timeoutMs: 120000,
  });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/projects/${project.id}/jobs/${solo.id}`);
        return (await response.json()).job.state;
      },
      { timeout: 40000 },
    )
    .toBe('completed');
  await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
  await page.getByText('Evaluar agente y equipo', { exact: true }).press('Enter');
  await page
    .getByRole('combobox', { name: 'Agente único', exact: true })
    .selectOption(solo.id, { timeout: 10000 });
  await page
    .getByRole('combobox', { name: 'Equipo', exact: true })
    .selectOption({ index: 1 }, { timeout: 10000 });
  await page
    .getByRole('combobox', { name: 'Caso de evaluación', exact: true })
    .selectOption('addition-v1', { timeout: 10000 });
  await page.getByRole('button', { name: 'Guardar comparación', exact: true }).press('Enter');
  const evaluation = page.getByRole('region', { name: 'Resultado de evaluación' });
  await expect(evaluation.getByText('Condiciones registradas equivalentes')).toBeVisible();
  await expect(evaluation.getByText(/Verificador independiente Aprobado/)).toHaveCount(2);
  await evaluation.getByLabel('Motivo de la valoración').fill('Dos entregas verificadas.');
  await evaluation.getByRole('button', { name: 'Guardar valoración' }).click();
  await expect(evaluation.getByText('Dos entregas verificadas.')).toBeVisible();
  await evaluation.getByRole('button', { name: 'Repetir verificación' }).click();
  await expect(evaluation.getByRole('status')).toHaveText(
    'La repetición coincide con la evidencia guardada.',
  );
  const download = page.waitForEvent('download');
  await evaluation.getByRole('link', { name: 'Exportar evaluación JSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/^ferweb-agent-evaluation-.+\.json$/);
  await evaluation.getByText('Proponer lección de la corrección', { exact: true }).press('Enter');
  await evaluation.getByLabel('Título de la lección').fill('Comprobar operandos negativos');
  await evaluation.getByLabel('Fallo observado').fill('La versión inicial restaba.');
  await evaluation.getByLabel('Corrección propuesta').fill('Probar la suma con signos distintos.');
  await evaluation.getByRole('button', { name: 'Guardar propuesta' }).click();
  await expect(evaluation.getByText('Propuesta guardada.', { exact: false })).toBeVisible();
  await page.getByText('Lecciones y cumplimiento', { exact: true }).press('Enter');
  await page
    .getByRole('combobox', { name: 'Propuesta de lección', exact: true })
    .selectOption({ index: 1 });
  await expect(page.getByRole('heading', { name: 'Comprobar operandos negativos' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar revisión' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Adoptar en memoria' })).toBeDisabled();
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
