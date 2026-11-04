import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
}
test('complete owner journey persists projects, tasks, filters, archival and restored edits', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('.artifacts', { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar en FerWeb' })).toBeVisible();
  await page.screenshot({
    path: '.artifacts/e2-login.png',
    fullPage: true,
    animations: 'disabled',
  });
  await login(page);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === 'ferweb_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('ferweb_session');
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Calendario de pruebas');
  await page
    .getByLabel('Descripción', { exact: true })
    .fill('Un recorrido completo con datos persistentes.');
  await page.route('**/api/projects', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'test_outage', message: 'Servicio temporalmente no disponible.' },
          }),
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Servicio temporalmente no disponible.');
  await expect(page.getByLabel('Nombre del proyecto')).toHaveValue('Calendario de pruebas');
  await page.unroute('**/api/projects');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Calendario de pruebas/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Calendario de pruebas', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Nueva tarea/ }).click();
  await page.getByLabel('Título de la tarea').fill('Revisar el calendario');
  await page.getByLabel('Descripción de la tarea').fill('Comprobar la persistencia y el acceso.');
  await page.getByRole('combobox', { name: 'Prioridad', exact: true }).selectOption('high');
  await page
    .getByLabel('Criterios de aceptación')
    .fill('Los datos sobreviven al reinicio\nOtra cuenta no puede acceder');
  await page.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Por hacer', exact: true })
      .getByRole('button', { name: /Revisar el calendario/ }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Revisar el calendario/ }).click();
  await expect(page.getByLabel('Criterios de aceptación')).toHaveValue(
    'Los datos sobreviven al reinicio\nOtra cuenta no puede acceder',
  );
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('in_progress');
  await page.getByRole('button', { name: 'Guardar tarea', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'En curso', exact: true })
      .getByRole('button', { name: /Revisar el calendario/ }),
  ).toBeVisible();
  await page.getByLabel('Filtrar prioridad').selectOption('low');
  await expect(page.getByRole('status', { name: 'Estado del tablero' })).toHaveText(
    '0 tareas visibles',
  );
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByRole('searchbox', { name: 'Buscar tareas' }).fill('no coincide');
  await expect(page.getByRole('status', { name: 'Estado del tablero' })).toHaveText(
    '0 tareas visibles',
  );
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByLabel('Filtrar estado').selectOption('in_progress');
  await expect(page.getByRole('button', { name: /Revisar el calendario/ })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByRole('button', { name: 'Editar proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Calendario revisado');
  await page.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Calendario revisado', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Archivar', exact: true }).click();
  await page.getByRole('button', { name: 'Archivar proyecto', exact: true }).click();
  await expect(page.getByRole('button', { name: /Nueva tarea/ })).toBeDisabled();
  await page.getByRole('button', { name: /Revisar el calendario/ }).click();
  await expect(page.getByLabel('Título de la tarea')).toBeDisabled();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('link', { name: 'Todos los proyectos', exact: false }).click();
  await page.getByRole('button', { name: 'Archivados', exact: true }).click();
  await page.getByRole('link', { name: /Calendario revisado/ }).click();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar proyecto', exact: true }).click();
  await expect(page.getByRole('button', { name: /Nueva tarea/ })).toBeEnabled();
  await page.getByRole('button', { name: /Revisar el calendario/ }).click();
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('done');
  await page.getByRole('button', { name: 'Guardar tarea', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Hecho', exact: true })
      .getByRole('button', { name: /Revisar el calendario/ }),
  ).toBeVisible();
  await page.screenshot({
    path: '.artifacts/e2-board-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.artifacts/e2-board-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar en FerWeb' })).toBeVisible();
  expect((await context.request.get('/api/projects')).status()).toBe(401);
  await login(page);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await page.getByRole('link', { name: /Calendario revisado/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Hecho', exact: true })
      .getByRole('button', { name: /Revisar el calendario/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('foreign project and task IDs cannot be read or changed through the browser session', async ({
  page,
  context,
}) => {
  await login(page);
  const project = process.env.FERWEB_FOREIGN_PROJECT!;
  const task = process.env.FERWEB_FOREIGN_TASK!;
  expect((await context.request.get(`/api/projects/${project}`)).status()).toBe(404);
  expect((await context.request.get(`/api/projects/${project}/tasks`)).status()).toBe(404);
  expect((await context.request.get(`/api/projects/${project}/tasks/${task}`)).status()).toBe(404);
  expect(
    (
      await context.request.patch(`/api/projects/${project}`, {
        headers: { Origin: process.env.FERWEB_URL!, 'X-FerWeb-Request': '1' },
        data: { name: 'Changed', version: 1 },
      })
    ).status(),
  ).toBe(404);
  await page.goto(`/#/projects/${project}`);
  await expect(page.getByRole('alert')).toHaveText('No se ha encontrado el recurso.');
  await expect(page.getByText('Proyecto reservado', { exact: true })).toHaveCount(0);
});

test('mobile forms and project list fit and keyboard focus stays inside the editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await expect(page.getByLabel('Nombre del proyecto')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.getByRole('dialog').evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('invalid credentials stay visible and a revoked session returns to login', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('alert')).toHaveText('El correo o la contraseña no son correctos.');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await expect(page.getByRole('heading', { name: /Tu próximo paso/ })).toBeVisible();
  expect(
    (
      await context.request.post('/api/auth/logout', {
        headers: { Origin: process.env.FERWEB_URL!, 'X-FerWeb-Request': '1' },
        data: {},
      })
    ).status(),
  ).toBe(204);
  await page.goto(`/#/projects/${process.env.FERWEB_FOREIGN_PROJECT!}`);
  await expect(page.getByRole('button', { name: 'Entrar en FerWeb' })).toBeVisible();
  await expect(page.getByText('Calendario revisado', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Proyecto reservado', { exact: true })).toHaveCount(0);
});
