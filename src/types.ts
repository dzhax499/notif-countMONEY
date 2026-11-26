export type TransactionType = 'income' | 'expense';

export type TransactionSource = 'seabank_email' | 'macrodroid' | 'manual';

export interface NotificationSourceSettings {
  gmailEnabled: boolean;
  macrodroidEnabled: boolean;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number; // Integer Rupiah (positif)
  description: string;
  counterparty: string | null;
  reference: string | null;
  source: TransactionSource;
  externalId: string | null; // Email Message-ID / unique key untuk anti-duplikat
  balanceAfter: number;
  occurredAt: string; // ISO 8601 UTC timestamp
  dateKey: string; // YYYY-MM-DD sesuai timezone (misal Asia/Jakarta)
  createdAt: string;
}

export interface NewTransactionInput {
  type: TransactionType;
  amount: number;
  description: string;
  counterparty?: string | null;
  reference?: string | null;
  source: TransactionSource;
  externalId?: string | null;
  explicitBalanceAfter?: number | null;
  occurredAt?: Date;
}

export interface DailySummary {
  dateKey: string; // YYYY-MM-DD
  totalIncome: number;
  totalExpense: number;
  netDifference: number; // totalIncome - totalExpense
  absDifference: number;
  incomeCount: number;
  expenseCount: number;
  currentBalance: number;
}

export interface MonthlySummary {
  monthKey: string; // YYYY-MM
  totalIncome: number;
  totalExpense: number;
  netDifference: number;
  absDifference: number;
  incomeCount: number;
  expenseCount: number;
  currentBalance: number;
}

export interface RawEmailInput {
  messageId: string;
  uid?: number;
  from: string;
  subject: string;
  text: string;
  html?: string;
  date: Date;
}

export interface ParsedSeaBankTransaction {
  type: TransactionType;
  amount: number;
  description: string;
  counterparty: string | null;
  reference: string | null;
  balanceAfter: number | null;
  occurredAt: Date;
}

export interface ParseResult {
  matched: boolean;
  isSeaBankEmail: boolean;
  transaction?: ParsedSeaBankTransaction;
  reason?: string;
}

export interface SyncResult {
  checkedCount: number;
  newTransactions: Transaction[];
  skippedDuplicates: number;
  unparsedEmails: Array<{
    messageId: string;
    subject: string;
    reason: string;
    snippet: string;
  }>;
}
