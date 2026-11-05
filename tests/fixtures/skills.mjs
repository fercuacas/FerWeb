import { createHash } from 'node:crypto';

export const skillFixtureText = 'P03 frozen material marker. Review the sum and report evidence.';
export function skillManifestFixture(text = skillFixtureText) {
  const bytes = Buffer.from(text);
  return {
    format: 1,
    slug: 'review-fixture',
    name: 'Guía de revisión de prueba',
    description: 'Material estático para la revisión de la suma.',
    purpose: 'review',
    technologies: ['node'],
    license: 'MIT',
    notice: 'Aviso de licencia de la fixture de FerWeb.',
    source: 'http://127.0.0.1:1/source-is-declarative',
    requiredCapabilities: ['text'],
    allowedToolProfiles: ['node-isolated-v1'],
    resources: [{ kind: 'file', name: 'guides/review.md' }],
    files: [
      {
        path: 'guides/review.md',
        type: 'file',
        contentBase64: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
}
