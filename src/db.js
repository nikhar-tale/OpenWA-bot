const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot-db.sqlite');

// Ensure data folder exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

// Promisified SQLite functions
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Database schema initialization
let isInitialized = false;
const initPromise = (async () => {
  if (isInitialized) return;

  await runQuery(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      templateId TEXT NOT NULL,
      status TEXT NOT NULL,
      totalLeads INTEGER NOT NULL,
      sentCount INTEGER NOT NULL,
      failedCount INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      delaySeconds INTEGER NOT NULL,
      leads TEXT NOT NULL
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Upgrade batches table if needed for Phase 1 Media
  const tableInfo = await allQuery("PRAGMA table_info(batches)");
  const columns = tableInfo.map(c => c.name);
  if (!columns.includes('messageType')) {
    await runQuery("ALTER TABLE batches ADD COLUMN messageType TEXT DEFAULT 'text'");
  }
  if (!columns.includes('mediaPath')) {
    await runQuery("ALTER TABLE batches ADD COLUMN mediaPath TEXT");
  }
  if (!columns.includes('mediaMimetype')) {
    await runQuery("ALTER TABLE batches ADD COLUMN mediaMimetype TEXT");
  }
  if (!columns.includes('mediaFilename')) {
    await runQuery("ALTER TABLE batches ADD COLUMN mediaFilename TEXT");
  }
  if (!columns.includes('mediaFiles')) {
    await runQuery("ALTER TABLE batches ADD COLUMN mediaFiles TEXT DEFAULT '[]'");
  }

  // Upgrade templates table if needed for Phase 2 Media Templates
  const templatesTableInfo = await allQuery("PRAGMA table_info(templates)");
  const templatesColumns = templatesTableInfo.map(c => c.name);
  if (!templatesColumns.includes('messageType')) {
    await runQuery("ALTER TABLE templates ADD COLUMN messageType TEXT DEFAULT 'text'");
  }
  if (!templatesColumns.includes('mediaPath')) {
    await runQuery("ALTER TABLE templates ADD COLUMN mediaPath TEXT");
  }
  if (!templatesColumns.includes('mediaMimetype')) {
    await runQuery("ALTER TABLE templates ADD COLUMN mediaMimetype TEXT");
  }
  if (!templatesColumns.includes('mediaFilename')) {
    await runQuery("ALTER TABLE templates ADD COLUMN mediaFilename TEXT");
  }
  if (!templatesColumns.includes('mediaFiles')) {
    await runQuery("ALTER TABLE templates ADD COLUMN mediaFiles TEXT DEFAULT '[]'");
  }

  // Default templates seeding
  const defaultTemplates = [
    {
      id: 'tpl_test_campaign',
      name: 'Anshu & Nikhar Test Campaign',
      content: 'Hello {{name}},\n\nWe are testing the bulk messaging bot system for the property rental business of Anshu Purviya, built by expert developer Nikhar Tale.\n\nThank you for your patience!'
    },
    {
      id: 'tpl_default',
      name: 'Default Follow-up',
      content: 'Hello {{name}},\n\nThank you for contacting us regarding our property rentals. We have received your query and will get back to you shortly!'
    }
  ];

  for (const tpl of defaultTemplates) {
    const existing = await getQuery('SELECT id FROM templates WHERE id = ?', [tpl.id]);
    if (!existing) {
      await runQuery('INSERT INTO templates (id, name, content) VALUES (?, ?, ?)', [tpl.id, tpl.name, tpl.content]);
    }
  }

  isInitialized = true;
})();

async function ensureInit() {
  await initPromise;
}

// Templates API
async function getTemplates() {
  await ensureInit();
  const rows = await allQuery('SELECT * FROM templates');
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    content: row.content,
    messageType: row.messageType || 'text',
    mediaPath: row.mediaPath || null,
    mediaMimetype: row.mediaMimetype || null,
    mediaFilename: row.mediaFilename || null,
    mediaFiles: row.mediaFiles ? JSON.parse(row.mediaFiles) : []
  }));
}

async function saveTemplate(template) {
  await ensureInit();
  await runQuery(
    `INSERT INTO templates (id, name, content, messageType, mediaPath, mediaMimetype, mediaFilename, mediaFiles) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
     ON CONFLICT(id) DO UPDATE SET 
       name = excluded.name, 
       content = excluded.content,
       messageType = excluded.messageType,
       mediaPath = excluded.mediaPath,
       mediaMimetype = excluded.mediaMimetype,
       mediaFilename = excluded.mediaFilename,
       mediaFiles = excluded.mediaFiles`,
    [
      template.id,
      template.name,
      template.content,
      template.messageType || 'text',
      template.mediaPath || null,
      template.mediaMimetype || null,
      template.mediaFilename || null,
      template.mediaFiles ? JSON.stringify(template.mediaFiles) : '[]'
    ]
  );
  return template;
}

async function deleteTemplate(id) {
  await ensureInit();
  await runQuery('DELETE FROM templates WHERE id = ?', [id]);
}

// Batches API
async function getBatches() {
  await ensureInit();
  const rows = await allQuery('SELECT * FROM batches ORDER BY createdAt DESC');
  return rows.map(row => ({
    id: row.id,
    templateId: row.templateId,
    status: row.status,
    totalLeads: row.totalLeads,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    createdAt: row.createdAt,
    delaySeconds: row.delaySeconds,
    leads: JSON.parse(row.leads),
    messageType: row.messageType || 'text',
    mediaPath: row.mediaPath || null,
    mediaMimetype: row.mediaMimetype || null,
    mediaFilename: row.mediaFilename || null,
    mediaFiles: row.mediaFiles ? JSON.parse(row.mediaFiles) : []
  }));
}

async function getBatch(id) {
  await ensureInit();
  const row = await getQuery('SELECT * FROM batches WHERE id = ?', [id]);
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.templateId,
    status: row.status,
    totalLeads: row.totalLeads,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    createdAt: row.createdAt,
    delaySeconds: row.delaySeconds,
    leads: JSON.parse(row.leads),
    messageType: row.messageType || 'text',
    mediaPath: row.mediaPath || null,
    mediaMimetype: row.mediaMimetype || null,
    mediaFilename: row.mediaFilename || null,
    mediaFiles: row.mediaFiles ? JSON.parse(row.mediaFiles) : []
  };
}

async function saveBatch(batch) {
  await ensureInit();
  await runQuery(
    `INSERT INTO batches (id, templateId, status, totalLeads, sentCount, failedCount, createdAt, delaySeconds, leads, messageType, mediaPath, mediaMimetype, mediaFilename, mediaFiles) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
     ON CONFLICT(id) DO UPDATE SET 
       status = excluded.status,
       sentCount = excluded.sentCount,
       failedCount = excluded.failedCount,
       leads = excluded.leads`,
    [
      batch.id,
      batch.templateId,
      batch.status,
      batch.totalLeads,
      batch.sentCount,
      batch.failedCount,
      batch.createdAt || new Date().toISOString(),
      batch.delaySeconds || 0,
      JSON.stringify(batch.leads),
      batch.messageType || 'text',
      batch.mediaPath || null,
      batch.mediaMimetype || null,
      batch.mediaFilename || null,
      batch.mediaFiles ? JSON.stringify(batch.mediaFiles) : '[]'
    ]
  );
  return batch;
}

// Settings API
async function getSettings() {
  await ensureInit();
  const rows = await allQuery('SELECT * FROM settings');
  const config = {};
  rows.forEach(r => {
    config[r.key] = r.value;
  });
  return config;
}

async function saveSetting(key, value) {
  await ensureInit();
  await runQuery(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, value]
  );
}

module.exports = {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getBatches,
  getBatch,
  saveBatch,
  getSettings,
  saveSetting,
  _close: () => new Promise((resolve) => db.close(resolve))
};
