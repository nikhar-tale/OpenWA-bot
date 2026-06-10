const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

const TEST_DB_PATH = path.join(__dirname, 'test-import-db.sqlite');
process.env.DB_PATH = TEST_DB_PATH;
process.env.PORT = '45679'; // Use a distinct port for import tests

// Mock/intercept express to get the server instance so we can close it
const express = require('express');
const originalListen = express.application.listen;
let serverInstance;
express.application.listen = function(...args) {
  serverInstance = originalListen.apply(this, args);
  return serverInstance;
};

// Require the server (this starts it on port 45679)
require('../src/index');

const db = require('../src/db');

test('Template Bulk Import API Tests', async (t) => {
  // Clean up DB before test
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
  }

  t.after(async () => {
    // Close server
    if (serverInstance) {
      await new Promise(resolve => serverInstance.close(resolve));
    }
    // Close DB connection
    await db._close();
    // Clean up DB file
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  const api = axios.create({
    baseURL: 'http://localhost:45679/api',
    validateStatus: () => true // Don't throw on non-2xx statuses
  });

  await t.test('Import templates successfully', async () => {
    const data = [
      { 'template_name': 'Welcome Template', 'message': 'Hello {{name}}, welcome to our system!' },
      { 'template_name': 'Promo Template', 'message': 'Hi {{name}}, here is a 10% off code.' }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Templates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const formData = new FormData();
    formData.append('file', new Blob([buffer]), 'templates.xlsx');

    const res = await api.post('/templates/import', formData);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.total, 2);
    assert.strictEqual(res.data.imported, 2);
    assert.strictEqual(res.data.skipped, 0);
    assert.strictEqual(res.data.failed, 0);

    // Verify they are saved in DB
    const templates = await db.getTemplates();
    const welcome = templates.find(t => t.name === 'Welcome Template');
    const promo = templates.find(t => t.name === 'Promo Template');
    assert.ok(welcome);
    assert.strictEqual(welcome.content, 'Hello {{name}}, welcome to our system!');
    assert.ok(promo);
    assert.strictEqual(promo.content, 'Hi {{name}}, here is a 10% off code.');
  });

  await t.test('Skip duplicates and invalid templates', async () => {
    // Welcome Template already exists from the first test
    const data = [
      { 'template_name': 'Welcome Template', 'message': 'Hello {{name}}, this is a duplicate' },
      { 'template_name': 'No Placeholder Template', 'message': 'Hello, there is no name placeholder here.' },
      { 'template_name': '', 'message': 'Empty name template' },
      { 'template_name': 'Unique Temp', 'message': '' },
      { 'template_name': 'Sheet Duplicate', 'message': 'Hi {{name}}' },
      { 'template_name': 'Sheet Duplicate', 'message': 'Hi {{name}} duplicate' }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Templates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const formData = new FormData();
    formData.append('file', new Blob([buffer]), 'templates.xlsx');

    const res = await api.post('/templates/import', formData);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.total, 6);
    assert.strictEqual(res.data.imported, 1); // Only the first 'Sheet Duplicate' should be imported
    assert.strictEqual(res.data.skipped, 5);
    assert.strictEqual(res.data.failed, 0);

    // Check reasons
    assert.ok(res.data.reasons.some(r => r.includes('already exists in database')));
    assert.ok(res.data.reasons.some(r => r.includes('does not contain the required {{name}} placeholder')));
    assert.ok(res.data.reasons.some(r => r.includes('must be non-empty')));
    assert.ok(res.data.reasons.some(r => r.includes('Duplicate template name "Sheet Duplicate" found')));
  });

  await t.test('Error on missing file', async () => {
    const res = await api.post('/templates/import');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.error, 'No file uploaded.');
  });

  await t.test('Error on invalid headers', async () => {
    const data = [
      { 'wrong_name': 'Welcome Template', 'wrong_message': 'Hello {{name}}' }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Templates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const formData = new FormData();
    formData.append('file', new Blob([buffer]), 'templates.xlsx');

    const res = await api.post('/templates/import', formData);
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes('Invalid spreadsheet headers'));
  });
});
