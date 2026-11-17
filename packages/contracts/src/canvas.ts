import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const element = z.string().min(1).max(240);
const text = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]*$/u);
export const canvasKind = z.enum(['plan', 'diff', 'recipe']);
export const canvasEntryInput = z
  .strictObject({
    requestId: z.uuid(),
    hash,
    element,
    action: z.enum(['comment', 'reply', 'request_changes', 'approve']),
    text: text.optional(),
    replyTo: z.uuid().optional(),
  })
  .refine(
    (input) =>
      (input.action === 'reply') === !!input.replyTo &&
      (input.action === 'approve' || !!input.text),
  );
const entry = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  hash,
  element,
  action: canvasEntryInput.shape.action,
  text: text.nullable(),
  replyTo: z.uuid().nullable(),
  author: z.email(),
  createdAt: z.iso.datetime(),
});
export const canvasResponse = z.object({
  hash,
  version: z.number().int().positive(),
  elements: z
    .array(z.object({ id: element, title: z.string(), htmlDownload: z.literal(true).optional() }))
    .max(110),
  decision: z.enum(['approve', 'request_changes']).nullable(),
  entries: z.array(entry).max(200),
});
export type CanvasKind = z.infer<typeof canvasKind>;
export type CanvasEntryInput = z.infer<typeof canvasEntryInput>;
