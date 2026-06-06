const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, 'test-db.sqlite');
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../src/db');

test('SQLite DB Helper Tests', async (t) => {
  // Clean up if file exists
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch (e) {}
  }

  t.after(async () => {
    // Close sqlite connection first to release file lock on Windows
    await db._close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (e) {}
    }
  });

  await t.test('Save and retrieve templates', async () => {
    const template = {
      id: 'tpl_test',
      name: 'Test Template',
      content: 'Hello {{name}}',
      messageType: 'image',
      mediaPath: 'C:\\data\\test.png',
      mediaMimetype: 'image/png',
      mediaFilename: 'test.png'
    };

    await db.saveTemplate(template);
    const templates = await db.getTemplates();
    const retrieved = templates.find(t => t.id === 'tpl_test');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, 'Test Template');
    assert.strictEqual(retrieved.content, 'Hello {{name}}');
    assert.strictEqual(retrieved.messageType, 'image');
    assert.strictEqual(retrieved.mediaPath, 'C:\\data\\test.png');
    assert.strictEqual(retrieved.mediaMimetype, 'image/png');
    assert.strictEqual(retrieved.mediaFilename, 'test.png');
  });

  await t.test('Delete template', async () => {
    await db.deleteTemplate('tpl_test');
    const templates = await db.getTemplates();
    const retrieved = templates.find(t => t.id === 'tpl_test');
    assert.strictEqual(retrieved, undefined);
  });

  await t.test('Save and retrieve batches', async () => {
    const batch = {
      id: 'batch_test',
      templateId: 'tpl_default',
      status: 'PENDING',
      totalLeads: 1,
      sentCount: 0,
      failedCount: 0,
      leads: [{ name: 'Test', phone: '123' }]
    };

    await db.saveBatch(batch);
    const retrieved = await db.getBatch('batch_test');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.status, 'PENDING');
    assert.strictEqual(retrieved.leads[0].name, 'Test');
  });

  await t.test('Save and retrieve templates with multiple media files', async () => {
    const template = {
      id: 'tpl_test_multi',
      name: 'Multi Media Template',
      content: 'Hello {{name}}',
      messageType: 'image',
      mediaFiles: [
        { path: 'C:\\data\\img1.png', mimetype: 'image/png', filename: 'img1.png', size: 100 },
        { path: 'C:\\data\\img2.png', mimetype: 'image/png', filename: 'img2.png', size: 200 }
      ]
    };

    await db.saveTemplate(template);
    const templates = await db.getTemplates();
    const retrieved = templates.find(t => t.id === 'tpl_test_multi');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, 'Multi Media Template');
    assert.strictEqual(retrieved.mediaFiles.length, 2);
    assert.strictEqual(retrieved.mediaFiles[0].path, 'C:\\data\\img1.png');
    assert.strictEqual(retrieved.mediaFiles[1].path, 'C:\\data\\img2.png');
  });

  await t.test('Save and retrieve batches with multiple media files', async () => {
    const batch = {
      id: 'batch_test_multi',
      templateId: 'tpl_default',
      status: 'PENDING',
      totalLeads: 1,
      sentCount: 0,
      failedCount: 0,
      leads: [{ name: 'Test', phone: '123' }],
      messageType: 'image',
      mediaFiles: [
        { path: 'C:\\data\\img1.png', mimetype: 'image/png', filename: 'img1.png' }
      ]
    };

    await db.saveBatch(batch);
    const retrieved = await db.getBatch('batch_test_multi');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.mediaFiles.length, 1);
    assert.strictEqual(retrieved.mediaFiles[0].filename, 'img1.png');
  });

  await t.test('Save and retrieve settings', async () => {
    await db.saveSetting('test_key', 'test_val');
    const settings = await db.getSettings();
    assert.strictEqual(settings.test_key, 'test_val');
  });
});
