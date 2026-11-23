import { FinanceDatabase } from '../db/database.js';
import type {
  DailySummary,
  MonthlySummary,
  NewTransactionInput,
  Transaction,
} from '../types.js';
import { toDateKey, toMonthKey } from './formatter.js';

export class FinanceService {
  constructor(
    private readonly db: FinanceDatabase,
    private readonly timezone: string = 'Asia/Jakarta'
  ) {}

  getCurrentBalance(): number {
    return this.db.getCurrentBalance();
  }

  setCurrentBalance(amount: number): number {
    if (!Number.isFinite(amount)) {
      throw new Error('Nominal saldo tidak valid.');
    }
    return this.db.setCurrentBalance(amount);
  }

  recordTransaction(input: NewTransactionInput): { transaction: Transaction; duplicated: boolean } {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Nominal transaksi harus lebih dari 0.');
    }

    // Anti-duplikat berdasarkan externalId (Message-ID email)
    if (input.externalId && this.db.hasTransactionByExternalId(input.externalId)) {
      return {
        transaction: this.db.getRecentTransactions(1)[0],
        duplicated: true,
      };
    }

    // Anti-duplikat tambahan berdasarkan nomor referensi SeaBank (jika email dikirim ulang / diforward)
    if (input.reference && this.db.hasTransactionByReference(input.reference)) {
      return {
        transaction: this.db.getRecentTransactions(1)[0],
        duplicated: true,
      };
    }

    const amount = Math.round(input.amount);
    const currentBalance = this.db.getCurrentBalance();
    const calculatedBalance =
      input.type === 'income' ? currentBalance + amount : currentBalance - amount;

    // Jika email mencantumkan saldo akhir secara eksplisit, gunakan itu agar selalu sinkron dengan SeaBank
    const nextBalance =
      input.explicitBalanceAfter !== undefined && input.explicitBalanceAfter !== null
        ? Math.round(input.explicitBalanceAfter)
        : calculatedBalance;

    const occurredDate = input.occurredAt ?? new Date();
    const dateKey = toDateKey(occurredDate, this.timezone);

    const tx = this.db.insertTransaction({
      type: input.type,
      amount,
      description: input.description.trim() || (input.type === 'income' ? 'Uang Masuk' : 'Uang Keluar'),
      counterparty: input.counterparty ?? null,
      reference: input.reference ?? null,
      source: input.source,
      externalId: input.externalId ?? null,
      balanceAfter: nextBalance,
      occurredAt: occurredDate.toISOString(),
      dateKey,
    });

    this.db.setCurrentBalance(nextBalance);

    return { transaction: tx, duplicated: false };
  }

  deleteTransaction(id: number): { deleted: Transaction; newBalance: number } | null {
    const deleted = this.db.deleteTransactionById(id);
    if (!deleted) return null;

    // Rollback saldo: jika yang dihapus income maka kurangi saldo; jika expense maka tambahkan kembali
    const currentBalance = this.db.getCurrentBalance();
    const adjustedBalance =
      deleted.type === 'income'
        ? currentBalance - deleted.amount
        : currentBalance + deleted.amount;

    const newBalance = this.db.setCurrentBalance(adjustedBalance);
    return { deleted, newBalance };
  }

  getDailySummary(dateKey?: string): DailySummary {
    const targetDateKey = dateKey ?? toDateKey(new Date(), this.timezone);
    const agg = this.db.getDateAggregate(targetDateKey);
    const netDifference = agg.totalIncome - agg.totalExpense;

    return {
      dateKey: targetDateKey,
      totalIncome: agg.totalIncome,
      totalExpense: agg.totalExpense,
      netDifference,
      absDifference: Math.abs(netDifference),
      incomeCount: agg.incomeCount,
      expenseCount: agg.expenseCount,
      currentBalance: this.db.getCurrentBalance(),
    };
  }

  getMonthlySummary(monthKey?: string): MonthlySummary {
    const targetMonthKey = monthKey ?? toMonthKey(new Date(), this.timezone);
    const agg = this.db.getMonthAggregate(targetMonthKey);
    const netDifference = agg.totalIncome - agg.totalExpense;

    return {
      monthKey: targetMonthKey,
      totalIncome: agg.totalIncome,
      totalExpense: agg.totalExpense,
      netDifference,
      absDifference: Math.abs(netDifference),
      incomeCount: agg.incomeCount,
      expenseCount: agg.expenseCount,
      currentBalance: this.db.getCurrentBalance(),
    };
  }

  getRecentTransactions(limit = 10): Transaction[] {
    return this.db.getRecentTransactions(limit);
  }

  getTotalTransactionCount(): number {
    return this.db.getTotalTransactionCount();
  }

  isEmailProcessed(messageId: string): boolean {
    return this.db.isEmailProcessed(messageId);
  }

  markEmailProcessed(messageId: string, subject: string, status: 'recorded' | 'ignored' | 'unparsed'): void {
    this.db.markEmailProcessed(messageId, subject, status);
  }

  getTodayDateKey(now: Date = new Date()): string {
    return toDateKey(now, this.timezone);
  }

  /**
   * Menentukan tanggal rekap untuk jadwal cron otomatis.
   * Jika cron jalan pada jam 00:xx (tengah malam), otomatis merekap hari yang baru saja berakhir (kemarin)
   * agar total 24 jam penuh tercatat dan tidak Rp 0 karena baru ganti hari.
   */
  getScheduledRecapDateKey(now: Date = new Date()): { dateKey: string; isToday: boolean } {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now);
    const localHour = Number.parseInt(hourStr, 10) % 24;

    if (localHour === 0) {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return {
        dateKey: toDateKey(yesterday, this.timezone),
        isToday: false,
      };
    }

    return {
      dateKey: toDateKey(now, this.timezone),
      isToday: true,
    };
  }
}
