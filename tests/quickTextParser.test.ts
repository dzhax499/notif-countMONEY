import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseFlexibleRupiah,
  parseQuickTextLine,
  parseQuickTextMessage,
} from '../src/parser/quickTextParser.js';

describe('parseFlexibleRupiah', () => {
  it('parses shorthand k, rb, ribu, jt, juta and standard Rupiah formats', () => {
    assert.equal(parseFlexibleRupiah('25k'), 25000);
    assert.equal(parseFlexibleRupiah('25.5k'), 25500);
    assert.equal(parseFlexibleRupiah('25,5K'), 25500);
    assert.equal(parseFlexibleRupiah('15rb'), 15000);
    assert.equal(parseFlexibleRupiah('15ribu'), 15000);
    assert.equal(parseFlexibleRupiah('1.5jt'), 1500000);
    assert.equal(parseFlexibleRupiah('2,25juta'), 2250000);
    assert.equal(parseFlexibleRupiah('Rp 35.000'), 35000);
    assert.equal(parseFlexibleRupiah('150000'), 150000);
    assert.equal(parseFlexibleRupiah('0k'), null);
    assert.equal(parseFlexibleRupiah('abc'), null);
  });
});

describe('parseQuickTextLine', () => {
  it('parses signed expense and income formats', () => {
    assert.deepEqual(parseQuickTextLine('-25k kopi kenangan'), {
      type: 'expense',
      amount: 25000,
      description: 'kopi kenangan',
    });

    assert.deepEqual(parseQuickTextLine('+500k gaji freelance'), {
      type: 'income',
      amount: 500000,
      description: 'gaji freelance',
    });

    assert.deepEqual(parseQuickTextLine('- Rp 35.000 makan siang'), {
      type: 'expense',
      amount: 35000,
      description: 'makan siang',
    });

    assert.deepEqual(parseQuickTextLine('+1.5jt'), {
      type: 'income',
      amount: 1500000,
      description: 'Pemasukan Cepat',
    });
  });

  it('parses natural Indonesian keyword formats', () => {
    assert.deepEqual(parseQuickTextLine('keluar 15rb parkir'), {
      type: 'expense',
      amount: 15000,
      description: 'parkir',
    });

    assert.deepEqual(parseQuickTextLine('beli 30k nasi padang'), {
      type: 'expense',
      amount: 30000,
      description: 'beli nasi padang',
    });

    assert.deepEqual(parseQuickTextLine('masuk 200k transfer budi'), {
      type: 'income',
      amount: 200000,
      description: 'transfer budi',
    });

    assert.deepEqual(parseQuickTextLine('gaji 3.5jt'), {
      type: 'income',
      amount: 3500000,
      description: 'gaji',
    });
  });

  it('returns null for commands or unrelated text', () => {
    assert.equal(parseQuickTextLine('/keluar 25k kopi'), null);
    assert.equal(parseQuickTextLine('halo bot apa kabar'), null);
  });
});

describe('parseQuickTextMessage', () => {
  it('parses multi-line batch transactions and separates invalid lines', () => {
    const res = parseQuickTextMessage(`
      -15k parkir
      -35.000 makan siang
      +200k transfer budi
      catatan ngawur
    `);

    assert.equal(res.drafts.length, 3);
    assert.equal(res.drafts[0].amount, 15000);
    assert.equal(res.drafts[1].amount, 35000);
    assert.equal(res.drafts[2].type, 'income');
    assert.equal(res.drafts[2].amount, 200000);
    assert.deepEqual(res.invalidLines, ['catatan ngawur']);
  });
});
