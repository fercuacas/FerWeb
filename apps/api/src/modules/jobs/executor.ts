import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JobQueue, JobControlError, type Claim } from './queue.js';
import { processRequest } from './protocol.js';
import { jobConfiguration } from '@ferweb/contracts';

export interface Running {
  child?: ChildProcess;
  done: Promise<void>;
  stop: (reason: string) => void;
}
export class JobExecutor {
  readonly id = randomUUID();
  private active = new Map<string, Running>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private stopping = false;
  private lastSeen = 0;
  constructor(
    readonly queue: JobQueue,
    readonly concurrency = 2,
    readonly coding?: (claim: Claim) => Running,
  ) {
    if (![1, 2].includes(concurrency)) throw new Error('Invalid concurrency');
  }
  ready() {
    return !this.stopping && Date.now() - this.lastSeen < 5000;
  }
  private log(event: string, claim?: Claim) {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        service: 'worker',
        event,
        executorId: this.id,
        ...(claim ? { jobId: claim.id, attempt: claim.attempt } : {}),
      }),
    );
  }
  async start() {
    await this.queue.register(this.id);
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 250);
  }
  private async tick() {
    if (this.stopping || this.polling) return;
    this.polling = true;
    try {
      await this.queue.executorHeartbeat(this.id);
      while (!this.stopping && this.active.size < this.concurrency) {
        const claim = await this.queue.claim(this.id);
        if (!claim) break;
        const running =
          claim.kind === 'codex-v1' && this.coding ? this.coding(claim) : this.run(claim);
        this.active.set(claim.id, running);
        void running.done.finally(() => this.active.delete(claim.id));
      }
      this.lastSeen = Date.now();
    } catch {
      console.error(
        JSON.stringify({ level: 'error', event: 'job_executor_poll_failed', executorId: this.id }),
      );
    } finally {
      this.polling = false;
    }
  }
  private run(claim: Claim): Running {
    const configuration = jobConfiguration.parse(claim.configuration);
    const child = fork(new URL('./simulator.js', import.meta.url), [], {
      cwd: tmpdir(),
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        NODE_ENV: 'production',
      },
      execArgv: [],
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let reason: string | null = null,
      killTimer: ReturnType<typeof setTimeout> | undefined,
      chain = Promise.resolve(),
      stopped = false;
    const stop = (why: string) => {
      if (stopped) return;
      stopped = true;
      reason = why;
      const signal = (kind: NodeJS.Signals) => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        try {
          process.kill(-child.pid, kind);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
            this.log('job_process_signal_failed', claim);
        }
      };
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), 500);
    };
    const send = (message: unknown) => {
      if (!child.connected) return;
      child.send(message as object, (error) => {
        if (error) stop('executor_lost');
      });
    };
    const enqueue = (action: () => Promise<void>) => {
      chain = chain
        .then(action)
        .catch((error) =>
          stop(
            error instanceof JobControlError && error.code !== 'lease_lost'
              ? error.code
              : 'executor_lost',
          ),
        );
      return chain;
    };
    let outputBytes = 0;
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data: Buffer) => {
        outputBytes += data.length;
        if (outputBytes > 8192) stop('protocol_error');
      });
    child.on('message', (raw) => {
      const message = processRequest.safeParse(raw);
      if (!message.success) {
        stop('protocol_error');
        return;
      }
      void enqueue(async () => {
        if (stopped) return;
        const value = message.data;
        if (value.type === 'reserve') {
          const result = await this.queue.reserve(claim, value.step);
          send({ type: 'ack', request: value.request, committed: result.committed });
        } else {
          await this.queue.commitStep(claim, value.step);
          send({ type: 'ack', request: value.request, committed: true });
        }
      });
    });
    const heartbeat = setInterval(
      () =>
        void enqueue(async () => {
          if (stopped) return;
          const lease = await this.queue.heartbeat(claim);
          send({ type: 'renew', ...lease });
        }),
      500,
    );
    let closedResolve!: () => void;
    const closed = new Promise<void>((resolve) => (closedResolve = resolve));
    let exit: number | null = null,
      exitSignal: string | null = null;
    child.on('error', () => {
      reason = 'spawn_failed';
      closedResolve();
    });
    child.once('exit', (code, signal) => {
      exit = code;
      exitSignal = signal;
      closedResolve();
    });
    const done = (async () => {
      this.log('job_attempt_started', claim);
      try {
        if (!child.pid) throw new JobControlError('spawn_failed');
        await enqueue(async () => {
          await this.queue.processStarted(claim, child.pid!);
          if (!stopped)
            send({
              type: 'start',
              jobId: claim.id,
              attempt: claim.attempt,
              simulation: configuration.simulation,
              startStep: claim.completed_steps + 1,
              leaseExpiresAt: claim.lease_until.toISOString(),
              deadlineAt: claim.deadline_at.toISOString(),
            });
        });
        await closed;
        clearInterval(heartbeat);
        await chain;
        const result =
          reason ??
          (exit === 0
            ? 'completed'
            : exit === 75
              ? 'transient_failure'
              : exit === 124
                ? 'timeout'
                : exit === 70
                  ? 'executor_lost'
                  : exit === 2
                    ? 'permanent_failure'
                    : 'process_failure');
        await this.queue.finish(
          claim,
          result,
          exit,
          exitSignal,
          exit !== null || exitSignal !== null,
        );
        this.log('job_attempt_finished', claim);
      } catch {
        stop('executor_lost');
        await closed;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'job_attempt_persistence_failed',
            jobId: claim.id,
            attempt: claim.attempt,
            executorId: this.id,
          }),
        );
      } finally {
        clearInterval(heartbeat);
        if (killTimer) clearTimeout(killTimer);
      }
    })();
    return { child, stop, done };
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.polling) await delay(25);
    for (const run of this.active.values()) run.stop('executor_shutdown');
    await Promise.allSettled([...this.active.values()].map((run) => run.done));
    await this.queue.stopExecutor(this.id);
  }
}
