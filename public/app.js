// Configuration
const API_BASE = '/api';

// Intercept all outgoing fetch requests for detailed logging
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = args[0];
  const options = args[1] || {};
  const method = options.method || 'GET';
  const isPolling = url.includes('/status') || url.includes('/qr');
  const timestamp = new Date().toLocaleTimeString();

  if (isPolling) {
    const res = await originalFetch(...args);
    console.log(`%c[UI Telemetry Poll] ${timestamp} - ${method} ${url} ➔ Status: ${res.status}`, 'color: #94a3b8; font-size: 11px;');
    return res;
  } else {
    console.log(`%c[UI API Req] ${timestamp} - OUTGOING ➔ ${method} ${url}`, 'color: #fb7185; font-weight: bold; background: #1e1b4b; padding: 2px 6px; border-radius: 3px;', {
      url,
      method,
      headers: options.headers,
      body: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined
    });

    const start = performance.now();
    try {
      const res = await originalFetch(...args);
      const duration = (performance.now() - start).toFixed(1);
      
      const resClone = res.clone();
      let responseBody = null;
      try {
        responseBody = await resClone.json();
      } catch (e) {
        responseBody = 'Non-JSON Response';
      }

      console.log(`%c[UI API Res] ${timestamp} - INCOMING 🞨 ${method} ${url} ➔ Status: ${res.status} (${duration}ms)`, 'color: #34d399; font-weight: bold; background: #064e3b; padding: 2px 6px; border-radius: 3px;', responseBody);
      return res;
    } catch (error) {
      const duration = (performance.now() - start).toFixed(1);
      console.log(`%c[UI API Err] ${timestamp} - FAILED 🞨 ${method} ${url} (${duration}ms) ➔ Error: ${error.message}`, 'color: #f43f5e; font-weight: bold; background: #4c0519; padding: 2px 6px; border-radius: 3px;');
      throw error;
    }
  }
};

// State
let state = {
  templates: [],
  selectedTemplateId: '',
  uploadedLeads: [],
  activeCampaign: null,
  waStatus: 'DISCONNECTED',
  pollingInterval: null,
  connectingTime: 0, // Track duration in initializing/authenticating state
  isTransitioning: false, // Prevent background polls from overwriting buttons during active transitions
  batches: []
};

// DOM Elements
const waStatusBadge = document.getElementById('wa-status-badge');
const btnToggleConnection = document.getElementById('btn-toggle-connection');
const btnHeaderForceReset = document.getElementById('btn-header-force-reset');
const qrPlaceholder = document.getElementById('qr-placeholder');
const qrImage = document.getElementById('qr-image');
const connectionInfo = document.getElementById('connection-info');
const waPhone = document.getElementById('wa-phone');
const waName = document.getElementById('wa-name');
const btnForceReset = document.getElementById('btn-force-reset');

// Settings Elements
const settingsUrl = document.getElementById('settings-url');
const settingsKey = document.getElementById('settings-key');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsMsg = document.getElementById('settings-msg');

const templateSelect = document.getElementById('template-select');
const btnNewTemplate = document.getElementById('btn-new-template');
const templateName = document.getElementById('template-name');
const templateContent = document.getElementById('template-content');
const btnSaveTemplate = document.getElementById('btn-save-template');
const btnDeleteTemplate = document.getElementById('btn-delete-template');

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const fileInfoText = document.getElementById('file-info-text');

const campaignReadySection = document.getElementById('campaign-ready');
const campaignProgressSection = document.getElementById('campaign-progress');
const readyTotalCount = document.getElementById('ready-total-count');
const previewSampleName = document.getElementById('preview-sample-name');
const previewText = document.getElementById('preview-text');
const delayInput = document.getElementById('delay-input');
const btnStartCampaign = document.getElementById('btn-start-campaign');

const progressBarFill = document.getElementById('progress-bar-fill');
const progressTotal = document.getElementById('progress-total');
const progressSent = document.getElementById('progress-sent');
const progressFailed = document.getElementById('progress-failed');
const progressPending = document.getElementById('progress-pending');
const progressStatusText = document.getElementById('progress-status-text');
const btnCancelCampaign = document.getElementById('btn-cancel-campaign');

const logsTbody = document.getElementById('logs-tbody');
const historyTbody = document.getElementById('history-tbody');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('%c[App Init] Initializing dashboard client controllers...', 'color: #6366f1; font-weight: bold; font-size: 14px;');
  setupEventListeners();
  loadSettings();
  checkWAStatus();
  loadTemplates();
  loadCampaignHistory();
  checkActiveCampaign();
  
  // Periodically check WhatsApp status
  setInterval(checkWAStatus, 5000);
});

// Event Listeners
function setupEventListeners() {
  // Tab switching logic
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelector('.nav-tab.active').classList.remove('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      
      tab.classList.add('active');
      const targetTab = tab.getAttribute('data-tab');
      document.getElementById(`tab-${targetTab}`).classList.remove('hidden');

      console.log(`%c[UI Action] Tab Switched ➔ "${targetTab.toUpperCase()}" Workspace`, 'color: #a855f7; font-weight: bold; background: #2e1065; padding: 2px 6px; border-radius: 3px;');

      if (targetTab === 'history') {
        loadCampaignHistory();
      } else if (targetTab === 'templates') {
        loadTemplates();
      } else if (targetTab === 'settings') {
        loadSettings();
      }
    });
  });

  // Connection
  btnToggleConnection.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Connect/Disconnect Toggle Clicked', 'color: #3b82f6; font-weight: bold; background: #172554; padding: 2px 6px; border-radius: 3px;');
    toggleConnection();
  });
  btnForceReset.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Force Reset Connection Clicked', 'color: #ef4444; font-weight: bold; background: #450a0a; padding: 2px 6px; border-radius: 3px;');
    forceResetConnection();
  });
  btnHeaderForceReset.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Header Force Reset Clicked', 'color: #ef4444; font-weight: bold; background: #450a0a; padding: 2px 6px; border-radius: 3px;');
    forceResetConnection();
  });

  // Settings
  btnSaveSettings.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Save Settings Clicked', 'color: #eab308; font-weight: bold; background: #422006; padding: 2px 6px; border-radius: 3px;');
    saveSettings();
  });

  // Templates
  templateSelect.addEventListener('change', (e) => {
    console.log(`%c[UI Event] Dropdown Selection: Template Changed ➔ ID: ${e.target.value}`, 'color: #ec4899; font-weight: bold; background: #500724; padding: 2px 6px; border-radius: 3px;');
    selectTemplate(e.target.value);
  });
  btnNewTemplate.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: New Template Clicked', 'color: #ec4899; font-weight: bold; background: #500724; padding: 2px 6px; border-radius: 3px;');
    initNewTemplate();
  });
  btnSaveTemplate.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Save Template Clicked', 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 6px; border-radius: 3px;');
    saveTemplate();
  });
  btnDeleteTemplate.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Delete Template Clicked', 'color: #ef4444; font-weight: bold; background: #450a0a; padding: 2px 6px; border-radius: 3px;');
    deleteTemplate();
  });
  templateContent.addEventListener('input', () => {
    updatePreview();
  });

  // File Upload
  uploadZone.addEventListener('click', () => {
    console.log('%c[UI Event] Click: Upload Area Clicked', 'color: #06b6d4; font-weight: bold; background: #083344; padding: 2px 6px; border-radius: 3px;');
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    console.log('%c[UI Event] Input: File Chosen via File Browser', 'color: #06b6d4; font-weight: bold; background: #083344; padding: 2px 6px; border-radius: 3px;');
    handleFileSelect();
  });
  
  // Drag and Drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      console.log('%c[UI Event] Drop: Leads spreadsheet dropped onto zone', 'color: #06b6d4; font-weight: bold; background: #083344; padding: 2px 6px; border-radius: 3px;');
      fileInput.files = e.dataTransfer.files;
      handleFileSelect();
    }
  });

  // Campaign
  btnStartCampaign.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Start Campaign Clicked', 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 6px; border-radius: 3px;');
    startCampaign();
  });
  btnCancelCampaign.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Cancel Campaign Clicked', 'color: #ef4444; font-weight: bold; background: #450a0a; padding: 2px 6px; border-radius: 3px;');
    cancelCampaign();
  });
}

// ==========================================
// TOAST NOTIFICATIONS (POPUP REPLACEMENTS)
// ==========================================

function showToast(message, type = 'info') {
  console.log(`%c[Toast Notification] [${type.toUpperCase()}] ${message}`, 'color: #64748b; font-style: italic;');
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  // Fade and slide out after 4 seconds
  setTimeout(() => {
    toast.style.animation = 'toast-slide-in 0.3s ease reverse forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// ==========================================
// WHATSAPP GATEWAY CONNECTION
// ==========================================

async function checkWAStatus() {
  try {
    const res = await fetch(`${API_BASE}/session/status`);
    const data = await res.json();

    if (state.isTransitioning) {
      console.log('%c[UI Poll] Skipped status poll UI update (transition in progress)', 'color: #94a3b8; font-size: 11px;');
      return;
    }
    
    if (state.waStatus !== data.status) {
      console.log(`%c[WA Status Change] ${state.waStatus} ➔ ${data.status}`, 'color: #3b82f6; font-weight: bold;');
    }
    state.waStatus = data.status;

    // Update status badge
    waStatusBadge.textContent = data.status;
    waStatusBadge.className = 'badge';

    // Track connecting duration to show Force Reset if it gets stuck
    if (data.status === 'initializing' || data.status === 'authenticating') {
      state.connectingTime += 5;
      if (state.connectingTime >= 20) {
        btnForceReset.classList.remove('hidden');
        btnHeaderForceReset.classList.remove('hidden');
      }
    } else {
      state.connectingTime = 0;
      btnForceReset.classList.add('hidden');
      btnHeaderForceReset.classList.add('hidden');
    }

    if (data.status === 'CONNECTED' || data.status === 'ready') {
      waStatusBadge.classList.add('badge-connected');
      btnToggleConnection.textContent = 'Disconnect';
      btnToggleConnection.className = 'btn btn-sm btn-danger';
      btnToggleConnection.disabled = false;
      
      // Show info
      connectionInfo.classList.remove('hidden');
      waPhone.textContent = data.phone || 'Connected';
      waName.textContent = data.pushName || '-';

      // Hide QR elements
      qrImage.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrPlaceholder.innerHTML = '<span class="text-success font-weight-bold">WhatsApp Connected & Active</span>';
    } else {
      waStatusBadge.classList.add('badge-disconnected');
      connectionInfo.classList.add('hidden');
      
      // Dynamic button state & configuration based on intermediate statuses
      if (data.status === 'initializing' || data.status === 'authenticating') {
        btnToggleConnection.textContent = 'Connecting...';
        btnToggleConnection.className = 'btn btn-sm btn-secondary';
        btnToggleConnection.disabled = true;
      } else if (data.status === 'SCAN_QR' || data.status === 'qr' || data.status === 'qr_ready') {
        btnToggleConnection.textContent = 'Cancel';
        btnToggleConnection.className = 'btn btn-sm btn-danger';
        btnToggleConnection.disabled = false;
      } else {
        btnToggleConnection.textContent = 'Connect';
        btnToggleConnection.className = 'btn btn-sm btn-primary';
        btnToggleConnection.disabled = false;
      }
      
      if (data.status === 'SCAN_QR' || data.status === 'qr' || data.status === 'qr_ready') {
        // Fetch and show QR
        fetchQR();
      } else {
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.remove('hidden');
        
        let statusMsg = `Session Status: ${data.status || 'Disconnected'}`;
        if (data.status === 'initializing') {
          statusMsg = '⚡ Launching browser engine... please wait.';
        } else if (data.status === 'authenticating') {
          statusMsg = '🔐 Restoring saved session... Logging in automatically.';
        }
        
        if (state.connectingTime >= 60) {
          statusMsg += `<br><span class="text-danger small" style="display:block;margin-top:8px;">⚠️ Connection taking longer than usual. You can wait or click Force Reset below.</span>`;
        } else if (state.connectingTime >= 30) {
          statusMsg += `<br><span class="text-warning small" style="display:block;margin-top:8px;">⏳ WhatsApp Web is loading chats... (usually takes 30-45 seconds).</span>`;
        }
        
        qrPlaceholder.innerHTML = `<span class="qr-placeholder-text">${statusMsg}</span>`;
      }
    }
  } catch (error) {
    console.error('Failed to get WhatsApp status:', error);
    waStatusBadge.textContent = 'Offline';
    waStatusBadge.className = 'badge badge-disconnected';
  }
}

async function fetchQR() {
  try {
    const res = await fetch(`${API_BASE}/session/qr`);
    const data = await res.json();
    if (data.qr) {
      qrImage.src = data.qr;
      if (qrImage.classList.contains('hidden')) {
        console.log('%c[WA Connection] QR code loaded and rendered on screen.', 'color: #10b981; font-weight: bold;');
      }
      qrImage.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
    } else {
      // If the session status is qr_ready but QR data is temporarily null/generating
      qrImage.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text">⚡ WhatsApp is ready. Loading QR code...</span>';
    }
  } catch (err) {
    console.error('Error fetching QR:', err);
  }
}

async function toggleConnection() {
  if (state.isTransitioning) return;

  const isConnected = state.waStatus === 'CONNECTED' || state.waStatus === 'ready';
  const isQRReady = state.waStatus === 'SCAN_QR' || state.waStatus === 'qr' || state.waStatus === 'qr_ready';

  console.log(`%c[UI Action] Connection toggle clicked. ConnectedState: ${isConnected}, QRState: ${isQRReady}`, 'color: #3b82f6; font-weight: bold;');

  if (isConnected || isQRReady) {
    const confirmMsg = isConnected 
      ? 'Are you sure you want to disconnect from WhatsApp?' 
      : 'Are you sure you want to cancel the connection process?';
      
    if (confirm(confirmMsg)) {
      state.isTransitioning = true;
      btnToggleConnection.disabled = true;
      btnToggleConnection.textContent = 'Disconnecting...';
      try {
        waStatusBadge.textContent = 'Disconnecting...';
        showToast('Disconnecting WhatsApp session...', 'info');
        await fetch(`${API_BASE}/session/disconnect`, { method: 'POST' });
        console.log('%c[WA Connection] Disconnect request sent successfully.', 'color: #ef4444; font-weight: bold;');
      } catch (err) {
        console.error('Error disconnecting:', err);
        showToast('Failed to request disconnect.', 'error');
      } finally {
        state.isTransitioning = false;
        checkWAStatus();
      }
    }
  } else {
    state.isTransitioning = true;
    btnToggleConnection.disabled = true;
    btnToggleConnection.textContent = 'Connecting...';
    try {
      waStatusBadge.textContent = 'Connecting...';
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text">Initializing session browser...</span>';
      showToast('WhatsApp engine initialization started.', 'info');
      await fetch(`${API_BASE}/session/connect`, { method: 'POST' });
      console.log('%c[WA Connection] Connect request sent successfully.', 'color: #10b981; font-weight: bold;');
    } catch (err) {
      console.error('Error connecting:', err);
      showToast('Failed to start WhatsApp engine.', 'error');
    } finally {
      state.isTransitioning = false;
      checkWAStatus();
    }
  }
}

async function forceResetConnection() {
  if (!confirm('Are you sure you want to perform a Force Reset?\n\nThis will stop the active browser, delete cached file locks, and request a fresh QR code.')) {
    return;
  }

  console.log('%c[UI Action] Force Reset clicked. Destroying session locks...', 'color: #ef4444; font-weight: bold;');
  state.isTransitioning = true;
  btnToggleConnection.disabled = true;
  btnToggleConnection.textContent = 'Resetting...';
  btnForceReset.classList.add('hidden');
  btnHeaderForceReset.classList.add('hidden');

  try {
    qrImage.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    qrPlaceholder.innerHTML = '<span class="qr-placeholder-text">⏳ Cleaning cache and killing browser locks... please wait.</span>';
    
    showToast('Clearing locks and resetting browser...', 'info');
    const res = await fetch(`${API_BASE}/session/reset`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-success">✅ Reset completed! Re-initializing WhatsApp...</span>';
      showToast('Browser reset initiated successfully!', 'success');
      console.log('%c[WA Connection] Force Reset triggered successfully.', 'color: #10b981; font-weight: bold;');
    } else {
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-warning">⚠️ Reset finished with warnings. Checking status...</span>';
      showToast('Browser reset completed with warnings.', 'info');
    }
  } catch (err) {
    console.error('Error during force reset:', err);
    qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-danger">❌ Reset failed. Retrying connection...</span>';
    showToast('Failed to trigger browser reset.', 'error');
  } finally {
    state.connectingTime = 0;
    // Wait 1.5 seconds so the user can read the status message
    setTimeout(() => {
      state.isTransitioning = false;
      checkWAStatus();
    }, 1500);
  }
}

// ==========================================
// GATEWAY SETTINGS MANAGEMENT
// ==========================================

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    const data = await res.json();
    settingsUrl.value = data.openwa_url || '';
    settingsKey.value = data.api_key || '';
    console.log('%c[Settings] Settings loaded from database.', 'color: #eab308; font-weight: bold;');
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings() {
  const url = settingsUrl.value.trim();
  const key = settingsKey.value.trim();

  console.log(`%c[UI Action] Save Settings clicked. URL: ${url}`, 'color: #eab308; font-weight: bold;');

  if (!url || !key) {
    showToast('Please fill in both URL and API Key.', 'error');
    return;
  }

  try {
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = 'Saving...';
    
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openwa_url: url, api_key: key })
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Gateway Settings saved successfully!', 'success');
      console.log('%c[Settings] Saved settings to SQLite.', 'color: #10b981; font-weight: bold;');
    } else {
      showToast(data.error || 'Failed to save settings.', 'error');
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    showToast('Failed to save settings.', 'error');
  } finally {
    btnSaveSettings.disabled = false;
    btnSaveSettings.textContent = 'Save Settings';
    checkWAStatus();
  }
}

// ==========================================
// TEMPLATES MANAGEMENT
// ==========================================

async function loadTemplates() {
  try {
    const res = await fetch(`${API_BASE}/templates`);
    state.templates = await res.json();
    console.log(`%c[Templates] Loaded ${state.templates.length} templates from SQLite.`, 'color: #ec4899; font-weight: bold;');
    
    // Fill select dropdown
    templateSelect.innerHTML = '';
    state.templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      templateSelect.appendChild(opt);
    });

    if (state.templates.length > 0) {
      // Select first
      selectTemplate(state.templates[0].id);
    } else {
      initNewTemplate();
    }
  } catch (error) {
    console.error('Failed to load templates:', error);
  }
}

function selectTemplate(id) {
  state.selectedTemplateId = id;
  templateSelect.value = id;
  const tpl = state.templates.find(t => t.id === id);
  if (tpl) {
    templateName.value = tpl.name;
    templateContent.value = tpl.content;
    console.log(`%c[Templates] Selected template: ${tpl.name} (${id})`, 'color: #ec4899; font-weight: bold;');
    updatePreview();
  }
}

function initNewTemplate() {
  state.selectedTemplateId = '';
  templateName.value = '';
  templateContent.value = '';
  console.log('%c[Templates] Initialized new blank template editor.', 'color: #ec4899; font-weight: bold;');
  updatePreview();
  templateName.focus();
}

async function saveTemplate() {
  const name = templateName.value.trim();
  const content = templateContent.value.trim();

  console.log(`%c[UI Action] Save Template clicked. Name: ${name}`, 'color: #ec4899; font-weight: bold;');

  if (!name || !content) {
    showToast('Please enter both a template name and template content.', 'error');
    return;
  }

  const payload = {
    name,
    content
  };
  if (state.selectedTemplateId) {
    payload.id = state.selectedTemplateId;
  }

  try {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const saved = await res.json();
    showToast('Template saved successfully!', 'success');
    console.log(`%c[Templates] Template saved. ID: ${saved.id}`, 'color: #10b981; font-weight: bold;');
    await loadTemplates();
    selectTemplate(saved.id);
  } catch (error) {
    showToast('Failed to save template.', 'error');
  }
}

async function deleteTemplate() {
  if (!state.selectedTemplateId) return;
  if (!confirm('Are you sure you want to delete this template?')) return;

  console.log(`%c[UI Action] Delete Template clicked. ID: ${state.selectedTemplateId}`, 'color: #ef4444; font-weight: bold;');

  try {
    await fetch(`${API_BASE}/templates/${state.selectedTemplateId}`, { method: 'DELETE' });
    showToast('Template deleted successfully.', 'success');
    console.log('%c[Templates] Template deleted successfully.', 'color: #10b981; font-weight: bold;');
    await loadTemplates();
  } catch (error) {
    showToast('Failed to delete template.', 'error');
  }
}

function updatePreview() {
  const content = templateContent.value;
  let sampleName = 'Rahul';
  
  if (state.uploadedLeads.length > 0) {
    sampleName = state.uploadedLeads[0].name || 'Client';
  }

  previewSampleName.textContent = sampleName;
  
  if (!content) {
    previewText.textContent = 'Write template content to see a preview.';
    return;
  }

  // Personalize preview
  const personalized = content.replace(/\{\{\s*name\s*\}\}/gi, sampleName);
  previewText.textContent = personalized;
}

// ==========================================
// FILE UPLOAD AND PARSING
// ==========================================

async function handleFileSelect() {
  const file = fileInput.files[0];
  if (!file) return;

  console.log(`%c[UI Action] File selected: ${file.name} (${file.size} bytes). Uploading...`, 'color: #10b981; font-weight: bold;');
  fileInfoText.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  
  const formData = new FormData();
  formData.append('file', file);

  try {
    fileInfoText.textContent = 'Processing file...';
    const res = await fetch(`${API_BASE}/bulk/upload`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to parse file.');
    }

    const data = await res.json();
    state.uploadedLeads = data.leads;
    
    // Update dashboard campaign state
    readyTotalCount.textContent = data.count;
    campaignReadySection.classList.remove('hidden');
    campaignProgressSection.classList.add('hidden');
    
    showToast(`Successfully parsed ${data.count} leads from file!`, 'success');
    console.log(`%c[File Upload] Successfully parsed ${data.count} rows from spreadsheet.`, 'color: #10b981; font-weight: bold;', data.leads);
    updatePreview();
  } catch (error) {
    showToast(error.message, 'error');
    console.error('%c[File Upload] Upload/Parse error:', 'color: #ef4444; font-weight: bold;', error.message);
    fileInfoText.textContent = 'Error parsing file';
    state.uploadedLeads = [];
    campaignReadySection.classList.add('hidden');
  }
}

// ==========================================
// CAMPAIGN EXECUTION & HISTORY
// ==========================================

async function startCampaign() {
  console.log('%c[UI Action] Start Campaign clicked.', 'color: #10b981; font-weight: bold;');

  if (state.uploadedLeads.length === 0) {
    showToast('Please upload a leads file first.', 'error');
    return;
  }
  if (!state.selectedTemplateId) {
    showToast('Please select or create a template.', 'error');
    return;
  }
  if (state.waStatus !== 'CONNECTED' && state.waStatus !== 'ready') {
    showToast('WhatsApp is not connected. Please go to Settings tab to connect first.', 'error');
    return;
  }

  const delay = parseInt(delayInput.value, 10) || 5;
  console.log(`%c[Campaign] Triggering campaign. Leads Count: ${state.uploadedLeads.length}, Template ID: ${state.selectedTemplateId}, Delay: ${delay}s`, 'color: #10b981; font-weight: bold;');

  try {
    const res = await fetch(`${API_BASE}/bulk/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: state.selectedTemplateId,
        leads: state.uploadedLeads,
        delaySeconds: delay
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start campaign.');
    }

    showToast('Campaign successfully started!', 'success');

    // Switch view
    campaignReadySection.classList.add('hidden');
    campaignProgressSection.classList.remove('hidden');

    // Start polling campaign progress
    pollCampaignProgress();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function pollCampaignProgress() {
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  
  console.log('%c[Campaign] Starting progress telemetry polling interval (1500ms)...', 'color: #10b981; font-weight: bold;');

  state.pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/bulk/status`);
      const data = await res.json();

      updateCampaignProgress(data);

      if (!data.isSending && data.status !== 'SENDING') {
        console.log(`%c[Campaign] Polling stopped. Final campaign status: ${data.status}`, 'color: #10b981; font-weight: bold;');
        clearInterval(state.pollingInterval);
        state.pollingInterval = null;
        
        if (data.status === 'COMPLETED') {
          showToast('Campaign completed successfully!', 'success');
        } else if (data.status === 'CANCELLED') {
          showToast('Campaign was cancelled.', 'info');
        } else if (data.status === 'PAUSED') {
          showToast('Campaign paused due to WhatsApp disconnection.', 'error');
        }
        
        loadCampaignHistory();
      }
    } catch (err) {
      console.error('Error polling progress:', err);
    }
  }, 1500);
}

function updateCampaignProgress(data) {
  if (!data.batchId) {
    campaignProgressSection.classList.add('hidden');
    return;
  }

  // Update numbers
  progressTotal.textContent = data.totalLeads;
  progressSent.textContent = data.sentCount;
  progressFailed.textContent = data.failedCount;
  progressPending.textContent = data.pendingCount;
  progressStatusText.textContent = data.status;

  // Update progress bar
  const pct = data.totalLeads > 0 ? ((data.sentCount + data.failedCount) / data.totalLeads) * 100 : 0;
  progressBarFill.style.width = `${pct}%`;

  // Render logs table
  renderLogs(data.leads || []);
}

function renderLogs(leads) {
  if (leads.length === 0) {
    logsTbody.innerHTML = `<tr><td colspan="5" class="no-logs">No log data.</td></tr>`;
    return;
  }

  logsTbody.innerHTML = '';

  // DOM Optimization: Limit rendering to the last 30 entries during active runs
  // to avoid lag and CPU overhead on lists with 100+ items.
  const maxLogs = 30;
  const isLarge = leads.length > maxLogs;
  const leadsToRender = isLarge ? leads.slice(leads.length - maxLogs) : leads;

  if (isLarge) {
    const infoTr = document.createElement('tr');
    infoTr.innerHTML = `
      <td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 8px; background: rgba(255,255,255,0.02)">
        Showing last ${maxLogs} logs. Previous ${leads.length - maxLogs} transmissions are running in the background.
      </td>
    `;
    logsTbody.appendChild(infoTr);
  }

  leadsToRender.forEach(l => {
    const tr = document.createElement('tr');
    
    // Status color
    let statusClass = 'text-muted';
    if (l.status === 'SENT') statusClass = 'text-success';
    if (l.status === 'FAILED') statusClass = 'text-danger';

    const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-';

    tr.innerHTML = `
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>${escapeHtml(l.phone)}</td>
      <td><span class="${statusClass}">${l.status}</span></td>
      <td>${timeStr}</td>
      <td><span class="text-muted small">${l.error ? escapeHtml(l.error) : (l.status === 'SENT' ? 'Delivered' : '-')}</span></td>
    `;
    logsTbody.appendChild(tr);
  });
}

async function cancelCampaign() {
  if (!confirm('Are you sure you want to cancel the campaign?')) return;
  
  console.log('%c[UI Action] Cancel Campaign clicked.', 'color: #ef4444; font-weight: bold;');

  try {
    await fetch(`${API_BASE}/bulk/cancel`, { method: 'POST' });
    showToast('Campaign cancellation requested...', 'info');
  } catch (error) {
    showToast('Failed to cancel campaign.', 'error');
  }
}

async function checkActiveCampaign() {
  try {
    const res = await fetch(`${API_BASE}/bulk/status`);
    const data = await res.json();
    if (data.batchId) {
      console.log(`%c[Campaign] Found active campaign in database on reload. Batch ID: ${data.batchId}`, 'color: #10b981; font-weight: bold;');
      campaignReadySection.classList.add('hidden');
      campaignProgressSection.classList.remove('hidden');
      updateCampaignProgress(data);
      if (data.status === 'SENDING' || data.isSending) {
        pollCampaignProgress();
      }
    }
  } catch (err) {
    console.error('Error checking active campaign:', err);
  }
}

async function loadCampaignHistory() {
  try {
    const res = await fetch(`${API_BASE}/bulk/batches`);
    const batches = await res.json();
    state.batches = batches;
    console.log(`%c[History] Loaded ${batches.length} past campaign batches from SQLite.`, 'color: #3b82f6; font-weight: bold;');

    if (batches.length === 0) {
      historyTbody.innerHTML = `
        <tr>
          <td colspan="6" class="no-history" style="text-align: center; color: var(--text-muted); padding: 16px;">
            No past campaigns available.
          </td>
        </tr>
      `;
      return;
    }

    historyTbody.innerHTML = '';
    batches.forEach(b => {
      const tr = document.createElement('tr');
      const dateStr = new Date(b.createdAt).toLocaleString();
      
      let statusClass = 'text-muted';
      if (b.status === 'COMPLETED') statusClass = 'text-success';
      if (b.status === 'CANCELLED') statusClass = 'text-danger';
      if (b.status === 'SENDING') statusClass = 'text-primary';

      tr.innerHTML = `
        <td>${dateStr}</td>
        <td><strong>${b.totalLeads}</strong></td>
        <td><span class="text-success">${b.sentCount}</span></td>
        <td><span class="text-danger">${b.failedCount}</span></td>
        <td><span class="${statusClass}">${b.status}</span></td>
        <td>
          <a href="${API_BASE}/bulk/batches/${b.id}/export" class="btn btn-sm btn-secondary" style="text-decoration:none; display:inline-block; text-align:center;">Download CSV</a>
        </td>
      `;
      historyTbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load campaign history:', err);
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
