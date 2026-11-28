import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { AppConfig } from '../config.js';
import { parseFlexibleRupiah, parseQuickTextMessage } from '../parser/quickTextParser.js';
import { parseSeaBankEmail } from '../parser/seabankParser.js';
import type { FinanceService } from '../services/financeService.js';
import {
  findBalanceSpoilerEntities,
  formatDailyRecapMessage,
  formatHistoryMessage,
  formatMonthlyRecapMessage,
  formatRupiah,
  formatTimestamp,
  formatTransactionNotification,
} from '../services/formatter.js';
import type { GmailWatcher } from '../services/gmailWatcher.js';
import type { MacroDroidWebhookTracker } from '../services/webhookHandler.js';
import type { NotificationSourceSettings, Transaction } from '../types.js';

export class TelegramFinanceBot {
  public readonly bot: Bot;
  private gmailWatcher: GmailWatcher | null = null;
  private webhookTracker: MacroDroidWebhookTracker | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly financeService: FinanceService
  ) {
    this.bot = new Bot(config.telegramBotToken);
    this.registerMiddleware();
    this.registerCommands();
    this.registerErrorHandler();
  }

  attachGmailWatcher(watcher: GmailWatcher): void {
    this.gmailWatcher = watcher;
  }

  attachWebhookTracker(tracker: MacroDroidWebhookTracker): void {
    this.webhookTracker = tracker;
  }

  /**
   * Mengirim balasan dengan efek Spoiler (blur) otomatis pada nominal "Jumlah uang sekarang".
   */
  private async replyWithSpoiler(ctx: Context, text: string): Promise<void> {
    const entities = findBalanceSpoilerEntities(text);
    if (entities.length > 0) {
      await ctx.reply(text, { entities });
      return;
    }
    await ctx.reply(text);
  }

  private registerMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id ? String(ctx.chat.id) : null;
      const text = ctx.message?.text ?? '';

      // Izinkan /start jika TELEGRAM_CHAT_ID belum diset agar user bisa mengetahui Chat ID-nya
      if (!this.config.telegramChatId) {
        if (text.startsWith('/start') || text.startsWith('/help')) {
          await next();
          return;
        }
        await ctx.reply(
          [
            '⚠️ TELEGRAM_CHAT_ID belum dikonfigurasi di file .env.',
            `Chat ID Anda adalah: ${chatId ?? 'tidak diketahui'}`,
            '',
            'Tambahkan TELEGRAM_CHAT_ID di .env lalu restart bot agar data keuangan Anda aman dan notifikasi otomatis aktif.',
          ].join('\n')
        );
        return;
      }

      if (chatId !== this.config.telegramChatId) {
        console.warn(`[TelegramBot] Akses ditolak dari chat ID tidak dikenal: ${chatId}`);
        await ctx.reply('⛔ Maaf, bot ini bersifat pribadi dan hanya dapat diakses oleh pemiliknya.');
        return;
      }

      await next();
    });
  }

  private registerCommands(): void {
    const sendHelp = async (ctx: Context) => {
      const chatId = ctx.chat?.id ? String(ctx.chat.id) : '-';
      const lines = [
        '👋 Halo! Ini adalah Bot Rekap & Notifikasi Keuangan SeaBank.',
        '',
        '⚡ Ketik Cepat (langsung chat tanpa slash):',
        '-25k kopi  (atau -25000 kopi / keluar 25rb kopi)',
        '+500k gaji  (atau +1.5jt bonus / masuk 100rb cashback)',
        'Bisa kirim banyak baris sekaligus dalam 1 chat!',
        '',
        '📌 Daftar Perintah:',
        '/rekap atau /hariini — Rekap uang masuk, keluar, selisih & saldo hari ini',
        '/rekap YYYY-MM-DD — Rekap tanggal tertentu (contoh: /rekap 2026-11-22)',
        '/bulan — Rekap total bulan ini',
        '/saldo — Lihat jumlah uang sekarang',
        '/setsaldo <nominal> — Sinkronkan saldo awal/sekarang (contoh: /setsaldo 1.5jt)',
        '/riwayat [jumlah] — Lihat transaksi terakhir (default 10)',
        '/masuk <nominal> [ket] — Catat uang masuk manual',
        '/keluar <nominal> [ket] — Catat uang keluar manual',
        '/hapus <id> — Hapus transaksi berdasarkan ID & kembalikan saldo',
        '/sumber — Tombol ON/OFF sumber notifikasi (MacroDroid & Gmail)',
        '/lognotif — Lihat 10 request webhook MacroDroid terakhir yang masuk',
        '/cekemail — Cek email notifikasi SeaBank di Gmail sekarang',
        '/status — Cek status koneksi Gmail, MacroDroid & jadwal rekap',
        '/simulasi <subject> | <isi> — Uji parser SeaBank tanpa menyimpan data',
      ];

      if (!this.config.telegramChatId) {
        lines.push(
          '',
          `🆔 Chat ID Anda: ${chatId}`,
          'Salin angka Chat ID di atas ke TELEGRAM_CHAT_ID di file .env lalu restart bot.'
        );
      }

      await ctx.reply(lines.join('\n'));
    };

    this.bot.command('start', sendHelp);
    this.bot.command('help', sendHelp);

    const handleRecap = async (ctx: Context) => {
      const arg = (ctx.match as string | undefined)?.trim() ?? '';
      const todayKey = this.financeService.getTodayDateKey();

      if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        await ctx.reply('❌ Format tanggal salah. Gunakan format YYYY-MM-DD, contoh: /rekap 2026-11-23');
        return;
      }

      const targetDate = arg || todayKey;
      const summary = this.financeService.getDailySummary(targetDate);
      await this.replyWithSpoiler(ctx, formatDailyRecapMessage(summary, targetDate === todayKey));
    };

    this.bot.command('rekap', handleRecap);
    this.bot.command('hariini', handleRecap);

    this.bot.command('bulan', async (ctx) => {
      const arg = (ctx.match as string | undefined)?.trim() ?? '';
      if (arg && !/^\d{4}-\d{2}$/.test(arg)) {
        await ctx.reply('❌ Format bulan salah. Gunakan YYYY-MM, contoh: /bulan 2026-11');
        return;
      }
      const summary = this.financeService.getMonthlySummary(arg || undefined);
      await this.replyWithSpoiler(ctx, formatMonthlyRecapMessage(summary));
    });

    this.bot.command('saldo', async (ctx) => {
      const balance = this.financeService.getCurrentBalance();
      await this.replyWithSpoiler(
        ctx,
        `💳 Jumlah uang sekarang: ${formatRupiah(balance)}\n\nTip: Gunakan /setsaldo <nominal> untuk menyinkronkan dengan saldo SeaBank Anda.`
      );
    });

    this.bot.command('setsaldo', async (ctx) => {
      const rawArg = (ctx.match as string | undefined)?.trim() ?? '';
      if (!rawArg) {
        await ctx.reply('ℹ️ Cara pakai: /setsaldo 1500000 (atau /setsaldo 1.500.000)');
        return;
      }

      // Izinkan 0 untuk reset saldo ke 0
      let parsed: number | null;
      if (/^0+$/.test(rawArg.replace(/[.,\s]/g, ''))) {
        parsed = 0;
      } else {
        parsed = parseFlexibleRupiah(rawArg);
      }

      if (parsed === null) {
        await ctx.reply('❌ Nominal tidak valid. Contoh: /setsaldo 1500000 atau /setsaldo 1.5jt');
        return;
      }

      const updated = this.financeService.setCurrentBalance(parsed);
      await this.replyWithSpoiler(ctx, `✅ Saldo sekarang berhasil diperbarui menjadi ${formatRupiah(updated)}`);
    });

    this.bot.command('riwayat', async (ctx) => {
      const rawArg = (ctx.match as string | undefined)?.trim() ?? '';
      const limit = rawArg ? Number.parseInt(rawArg, 10) : 10;
      if (Number.isNaN(limit) || limit < 1) {
        await ctx.reply('❌ Jumlah harus berupa angka positif. Contoh: /riwayat 15');
        return;
      }

      const txs = this.financeService.getRecentTransactions(Math.min(limit, 30));
      await this.replyWithSpoiler(ctx, formatHistoryMessage(txs, this.config.timezone));
    });

    const handleManualTx = async (ctx: Context, type: 'income' | 'expense') => {
      const rawArg = (ctx.match as string | undefined)?.trim() ?? '';
      if (!rawArg) {
        const cmd = type === 'income' ? '/masuk' : '/keluar';
        const sampleDesc = type === 'income' ? 'Gaji / Transfer teman' : 'Beli kopi';
        await ctx.reply(`ℹ️ Cara pakai: ${cmd} <nominal> [keterangan]\nContoh: ${cmd} 50000 ${sampleDesc}`);
        return;
      }

      const parts = rawArg.split(/\s+/);
      const amountToken = parts[0];
      const description =
        parts.slice(1).join(' ').trim() || (type === 'income' ? 'Pemasukan Manual' : 'Pengeluaran Manual');

      const amount = parseFlexibleRupiah(amountToken);
      if (amount === null) {
        await ctx.reply(
          '❌ Nominal tidak valid. Contoh: /keluar 25000 Kopi atau /keluar 25k Kopi'
        );
        return;
      }

      const { transaction } = this.financeService.recordTransaction({
        type,
        amount,
        description,
        source: 'manual',
      });

      await this.replyWithSpoiler(ctx, formatTransactionNotification(transaction, this.config.timezone));
    };

    this.bot.command('masuk', (ctx) => handleManualTx(ctx, 'income'));
    this.bot.command('keluar', (ctx) => handleManualTx(ctx, 'expense'));

    this.bot.command('hapus', async (ctx) => {
      const rawArg = (ctx.match as string | undefined)?.trim() ?? '';
      const id = Number.parseInt(rawArg.replace(/^#/, ''), 10);
      if (!Number.isFinite(id) || id <= 0) {
        await ctx.reply('ℹ️ Cara pakai: /hapus <id>\nLihat ID transaksi lewat perintah /riwayat');
        return;
      }

      const result = this.financeService.deleteTransaction(id);
      if (!result) {
        await ctx.reply(`❌ Transaksi dengan ID #${id} tidak ditemukan.`);
        return;
      }

      const sign = result.deleted.type === 'income' ? '+' : '-';
      await this.replyWithSpoiler(
        ctx,
        [
          `🗑️ Transaksi #${result.deleted.id} berhasil dihapus:`,
          `${sign}${formatRupiah(result.deleted.amount)} — ${result.deleted.description}`,
          `-> Jumlah uang sekarang disesuaikan menjadi: ${formatRupiah(result.newBalance)}`,
        ].join('\n')
      );
    });

    this.bot.command('cekemail', async (ctx) => {
      if (!this.gmailWatcher || !this.gmailWatcher.isConfigured()) {
        await ctx.reply(
          '⚠️ Integrasi Gmail belum dikonfigurasi. Isi GMAIL_USER dan GMAIL_APP_PASSWORD di file .env terlebih dahulu.'
        );
        return;
      }

      await ctx.reply('🔎 Sedang mengecek email notifikasi SeaBank di Gmail...');
      try {
        const res = await this.gmailWatcher.syncNow();
        await ctx.reply(
          [
            '✅ Pengecekan Gmail selesai!',
            `• Email SeaBank baru diperiksa: ${res.checkedCount}`,
            `• Transaksi baru tercatat: ${res.newTransactions.length}`,
            `• Duplikat dilewati: ${res.skippedDuplicates}`,
            `• Gagal di-parse: ${res.unparsedEmails.length}`,
          ].join('\n')
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.reply(`❌ Gagal mengecek Gmail:\n${message}`);
      }
    });

    this.bot.command('status', async (ctx) => {
      const watcherStatus = this.gmailWatcher?.getStatus();
      const sourceSettings = this.financeService.getSourceSettings();
      const totalTx = this.financeService.getTotalTransactionCount();
      const balance = this.financeService.getCurrentBalance();

      let gmailLine: string;
      if (!sourceSettings.gmailEnabled) {
        gmailLine = '🔴 NONAKTIF (dimatikan lewat /sumber)';
      } else if (watcherStatus?.configured) {
        gmailLine = `🟢 AKTIF (${watcherStatus.gmailUser}, cek tiap ${watcherStatus.pollIntervalSeconds} detik)`;
      } else {
        gmailLine = '⚠️ ON tapi belum diisi di .env';
      }

      const macrodroidLine = sourceSettings.macrodroidEnabled
        ? `🟢 AKTIF (Webhook port ${this.config.port} -> /webhook/macrodroid)`
        : '🔴 NONAKTIF (dimatikan lewat /sumber)';

      const lastSyncLine = watcherStatus?.lastSyncAt
        ? formatTimestamp(watcherStatus.lastSyncAt.toISOString(), this.config.timezone)
        : 'Belum pernah';

      const latestHook = this.webhookTracker?.getLatest();
      const lastMacroLine = latestHook
        ? `${formatTimestamp(latestHook.receivedAt.toISOString(), this.config.timezone)} (${latestHook.outcome}, HTTP ${latestHook.httpStatus})`
        : 'Belum ada request masuk sejak bot menyala';

      const lines = [
        '🤖 Status Bot Notif SeaBank',
        '',
        `• Notif HP (MacroDroid): ${macrodroidLine}`,
        `• Webhook MacroDroid Terakhir: ${lastMacroLine}`,
        `• Gmail IMAP: ${gmailLine}`,
        `• Sync Gmail Terakhir: ${lastSyncLine}`,
        `• Jadwal Rekap Otomatis: ${this.config.dailyRecapCron} (${this.config.timezone})`,
        `• Total Transaksi Tersimpan: ${totalTx}`,
        `• Jumlah Uang Sekarang: ${formatRupiah(balance)}`,
        '',
        '💡 Ketik /sumber untuk tombol ON/OFF, atau /lognotif untuk melihat log webhook MacroDroid terakhir.',
      ];

      if (watcherStatus?.lastError) {
        lines.push(`• Error Gmail Terakhir: ${watcherStatus.lastError}`);
      }

      await this.replyWithSpoiler(ctx, lines.join('\n'));
    });

    this.bot.command('lognotif', async (ctx) => {
      const logs = this.webhookTracker?.getRecent(10) ?? [];
      if (logs.length === 0) {
        await ctx.reply(
          '📭 Belum ada request webhook MacroDroid yang masuk ke server sejak bot dinyalakan.\n\nJika transaksi di HP tidak muncul di sini, berarti HP/MacroDroid gagal mengirim HTTP Request (cek Battery Optimization, sinyal, URL, atau timeout MacroDroid).'
        );
        return;
      }

      const iconMap: Record<string, string> = {
        recorded: '✅',
        duplicated: '♻️',
        ignored: '⏭️',
        skipped: '⏸️',
        unparsed: '⚠️',
        unauthorized: '🔒',
        error: '❌',
      };

      const lines = [`📡 ${logs.length} Log Webhook MacroDroid Terakhir:`, ''];
      for (const item of logs) {
        const icon = iconMap[item.outcome] ?? '•';
        const time = formatTimestamp(item.receivedAt.toISOString(), this.config.timezone);
        const txPart = item.transactionId ? ` (ID #${item.transactionId})` : '';
        lines.push(`${icon} ${time} | ${item.outcome.toUpperCase()} [${item.httpStatus}]${txPart}`);
        lines.push(`   ${item.title} — ${item.snippet.slice(0, 90)}`);
        if (item.reason) {
          lines.push(`   Alasan: ${item.reason.slice(0, 120)}`);
        }
      }

      await ctx.reply(lines.join('\n'));
    });

    const buildSourcePanel = (settings: NotificationSourceSettings) => {
      const gmailIcon = settings.gmailEnabled ? '🟢 ON' : '🔴 OFF';
      const macroIcon = settings.macrodroidEnabled ? '🟢 ON' : '🔴 OFF';

      let modeDesc = '';
      if (settings.gmailEnabled && settings.macrodroidEnabled) {
        modeDesc =
          '🔄 Mode Aktif: Keduanya Menyala (Dilengkapi Anti-Duplikat Otomatis 5 menit agar transaksi yang sama tidak terhitung 2x).';
      } else if (settings.macrodroidEnabled && !settings.gmailEnabled) {
        modeDesc =
          '📱 Mode Aktif: Hanya MacroDroid (Semua nominal transaksi dari push notif HP Android masuk, polling Gmail dimatikan).';
      } else if (settings.gmailEnabled && !settings.macrodroidEnabled) {
        modeDesc = '📧 Mode Aktif: Hanya Email Gmail (Webhook MacroDroid dinonaktifkan).';
      } else {
        modeDesc = '⏸️ Mode Aktif: Semua sumber otomatis dimatikan (Hanya mode ketik cepat / manual di Telegram).';
      }

      const text = [
        '🎛️ Pengaturan Sumber Notifikasi Otomatis SeaBank',
        '',
        `• 📱 MacroDroid (Notif HP Android): ${macroIcon}`,
        `• 📧 Email Gmail (IMAP): ${gmailIcon}`,
        '',
        modeDesc,
        '',
        'Klik tombol di bawah untuk menyalakan / mematikan sumber notifikasi kapan saja:',
      ].join('\n');

      const keyboard = new InlineKeyboard()
        .text(`📱 MacroDroid: ${macroIcon}`, 'toggle_source:macrodroid')
        .text(`📧 Gmail: ${gmailIcon}`, 'toggle_source:gmail')
        .row()
        .text('📱 Hanya MacroDroid', 'toggle_source:only_macrodroid')
        .text('📧 Hanya Gmail', 'toggle_source:only_gmail')
        .row()
        .text('🔄 Aktifkan Keduanya', 'toggle_source:both');

      return { text, keyboard };
    };

    const handleSourceCommand = async (ctx: Context) => {
      const arg = ((ctx.match as string | undefined) ?? '').trim().toLowerCase();
      let settings = this.financeService.getSourceSettings();

      if (arg === 'macrodroid' || arg === 'hp' || arg === 'android') {
        settings = this.financeService.setMacrodroidEnabled(true);
        settings = this.financeService.setGmailEnabled(false);
      } else if (arg === 'gmail' || arg === 'email') {
        settings = this.financeService.setGmailEnabled(true);
        settings = this.financeService.setMacrodroidEnabled(false);
      } else if (arg === 'keduanya' || arg === 'all' || arg === 'both' || arg === 'on') {
        settings = this.financeService.setGmailEnabled(true);
        settings = this.financeService.setMacrodroidEnabled(true);
      } else if (arg === 'off' || arg === 'mati') {
        settings = this.financeService.setGmailEnabled(false);
        settings = this.financeService.setMacrodroidEnabled(false);
      }

      const panel = buildSourcePanel(settings);
      await ctx.reply(panel.text, { reply_markup: panel.keyboard });
    };

    this.bot.command('sumber', handleSourceCommand);
    this.bot.command('notif', handleSourceCommand);
    this.bot.command('mode', handleSourceCommand);

    this.bot.callbackQuery(/^toggle_source:(.+)$/, async (ctx) => {
      const action = ctx.match[1];
      let current = this.financeService.getSourceSettings();

      if (action === 'macrodroid') {
        current = this.financeService.setMacrodroidEnabled(!current.macrodroidEnabled);
      } else if (action === 'gmail') {
        current = this.financeService.setGmailEnabled(!current.gmailEnabled);
      } else if (action === 'only_macrodroid') {
        this.financeService.setGmailEnabled(false);
        current = this.financeService.setMacrodroidEnabled(true);
      } else if (action === 'only_gmail') {
        this.financeService.setMacrodroidEnabled(false);
        current = this.financeService.setGmailEnabled(true);
      } else if (action === 'both') {
        this.financeService.setGmailEnabled(true);
        current = this.financeService.setMacrodroidEnabled(true);
      }

      const panel = buildSourcePanel(current);
      try {
        await ctx.editMessageText(panel.text, { reply_markup: panel.keyboard });
      } catch {
        // Abaikan error jika user menekan tombol yang sama dan teks tidak berubah
      }
      await ctx.answerCallbackQuery({
        text: `MacroDroid: ${current.macrodroidEnabled ? 'ON' : 'OFF'} | Gmail: ${current.gmailEnabled ? 'ON' : 'OFF'}`,
      });
    });

    this.bot.command('simulasi', async (ctx) => {
      const rawArg = (ctx.match as string | undefined)?.trim() ?? '';
      if (!rawArg) {
        await ctx.reply(
          [
            '🧪 Uji Parser Email SeaBank (tidak mengubah saldo/database):',
            'Cara pakai: /simulasi <subject> | <isi email>',
            '',
            'Contoh:',
            '/simulasi Pembayaran QRIS Berhasil | Pembayaran QRIS sebesar Rp 25.000 ke Kopi Kenangan berhasil.',
          ].join('\n')
        );
        return;
      }

      const [subjectPart, ...bodyParts] = rawArg.split('|');
      const subject = subjectPart.trim();
      const body = bodyParts.join('|').trim() || subject;

      const result = parseSeaBankEmail(
        {
          messageId: 'simulation',
          from: 'SeaBank <alerts@seabank.co.id>',
          subject,
          text: body,
          date: new Date(),
        },
        this.config.seabankSenderFilters
      );

      if (!result.matched || !result.transaction) {
        await ctx.reply(`❌ Tidak terdeteksi sebagai transaksi.\nAlasan: ${result.reason ?? 'Tidak diketahui'}`);
        return;
      }

      const tx = result.transaction;
      await ctx.reply(
        [
          '✅ Berhasil di-parse!',
          `• Jenis: ${tx.type === 'income' ? 'Uang Masuk (INCOME)' : 'Uang Keluar (EXPENSE)'}`,
          `• Nominal: ${formatRupiah(tx.amount)}`,
          `• Keterangan: ${tx.description}`,
          `• Pihak Lawan: ${tx.counterparty ?? '-'}`,
          `• Referensi: ${tx.reference ?? '-'}`,
          `• Saldo di Email: ${tx.balanceAfter !== null ? formatRupiah(tx.balanceAfter) : '(tidak ada, hitung otomatis)'}`,
        ].join('\n')
      );
    });

    // Handler Ketik Cepat (chat biasa tanpa slash, mendukung 1 baris atau multi-baris sekaligus)
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (!text || text.startsWith('/')) {
        return;
      }

      const { drafts, invalidLines } = parseQuickTextMessage(text);

      if (drafts.length === 0) {
        await ctx.reply(
          [
            '💡 Gunakan format Ketik Cepat untuk mencatat langsung:',
            '• -25k kopi  (atau -25000 kopi / keluar 25rb kopi)',
            '• +500k gaji  (atau +1.5jt bonus / masuk 100rb cashback)',
            '',
            'Atau kirim /help untuk melihat semua perintah.',
          ].join('\n')
        );
        return;
      }

      const recorded: Transaction[] = [];
      for (const draft of drafts) {
        const { transaction } = this.financeService.recordTransaction({
          type: draft.type,
          amount: draft.amount,
          description: draft.description,
          source: 'manual',
        });
        recorded.push(transaction);
      }

      // Jika hanya 1 transaksi & tidak ada baris gagal, gunakan format notifikasi transaksi ringkas
      if (recorded.length === 1 && invalidLines.length === 0) {
        await this.replyWithSpoiler(ctx, formatTransactionNotification(recorded[0], this.config.timezone));
        return;
      }

      const latestBalance = this.financeService.getCurrentBalance();
      const lines = [`✅ ${recorded.length} Transaksi Tercatat:`, ''];

      for (const tx of recorded) {
        const icon = tx.type === 'income' ? '💰' : '💸';
        const sign = tx.type === 'income' ? '+' : '-';
        lines.push(`${icon} #${tx.id} | ${sign}${formatRupiah(tx.amount)} — ${tx.description}`);
      }

      lines.push('', `-> Jumlah uang sekarang: ${formatRupiah(latestBalance)}`);

      if (invalidLines.length > 0) {
        lines.push(
          '',
          `⚠️ ${invalidLines.length} baris dilewati (format tidak dikenali):`,
          ...invalidLines.slice(0, 5).map((l) => `• ${l}`)
        );
      }

      await this.replyWithSpoiler(ctx, lines.join('\n'));
    });
  }

  private registerErrorHandler(): void {
    this.bot.catch((err) => {
      console.error('[TelegramBot] Unhandled error:', err.error);
    });
  }

  async sendMessageToOwner(text: string): Promise<void> {
    if (!this.config.telegramChatId) {
      console.warn('[TelegramBot] Pesan tidak dikirim karena TELEGRAM_CHAT_ID belum diset.');
      return;
    }
    const entities = findBalanceSpoilerEntities(text);
    if (entities.length > 0) {
      await this.bot.api.sendMessage(this.config.telegramChatId, text, { entities });
      return;
    }
    await this.bot.api.sendMessage(this.config.telegramChatId, text);
  }

  async notifyNewTransaction(tx: Transaction): Promise<void> {
    const message = formatTransactionNotification(tx, this.config.timezone);
    await this.sendMessageToOwner(message);
  }

  async sendDailyRecap(): Promise<void> {
    const { dateKey, isToday } = this.financeService.getScheduledRecapDateKey();
    const summary = this.financeService.getDailySummary(dateKey);
    const message = formatDailyRecapMessage(summary, isToday);
    await this.sendMessageToOwner(message);
  }

  async notifyUnparsedEmail(
    info: {
      subject: string;
      reason: string;
      snippet: string;
    },
    source: 'email' | 'macrodroid' = 'email'
  ): Promise<void> {
    const header =
      source === 'macrodroid'
        ? '⚠️ Ada notifikasi HP (MacroDroid) masuk namun gagal di-parse otomatis:'
        : '⚠️ Ada email SeaBank masuk namun gagal di-parse otomatis:';
    const subjectLabel = source === 'macrodroid' ? 'Judul Notif' : 'Subject';

    const message = [
      header,
      `• ${subjectLabel}: ${info.subject}`,
      `• Alasan: ${info.reason}`,
      `• Cuplikan: ${info.snippet || '(kosong)'}`,
      '',
      'Anda bisa mencatatnya manual lewat /masuk atau /keluar.',
    ].join('\n');
    await this.sendMessageToOwner(message);
  }

  async start(): Promise<void> {
    await this.bot.api.setMyCommands([
      { command: 'rekap', description: 'Rekap uang masuk, keluar & saldo hari ini' },
      { command: 'saldo', description: 'Lihat jumlah uang sekarang' },
      { command: 'setsaldo', description: 'Atur/sinkronkan saldo SeaBank sekarang' },
      { command: 'riwayat', description: 'Lihat daftar transaksi terakhir' },
      { command: 'masuk', description: 'Catat uang masuk manual' },
      { command: 'keluar', description: 'Catat uang keluar manual' },
      { command: 'bulan', description: 'Rekap transaksi bulan ini' },
      { command: 'sumber', description: 'Tombol ON/OFF sumber notifikasi (MacroDroid & Gmail)' },
      { command: 'lognotif', description: 'Lihat 10 log webhook MacroDroid terakhir' },
      { command: 'cekemail', description: 'Cek email SeaBank terbaru sekarang' },
      { command: 'hapus', description: 'Hapus transaksi berdasarkan ID' },
      { command: 'status', description: 'Cek status bot & koneksi Gmail' },
      { command: 'help', description: 'Bantuan & daftar perintah' },
    ]);

    console.log('[TelegramBot] Bot Telegram mulai berjalan (long polling)...');
    void this.bot.start({
      onStart: (botInfo) => {
        console.log(`[TelegramBot] Terhubung sebagai @${botInfo.username}`);
      },
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
