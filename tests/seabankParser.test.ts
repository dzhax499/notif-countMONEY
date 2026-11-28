import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseRupiahAmount,
  parseSeaBankEmail,
  parseSeaBankPushNotification,
} from '../src/parser/seabankParser.js';

describe('parseRupiahAmount', () => {
  it('parses Indonesian dot-separated formats and decimals', () => {
    assert.equal(parseRupiahAmount('Rp 150.000'), 150000);
    assert.equal(parseRupiahAmount('Rp1.250.500,00'), 1250500);
    assert.equal(parseRupiahAmount('Rp 50.000,-'), 50000);
    assert.equal(parseRupiahAmount('IDR 75,000.00'), 75000);
    assert.equal(parseRupiahAmount('25000'), 25000);
    assert.equal(parseRupiahAmount('Rp 0'), null);
  });
});

describe('parseSeaBankEmail', () => {
  it('parses incoming SeaBank transfer (uang masuk)', () => {
    const result = parseSeaBankEmail({
      messageId: '<msg-in-1@seabank.co.id>',
      from: 'SeaBank <alerts@seabank.co.id>',
      subject: 'Transfer Masuk Berhasil',
      text: [
        'Halo Nasabah SeaBank,',
        'Kamu telah menerima dana sebesar Rp 250.000,00 ke rekening SeaBank kamu.',
        'Pengirim: BUDI SANTOSO',
        'No. Referensi: SB202611230001',
      ].join('\n'),
      date: new Date('2026-11-23T03:00:00Z'),
    });

    assert.equal(result.matched, true);
    assert.equal(result.isSeaBankEmail, true);
    assert.equal(result.transaction?.type, 'income');
    assert.equal(result.transaction?.amount, 250000);
    assert.equal(result.transaction?.counterparty, 'BUDI SANTOSO');
    assert.equal(result.transaction?.reference, 'SB202611230001');
  });

  it('parses QRIS payment (uang keluar) and ignores Biaya Admin Rp 0', () => {
    const result = parseSeaBankEmail({
      messageId: '<msg-qris-1@seabank.co.id>',
      from: 'SeaBank Indonesia <noreply@seabank.co.id>',
      subject: 'Pembayaran QRIS Berhasil',
      text: [
        'Transaksi QRIS kamu berhasil!',
        'Merchant: KOPI KENANGAN SUDIRMAN',
        'Biaya Admin: Rp 0',
        'Total Pembayaran: Rp 32.000',
        'ID Transaksi: QRIS99887766',
      ].join('\n'),
      date: new Date('2026-11-23T05:15:00Z'),
    });

    assert.equal(result.matched, true);
    assert.equal(result.transaction?.type, 'expense');
    assert.equal(result.transaction?.amount, 32000);
    assert.equal(result.transaction?.counterparty, 'KOPI KENANGAN SUDIRMAN');
    assert.equal(result.transaction?.reference, 'QRIS99887766');
  });

  it('parses HTML-only SeaBank outgoing transfer email with explicit ending balance', () => {
    const result = parseSeaBankEmail({
      messageId: '<msg-out-html@seabank.co.id>',
      from: 'alerts@seabank.co.id',
      subject: 'Bukti Transfer SeaBank',
      text: '',
      html: `
        <html><body>
          <h2>Transfer Berhasil</h2>
          <table>
            <tr><td>Penerima</td><td>SITI AMINAH</td></tr>
            <tr><td>Nominal Transaksi</td><td>Rp 120.000</td></tr>
            <tr><td>Biaya Transfer</td><td>Rp 0</td></tr>
            <tr><td>Saldo Akhir</td><td>Rp 1.380.000</td></tr>
            <tr><td>No Referensi</td><td>TRF2026112399</td></tr>
          </table>
        </body></html>
      `,
      date: new Date('2026-11-23T06:00:00Z'),
    });

    assert.equal(result.matched, true);
    assert.equal(result.transaction?.type, 'expense');
    assert.equal(result.transaction?.amount, 120000);
    assert.equal(result.transaction?.counterparty, 'SITI AMINAH');
    assert.equal(result.transaction?.balanceAfter, 1380000);
    assert.equal(result.transaction?.reference, 'TRF2026112399');
  });

  it('parses daily interest credit (bunga harian) as income', () => {
    const result = parseSeaBankEmail({
      messageId: '<msg-interest@seabank.co.id>',
      from: 'SeaBank <alerts@seabank.co.id>',
      subject: 'Pembayaran Bunga Harian',
      text: 'Selamat! Bunga harian sebesar Rp 1.250 telah masuk ke rekening SeaBank kamu.',
      date: new Date('2026-11-23T00:05:00Z'),
    });

    assert.equal(result.matched, true);
    assert.equal(result.transaction?.type, 'income');
    assert.equal(result.transaction?.amount, 1250);
  });

  it('parses e-wallet top up as expense', () => {
    const result = parseSeaBankEmail({
      messageId: '<msg-ewallet@seabank.co.id>',
      from: 'alerts@seabank.co.id',
      subject: 'Top Up GoPay Berhasil',
      text: 'Top Up E-Wallet GoPay berhasil.\nJumlah Transaksi: Rp 50.000',
      date: new Date('2026-11-23T07:00:00Z'),
    });

    assert.equal(result.matched, true);
    assert.equal(result.transaction?.type, 'expense');
    assert.equal(result.transaction?.amount, 50000);
  });

  it('ignores OTP, login alerts, promo, and failed transactions', () => {
    const otp = parseSeaBankEmail({
      messageId: '<msg-otp@seabank.co.id>',
      from: 'noreply@seabank.co.id',
      subject: 'Kode OTP SeaBank Anda',
      text: 'Jangan berikan kode OTP 123456 kepada siapa pun.',
      date: new Date(),
    });
    assert.equal(otp.matched, false);
    assert.equal(otp.isSeaBankEmail, true);

    const failed = parseSeaBankEmail({
      messageId: '<msg-fail@seabank.co.id>',
      from: 'noreply@seabank.co.id',
      subject: 'Transfer Gagal',
      text: 'Transfer sebesar Rp 50.000 gagal diproses.',
      date: new Date(),
    });
    assert.equal(failed.matched, false);
    assert.equal(failed.isSeaBankEmail, true);
  });

  it('ignores emails not from SeaBank', () => {
    const other = parseSeaBankEmail({
      messageId: '<msg-other@example.com>',
      from: 'Newsletter <news@example.com>',
      subject: 'Promo Belanja Akhir Tahun Rp 50.000',
      text: 'Dapatkan diskon Rp 50.000 hari ini.',
      date: new Date(),
    });
    assert.equal(other.matched, false);
    assert.equal(other.isSeaBankEmail, false);
  });

  it('parses short Android push notifications from SeaBank via MacroDroid', () => {
    const qrisNotif = parseSeaBankPushNotification({
      title: 'SeaBank',
      text: 'Pembayaran QRIS sebesar Rp 12.500 di INDOMARET berhasil.',
    });
    assert.equal(qrisNotif.matched, true);
    assert.equal(qrisNotif.transaction?.type, 'expense');
    assert.equal(qrisNotif.transaction?.amount, 12500);
    assert.equal(qrisNotif.transaction?.description, 'Pembayaran QRIS Berhasil (ke INDOMARET)');

    const incomingNotif = parseSeaBankPushNotification({
      title: 'SeaBank',
      text: 'Rekeningmu bertambah Rp 45.000 dari DANA - RINA.',
    });
    assert.equal(incomingNotif.matched, true);
    assert.equal(incomingNotif.transaction?.type, 'income');
    assert.equal(incomingNotif.transaction?.amount, 45000);

    // Format asli push notif SeaBank tanpa tulisan "Rp" + bigText berisi placeholder {not_sub_text} yang belum terganti
    const realQrisNotif = parseSeaBankPushNotification({
      title: 'Pembayaran QRIS berhasil',
      text: 'Pembayaran QRIS untuk QRIS IDM TWUE GEGER KALO sebesar 22.500 telah berhasil.',
      bigText: '{not_sub_text}',
    });
    assert.equal(realQrisNotif.matched, true);
    assert.equal(realQrisNotif.transaction?.type, 'expense');
    assert.equal(realQrisNotif.transaction?.amount, 22500);
    assert.equal(realQrisNotif.transaction?.counterparty, 'QRIS IDM TWUE GEGER KALO');
    assert.equal(
      realQrisNotif.transaction?.description,
      'Pembayaran QRIS berhasil (ke QRIS IDM TWUE GEGER KALO)'
    );
  });

  it('parses non-QRIS SeaBank push notifications (transfer, top-up e-wallet, VA/Shopee, bunga)', () => {
    const incoming = parseSeaBankPushNotification({
      title: 'Transfer Diterima',
      text: 'Kamu menerima 150.000 dari BUDI SANTOSO.',
    });
    assert.equal(incoming.matched, true);
    assert.equal(incoming.transaction?.type, 'income');
    assert.equal(incoming.transaction?.amount, 150000);
    assert.equal(incoming.transaction?.counterparty, 'BUDI SANTOSO');

    const outgoing = parseSeaBankPushNotification({
      title: 'Transfer Berhasil',
      text: 'Transfer ke SITI AMINAH sebesar 75.000 telah berhasil.',
    });
    assert.equal(outgoing.matched, true);
    assert.equal(outgoing.transaction?.type, 'expense');
    assert.equal(outgoing.transaction?.amount, 75000);
    assert.equal(outgoing.transaction?.counterparty, 'SITI AMINAH');

    const topup = parseSeaBankPushNotification({
      title: 'SeaBank',
      text: 'Top up ShopeePay sebesar 50.000 telah berhasil.',
    });
    assert.equal(topup.matched, true);
    assert.equal(topup.transaction?.type, 'expense');
    assert.equal(topup.transaction?.amount, 50000);

    const shopeePay = parseSeaBankPushNotification({
      title: 'Pembayaran Berhasil',
      text: 'Pembayaran untuk Shopee sebesar 42.500 telah berhasil.',
    });
    assert.equal(shopeePay.matched, true);
    assert.equal(shopeePay.transaction?.type, 'expense');
    assert.equal(shopeePay.transaction?.amount, 42500);

    const interest = parseSeaBankPushNotification({
      title: 'Bunga Harian Masuk',
      text: 'Bunga tabungan sebesar Rp 2.345 telah masuk ke rekeningmu.',
    });
    assert.equal(interest.matched, true);
    assert.equal(interest.transaction?.type, 'income');
    assert.equal(interest.transaction?.amount, 2345);

    const promoNotif = parseSeaBankPushNotification({
      title: 'Promo Cashback Voucher SeaBank!',
      text: 'Dapatkan diskon hingga Rp 50.000 untuk transaksi pertamamu.',
    });
    assert.equal(promoNotif.matched, false);
  });
});
