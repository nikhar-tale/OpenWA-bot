const axios = require('axios');

const OPENWA_URL = process.env.OPENWA_URL || 'http://localhost:2785/api';
const API_KEY = process.env.API_KEY || 'dev-admin-key';
const SESSION_NAME = process.env.SESSION_ID || 'leads-bot-session';

const client = axios.create({
  baseURL: OPENWA_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  }
});

let cachedSessionUuid = null;

/**
 * Resolves the session's internal UUID by finding it or creating it.
 */
async function getSessionUuid() {
  if (cachedSessionUuid) {
    return cachedSessionUuid;
  }

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
    // If the creation returns conflict (409), it means another request created it.
    // Try listing again to fetch its ID.
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
    const uuid = await getSessionUuid();
    const res = await client.get(`/sessions/${uuid}`);
    return {
      status: res.data.status, // e.g. "CONNECTED", "SCAN_QR", "INITIALIZING", "DISCONNECTED"
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
    const uuid = await getSessionUuid();
    const res = await client.get(`/sessions/${uuid}/qr`);
    return res.data.qrCode; // Returns base64 representation of QR
  } catch (error) {
    // If QR code is not ready yet (400), return null gracefully
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
    const uuid = await getSessionUuid();

    // Format phone number to WhatsApp chatId format if not already formatted
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
    
    // 1. Try to stop the session
    try {
      await stopSession();
    } catch (err) {
      console.log('Stop session failed during reset (may be already stopped):', err.message);
    }
    
    // Give it 1 second to release locks
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. Locate and delete the session folder
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
    
    // Clear cached UUID
    cachedSessionUuid = null;
    
    // 3. Recreate and restart session in the background
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
