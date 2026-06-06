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

let sendMediaMessageMock = async (phone, type, base64, mimetype, filename, caption) => {
  return { success: true, messageId: 'media-msg-' + phone };
};

// Mock waClient functions
test.mock.method(waClient, 'getSessionStatus', async () => {
  return getSessionStatusMock();
});

test.mock.method(waClient, 'sendTextMessage', async (phone, text) => {
  return sendTextMessageMock(phone, text);
});

test.mock.method(waClient, 'sendMediaMessage', async (phone, type, base64, mimetype, filename, caption) => {
  return sendMediaMessageMock(phone, type, base64, mimetype, filename, caption);
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

  await t.test('Sequentially process media sending queue', async () => {
    // Create dummy media file
    const mediaFilePath = path.join(__dirname, 'dummy-test-image.png');
    fs.writeFileSync(mediaFilePath, 'fake image data');

    const batch = {
      id: 'batch_media_sender_1',
      templateId: 'tpl_test_campaign',
      status: 'PENDING',
      totalLeads: 2,
      sentCount: 0,
      failedCount: 0,
      leads: [
        { name: 'Nikhar', phone: '918000000000', status: 'PENDING' },
        { name: 'Anshu', phone: '917000000000', status: 'PENDING' }
      ],
      messageType: 'image',
      mediaPath: mediaFilePath,
      mediaMimetype: 'image/png',
      mediaFilename: 'dummy-test-image.png'
    };

    await db.saveBatch(batch);

    // Track calls to sendMediaMessage
    let mediaCalls = [];
    sendMediaMessageMock = async (phone, type, base64, mimetype, filename, caption) => {
      mediaCalls.push({ phone, type, base64, mimetype, filename, caption });
      return { success: true, messageId: 'media-msg-' + phone };
    };

    await sender.startBulkSend('batch_media_sender_1', 'Hello {{name}}', 0);

    // Wait a bit for the async processQueue loop to finish
    await new Promise(resolve => setTimeout(resolve, 80));

    // Clean up file
    if (fs.existsSync(mediaFilePath)) {
      fs.unlinkSync(mediaFilePath);
    }

    const finalBatch = await db.getBatch('batch_media_sender_1');
    assert.strictEqual(finalBatch.status, 'COMPLETED');
    assert.strictEqual(finalBatch.sentCount, 2);
    assert.strictEqual(finalBatch.leads[0].status, 'SENT');
    assert.strictEqual(finalBatch.leads[1].status, 'SENT');
    assert.strictEqual(mediaCalls.length, 2);
    assert.strictEqual(mediaCalls[0].phone, '918000000000');
    assert.strictEqual(mediaCalls[0].type, 'image');
    assert.strictEqual(mediaCalls[0].filename, 'dummy-test-image.png');
    assert.strictEqual(mediaCalls[0].caption, 'Hello Nikhar');
    assert.strictEqual(mediaCalls[0].base64, Buffer.from('fake image data').toString('base64'));
  });

  await t.test('Sequentially process multiple media sending queue', async () => {
    // Create dummy media files
    const mediaFilePath1 = path.join(__dirname, 'dummy-test-image1.png');
    const mediaFilePath2 = path.join(__dirname, 'dummy-test-image2.png');
    fs.writeFileSync(mediaFilePath1, 'fake image data 1');
    fs.writeFileSync(mediaFilePath2, 'fake image data 2');

    const batch = {
      id: 'batch_multi_media_sender_1',
      templateId: 'tpl_test_campaign',
      status: 'PENDING',
      totalLeads: 1,
      sentCount: 0,
      failedCount: 0,
      leads: [
        { name: 'Nikhar', phone: '918000000000', status: 'PENDING' }
      ],
      messageType: 'image',
      mediaFiles: [
        { path: mediaFilePath1, mimetype: 'image/png', filename: 'dummy-test-image1.png' },
        { path: mediaFilePath2, mimetype: 'image/png', filename: 'dummy-test-image2.png' }
      ]
    };

    await db.saveBatch(batch);

    // Track calls to sendMediaMessage
    let mediaCalls = [];
    sendMediaMessageMock = async (phone, type, base64, mimetype, filename, caption) => {
      mediaCalls.push({ phone, type, base64, mimetype, filename, caption });
      return { success: true, messageId: 'media-msg-' + filename };
    };

    await sender.startBulkSend('batch_multi_media_sender_1', 'Hello {{name}}', 0);

    // Wait a bit for the async processQueue loop to finish
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Clean up files
    if (fs.existsSync(mediaFilePath1)) fs.unlinkSync(mediaFilePath1);
    if (fs.existsSync(mediaFilePath2)) fs.unlinkSync(mediaFilePath2);

    const finalBatch = await db.getBatch('batch_multi_media_sender_1');
    assert.strictEqual(finalBatch.status, 'COMPLETED');
    assert.strictEqual(finalBatch.sentCount, 1);
    assert.strictEqual(finalBatch.leads[0].status, 'SENT');
    assert.strictEqual(mediaCalls.length, 2);
    
    // First file assertions
    assert.strictEqual(mediaCalls[0].phone, '918000000000');
    assert.strictEqual(mediaCalls[0].filename, 'dummy-test-image1.png');
    assert.strictEqual(mediaCalls[0].caption, 'Hello Nikhar');
    assert.strictEqual(mediaCalls[0].base64, Buffer.from('fake image data 1').toString('base64'));
    
    // Second file assertions
    assert.strictEqual(mediaCalls[1].phone, '918000000000');
    assert.strictEqual(mediaCalls[1].filename, 'dummy-test-image2.png');
    assert.strictEqual(mediaCalls[1].caption, ''); // Should be empty for subsequent files
    assert.strictEqual(mediaCalls[1].base64, Buffer.from('fake image data 2').toString('base64'));
  });
});
