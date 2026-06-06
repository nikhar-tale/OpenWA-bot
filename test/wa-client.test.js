const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test-client-db.sqlite');
process.env.DB_PATH = TEST_DB_PATH;

// Mock axios.create before requiring wa-client
const mockAxiosInstance = {
  get: () => {},
  post: () => {}
};

test.mock.method(axios, 'create', () => {
  return mockAxiosInstance;
});

// Now require wa-client and db
const waClient = require('../src/wa-client');
const db = require('../src/db');

test('WhatsApp Gateway Client Tests', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
  }

  t.after(async () => {
    await db._close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  await t.test('getSessionStatus returns CONNECTED', async () => {
    // Mock getSessionUuid first (which calls /sessions)
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
      if (url === '/sessions/mock-uuid') {
        return { data: { status: 'CONNECTED', phone: '1234567890', pushName: 'Nikhar' } };
      }
    });

    const status = await waClient.getSessionStatus();
    assert.strictEqual(status.status, 'CONNECTED');
    assert.strictEqual(status.phone, '1234567890');
    assert.strictEqual(status.pushName, 'Nikhar');
    mockAxiosInstance.get.mock.restore();
  });

  await t.test('sendTextMessage sends text correctly', async () => {
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
    });

    test.mock.method(mockAxiosInstance, 'post', async (url, body) => {
      if (url === '/sessions/mock-uuid/messages/send-text') {
        assert.strictEqual(body.chatId, '12345@c.us');
        assert.strictEqual(body.text, 'Hello World');
        return { data: { id: 'msg-123' } };
      }
    });

    const res = await waClient.sendTextMessage('12345', 'Hello World');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.messageId, 'msg-123');

    mockAxiosInstance.get.mock.restore();
    mockAxiosInstance.post.mock.restore();
  });

  await t.test('sendMediaMessage sends media correctly', async () => {
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
    });

    let postedUrl = '';
    let postedBody = null;
    test.mock.method(mockAxiosInstance, 'post', async (url, body) => {
      if (url.includes('/sessions/mock-uuid/messages/')) {
        postedUrl = url;
        postedBody = body;
        return { data: { id: 'media-msg-123' } };
      }
    });

    const res = await waClient.sendMediaMessage('918888888888', 'image', 'base64code', 'image/jpeg', 'test.jpg', 'My Caption');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.messageId, 'media-msg-123');
    assert.ok(postedUrl.endsWith('/send-image'));
    assert.strictEqual(postedBody.chatId, '918888888888@c.us');
    assert.strictEqual(postedBody.base64, 'base64code');
    assert.strictEqual(postedBody.mimetype, 'image/jpeg');
    assert.strictEqual(postedBody.filename, 'test.jpg');
    assert.strictEqual(postedBody.caption, 'My Caption');

    // Test audio (should not include caption)
    const audioRes = await waClient.sendMediaMessage('918888888888', 'audio', 'base64audio', 'audio/mp3', 'test.mp3', 'Ignored Caption');
    assert.strictEqual(audioRes.success, true);
    assert.ok(postedUrl.endsWith('/send-audio'));
    assert.strictEqual(postedBody.caption, undefined);

    mockAxiosInstance.get.mock.restore();
    mockAxiosInstance.post.mock.restore();
  });

  await t.test('getSessionStatus returns SCAN_QR and other statuses', async () => {
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
      if (url === '/sessions/mock-uuid') {
        return { data: { status: 'SCAN_QR', phone: null, pushName: null } };
      }
    });

    const status = await waClient.getSessionStatus();
    assert.strictEqual(status.status, 'SCAN_QR');
    assert.strictEqual(status.phone, null);
    
    mockAxiosInstance.get.mock.restore();
  });

  await t.test('getSessionQR returns base64 string on success', async () => {
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
      if (url === '/sessions/mock-uuid/qr') {
        return { data: { qrCode: 'data:image/png;base64,mockcode' } };
      }
    });

    const qr = await waClient.getSessionQR();
    assert.strictEqual(qr, 'data:image/png;base64,mockcode');
    mockAxiosInstance.get.mock.restore();
  });

  await t.test('getSessionQR returns null on 400 not ready error', async () => {
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
      if (url === '/sessions/mock-uuid/qr') {
        const err = new Error('QR not ready');
        err.response = { status: 400 };
        throw err;
      }
    });

    const qr = await waClient.getSessionQR();
    assert.strictEqual(qr, null);
    mockAxiosInstance.get.mock.restore();
  });

  await t.test('stopSession triggers post call to stop', async () => {
    let stopCalled = false;
    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
    });
    test.mock.method(mockAxiosInstance, 'post', async (url) => {
      if (url === '/sessions/mock-uuid/stop') {
        stopCalled = true;
        return { data: { success: true } };
      }
    });

    const res = await waClient.stopSession();
    assert.strictEqual(stopCalled, true);
    assert.deepStrictEqual(res, { success: true });
    
    mockAxiosInstance.get.mock.restore();
    mockAxiosInstance.post.mock.restore();
  });

  await t.test('resetSession stops session, cleans cache, and restarts it', async () => {
    const fs = require('fs');
    
    // We will track mock calls
    let stopCalled = false;
    let startCalled = false;
    let rmSyncCalledWith = null;

    test.mock.method(mockAxiosInstance, 'get', async (url) => {
      if (url === '/sessions') {
        return { data: [{ id: 'mock-uuid', name: 'leads-bot-session' }] };
      }
    });

    test.mock.method(mockAxiosInstance, 'post', async (url, body) => {
      if (url === '/sessions/mock-uuid/stop') {
        stopCalled = true;
        return { data: { success: true } };
      }
      if (url === '/sessions/mock-uuid/start') {
        startCalled = true;
        return { data: { success: true } };
      }
      if (url === '/sessions') {
        return { data: { id: 'mock-uuid' } };
      }
    });

    test.mock.method(fs, 'existsSync', (dir) => {
      if (dir.includes('session-leads-bot-session')) {
        return true;
      }
      return false;
    });

    test.mock.method(fs, 'rmSync', (dir, opts) => {
      if (dir.includes('session-leads-bot-session')) {
        rmSyncCalledWith = dir;
      }
    });

    const res = await waClient.resetSession();
    assert.strictEqual(res.success, true);
    assert.ok(res.message.includes('Reset initiated'));

    // Wait a brief moment for the background promise to execute
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.strictEqual(stopCalled, true, 'stopSession should have been called');
    assert.strictEqual(startCalled, true, 'startSession should have been called in background');
    assert.ok(rmSyncCalledWith !== null, 'rmSync should have been called on session directory');

    // Restore all mocks
    mockAxiosInstance.get.mock.restore();
    mockAxiosInstance.post.mock.restore();
    fs.existsSync.mock.restore();
    fs.rmSync.mock.restore();
  });
});
