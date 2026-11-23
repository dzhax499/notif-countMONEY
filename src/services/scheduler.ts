import cron, { type ScheduledTask } from 'node-cron';

export class DailyRecapScheduler {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly cronExpression: string,
    private readonly timezone: string,
    private readonly onTrigger: () => Promise<void>
  ) {}

  start(): void {
    if (!cron.validate(this.cronExpression)) {
      throw new Error(
        `Format DAILY_RECAP_CRON tidak valid: "${this.cronExpression}". Contoh valid: "0 21 * * *"`
      );
    }

    if (this.task) return;

    this.task = cron.schedule(
      this.cronExpression,
      () => {
        console.log('[Scheduler] Menjalankan pengiriman rekap harian otomatis...');
        void this.onTrigger().catch((err) => {
          console.error('[Scheduler] Gagal mengirim rekap harian otomatis:', err);
        });
      },
      {
        timezone: this.timezone,
      }
    );

    console.log(
      `[Scheduler] Rekap harian otomatis aktif dengan jadwal "${this.cronExpression}" (${this.timezone}).`
    );
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
