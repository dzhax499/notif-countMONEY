import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { FinanceDatabase } from '../src/db/database.js';
import { FinanceService } from '../src/services/financeService.js';
import {
  extractMacroDroidPayload,
  MacroDroidWebhookTracker,
  processMacroDroidWebhook,
} from '../src/services/webhookHandler.js';

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

  it('supports ON/OFF source toggles, MacroDroid webhook, and cross-source anti-duplication', async () => {
    const db = new FinanceDatabase(':memory:');
    const service = new FinanceService(db, 'Asia/Jakarta');
    service.setCurrentBalance(500_000);

    // Default: kedua sumber (Gmail & MacroDroid) ON
    assert.deepEqual(service.getSourceSettings(), {
      gmailEnabled: true,
      macrodroidEnabled: true,
    });

    // 1. MacroDroid mengirim transaksi QRIS Rp 15.000 (< 100rb)
    const res1 = await processMacroDroidWebhook({
      payload: {
        title: 'SeaBank',
        text: 'Pembayaran QRIS sebesar Rp 15.000 ke WARUNG NASI berhasil.',
      },
      config: { webhookSecret: null, notifyUnparsedEmail: false },
      financeService: service,
    });

    assert.equal(res1.httpStatus, 200);
    assert.equal(res1.body.ok, true);
    assert.equal(res1.body.recorded, true);
    assert.equal(service.getCurrentBalance(), 485_000);

    // 2. Transaksi Rp 150.000 masuk via MacroDroid dulu, lalu 10 detik kemudian masuk via Email Gmail
    const macroBig = await processMacroDroidWebhook({
      payload: {
        title: 'Transfer Masuk',
        text: 'Kamu menerima transfer sebesar Rp 150.000 dari ANDI.',
      },
      config: { webhookSecret: null, notifyUnparsedEmail: false },
      financeService: service,
    });
    assert.equal(macroBig.body.recorded, true);
    assert.equal(service.getCurrentBalance(), 635_000);

    // Saat Gmail mencoba mencatat transaksi income Rp 150.000 yang sama dalam < 5 menit, otomatis terdeteksi duplikat!
    const gmailDup = service.recordTransaction({
      type: 'income',
      amount: 150_000,
      description: 'Transfer Masuk Berhasil (dari ANDI)',
      source: 'seabank_email',
      externalId: '<gmail-msg-150k@seabank.co.id>',
    });
    assert.equal(gmailDup.duplicated, true);
    assert.equal(service.getCurrentBalance(), 635_000);

    // 3. Jika MacroDroid di-OFF-kan lewat tombol /sumber, webhook akan skip dan tidak mencatat
    service.setMacrodroidEnabled(false);
    const skippedRes = await processMacroDroidWebhook({
      payload: {
        title: 'SeaBank',
        text: 'Pembayaran QRIS sebesar Rp 20.000 ke KOPI berhasil.',
      },
      config: { webhookSecret: null, notifyUnparsedEmail: false },
      financeService: service,
    });
    assert.equal(skippedRes.httpStatus, 200);
    assert.equal(skippedRes.body.skipped, true);
    assert.equal(service.getCurrentBalance(), 635_000);

    db.close();
  });

  it('parses multiline raw JSON from MacroDroid and tracks recent webhook logs', async () => {
    const rawBrokenJson =
      '{\n  "title": "Transfer Berhasil",\n  "text": "Transfer ke BUDI\nsebesar 30.000 telah berhasil.",\n  "bigText": "[not_sub_text]"\n}';
    const fakeReq = Readable.from([Buffer.from(rawBrokenJson, 'utf-8')]) as unknown as IncomingMessage;
    fakeReq.headers = { 'content-type': 'application/json' };

    const { payload } = await extractMacroDroidPayload(
      fakeReq,
      new URL('http://localhost:3000/webhook/macrodroid')
    );

    assert.equal(payload.title, 'Transfer Berhasil');
    assert.equal(payload.text, 'Transfer ke BUDI\nsebesar 30.000 telah berhasil.');

    // Kasus kutip ganda tak ter-escape di dalam teks notifikasi
    const rawQuotedJson =
      '{"title":"Pembayaran Berhasil","text":"Bayar di "KOPI KENANGAN" sebesar 25.000"}';
    const fakeReq2 = Readable.from([Buffer.from(rawQuotedJson, 'utf-8')]) as unknown as IncomingMessage;
    fakeReq2.headers = { 'content-type': 'application/json' };
    const { payload: payload2 } = await extractMacroDroidPayload(
      fakeReq2,
      new URL('http://localhost:3000/webhook/macrodroid')
    );
    assert.equal(payload2.title, 'Pembayaran Berhasil');
    assert.equal(payload2.text, 'Bayar di "KOPI KENANGAN" sebesar 25.000');

    const tracker = new MacroDroidWebhookTracker(2);
    tracker.record({
      receivedAt: new Date('2026-11-28T01:00:00Z'),
      httpStatus: 200,
      outcome: 'recorded',
      title: 'Transfer Berhasil',
      snippet: 'Transfer ke BUDI sebesar 30.000',
      transactionId: 1,
    });
    tracker.record({
      receivedAt: new Date('2026-11-28T01:05:00Z'),
      httpStatus: 422,
      outcome: 'unparsed',
      title: 'SeaBank',
      snippet: 'Format baru',
      reason: 'Tidak dikenal',
    });
    tracker.record({
      receivedAt: new Date('2026-11-28T01:10:00Z'),
      httpStatus: 200,
      outcome: 'duplicated',
      title: 'SeaBank',
      snippet: 'Duplikat',
    });

    assert.equal(tracker.getRecent(10).length, 2);
    assert.equal(tracker.getLatest()?.outcome, 'duplicated');
  });
});
