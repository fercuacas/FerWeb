import { readFile } from 'node:fs/promises';
import { createController } from './controller.mjs';
try {
  const configuration = process.env.FERWEB_CODEX_CONFIG
    ? JSON.parse(await readFile(process.env.FERWEB_CODEX_CONFIG, 'utf8'))
    : { apiKey: null, models: [] };
  if (
    !Array.isArray(configuration.models) ||
    configuration.models.some(
      (m) => typeof m !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(m),
    ) ||
    (configuration.apiKey !== null &&
      (typeof configuration.apiKey !== 'string' || configuration.apiKey.length < 20))
  )
    throw Error('invalid_config');
  const controller = await createController({
    token: process.env.RUNNER_SERVICE_TOKEN,
    configuration,
    namespace: process.env.RUNNER_NAMESPACE,
    volume: process.env.RUNNER_RUNTIME_VOLUME,
  });
  controller.server.listen(8010, '0.0.0.0');
  process.on('SIGTERM', () => void controller.close().then(() => process.exit(0)));
} catch (error) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'runner',
      event: 'runner_start_failed',
      ...(error instanceof Error &&
        error.message === 'docker_api_incompatible' && { reason: 'docker_api_incompatible' }),
    }),
  );
  process.exit(1);
}
