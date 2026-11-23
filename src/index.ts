import http from 'node:http';
import { TelegramFinanceBot } from './bot/telegramBot.js';
import { loadConfig } from './config.js';
import { FinanceDatabase } from './db/database.js';
import { FinanceService } from './services/financeService.js';
import { GmailWatcher } from './services/gmailWatcher.js';
import { DailyRecapScheduler } from './services/scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log('[App] Memulai SeaBank Telegram Finance Bot...');
  console.log(`[App] Database SQLite: ${config.databasePath}`);

  const db = new FinanceDatabase(config.databasePath);
  const financeService = new FinanceService(db, config.timezone);
  const telegramBot = new TelegramFinanceBot(config, financeService);

  const gmailWatcher = new GmailWatcher(config, financeService, {
    onNewTransaction: async (tx) => {
      console.log(
        `[App] Transaksi baru tercatat (#${tx.id}): ${tx.type} Rp ${tx.amount} — ${tx.description}`
      );
      await telegramBot.notifyNewTransaction(tx);
    },
    onUnparsedSeaBankEmail: async (info) => {
      console.warn(`[App] Email SeaBank gagal di-parse: "${info.subject}" (${info.reason})`);
      await telegramBot.notifyUnparsedEmail(info);
    },
  });

  telegramBot.attachGmailWatcher(gmailWatcher);

  const scheduler = new DailyRecapScheduler(config.dailyRecapCron, config.timezone, async () => {
    await telegramBot.sendDailyRecap();
  });

  // Mini HTTP healthcheck server agar kompatibel jika di-deploy sebagai Web Service (Render/Railway/Fly.io)
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      const status = gmailWatcher.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'notif-countMONEY',
          gmailConfigured: status.configured,
          lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
          totalTransactions: financeService.getTotalTransactionCount(),
        })
      );
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  healthServer.listen(config.port, () => {
    console.log(`[App] Healthcheck server aktif di port ${config.port}`);
  });

  await telegramBot.start();
  gmailWatcher.start();
  scheduler.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[App] Menerima sinyal ${signal}, menutup aplikasi dengan rapi...`);
    scheduler.stop();
    gmailWatcher.stop();
    await telegramBot.stop();
    healthServer.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  console.error('[App] Fatal error saat startup:', err);
  process.exit(1);
});
