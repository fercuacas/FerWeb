import { z } from 'zod';
import { agentSelection, agentSnapshot } from './agents.js';
import { skillVersion } from './skills.js';
import { teamTemplateVersion } from './teams.js';

const hash = z.string().regex(/^[a-f0-9]{64}$(?![\s\S])/);
const word = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\x00-\x1f\x7f]+$(?![\s\S])/);
export const extensionSlug = z
  .string()
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/);
export const extensionVersion = z
  .string()
  .max(24)
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$(?![\s\S])/);
export const extensionPath = z
  .string()
  .max(100)
  .regex(/^(?:[a-z0-9][a-z0-9_-]*\/){0,2}[a-z0-9][a-z0-9_-]*\.(?:md|txt|json)$(?![\s\S])/)
  .refine((path) =>
    path.split('/').every((part) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(part)),
  );
const textResource = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uD800-\uDFFF]*$/u);
export const extensionFile = z.strictObject({
  path: extensionPath,
  text: textResource,
  sha256: hash,
});
export const extensionManifest = z.strictObject({
  format: z.literal(1),
  slug: extensionSlug,
  name: word,
  version: extensionVersion,
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('upload'), label: word }),
    z.strictObject({
      kind: z.literal('github'),
      repository: z
        .string()
        .max(120)
        .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_-]+$(?![\s\S])/),
      commit: z.string().regex(/^[a-f0-9]{40}$(?![\s\S])/),
      path: z
        .string()
        .max(200)
        .regex(/^(?:[A-Za-z0-9_-]+\/){0,8}[A-Za-z0-9_-]+\.(?:md|txt|json)$(?![\s\S])/i),
    }),
  ]),
  license: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$(?![\s\S])/),
  notice: textResource.max(4096),
  resources: z
    .array(extensionFile)
    .min(1)
    .max(6)
    .refine((files) => new Set(files.map(({ path }) => path)).size === files.length),
  capabilities: z.tuple([z.literal('read-resource')]),
  dependencies: z.tuple([
    z.strictObject({
      kind: z.literal('builtin'),
      name: z.literal('fixture-reader'),
      version: z.literal('1.0.0'),
    }),
  ]),
  destinations: z.tuple([z.literal('project-local')]),
});
export type ExtensionManifest = z.infer<typeof extensionManifest>;
const revision = z.number().int().min(1).max(2147483647);
const current = z.strictObject({ revision });
const config = z.strictObject({ path: extensionPath });
const previewHash = current.extend({ previewHash: hash });
export const extensionImport = z.union([
  z.strictObject({ manifest: extensionManifest }),
  z.strictObject({ fixture: z.literal('fixture-reader') }),
]);
export const extensionAction = z.discriminatedUnion('action', [
  current.extend({ action: z.literal('select'), version: extensionVersion }),
  current.extend({ action: z.literal('configure'), config }),
  previewHash.extend({ action: z.literal('review') }),
  previewHash.extend({ action: z.literal('enable') }),
  previewHash.extend({ action: z.literal('withdraw') }),
  current.extend({ action: z.literal('edit'), path: extensionPath, text: textResource }),
]);
export const extensionOperation = z.strictObject({
  revision,
  requestId: z.uuid(),
  operation: z.literal('read-resource'),
});
export const extensionPreviewKind = z.enum(['enable', 'withdraw']);
export const extensionPreview = z.object({
  operation: extensionPreviewKind,
  sha256: hash,
  revision,
  changes: z.array(
    z.object({
      path: extensionPath,
      action: z.enum(['add', 'update', 'hide', 'preserve', 'keep']),
      before: hash.nullable(),
      after: hash.nullable(),
    }),
  ),
});
const state = z.enum(['imported', 'configured', 'reviewed', 'enabled', 'withdrawn']);
const summary = z.object({
  id: z.uuid(),
  slug: extensionSlug,
  name: word,
  version: extensionVersion,
  revision,
  state,
});
const release = z.object({ version: extensionVersion, sha256: hash });
const resource = extensionFile.extend({
  owner: z.enum(['extension', 'project']),
  visible: z.boolean(),
});
export const extensionRun = z.object({
  id: z.uuid(),
  version: extensionVersion,
  manifestHash: hash,
  path: extensionPath,
  resourceHash: hash,
  destination: z.literal('project-local'),
  text: textResource,
});
export const extensionsResponse = z.object({ extensions: z.array(summary) });
export const extensionDetail = summary.extend({
  manifest: extensionManifest,
  sha256: hash,
  config: config.nullable(),
  releases: z.array(release),
  resources: z.array(resource),
  events: z.array(
    z.object({
      id: z.uuid(),
      action: z.enum([
        'import',
        'select',
        'configure',
        'review',
        'enable',
        'withdraw',
        'edit',
        'run',
      ]),
      revision,
      version: extensionVersion,
      recordedAt: z.iso.datetime(),
      resourceHash: hash.nullable(),
      path: extensionPath.nullable(),
    }),
  ),
  enablePreview: extensionPreview,
  withdrawPreview: extensionPreview,
});
export type ExtensionDetail = z.infer<typeof extensionDetail>;

export const portableSelection = z
  .strictObject({
    role: agentSelection.optional(),
    skillId: z.uuid().optional(),
    workflow: agentSelection.optional(),
  })
  .refine((value) => !!(value.role || value.skillId || value.workflow));
export const portableDownload = z.strictObject({ selection: portableSelection, sha256: hash });
export const portableBundle = z.strictObject({
  format: z.literal('ferweb-portable-v1'),
  roles: z.array(agentSnapshot).max(7),
  skills: z.array(skillVersion).max(22),
  workflow: teamTemplateVersion.nullable(),
});
export type PortableBundle = z.infer<typeof portableBundle>;
export const portablePreview = z.object({
  sha256: hash,
  roles: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  workflow: z.boolean(),
  files: z.array(z.object({ path: z.string().max(350), sha256: hash })),
});
