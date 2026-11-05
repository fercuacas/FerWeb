import { z } from 'zod';
import { executionOptionSchema } from './execution.js';

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$(?![\s\S])/);
const plainText = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u);
const originPath = z
  .string()
  .max(160)
  .regex(
    /^(?:[a-z0-9][a-z0-9_-]{0,59}\/){0,5}[a-z0-9][a-z0-9_.-]{0,79}\.(?:md|txt|json)$(?![\s\S])/i,
  )
  .refine(
    (path) => !path.split('/').some((part) => part.includes('..') || /^agents\.md$/i.test(part)),
  );
const filePath = originPath.refine((path) => /\.(?:md|txt)$/i.test(path));
const filename = z.strictObject({ path: filePath, sha256 });
export const skillFile = filename.extend({ text: plainText.min(1).max(12288) });
const resource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), name: filePath }),
  z.strictObject({
    kind: z.enum(['script', 'hook', 'mcp', 'external', 'runtime']),
    name: plainText.trim().min(1).max(160),
  }),
]);
const metadata = z.strictObject({
  slug,
  name: plainText.trim().min(1).max(120),
  description: plainText.trim().min(1).max(600),
  purpose: z.enum(['skill', 'rule', 'development', 'research', 'review']),
  technologies: z.array(plainText.trim().toLowerCase().min(1).max(40)).min(1).max(8),
  license: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$(?![\s\S])/),
  notice: plainText.min(1).max(4096),
  requiredCapabilities: z.array(executionOptionSchema.shape.capabilities.keyof()).min(1).max(7),
  allowedToolProfiles: z.array(executionOptionSchema.shape.toolProfile).min(1).max(2),
  resources: z.array(resource).max(12),
});
export const skillManifest = metadata.extend({
  format: z.literal(1),
  source: plainText.trim().min(1).max(240),
  files: z
    .array(
      filename.extend({
        type: z.literal('file'),
        contentBase64: z
          .string()
          .min(4)
          .max(16384)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      }),
    )
    .min(1)
    .max(6),
});
export const skillImportInput = z.union([
  z.strictObject({ manifest: skillManifest }),
  z.strictObject({ curated: slug }),
]);
export const skillOrigin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upload'), source: plainText.max(240) }),
  z.strictObject({
    kind: z.literal('ecc'),
    repository: z.literal('affaan-m/ECC'),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    path: originPath,
  }),
]);
export const skillContent = metadata.extend({
  origin: skillOrigin,
  files: z.array(skillFile).min(1).max(6),
});
export const skillReview = z.enum(['pending', 'approved', 'rejected']);
export const skillReviewInput = z.strictObject({
  sha256,
  state: z.enum(['approved', 'rejected']),
});
export const skillVersion = skillContent.extend({
  id: z.uuid(),
  version: z.number().int().positive().max(50),
  sha256,
  review: skillReview,
});
export const skillReference = skillVersion.pick({
  id: true,
  version: true,
  name: true,
  sha256: true,
  requiredCapabilities: true,
  allowedToolProfiles: true,
});
export const skillLinks = z
  .array(z.uuid())
  .max(3)
  .refine((ids) => new Set(ids).size === ids.length);
export const skillSummary = skillVersion.omit({ files: true, notice: true });
export const skillsResponse = z.object({
  versions: z.array(skillSummary),
  curated: z.array(skillContent.omit({ files: true, notice: true })),
});
export const skillResponse = z.object({ skill: skillVersion });
export type SkillManifest = z.infer<typeof skillManifest>;
export type SkillContent = z.infer<typeof skillContent>;
export type SkillVersion = z.infer<typeof skillVersion>;
export type SkillSummary = z.infer<typeof skillSummary>;
export const skillPromptLimit = 24 * 1024;
export function skillIsPortable(skill: Pick<SkillContent, 'resources'>) {
  return skill.resources.every((item) => item.kind === 'file');
}
export function skillPromptMaterial(skill: SkillVersion) {
  return {
    name: skill.name,
    license: skill.license,
    notice: skill.notice,
    files: skill.files.map(({ path, text }) => ({ path, text })),
  };
}
