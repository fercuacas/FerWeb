import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.request.post('/api/github/disconnect', {
    headers: { Origin: new URL(process.env.FERWEB_URL!).origin, 'X-FerWeb-Request': '1' },
    data: {},
  });
});

test('P18 local dependencies and claims persist; reviewed GitHub issue reconciles response loss without duplication on mobile', async ({
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
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post('/api' + path, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.status() === 204 ? null : r.json();
  };
  const auth = await post('/github/authorize', {});
  await page.goto(
    '/api/github/callback?state=' +
      new URL(auth.url).searchParams.get('state') +
      '&code=fixture-code',
  );
  await post('/github/installations', { installationId: 71 });
  const { project } = await post('/projects', {
    name: 'P18 browser coordination',
    description: 'Local authority and explicit GitHub actions',
  });
  const root = `/projects/${project.id}`;
  await post(root + '/github', { installationId: 71, repositoryId: 101, version: 0 });
  await post(root + '/github/sync', { version: 1 });
  const tasks = [];
  for (const title of [
    'P18 browser epic',
    'P18 browser child',
    'P18 browser prerequisite',
    'P18 browser remote issue',
  ])
    tasks.push(
      (
        await post(root + '/tasks', {
          title,
          description: 'Local text',
          priority: 'medium',
          status: 'todo',
          acceptanceCriteria: [],
        })
      ).task,
    );
  const [epic, child, dependency, remoteTask] = tasks;
  let failRead = true;
  await page.route(`**/api${root}/coordination`, async (route) => {
    if (failRead) {
      failRead = false;
      await route.fulfill({
        status: 503,
        json: {
          error: { code: 'fixture_unavailable', message: 'Servicio de prueba no disponible.' },
        },
      });
    } else await route.continue();
  });
  await page.goto(`/#/projects/${project.id}`);
  await page.getByText('Épicas, dependencias y GitHub', { exact: true }).click();
  const coordination = page.getByRole('region', { name: 'Coordinación del proyecto', exact: true });
  await coordination.getByRole('button', { name: 'Reintentar dependencias' }).click();
  await coordination.getByLabel('Tarea que coordinar').selectOption(epic.id);
  let editor = coordination.getByRole('form', { name: 'Coordinar tarea' });
  await editor.getByLabel('Tipo de trabajo').selectOption('epic');
  await editor.getByRole('button', { name: 'Guardar coordinación local' }).press('Enter');
  await expect(
    coordination.getByRole('button', { name: 'Épica · P18 browser epic', exact: true }),
  ).toBeVisible();
  await coordination.getByLabel('Tarea que coordinar').selectOption(child.id);
  editor = coordination.getByRole('form', { name: 'Coordinar tarea' });
  await editor.getByLabel('Épica superior').selectOption(epic.id);
  await editor.getByLabel('Reclamación local').selectOption('owner');
  await editor.getByRole('checkbox', { name: /P18 browser prerequisite/ }).check();
  await editor.getByLabel('Motivo del bloqueo local').fill('Pendiente de revisión humana');
  await editor.getByRole('button', { name: 'Guardar coordinación local' }).click();
  await expect(
    coordination.getByText('Espera a: P18 browser prerequisite', { exact: true }),
  ).toBeVisible();
  await expect(
    coordination.getByText('Bloqueo local: Pendiente de revisión humana', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel('Reclamación local')).toHaveValue('owner');
  const current = (await (await page.request.get('/api' + root + `/tasks/${child.id}`)).json())
    .task;
  const { title, description, priority, acceptanceCriteria, version } = current;
  const blocked = await page.request.patch('/api' + root + `/tasks/${child.id}`, {
    headers,
    data: { title, description, priority, acceptanceCriteria, version, status: 'in_progress' },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.code).toBe('task_blocked');

  await page.getByRole('button', { name: 'Repositorio GitHub', exact: true }).click();
  await page.getByText('Épicas, dependencias y GitHub', { exact: true }).click();
  await coordination.getByText('Vincular issues/PR y revisar acciones', { exact: true }).click();
  const remote = coordination.getByRole('region', { name: 'Vínculos y acciones GitHub' });
  await remote.getByLabel('Tarea para GitHub').selectOption(child.id);
  await remote.getByLabel('Issue o PR observada').selectOption('issue:1001');
  await remote.getByRole('button', { name: 'Vincular a la tarea local' }).click();
  await expect(remote.getByText(/ID 1001/)).toBeVisible();
  await expect(remote.getByText(/Responsables remotos: remote-observer/)).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar ahora', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora', exact: true })).toBeEnabled();
  await remote.getByRole('button', { name: 'Vincular a la tarea local' }).click();
  await remote.getByLabel('Tarea para GitHub').selectOption(remoteTask.id);
  await remote.getByLabel('Título de la issue').fill('P18 browser lost response');
  await remote.getByLabel('Cuerpo de la issue').fill('Contenido revisado desde el navegador.');
  await remote.getByRole('button', { name: 'Preparar vista previa de issue' }).press('Enter');
  let preview = remote.getByRole('region', { name: 'Vista previa de issue' });
  await expect(preview.locator('pre')).toContainText('Contenido revisado desde el navegador.');
  await expect(
    preview.getByRole('button', { name: 'Crear issue revisada en GitHub' }),
  ).toBeDisabled();
  await preview
    .getByRole('checkbox', { name: 'He revisado el contenido y el repositorio de esta issue' })
    .check();
  await preview.getByRole('button', { name: 'Crear issue revisada en GitHub' }).click();
  await expect(
    preview.getByRole('heading', { name: 'Issue · Resultado remoto incierto' }),
  ).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Crear issue revisada en GitHub' })).toHaveCount(
    0,
  );
  await preview.getByRole('button', { name: 'Reconciliar resultado remoto' }).press('Enter');
  await expect(preview.getByRole('heading', { name: 'Issue · Creación confirmada' })).toBeVisible();
  await expect(preview.getByRole('link', { name: /Abrir issue #/ })).toHaveAttribute(
    'href',
    /https:\/\/github.com\/demo\/ferweb\/issues\/\d+/,
  );
  const work = await (await page.request.get('/api' + root + '/github/work')).json();
  expect(work.links.filter((r: any) => r.taskId === child.id)).toHaveLength(1);
  expect(work.links.filter((r: any) => r.taskId === remoteTask.id)).toHaveLength(1);
  expect(work.actions).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByText('Épicas, dependencias y GitHub', { exact: true }).click();
  await coordination.getByText('Vincular issues/PR y revisar acciones', { exact: true }).click();
  await remote.getByLabel('Historial de acciones').selectOption(work.actions[0].id);
  preview = remote.getByRole('region', { name: 'Vista previa de issue' });
  await expect(preview.getByRole('heading', { name: 'Issue · Creación confirmada' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/p18-coordination-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const p = (await (await page.request.get('/api' + root)).json()).project;
  expect(
    (
      await page.request.patch('/api' + root, {
        headers,
        data: { version: p.version, archived: true },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByText('Épicas, dependencias y GitHub', { exact: true }).click();
  await coordination.getByLabel('Tarea que coordinar').selectOption(child.id);
  await expect(coordination.getByLabel('Reclamación local')).toHaveValue('owner');
  await expect(
    coordination.getByRole('button', { name: 'Guardar coordinación local' }),
  ).toBeDisabled();
  await post('/github/disconnect', {});
  await page.reload();
  await page.getByText('Épicas, dependencias y GitHub', { exact: true }).click();
  await coordination.getByText('Vincular issues/PR y revisar acciones', { exact: true }).click();
  await expect(remote.getByRole('alert')).toBeVisible();
  await expect(
    remote.getByText('Contenido revisado desde el navegador.', { exact: false }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
