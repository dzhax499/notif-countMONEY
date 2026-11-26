import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findBalanceSpoilerEntities,
  formatDailyRecapMessage,
  formatRecapCoreBody,
  formatTransactionNotification,
} from '../src/services/formatter.js';

describe('formatter', () => {
  it('formats daily recap when income is greater than expense', () => {
    const text = formatRecapCoreBody({
      dateKey: '2026-11-23',
      totalIncome: 150_000,
      totalExpense: 85_000,
      netDifference: 65_000,
      absDifference: 65_000,
      incomeCount: 1,
      expenseCount: 2,
      currentBalance: 1_565_000,
    });

    assert.match(text, /Anda telah menspend uang Rp 85\.000 dan anda telah mendapat uang Rp 150\.000 hari ini\./);
    assert.match(text, /Selisih uang masuk keluar \+65\.000 rupiah \(pendapatan lebih besar 📈\)/);
    assert.match(text, /-> Jumlah uang sekarang: Rp 1\.565\.000/);
    assert.match(text, /Ingat hemat!/);
  });

  it('formats daily recap when expense is greater than income', () => {
    const text = formatDailyRecapMessage({
      dateKey: '2026-11-23',
      totalIncome: 20_000,
      totalExpense: 120_000,
      netDifference: -100_000,
      absDifference: 100_000,
      incomeCount: 1,
      expenseCount: 3,
      currentBalance: 900_000,
    });

    assert.match(text, /Selisih uang masuk keluar -100\.000 rupiah \(pengeluaran lebih besar 📉\)/);
    assert.match(text, /-> Jumlah uang sekarang: Rp 900\.000/);
    assert.match(text, /Transaksi: 4x \(1 masuk, 3 keluar\)/);
  });

  it('formats daily recap when income equals expense', () => {
    const text = formatRecapCoreBody({
      dateKey: '2026-11-23',
      totalIncome: 50_000,
      totalExpense: 50_000,
      netDifference: 0,
      absDifference: 0,
      incomeCount: 1,
      expenseCount: 1,
      currentBalance: 500_000,
    });

    assert.match(text, /Selisih uang masuk keluar 0 rupiah \(pendapatan dan pengeluaran seimbang ⚖️\)/);
  });

  it('formats transaction notification cleanly without daily recap section', () => {
    const text = formatTransactionNotification({
      id: 4,
      type: 'expense',
      amount: 35_000,
      description: 'Pembayaran QRIS (ke KOPI KENANGAN)',
      counterparty: 'KOPI KENANGAN',
      reference: 'QRIS123',
      source: 'seabank_email',
      externalId: '<msg-4>',
      balanceAfter: 1_565_000,
      occurredAt: '2026-11-23T07:20:00.000Z',
      dateKey: '2026-11-23',
      createdAt: '2026-11-23T07:20:00.000Z',
    });

    assert.match(text, /💸 Uang Keluar \(SeaBank\)/);
    assert.match(text, /Nominal: -Rp 35\.000/);
    assert.match(text, /-> Jumlah uang sekarang: Rp 1\.565\.000/);
    assert.doesNotMatch(text, /Ringkasan Hari Ini/);
    assert.doesNotMatch(text, /Ingat hemat!/);

    const spoilerEntities = findBalanceSpoilerEntities(text);
    assert.equal(spoilerEntities.length, 1);
    assert.equal(spoilerEntities[0].type, 'spoiler');
    assert.equal(
      text.slice(
        spoilerEntities[0].offset,
        spoilerEntities[0].offset + spoilerEntities[0].length
      ),
      'Rp 1.565.000'
    );
  });
});
