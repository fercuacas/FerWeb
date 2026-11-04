import { expect, test } from '@playwright/test';

test('GitHub App UI connects, selects a repo, reads commit-pinned files and issues, then disconnects', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  // Simulate GitHub's authorization redirect; backend still validates state and PKCE.
  await page.route('https://github.com/login/oauth/authorize?**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${process.env.FERWEB_URL}/api/github/callback?state=${url.searchParams.get('state')}&code=fixture-code`,
      },
      body: '',
    });
  });
  await page.goto('/#/github');
  await page.getByRole('button', { name: 'Autorizar GitHub', exact: true }).click();
  await expect(page.getByText('Autorizado como fixture-owner.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Conectar instalación', exact: true }).click();
  await expect(page.getByText('Instalación 71 · Conectada')).toBeVisible();
  await page.goto('/#/projects');
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Integración GitHub');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Integración GitHub/ }).click();
  await page.getByRole('button', { name: 'Repositorio GitHub', exact: true }).click();
  await page.getByRole('combobox', { name: 'Instalación', exact: true }).selectOption('71');
  await page.getByRole('combobox', { name: 'Repositorio', exact: true }).selectOption('101');
  await expect(page.getByLabel('Rama', { exact: true })).toHaveValue('main');
  await page.getByRole('button', { name: 'Vincular repositorio', exact: true }).click();
  await expect(page.getByRole('link', { name: /Commit a{40}/ })).toBeVisible();
  await page.getByRole('button', { name: 'src/demo.ts', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Contenido del archivo' }).locator('pre'),
  ).toContainText('export const demo = true;');
  await expect(page.getByRole('button', { name: '.env', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/e3-github-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Issues (1)', exact: true }).click();
  await page.getByText('#1 · Revisar permisos <script> · open', { exact: true }).click();
  await expect(page.getByText('Descripción **sin ejecutar HTML**', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pull requests (1)', exact: true }).click();
  await expect(page.getByText('#2 · Propuesta de cambio · open', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar ahora', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Repositorio GitHub', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/e3-github-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto('/#/github');
  await page.getByRole('button', { name: 'Desconectar de FerWeb' }).click();
  await page.getByRole('button', { name: 'Confirmar desconexión' }).click();
  await expect(page.getByText('Es necesario autorizar tu cuenta de GitHub.')).toBeVisible();
  expect(errors).toEqual([]);
});
