import { z } from 'zod';
import { localReadDelivery, localReadReport, aiEvent, unknownUsage } from '@ferweb/contracts';
import { JobQueue, JobControlError, type Claim } from './queue.js';
import type { Running } from './executor.js';

export function localReadExecutor(queue: JobQueue, origin: string, token: string) {
  return (claim: Claim): Running => {
    const abort = new AbortController();
    let reason = 'local_read_failed';
    const stop = (code: string) => {
      reason = code;
      abort.abort();
    };
    const done = (async () => {
      let report: z.infer<typeof localReadReport> | undefined;
      let timer: ReturnType<typeof setInterval> | undefined,
        renewing = false;
      try {
        const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body = JSON.stringify({ fence: claim.fence });
        const endpoint = `${origin}/internal/local-read/${claim.id}`;
        const check = async (checkOnly = true) => {
          const response = await fetch(endpoint + '/input', {
            method: 'POST',
            headers,
            body: JSON.stringify({ fence: claim.fence, checkOnly }),
            redirect: 'error',
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new JobControlError('local_source_changed');
          }
          return response.json();
        };
        const input = await check(false);
        report = localReadReport.parse({
          kind: 'local-readonly-v1',
          provider: 'ollama',
          model: input.model.model,
          revision: input.model.revision,
          configurationRevision: input.configurationRevision,
          simulated: input.simulated,
          reportedModel: null,
          inputHash: input.inputHash,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          delivery: null,
          rawOutput: '',
          localChecks: ['input_hash', 'no_tools'],
          usage: unknownUsage(),
          remoteCancellationConfirmed: null,
          errorCode: null,
        });
        let authorizedAt = Date.now();
        timer = setInterval(() => {
          if (renewing || abort.signal.aborted) return;
          renewing = true;
          void (async () => {
            await queue.heartbeat(claim);
            if (Date.now() - authorizedAt > 3000) {
              await check();
              authorizedAt = Date.now();
            }
          })()
            .catch((error) =>
              stop(error instanceof JobControlError ? error.code : 'local_source_changed'),
            )
            .finally(() => {
              renewing = false;
            });
        }, 500);
        await queue.heartbeat(claim);
        const response = await fetch(endpoint + '/stream', {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: abort.signal,
        });
        if (!response.ok || !response.body)
          throw new JobControlError('local_inference_unavailable');
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let pending = '',
          finished = false;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            pending += decoder.decode(part.value, { stream: true });
            if (pending.length > 100000) throw new JobControlError('local_output_limit');
            let line: number;
            while ((line = pending.indexOf('\n')) >= 0) {
              const raw = pending.slice(0, line);
              pending = pending.slice(line + 1);
              if (!raw.trim()) continue;
              const event = aiEvent.parse(JSON.parse(raw));
              if (finished) throw new JobControlError('local_provider_protocol');
              if (event.type === 'meta') report.reportedModel = event.reportedModel ?? null;
              if (event.type === 'delta') {
                if (report.rawOutput.length + event.text.length > 24000)
                  throw new JobControlError('local_output_limit');
                report.rawOutput += event.text;
              }
              if (event.type === 'cancelled') throw new JobControlError('cancelled');
              if (event.type === 'finish') {
                report.usage = event.usage;
                if (event.status !== 'completed')
                  throw new JobControlError(event.error?.code ?? 'local_output_incomplete');
                finished = true;
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (!finished || pending.trim()) throw new JobControlError('local_provider_protocol');
        if (report.reportedModel && report.reportedModel !== report.model)
          throw new JobControlError('local_model_changed');
        const parsed = localReadDelivery.safeParse(JSON.parse(report.rawOutput));
        if (!parsed.success) throw new JobControlError('local_delivery_invalid');
        for (const citation of parsed.data.evidence) {
          const source = input.sources.find(
            (item: { path: string }) => item.path === citation.path,
          );
          const lines = source?.excerpt.split('\n');
          const offset = citation.line - (source?.startLine ?? 1);
          if (
            !source ||
            offset < 0 ||
            offset >= lines.length ||
            !lines[offset].includes(citation.quote)
          )
            throw new JobControlError('local_citation_invalid');
        }
        report.delivery = parsed.data;
        report.localChecks.push('schema', 'source_citations');
        await queue.heartbeat(claim);
        reason = 'completed';
      } catch (error) {
        if (!abort.signal.aborted)
          reason =
            error instanceof JobControlError
              ? error.code
              : error instanceof SyntaxError || error instanceof z.ZodError
                ? 'local_delivery_invalid'
                : 'local_inference_unavailable';
      } finally {
        if (timer) clearInterval(timer);
        abort.abort();
        if (report) {
          report.finishedAt = new Date().toISOString();
          report.errorCode = reason === 'completed' ? null : reason;
        }
        await queue.finish(claim, reason, null, null, null, report).catch(() => {});
      }
    })();
    return { done, stop };
  };
}
