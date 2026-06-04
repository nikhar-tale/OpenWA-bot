const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, 'test-db.json');
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../src/db');

test('JSON DB Helper Tests', async (t) => {
  // Clean up if file exists
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch (e) {}
  }

  t.after(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (e) {}
    }
  });

  await t.test('Save and retrieve templates', () => {
    const template = {
      id: 'tpl_test',
      name: 'Test Template',
      content: 'Hello {{name}}'
    };

    db.saveTemplate(template);
    const templates = db.getTemplates();
    const retrieved = templates.find(t => t.id === 'tpl_test');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, 'Test Template');
    assert.strictEqual(retrieved.content, 'Hello {{name}}');
  });

  await t.test('Delete template', () => {
    db.deleteTemplate('tpl_test');
    const templates = db.getTemplates();
    const retrieved = templates.find(t => t.id === 'tpl_test');
    assert.strictEqual(retrieved, undefined);
  });

  await t.test('Save and retrieve batches', () => {
    const batch = {
      id: 'batch_test',
      status: 'PENDING',
      totalLeads: 1,
      sentCount: 0,
      failedCount: 0,
      leads: [{ name: 'Test', phone: '123' }]
    };

    db.saveBatch(batch);
    const retrieved = db.getBatch('batch_test');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.status, 'PENDING');
    assert.strictEqual(retrieved.leads[0].name, 'Test');
  });
});
