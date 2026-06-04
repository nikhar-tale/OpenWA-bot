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

  try {
    const res = await client.get('/sessions');
    const existing = res.data.find(s => s.name === SESSION_NAME);
    if (existing) {
      cachedSessionUuid = existing.id;
      return cachedSessionUuid;
    }

    console.log(`Session '${SESSION_NAME}' not found. Creating a new one...`);
    const createRes = await client.post('/sessions', { name: SESSION_NAME });
    cachedSessionUuid = createRes.data.id;
    return cachedSessionUuid;
  } catch (error) {
    if (error.response && error.response.status === 409) {
      try {
        const res = await client.get('/sessions');
        const existing = res.data.find(s => s.name === SESSION_NAME);
        if (existing) {
          cachedSessionUuid = existing.id;
          return cachedSessionUuid;
        }
      } catch (innerErr) {
        console.error('Failed to list sessions after 409 Conflict:', innerErr.message);
      }
    }
    console.error('Error resolving session UUID:', error.message);
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
    const res = await client.post(`/sessions/${uuid}/start`);
    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 400 && 
        (error.response.data?.message?.includes('already started') || 
         error.response.data?.message?.includes('already active'))) {
      return { success: true, message: 'Session already active' };
    }
    console.error('Error starting session:', error.message);
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
    const res = await client.post(`/sessions/${uuid}/stop`);
    return res.data;
  } catch (error) {
    console.error('Error stopping session:', error.message);
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
    const res = await client.get(`/sessions/${uuid}/qr`);
    return res.data.qrCode;
  } catch (error) {
    if (error.response && error.response.status === 400) {
      return null;
    }
    console.error('Error getting QR code:', error.message);
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

    const res = await client.post(`/sessions/${uuid}/messages/send-text`, {
      chatId: chatId,
      text: text
    });
    return { success: true, messageId: res.data.id || res.data.messageId };
  } catch (error) {
    console.error(`Failed to send message to ${phone}:`, error.message);
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
    console.log('Force resetting WhatsApp session (async background launch)...');
    
    try {
      await stopSession();
    } catch (err) {
      console.log('Stop session failed during reset (may be already stopped):', err.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const sessionDir = path.resolve(__dirname, '..', '..', 'OpenWA', 'data', 'sessions', `session-${SESSION_NAME}`);
    console.log('Cleaning up session directory:', sessionDir);
    
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('Session directory deleted successfully.');
      } catch (err) {
        console.warn('Failed to delete session directory (lock might still exist):', err.message);
      }
    }
    
    cachedSessionUuid = null;
    
    getSessionUuid()
      .then(async (uuid) => {
        console.log('Starting session in background after reset...');
        try {
          await startSession();
          console.log('Session start initiated in background successfully.');
        } catch (startErr) {
          console.error('Failed to start session in background after reset:', startErr.message);
        }
      })
      .catch((uuidErr) => {
        console.error('Failed to resolve UUID in background after reset:', uuidErr.message);
      });
    
    return { success: true, message: 'Reset initiated. Browser is restarting in the background.' };
  } catch (error) {
    console.error('Error during session reset:', error.message);
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
