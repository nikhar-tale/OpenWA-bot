const axios = require('axios');
const db = require('./db');

const SESSION_NAME = process.env.SESSION_ID || 'leads-bot-session';

let cachedSessionUuid = null;

/**
 * Creates an Axios instance dynamically loaded with current SQLite database settings.
 */
async function getHttpClient() {
  const settings = await db.getSettings();
  const baseURL = settings.openwa_url || process.env.OPENWA_URL || 'http://localhost:2785/api';
  const apiKey = settings.api_key || process.env.API_KEY || 'dev-admin-key';

  return axios.create({
    baseURL: baseURL,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Resolves the session's internal UUID by finding it or creating it.
 */
async function getSessionUuid() {
  if (cachedSessionUuid) {
    return cachedSessionUuid;
  }

  const client = await getHttpClient();
  console.log(`\x1b[34m[Gateway Req]\x1b[0m Resolving session UUID for '${SESSION_NAME}'...`);

  try {
    const res = await client.get('/sessions');
    const existing = res.data.find(s => s.name === SESSION_NAME);
    if (existing) {
      cachedSessionUuid = existing.id;
      console.log(`\x1b[35m[Gateway Res]\x1b[0m Resolved session UUID: ${cachedSessionUuid}`);
      return cachedSessionUuid;
    }

    console.log(`\x1b[33m[Gateway Log]\x1b[0m Session '${SESSION_NAME}' not found. Creating a new one...`);
    const createRes = await client.post('/sessions', { name: SESSION_NAME });
    cachedSessionUuid = createRes.data.id;
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Session created. UUID: ${cachedSessionUuid}`);
    return cachedSessionUuid;
  } catch (error) {
    if (error.response && error.response.status === 409) {
      try {
        console.log(`\x1b[33m[Gateway Log]\x1b[0m Session conflict (409). Fetching session uuid list...`);
        const res = await client.get('/sessions');
        const existing = res.data.find(s => s.name === SESSION_NAME);
        if (existing) {
          cachedSessionUuid = existing.id;
          return cachedSessionUuid;
        }
      } catch (innerErr) {
        console.error('\x1b[31m[Gateway Err]\x1b[0m Failed to list sessions after 409 Conflict:', innerErr.message);
      }
    }
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error resolving session UUID:', error.message);
    throw error;
  }
}

/**
 * Gets the current status of our WhatsApp session.
 */
async function getSessionStatus() {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();
    const res = await client.get(`/sessions/${uuid}`);
    return {
      status: res.data.status,
      phone: res.data.phone || null,
      pushName: res.data.pushName || null
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`\x1b[33m[Gateway Log]\x1b[0m Stale session UUID (404). Clearing cache...`);
      cachedSessionUuid = null;
    }
    return { status: 'UNKNOWN', phone: null, pushName: null, error: error.message };
  }
}

/**
 * Requests OpenWA to start/initialize the Puppeteer browser for the session.
 */
async function startSession() {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();
    console.log(`\x1b[34m[Gateway Req]\x1b[0m Starting WhatsApp session (UUID: ${uuid})...`);
    const res = await client.post(`/sessions/${uuid}/start`);
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Start initiated:`, JSON.stringify(res.data));
    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    if (error.response && error.response.status === 400 && 
        (error.response.data?.message?.includes('already started') || 
         error.response.data?.message?.includes('already active'))) {
      console.log(`\x1b[33m[Gateway Log]\x1b[0m Session already active (400)`);
      return { success: true, message: 'Session already active' };
    }
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error starting session:', error.message);
    throw error;
  }
}

/**
 * Requests OpenWA to stop/close the session.
 */
async function stopSession() {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();
    console.log(`\x1b[34m[Gateway Req]\x1b[0m Stopping WhatsApp session (UUID: ${uuid})...`);
    const res = await client.post(`/sessions/${uuid}/stop`);
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Stop completed:`, JSON.stringify(res.data));
    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error stopping session:', error.message);
    throw error;
  }
}

/**
 * Fetches the QR code for authentication as a base64 string.
 */
async function getSessionQR() {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();
    console.log(`\x1b[34m[Gateway Req]\x1b[0m Fetching QR code for UUID ${uuid}...`);
    const res = await client.get(`/sessions/${uuid}/qr`);
    console.log(`\x1b[35m[Gateway Res]\x1b[0m QR code fetched successfully.`);
    return res.data.qrCode;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    if (error.response && error.response.status === 400) {
      console.log(`\x1b[33m[Gateway Log]\x1b[0m QR not ready yet (400)`);
      return null;
    }
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error getting QR code:', error.message);
    return null;
  }
}

/**
 * Sends a personalized text message to a specific number.
 */
async function sendTextMessage(phone, text) {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();

    let chatId = phone.trim();
    if (!chatId.endsWith('@c.us')) {
      const cleanNumber = chatId.replace(/[^\d]/g, '');
      chatId = `${cleanNumber}@c.us`;
    }

    console.log(`\x1b[34m[Gateway Req]\x1b[0m Sending message to ${chatId} (Length: ${text.length})...`);
    const res = await client.post(`/sessions/${uuid}/messages/send-text`, {
      chatId: chatId,
      text: text
    });
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Message sent successfully. ID: ${res.data.id || res.data.messageId}`);
    return { success: true, messageId: res.data.id || res.data.messageId };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    console.error(`\x1b[31m[Gateway Err]\x1b[0m Failed to send message to ${phone}:`, error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

/**
 * Halts, cleans the cache, and restarts the session to recover from hangs.
 */
async function resetSession() {
  const fs = require('fs');
  const path = require('path');

  try {
    console.log('\x1b[33m[Gateway Log]\x1b[0m Force resetting WhatsApp session (async background launch)...');
    
    try {
      await stopSession();
    } catch (err) {
      console.log('\x1b[33m[Gateway Log]\x1b[0m Stop session failed during reset (may be already stopped):', err.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const sessionDir = path.resolve(__dirname, '..', '..', 'OpenWA', 'data', 'sessions', `session-${SESSION_NAME}`);
    console.log('\x1b[33m[Gateway Log]\x1b[0m Cleaning up session directory:', sessionDir);
    
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('\x1b[35m[Gateway Res]\x1b[0m Session directory deleted successfully.');
      } catch (err) {
        console.warn('\x1b[31m[Gateway Err]\x1b[0m Failed to delete session directory (lock might still exist):', err.message);
      }
    }
    
    cachedSessionUuid = null;
    
    getSessionUuid()
      .then(async (uuid) => {
        console.log('\x1b[33m[Gateway Log]\x1b[0m Starting session in background after reset...');
        try {
          await startSession();
          console.log('\x1b[35m[Gateway Res]\x1b[0m Session start initiated in background successfully.');
        } catch (startErr) {
          console.error('\x1b[31m[Gateway Err]\x1b[0m Failed to start session in background after reset:', startErr.message);
        }
      })
      .catch((uuidErr) => {
        console.error('\x1b[31m[Gateway Err]\x1b[0m Failed to resolve UUID in background after reset:', uuidErr.message);
      });
    
    return { success: true, message: 'Reset initiated. Browser is restarting in the background.' };
  } catch (error) {
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error during session reset:', error.message);
    throw error;
  }
}

module.exports = {
  getSessionStatus,
  startSession,
  stopSession,
  getSessionQR,
  sendTextMessage,
  resetSession
};
