import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const configSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: port.default(3001),
  PGHOST: z.string().min(1),
  PGPORT: port.default(5432),
  AI_SERVICE_URL: z.url().default('http://ai:8000'),
  QDRANT_URL: z.url().default('http://qdrant:6333'),
  AI_SERVICE_TOKEN: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith('replace-with-'))
    .optional(),
  APP_ORIGIN: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
    .transform((value) => new URL(value).origin),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z
    .string()
    .min(16)
    .refine(
      (value) => !value.startsWith('replace-with-'),
      'Generate a local password with npm run setup',
    ),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse({
    ...env,
    PORT: env.PORT ?? env.API_PORT,
    APP_ORIGIN: env.APP_ORIGIN || `http://127.0.0.1:${env.WEB_PORT ?? '5173'}`,
  });
  if (!result.success) {
    // Only report field names, never environment values or connection strings.
    throw new Error(
      `Invalid environment fields: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}. See .env.example.`,
    );
  }
  return result.data;
}

export type Config = ReturnType<typeof readConfig>;
