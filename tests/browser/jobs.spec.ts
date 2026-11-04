import { expect, test } from '@playwright/test';
test('persistent jobs show progress, survive page reload and cancel their process', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Cola persistente');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Cola persistente/ }).click();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Nuevo trabajo simulado', { exact: true }).click();
  await page.getByLabel('Título del trabajo', { exact: true }).fill('Trabajo persistente');
  await page.getByLabel('Pasos', { exact: true }).fill('10');
  await page.getByLabel('Tiempo por paso (ms)', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Encolar simulación', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Trabajo persistente', exact: true }),
  ).toBeVisible();
  const identity = await page.locator('.job-id').textContent();
  await expect(
    page
      .getByRole('log')
      .getByText('Paso confirmado y checkpoint guardado.', { exact: true })
      .first(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByRole('button', { name: /Trabajo persistente/ }).click();
  await expect(page.locator('.job-id')).toHaveText(identity!);
  await expect(page.getByText('Estado: Completado', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Progreso del trabajo' })).toHaveAttribute(
    'value',
    '10',
  );
  await page.getByText('Resultado persistente de simulación', { exact: true }).click();
  await expect(page.locator('.job-view pre')).toContainText('"simulated": true');
  await page.getByText('Nuevo trabajo simulado', { exact: true }).click();
  await page.getByLabel('Título del trabajo', { exact: true }).fill('Trabajo cancelable');
  await page.getByLabel('Pasos', { exact: true }).fill('30');
  await page.getByLabel('Tiempo por paso (ms)', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Encolar simulación', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Trabajo cancelable', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('log')
      .getByText('Presupuesto reservado para un paso simulado.', { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar trabajo', exact: true }).click();
  await expect(page.getByText('Estado: Cancelado', { exact: true })).toBeVisible();
  await page.getByText('Intentos y condiciones', { exact: true }).click();
  await expect(page.getByText(/parada confirmada: Sí/)).toBeVisible();
  const foreign = await page.request.get(
    `/api/projects/${process.env.FERWEB_FOREIGN_PROJECT}/jobs`,
  );
  expect(foreign.status()).toBe(404);
  await page.getByText('Nuevo trabajo simulado', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/e7-jobs-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
