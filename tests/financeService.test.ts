import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FinanceDatabase } from '../src/db/database.js';
import { FinanceService } from '../src/services/financeService.js';

describe('FinanceService with SQLite', () => {
  it('tracks balance, daily summary, deduplication, and deletion rollback accurately', () => {
    const db = new FinanceDatabase(':memory:');
    const service = new FinanceService(db, 'Asia/Jakarta');

    service.setCurrentBalance(1_000_000);
    assert.equal(service.getCurrentBalance(), 1_000_000);

    const fixedDate = new Date('2026-11-23T05:00:00Z'); // 12:00 WIB

    const inc = service.recordTransaction({
      type: 'income',
      amount: 200_000,
      description: 'Transfer Masuk dari Budi',
      source: 'seabank_email',
      externalId: '<email-1@seabank.co.id>',
      reference: 'REF-001',
      occurredAt: fixedDate,
    });

    assert.equal(inc.duplicated, false);
    assert.equal(inc.transaction.balanceAfter, 1_200_000);
    assert.equal(service.getCurrentBalance(), 1_200_000);

    // Uji anti-duplikat berdasarkan externalId
    const dupByExternal = service.recordTransaction({
      type: 'income',
      amount: 200_000,
      description: 'Transfer Masuk dari Budi',
      source: 'seabank_email',
      externalId: '<email-1@seabank.co.id>',
      occurredAt: fixedDate,
    });
    assert.equal(dupByExternal.duplicated, true);
    assert.equal(service.getCurrentBalance(), 1_200_000);

    // Uji anti-duplikat berdasarkan nomor referensi
    const dupByRef = service.recordTransaction({
      type: 'income',
      amount: 200_000,
      description: 'Forward Transfer Masuk',
      source: 'seabank_email',
      externalId: '<email-1-fwd@gmail.com>',
      reference: 'REF-001',
      occurredAt: fixedDate,
    });
    assert.equal(dupByRef.duplicated, true);

    const exp = service.recordTransaction({
      type: 'expense',
      amount: 75_000,
      description: 'Pembayaran QRIS Makan Siang',
      source: 'seabank_email',
      externalId: '<email-2@seabank.co.id>',
      occurredAt: fixedDate,
    });

    assert.equal(exp.duplicated, false);
    assert.equal(exp.transaction.balanceAfter, 1_125_000);

    const daily = service.getDailySummary('2026-11-23');
    assert.equal(daily.totalIncome, 200_000);
    assert.equal(daily.totalExpense, 75_000);
    assert.equal(daily.netDifference, 125_000);
    assert.equal(daily.absDifference, 125_000);
    assert.equal(daily.incomeCount, 1);
    assert.equal(daily.expenseCount, 1);
    assert.equal(daily.currentBalance, 1_125_000);

    // Hapus pengeluaran Rp 75.000 -> saldo harus kembali ke Rp 1.200.000
    const deleted = service.deleteTransaction(exp.transaction.id);
    assert.ok(deleted);
    assert.equal(deleted.newBalance, 1_200_000);
    assert.equal(service.getCurrentBalance(), 1_200_000);

    const monthly = service.getMonthlySummary('2026-11');
    assert.equal(monthly.totalIncome, 200_000);
    assert.equal(monthly.totalExpense, 0);

    db.close();
  });

  it('picks yesterday dateKey when scheduled recap runs at 00:00 WIB', () => {
    const db = new FinanceDatabase(':memory:');
    const service = new FinanceService(db, 'Asia/Jakarta');

    // 2026-11-24 00:00 WIB == 2026-11-23 17:00 UTC -> harus merekap 2026-11-23
    const midnightWib = new Date('2026-11-23T17:00:00Z');
    assert.deepEqual(service.getScheduledRecapDateKey(midnightWib), {
      dateKey: '2026-11-23',
      isToday: false,
    });

    // 2026-11-23 21:00 WIB == 2026-11-23 14:00 UTC -> merekap 2026-11-23
    const eveningWib = new Date('2026-11-23T14:00:00Z');
    assert.deepEqual(service.getScheduledRecapDateKey(eveningWib), {
      dateKey: '2026-11-23',
      isToday: true,
    });

    db.close();
  });
});
