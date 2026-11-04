import { expect, test } from '@playwright/test';
test('project conversations stream, persist usage and partial cancellation with the Python test provider', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Conversaciones de prueba');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Conversaciones de prueba/ }).click();
  const projectUrl = page.url();
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Chat local persistente');
  await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('fixture-chat');
  await page.getByRole('button', { name: 'Crear conversación', exact: true }).click();
  await page.getByLabel('Mensaje', { exact: true }).fill('hola');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(page.getByText('simulada (1 mensajes).', { exact: false })).toBeVisible();
  await expect(page.getByText('Completada', { exact: true })).toBeVisible();
  await page.getByText('Modelo, tiempos y consumo', { exact: true }).click();
  await expect(page.getByText('11 / 7 / 18', { exact: true })).toBeVisible();
  await page.getByLabel('Mensaje', { exact: true }).fill('fixture-cancel');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Cancelar generación', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar generación', exact: true }).click();
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: /Chat local persistente/ }).click();
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(page.getByText('simulada (1 mensajes).', { exact: false })).toBeVisible();
  await page.getByLabel('Mensaje', { exact: true }).fill('fixture-error');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(page.getByText('Error', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'provider_rate_limit' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/e4-chat-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: /Chat local persistente/ }).click();
  await expect(page.getByRole('heading', { name: 'Chat local persistente' })).toBeVisible();
  expect(errors).toEqual([]);
});
