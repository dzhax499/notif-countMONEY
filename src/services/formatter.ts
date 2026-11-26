import type { DailySummary, MonthlySummary, Transaction } from '../types.js';

/**
 * Format angka integer ke format Rupiah Indonesia: 150000 -> "Rp 150.000"
 */
export function formatRupiah(amount: number): string {
  const isNegative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  const formatted = new Intl.NumberFormat('id-ID').format(abs);
  return isNegative ? `-Rp ${formatted}` : `Rp ${formatted}`;
}

/**
 * Format angka tanpa prefix "Rp", contoh: 65000 -> "65.000"
 */
export function formatNumberId(amount: number): string {
  return new Intl.NumberFormat('id-ID').format(Math.abs(Math.round(amount)));
}

/**
 * Menghasilkan dateKey "YYYY-MM-DD" sesuai timezone (default Asia/Jakarta).
 */
export function toDateKey(date: Date, timezone = 'Asia/Jakarta'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Menghasilkan monthKey "YYYY-MM" sesuai timezone.
 */
export function toMonthKey(date: Date, timezone = 'Asia/Jakarta'): string {
  return toDateKey(date, timezone).slice(0, 7);
}

/**
 * Format tanggal Indonesia yang ramah dibaca, contoh: "Senin, 23 Nov 2026"
 */
export function formatReadableDate(dateKey: string): string {
  const [yearStr, monthStr, dayStr] = dateKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!year || !month || !day) return dateKey;

  const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate);
}

/**
 * Format timestamp ISO menjadi "23 Nov 2026, 14:20 WIB"
 */
export function formatTimestamp(isoString: string, timezone = 'Asia/Jakarta'): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  const tzLabel =
    timezone === 'Asia/Jakarta'
      ? 'WIB'
      : timezone === 'Asia/Makassar'
        ? 'WITA'
        : timezone === 'Asia/Jayapura'
          ? 'WIT'
          : timezone;

  return `${formatted} ${tzLabel}`;
}

/**
 * Menentukan keterangan perbandingan antara pendapatan dan pengeluaran.
 */
export function getComparisonLabel(totalIncome: number, totalExpense: number): string {
  if (totalIncome > totalExpense) {
    return 'pendapatan lebih besar 📈';
  }
  if (totalExpense > totalIncome) {
    return 'pengeluaran lebih besar 📉';
  }
  return 'pendapatan dan pengeluaran seimbang ⚖️';
}

/**
 * Format inti rekap harian persis mengikuti format yang diminta user.
 */
export function formatRecapCoreBody(summary: DailySummary): string {
  const comparison = getComparisonLabel(summary.totalIncome, summary.totalExpense);
  const sign = summary.netDifference > 0 ? '+' : summary.netDifference < 0 ? '-' : '';

  return [
    `Anda telah menspend uang ${formatRupiah(summary.totalExpense)} dan anda telah mendapat uang ${formatRupiah(summary.totalIncome)} hari ini.`,
    `Selisih uang masuk keluar ${sign}${formatNumberId(summary.absDifference)} rupiah (${comparison})`,
    `-> Jumlah uang sekarang: ${formatRupiah(summary.currentBalance)}`,
    '',
    'Ingat hemat! 💡',
  ].join('\n');
}

/**
 * Pesan lengkap Rekap Harian (untuk cron malam & command /rekap).
 */
export function formatDailyRecapMessage(summary: DailySummary, isToday = true): string {
  const title = isToday
    ? `📊 Rekap Keuangan Hari Ini (${formatReadableDate(summary.dateKey)})`
    : `📊 Rekap Keuangan (${formatReadableDate(summary.dateKey)})`;

  const totalTx = summary.incomeCount + summary.expenseCount;
  const txStats = `📝 Transaksi: ${totalTx}x (${summary.incomeCount} masuk, ${summary.expenseCount} keluar)`;

  return [title, '', formatRecapCoreBody(summary), '', txStats].join('\n');
}

/**
 * Pesan notifikasi real-time saat transaksi SeaBank baru masuk / keluar terdeteksi.
 * Ringkas tanpa ringkasan harian (ringkasan harian dikirim otomatis jam 00:00 atau via /rekap).
 */
export function formatTransactionNotification(
  tx: Transaction,
  timezone = 'Asia/Jakarta'
): string {
  const isIncome = tx.type === 'income';
  const header = isIncome
    ? '💰 Uang Masuk (SeaBank)'
    : '💸 Uang Keluar (SeaBank)';
  const signedAmount = isIncome
    ? `+${formatRupiah(tx.amount)}`
    : `-${formatRupiah(tx.amount)}`;
  const sourceLabel =
    tx.source === 'manual'
      ? 'Manual'
      : tx.source === 'macrodroid'
        ? 'Notif HP (MacroDroid)'
        : 'Email SeaBank';

  const lines = [
    header,
    `Nominal: ${signedAmount}`,
    `Keterangan: ${tx.description}`,
    `Waktu: ${formatTimestamp(tx.occurredAt, timezone)}`,
    `-> Jumlah uang sekarang: ${formatRupiah(tx.balanceAfter)}`,
    `Sumber: ${sourceLabel} (ID #${tx.id})`,
  ];

  if (tx.reference) {
    lines.push(`Ref: ${tx.reference}`);
  }

  return lines.join('\n');
}

/**
 * Pesan rekap bulanan (/bulan).
 */
export function formatMonthlyRecapMessage(summary: MonthlySummary): string {
  const comparison = getComparisonLabel(summary.totalIncome, summary.totalExpense);
  const sign = summary.netDifference > 0 ? '+' : summary.netDifference < 0 ? '-' : '';
  const totalTx = summary.incomeCount + summary.expenseCount;

  return [
    `📅 Rekap Bulanan (${summary.monthKey})`,
    '',
    `Total Uang Masuk: ${formatRupiah(summary.totalIncome)} (${summary.incomeCount}x)`,
    `Total Uang Keluar: ${formatRupiah(summary.totalExpense)} (${summary.expenseCount}x)`,
    `Selisih: ${sign}${formatNumberId(summary.absDifference)} rupiah (${comparison})`,
    `-> Jumlah uang sekarang: ${formatRupiah(summary.currentBalance)}`,
    '',
    `📝 Total transaksi bulan ini: ${totalTx}x`,
    'Ingat hemat! 💡',
  ].join('\n');
}

/**
 * Pesan daftar riwayat transaksi (/riwayat).
 */
export function formatHistoryMessage(transactions: Transaction[], timezone = 'Asia/Jakarta'): string {
  if (transactions.length === 0) {
    return '📭 Belum ada transaksi yang tercatat.';
  }

  const lines = [`🧾 ${transactions.length} Transaksi Terakhir:`, ''];

  for (const tx of transactions) {
    const icon = tx.type === 'income' ? '💰' : '💸';
    const sign = tx.type === 'income' ? '+' : '-';
    const time = formatTimestamp(tx.occurredAt, timezone);
    lines.push(`${icon} #${tx.id} | ${sign}${formatRupiah(tx.amount)}`);
    lines.push(`   ${tx.description}`);
    lines.push(`   ${time} • Saldo: ${formatRupiah(tx.balanceAfter)}`);
  }

  lines.push('', 'Tip: Gunakan /hapus <id> jika ingin menghapus transaksi tertentu.');
  return lines.join('\n');
}
