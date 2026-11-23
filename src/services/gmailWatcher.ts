import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AppConfig } from '../config.js';
import { parseSeaBankEmail, stripHtml } from '../parser/seabankParser.js';
import type { SyncResult, Transaction } from '../types.js';
import { FinanceService } from './financeService.js';

export interface GmailWatcherCallbacks {
  onNewTransaction: (tx: Transaction) => Promise<void>;
  onUnparsedSeaBankEmail?: (info: {
    messageId: string;
    subject: string;
    reason: string;
    snippet: string;
  }) => Promise<void>;
}

export class GmailWatcher {
  private timer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private lastSyncAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly financeService: FinanceService,
    private readonly callbacks: GmailWatcherCallbacks
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.gmailUser && this.config.gmailAppPassword);
  }

  getStatus(): {
    configured: boolean;
    gmailUser: string | null;
    isSyncing: boolean;
    pollIntervalSeconds: number;
    lastSyncAt: Date | null;
    lastError: string | null;
  } {
    return {
      configured: this.isConfigured(),
      gmailUser: this.config.gmailUser,
      isSyncing: this.isSyncing,
      pollIntervalSeconds: this.config.emailPollIntervalSeconds,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  start(): void {
    if (!this.isConfigured()) {
      console.warn(
        '[GmailWatcher] GMAIL_USER atau GMAIL_APP_PASSWORD belum diisi di .env. Polling email tidak aktif (mode manual tetap berjalan).'
      );
      return;
    }

    if (this.timer) return;

    console.log(
      `[GmailWatcher] Aktif! Mengecek email SeaBank di ${this.config.gmailUser} setiap ${this.config.emailPollIntervalSeconds} detik.`
    );

    // Jalankan sync pertama kali saat startup
    void this.syncNow().catch((err) => {
      console.error('[GmailWatcher] Sync awal gagal:', err);
    });

    this.timer = setInterval(() => {
      void this.syncNow().catch((err) => {
        console.error('[GmailWatcher] Sync berkala gagal:', err);
      });
    }, this.config.emailPollIntervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncNow(): Promise<SyncResult> {
    if (!this.isConfigured()) {
      throw new Error('GMAIL_USER dan GMAIL_APP_PASSWORD belum dikonfigurasi di file .env');
    }

    if (this.isSyncing) {
      return {
        checkedCount: 0,
        newTransactions: [],
        skippedDuplicates: 0,
        unparsedEmails: [],
      };
    }

    this.isSyncing = true;
    const result: SyncResult = {
      checkedCount: 0,
      newTransactions: [],
      skippedDuplicates: 0,
      unparsedEmails: [],
    };

    const client = new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: true,
      auth: {
        user: this.config.gmailUser!,
        pass: this.config.gmailAppPassword!,
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Hitung batas tanggal pencarian (EMAIL_LOOKBACK_DAYS hari ke belakang)
        const sinceDate = new Date();
        sinceDate.setHours(0, 0, 0, 0);
        sinceDate.setDate(sinceDate.getDate() - this.config.emailLookbackDays);

        // Cari semua email sejak sinceDate (termasuk yang sudah dibuka di HP, deduplikasi via SQLite)
        const uids = await client.search({ since: sinceDate }, { uid: true });

        if (!uids || uids.length === 0) {
          this.lastSyncAt = new Date();
          this.lastError = null;
          return result;
        }

        // Ambil envelope dulu untuk filter cepat agar hanya download body email yang berpotensi dari SeaBank
        const candidateUids: number[] = [];
        for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          const fromList = msg.envelope?.from ?? [];
          const fromString = fromList
            .map((addr) => `${addr.name ?? ''} <${addr.address ?? ''}>`)
            .join(', ')
            .toLowerCase();
          const subjectLower = (msg.envelope?.subject ?? '').toLowerCase();

          const matchesSender =
            this.config.seabankSenderFilters.some((f) => fromString.includes(f)) ||
            subjectLower.includes('seabank');

          if (!matchesSender) {
            continue;
          }

          const messageId = msg.envelope?.messageId || `imap-uid-${msg.uid}`;
          if (this.financeService.isEmailProcessed(messageId)) {
            result.skippedDuplicates += 1;
            continue;
          }

          candidateUids.push(msg.uid);
        }

        if (candidateUids.length === 0) {
          this.lastSyncAt = new Date();
          this.lastError = null;
          return result;
        }

        // Urutkan dari email paling lama ke terbaru agar urutan saldo kronologis
        candidateUids.sort((a, b) => a - b);

        // Download & parse isi email kandidat (source: true memakai BODY.PEEK sehingga tidak mengubah status Unread di Gmail)
        for await (const msg of client.fetch(candidateUids, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          result.checkedCount += 1;

          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId || `imap-uid-${msg.uid}`;
          const subject = parsed.subject ?? '(Tanpa Subject)';
          const from = parsed.from?.text ?? '';
          const text = parsed.text ?? '';
          const html = typeof parsed.html === 'string' ? parsed.html : undefined;
          const date = parsed.date ?? new Date();

          if (this.financeService.isEmailProcessed(messageId)) {
            result.skippedDuplicates += 1;
            continue;
          }

          const parseResult = parseSeaBankEmail(
            { messageId, uid: msg.uid, from, subject, text, html, date },
            this.config.seabankSenderFilters
          );

          if (!parseResult.isSeaBankEmail) {
            this.financeService.markEmailProcessed(messageId, subject, 'ignored');
            continue;
          }

          if (!parseResult.matched || !parseResult.transaction) {
            const reason = parseResult.reason ?? 'Format tidak dikenali';
            const isNonTx = reason.toLowerCase().includes('non-transaksi');
            this.financeService.markEmailProcessed(messageId, subject, isNonTx ? 'ignored' : 'unparsed');

            if (!isNonTx) {
              const snippetSource = text || (html ? stripHtml(html) : '');
              const snippet = snippetSource.replace(/\s+/g, ' ').trim().slice(0, 220);
              const unparsedInfo = { messageId, subject, reason, snippet };
              result.unparsedEmails.push(unparsedInfo);

              if (this.config.notifyUnparsedEmail && this.callbacks.onUnparsedSeaBankEmail) {
                await this.callbacks.onUnparsedSeaBankEmail(unparsedInfo);
              }
            }
            continue;
          }

          const txData = parseResult.transaction;
          const { transaction, duplicated } = this.financeService.recordTransaction({
            type: txData.type,
            amount: txData.amount,
            description: txData.description,
            counterparty: txData.counterparty,
            reference: txData.reference,
            source: 'seabank_email',
            externalId: messageId,
            explicitBalanceAfter: txData.balanceAfter,
            occurredAt: txData.occurredAt,
          });

          this.financeService.markEmailProcessed(messageId, subject, 'recorded');

          if (duplicated) {
            result.skippedDuplicates += 1;
            continue;
          }

          result.newTransactions.push(transaction);
          await this.callbacks.onNewTransaction(transaction);
        }
      } finally {
        lock.release();
      }

      await client.logout();
      this.lastSyncAt = new Date();
      this.lastError = null;
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.lastError = errMsg;
      try {
        client.close();
      } catch {
        // Abaikan error saat force close
      }
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }
}
