const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
const { parseLeadsBuffer } = require('./excel-parser');
const waClient = require('./wa-client');
const sender = require('./sender');

const app = express();
const PORT = process.env.PORT || 34567;

// Setup Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Setup Multer for memory upload with a strict 5MB limit
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
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
    const result = await waClient.startSession();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/qr', async (req, res) => {
  try {
    const qr = await waClient.getSessionQR();
    res.json({ qr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/disconnect', async (req, res) => {
  try {
    const result = await waClient.stopSession();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/reset', async (req, res) => {
  try {
    const result = await waClient.resetSession();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GATEWAY SETTINGS ENDPOINTS
// ==========================================

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({
      openwa_url: settings.openwa_url || process.env.OPENWA_URL || 'http://localhost:2785/api',
      api_key: settings.api_key || process.env.API_KEY || 'dev-admin-key'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { openwa_url, api_key } = req.body;
    if (openwa_url !== undefined) {
      await db.saveSetting('openwa_url', openwa_url.trim());
    }
    if (api_key !== undefined) {
      await db.saveSetting('api_key', api_key.trim());
    }
    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/templates', async (req, res) => {
  try {
    const { id, name, content } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and Content are required.' });
    }

    const templateId = id || `tpl_${crypto.randomUUID()}`;
    const template = { id: templateId, name, content };
    await db.saveTemplate(template);
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    await db.deleteTemplate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BULK SENDING ENDPOINTS
// ==========================================

app.post('/api/bulk/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const leads = parseLeadsBuffer(req.file.buffer);
    
    // Validate required columns
    const missingColumns = leads.length > 0 && (!leads[0].name || !leads[0].phone);
    if (missingColumns) {
      return res.status(400).json({ 
        error: 'Invalid file format. Make sure the file contains "Name" and "Phone" (or "Phone Number") columns.' 
      });
    }

    res.json({ count: leads.length, leads });
  } catch (error) {
    console.error('Error parsing file:', error);
    res.status(500).json({ error: 'Failed to process file. Ensure it is a valid Excel or CSV file.' });
  }
});

app.post('/api/bulk/send', async (req, res) => {
  const { templateId, leads, delaySeconds } = req.body;

  if (!templateId || !leads || !Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'Template ID and a non-empty leads array are required.' });
  }

  const delay = parseInt(delaySeconds, 10) || 5;

  try {
    // Retrieve template content
    const templates = await db.getTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found.' });
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
      }))
    };

    await db.saveBatch(batch);

    // Trigger bulk sending in background (don't await it here, starts immediately)
    sender.startBulkSend(batchId, template.content, delay).catch(err => {
      console.error('Background batch sending error:', err);
    });

    res.json({ success: true, batchId });
  } catch (error) {
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
