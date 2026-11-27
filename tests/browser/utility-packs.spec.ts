import { test, expect } from '@playwright/test';

test('P23 filters the ECC catalog, disables external effects and saves a family plan on mobile', async ({
  page,
}, info) => {
  test.setTimeout(65000);
  await page.setViewportSize({ width: 390, height: 844 });
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
  try {
    const auth = await post('/github/authorize', {});
    await page.goto(
      '/api/github/callback?state=' +
        new URL(auth.url).searchParams.get('state') +
        '&code=fixture-code',
    );
    await post('/github/installations', { installationId: 71 });
    const { project } = await post('/projects', {
      name: 'Catálogo de utilidades P23',
      description: '',
    });
    await post(`/projects/${project.id}/github`, {
      installationId: 71,
      repositoryId: 101,
      version: 0,
    });
    await post(`/projects/${project.id}/github/sync`, { version: 1 });
    await post(`/projects/${project.id}/tasks`, {
      title: 'Comprobar la interfaz del proyecto',
      description: 'Revisar error, foco y accesibilidad.',
      priority: 'medium',
      status: 'todo',
      acceptanceCriteria: ['Recorrido con teclado documentado.'],
    });
    await page.goto(`/#/projects/${project.id}`);
    await page.getByRole('button', { name: /Comprobar la interfaz del proyecto/ }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Detalle de tarea' });
    await dialog.getByText('Recetas de la tarea', { exact: true }).press('Enter');
    const catalog = dialog.locator('details.utility-packs');
    const endpoint = `**/api/projects/${project.id}/utility-packs*`;
    await page.route(endpoint, (route) => route.fulfill({ status: 503, json: {} }));
    await catalog.getByText('Paquetes de utilidades ECC', { exact: true }).press('Enter');
    await expect(catalog.getByRole('alert')).toBeVisible();
    await page.unroute(endpoint);
    await catalog.getByRole('button', { name: 'Reintentar catálogo' }).click();
    await expect(catalog.getByText(/759 de 759 utilidades/)).toBeVisible();
    await catalog.getByRole('button', { name: 'Siguiente' }).click();
    await expect(catalog.getByText(/Página 2 de/)).toBeVisible();
    await catalog.getByLabel('Buscar utilidad').fill('fal ai');
    await catalog.getByRole('button', { name: 'Buscar', exact: true }).press('Enter');
    await catalog.getByLabel('Modo de utilidad').selectOption('external');
    const fal = catalog.getByText(/^fal ai · Integración pendiente$/);
    await fal.press('Enter');
    await expect(catalog.getByRole('button', { name: 'Conector sin habilitar' })).toBeDisabled();
    await expect(catalog.getByText('Adaptador MCP específico y versión fijada.')).toBeVisible();
    await catalog.getByLabel('Buscar utilidad').fill('no utility with this name');
    await catalog.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(catalog.getByText('No hay utilidades para los filtros actuales.')).toBeVisible();
    await catalog.getByRole('combobox', { name: 'Familia', exact: true }).selectOption('frontend');
    const family = catalog.getByRole('region', { name: 'Frontend, diseño y accesibilidad' });
    await expect(family).toBeVisible();
    await family
      .getByRole('button', { name: 'Elegir Plan de interfaz y accesibilidad' })
      .press('Enter');
    await expect(dialog.getByLabel('Elegir receta')).toBeFocused();
    await dialog.getByLabel('Rutas de referencia (opcional)').fill('src/add.cjs');
    await dialog.getByRole('button', { name: 'Preparar receta' }).press('Enter');
    const plan = dialog.getByRole('region', { name: 'Plan de receta guardado' });
    await expect(
      plan.getByRole('heading', { name: 'Plan de interfaz y accesibilidad · v1' }),
    ).toBeVisible();
    await expect(plan.getByText(/skills\/frontend-a11y\/SKILL\.md/)).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Ejecutar receta' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await plan.screenshot({ path: info.outputPath('p23-plan-mobile.png') });
  } finally {
    await post('/github/disconnect', {});
  }
});
