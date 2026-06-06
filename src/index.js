const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const db = require('./db');
const { parseLeadsBuffer } = require('./excel-parser');
const waClient = require('./wa-client');
const sender = require('./sender');

const app = express();
const PORT = process.env.PORT || 34567;

// Setup Middlewares
app.use(cors());
app.use(express.json());

// Logger Middleware to capture incoming taps and outgoing responses
app.use((req, res, next) => {
  const isPolling = req.url.includes('/session/status') || req.url.includes('/bulk/status') || req.url.includes('/session/qr');
  const start = Date.now();

  if (isPolling) {
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - start;
      console.log(`\x1b[90m[HTTP Poll] ${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms)\x1b[0m`);
      return originalJson.call(this, data);
    };
  } else {
    console.log(`\x1b[36m[HTTP Req]\x1b[0m ${req.method} ${req.url} - Body:`, JSON.stringify(req.body));
    
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - start;
      console.log(`\x1b[32m[HTTP Res]\x1b[0m ${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms) - Data:`, JSON.stringify(data));
      return originalJson.call(this, data);
    };
  }
  next();
});

// Basic Auth Middleware to secure the dashboard when deployed publicly
const basicAuthMiddleware = (req, res, next) => {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD;

  // If no password is set, warn in production but allow in local development
  if (!adminPassword) {
    if (process.env.PORT === '7860' || process.env.NODE_ENV === 'production') {
      console.warn('\x1b[31m[Security Warning]\x1b[0m ADMIN_PASSWORD is not configured! Access blocked.');
      return res.status(500).send('Configuration Error: ADMIN_PASSWORD must be set as a Hugging Face Space secret to enable access.');
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenWA-bot Bulk Dashboard"');
    return res.status(401).send('Authentication required');
  }

  try {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (user === adminUser && pass === adminPassword) {
      return next();
    }
  } catch (err) {
    console.error('[Security Error] Failed to parse auth header:', err.message);
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="OpenWA-bot Bulk Dashboard"');
  return res.status(401).send('Invalid credentials');
};

app.use(basicAuthMiddleware);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

// Setup Multer for memory upload with a strict 5MB limit
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Setup Multer for media uploads with a strict 20MB limit and saved to data/uploads
const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const mediaStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: function (req, file, cb) {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.mp4', '.mp3'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return cb(new Error('Only .jpg, .jpeg, .png, .pdf, .mp4, and .mp3 files are allowed.'));
    }
    cb(null, true);
  }
});

// ==========================================
// WHATSAPP GATEWAY SESSION ENDPOINTS
// ==========================================

app.get('/api/session/status', async (req, res) => {
  try {
    const status = await waClient.getSessionStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/connect', async (req, res) => {
  try {
    console.log('\x1b[35m[Server API]\x1b[0m Connect request received. Requesting session startup...');
    const result = await waClient.startSession();
    console.log('\x1b[32m[Server API]\x1b[0m Connect request handled successfully.');
    res.json({ success: true, result });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error during connect:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/qr', async (req, res) => {
  try {
    const qr = await waClient.getSessionQR();
    res.json({ qr });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error fetching QR:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/disconnect', async (req, res) => {
  try {
    console.log('\x1b[35m[Server API]\x1b[0m Disconnect request received. Requesting session stop...');
    const result = await waClient.stopSession();
    console.log('\x1b[32m[Server API]\x1b[0m Disconnect request handled successfully.');
    res.json({ success: true, result });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error during disconnect:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/reset', async (req, res) => {
  try {
    console.log('\x1b[35m[Server API]\x1b[0m Force Reset request received. Cleaning up locks and restarting...');
    const result = await waClient.resetSession();
    console.log('\x1b[32m[Server API]\x1b[0m Force Reset request initiated.');
    res.json({ success: true, result });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error during reset:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/send-test', async (req, res) => {
  try {
    const { numbers, message, messageType, mediaPath, mediaMimetype, mediaFilename } = req.body;
    let mediaFiles = req.body.mediaFiles || [];
    
    if (!numbers) {
      return res.status(400).json({ error: 'Numbers are required.' });
    }
    if ((!messageType || messageType === 'text') && !message) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const status = await waClient.getSessionStatus();
    if (status.status !== 'CONNECTED' && status.status !== 'ready') {
      return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }

    const numberList = numbers.split(',')
      .map(num => num.trim())
      .filter(num => num.length > 0);

    if (numberList.length === 0) {
      return res.status(400).json({ error: 'No valid numbers provided.' });
    }

    if (messageType && messageType !== 'text' && mediaFiles.length === 0 && mediaPath) {
      mediaFiles = [{
        path: mediaPath,
        mimetype: mediaMimetype,
        filename: mediaFilename
      }];
    }

    if (messageType && messageType !== 'text' && mediaFiles.length === 0) {
      return res.status(400).json({ error: 'Media files are missing for test.' });
    }

    console.log(`\x1b[35m[Server API]\x1b[0m Sending test (${messageType}) with ${mediaFiles.length} files to: ${numberList.join(', ')}`);
    const results = [];
    const fsPromises = require('fs').promises;

    for (const num of numberList) {
      if (!messageType || messageType === 'text') {
        const sendResult = await waClient.sendTextMessage(num, message);
        results.push({ phone: num, ...sendResult });
      } else {
        let fileIndex = 0;
        let success = true;
        let lastResult = null;
        for (const file of mediaFiles) {
          if (fileIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, 800));
          }
          try {
            const fileBuffer = await fsPromises.readFile(file.path);
            const base64Data = fileBuffer.toString('base64');
            const caption = fileIndex === 0 ? message : '';
            const sendResult = await waClient.sendMediaMessage(
              num,
              messageType,
              base64Data,
              file.mimetype,
              file.filename,
              caption
            );
            lastResult = sendResult;
            if (!sendResult.success) {
              success = false;
            }
          } catch (err) {
            success = false;
            lastResult = { success: false, error: err.message };
          }
          fileIndex++;
        }
        results.push({ phone: num, success, ...lastResult });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('[Server API Err] Error sending test message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GATEWAY SETTINGS ENDPOINTS
// ==========================================

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    const rawUrl = process.env.OPENWA_URL || settings.openwa_url || 'http://localhost:2785/api';
    const rawKey = process.env.API_KEY || settings.api_key || 'dev-admin-key';
    const rawToken = process.env.HF_TOKEN || settings.hf_token || '';

    res.json({
      openwa_url: rawUrl,
      api_key: rawKey ? '********' : '',
      hf_token: rawToken ? '********' : ''
    });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error loading settings:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { openwa_url, api_key, hf_token } = req.body;
    console.log(`\x1b[35m[Server API]\x1b[0m Saving settings: URL = ${openwa_url}`);
    if (openwa_url !== undefined) {
      await db.saveSetting('openwa_url', openwa_url.trim());
    }
    if (api_key !== undefined && api_key !== '********' && api_key.trim() !== '') {
      await db.saveSetting('api_key', api_key.trim());
    }
    if (hf_token !== undefined && hf_token !== '********' && hf_token.trim() !== '') {
      await db.saveSetting('hf_token', hf_token.trim());
    }
    console.log('\x1b[32m[Server API]\x1b[0m Settings saved to SQLite successfully.');
    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error saving settings:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TEMPLATE CRUD ENDPOINTS
// ==========================================

app.get('/api/templates', async (req, res) => {
  try {
    res.json(await db.getTemplates());
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error loading templates:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/templates', async (req, res) => {
  try {
    const { id, name, content, messageType, mediaPath, mediaMimetype, mediaFilename } = req.body;
    let mediaFiles = req.body.mediaFiles || [];
    console.log(`\x1b[35m[Server API]\x1b[0m Saving template: ID = ${id || 'NEW'}, Name = "${name}", Type = ${messageType || 'text'}`);
    if (!name || !content) {
      console.log('\x1b[31m[Server API]\x1b[0m Save template failed: Missing Name or Content.');
      return res.status(400).json({ error: 'Name and Content are required.' });
    }

    if (messageType && messageType !== 'text' && mediaFiles.length === 0 && mediaPath) {
      mediaFiles = [{
        path: mediaPath,
        mimetype: mediaMimetype,
        filename: mediaFilename
      }];
    }

    const templateId = id || `tpl_${crypto.randomUUID()}`;
    const template = { 
      id: templateId, 
      name, 
      content,
      messageType: messageType || 'text',
      mediaPath: mediaFiles[0]?.path || null,
      mediaMimetype: mediaFiles[0]?.mimetype || null,
      mediaFilename: mediaFiles[0]?.filename || null,
      mediaFiles: mediaFiles
    };
    await db.saveTemplate(template);
    console.log(`\x1b[32m[Server API]\x1b[0m Template "${name}" (${templateId}) saved successfully.`);
    res.json(template);
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error saving template:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    console.log(`\x1b[35m[Server API]\x1b[0m Deleting template ID = ${req.params.id}`);
    await db.deleteTemplate(req.params.id);
    console.log(`\x1b[32m[Server API]\x1b[0m Template deleted successfully.`);
    res.json({ success: true });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error deleting template:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BULK SENDING ENDPOINTS
// ==========================================

app.post('/api/bulk/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    console.log('\x1b[31m[Server API]\x1b[0m Bulk Upload failed: No file uploaded.');
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    console.log(`\x1b[35m[Server API]\x1b[0m Processing uploaded file: ${req.file.originalname} (${req.file.size} bytes)...`);
    const leads = parseLeadsBuffer(req.file.buffer);
    
    // Validate required columns
    const missingColumns = leads.length > 0 && (!leads[0].name || !leads[0].phone);
    if (missingColumns) {
      console.log('\x1b[31m[Server API]\x1b[0m Bulk Upload failed: Invalid columns. Name and Phone are required.');
      return res.status(400).json({ 
        error: 'Invalid file format. Make sure the file contains "Name" and "Phone" (or "Phone Number") columns.' 
      });
    }

    console.log(`\x1b[32m[Server API]\x1b[0m Bulk Upload success: Parsed ${leads.length} leads from spreadsheet.`);
    res.json({ count: leads.length, leads });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Failed to parse uploaded file:', error);
    res.status(500).json({ error: 'Failed to process file. Ensure it is a valid Excel or CSV file.' });
  }
});

app.post('/api/upload-media', (req, res) => {
  mediaUpload.array('media', 10)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'One or more files exceed the 20MB limit.' });
      }
      return res.status(400).json({ error: err.message });
    }
    
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No media files provided.' });
    }

    // Check combined size limit (50MB)
    const combinedSize = files.reduce((sum, file) => sum + file.size, 0);
    const MAX_COMBINED_SIZE = 50 * 1024 * 1024; // 50MB
    if (combinedSize > MAX_COMBINED_SIZE) {
      // Clean up files
      files.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (e) {
          console.error('[Upload Cleanup Error]', e.message);
        }
      });
      return res.status(413).json({ error: 'Combined file size exceeds the 50MB limit.' });
    }

    const filesData = files.map(file => ({
      filename: file.originalname,
      mimetype: file.mimetype,
      path: file.path,
      size: file.size,
      url: '/uploads/' + file.filename
    }));

    res.json({
      success: true,
      filename: filesData[0].filename,
      mimetype: filesData[0].mimetype,
      path: filesData[0].path,
      size: filesData[0].size,
      url: filesData[0].url,
      files: filesData
    });
  });
});

app.post('/api/bulk/send', async (req, res) => {
  const { templateId, leads, delaySeconds, messageType, mediaPath, mediaMimetype, mediaFilename } = req.body;
  let mediaFiles = req.body.mediaFiles || [];
  console.log(`\x1b[35m[Server API]\x1b[0m Received start-campaign request. Template ID: ${templateId}, Leads: ${leads?.length || 0}, Delay: ${delaySeconds}s, Type: ${messageType || 'text'}`);

  if (!templateId || !leads || !Array.isArray(leads) || leads.length === 0) {
    console.log('\x1b[31m[Server API]\x1b[0m Campaign failed to start: Missing templateId or empty leads array.');
    return res.status(400).json({ error: 'Template ID and a non-empty leads array are required.' });
  }

  const delay = parseInt(delaySeconds, 10) || 5;

  try {
    // Retrieve template content
    const templates = await db.getTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      console.log(`\x1b[31m[Server API]\x1b[0m Campaign failed to start: Template ${templateId} not found in database.`);
      return res.status(404).json({ error: 'Template not found.' });
    }

    if (messageType && messageType !== 'text' && mediaFiles.length === 0 && mediaPath) {
      mediaFiles = [{
        path: mediaPath,
        mimetype: mediaMimetype,
        filename: mediaFilename
      }];
    }

    // Create new sending batch
    const batchId = `batch_${Date.now()}`;
    const batch = {
      id: batchId,
      templateId,
      status: 'SENDING',
      totalLeads: leads.length,
      sentCount: 0,
      failedCount: 0,
      delaySeconds: delay,
      createdAt: new Date().toISOString(),
      leads: leads.map(l => ({
        name: l.name,
        phone: l.phone,
        status: 'PENDING',
        error: null,
        timestamp: null
      })),
      messageType: messageType || 'text',
      mediaPath: mediaFiles[0]?.path || null,
      mediaMimetype: mediaFiles[0]?.mimetype || null,
      mediaFilename: mediaFiles[0]?.filename || null,
      mediaFiles: mediaFiles
    };

    console.log(`\x1b[35m[Server API]\x1b[0m Creating campaign batch in SQLite: ID = ${batchId}, Template Name = "${template.name}"`);
    await db.saveBatch(batch);

    // Trigger bulk sending in background (don't await it here, starts immediately)
    console.log(`\x1b[32m[Server API]\x1b[0m Handing off campaign ${batchId} to Campaign Worker...`);
    sender.startBulkSend(batchId, template.content, delay).catch(err => {
      console.error('\x1b[31m[Campaign Queue Err]\x1b[0m Background batch sending error:', err);
    });

    res.json({ success: true, batchId });
  } catch (error) {
    console.error('\x1b[31m[Server API Err]\x1b[0m Error initiating campaign:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bulk/status', async (req, res) => {
  try {
    const status = await sender.getActiveStatus();
    if (status.isSending) {
      return res.json(status);
    }

    // If no sending is active, return the latest batch details if any
    const batches = await db.getBatches();
    if (batches.length > 0) {
      const latest = batches[0]; // SQLite returns ordered by createdAt DESC
      return res.json({
        isSending: false,
        batchId: latest.id,
        status: latest.status,
        totalLeads: latest.totalLeads,
        sentCount: latest.sentCount,
        failedCount: latest.failedCount,
        pendingCount: latest.leads.filter(l => l.status === 'PENDING').length,
        leads: latest.leads
      });
    }

    res.json({ isSending: false, batchId: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bulk/batches', async (req, res) => {
  try {
    res.json(await db.getBatches());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bulk/cancel', (req, res) => {
  const cancelled = sender.cancelActiveBatch();
  res.json({ success: cancelled });
});

// CSV Export Endpoint
app.get('/api/bulk/batches/:id/export', async (req, res) => {
  try {
    const batch = await db.getBatch(req.params.id);
    if (!batch) {
      return res.status(404).json({ error: 'Campaign batch not found.' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=campaign-report-${batch.id}.csv`);

    res.write('Name,Phone,Status,Message Sent,Timestamp,Error\n');

    for (const lead of batch.leads) {
      const name = (lead.name || '').replace(/"/g, '""');
      const phone = lead.phone || '';
      const status = lead.status || '';
      const message = (lead.sentMessage || '').replace(/"/g, '""').replace(/\n/g, ' ');
      const timestamp = lead.timestamp || '';
      const error = (lead.error || '').replace(/"/g, '""');

      res.write(`"${name}","${phone}","${status}","${message}","${timestamp}","${error}"\n`);
    }

    res.end();
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

// Fallback to index.html for UI SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling for Multer payload limit
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File size too large. Maximum upload limit is 5MB.' });
  }
  next(err);
});

// Start Server
app.listen(PORT, () => {
  console.log(`WhatsApp Bulk Messaging Bot running at http://localhost:${PORT}`);
});
