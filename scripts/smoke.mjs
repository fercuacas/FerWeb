import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readinessSchema } from '@ferweb/contracts';

export async function checkSmoke(baseUrl = 'http://127.0.0.1:5173', waitMs = 0) {
  const page = await fetch(baseUrl, { signal: AbortSignal.timeout(8000) });
  assert.equal(page.status, 200, 'Web must respond');
  assert.match(await page.text(), /FerWeb/);
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      const response = await fetch(new URL('/api/health/ready', baseUrl), {
        signal: AbortSignal.timeout(waitMs ? 2000 : 8000),
      });
      const payload = readinessSchema.parse(await response.json());
      assert.equal(response.status, 200, 'Database and migrations must be ready');
      assert.equal(payload.status, 'ready');
      assert.ok(payload.installation?.id);
      console.log('PASS: web, API proxy, database, migrations and installation record.');
      return payload;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
) {
  // Rebuilding the shared contract may briefly restart the watched API.
  await checkSmoke(process.env.FERWEB_URL, 10000);
}
