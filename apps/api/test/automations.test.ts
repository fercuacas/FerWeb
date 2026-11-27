import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automationCalendar } from '@ferweb/contracts';
import { nextOccurrence } from '../src/modules/automations/calendar.js';

test('automation calendar skips missing civil time and admits the first fold only', () => {
  const madrid = { time: '02:30', timeZone: 'Europe/Madrid' };
  const next = (after: string) => nextOccurrence(madrid, new Date(after)).toISOString();
  assert.equal(next('2026-03-28T01:30:00Z'), '2026-03-30T00:30:00.000Z');
  assert.equal(next('2026-10-24T00:30:00Z'), '2026-10-25T00:30:00.000Z');
  assert.equal(next('2026-10-25T00:31:00Z'), '2026-10-26T01:30:00.000Z');
  assert.equal(next('2026-10-25T01:30:00Z'), '2026-10-26T01:30:00.000Z');
});

test('automation calendar uses an explicit IANA zone independent of the host clock', () => {
  const after = new Date('2026-11-27T03:14:23.000Z');
  const calendar = automationCalendar.parse({ time: '09:00', timeZone: 'Asia/Kathmandu' });
  assert.equal(nextOccurrence(calendar, after).toISOString(), '2026-11-27T03:15:00.000Z');
  assert.equal(automationCalendar.safeParse({ time: '09:00', timeZone: '+05:45' }).success, false);
  assert.equal(
    automationCalendar.safeParse({ time: '24:00', timeZone: 'Europe/Madrid' }).success,
    false,
  );
  assert.equal(
    automationCalendar.safeParse({ time: '09:00', timeZone: 'Unknown/Madrid' }).success,
    false,
  );
});
