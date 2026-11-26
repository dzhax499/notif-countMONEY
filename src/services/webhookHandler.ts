import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config.js';
import { parseQuickTextMessage } from '../parser/quickTextParser.js';
import { parseSeaBankPushNotification } from '../parser/seabankParser.js';
import type { Transaction } from '../types.js';
import type { FinanceService } from './financeService.js';

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

  const title = (payload.title ?? '').trim();
  const text = (payload.text ?? '').trim();
  const bigText = (payload.bigText ?? '').trim();
  const combinedText = (bigText || text || title).trim();

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
    // Dedup bucket 2 menit untuk mencegah Android mengirim event banner notifikasi yang sama 2x berturut-turut
    const bucket = Math.floor(Date.now() / 120_000);
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
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== undefined && v !== null) {
            bodyObj[k] = String(v);
          }
        }
      } catch {
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
