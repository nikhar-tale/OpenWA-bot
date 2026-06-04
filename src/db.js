const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot-db.json');

// Ensure data folder exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initial state
const defaultState = {
  templates: [
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
  ],
  batches: []
};

// Read database
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDB(defaultState);
      return defaultState;
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(data);

    // Auto-seed test template if missing from existing database
    const testTemplateId = 'tpl_test_campaign';
    if (!db.templates.some(t => t.id === testTemplateId)) {
      db.templates.unshift({
        id: testTemplateId,
        name: 'Anshu & Nikhar Test Campaign',
        content: 'Hello {{name}},\n\nWe are testing the bulk messaging bot system for the property rental business of Anshu Purviya, built by expert developer Nikhar Tale.\n\nThank you for your patience!'
      });
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    }

    return db;
  } catch (error) {
    console.error('Error reading database file, using fallback state:', error);
    return defaultState;
  }
}

// Write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing to database file:', error);
  }
}

// Template helper functions
function getTemplates() {
  return readDB().templates;
}

function saveTemplate(template) {
  const db = readDB();
  const index = db.templates.findIndex(t => t.id === template.id);
  if (index >= 0) {
    db.templates[index] = template;
  } else {
    db.templates.push(template);
  }
  writeDB(db);
  return template;
}

function deleteTemplate(id) {
  const db = readDB();
  db.templates = db.templates.filter(t => t.id !== id);
  writeDB(db);
}

// Batch helper functions
function getBatches() {
  return readDB().batches;
}

function getBatch(id) {
  return getBatches().find(b => b.id === id);
}

function saveBatch(batch) {
  const db = readDB();
  const index = db.batches.findIndex(b => b.id === batch.id);
  if (index >= 0) {
    db.batches[index] = batch;
  } else {
    db.batches.push(batch);
  }
  writeDB(db);
  return batch;
}

module.exports = {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getBatches,
  getBatch,
  saveBatch
};
