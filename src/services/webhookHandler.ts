import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config.js';
import { parseQuickTextMessage } from '../parser/quickTextParser.js';
import {
  cleanMacroDroidPlaceholder,
  parseSeaBankPushNotification,
} from '../parser/seabankParser.js';
import type { Transaction } from '../types.js';
import type { FinanceService } from './financeService.js';

export interface WebhookLogEntry {
  receivedAt: Date;
  httpStatus: number;
  outcome: 'recorded' | 'duplicated' | 'ignored' | 'skipped' | 'unparsed' | 'unauthorized' | 'error';
  title: string;
  snippet: string;
  reason?: string;
  transactionId?: number;
}

export class MacroDroidWebhookTracker {
  private readonly entries: WebhookLogEntry[] = [];

  constructor(private readonly maxEntries = 15) {}

  record(entry: WebhookLogEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  getLatest(): WebhookLogEntry | null {
    return this.entries[0] ?? null;
  }

  getRecent(limit = 10): WebhookLogEntry[] {
    return this.entries.slice(0, Math.max(1, limit));
  }
}

export interface MacroDroidPayload {
  title?: string;
  text?: string;
  bigText?: string;
  id?: string;
  secret?: string;
}

export interface WebhookProcessResult {
  httpStatus: number;
  body: {
    ok: boolean;
    recorded?: boolean;
    duplicated?: boolean;
    ignored?: boolean;
    skipped?: boolean;
    reason?: string;
    transaction?: Transaction;
  };
}

/**
 * Memproses payload notifikasi dari MacroDroid (HP Android) atau Shortcut.
 */
export async function processMacroDroidWebhook(params: {
  payload: MacroDroidPayload;
  providedSecret?: string | null;
  config: Pick<AppConfig, 'webhookSecret' | 'notifyUnparsedEmail'>;
  financeService: FinanceService;
  onNewTransaction?: (tx: Transaction) => Promise<void>;
  onUnparsedNotification?: (info: {
    subject: string;
    reason: string;
    snippet: string;
  }) => Promise<void>;
}): Promise<WebhookProcessResult> {
  const { payload, providedSecret, config, financeService, onNewTransaction, onUnparsedNotification } = params;

  // 1. Validasi WEBHOOK_SECRET jika diset di .env
  if (config.webhookSecret) {
    const candidate = (providedSecret || payload.secret || '').trim();
    if (candidate !== config.webhookSecret) {
      return {
        httpStatus: 401,
        body: {
          ok: false,
          reason: 'WEBHOOK_SECRET tidak cocok atau belum disertakan.',
        },
      };
    }
  }

  // 2. Cek apakah sumber MacroDroid sedang ON di pengaturan (/sumber)
  const sourceSettings = financeService.getSourceSettings();
  if (!sourceSettings.macrodroidEnabled) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        skipped: true,
        reason: 'Sumber MacroDroid sedang NONAKTIF (OFF). Aktifkan lewat perintah /sumber di Telegram.',
      },
    };
  }

  const rawTitle = (payload.title ?? '').trim();
  const rawText = (payload.text ?? '').trim();
  const rawBigText = (payload.bigText ?? '').trim();

  const title = cleanMacroDroidPlaceholder(rawTitle);
  const text = cleanMacroDroidPlaceholder(rawText);
  const bigText = cleanMacroDroidPlaceholder(rawBigText);
  const combinedText = (text && bigText && bigText !== text ? `${text}\n${bigText}` : text || bigText || title).trim();

  if (!combinedText && (rawTitle || rawText || rawBigText)) {
    const reason =
      'Variabel MacroDroid belum terbaca (masih tertulis {not_title} / {not_text}). Di MacroDroid ganti kurung kurawal {...} menjadi kurung siku [not_title] dan [not_text], atau pilih variabel lewat tombol titik tiga (...) Magic Text.';
    if (config.notifyUnparsedEmail && onUnparsedNotification) {
      await onUnparsedNotification({
        subject: rawTitle || '(Placeholder MacroDroid)',
        reason,
        snippet: `${rawText || rawBigText}`.slice(0, 220),
      });
    }
    return {
      httpStatus: 422,
      body: {
        ok: false,
        reason,
      },
    };
  }

  if (!combinedText) {
    return {
      httpStatus: 400,
      body: {
        ok: false,
        reason: 'Payload kosong. Kirim parameter title dan text dari MacroDroid.',
      },
    };
  }

  // 3. Parse sebagai Push Notification SeaBank
  const parsed = parseSeaBankPushNotification({
    title,
    text,
    bigText,
  });

  if (parsed.matched && parsed.transaction) {
    const txData = parsed.transaction;
    // Dedup bucket 15 detik: cukup mencegah double-banner Android (1-3 detik) tanpa memblokir 2 transaksi asli berdekatan
    const bucket = Math.floor(Date.now() / 15_000);
    const hashInput = `${bucket}|${txData.type}|${txData.amount}|${txData.reference ?? ''}|${txData.counterparty ?? ''}|${combinedText}`;
    const autoHash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 16);
    const externalId = payload.id?.trim() ? `md-${payload.id.trim()}` : `md-${autoHash}`;

    const { transaction, duplicated } = financeService.recordTransaction({
      type: txData.type,
      amount: txData.amount,
      description: txData.description,
      counterparty: txData.counterparty,
      reference: txData.reference,
      source: 'macrodroid',
      externalId,
      explicitBalanceAfter: txData.balanceAfter,
      occurredAt: txData.occurredAt,
    });

    if (!duplicated && onNewTransaction) {
      await onNewTransaction(transaction);
    }

    return {
      httpStatus: 200,
      body: {
        ok: true,
        recorded: !duplicated,
        duplicated,
        transaction,
      },
    };
  }

  // Abaikan notifikasi non-transaksi (OTP, Login, Promo, dll) tanpa error
  if (parsed.reason && /non-transaksi|diabaikan/i.test(parsed.reason)) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        ignored: true,
        reason: parsed.reason,
      },
    };
  }

  // 4. Fallback: cek apakah format Ketik Cepat (misal "-25k kopi" dari Shortcut / Quick Tile)
  const quick = parseQuickTextMessage(combinedText);
  if (quick.drafts.length > 0) {
    let lastTx: Transaction | undefined;
    for (const draft of quick.drafts) {
      const { transaction, duplicated } = financeService.recordTransaction({
        type: draft.type,
        amount: draft.amount,
        description: draft.description,
        source: 'macrodroid',
      });
      lastTx = transaction;
      if (!duplicated && onNewTransaction) {
        await onNewTransaction(transaction);
      }
    }

    return {
      httpStatus: 200,
      body: {
        ok: true,
        recorded: true,
        duplicated: false,
        transaction: lastTx,
      },
    };
  }

  // 5. Jika tidak dikenali sama sekali
  if (config.notifyUnparsedEmail && onUnparsedNotification) {
    await onUnparsedNotification({
      subject: title || 'Notif MacroDroid SeaBank',
      reason: parsed.reason ?? 'Format notifikasi tidak dikenali',
      snippet: combinedText.slice(0, 220),
    });
  }

  return {
    httpStatus: 422,
    body: {
      ok: false,
      reason: parsed.reason ?? 'Format notifikasi SeaBank tidak dikenali',
    },
  };
}

/**
 * Parser JSON toleran untuk body dari MacroDroid:
 * Jika teks notifikasi mengandung enter (\n) mentah di dalam string JSON, ubah dulu jadi \\n lalu parse ulang.
 */
function parseLenientMacroDroidJson(rawBody: string): Record<string, string> | null {
  const tryParse = (input: string): Record<string, string> | null => {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined && v !== null) {
          out[k] = String(v);
        }
      }
      return out;
    } catch {
      return null;
    }
  };

  const direct = tryParse(rawBody);
  if (direct) return direct;

  // Escape newline/tab mentah hanya di dalam literal string JSON (menjaga pretty-printed JSON tetap valid)
  let inString = false;
  let escaped = false;
  let sanitized = '';
  for (let i = 0; i < rawBody.length; i++) {
    const ch = rawBody[i];
    if (inString) {
      if (escaped) {
        sanitized += ch;
        escaped = false;
      } else if (ch === '\\') {
        sanitized += ch;
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        sanitized += ch;
      } else if (ch === '\r') {
        if (rawBody[i + 1] === '\n') i++;
        sanitized += '\\n';
      } else if (ch === '\n') {
        sanitized += '\\n';
      } else if (ch === '\t') {
        sanitized += ' ';
      } else {
        sanitized += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
      sanitized += ch;
    }
  }
  const repaired = tryParse(sanitized);
  if (repaired) return repaired;

  // Fallback ekstraksi field manual jika ada kutip ganda tak ter-escape di dalam nilai string
  const extracted: Record<string, string> = {};
  const fieldRegex =
    /"(title|subject|not_title|text|body|message|not_text|bigText|big_text|subText|not_sub_text|id|secret|token|key)"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+"\s*:|\s*\})/g;
  for (const match of rawBody.matchAll(fieldRegex)) {
    extracted[match[1]] = match[2].replace(/\\n/g, '\n').trim();
  }
  return Object.keys(extracted).length > 0 ? extracted : null;
}

/**
 * Membaca body HTTP request dan menggabungkannya dengan query parameter URL.
 */
export async function extractMacroDroidPayload(
  req: IncomingMessage,
  urlObj: URL
): Promise<{ payload: MacroDroidPayload; providedSecret: string | null }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8').trim();
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();

  let bodyObj: Record<string, string> = {};

  if (rawBody) {
    if (contentType.includes('application/json') || (rawBody.startsWith('{') && rawBody.endsWith('}'))) {
      const jsonObj = parseLenientMacroDroidJson(rawBody);
      if (jsonObj) {
        bodyObj = jsonObj;
      } else {
        bodyObj.text = rawBody;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      for (const [k, v] of params.entries()) {
        bodyObj[k] = v;
      }
    } else {
      bodyObj.text = rawBody;
    }
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const fromQuery = urlObj.searchParams.get(k);
      if (fromQuery !== null && fromQuery.trim() !== '') return fromQuery;
      if (bodyObj[k] !== undefined && bodyObj[k].trim() !== '') return bodyObj[k];
    }
    return undefined;
  };

  const headerSecret =
    (req.headers['x-webhook-secret'] as string | undefined) ||
    (req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');

  const providedSecret = headerSecret || pick('secret', 'token', 'key') || null;

  return {
    payload: {
      title: pick('title', 'subject', 'not_title'),
      text: pick('text', 'body', 'message', 'not_text', 'q'),
      bigText: pick('bigText', 'big_text', 'subText', 'not_sub_text'),
      id: pick('id', 'notification_id'),
      secret: providedSecret ?? undefined,
    },
    providedSecret,
  };
}
