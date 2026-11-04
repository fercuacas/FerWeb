import { setTimeout as delay } from 'node:timers/promises';
import { processControl } from './protocol.js';

// Trusted simulator only. No command, script, workspace, credentials or URL from a job is executed.
let leaseUntil = Date.now() + 5000,
  deadline = leaseUntil,
  started = false,
  ignoreTermination = false,
  sequence = 0;
const pending = new Map<number, (value: boolean) => void>();
const watchdog = setInterval(() => {
  if (Date.now() >= deadline) process.exit(124);
  if (Date.now() >= leaseUntil) process.exit(70);
}, 100);
process.on('disconnect', () => process.exit(70));
process.on('SIGTERM', () => {
  if (!ignoreTermination) process.exit(0);
});
function request(type: 'reserve' | 'commit', step: number) {
  return new Promise<boolean>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, resolve);
    if (!process.send || !process.connected) {
      reject(new Error('parent_disconnected'));
      return;
    }
    process.send({ type, request: id, step }, (error) => {
      if (error) reject(error);
    });
  });
}
process.on('message', (raw) => {
  const parsed = processControl.safeParse(raw);
  if (!parsed.success) process.exit(2);
  const message = parsed.data;
  if (message.type === 'ack') {
    pending.get(message.request)?.(message.committed);
    pending.delete(message.request);
    return;
  }
  leaseUntil = Date.parse(message.leaseExpiresAt);
  deadline = Date.parse(message.deadlineAt);
  if (message.type === 'renew') return;
  if (started) process.exit(2);
  started = true;
  ignoreTermination = message.simulation.ignoreTermination;
  void (async () => {
    const cfg = message.simulation;
    for (let step = message.startStep; step <= cfg.steps; step++) {
      const committed = await request('reserve', step);
      if (committed) continue;
      await delay(cfg.stepDelayMs);
      const fail =
        step === cfg.failureStep &&
        (cfg.failure === 'permanent' || message.attempt <= cfg.failuresBeforeSuccess);
      if (fail && cfg.failure === 'permanent') process.exit(2);
      if (fail && cfg.failure === 'transient') process.exit(75);
      await request('commit', step);
      if (fail && cfg.failure === 'after_commit') process.exit(75);
    }
    clearInterval(watchdog);
    process.exit(0);
  })().catch(() => process.exit(2));
});
