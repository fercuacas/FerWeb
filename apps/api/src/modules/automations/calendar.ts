import type { AutomationCalendar } from '@ferweb/contracts';

const hour = 60 * 60 * 1000;
const day = 24 * hour;

export function nextOccurrence(calendar: AutomationCalendar, after: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: calendar.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  // A local civil time encoded as UTC for arithmetic only.
  const civil = (epoch: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(epoch).map(({ type, value }) => [type, Number(value)]),
    );
    return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  };
  const midnight = Math.floor(civil(after.getTime()) / day) * day;
  const [hours, minutes] = calendar.time.split(':').map(Number);
  for (let offset = 0; offset < 8; offset++) {
    const wallTime = midnight + offset * day + hours! * hour + minutes! * 60_000;
    const candidates = [-36, -12, 0, 12, 36].map((hours) => {
      const sample = wallTime + hours * hour;
      return wallTime - (civil(sample) - sample);
    });
    // Gap: no candidate. Fold: the earlier real instant owns that entire local day.
    const first = Math.min(...candidates.filter((candidate) => civil(candidate) === wallTime));
    if (Number.isFinite(first) && first > after.getTime()) return new Date(first);
  }
  throw new Error('No se encontró una fecha para el calendario.');
}
