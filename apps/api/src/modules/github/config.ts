import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const schema = z.strictObject({
  appId: z.number().int().positive(),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(16).max(500),
  appSlug: z.string().regex(/^[a-z0-9-]+$/),
  webhookSecret: z.string().min(32).max(500),
  encryptionKey: z
    .string()
    .refine(
      (value) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32,
    ),
  callbackUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) &&
      url.pathname === '/api/github/callback' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }),
});
export type GitHubConfig = z.infer<typeof schema>;
export async function loadGitHubConfig(
  file = process.env.GITHUB_CONFIG_FILE,
): Promise<GitHubConfig | null> {
  if (!file) return null;
  try {
    return schema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    throw new Error(
      'Invalid GitHub configuration file. Check docs/github.md; values are not logged.',
    );
  }
}
