import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createPool } from '../../apps/api/dist/database.js';
import { readConfig } from '../../apps/api/dist/config.js';

test('P24 approves a schedule, pauses and resumes it, then reads a real blocked notification on mobile', async ({
  page,
}, info) => {
  test.setTimeout(80000);
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
    const authorization = await post('/github/authorize', {});
    await page.goto(
      '/api/github/callback?state=' +
        new URL(authorization.url).searchParams.get('state') +
        '&code=fixture-code',
    );
    await post('/github/installations', { installationId: 71 });
    const { project } = await post('/projects', { name: 'Automatizaciones P24', description: '' });
    const root = `/projects/${project.id}`;
    await post(root + '/github', { installationId: 71, repositoryId: 101, version: 0 });
    await post(root + '/github/sync', { version: 1 });
    const { role } = await post(root + '/agents', { template: 'implementer' });
    const { template } = await post(root + '/team-templates', {
      definition: {
        name: 'Equipo programado',
        description: 'Comprueba la entrega.',
        maxIterations: 1,
        limits: { maxRequests: 4, timeoutMs: 120000, concurrency: 1 },
        steps: [
          {
            key: 'implement',
            title: 'Implementar',
            role: { id: role.id, version: 1 },
            dependsOn: [],
            exitCriteria: ['Cambio verificado.'],
            requiredCapabilities: ['text', 'toolCalls', 'workspaceWrite'],
            maxRequests: 4,
          },
        ],
      },
    });
    const { task } = await post(root + '/tasks', {
      title: 'Verificar resultados del equipo',
      description: 'Revisar la suma.',
      priority: 'medium',
      status: 'todo',
      acceptanceCriteria: ['Suma correcta.'],
    });
    const { plan } = await post(root + '/team-plans', {
      requestId: randomUUID(),
      taskId: task.id,
      taskVersion: task.version,
      templateId: template.id,
      templateVersion: 1,
      mode: 'team',
      executionId: 'codex-v1',
      model: 'fixture-codex',
    });
    await post(root + `/team-plans/${plan.id}/approve`, { version: 1, hash: plan.hash });

    const catalog = `**/api${root}/automations`;
    await page.route(catalog, (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto(`/#${root}/automations`);
    const panel = page.getByRole('region', { name: 'Automatizaciones del proyecto' });
    await expect(panel.getByRole('alert')).toBeVisible();
    await page.unroute(catalog);
    await panel.getByRole('button', { name: 'Reintentar automatizaciones' }).press('Enter');
    await expect(panel.getByText('Todavía no hay avisos.')).toBeVisible();
    await expect(panel.getByText('Todavía no hay programaciones.')).toBeVisible();
    await panel.getByText('Nueva programación', { exact: true }).press('Enter');
    const form = panel.getByRole('form', { name: 'Preparar programación' });
    await form.getByLabel('Plan aprobado').selectOption(plan.id);
    await form.getByLabel('Nombre de la programación').fill('Seguimiento diario');
    const later = new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(11, 16);
    await form.getByLabel('Hora local diaria').fill(later);
    await form.getByLabel('Zona horaria IANA').fill('UTC');
    await form.getByLabel('Límite de fechas').fill('2');
    await form.getByRole('button', { name: 'Preparar borrador' }).press('Enter');
    const card = panel.locator('details.automation-card').filter({
      has: page.getByText('Seguimiento diario · Pendiente de autorización', { exact: true }),
    });
    await card.locator('summary').first().press('Enter');
    const approve = card.getByRole('button', { name: 'Activar programación' });
    await expect(approve).toBeDisabled();
    await card.getByLabel('Autorizo este plan, destinos y límites').check();
    await approve.press('Enter');
    await expect(panel.getByText('Seguimiento diario · Activa', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Pausar programación' }).press('Enter');
    await expect(panel.getByText('Seguimiento diario · En pausa', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Reanudar programación' }).press('Enter');
    await expect(panel.getByText('Seguimiento diario · Activa', { exact: true })).toBeVisible();

    // Advance only this fixture's slot and task revision in the disposable browser database.
    const config = readConfig();
    expect(config.POSTGRES_DB).toMatch(/^ferweb_browser_[a-f0-9]{12}$/);
    const db = createPool(config);
    try {
      const changed = await db.query(
        `WITH edited AS (UPDATE tasks SET version=version+1 WHERE project_id=$1 AND id=$2 RETURNING id)
         UPDATE automation_schedules SET next_run_at=clock_timestamp()-interval '1 second'
         WHERE project_id=$1 AND plan_id=$3 AND state='active' AND EXISTS (SELECT 1 FROM edited)`,
        [project.id, task.id, plan.id],
      );
      expect(changed.rowCount).toBe(1);
    } finally {
      await db.end();
    }
    const inbox = panel.getByRole('region', { name: 'Centro de notificaciones' });
    await expect(inbox.getByText('Bloqueo · Seguimiento diario')).toBeVisible({ timeout: 18000 });
    await expect(inbox.getByText('1 sin leer')).toBeVisible();
    await inbox.getByRole('button', { name: 'Marcar como leída' }).press('Enter');
    await expect(inbox.getByText('0 sin leer')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath('p24-automations-mobile.png') });
    await page.reload();
    await expect(inbox.getByText('Bloqueo · Seguimiento diario')).toHaveCount(1);
    await expect(inbox.getByText('0 sin leer')).toBeVisible();
    const archive = await page.request.patch('/api' + root, {
      headers,
      data: { archived: true, version: project.version },
    });
    expect(archive.ok()).toBeTruthy();
    await page.reload();
    await expect(panel.getByText(/Proyecto archivado/)).toBeVisible();
    await expect(panel.getByText('Nueva programación', { exact: true })).toHaveCount(0);
    await expect(inbox.getByText('Bloqueo · Seguimiento diario')).toHaveCount(1);
  } finally {
    await post('/github/disconnect', {});
  }
});
