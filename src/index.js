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

// Setup Multer for memory upload
const upload = multer({ storage: multer.memoryStorage() });

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
// TEMPLATE CRUD ENDPOINTS
// ==========================================

app.get('/api/templates', (req, res) => {
  res.json(db.getTemplates());
});

app.post('/api/templates', (req, res) => {
  const { id, name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and Content are required.' });
  }

  const templateId = id || `tpl_${crypto.randomUUID()}`;
  const template = { id: templateId, name, content };
  db.saveTemplate(template);
  res.json(template);
});

app.delete('/api/templates/:id', (req, res) => {
  db.deleteTemplate(req.params.id);
  res.json({ success: true });
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

  // Retrieve template content
  const templates = db.getTemplates();
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

  db.saveBatch(batch);

  // Trigger bulk sending in background
  try {
    await sender.startBulkSend(batchId, template.content, delay);
    res.json({ success: true, batchId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/bulk/status', (req, res) => {
  const status = sender.getActiveStatus();
  if (status.isSending) {
    return res.json(status);
  }

  // If no sending is active, return the latest batch details if any
  const batches = db.getBatches();
  if (batches.length > 0) {
    const latest = batches[batches.length - 1];
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
});

app.get('/api/bulk/batches', (req, res) => {
  res.json(db.getBatches());
});

app.post('/api/bulk/cancel', (req, res) => {
  const cancelled = sender.cancelActiveBatch();
  res.json({ success: cancelled });
});

// Fallback to index.html for UI SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`WhatsApp Bulk Messaging Bot running at http://localhost:${PORT}`);
});
