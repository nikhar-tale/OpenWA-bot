const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { parseLeadsBuffer } = require('../src/excel-parser');

test('Excel Parser Tests', async (t) => {
  await t.test('Parse standard sheet successfully', () => {
    const data = [
      { 'Name': 'Anshu Purviya', 'Phone': '917000391986' },
      { 'Name': 'Nikhar Tale', 'Phone': '918000000000' }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const leads = parseLeadsBuffer(buffer);
    assert.strictEqual(leads.length, 2);
    assert.strictEqual(leads[0].name, 'Anshu Purviya');
    assert.strictEqual(leads[0].phone, '917000391986');
    assert.strictEqual(leads[0].status, 'PENDING');
    assert.strictEqual(leads[1].name, 'Nikhar Tale');
    assert.strictEqual(leads[1].phone, '918000000000');
  });

  await t.test('Normalize varied header names', () => {
    const data = [
      { 'customer name': 'John Doe', 'Mobile Number': '1234567890' },
      { 'lead_name': 'Jane Doe', 'phone-number': '0987654321' }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const leads = parseLeadsBuffer(buffer);
    assert.strictEqual(leads.length, 2);
    assert.strictEqual(leads[0].name, 'John Doe');
    assert.strictEqual(leads[0].phone, '1234567890');
    assert.strictEqual(leads[1].name, 'Jane Doe');
    assert.strictEqual(leads[1].phone, '0987654321');
  });
});
