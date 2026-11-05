import { expect, test } from '@playwright/test';

test('repository context is indexed, searched and shown as persisted chat sources', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
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
  const connect = page.getByRole('button', { name: 'Conectar instalación', exact: true });
  await connect.click();
  await expect(page.getByText('Instalación 71 · Conectada')).toBeVisible();
  await page.goto('/#/projects');
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Fuentes para el chat');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Fuentes para el chat/ }).click();
  await page.getByRole('button', { name: 'Repositorio GitHub', exact: true }).click();
  await page.getByRole('combobox', { name: 'Instalación', exact: true }).selectOption('71');
  await page.getByRole('combobox', { name: 'Repositorio', exact: true }).selectOption('101');
  await page.getByRole('button', { name: 'Vincular repositorio', exact: true }).click();
  await expect(page.getByRole('link', { name: /Commit a{40}/ })).toBeVisible();
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByText('Contexto del repositorio', { exact: true }).click();
  await expect(page.getByText(/Sin índice · 0 documentos/)).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar índice de contexto', exact: true }).click();
  // Shared corpus includes four Codex files, including the P07 read-only probe.
  await expect(page.getByText(/Índice actualizado · 10 documentos/)).toBeVisible();
  await page.getByLabel('Pregunta para probar la recuperación').fill('autenticación cookie');
  await page.getByRole('button', { name: 'Buscar fuentes', exact: true }).click();
  await expect(page.locator('.repository-context .context-sources a').first()).toContainText(
    'docs/auth.md',
  );
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Chat con fuentes');
  await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('fixture-chat');
  await page.getByRole('button', { name: 'Crear conversación', exact: true }).click();
  await page.getByLabel('Usar contexto del repositorio').check();
  await page.getByLabel('Mensaje', { exact: true }).fill('autenticación cookie');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(
    page.getByText('Respuesta simulada con fuentes [F1].', { exact: true }),
  ).toBeVisible();
  const source = page.locator('.chat-turn .context-sources a').first();
  await expect(source).toContainText('docs/auth.md');
  await expect(source).toHaveAttribute('href', /\/blob\/a{40}\/docs\/auth.md#L1-L3/);
  await page.reload();
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: /Chat con fuentes/ }).click();
  await expect(page.locator('.chat-turn .context-sources a').first()).toContainText('docs/auth.md');
  await page.getByLabel('Usar contexto del repositorio').check();
  await page.getByLabel('Mensaje', { exact: true }).fill('¿Cómo se calcula la factura mensual?');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(
    page.getByText(/No dispongo de información suficiente en las fuentes/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Chat con fuentes', exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/e5-context-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
