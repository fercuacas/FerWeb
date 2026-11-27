import { z } from 'zod';
import { executionBudgetLimits } from './usage.js';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().positive();
const instant = z.iso.datetime();
const zone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Usa una zona IANA válida.');
export const automationCalendar = z.strictObject({
  timeZone: zone,
  time: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
});
export const automationCreate = z.strictObject({
  requestId: z.uuid(),
  planId: z.uuid(),
  planHash: hash,
  title: z.string().trim().min(1).max(100),
  calendar: automationCalendar,
  maxOccurrences: z.number().int().min(1).max(100),
});
export const automationAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('approve'), revision, hash }),
  z.strictObject({ action: z.enum(['pause', 'resume', 'cancel']), revision }),
]);
export const automationSnapshot = automationCreate.omit({ requestId: true }).extend({
  format: z.literal(1),
  taskId: z.uuid(),
  taskVersion: revision,
  templateName: z.string(),
  templateVersion: revision,
  planVersion: z.literal(1),
  repository: z.string(),
  repositoryId: revision,
  linkVersion: revision,
  teamPolicyVersion: revision,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  destination: z.enum(['local', 'api', 'mixed']),
  apiRequestLimit: z.number().int().min(0).max(20),
  stages: z
    .array(
      z.object({
        key: z.string(),
        executionId: z.enum(['local-readonly-v1', 'codex-local-v1', 'codex-v1']),
        model: z.string().nullable(),
      }),
    )
    .min(1)
    .max(6),
  limits: executionBudgetLimits,
});
export const automationSchedule = z.object({
  id: z.uuid(),
  snapshot: automationSnapshot,
  hash,
  revision,
  state: z.enum(['draft', 'active', 'paused', 'blocked', 'exhausted', 'cancelled']),
  nextRunAt: instant.nullable(),
  observedCount: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});
export const automationOccurrence = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  dueAt: instant,
  disposition: z.enum(['admitted', 'skipped', 'blocked']),
  reason: z.string().nullable(),
  teamId: z.uuid().nullable(),
  teamState: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).nullable(),
});
export const automationNotificationId = z
  .string()
  .max(130)
  .regex(/^[a-z0-9_:-]+$(?![\s\S])/);
export const automationNotification = z.object({
  id: automationNotificationId,
  title: z.string(),
  kind: z.enum(['completed', 'failed', 'blocked', 'action_required']),
  occurrence: automationOccurrence,
  createdAt: instant,
  readAt: instant.nullable(),
});
export const automationOverview = z.object({
  schedules: z.array(automationSchedule),
  occurrences: z.array(automationOccurrence),
  notifications: z.array(automationNotification),
  unread: z.number().int().nonnegative(),
});
export type AutomationCalendar = z.infer<typeof automationCalendar>;
export type AutomationCreate = z.infer<typeof automationCreate>;
export type AutomationAction = z.infer<typeof automationAction>;
export type AutomationSchedule = z.infer<typeof automationSchedule>;
export type AutomationOverview = z.infer<typeof automationOverview>;
