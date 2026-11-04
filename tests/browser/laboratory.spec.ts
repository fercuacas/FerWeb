import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('laboratory freezes context, repeats local/API models, reviews quality and exports results', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.FERWEB_TEST_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.FERWEB_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar en FerWeb' }).click();
  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.getByLabel('Nombre del proyecto').fill('Comparaciones de modelos');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('link', { name: /Comparaciones de modelos/ }).click();
  await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Laboratorio de modelos', exact: true }),
  ).toBeVisible();
  await page.getByText('Nuevo caso congelado', { exact: true }).click();
  await page.getByLabel('Nombre del caso', { exact: true }).fill('Autenticación congelada');
  await page.getByLabel('Pregunta del caso').fill('¿Cómo se protegen las contraseñas?');
  await page
    .getByLabel('Contexto manual congelado')
    .fill('Las contraseñas usan scrypt y la cookie es HttpOnly.');
  await page
    .getByLabel('Criterio de evaluación 1', { exact: true })
    .fill('Identifica scrypt como protección');
  await page.getByLabel('Texto esperado 1 (opcional)', { exact: true }).fill('scrypt');
  await page.getByRole('button', { name: 'Guardar caso congelado', exact: true }).click();
  await expect(page.getByText('Caso congelado guardado.', { exact: true })).toBeVisible();
  await page.getByText('Registrar tarifa fechada', { exact: true }).click();
  await page.getByLabel('Modelo exacto de tarifa').fill('fixture-chat');
  await page.getByLabel('Vigente desde', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Verificada el', { exact: true }).fill('2026-11-02');
  await page.getByLabel('Fuente de la tarifa (HTTPS)').fill('https://example.com/synthetic-tariff');
  await page.getByLabel('Entrada USD / millón', { exact: true }).fill('2');
  await page.getByLabel('Entrada en caché USD / millón', { exact: true }).fill('1');
  await page.getByLabel('Salida USD / millón', { exact: true }).fill('4');
  await page
    .getByLabel('Notas y alcance de tarifa')
    .fill('Tarifas sintéticas de prueba: solo tokens de texto.');
  for (const provider of ['ollama', 'openai']) {
    await page
      .getByRole('combobox', { name: 'Proveedor de tarifa', exact: true })
      .selectOption(provider);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/lab/tariffs') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
    expect((await response).status()).toBe(201);
  }
  await page.getByText('Preparar comparación', { exact: true }).click();
  await page.getByLabel('Nombre de la comparación', { exact: true }).fill('Local frente a API');
  await page.getByRole('checkbox', { name: /Autenticación congelada/ }).check();
  await page.getByRole('combobox', { name: 'Modelo 1', exact: true }).selectOption('fixture-chat');
  await page.getByRole('combobox', { name: 'Tarifa 1', exact: true }).selectOption({ index: 1 });
  await page.getByRole('combobox', { name: 'Proveedor 2', exact: true }).selectOption('openai');
  await page.getByRole('combobox', { name: 'Modelo 2', exact: true }).selectOption('fixture-chat');
  await page.getByRole('combobox', { name: 'Tarifa 2', exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel('Entorno y condiciones declaradas')
    .fill('Navegador, Python y PostgreSQL reales; modelos simulados.');
  await page.getByRole('checkbox', { name: /Autorizo enviar preguntas/ }).check();
  await page.getByRole('button', { name: 'Guardar comparación', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Local frente a API', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ejecutar comparación', exact: true }).click();
  await expect(page.getByText('Estado del lote: Finalizado', { exact: true })).toBeVisible();
  expect(await page.locator('.lab-run').count()).toBe(4);
  const run = page.locator('.lab-run').first();
  await run.locator('summary').first().click();
  await expect(run.getByText(/cookie HttpOnly; contraseñas scrypt/)).toBeVisible();
  await run.getByRole('combobox', { name: 'Calidad (0–5)', exact: true }).selectOption('5');
  await run.getByRole('checkbox', { name: 'Resultado aceptable tras revisión humana' }).check();
  await run.getByLabel('Notas de revisión').fill('Respuesta revisada manualmente.');
  await run.getByRole('button', { name: 'Guardar valoración', exact: true }).click();
  await expect(run.locator('summary').first()).toContainText('Aceptable');
  await expect(page.getByRole('cell', { name: '0.00056 USD', exact: false })).toBeVisible();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar JSON', exact: true }).click();
  await (await jsonDownload).saveAs('test-results/e6-lab.json');
  const exported = JSON.parse(await readFile('test-results/e6-lab.json', 'utf8'));
  expect(exported.format).toBe('ferweb-lab-export-v1');
  expect(exported.batch.runs).toHaveLength(4);
  expect(exported.batch.runs[0].reviews[0].accepted).toBe(true);
  expect(exported.batch.conditions.cases[0].context).toContain('scrypt');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV', exact: true }).click();
  await (await csvDownload).saveAs('test-results/e6-lab.csv');
  expect(await readFile('test-results/e6-lab.csv', 'utf8')).toContain('context_hash');
  await page.reload();
  await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
  await page.getByRole('button', { name: /Local frente a API/ }).click();
  await expect(page.locator('.lab-run').first().locator('summary').first()).toContainText(
    'Aceptable',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/e6-lab-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
