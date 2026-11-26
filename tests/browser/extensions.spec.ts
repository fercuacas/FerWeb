import { test, expect } from '@playwright/test';

test('P22 extension review, local execution, preserved edits and downloadable Codex catalog', async ({
  page,
}) => {
  test.setTimeout(90000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const headers = { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const { project } = await post('/projects', {
    name: 'P22 extensión y catálogo',
    description: '',
  });
  await post(`/projects/${project.id}/agents`, { template: 'reviewer' });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Extensiones del proyecto', { exact: true }).press('Enter');
  const extensions = page.getByRole('region', { name: 'Extensiones del proyecto' });
  await expect(extensions.getByText('Aún no hay extensiones.')).toBeVisible();
  await extensions.getByRole('button', { name: 'Importar lector de ejemplo' }).press('Enter');
  const detail = extensions.getByRole('region', { name: 'Detalle de extensión' });
  await expect(detail.getByText(/Estado Importada/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Ejecutar lectura local' })).toHaveCount(0);
  await detail.getByLabel('Recurso de lectura').selectOption('ficha.md');
  await detail.getByRole('button', { name: 'Guardar configuración' }).press('Enter');
  await expect(detail.getByText(/Incorporar · ficha.md/)).toBeVisible();
  const approve = detail.getByRole('button', { name: 'Aprobar configuración' });
  await expect(approve).toBeDisabled();
  await detail.getByRole('checkbox', { name: /He revisado el origen/ }).press('Space');
  await approve.press('Enter');
  await detail.getByRole('button', { name: 'Habilitar extensión' }).press('Enter');
  await detail.getByRole('button', { name: 'Ejecutar lectura local' }).press('Enter');
  await expect(
    detail
      .getByRole('region', { name: 'Resultado de la lectura' })
      .getByText(/Ficha local de ejemplo/),
  ).toBeVisible();
  await detail.getByText('ficha.md · Gestionado por la extensión', { exact: true }).press('Enter');
  await detail.getByRole('button', { name: 'Editar copia del proyecto' }).press('Enter');
  await detail
    .getByRole('textbox', { name: 'Contenido de ficha.md' })
    .fill('Edición del proyecto que se conserva.');
  await detail.getByRole('button', { name: 'Guardar edición del proyecto' }).press('Enter');
  await expect(
    detail.getByText('ficha.md · Propiedad del proyecto', { exact: true }),
  ).toBeVisible();
  await detail.getByText('Previsualizar retirada', { exact: true }).press('Enter');
  await expect(
    detail.getByText('Conservar edición del proyecto · ficha.md', { exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Retirar extensión' }).press('Enter');
  await expect(detail.getByText(/Estado Retirada/)).toBeVisible();
  await detail.getByText('ficha.md · Propiedad del proyecto', { exact: true }).press('Enter');
  await expect(detail.getByText('Edición del proyecto que se conserva.')).toBeVisible();
  await detail.getByText('Historial de la extensión', { exact: true }).press('Enter');
  await expect(detail.getByText(/Lectura local · 1.0.0/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await extensions.screenshot({
    path: 'test-results/p22-extension-mobile.png',
    animations: 'disabled',
  });

  await page.getByText('Exportar catálogo portable', { exact: true }).press('Enter');
  const catalog = page.getByRole('region', { name: 'Exportar catálogo portable' });
  await catalog.getByLabel('Rol para exportar').selectOption({ label: 'Revisor de código · v1' });
  await catalog.getByRole('button', { name: 'Previsualizar exportación' }).press('Enter');
  const output = catalog.getByRole('region', { name: 'Archivos de exportación' });
  await expect(output.getByText(/\.codex\/agents\/ferweb_role_/)).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Descargar archivos para Codex' }).press('Enter');
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('ferweb-codex.zip');
  expect(await download.failure()).toBeNull();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
