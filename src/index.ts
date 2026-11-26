import http from 'node:http';
import { TelegramFinanceBot } from './bot/telegramBot.js';
import { loadConfig } from './config.js';
import { FinanceDatabase } from './db/database.js';
import { FinanceService } from './services/financeService.js';
import { GmailWatcher } from './services/gmailWatcher.js';
import { DailyRecapScheduler } from './services/scheduler.js';
import { extractMacroDroidPayload, processMacroDroidWebhook } from './services/webhookHandler.js';

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

  // HTTP server untuk Healthcheck & Webhook MacroDroid (/webhook/macrodroid atau /webhook/notif)
  const healthServer = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

      if (pathname === '/' || pathname === '/health') {
        const status = gmailWatcher.getStatus();
        const sourceSettings = financeService.getSourceSettings();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'notif-countMONEY',
            sources: {
              macrodroidEnabled: sourceSettings.macrodroidEnabled,
              gmailEnabled: sourceSettings.gmailEnabled,
              gmailConfigured: status.configured,
            },
            lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
            totalTransactions: financeService.getTotalTransactionCount(),
          })
        );
        return;
      }

      if (
        pathname === '/webhook/macrodroid' ||
        pathname === '/webhook/notif' ||
        pathname === '/macrodroid'
      ) {
        const { payload, providedSecret } = await extractMacroDroidPayload(req, urlObj);
        const result = await processMacroDroidWebhook({
          payload,
          providedSecret,
          config,
          financeService,
          onNewTransaction: async (tx) => {
            console.log(
              `[MacroDroid] Transaksi baru tercatat (#${tx.id}): ${tx.type} Rp ${tx.amount} — ${tx.description}`
            );
            await telegramBot.notifyNewTransaction(tx);
          },
          onUnparsedNotification: async (info) => {
            console.warn(`[MacroDroid] Notifikasi gagal di-parse: "${info.subject}" (${info.reason})`);
            await telegramBot.notifyUnparsedEmail(info);
          },
        });

        res.writeHead(result.httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.body));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    } catch (err) {
      console.error('[HTTPServer] Error memproses request:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
    }
  });

  healthServer.listen(config.port, () => {
    console.log(
      `[App] HTTP & MacroDroid Webhook server aktif di port ${config.port} (endpoint: /webhook/macrodroid)`
    );
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
