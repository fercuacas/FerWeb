import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('context evaluation freezes existing cases, displays measured ledgers and keeps simulated improvements unadopted', async ({
  page,
}) => {
  test.setTimeout(90000);
  const origin = new URL(process.env.FERWEB_URL!).origin;
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const post = async (path: string, body: unknown) => {
    const r = await page.request.post('/api' + path, {
      headers: { Origin: origin, 'X-FerWeb-Request': '1' },
      data: body,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.status() === 204 ? null : r.json();
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
      name: 'Contexto medido',
      description: 'Comparación de estrategias con corpus sintético.',
    });
    await post(`/projects/${project.id}/github`, {
      installationId: 71,
      repositoryId: 101,
      version: 0,
    });
    await post(`/projects/${project.id}/github/sync`, { version: 1 });
    await post(`/projects/${project.id}/context/index`, {});
    const evaluation = JSON.parse(
      await readFile(new URL('../fixtures/retrieval-evaluation.json', import.meta.url), 'utf8'),
    );
    for (const [i, c] of evaluation.slice(0, 2).entries())
      await post(`/projects/${project.id}/lab/cases`, {
        title: `Caso existente ${i + 1}`,
        question: c.question,
        context: '',
        repositoryContext: false,
        criteria: [
          { description: c.expectedAnswer, expectedText: '', expectedPaths: c.expectedPaths },
        ],
      });
    await page.goto('/#/projects/' + project.id);
    await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
    await page.getByText('Comparar estrategias de contexto', { exact: true }).click();
    const form = page.getByRole('group', { name: 'Casos de evaluación existentes' });
    await form.getByLabel('Caso existente 1').check();
    await form.getByLabel('Caso existente 2').check();
    await expect(page.getByLabel('Modelo común de contexto')).toHaveValue('fixture-chat');
    await page.getByRole('button', { name: 'Guardar evaluación de contexto' }).click();
    await expect(page.getByRole('heading', { name: 'Antes y después del contexto' })).toBeVisible();
    await expect(page.getByText('Estado del lote: Preparado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ejecutar comparación', exact: true }).click();
    await expect(page.getByText('Estado del lote: Finalizado', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.getByText('Datos simulados: adopción bloqueada. No se ha medido ahorro real de IA.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Adoptar reuse-v1', exact: true }),
    ).toBeDisabled();
    const table = page.getByRole('table', { name: 'Calidad, consumo y latencia antes/después' });
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table).toContainText('Resumen + reutilización');
    await expect(table).toContainText('Total: Desconocido');
    const summaryRun = page.locator('.lab-run').filter({ hasText: /Intento 3 ·/ });
    await summaryRun.locator('summary').first().click();
    await summaryRun
      .getByText('Contabilidad de contexto · Recuperación + resumen (summary-v1)', { exact: true })
      .click();
    await expect(summaryRun.getByText(/summary · completed/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
    await page
      .getByRole('button', { name: 'Evaluación de contexto · Finalizado', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Antes y después del contexto' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: 'test-results/e10-context-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    await page.request.post('/api/github/disconnect', {
      headers: { Origin: origin, 'X-FerWeb-Request': '1' },
      data: {},
    });
  }
});
