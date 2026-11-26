import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  NotificationSourceSettings,
  Transaction,
  TransactionSource,
  TransactionType,
} from '../types.js';

interface TransactionRow {
  id: number;
  type: string;
  amount: number;
  description: string;
  counterparty: string | null;
  reference: string | null;
  source: string;
  external_id: string | null;
  balance_after: number;
  occurred_at: string;
  date_key: string;
  created_at: string;
}

interface SettingRow {
  value: string;
}

interface SummaryAggregateRow {
  total_income: number | null;
  total_expense: number | null;
  income_count: number | null;
  expense_count: number | null;
}

export class FinanceDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      const dir = path.dirname(databasePath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        amount INTEGER NOT NULL CHECK(amount > 0),
        description TEXT NOT NULL,
        counterparty TEXT,
        reference TEXT,
        source TEXT NOT NULL DEFAULT 'seabank_email',
        external_id TEXT UNIQUE,
        balance_after INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_date_key ON transactions(date_key);
      CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at);

      CREATE TABLE IF NOT EXISTS processed_emails (
        message_id TEXT PRIMARY KEY,
        subject TEXT,
        status TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Pastikan saldo awal tersedia (default 0 jika belum pernah diset)
    const existingBalance = this.getSetting('current_balance');
    if (existingBalance === null) {
      this.setSetting('current_balance', '0');
    }

    // Default toggle sumber notifikasi (keduanya ON secara default, bisa diubah lewat tombol Telegram /sumber)
    if (this.getSetting('gmail_enabled') === null) {
      this.setSetting('gmail_enabled', 'true');
    }
    if (this.getSetting('macrodroid_enabled') === null) {
      this.setSetting('macrodroid_enabled', 'true');
    }
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as SettingRow | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);
    stmt.run(key, value);
  }

  getCurrentBalance(): number {
    const raw = this.getSetting('current_balance');
    const parsed = raw !== null ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  setCurrentBalance(amount: number): number {
    const rounded = Math.round(amount);
    this.setSetting('current_balance', String(rounded));
    return rounded;
  }

  isEmailProcessed(messageId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM processed_emails WHERE message_id = ?');
    return Boolean(stmt.get(messageId));
  }

  markEmailProcessed(messageId: string, subject: string, status: 'recorded' | 'ignored' | 'unparsed'): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO processed_emails (message_id, subject, status, processed_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(messageId, subject.slice(0, 300), status);
  }

  hasTransactionByExternalId(externalId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM transactions WHERE external_id = ?');
    return Boolean(stmt.get(externalId));
  }

  hasTransactionByReference(reference: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM transactions WHERE reference = ?');
    return Boolean(stmt.get(reference));
  }

  /**
   * Mengecek apakah baru saja ada transaksi otomatis dari sumber lain (misal MacroDroid vs Email Gmail)
   * dengan jenis (income/expense) dan nominal yang sama persis dalam rentang waktu tertentu.
   */
  hasRecentCrossSourceDuplicate(params: {
    type: TransactionType;
    amount: number;
    incomingSource: TransactionSource;
    windowSeconds?: number;
  }): boolean {
    if (params.incomingSource === 'manual') {
      return false;
    }

    const windowSec = params.windowSeconds ?? 300; // Default 5 menit
    const cutoffIso = new Date(Date.now() - windowSec * 1000).toISOString();

    const stmt = this.db.prepare(`
      SELECT 1 FROM transactions
      WHERE type = ?
        AND amount = ?
        AND source != 'manual'
        AND source != ?
        AND occurred_at >= ?
      LIMIT 1
    `);

    return Boolean(
      stmt.get(params.type, Math.round(params.amount), params.incomingSource, cutoffIso)
    );
  }

  getSourceSettings(): NotificationSourceSettings {
    const gmailRaw = this.getSetting('gmail_enabled');
    const macrodroidRaw = this.getSetting('macrodroid_enabled');
    return {
      gmailEnabled: gmailRaw === null ? true : gmailRaw === 'true',
      macrodroidEnabled: macrodroidRaw === null ? true : macrodroidRaw === 'true',
    };
  }

  setGmailEnabled(enabled: boolean): NotificationSourceSettings {
    this.setSetting('gmail_enabled', enabled ? 'true' : 'false');
    return this.getSourceSettings();
  }

  setMacrodroidEnabled(enabled: boolean): NotificationSourceSettings {
    this.setSetting('macrodroid_enabled', enabled ? 'true' : 'false');
    return this.getSourceSettings();
  }

  insertTransaction(params: {
    type: TransactionType;
    amount: number;
    description: string;
    counterparty: string | null;
    reference: string | null;
    source: TransactionSource;
    externalId: string | null;
    balanceAfter: number;
    occurredAt: string;
    dateKey: string;
  }): Transaction {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (
        type, amount, description, counterparty, reference,
        source, external_id, balance_after, occurred_at, date_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.type,
      params.amount,
      params.description,
      params.counterparty,
      params.reference,
      params.source,
      params.externalId,
      params.balanceAfter,
      params.occurredAt,
      params.dateKey
    );

    const inserted = this.getTransactionById(Number(result.lastInsertRowid));
    if (!inserted) {
      throw new Error('Gagal membaca transaksi yang baru disimpan.');
    }
    return inserted;
  }

  getTransactionById(id: number): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE id = ?');
    const row = stmt.get(id) as TransactionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  deleteTransactionById(id: number): Transaction | null {
    const existing = this.getTransactionById(id);
    if (!existing) return null;

    const stmt = this.db.prepare('DELETE FROM transactions WHERE id = ?');
    stmt.run(id);
    return existing;
  }

  getRecentTransactions(limit = 10): Transaction[] {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const stmt = this.db.prepare(`
      SELECT * FROM transactions
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `);
    const rows = stmt.all(safeLimit) as unknown as TransactionRow[];
    return rows.map((row) => this.mapRow(row));
  }

  getTransactionsByDate(dateKey: string): Transaction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE date_key = ?
      ORDER BY occurred_at ASC, id ASC
    `);
    const rows = stmt.all(dateKey) as unknown as TransactionRow[];
    return rows.map((row) => this.mapRow(row));
  }

  getDateAggregate(dateKey: string): {
    totalIncome: number;
    totalExpense: number;
    incomeCount: number;
    expenseCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN 1 ELSE 0 END), 0) AS income_count,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END), 0) AS expense_count
      FROM transactions
      WHERE date_key = ?
    `);
    const row = stmt.get(dateKey) as SummaryAggregateRow | undefined;
    return {
      totalIncome: Number(row?.total_income ?? 0),
      totalExpense: Number(row?.total_expense ?? 0),
      incomeCount: Number(row?.income_count ?? 0),
      expenseCount: Number(row?.expense_count ?? 0),
    };
  }

  getMonthAggregate(monthKey: string): {
    totalIncome: number;
    totalExpense: number;
    incomeCount: number;
    expenseCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN 1 ELSE 0 END), 0) AS income_count,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END), 0) AS expense_count
      FROM transactions
      WHERE date_key LIKE ?
    `);
    const row = stmt.get(`${monthKey}-%`) as SummaryAggregateRow | undefined;
    return {
      totalIncome: Number(row?.total_income ?? 0),
      totalExpense: Number(row?.total_expense ?? 0),
      incomeCount: Number(row?.income_count ?? 0),
      expenseCount: Number(row?.expense_count ?? 0),
    };
  }

  getTotalTransactionCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) AS total FROM transactions');
    const row = stmt.get() as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  private mapRow(row: TransactionRow): Transaction {
    return {
      id: row.id,
      type: row.type as TransactionType,
      amount: row.amount,
      description: row.description,
      counterparty: row.counterparty,
      reference: row.reference,
      source: row.source as TransactionSource,
      externalId: row.external_id,
      balanceAfter: row.balance_after,
      occurredAt: row.occurred_at,
      dateKey: row.date_key,
      createdAt: row.created_at,
    };
  }
}
