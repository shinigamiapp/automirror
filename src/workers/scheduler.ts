import type { FastifyBaseLogger } from 'fastify';

export class WorkerScheduler {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isShuttingDown = false;

  constructor(
    public readonly name: string,
    private readonly task: () => Promise<void>,
    private readonly intervalMs: number,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    if (this.isShuttingDown) return;
    this.log.info({ worker: this.name, intervalMs: this.intervalMs }, 'Worker started');
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    // Wait for current task to finish
    while (this.isRunning) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.log.info({ worker: this.name }, 'Worker stopped');
  }

  private scheduleTick(): void {
    if (this.isShuttingDown) return;
    this.timeoutId = setTimeout(() => this.tick(), this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.isShuttingDown || this.isRunning) return;
    this.isRunning = true;
    try {
      await this.task();
    } catch (error) {
      this.log.error({ worker: this.name, err: error }, 'Worker tick failed');
    } finally {
      this.isRunning = false;
      this.scheduleTick();
    }
  }

  getStatus(): { name: string; running: boolean; shuttingDown: boolean } {
    return {
      name: this.name,
      running: this.isRunning,
      shuttingDown: this.isShuttingDown,
    };
  }
}
