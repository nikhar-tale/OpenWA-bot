const axios = require('axios');
const db = require('./db');

async function getActiveSessionName() {
  const settings = await db.getSettings();
  return process.env.SESSION_ID || settings.session_id || 'leads-bot-session';
}

function clearSessionCache() {
  cachedSessionUuid = null;
}

let cachedSessionUuid = null;

/**
 * Extracts a human-readable error message from an axios error.
 * Handles ECONNREFUSED, ETIMEDOUT, HTTP errors, and generic errors.
 */
function getErrorMessage(error) {
  if (error.code === 'ECONNREFUSED') {
    return `Gateway unreachable — cannot connect to ${error.config?.baseURL || 'OpenWA Gateway'}. Is the server running?`;
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return `Gateway timeout — the OpenWA Gateway did not respond in time.`;
  }
  if (error.code === 'ENOTFOUND') {
    return `Gateway hostname not found — check your Gateway URL in Settings.`;
  }
  if (error.response) {
    const status = error.response.status;
    const msg = error.response.data?.message || error.response.data?.error || error.response.statusText;
    return `Gateway returned HTTP ${status}: ${msg}`;
  }
  return error.message || 'Unknown error communicating with the OpenWA Gateway.';
}

async function getHttpClient() {
  const settings = await db.getSettings();
  const baseURL = process.env.OPENWA_URL || settings.openwa_url || 'http://localhost:2785/api';
  const apiKey = process.env.API_KEY || settings.api_key || 'dev-admin-key';
  const hfToken = process.env.HF_TOKEN || settings.hf_token || '';

  const headers = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json'
  };

  if (hfToken) {
    headers['Authorization'] = `Bearer ${hfToken}`;
  }

  return axios.create({
    baseURL: baseURL,
    headers: headers
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
  const sessionName = await getActiveSessionName();
  console.log(`\x1b[34m[Gateway Req]\x1b[0m Resolving session UUID for '${sessionName}'...`);

  try {
    const res = await client.get('/sessions');
    const existing = res.data.find(s => s.name === sessionName);
    if (existing) {
      cachedSessionUuid = existing.id;
      console.log(`\x1b[35m[Gateway Res]\x1b[0m Resolved session UUID: ${cachedSessionUuid}`);
      return cachedSessionUuid;
    }

    console.log(`\x1b[33m[Gateway Log]\x1b[0m Session '${sessionName}' not found. Creating a new one...`);
    const createRes = await client.post('/sessions', { name: sessionName });
    cachedSessionUuid = createRes.data.id;
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Session created. UUID: ${cachedSessionUuid}`);
    return cachedSessionUuid;
  } catch (error) {
    if (error.response && error.response.status === 409) {
      try {
        console.log(`\x1b[33m[Gateway Log]\x1b[0m Session conflict (409). Fetching session uuid list...`);
        const res = await client.get('/sessions');
        const existing = res.data.find(s => s.name === sessionName);
        if (existing) {
          cachedSessionUuid = existing.id;
          return cachedSessionUuid;
        }
      } catch (innerErr) {
        console.error('\x1b[31m[Gateway Err]\x1b[0m Failed to list sessions after 409 Conflict:', innerErr.message);
      }
    }
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error resolving session UUID:', errMsg);
    error._userMessage = errMsg;
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
    return { status: 'UNKNOWN', phone: null, pushName: null, error: error._userMessage || getErrorMessage(error) };
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
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error starting session:', errMsg);
    error._userMessage = errMsg;
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
    cachedSessionUuid = null;  // Force fresh UUID lookup on next connect
    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error stopping session:', errMsg);
    error._userMessage = errMsg;
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
      let cleanNumber = chatId.replace(/[^\d]/g, '');
      if (cleanNumber.length === 10) {
        cleanNumber = `91${cleanNumber}`;
      }
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
 * Sends a media message to a specific number.
 */
async function sendMediaMessage(phone, type, base64, mimetype, filename, caption) {
  try {
    const client = await getHttpClient();
    const uuid = await getSessionUuid();

    let chatId = phone.trim();
    if (!chatId.endsWith('@c.us')) {
      let cleanNumber = chatId.replace(/[^\d]/g, '');
      if (cleanNumber.length === 10) {
        cleanNumber = `91${cleanNumber}`;
      }
      chatId = `${cleanNumber}@c.us`;
    }

    let endpoint = 'send-document';
    if (type === 'image') endpoint = 'send-image';
    else if (type === 'video') endpoint = 'send-video';
    else if (type === 'audio') endpoint = 'send-audio';

    console.log(`\x1b[34m[Gateway Req]\x1b[0m Sending media (${type}) to ${chatId}...`);
    const payload = {
      chatId: chatId,
      base64: base64,
      mimetype: mimetype,
      filename: filename
    };
    if (caption && type !== 'audio') {
      payload.caption = caption;
    }

    const res = await client.post(`/sessions/${uuid}/messages/${endpoint}`, payload);
    console.log(`\x1b[35m[Gateway Res]\x1b[0m Media message sent successfully. ID: ${res.data.id || res.data.messageId}`);
    return { success: true, messageId: res.data.id || res.data.messageId };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cachedSessionUuid = null;
    }
    console.error(`\x1b[31m[Gateway Err]\x1b[0m Failed to send media message (${type}) to ${phone}:`, error.message);
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
    
    const sessionName = await getActiveSessionName();
    const sessionDir = path.resolve(__dirname, '..', '..', 'OpenWA', 'data', 'sessions', `session-${sessionName}`);
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
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error during session reset:', errMsg);
    error._userMessage = errMsg;
    throw error;
  }
}

async function getSessionsList() {
  try {
    const client = await getHttpClient();
    const res = await client.get('/sessions');
    return res.data;
  } catch (error) {
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error listing sessions:', errMsg);
    throw new Error(errMsg);
  }
}

async function createSession(sessionName) {
  try {
    const client = await getHttpClient();
    const res = await client.post('/sessions', { name: sessionName });
    return res.data;
  } catch (error) {
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error creating session:', errMsg);
    throw new Error(errMsg);
  }
}

async function deleteSession(sessionName) {
  try {
    const client = await getHttpClient();
    // Resolve UUID of the target session by name
    const res = await client.get('/sessions');
    const existing = res.data.find(s => s.name === sessionName);
    if (!existing) {
      throw new Error(`Session '${sessionName}' not found on gateway.`);
    }
    const uuid = existing.id;
    
    // Stop the session on gateway
    try {
      await client.post(`/sessions/${uuid}/stop`);
    } catch (e) {
      console.log(`[Gateway Log] Stop failed during delete of session ${sessionName}:`, e.message);
    }
    
    // Delete session on gateway
    await client.delete(`/sessions/${uuid}`);
    
    // Clean up local directory
    const fs = require('fs');
    const path = require('path');
    const sessionDir = path.resolve(__dirname, '..', '..', 'OpenWA', 'data', 'sessions', `session-${sessionName}`);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[Gateway Res] Session directory deleted for deleted session: ${sessionName}`);
      } catch (err) {
        console.warn(`[Gateway Err] Failed to delete session directory during delete of session ${sessionName}:`, err.message);
      }
    }
  } catch (error) {
    const errMsg = getErrorMessage(error);
    console.error('\x1b[31m[Gateway Err]\x1b[0m Error deleting session:', errMsg);
    throw new Error(errMsg);
  }
}

module.exports = {
  getSessionStatus,
  startSession,
  stopSession,
  getSessionQR,
  sendTextMessage,
  sendMediaMessage,
  resetSession,
  getActiveSessionName,
  clearSessionCache,
  getSessionsList,
  createSession,
  deleteSession
};
