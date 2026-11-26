import 'dotenv/config';
import path from 'node:path';

export interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string | null;
  gmailUser: string | null;
  gmailAppPassword: string | null;
  imapHost: string;
  imapPort: number;
  emailPollIntervalSeconds: number;
  seabankSenderFilters: string[];
  emailLookbackDays: number;
  notifyUnparsedEmail: boolean;
  timezone: string;
  dailyRecapCron: string;
  databasePath: string;
  port: number;
  webhookSecret: string | null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!telegramBotToken) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN wajib diisi di file .env! Dapatkan token dari @BotFather di Telegram.'
    );
  }

  const rawChatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  const gmailUser = (process.env.GMAIL_USER ?? '').trim() || null;
  // Hapus spasi pada Gmail App Password (Google sering menampilkan format "xxxx xxxx xxxx xxxx")
  const gmailAppPassword = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '') || null;

  const senderFiltersRaw = (process.env.SEABANK_SENDER_FILTERS ?? 'seabank.co.id,seabank').trim();
  const seabankSenderFilters = senderFiltersRaw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const dbPathRaw = (process.env.DATABASE_PATH ?? './data/finance.db').trim();
  const databasePath = path.resolve(process.cwd(), dbPathRaw);

  return {
    telegramBotToken,
    telegramChatId: rawChatId || null,
    gmailUser,
    gmailAppPassword,
    imapHost: (process.env.IMAP_HOST ?? 'imap.gmail.com').trim(),
    imapPort: parsePositiveInt(process.env.IMAP_PORT, 993),
    emailPollIntervalSeconds: Math.max(60, parsePositiveInt(process.env.EMAIL_POLL_INTERVAL_SECONDS, 180)),
    seabankSenderFilters: seabankSenderFilters.length > 0 ? seabankSenderFilters : ['seabank.co.id', 'seabank'],
    emailLookbackDays: parseNonNegativeInt(process.env.EMAIL_LOOKBACK_DAYS, 1),
    notifyUnparsedEmail: (process.env.NOTIFY_UNPARSED_EMAIL ?? 'true').toLowerCase() !== 'false',
    timezone: (process.env.TIMEZONE ?? 'Asia/Jakarta').trim(),
    dailyRecapCron: (process.env.DAILY_RECAP_CRON ?? '0 0 * * *').trim(),
    databasePath,
    port: parsePositiveInt(process.env.PORT, 3000),
    webhookSecret: (process.env.WEBHOOK_SECRET ?? '').trim() || null,
  };
}
