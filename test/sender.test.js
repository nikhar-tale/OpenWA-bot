const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test-sender-db.sqlite');
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../src/db');
const waClient = require('../src/wa-client');

let getSessionStatusMock = async () => {
  return { status: 'CONNECTED', phone: '1234', pushName: 'Test' };
};

let sendTextMessageMock = async (phone, text) => {
  return { success: true, messageId: 'msg-' + phone };
};

// Mock waClient functions
test.mock.method(waClient, 'getSessionStatus', async () => {
  return getSessionStatusMock();
});

test.mock.method(waClient, 'sendTextMessage', async (phone, text) => {
  return sendTextMessageMock(phone, text);
});

// Require sender after mock is set up
const sender = require('../src/sender');

test('Bulk Sender Queue Tests', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
  }

  t.after(async () => {
    await db._close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  await t.test('Sequentially process sending queue', async () => {
    const batch = {
      id: 'batch_sender_1',
      templateId: 'tpl_test_campaign',
      status: 'PENDING',
      totalLeads: 2,
      sentCount: 0,
      failedCount: 0,
      leads: [
        { name: 'Nikhar', phone: '918000000000', status: 'PENDING' },
        { name: 'Anshu', phone: '917000000000', status: 'PENDING' }
      ]
    };

    await db.saveBatch(batch);

    // Start send with 0 seconds delay for fast test execution
    await sender.startBulkSend('batch_sender_1', 'Hello {{name}}', 0);

    // Wait a bit for the async processQueue loop to finish
    await new Promise(resolve => setTimeout(resolve, 80));

    const finalBatch = await db.getBatch('batch_sender_1');
    assert.strictEqual(finalBatch.status, 'COMPLETED');
    assert.strictEqual(finalBatch.sentCount, 2);
    assert.strictEqual(finalBatch.leads[0].status, 'SENT');
    assert.strictEqual(finalBatch.leads[1].status, 'SENT');
    assert.strictEqual(finalBatch.leads[0].sentMessage, 'Hello Nikhar');
    assert.strictEqual(finalBatch.leads[1].sentMessage, 'Hello Anshu');
  });

  await t.test('Cancel campaign mid-dispatch', async () => {
    const batch = {
      id: 'batch_sender_2',
      templateId: 'tpl_test_campaign',
      status: 'PENDING',
      totalLeads: 3,
      sentCount: 0,
      failedCount: 0,
      leads: [
        { name: 'Lead 1', phone: '111', status: 'PENDING' },
        { name: 'Lead 2', phone: '222', status: 'PENDING' },
        { name: 'Lead 3', phone: '333', status: 'PENDING' }
      ]
    };

    await db.saveBatch(batch);

    // We can intercept the sendTextMessage mock to cancel the batch when it gets called
    let callCount = 0;
    sendTextMessageMock = async (phone, text) => {
      callCount++;
      if (callCount === 1) {
        // Cancel active batch immediately after the first message
        sender.cancelActiveBatch();
      }
      return { success: true, messageId: 'msg-' + phone };
    };

    // Start send with a tiny delay (0.01 seconds) to allow the cancellation to be processed
    await sender.startBulkSend('batch_sender_2', 'Hey {{name}}', 0.01);

    // Wait for worker loop
    await new Promise(resolve => setTimeout(resolve, 80));

    const finalBatch = await db.getBatch('batch_sender_2');
    assert.strictEqual(finalBatch.status, 'CANCELLED');
    assert.strictEqual(finalBatch.sentCount, 1);
    assert.strictEqual(finalBatch.leads[0].status, 'SENT');
    assert.strictEqual(finalBatch.leads[1].status, 'PENDING');
    assert.strictEqual(finalBatch.leads[2].status, 'PENDING');
  });
});
