import { test, expect } from '@playwright/test';
import { skillFixtureText, skillManifestFixture } from '../fixtures/skills.mjs';
test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});
test('Codex task UI freezes a commit, shows a verified diff, reloads evidence and stops isolated work', async ({
  page,
}) => {
  // Covers roles/skills, execution, review, publication, comparison and cancellation;
  // per-job deadlines and assertions keep their own shorter limits.
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  await page.goto('/#/status');
  const diagnostics = page.getByRole('region', { name: 'Capacidades de ejecución' });
  await diagnostics.getByRole('button', { name: 'Consultar capacidades' }).click();
  await expect(
    diagnostics.getByRole('heading', { name: 'Ollama · conversación local' }),
  ).toBeVisible();
  await expect(
    diagnostics.getByText(/Proveedor simulado.*Herramientas Node aisladas/),
  ).toBeVisible();
  await expect(diagnostics.getByText(/Chat de FerWeb.*Solo texto/).first()).toBeVisible();
  const origin = new URL(process.env.FERWEB_URL!).origin;
  const post = async (path: string, body: unknown) => {
    const r = await page.request.post('/api' + path, {
      headers: { Origin: origin, 'X-FerWeb-Request': '1' },
      data: body,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const auth = await post('/github/authorize', {}),
    state = new URL(auth.url).searchParams.get('state');
  await page.goto('/api/github/callback?state=' + state + '&code=fixture-code');
  const connect = await page.request.post('/api/github/installations', {
    headers: { Origin: origin, 'X-FerWeb-Request': '1' },
    data: { installationId: 71 },
  });
  expect(connect.ok()).toBeTruthy();
  const { project } = await post('/projects', {
    name: 'Codex aislado',
    description: 'Repositorio preparado para verificar cambios y límites.',
  });
  const { task } = await post(`/projects/${project.id}/tasks`, {
    title: 'Fix addition',
    description: 'Corregir la suma y conservar las pruebas.',
    priority: 'high',
    status: 'todo',
    acceptanceCriteria: ['Suma correcta y pruebas superadas.'],
  });
  await post(`/projects/${project.id}/github`, {
    installationId: 71,
    repositoryId: 101,
    version: 0,
  });
  await post(`/projects/${project.id}/github/sync`, { version: 1 });
  await page.goto('/#/projects/' + project.id);
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: 'Agentes' })
    .click();
  await expect(page.getByRole('heading', { name: 'Agentes · Codex aislado' })).toBeVisible();
  await page.getByText('Biblioteca de skills', { exact: true }).click();
  const library = page.getByRole('region', { name: 'Biblioteca de skills' });
  await expect(library.getByText('Modo investigación', { exact: true })).toBeVisible();
  await library.getByRole('combobox', { name: 'Dependencias' }).selectOption('blocked');
  await expect(library.getByText('Configuración MCP de ECC', { exact: true })).toBeVisible();
  await expect(library.getByText('Modo investigación', { exact: true })).toHaveCount(0);
  await library.getByRole('combobox', { name: 'Dependencias' }).selectOption('');
  await library.getByLabel('Manifiesto JSON').setInputFiles({
    name: 'skill-manifest.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(skillManifestFixture())),
  });
  await library.getByRole('button', { name: 'Importar manifiesto' }).click();
  const skill = library.getByRole('region', { name: 'Detalle del material' });
  await expect(skill.getByText(skillFixtureText, { exact: true })).toBeVisible();
  await expect(skill.getByRole('button', { name: 'Aprobar versión' })).toBeDisabled();
  await skill.getByLabel('He revisado el contenido, la licencia y los recursos declarados').check();
  await skill.getByRole('button', { name: 'Aprobar versión' }).click();
  await expect(skill.getByText('Aprobada · MIT')).toBeVisible();
  await page.getByText('Biblioteca de skills', { exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo rol' }).press('Enter');
  await expect(page.getByLabel('Nombre del rol')).toBeFocused();
  await page.getByLabel('Nombre del rol').fill('Agente de suma');
  await page.getByLabel('Propósito', { exact: true }).fill('Resolver la suma de prueba.');
  await page.getByLabel('Instrucciones del rol').fill('Instrucciones congeladas de prueba.');
  await page.getByLabel('Formato de salida').fill('Resumen y pruebas.');
  await page.getByRole('button', { name: 'Crear rol', exact: true }).click();
  const history = page.getByRole('region', { name: 'Historial del rol' });
  await expect(history.getByText('Instrucciones congeladas de prueba.')).toBeVisible();
  await page.getByRole('button', { name: 'Crear versión' }).click();
  await page.getByLabel('Instrucciones del rol').fill('Instrucciones nuevas de prueba.');
  await page.getByRole('checkbox', { name: 'Guía de revisión de prueba · versión 1' }).check();
  await page.getByText('Ver texto que recibirá el modelo', { exact: true }).click();
  await expect(page.getByText(skillFixtureText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar nueva versión' }).click();
  await expect(history.getByText('Instrucciones nuevas de prueba.')).toBeVisible();
  await expect(history.getByText(/Guía de revisión de prueba · versión 1/)).toBeVisible();
  await page.getByLabel('Versión del historial').selectOption('1');
  await expect(history.getByText('Instrucciones congeladas de prueba.')).toBeVisible();
  await page.getByRole('link', { name: /Volver al proyecto/ }).click();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Presupuestos compartidos de Codex', { exact: true }).click();
  await page.getByLabel('Nombre del presupuesto').fill('Presupuesto de revisión');
  await page.getByRole('button', { name: 'Crear presupuesto', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Presupuesto de revisión', exact: true }),
  ).toBeVisible();
  await page.getByText('Nueva tarea con Codex', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Presupuesto de ejecución' })
    .selectOption({ label: 'Presupuesto de revisión · disponibles 8' });
  await page.getByRole('combobox', { name: 'Atribución de uso' }).selectOption('reviewer');
  await expect(page.getByText(/Proveedor simulado.*Herramientas Node aisladas/)).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Tarea de programación', exact: true })
    .selectOption(task.id);
  await page
    .getByRole('combobox', { name: 'Rol de agente', exact: true })
    .selectOption({ label: 'Agente de suma' }, { timeout: 5000 });
  await page
    .getByRole('combobox', { name: 'Versión del agente', exact: true })
    .selectOption('2', { timeout: 5000 });
  await expect(
    page.getByText('Material para el modelo: Guía de revisión de prueba v1.'),
  ).toBeVisible();
  await page.getByText('Ver texto que recibirá el modelo', { exact: true }).click();
  await expect(page.getByText(skillFixtureText, { exact: true })).toBeVisible();
  await page.getByText('Ver texto que recibirá el modelo', { exact: true }).click();
  await page.getByRole('button', { name: 'Ejecutar tarea con Codex', exact: true }).click();
  await expect(page.getByText('Estado: Completado', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Snapshot final recogido.', { exact: true })).toBeVisible();
  await expect(page.locator('.job-view').getByText(/Peticiones admitidas [1-9]/)).toBeVisible();
  await expect(page.locator('.job-view').getByText(/Revisor · Reserva inicial 8/)).toBeVisible();
  await page.getByText('Rol congelado · Agente de suma · versión 2', { exact: true }).click();
  await expect(
    page.locator('.job-view pre').filter({ hasText: 'Instrucciones nuevas de prueba.' }),
  ).toBeVisible();
  await expect(page.locator('.job-view pre').filter({ hasText: skillFixtureText })).toBeVisible();
  await page.getByText('src/add.cjs', { exact: true }).click();
  await expect(page.locator('.job-view pre').filter({ hasText: 'diff --git' })).toContainText(
    '+exports.add = (a, b) => a + b;',
  );
  await expect(page.getByRole('heading', { name: 'Comandos y pruebas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revisión y pull request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar PR borrador en GitHub' })).toBeDisabled();
  await page.getByLabel('Título de la PR', { exact: true }).fill('Corregir suma revisada');
  await page
    .getByLabel('Descripción de la PR', { exact: true })
    .fill('Se ha revisado el diff y la verificación del controlador.');
  await page
    .getByLabel('Valoración humana y limitaciones')
    .fill('Suma correcta; pruebas superadas en el contenedor.');
  await page
    .getByLabel('He revisado el diff, los resultados de pruebas y los criterios de aceptación.')
    .check();
  await page.getByRole('button', { name: 'Guardar revisión y borrador' }).click();
  await expect(page.getByText(/Revisión guardada · versión 1/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar PR borrador en GitHub' })).toBeEnabled();
  // Saving never publishes. Publication requires this separate explicit action.
  await expect(page.getByRole('link', { name: /Abrir PR #/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publicar PR borrador en GitHub' }).click();
  await expect(page.getByRole('link', { name: /Abrir PR #/ })).toHaveAttribute(
    'href',
    /https:\/\/github.com\/demo\/ferweb\/pull\/\d+/,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByRole('button', { name: /Fix addition.*Completado/ }).click();
  await expect(page.getByText('Snapshot final recogido.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Abrir PR #/ })).toBeVisible();
  await expect(page.getByLabel('Título de la PR', { exact: true })).toHaveValue(
    'Corregir suma revisada',
  );
  await expect(page.getByLabel('Título de la PR', { exact: true })).toBeDisabled();
  const [repeatResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/repeat'),
    ),
    page.getByRole('button', { name: 'Repetir con las mismas condiciones' }).click(),
  ]);
  expect(repeatResponse.status()).toBe(202);
  const repeatedJob = (await repeatResponse.json()).job;
  await expect(page.getByText(`Identificador: ${repeatedJob.id}`, { exact: true })).toBeVisible();
  await expect(
    page.getByText('Rol congelado · Agente de suma · versión 2', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Estado: Completado', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('cell', { name: 'Iguales', exact: true })).toHaveCount(2);
  const choices = page.getByLabel('Contrastar diff y pruebas con otra ejecución');
  const other = await choices.locator('option').nth(1).getAttribute('value');
  await choices.selectOption(other!);
  await expect(page.getByRole('heading', { name: 'Resultado de la otra ejecución' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/e9-codex-review-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const deniedRoute = `**/api/projects/${project.id}/coding/*`;
  await page.route(deniedRoute, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'github_access_denied', message: 'Acceso retirado de prueba.' },
      }),
    }),
  );
  await expect(page.getByText('Acceso retirado de prueba.', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole('heading', { name: 'Resumen del trabajo', exact: true })).toHaveCount(
    0,
  );
  await page.unroute(deniedRoute);
  const cancelTask = await post(`/projects/${project.id}/tasks`, {
    title: 'Cancel long command',
    description: 'Trabajo largo para comprobar parada.',
    priority: 'medium',
    status: 'todo',
    acceptanceCriteria: [],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByText('Nueva tarea con Codex', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Tarea de programación', exact: true })
    .selectOption(cancelTask.task.id);
  await page.getByRole('button', { name: 'Ejecutar tarea con Codex', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Detener Codex', exact: true })).toBeVisible();
  await expect(page.getByText(/peticiones: [1-9]/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Detener Codex', exact: true }).click();
  await expect(page.getByText('Estado: Cancelado', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  const foreign = await page.request.get(
    `/api/projects/${process.env.FERWEB_FOREIGN_PROJECT}/coding/capabilities`,
  );
  expect(foreign.status()).toBe(404);
  const foreignCatalog = await page.request.get(
    `/api/projects/${process.env.FERWEB_FOREIGN_PROJECT}/agents`,
  );
  expect(foreignCatalog.status()).toBe(404);
  expect(await foreignCatalog.text()).not.toContain('Instrucciones congeladas');
  await page
    .getByRole('navigation', { name: 'Navegación móvil' })
    .getByRole('link', { name: 'Agentes' })
    .click();
  await expect(page.getByRole('heading', { name: 'Agentes · Codex aislado' })).toBeVisible();
  await page.getByText('Biblioteca de skills', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Ver Guía de revisión de prueba v1' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Ver historial' }).click();
  await page.getByRole('button', { name: 'Archivar rol', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar archivo' }).click();
  await expect(page.getByText('Rol archivado. Historial de solo lectura.')).toBeVisible();
  const disconnect = await page.request.post('/api/github/disconnect', {
    headers: { Origin: origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
  expect(disconnect.status()).toBe(204);
  expect(errors).toEqual([]);
});
