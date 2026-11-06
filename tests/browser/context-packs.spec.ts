import { test, expect } from '@playwright/test';

test('P10 map, lexical catalog and receipts preserve drafts, invalidate reuse and hide denied sources on mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  const headers = { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' };
  async function post(path: string, data: unknown) {
    const response = await page.request.post('/api' + path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  }
  try {
    const auth = await post('/github/authorize', {});
    await page.goto(
      '/api/github/callback?state=' +
        new URL(auth.url).searchParams.get('state') +
        '&code=fixture-code',
    );
    await post('/github/installations', { installationId: 71 });
    const { project } = await post('/projects', {
      name: 'Contexto P10',
      description: 'Mapa y recibos verificables.',
    });
    await post(`/projects/${project.id}/github`, {
      installationId: 71,
      repositoryId: 101,
      version: 0,
    });
    await post(`/projects/${project.id}/github/sync`, { version: 1 });
    const { task } = await post(`/projects/${project.id}/tasks`, {
      title: 'P10 fixture task',
      description: 'Use the project map.',
      priority: 'medium',
      status: 'todo',
      acceptanceCriteria: ['Keep the contract'],
    });
    await page.goto('/#/projects/' + project.id);
    await page.getByRole('button', { name: 'Conocimiento', exact: true }).press('Enter');
    await page.getByText('Mapa, catálogo y recibos de contexto (P10)', { exact: true }).click();
    const catalog = page.getByRole('region', { name: 'Catálogo de contexto' });
    await catalog.getByRole('button', { name: 'Actualizar catálogo léxico', exact: true }).click();
    await expect(page.getByText(/Catálogo léxico actualizado/)).toBeVisible();
    const map = page.getByRole('region', { name: 'Mapa del proyecto' });
    await map.getByRole('button', { name: 'Proponer mapa desde documentos existentes' }).click();
    await expect(map.getByLabel('Mapa Markdown')).toHaveValue(/Propósito/);
    await map
      .getByLabel('Mapa Markdown')
      .fill('# P10 private map marker\nPurpose: inspect the source catalog.');
    const mapRoute = '**/api/projects/*/context-packs/map';
    await page.route(mapRoute, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'fixture_unavailable', message: 'Mapa temporalmente no disponible.' },
            }),
          })
        : route.continue(),
    );
    await map.getByRole('button', { name: 'Guardar mapa del proyecto' }).click();
    await expect(map.getByRole('alert')).toHaveText('Mapa temporalmente no disponible.');
    await expect(map.getByLabel('Mapa Markdown')).toHaveValue(/P10 private map marker/);
    await page.unroute(mapRoute);
    await map.getByRole('button', { name: 'Guardar mapa del proyecto' }).press('Enter');
    await expect(page.getByText(/Mapa versionado guardado/)).toBeVisible();
    const lookup = page.getByRole('region', { name: 'Probar búsqueda híbrida' });
    await lookup.getByLabel('Consulta híbrida').fill('docs/auth.md');
    await lookup.getByRole('button', { name: 'Buscar fuentes' }).click();
    await expect(lookup.getByText(/lexical-v1 · lexical_index/)).toBeVisible();
    await expect(lookup.getByText(/exact_path/)).toBeVisible();
    const downloading = page.waitForEvent('download');
    await catalog.getByRole('button', { name: 'Exportar catálogo JSON' }).click();
    expect((await downloading).suggestedFilename()).toBe('context-catalog-' + project.id + '.json');
    await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
    await page.getByText('Nueva tarea con Codex', { exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Tarea de programación', exact: true })
      .selectOption(task.id);
    await page.getByText('Preparar contexto y skills (P10, opcional)', { exact: true }).click();
    await page.getByLabel('Usar un paquete de contexto con recibo').check();
    await page.getByLabel('Consulta dirigida (opcional)').fill('docs/auth.md');
    await page.getByRole('button', { name: 'Preparar y previsualizar contexto' }).click();
    await expect(
      page.getByText('Contexto vigente listo para ejecutar', { exact: true }),
    ).toBeVisible();
    await page.getByText(/^Ver recibo de contexto /).click();
    await expect(
      page.getByText(/Tokens observados de toda la ejecución: entrada desconocida/),
    ).toBeVisible();
    await page.getByText('Mapa congelado v1', { exact: true }).click();
    await expect(page.getByText('# P10 private map marker', { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/p10-context-mobile.png', fullPage: true });
    const saved = await (
      await page.request.get(`/api/projects/${project.id}/context-packs`)
    ).json();
    const updated = await page.request.put(`/api/projects/${project.id}/context-packs/map`, {
      headers,
      data: {
        version: saved.map.version,
        markdown: 'Revised map',
        paths: saved.map.sources.map((source: { path: string }) => source.path),
      },
    });
    expect(updated.ok(), await updated.text()).toBeTruthy();
    await expect(
      page.getByText('El contexto se está comprobando o quedó invalidado; prepara uno nuevo.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 12000 });
    await page.route('**/api/projects/*/context-packs/receipts/*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'source_denied', message: 'Fuentes retiradas.' } }),
      }),
    );
    await expect(page.getByText('Fuentes retiradas.').first()).toBeVisible({ timeout: 12000 });
    await expect(page.getByText('# P10 private map marker', { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request
      .post('/api/github/disconnect', { headers, data: {}, timeout: 5000 })
      .catch(() => {});
  }
});
