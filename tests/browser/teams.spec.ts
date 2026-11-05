import { test, expect } from '@playwright/test';

test('team UI versions a DAG, prepares immutable copies from Tasks and Jobs and approves only the reviewed hash', async ({
  page,
}) => {
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
    return response.json();
  };
  const { project } = await post('/projects', {
    name: 'Equipos P05',
    description: 'Preparación verificable.',
  });
  const { task } = await post(`/projects/${project.id}/tasks`, {
    title: 'Preparar cambio pequeño',
    description: 'Revisar el cambio descrito.',
    priority: 'medium',
    status: 'todo',
    acceptanceCriteria: ['Comprobaciones documentadas.'],
  });
  await post(`/projects/${project.id}/agents`, { template: 'implementer' });
  await post(`/projects/${project.id}/agents`, { template: 'reviewer' });
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  const teams = page.getByRole('region', { name: 'Equipos y plantillas', exact: true });
  await teams.getByRole('button', { name: 'Usar Implementar y revisar' }).press('Enter');
  const editor = teams.getByRole('form', { name: 'Editar plantilla de equipo' });
  const first = editor.getByRole('group', { name: 'Etapa 1 · implement', exact: true });
  await first.getByRole('checkbox', { name: 'Revisar', exact: true }).check();
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).click();
  await expect(editor.getByRole('alert')).toContainText('ciclo');
  await first.getByRole('checkbox', { name: 'Revisar', exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).click();
  await expect(editor).toHaveCount(0);
  await expect(teams.getByText('Versión 1 · 2 etapas')).toBeVisible();
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Preparar plan' });
  await form.getByLabel('Tarea del plan').selectOption(task.id);
  await form.getByLabel('Plantilla del plan').selectOption({ label: 'Implementar y revisar' });
  await expect(form.getByText(/Clasificación orientativa.*pequeña.*agente único/)).toBeVisible();
  await form.getByLabel('Modo del plan').selectOption('team');
  await expect(form.getByText(/Máximo previsto: 6 peticiones/)).toBeVisible();
  await form.getByRole('button', { name: 'Preparar copia del plan' }).click();
  const details = page.getByRole('region', { name: 'Detalle del plan' });
  await expect(details.getByText(/Estado: Preparado/)).toBeVisible();
  await expect(details.getByText(/Proveedor simulado.*Codex CLI/)).toBeVisible();
  const hash = await details.getByText(/^Hash: /).innerText();
  const approve = details.getByRole('button', { name: 'Aprobar este plan' });
  await expect(approve).toBeDisabled();
  await details.getByRole('checkbox', { name: /He revisado esta copia/ }).check();
  await approve.press('Enter');
  await expect(details.getByText(/Estado: Aprobado/)).toBeVisible();
  await page.reload();
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  await page.getByRole('button', { name: /^Ver plan/ }).click();
  await expect(details.getByText(hash, { exact: true })).toBeVisible();
  await expect(details.getByText(/Estado: Aprobado/)).toBeVisible();
  await page.goto(`/#/agents/${project.id}`);
  await page.getByText('Equipos y plantillas', { exact: true }).click();
  await teams.getByRole('button', { name: 'Nueva versión del equipo' }).click();
  await editor.getByLabel('Nombre del equipo').fill('Equipo revisado P05');
  await editor.getByRole('button', { name: 'Guardar plantilla de equipo' }).click();
  await expect(teams.getByText('Versión 2 · 2 etapas')).toBeVisible();
  await page.goto(`/#/projects/${project.id}`);
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  await form.getByLabel('Tarea del plan').selectOption(task.id);
  await form.getByLabel('Plantilla del plan').selectOption({ label: 'Equipo revisado P05' });
  await form.getByRole('button', { name: 'Preparar copia del plan' }).click();
  await expect(details.getByText(/Estado: Preparado/)).toBeVisible();
  await expect(details.getByText(/Plantilla v2 · Agente único/)).toBeVisible();
  await expect(details.getByText(hash, { exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Aprobar este plan' })).toBeDisabled();
  await expect(details.getByText('No se publican cambios automáticamente.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  let failPlans = true;
  await page.route(`**/api/projects/${project.id}/team-plans`, async (route) => {
    if (failPlans && route.request().method() === 'GET') {
      failPlans = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'unavailable', message: 'Planes temporalmente inaccesibles.' },
        }),
      });
    } else await route.continue();
  });
  await page.reload();
  await page.getByText('Preparar y aprobar planes', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Planes temporalmente inaccesibles.');
  await expect(page.getByRole('button', { name: /^Ver plan/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar planes' }).click();
  await expect(page.getByRole('button', { name: /^Ver plan/ })).toHaveCount(2);
  expect(errors).toEqual([]);
});
