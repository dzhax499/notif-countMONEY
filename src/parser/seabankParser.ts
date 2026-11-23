import type { ParseResult, RawEmailInput, TransactionType } from '../types.js';

/**
 * Mengubah HTML menjadi teks bersih (mempertahankan jeda baris antar blok/tabel).
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|br|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ': ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*:\s*\n/g, '\n')
    .replace(/:\s*$/g, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Parse string angka Rupiah (contoh: "150.000", "150.000,00", "1,250,000.00", "50.000,-")
 * menjadi integer Rupiah positif.
 */
export function parseRupiahAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/rp\.?|idr/gi, '')
    .replace(/,-$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!cleaned || !/\d/.test(cleaned)) {
    return null;
  }

  // Format Indonesia dengan desimal koma: "150.000,00" atau "50000,50"
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(cleaned)) {
    const intPart = cleaned.split(',')[0].replace(/\./g, '');
    const value = Number.parseInt(intPart, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  // Format Internasional dengan koma ribuan & titik desimal: "150,000.00" atau "1,250,000"
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(cleaned)) {
    const intPart = cleaned.split('.')[0].replace(/,/g, '');
    const value = Number.parseInt(intPart, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  // Format angka polos dengan desimal: "150000,00" atau "150000.00"
  if (/^\d+[.,]\d{1,2}$/.test(cleaned)) {
    const intPart = cleaned.split(/[.,]/)[0];
    const value = Number.parseInt(intPart, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  // Format angka polos: "150000"
  if (/^\d+$/.test(cleaned)) {
    const value = Number.parseInt(cleaned, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  return null;
}

const NON_TRANSACTION_PATTERNS: RegExp[] = [
  /\botp\b/i,
  /kode\s+verifikasi/i,
  /verification\s+code/i,
  /konfirmasi\s+alamat\s+email/i,
  /email\s+berhasil\s+di-?update/i,
  /perubahan\s+(?:email|profil|data|nomor)/i,
  /reset\s+password/i,
  /ubah\s+(pin|password|kata\s+sandi)/i,
  /login\s+(baru|berhasil|dari\s+perangkat)/i,
  /perangkat\s+baru/i,
  /e-?statement/i,
  /laporan\s+bulanan/i,
  /rekening\s+koran/i,
  /promo|diskon|voucher|undang\s+teman/i,
  /gagal|failed|ditolak|declined|dibatalkan|cancelled/i,
];

const INCOME_PATTERNS: RegExp[] = [
  /transfer\s+masuk/i,
  /dana\s+masuk/i,
  /uang\s+masuk/i,
  /penerimaan\s+dana/i,
  /menerima\s+(dana|transfer|uang)/i,
  /telah\s+menerima/i,
  /dana\s+sebesar[\s\S]{0,60}telah\s+masuk/i,
  /masuk\s+ke\s+rekening/i,
  /incoming\s+transfer/i,
  /you(?:'ve|\s+have)?\s+received/i,
  /credit\s+notification/i,
  /pembayaran\s+bunga/i,
  /bunga\s+(harian|tabungan|deposito)/i,
  /interest\s+(credit|earned|paid)/i,
  /cashback|refund|pengembalian\s+dana/i,
  /pencairan\s+deposito/i,
  /top[\s-]*up\s+(saldo\s+)?seabank\s+berhasil/i,
  /isi\s+saldo\s+seabank\s+berhasil/i,
  /setor\s+tunai/i,
];

const EXPENSE_PATTERNS: RegExp[] = [
  /pembayaran\s+qris/i,
  /transaksi\s+qris/i,
  /\bqris\b/i,
  /transfer\s+keluar/i,
  /pengiriman\s+dana/i,
  /dana\s+keluar/i,
  /outgoing\s+transfer/i,
  /top[\s-]*up\s+(e-?wallet|gopay|ovo|dana|shopeepay|linkaja|flazz|e-?money)/i,
  /pembayaran\s+(berhasil|tagihan|virtual\s+account|va|merchant|shopee)/i,
  /pembelian\s+(berhasil|pulsa|paket\s+data|token|listrik)/i,
  /bayar\s+(tagihan|merchant|belanja)/i,
  /payment\s+successful/i,
  /tarik\s+tunai/i,
  /debit\s+(transaksi|otomatis|berhasil|notification)/i,
  /biaya\s+(admin|bulanan|materai)/i,
  /penempatan\s+deposito/i,
  /transfer\s+(dana\s+)?berhasil/i,
  /bukti\s+transfer/i,
  /transaksi\s+berhasil/i,
  /kamu\s+telah\s+(melakukan\s+)?(transfer|pembayaran|transaksi)/i,
  /telah\s+dikirim\s+ke/i,
];

function detectTransactionType(subject: string, body: string): TransactionType | null {
  const combined = `${subject}\n${body}`;

  // Cek income lebih dulu untuk subject karena "Transfer Masuk Berhasil" mengandung kata "Transfer ... Berhasil"
  for (const pattern of INCOME_PATTERNS) {
    if (pattern.test(subject)) {
      return 'income';
    }
  }

  for (const pattern of EXPENSE_PATTERNS) {
    if (pattern.test(subject)) {
      return 'expense';
    }
  }

  // Jika di subject tidak tegas, cek seluruh isi email (prioritas income keywords spesifik dulu)
  for (const pattern of INCOME_PATTERNS) {
    if (pattern.test(combined)) {
      return 'income';
    }
  }

  for (const pattern of EXPENSE_PATTERNS) {
    if (pattern.test(combined)) {
      return 'expense';
    }
  }

  return null;
}

const AMOUNT_REGEX = /(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)(?:,-)?/gi;

function extractPrimaryAmount(body: string): number | null {
  // 1. Cari berdasarkan label yang sangat jelas (Total Pembayaran / Nominal Transaksi / Jumlah / sebesar)
  const prioritizedLabels: RegExp[] = [
    /(?:total\s+(?:pembayaran|transaksi|debit|bayar|nominal|amount))\s*[:\-]?\s*(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
    /(?:nominal\s+(?:transaksi|transfer|pembayaran|masuk|keluar)?)\s*[:\-]?\s*(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
    /(?:jumlah\s+(?:transaksi|transfer|pembayaran|dana|uang)?)\s*[:\-]?\s*(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
    /(?:amount|transaction\s+amount|transfer\s+amount)\s*[:\-]?\s*(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
    /sebesar\s+(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
  ];

  for (const regex of prioritizedLabels) {
    const match = body.match(regex);
    if (match?.[1]) {
      const parsed = parseRupiahAmount(match[1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  // 2. Fallback: scan per baris, abaikan baris Biaya Admin & Saldo Akhir
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (/(?:biaya\s+(?:admin|transfer|layanan)|admin\s+fee|fee|saldo\s+(?:akhir|sekarang|tersedia)|sisa\s+saldo|balance)/i.test(line)) {
      continue;
    }
    const matches = [...line.matchAll(AMOUNT_REGEX)];
    for (const match of matches) {
      const parsed = parseRupiahAmount(match[1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function extractBalanceAfter(body: string): number | null {
  const balancePatterns: RegExp[] = [
    /(?:saldo\s+(?:akhir|sekarang|tersedia|efektif)|sisa\s+saldo|available\s+balance|ending\s+balance)\s*[:\-]?\s*(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i,
  ];

  for (const pattern of balancePatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return parseRupiahAmount(match[1]);
    }
  }
  return null;
}

function extractCounterparty(body: string, type: TransactionType): string | null {
  const patterns: RegExp[] =
    type === 'income'
      ? [
          /(?:dari|pengirim|nama\s+pengirim|sender|from)\s*[:\-]\s*([^\n]{2,80})/i,
          /menerima\s+(?:dana|transfer)[\s\S]{0,40}\bdari\s+([^\n.,]{2,60})/i,
        ]
      : [
          /(?:merchant|nama\s+merchant|penerima|nama\s+penerima|tujuan|ke\s+rekening|recipient|beneficiary)\s*[:\-]\s*([^\n]{2,80})/i,
          /(?:pembayaran\s+qris|transfer)[\s\S]{0,40}\b(?:ke|di)\s+([^\n.,]{2,60})/i,
        ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1]
        .replace(/\s+/g, ' ')
        .replace(/^(?:rekening|bank)\s+/i, '')
        .replace(/\s+(?:berhasil|sukses).*$/i, '')
        .replace(/[:\-.,;\s]+$/, '')
        .trim();
      if (cleaned.length >= 2 && !/^(?:rp|idr|\d+)$/i.test(cleaned)) {
        return cleaned.slice(0, 80);
      }
    }
  }

  return null;
}

function extractReference(body: string): string | null {
  const refPatterns: RegExp[] = [
    /(?:no\.?\s*referensi|nomor\s+referensi|ref\.?\s*no\.?|reference\s*(?:id|no|number)?|id\s+transaksi|transaction\s+id|no\.?\s*transaksi)\s*[:\-#]?\s*([A-Z0-9\-_]{6,40})/i,
  ];

  for (const pattern of refPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function buildDescription(subject: string, type: TransactionType, counterparty: string | null): string {
  const cleanSubject = subject
    .replace(/^(?:re|fwd?)\s*:\s*/i, '')
    .replace(/\[?seabank\]?\s*[-:|]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const baseTitle =
    cleanSubject || (type === 'income' ? 'Dana Masuk SeaBank' : 'Transaksi Keluar SeaBank');

  if (counterparty && !baseTitle.toLowerCase().includes(counterparty.toLowerCase())) {
    const preposition = type === 'income' ? 'dari' : 'ke';
    return `${baseTitle} (${preposition} ${counterparty})`;
  }

  return baseTitle;
}

export function isFromSeaBank(from: string, subject: string, senderFilters: string[]): boolean {
  const normalizedFrom = from.toLowerCase();
  const normalizedSubject = subject.toLowerCase();

  for (const filter of senderFilters) {
    const token = filter.toLowerCase().trim();
    if (!token) continue;
    if (normalizedFrom.includes(token)) {
      return true;
    }
  }

  // Fallback jika diteruskan (forwarded) dari email lain tapi subject jelas menyebut SeaBank
  if (normalizedSubject.includes('seabank')) {
    return true;
  }

  return false;
}

export function parseSeaBankEmail(
  email: RawEmailInput,
  senderFilters: string[] = ['seabank.co.id', 'seabank']
): ParseResult {
  const fromSeaBank = isFromSeaBank(email.from, email.subject, senderFilters);
  if (!fromSeaBank) {
    return {
      matched: false,
      isSeaBankEmail: false,
      reason: 'Bukan email dari SeaBank',
    };
  }

  const textBody = email.text?.trim() || (email.html ? stripHtml(email.html) : '');
  const fullContent = `${email.subject}\n${textBody}`;

  for (const ignorePattern of NON_TRANSACTION_PATTERNS) {
    if (ignorePattern.test(email.subject)) {
      return {
        matched: false,
        isSeaBankEmail: true,
        reason: `Email non-transaksi / diabaikan (${ignorePattern.source})`,
      };
    }
  }

  const type = detectTransactionType(email.subject, textBody);
  if (!type) {
    // Cek juga non-transaksi di body jika tipe tidak terdeteksi
    for (const ignorePattern of NON_TRANSACTION_PATTERNS) {
      if (ignorePattern.test(fullContent)) {
        return {
          matched: false,
          isSeaBankEmail: true,
          reason: 'Email non-transaksi SeaBank (OTP/Login/Promo/Statement)',
        };
      }
    }
    return {
      matched: false,
      isSeaBankEmail: true,
      reason: 'Tidak dapat menentukan jenis transaksi (uang masuk atau uang keluar)',
    };
  }

  const amount = extractPrimaryAmount(fullContent);
  if (amount === null) {
    return {
      matched: false,
      isSeaBankEmail: true,
      reason: 'Nominal transaksi (Rp/IDR) tidak ditemukan di isi email',
    };
  }

  const counterparty = extractCounterparty(textBody, type);
  const reference = extractReference(textBody);
  const balanceAfter = extractBalanceAfter(textBody);
  const description = buildDescription(email.subject, type, counterparty);

  return {
    matched: true,
    isSeaBankEmail: true,
    transaction: {
      type,
      amount,
      description,
      counterparty,
      reference,
      balanceAfter,
      occurredAt: email.date instanceof Date && !Number.isNaN(email.date.getTime()) ? email.date : new Date(),
    },
  };
}
