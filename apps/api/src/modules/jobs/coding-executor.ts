import { setTimeout as delay } from 'node:timers/promises';
import { codingReport, codingWorkspace } from '@ferweb/contracts';
import type { z } from 'zod';
import { JobQueue, JobControlError, type Claim } from './queue.js';
import { RunnerClient } from './runner-client.js';
import type { Running } from './executor.js';
export function codingExecutor(
  queue: JobQueue,
  runner: RunnerClient,
  internalUrl: string,
  token: string,
) {
  return (claim: Claim): Running => {
    let stopReason: string | null = null;
    const stop = (reason: string) => {
      stopReason ??= reason;
    };
    const done = (async () => {
      let report: z.infer<typeof codingReport> | undefined;
      let outputFiles: z.infer<typeof codingWorkspace> | undefined;
      let captureWorkspace = false;
      let reason = 'executor_lost',
        lastPhase = '',
        authorizedAt = 0,
        reportedAt = 0;
      const input = async (checkOnly: boolean) => {
        const r = await fetch(`${internalUrl}/internal/coding/${claim.id}/input`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ fence: claim.fence, checkOnly }),
          signal: AbortSignal.timeout(4000),
          redirect: 'error',
        });
        if (!r.ok) {
          await r.body?.cancel();
          throw new JobControlError('source_access_lost');
        }
        return r.json();
      };
      const path = '/runs/' + claim.id;
      try {
        const bundle = await input(false);
        captureWorkspace = bundle.captureWorkspace === true;
        const lease = await queue.heartbeat(claim);
        await runner.request(
          '/runs',
          {
            ...bundle,
            ...lease,
            controlOrigin: process.env.FERWEB_RUNNER_API_ORIGIN ?? new URL(internalUrl).origin,
          },
          undefined,
          10000,
        );
        for (;;) {
          if (stopReason) throw new JobControlError(stopReason);
          const renewal = await queue.heartbeat(claim);
          const status = await runner.request(path, undefined, claim.fence);
          report = codingReport.parse(status.report);
          if (status.done) {
            reason = status.reason;
            if (captureWorkspace && reason === 'completed')
              outputFiles = codingWorkspace.parse(
                await runner.request(path + '/files', undefined, claim.fence, 4000, 2000000),
              );
            break;
          }
          await runner.request(path + '/heartbeat', renewal, claim.fence);
          if (Date.now() - authorizedAt > 3000) {
            await input(true);
            authorizedAt = Date.now();
          }
          if (status.phase !== lastPhase || Date.now() - reportedAt > 1500) {
            await queue.codingProgress(
              claim,
              status.phase !== lastPhase ? status.phase : null,
              report,
            );
            lastPhase = status.phase;
            reportedAt = Date.now();
          }
          await delay(500);
        }
      } catch (error) {
        reason = stopReason ?? (error instanceof JobControlError ? error.code : 'executor_lost');
        // Cancellation is not complete until the controller reports physical stop.
        try {
          const status = await runner.request(path + '/cancel', {}, claim.fence, 10000);
          report = codingReport.parse(status.report);
        } catch {
          /* Leases and root supervisor fail closed; actual confirmation remains unknown. */
        }
      }
      try {
        const saved = await queue.finish(
          claim,
          reason,
          reason === 'completed' ? 0 : 1,
          null,
          report?.terminationConfirmed ?? null,
          report,
          outputFiles,
        );
        if (saved) await runner.request(path + '/release', {}, claim.fence).catch(() => {});
        console.log(
          JSON.stringify({
            level: 'info',
            timestamp: new Date().toISOString(),
            service: 'worker',
            event: saved ? 'coding_finished' : 'coding_result_discarded',
            jobId: claim.id,
            attempt: claim.attempt,
            executorId: claim.executor_id,
            reason,
          }),
        );
      } catch {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'coding_persistence_failed',
            jobId: claim.id,
            executorId: claim.executor_id,
          }),
        );
      }
    })();
    return { done, stop };
  };
}
