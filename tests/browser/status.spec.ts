import { expect, test } from '@playwright/test';

test('real services render readiness, installation and an explicit refresh', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#/status');
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
  await expect(page.getByText('Servicios operativos', { exact: true })).toBeVisible();
  const installation = page.getByTestId('installation-id');
  await expect(installation).toHaveText(/^[a-f0-9-]{36}$/);
  const id = await installation.textContent();
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/health/ready'),
  );
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(installation).toHaveText(id!);
  expect(errors).toEqual([]);
});

test('network failure shows an error and refresh recovers', async ({ page }) => {
  await page.goto('/#/status');
  await expect(page.getByText('Servicios operativos', { exact: true })).toBeVisible();
  await page.route('**/api/health/ready', (route) => route.abort());
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await expect(page.getByRole('alert')).toContainText('No se ha podido consultar la API');
  await expect(page.getByTestId('installation-id')).toHaveText('Pendiente de conexión');
  await page.unroute('**/api/health/ready');
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await expect(page.getByText('Servicios operativos', { exact: true })).toBeVisible();
});

test('mobile layout fits the viewport and exposes next-step details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/status');
  await expect(page.getByText('Servicios operativos', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByText('Ver siguiente paso', { exact: true }).click();
  await expect(page.getByText('Podrás revisar cambios y publicar', { exact: false })).toBeVisible();
});
