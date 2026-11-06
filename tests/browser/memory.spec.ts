import { test, expect } from '@playwright/test';
test('knowledge UI creates, corrects, exports and imports memory, hides denied data and works on mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const headers = { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' };
  const response = await page.request.post('/api/projects', {
    headers,
    data: { name: 'Memoria P09', description: 'Revisiones autorizadas.' },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/#/projects/${project.id}`);
  await page.getByRole('button', { name: 'Conocimiento', exact: true }).press('Enter');
  const knowledge = page.getByRole('region', { name: 'Conocimiento del proyecto' });
  await expect(knowledge.getByRole('status')).toHaveText('Consulta completa: sin resultados');
  await knowledge.getByRole('button', { name: 'Nueva entrada de memoria' }).click();
  const editor = knowledge.getByRole('form', { name: 'Crear memoria' });
  await editor.getByLabel('Título de memoria', { exact: true }).fill('Entrega recuperable');
  await editor
    .getByLabel('Contenido de memoria')
    .fill('Contexto alfa. <script>window.memoryInjected=true</script>');
  await page.route('**/api/projects/*/memory', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'test_unavailable', message: 'Memoria temporalmente no disponible.' },
          }),
        })
      : route.continue(),
  );
  await editor.getByRole('button', { name: 'Guardar memoria', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('Memoria temporalmente no disponible.');
  await expect(editor.getByLabel('Contenido de memoria')).toHaveValue(/Contexto alfa/);
  await page.unroute('**/api/projects/*/memory');
  await editor.getByRole('button', { name: 'Guardar memoria', exact: true }).press('Enter');
  await expect(editor).toHaveCount(0);
  const detail = knowledge.getByRole('region', { name: 'Detalle de memoria' });
  await expect(detail.getByRole('heading', { name: 'Entrega recuperable · v1' })).toBeVisible();
  await expect(detail.getByText(/Sin evidencia/).first()).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'memoryInjected'))).toBe(false);
  await detail.getByRole('button', { name: 'Corregir o retirar memoria' }).click();
  const correction = detail.getByRole('form', { name: 'Corregir memoria' });
  await correction.getByLabel('Contenido de memoria').fill('Contexto beta corregido.');
  await correction.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(
    detail.getByRole('heading', { name: 'Entrega recuperable · v2' }).first(),
  ).toBeVisible();
  await detail.getByText('Historial autorizado de revisiones', { exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'Entrega recuperable · v1' })).toBeVisible();
  await expect(detail.getByText('Contexto alfa.', { exact: false })).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar memoria' }).click();
  await knowledge.getByLabel('Buscar en memoria', { exact: true }).fill('alfa');
  await expect(
    knowledge.getByText('Consulta completa: sin resultados', { exact: true }),
  ).toBeVisible();
  await knowledge.getByLabel('Buscar en memoria', { exact: true }).fill('beta');
  await expect(knowledge.getByRole('button', { name: 'Entrega recuperable · v2' })).toBeVisible();
  await knowledge
    .getByRole('checkbox', { name: 'Incluir Entrega recuperable en exportación' })
    .check();
  const downloadPromise = page.waitForEvent('download');
  await knowledge.getByRole('button', { name: 'Exportar selección Markdown' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/ferweb-memory-.*-r2\.md/);
  const downloaded = await download.path();
  expect(downloaded).toBeTruthy();
  await knowledge.getByLabel('Archivo de memoria').setInputFiles(downloaded!);
  await knowledge.getByRole('button', { name: 'Importar archivo completo' }).click();
  await expect(
    knowledge.getByText('Importadas 1 entradas sin revisar.', { exact: true }),
  ).toBeVisible();
  await expect(knowledge.getByRole('button', { name: 'Entrega recuperable · v1' })).toBeVisible();
  await knowledge.getByLabel('Archivo de memoria').setInputFiles({
    name: 'incomplete.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":"ferweb.memory.v1"}'),
  });
  await knowledge.getByRole('button', { name: 'Importar archivo completo' }).click();
  await expect(knowledge.getByText(/El archivo no es un intercambio completo/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const choiceHeight = await knowledge
    .getByRole('checkbox', { name: 'Incluir Entrega recuperable en exportación' })
    .first()
    .evaluate((el) => el.parentElement!.getBoundingClientRect().height);
  expect(choiceHeight).toBeLessThan(100);
  await expect(knowledge.getByRole('heading', { name: 'Conocimiento del proyecto' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/p09-knowledge-mobile.png', fullPage: true });
  await page.route('**/api/projects/*/memory/search', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'source_denied', message: 'Fuentes no disponibles.' },
      }),
    }),
  );
  await knowledge.getByLabel('Buscar en memoria', { exact: true }).fill('beta ');
  await expect(knowledge.getByRole('alert')).toContainText('Fuentes no disponibles.');
  await expect(knowledge.getByRole('button', { name: /Entrega recuperable · v/ })).toHaveCount(0);
  await page.unroute('**/api/projects/*/memory/search');
  await knowledge.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(knowledge.getByRole('button', { name: 'Entrega recuperable · v2' })).toBeVisible();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Nueva tarea con Codex', { exact: true }).click();
  const picker = page.getByRole('region', { name: 'Memoria para la ejecución' }).last();
  await picker.getByText('Memoria de proyecto (opcional, máximo tres)', { exact: true }).click();
  await picker
    .getByRole('button', { name: 'Seleccionar Entrega recuperable', exact: true })
    .first()
    .click();
  await expect(picker.getByText(/Entrega recuperable v\d · Vigente/)).toBeVisible();
  await picker.getByText('Ver memoria seleccionada', { exact: true }).click();
  await expect(picker.getByText('Contexto beta corregido.', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: /Quitar memoria/ }).click();
  await expect(picker.getByRole('button', { name: /Quitar memoria/ })).toHaveCount(0);
  const archive = await page.request.patch(`/api/projects/${project.id}`, {
    headers,
    data: { version: project.version, archived: true },
  });
  expect(archive.status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'Conocimiento', exact: true }).click();
  await expect(
    knowledge.getByText('Proyecto archivado: solo consulta y exportación.', { exact: true }),
  ).toBeVisible();
  await expect(knowledge.getByRole('button', { name: 'Nueva entrada de memoria' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
