import { parseRupiahAmount } from './seabankParser.js';
import type { TransactionType } from '../types.js';

export interface QuickTransactionDraft {
  type: TransactionType;
  amount: number;
  description: string;
}

/**
 * Mem-parse nominal Rupiah fleksibel, termasuk singkatan populer:
 * - "25000", "25.000", "Rp 25.000", "25,000"
 * - "25k", "25.5k", "25,5k", "25rb", "25ribu"
 * - "1jt", "1.5jt", "1,5juta"
 */
export function parseFlexibleRupiah(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/^idr\s*/i, '')
    .replace(/,-$/g, '')
    .trim();

  if (!cleaned) return null;

  // Shorthand ribuan (k, rb, ribu) atau jutaan (jt, juta)
  const shorthandMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(k|rb|ribu|jt|juta)$/i);
  if (shorthandMatch) {
    const numStr = shorthandMatch[1].replace(',', '.');
    const unit = shorthandMatch[2].toLowerCase();
    const base = Number.parseFloat(numStr);
    if (!Number.isFinite(base) || base <= 0) return null;

    const multiplier = unit === 'jt' || unit === 'juta' ? 1_000_000 : 1_000;
    const result = Math.round(base * multiplier);
    return result > 0 ? result : null;
  }

  return parseRupiahAmount(cleaned);
}

const EXPENSE_PREFIX_WORDS = /^(?:keluar|out|spend|beli|bayar|jajan|belanja|tf|transfer|qris)\b/i;
const INCOME_PREFIX_WORDS = /^(?:masuk|in|dapat|dapet|terima|gaji|bonus|refund|cashback)\b/i;

/**
 * Parse satu baris ketik cepat menjadi draft transaksi.
 * Contoh valid:
 * - "-25k kopi"
 * - "- 35.000 makan siang"
 * - "+500k gaji freelance"
 * - "+1.5jt"
 * - "keluar 15rb parkir"
 * - "masuk 200k transfer budi"
 * - "beli 25k bensin"
 */
export function parseQuickTextLine(line: string): QuickTransactionDraft | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('/')) {
    return null;
  }

  // 1. Format tanda + / - di awal: "-25k kopi", "+500.000 gaji", "- Rp 15.000 parkir"
  const signedMatch = trimmed.match(
    /^([+-])\s*(?:(?:rp\.?|idr)\s*)?(\d[\d.,]*(?:\s*(?:k|rb|ribu|jt|juta))?)(?:\s+(.+))?$/i
  );
  if (signedMatch) {
    const sign = signedMatch[1];
    const amountToken = signedMatch[2].replace(/\s+/g, '');
    const restDesc = (signedMatch[3] ?? '').trim();

    const amount = parseFlexibleRupiah(amountToken);
    if (amount === null) return null;

    const type: TransactionType = sign === '+' ? 'income' : 'expense';
    const description =
      restDesc || (type === 'income' ? 'Pemasukan Cepat' : 'Pengeluaran Cepat');

    return { type, amount, description };
  }

  // 2. Format kata kunci natural: "keluar 25k kopi", "beli 15rb gorengan", "masuk 500k gaji"
  const isExpenseWord = EXPENSE_PREFIX_WORDS.test(trimmed);
  const isIncomeWord = INCOME_PREFIX_WORDS.test(trimmed);

  if (isExpenseWord || isIncomeWord) {
    const wordMatch = trimmed.match(
      /^([a-zA-Z]+)\s+(?:(?:rp\.?|idr)\s*)?(\d[\d.,]*(?:\s*(?:k|rb|ribu|jt|juta))?)(?:\s+(.+))?$/i
    );
    if (!wordMatch) return null;

    const keyword = wordMatch[1];
    const amountToken = wordMatch[2].replace(/\s+/g, '');
    const restDesc = (wordMatch[3] ?? '').trim();

    const amount = parseFlexibleRupiah(amountToken);
    if (amount === null) return null;

    const type: TransactionType = isIncomeWord ? 'income' : 'expense';
    const isGenericKeyword = /^(?:masuk|keluar|in|out|spend)$/i.test(keyword);
    const description = restDesc
      ? isGenericKeyword
        ? restDesc
        : `${keyword} ${restDesc}`
      : isGenericKeyword
        ? type === 'income'
          ? 'Pemasukan Cepat'
          : 'Pengeluaran Cepat'
        : keyword;

    return { type, amount, description };
  }

  return null;
}

/**
 * Parse pesan teks (mendukung 1 baris maupun multi-baris sekaligus).
 * Mengembalikan daftar transaksi valid dan daftar baris yang gagal dikenali.
 */
export function parseQuickTextMessage(text: string): {
  drafts: QuickTransactionDraft[];
  invalidLines: string[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const drafts: QuickTransactionDraft[] = [];
  const invalidLines: string[] = [];

  for (const line of lines) {
    const parsed = parseQuickTextLine(line);
    if (parsed) {
      drafts.push(parsed);
    } else {
      invalidLines.push(line);
    }
  }

  return { drafts, invalidLines };
}
