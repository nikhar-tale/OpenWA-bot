// Configuration
const API_BASE = '/api';

// State
let state = {
  templates: [],
  selectedTemplateId: '',
  uploadedLeads: [],
  activeCampaign: null,
  waStatus: 'DISCONNECTED',
  pollingInterval: null,
  connectingTime: 0, // Track duration in initializing/authenticating state
  batches: []
};

// DOM Elements
const waStatusBadge = document.getElementById('wa-status-badge');
const btnToggleConnection = document.getElementById('btn-toggle-connection');
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
  // Connection
  btnToggleConnection.addEventListener('click', toggleConnection);
  btnForceReset.addEventListener('click', forceResetConnection);

  // Settings
  btnSaveSettings.addEventListener('click', saveSettings);

  // Templates
  templateSelect.addEventListener('change', (e) => {
    selectTemplate(e.target.value);
  });
  btnNewTemplate.addEventListener('click', initNewTemplate);
  btnSaveTemplate.addEventListener('click', saveTemplate);
  btnDeleteTemplate.addEventListener('click', deleteTemplate);
  templateContent.addEventListener('input', updatePreview);

  // File Upload
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  
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
      fileInput.files = e.dataTransfer.files;
      handleFileSelect();
    }
  });

  // Campaign
  btnStartCampaign.addEventListener('click', startCampaign);
  btnCancelCampaign.addEventListener('click', cancelCampaign);
}

// ==========================================
// WHATSAPP GATEWAY CONNECTION
// ==========================================

async function checkWAStatus() {
  try {
    const res = await fetch(`${API_BASE}/session/status`);
    const data = await res.json();
    state.waStatus = data.status;

    // Update status badge
    waStatusBadge.textContent = data.status;
    waStatusBadge.className = 'badge';

    // Track connecting duration to show Force Reset if it gets stuck
    if (data.status === 'initializing' || data.status === 'authenticating') {
      state.connectingTime += 5;
      if (state.connectingTime >= 60) {
        btnForceReset.classList.remove('hidden');
      }
    } else {
      state.connectingTime = 0;
      btnForceReset.classList.add('hidden');
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
  const isConnected = state.waStatus === 'CONNECTED' || state.waStatus === 'ready';
  const isQRReady = state.waStatus === 'SCAN_QR' || state.waStatus === 'qr' || state.waStatus === 'qr_ready';

  if (isConnected || isQRReady) {
    const confirmMsg = isConnected 
      ? 'Are you sure you want to disconnect from WhatsApp?' 
      : 'Are you sure you want to cancel the connection process?';
      
    if (confirm(confirmMsg)) {
      try {
        waStatusBadge.textContent = 'Disconnecting...';
        await fetch(`${API_BASE}/session/disconnect`, { method: 'POST' });
      } catch (err) {
        console.error('Error disconnecting:', err);
      } finally {
        checkWAStatus();
      }
    }
  } else {
    try {
      waStatusBadge.textContent = 'Connecting...';
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text">Initializing session browser...</span>';
      await fetch(`${API_BASE}/session/connect`, { method: 'POST' });
    } catch (err) {
      console.error('Error connecting:', err);
    } finally {
      checkWAStatus();
    }
  }
}

async function forceResetConnection() {
  if (!confirm('Are you sure you want to perform a Force Reset?\n\nThis will stop the active browser, delete cached file locks, and request a fresh QR code.')) {
    return;
  }

  try {
    btnForceReset.classList.add('hidden');
    qrImage.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    qrPlaceholder.innerHTML = '<span class="qr-placeholder-text">⏳ Cleaning cache and killing browser locks... please wait.</span>';
    
    const res = await fetch(`${API_BASE}/session/reset`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-success">✅ Reset completed! Re-initializing WhatsApp...</span>';
    } else {
      qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-warning">⚠️ Reset finished with warnings. Checking status...</span>';
    }
  } catch (err) {
    console.error('Error during force reset:', err);
    qrPlaceholder.innerHTML = '<span class="qr-placeholder-text text-danger">❌ Reset failed. Retrying connection...</span>';
  } finally {
    state.connectingTime = 0;
    // Wait 1.5 seconds so the user can read the status message
    setTimeout(() => {
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
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings() {
  const url = settingsUrl.value.trim();
  const key = settingsKey.value.trim();

  if (!url || !key) {
    showSettingsMessage('Please fill in both URL and API Key.', 'text-danger');
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
      showSettingsMessage('Settings saved successfully!', 'text-success');
    } else {
      showSettingsMessage(data.error || 'Failed to save settings.', 'text-danger');
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    showSettingsMessage('Failed to save settings.', 'text-danger');
  } finally {
    btnSaveSettings.disabled = false;
    btnSaveSettings.textContent = 'Save Settings';
    checkWAStatus();
  }
}

function showSettingsMessage(msg, className) {
  settingsMsg.innerHTML = `<span class="${className}">${msg}</span>`;
  settingsMsg.classList.remove('hidden');
  setTimeout(() => {
    settingsMsg.classList.add('hidden');
  }, 4000);
}

// ==========================================
// TEMPLATES MANAGEMENT
// ==========================================

async function loadTemplates() {
  try {
    const res = await fetch(`${API_BASE}/templates`);
    state.templates = await res.json();
    
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
    updatePreview();
  }
}

function initNewTemplate() {
  state.selectedTemplateId = '';
  templateName.value = '';
  templateContent.value = '';
  updatePreview();
  templateName.focus();
}

async function saveTemplate() {
  const name = templateName.value.trim();
  const content = templateContent.value.trim();

  if (!name || !content) {
    alert('Please enter both a template name and template content.');
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
    alert('Template saved successfully!');
    await loadTemplates();
    selectTemplate(saved.id);
  } catch (error) {
    alert('Failed to save template.');
  }
}

async function deleteTemplate() {
  if (!state.selectedTemplateId) return;
  if (!confirm('Are you sure you want to delete this template?')) return;

  try {
    await fetch(`${API_BASE}/templates/${state.selectedTemplateId}`, { method: 'DELETE' });
    alert('Template deleted.');
    await loadTemplates();
  } catch (error) {
    alert('Failed to delete template.');
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
    
    updatePreview();
  } catch (error) {
    alert(error.message);
    fileInfoText.textContent = 'Error parsing file';
    state.uploadedLeads = [];
    campaignReadySection.classList.add('hidden');
  }
}

// ==========================================
// CAMPAIGN EXECUTION & HISTORY
// ==========================================

async function startCampaign() {
  if (state.uploadedLeads.length === 0) {
    alert('Please upload a leads file first.');
    return;
  }
  if (!state.selectedTemplateId) {
    alert('Please select or create a template.');
    return;
  }
  if (state.waStatus !== 'CONNECTED' && state.waStatus !== 'ready') {
    alert('WhatsApp is not connected. Please scan the QR code and connect first.');
    return;
  }

  const delay = parseInt(delayInput.value, 10) || 5;

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

    // Switch view
    campaignReadySection.classList.add('hidden');
    campaignProgressSection.classList.remove('hidden');

    // Start polling campaign progress
    pollCampaignProgress();
  } catch (error) {
    alert(error.message);
  }
}

function pollCampaignProgress() {
  if (state.pollingInterval) clearInterval(state.pollingInterval);

  state.pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/bulk/status`);
      const data = await res.json();

      updateCampaignProgress(data);

      if (!data.isSending && data.status !== 'SENDING') {
        clearInterval(state.pollingInterval);
        state.pollingInterval = null;
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
  
  try {
    await fetch(`${API_BASE}/bulk/cancel`, { method: 'POST' });
    alert('Campaign cancellation requested.');
  } catch (error) {
    alert('Failed to cancel campaign.');
  }
}

async function checkActiveCampaign() {
  try {
    const res = await fetch(`${API_BASE}/bulk/status`);
    const data = await res.json();
    if (data.batchId) {
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
