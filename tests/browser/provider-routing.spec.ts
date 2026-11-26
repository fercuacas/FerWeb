import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { providerComparison } from '@ferweb/contracts';

test('P21 previews and approves mixed transfers then compares and exports recorded API and local runs', async ({
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
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  };
  try {
    const auth = await post('/github/authorize', {});
    await page.goto(
      '/api/github/callback?state=' +
        new URL(auth.url).searchParams.get('state') +
        '&code=fixture-code',
    );
    await post('/github/installations', { installationId: 71 });
    const { project } = await post('/projects', {
      name: 'P21 routing and comparison',
      description: 'API and local evidence.',
    });
    const root = `/projects/${project.id}`;
    await post(root + '/github', { installationId: 71, repositoryId: 101, version: 0 });
    await post(root + '/github/sync', { version: 1 });
    const { role: implement } = await post(root + '/agents', { template: 'implementer' });
    const { role: review } = await post(root + '/agents', { template: 'reviewer' });
    const { template } = await post(root + '/team-templates', {
      definition: {
        name: 'P21 secuencial',
        description: 'Cambio y revisión verificada.',
        maxIterations: 1,
        limits: { maxRequests: 8, timeoutMs: 120000, concurrency: 1 },
        steps: [
          {
            key: 'implement',
            title: 'Implementar',
            role: { id: implement.id, version: 1 },
            dependsOn: [],
            exitCriteria: ['Pruebas correctas.'],
            requiredCapabilities: ['text', 'workspaceWrite'],
            maxRequests: 4,
          },
          {
            key: 'review',
            title: 'Revisar',
            role: { id: review.id, version: 1 },
            dependsOn: ['implement'],
            exitCriteria: ['Entrega verificada.'],
            requiredCapabilities: ['text', 'toolCalls'],
            maxRequests: 2,
          },
        ],
      },
    });
    const createTask = async (title: string) =>
      (
        await post(root + '/tasks', {
          title,
          description: 'Corregir la suma y preservar las pruebas.',
          priority: 'medium',
          status: 'todo',
          acceptanceCriteria: ['Suma correcta.'],
        })
      ).task;
    const task = await createTask('P20 P21 mixed browser');
    await page.goto('/#/projects/' + project.id);
    await page.getByText('Preparar y aprobar planes', { exact: true }).press('Enter');
    const form = page.getByRole('form', { name: 'Preparar plan' });
    await form.getByLabel('Tarea del plan').selectOption(task.id);
    await form.getByLabel('Plantilla del plan').selectOption(template.id);
    await form.getByLabel('Política del plan').selectOption('mixed');
    await form.getByLabel('Destino de Implementar').selectOption('codex-local-v1');
    await form.getByLabel('Destino de Revisar').selectOption('codex-v1');
    await form.getByLabel('Límite de peticiones a la API').fill('2');
    await form.getByRole('button', { name: 'Preparar copia del plan' }).press('Enter');
    const plan = page.getByRole('region', { name: 'Detalle del plan' });
    const decision = plan.getByRole('region', { name: 'Decisión de inferencia' });
    await expect(decision.getByText(/implement · Ollama local · fixture-local/)).toBeVisible();
    await expect(decision.getByText(/review · API de OpenAI · fixture-codex/)).toBeVisible();
    await expect(decision.getByText(/Se envía a la API.*entregas de esta ejecución/)).toBeVisible();
    await plan.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
    const approve = plan.getByRole('button', { name: 'Aprobar este plan' });
    await expect(approve).toBeDisabled();
    await plan.getByRole('checkbox', { name: /Autorizo las transferencias/ }).press('Space');
    await approve.press('Enter');
    await expect(plan.getByText(/Estado: Aprobado/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();

    const paired = await createTask('P20 P21 paired browser');
    const common = {
      taskId: paired.id,
      taskVersion: paired.version,
      commit: 'a'.repeat(40),
      timeoutMs: 60000,
      maxRequests: 4,
      maxOutputTokens: 1024,
    };
    const api = await post(root + '/coding', {
      ...common,
      requestId: randomUUID(),
      model: 'fixture-codex',
    });
    const local = await post(root + '/coding', {
      ...common,
      requestId: randomUUID(),
      executionId: 'codex-local-v1',
      model: 'fixture-local',
    });
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api' + root + '/jobs/' + local.job.id);
          return (await response.json()).job.state;
        },
        { timeout: 30000 },
      )
      .toBe('completed');
    await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
    await page.getByText('Comparación Codex API y Ollama local', { exact: true }).press('Enter');
    const comparisons = page.getByRole('region', { name: 'Comparación Codex API y Ollama local' });
    await comparisons.getByLabel('Trabajo Codex API').selectOption(api.job.id);
    await comparisons.getByLabel('Trabajo Codex local').selectOption(local.job.id);
    await comparisons.getByLabel('Caso de comparación API/local').selectOption('addition-v1');
    await comparisons.getByLabel('Hardware local observado (opcional)').fill('CPU simulada');
    await comparisons.getByRole('button', { name: 'Guardar comparación API/local' }).press('Enter');
    await expect(comparisons.getByText('Condiciones registradas equivalentes')).toBeVisible();
    await expect(comparisons.getByText('Coste total desconocido.')).toHaveCount(2);
    await expect(comparisons.getByText('Hardware local declarado: CPU simulada.')).toBeVisible();
    const exportLink = comparisons.getByRole('link', {
      name: 'Exportar comparación API/local JSON',
    });
    const exportPath = (await exportLink.getAttribute('href'))!;
    const saved = await page.request.get(exportPath);
    expect(providerComparison.parse(await saved.json()).evidence.local.costUsd).toBeNull();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await comparisons.screenshot({
      path: 'test-results/p21-provider-comparison-mobile.png',
      animations: 'disabled',
    });
    const archived = await page.request.patch('/api' + root, {
      headers,
      data: { version: project.version, archived: true },
    });
    expect(archived.ok(), await archived.text()).toBeTruthy();
    expect((await page.request.get(exportPath)).status()).toBe(200);
    const blocked = await page.request.post('/api' + root + '/lab/provider-comparisons', {
      headers,
      data: { apiId: api.job.id, localId: local.job.id, case: 'recorded' },
    });
    expect(blocked.status()).toBe(409);
    await post('/github/disconnect', {});
    expect((await page.request.get(exportPath)).status()).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post('/api/github/disconnect', { headers, data: {} });
  }
});
