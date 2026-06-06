// Configuration
const API_BASE = '/api';

// Helper to truncate large telemetry bodies (like leads lists) to prevent console lag
function truncateTelemetryPayload(payload) {
  if (!payload) return payload;
  if (typeof payload !== 'object') {
    if (typeof payload === 'string' && payload.length > 300) {
      return payload.substring(0, 300) + '... [TRUNCATED]';
    }
    return payload;
  }
  
  if (Array.isArray(payload)) {
    if (payload.length > 5) {
      return [
        ...payload.slice(0, 5).map(item => truncateTelemetryPayload(item)),
        `... [TRUNCATED ${payload.length - 5} items]`
      ];
    }
    return payload.map(item => truncateTelemetryPayload(item));
  }
  
  const truncatedObj = {};
  for (const key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const val = payload[key];
      if (key === 'leads' && Array.isArray(val) && val.length > 5) {
        truncatedObj[key] = [
          ...val.slice(0, 5).map(item => truncateTelemetryPayload(item)),
          `... [TRUNCATED ${val.length - 5} leads]`
        ];
      } else if (typeof val === 'string' && val.length > 300) {
        truncatedObj[key] = val.substring(0, 300) + '... [TRUNCATED]';
      } else if (val && typeof val === 'object') {
        truncatedObj[key] = truncateTelemetryPayload(val);
      } else {
        truncatedObj[key] = val;
      }
    }
  }
  return truncatedObj;
}

// Custom accessible async confirmation modal system
function showConfirmModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal-card';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    
    const isWarning = title.toLowerCase().includes('delete') || title.toLowerCase().includes('reset') || title.toLowerCase().includes('cancel');
    const confirmBtnClass = isWarning ? 'btn btn-danger btn-confirm' : 'btn btn-primary btn-confirm';
    
    modal.innerHTML = `
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="modal-body">
        <p>${message.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-cancel">${escapeHtml(cancelText)}</button>
        <button class="${confirmBtnClass}">${escapeHtml(confirmText)}</button>
      </div>
    `;
    
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
    
    const confirmBtn = modal.querySelector('.btn-confirm');
    const cancelBtn = modal.querySelector('.btn-cancel');
    
    confirmBtn.focus();
    
    confirmBtn.addEventListener('click', () => {
      modalOverlay.remove();
      resolve(true);
    });
    
    cancelBtn.addEventListener('click', () => {
      modalOverlay.remove();
      resolve(false);
    });
    
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        modalOverlay.remove();
        document.removeEventListener('keydown', handleKeyDown);
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
  });
}

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
      body: options.body ? (typeof options.body === 'string' ? truncateTelemetryPayload(JSON.parse(options.body)) : truncateTelemetryPayload(options.body)) : undefined
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

      console.log(`%c[UI API Res] ${timestamp} - INCOMING 🞨 ${method} ${url} ➔ Status: ${res.status} (${duration}ms)`, 'color: #34d399; font-weight: bold; background: #064e3b; padding: 2px 6px; border-radius: 3px;', truncateTelemetryPayload(responseBody));
      return res;
    } catch (error) {
      const duration = (performance.now() - start).toFixed(1);
      console.log(`%c[UI API Err] ${timestamp} - FAILED 🞨 ${method} ${url} (${duration}ms) ➔ Error: ${error.message}`, 'color: #f43f5e; font-weight: bold; background: #4c0519; padding: 2px 6px; border-radius: 3px;');
      throw error;
    }
  }
};

// State
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
  batches: [],
  messageType: 'text',
  mediaPath: null,
  mediaMimetype: null,
  mediaFilename: null,
  mediaSize: 0,
  mediaFiles: [],
  testMessageType: 'text',
  testMediaPath: null,
  testMediaMimetype: null,
  testMediaFilename: null,
  testMediaSize: 0,
  testMediaFiles: [],
  tplMessageType: 'text',
  tplMediaPath: null,
  tplMediaMimetype: null,
  tplMediaFilename: null,
  tplMediaSize: 0,
  tplMediaFiles: []
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
const settingsHfToken = document.getElementById('settings-hf-token');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsMsg = document.getElementById('settings-msg');

// Test Sender Elements
const testNumbersInput = document.getElementById('test-numbers');
const testMessageInput = document.getElementById('test-message');
const btnSendTest = document.getElementById('btn-send-test');
const testStatusMsg = document.getElementById('test-status-msg');

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

// Media UI Elements
const messageTypeSelect = document.getElementById('message-type-select');
const mediaUploadWrapper = document.getElementById('media-upload-wrapper');
const mediaDropZone = document.getElementById('media-drop-zone');
const mediaFileInput = document.getElementById('media-file-input');
const mediaFilesContainer = document.getElementById('media-files-container');
const mediaFilesSummary = document.getElementById('media-files-summary');
const mediaFilesList = document.getElementById('media-files-list');

// Quick Test Media UI Elements
const testMessageTypeSelect = document.getElementById('test-message-type-select');
const testMediaUploadWrapper = document.getElementById('test-media-upload-wrapper');
const testMediaDropZone = document.getElementById('test-media-drop-zone');
const testMediaFileInput = document.getElementById('test-media-file-input');
const testMediaFilesContainer = document.getElementById('test-media-files-container');
const testMediaFilesSummary = document.getElementById('test-media-files-summary');
const testMediaFilesList = document.getElementById('test-media-files-list');

// Template Media UI Elements
const tplMessageTypeSelect = document.getElementById('tpl-message-type-select');
const tplMediaUploadWrapper = document.getElementById('tpl-media-upload-wrapper');
const tplMediaDropZone = document.getElementById('tpl-media-drop-zone');
const tplMediaFileInput = document.getElementById('tpl-media-file-input');
const tplMediaFilesContainer = document.getElementById('tpl-media-files-container');
const tplMediaFilesSummary = document.getElementById('tpl-media-files-summary');
const tplMediaFilesList = document.getElementById('tpl-media-files-list');
const btnDuplicateTemplate = document.getElementById('btn-duplicate-template');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('%c[App Init] Initializing dashboard client controllers...', 'color: #6366f1; font-weight: bold; font-size: 14px;');
  setupEventListeners();
  loadSettings();
  checkWAStatus();
  loadTemplates();
  loadCampaignHistory();
  checkActiveCampaign();
  
  // Periodically check WhatsApp status (only when tab is active/visible to save resources)
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkWAStatus();
    }
  }, 5000);

  // Instantly refresh WhatsApp status when user focuses back on the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('%c[UI Focus] Tab visible, refreshing system status...', 'color: #6366f1; font-size: 11px;');
      checkWAStatus();
    }
  });
});

// Event Listeners
// Reusable helper to configure drag & drop event handling
function setupDragAndDrop(dropZone, fileInput, dropCallback, logMessage) {
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      if (logMessage) {
        console.log(`%c[UI Event] Drop: ${logMessage}`, 'color: #06b6d4; font-weight: bold; background: #083344; padding: 2px 6px; border-radius: 3px;');
      }
      fileInput.files = e.dataTransfer.files;
      dropCallback();
    }
  });
}

function setupEventListeners() {
  // Tab switching logic
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const activeTab = document.querySelector('.nav-tab.active');
      if (activeTab) {
        activeTab.classList.remove('active');
        activeTab.setAttribute('aria-selected', 'false');
      }
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
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

  // Test Sender
  btnSendTest.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Send Test Message Clicked', 'color: #3b82f6; font-weight: bold; background: #172554; padding: 2px 6px; border-radius: 3px;');
    sendTestMessage();
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
  setupDragAndDrop(uploadZone, fileInput, handleFileSelect, 'Leads spreadsheet dropped onto zone');

  // Campaign
  btnStartCampaign.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Start Campaign Clicked', 'color: #10b981; font-weight: bold; background: #064e3b; padding: 2px 6px; border-radius: 3px;');
    startCampaign();
  });
  btnCancelCampaign.addEventListener('click', () => {
    console.log('%c[UI Event] Button Tap: Cancel Campaign Clicked', 'color: #ef4444; font-weight: bold; background: #450a0a; padding: 2px 6px; border-radius: 3px;');
    cancelCampaign();
  });

  // Message Type Selection
  messageTypeSelect.addEventListener('change', (e) => {
    const type = e.target.value;
    state.messageType = type;
    if (type === 'text') {
      mediaUploadWrapper.classList.add('hidden');
    } else {
      mediaUploadWrapper.classList.remove('hidden');
      renderCampaignFiles();
    }
  });

  // Media File Upload Click/Change
  mediaDropZone.addEventListener('click', () => {
    mediaFileInput.click();
  });
  mediaFileInput.addEventListener('change', () => {
    handleMediaFileSelect();
  });

  // Drag and Drop for Media
  setupDragAndDrop(mediaDropZone, mediaFileInput, handleMediaFileSelect, 'Campaign media files dropped');

  // Quick Test Message Type Selection
  testMessageTypeSelect.addEventListener('change', (e) => {
    const type = e.target.value;
    state.testMessageType = type;
    if (type === 'text') {
      testMediaUploadWrapper.classList.add('hidden');
    } else {
      testMediaUploadWrapper.classList.remove('hidden');
      renderTestFiles();
    }
  });

  // Quick Test Media File Upload Click/Change
  testMediaDropZone.addEventListener('click', () => {
    testMediaFileInput.click();
  });
  testMediaFileInput.addEventListener('change', () => {
    handleTestMediaFileSelect();
  });

  // Drag and Drop for Quick Test Media
  setupDragAndDrop(testMediaDropZone, testMediaFileInput, handleTestMediaFileSelect, 'Quick test media files dropped');

  // Template Message Type Selection
  tplMessageTypeSelect.addEventListener('change', (e) => {
    const type = e.target.value;
    state.tplMessageType = type;
    if (type === 'text') {
      tplMediaUploadWrapper.classList.add('hidden');
    } else {
      tplMediaUploadWrapper.classList.remove('hidden');
      renderTplFiles();
    }
  });

  // Template Media File Upload Click/Change
  tplMediaDropZone.addEventListener('click', () => {
    tplMediaFileInput.click();
  });
  tplMediaFileInput.addEventListener('change', () => {
    handleTplMediaFileSelect();
  });

  // Drag and Drop for Template Media
  setupDragAndDrop(tplMediaDropZone, tplMediaFileInput, handleTplMediaFileSelect, 'Template media files dropped');

  // Duplicate Template
  btnDuplicateTemplate.addEventListener('click', () => {
    duplicateTemplate();
  });

  // Keyboard Shortcuts (Alt + 1-4 for Tabs, Ctrl + N for New Template, Ctrl + S for Save Template)
  document.addEventListener('keydown', (e) => {
    // Tab switching: Alt + 1, Alt + 2, Alt + 3, Alt + 4
    if (e.altKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const tabKeys = ['dispatcher', 'templates', 'history', 'settings'];
      const targetTab = tabKeys[parseInt(e.key) - 1];
      const tabButton = document.querySelector(`.nav-tab[data-tab="${targetTab}"]`);
      if (tabButton) {
        tabButton.click();
      }
    }

    // New Template: Ctrl + N or Cmd + N (when on templates tab)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      const activeTab = document.querySelector('.nav-tab.active');
      if (activeTab && activeTab.getAttribute('data-tab') === 'templates') {
        e.preventDefault();
        btnNewTemplate.click();
      }
    }

    // Save Template: Ctrl + S or Cmd + S (when on templates tab)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      const activeTab = document.querySelector('.nav-tab.active');
      if (activeTab && activeTab.getAttribute('data-tab') === 'templates') {
        e.preventDefault();
        btnSaveTemplate.click();
      }
    }
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
          statusMsg += `<br><span class="text-danger small status-msg-detail">⚠️ Connection taking longer than usual. You can wait or click Force Reset below.</span>`;
        } else if (state.connectingTime >= 30) {
          statusMsg += `<br><span class="text-warning small status-msg-detail">⏳ WhatsApp Web is loading chats... (usually takes 30-45 seconds).</span>`;
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
    const confirmTitle = isConnected ? 'Disconnect WhatsApp' : 'Cancel Connection';
    const confirmMsg = isConnected 
      ? 'Are you sure you want to disconnect from WhatsApp? Active campaign transmissions will pause.' 
      : 'Are you sure you want to cancel the connection process?';
      
    if (await showConfirmModal(confirmTitle, confirmMsg, isConnected ? 'Disconnect' : 'Cancel Link')) {
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
  if (!(await showConfirmModal(
    'Force Reset Connection',
    'Are you sure you want to perform a Force Reset?\n\nThis will stop the active browser, delete cached file locks, and request a fresh QR code.',
    'Force Reset'
  ))) {
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
    settingsHfToken.value = data.hf_token || '';
    console.log('%c[Settings] Settings loaded from database.', 'color: #eab308; font-weight: bold;');
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings() {
  const url = settingsUrl.value.trim();
  const key = settingsKey.value.trim();
  const hfToken = settingsHfToken.value.trim();

  console.log(`%c[UI Action] Save Settings clicked. URL: ${url}`, 'color: #eab308; font-weight: bold;');

  if (!url || !key) {
    showToast('Please fill in both URL and API Key.', 'error');
    return;
  }

  try {
    btnSaveSettings.disabled = true;
    btnSaveSettings.innerHTML = '<span aria-hidden="true">⏳</span> Saving...';
    
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openwa_url: url, api_key: key, hf_token: hfToken })
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
    btnSaveSettings.innerHTML = '<span aria-hidden="true">💾</span> Save Settings';
    checkWAStatus();
  }
}

async function handleTestMediaFileSelect() {
  const selectedFiles = Array.from(testMediaFileInput.files);
  if (selectedFiles.length === 0) return;

  console.log(`%c[Test Media Upload] ${selectedFiles.length} files selected.`, 'color: #10b981; font-weight: bold;');

  const maxSizeBytes = 20 * 1024 * 1024; // 20MB per file
  const maxCombinedBytes = 50 * 1024 * 1024; // 50MB combined
  
  if (state.testMediaFiles.length + selectedFiles.length > 10) {
    showToast('Maximum of 10 media files can be attached.', 'error');
    testMediaFileInput.value = '';
    return;
  }

  for (const file of selectedFiles) {
    if (file.size > maxSizeBytes) {
      showToast(`File "${file.name}" exceeds the 20MB limit.`, 'error');
      testMediaFileInput.value = '';
      return;
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    let allowed = [];
    if (state.testMessageType === 'image') allowed = ['.jpg', '.jpeg', '.png'];
    else if (state.testMessageType === 'pdf') allowed = ['.pdf'];
    else if (state.testMessageType === 'video') allowed = ['.mp4'];
    else if (state.testMessageType === 'audio') allowed = ['.mp3'];

    if (!allowed.includes(ext)) {
      showToast(`Invalid file type for "${file.name}". For ${state.testMessageType}, please upload: ${allowed.join(', ')}`, 'error');
      testMediaFileInput.value = '';
      return;
    }
  }

  const currentTotal = state.testMediaFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const newTotal = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  if (currentTotal + newTotal > maxCombinedBytes) {
    showToast('Combined file size exceeds the 50MB limit.', 'error');
    testMediaFileInput.value = '';
    return;
  }

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append('media', file);
  });

  try {
    showToast('Uploading test media file(s)...', 'info');
    const res = await fetch(`${API_BASE}/upload-media`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to upload media.');
    }

    const data = await res.json();
    const uploadedFiles = data.files || [data];
    
    state.testMediaFiles = state.testMediaFiles.concat(uploadedFiles);
    
    state.testMediaPath = state.testMediaFiles[0].path;
    state.testMediaMimetype = state.testMediaFiles[0].mimetype;
    state.testMediaFilename = state.testMediaFiles[0].filename;
    state.testMediaSize = state.testMediaFiles[0].size;

    showToast('Test media uploaded successfully!', 'success');
    renderTestFiles();
  } catch (error) {
    showToast(error.message, 'error');
    console.error('%c[Test Media Upload] Error:', 'color: #ef4444; font-weight: bold;', error.message);
  } finally {
    testMediaFileInput.value = '';
  }
}

function removeTestMedia() {
  state.testMediaFiles = [];
  state.testMediaPath = null;
  state.testMediaMimetype = null;
  state.testMediaFilename = null;
  state.testMediaSize = 0;
  testMediaFileInput.value = '';
  renderTestFiles();
}

async function sendTestMessage() {
  const numbers = testNumbersInput.value.trim();
  const message = testMessageInput.value.trim();

  if (!numbers) {
    showToast('Please enter recipient phone number(s).', 'error');
    return;
  }

  if (state.testMessageType === 'text' && !message) {
    showToast('Please enter a test message.', 'error');
    return;
  }

  if (state.testMessageType !== 'text' && state.testMediaFiles.length === 0) {
    showToast('Please upload a media file for this message type.', 'error');
    return;
  }

  if (state.waStatus !== 'CONNECTED' && state.waStatus !== 'ready') {
    showToast('WhatsApp is not connected. Please connect first.', 'error');
    return;
  }

  try {
    btnSendTest.disabled = true;
    btnSendTest.innerHTML = '<span aria-hidden="true">⏳</span> Sending...';
    testStatusMsg.className = 'hidden';

    const res = await fetch(`${API_BASE}/session/send-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numbers, 
        message,
        messageType: state.testMessageType,
        mediaPath: state.testMediaPath,
        mediaMimetype: state.testMediaMimetype,
        mediaFilename: state.testMediaFilename,
        mediaFiles: state.testMediaFiles
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send test message.');
    }

    const successCount = data.results.filter(r => r.success).length;
    const failCount = data.results.filter(r => !r.success).length;

    if (failCount === 0) {
      testStatusMsg.className = 'test-status-success';
      testStatusMsg.textContent = `✅ Successfully sent test message to all ${successCount} numbers!`;
      showToast('Test message sent successfully!', 'success');
      
      // Reset test media for next test
      testMessageTypeSelect.value = 'text';
      state.testMessageType = 'text';
      removeTestMedia();
      testMediaUploadWrapper.classList.add('hidden');
    } else {
      testStatusMsg.className = 'test-status-error';
      testStatusMsg.textContent = `❌ Sent successfully to ${successCount} numbers, but failed for ${failCount} numbers.`;
      showToast('Some test messages failed to send.', 'error');
    }
  } catch (error) {
    console.error('Error sending test message:', error);
    testStatusMsg.className = 'test-status-error';
    testStatusMsg.textContent = `❌ Error: ${error.message}`;
    showToast(error.message, 'error');
  } finally {
    btnSendTest.disabled = false;
    btnSendTest.innerHTML = '<span aria-hidden="true">⚡</span> Send Test Message';
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
      const badge = t.messageType && t.messageType !== 'text' ? ` [${t.messageType.toUpperCase()}]` : '';
      opt.textContent = `${t.name}${badge}`;
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

    // Sync template media state
    state.tplMessageType = tpl.messageType || 'text';
    state.tplMediaFiles = tpl.mediaFiles || [];
    if (state.tplMediaFiles.length === 0 && tpl.mediaPath) {
      state.tplMediaFiles = [{
        path: tpl.mediaPath,
        mimetype: tpl.mediaMimetype,
        filename: tpl.mediaFilename,
        size: null
      }];
    }

    state.tplMediaPath = state.tplMediaFiles[0]?.path || null;
    state.tplMediaMimetype = state.tplMediaFiles[0]?.mimetype || null;
    state.tplMediaFilename = state.tplMediaFiles[0]?.filename || null;

    tplMessageTypeSelect.value = state.tplMessageType;
    if (state.tplMessageType === 'text') {
      tplMediaUploadWrapper.classList.add('hidden');
    } else {
      tplMediaUploadWrapper.classList.remove('hidden');
      renderTplFiles();
    }

    // Sync Dispatcher campaign console state with selected template automatically
    state.messageType = tpl.messageType || 'text';
    state.mediaFiles = tpl.mediaFiles ? [...tpl.mediaFiles] : [];
    if (state.mediaFiles.length === 0 && tpl.mediaPath) {
      state.mediaFiles = [{
        path: tpl.mediaPath,
        mimetype: tpl.mediaMimetype,
        filename: tpl.mediaFilename,
        size: null
      }];
    }

    state.mediaPath = state.mediaFiles[0]?.path || null;
    state.mediaMimetype = state.mediaFiles[0]?.mimetype || null;
    state.mediaFilename = state.mediaFiles[0]?.filename || null;
    
    if (messageTypeSelect) {
      messageTypeSelect.value = state.messageType;
      if (state.messageType === 'text') {
        mediaUploadWrapper.classList.add('hidden');
      } else {
        mediaUploadWrapper.classList.remove('hidden');
        renderCampaignFiles();
      }
    }

    updatePreview();
  }
}

function initNewTemplate() {
  state.selectedTemplateId = '';
  templateName.value = '';
  templateContent.value = '';

  state.tplMessageType = 'text';
  state.tplMediaPath = null;
  state.tplMediaMimetype = null;
  state.tplMediaFilename = null;
  state.tplMediaSize = 0;

  if (tplMessageTypeSelect) {
    tplMessageTypeSelect.value = 'text';
    tplMediaUploadWrapper.classList.add('hidden');
    removeTplMedia();
  }

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

  // If a media type is selected, verify we actually uploaded a file
  if (state.tplMessageType !== 'text' && state.tplMediaFiles.length === 0) {
    showToast('Please upload a media file for this template type.', 'error');
    return;
  }

  const payload = {
    name,
    content,
    messageType: state.tplMessageType,
    mediaPath: state.tplMediaPath,
    mediaMimetype: state.tplMediaMimetype,
    mediaFilename: state.tplMediaFilename,
    mediaFiles: state.tplMediaFiles
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
  if (!(await showConfirmModal(
    'Delete Template',
    'Are you sure you want to delete this template? This action cannot be undone.',
    'Delete'
  ))) {
    return;
  }

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

async function duplicateTemplate() {
  if (!state.selectedTemplateId) return;
  const name = templateName.value.trim();
  const content = templateContent.value.trim();

  if (!name || !content) {
    showToast('Please load a template to duplicate.', 'error');
    return;
  }

  const payload = {
    name: `${name} (Copy)`,
    content,
    messageType: state.tplMessageType,
    mediaPath: state.tplMediaPath,
    mediaMimetype: state.tplMediaMimetype,
    mediaFilename: state.tplMediaFilename,
    mediaFiles: state.tplMediaFiles
  };

  try {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const saved = await res.json();
    showToast('Template duplicated successfully!', 'success');
    console.log(`%c[Templates] Template duplicated. ID: ${saved.id}`, 'color: #10b981; font-weight: bold;');
    await loadTemplates();
    selectTemplate(saved.id);
  } catch (error) {
    showToast('Failed to duplicate template.', 'error');
  }
}

async function handleTplMediaFileSelect() {
  const selectedFiles = Array.from(tplMediaFileInput.files);
  if (selectedFiles.length === 0) return;

  console.log(`%c[Template Media Upload] ${selectedFiles.length} files selected.`, 'color: #10b981; font-weight: bold;');

  const maxSizeBytes = 20 * 1024 * 1024; // 20MB per file
  const maxCombinedBytes = 50 * 1024 * 1024; // 50MB combined
  
  if (state.tplMediaFiles.length + selectedFiles.length > 10) {
    showToast('Maximum of 10 media files can be attached.', 'error');
    tplMediaFileInput.value = '';
    return;
  }

  for (const file of selectedFiles) {
    if (file.size > maxSizeBytes) {
      showToast(`File "${file.name}" exceeds the 20MB limit.`, 'error');
      tplMediaFileInput.value = '';
      return;
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    let allowed = [];
    if (state.tplMessageType === 'image') allowed = ['.jpg', '.jpeg', '.png'];
    else if (state.tplMessageType === 'pdf') allowed = ['.pdf'];
    else if (state.tplMessageType === 'video') allowed = ['.mp4'];
    else if (state.tplMessageType === 'audio') allowed = ['.mp3'];

    if (!allowed.includes(ext)) {
      showToast(`Invalid file type for "${file.name}". For ${state.tplMessageType}, please upload: ${allowed.join(', ')}`, 'error');
      tplMediaFileInput.value = '';
      return;
    }
  }

  const currentTotal = state.tplMediaFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const newTotal = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  if (currentTotal + newTotal > maxCombinedBytes) {
    showToast('Combined file size exceeds the 50MB limit.', 'error');
    tplMediaFileInput.value = '';
    return;
  }

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append('media', file);
  });

  try {
    showToast('Uploading template media file(s)...', 'info');
    const res = await fetch(`${API_BASE}/upload-media`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to upload media.');
    }

    const data = await res.json();
    const uploadedFiles = data.files || [data];
    
    state.tplMediaFiles = state.tplMediaFiles.concat(uploadedFiles);
    
    state.tplMediaPath = state.tplMediaFiles[0].path;
    state.tplMediaMimetype = state.tplMediaFiles[0].mimetype;
    state.tplMediaFilename = state.tplMediaFiles[0].filename;
    state.tplMediaSize = state.tplMediaFiles[0].size;

    showToast('Template media uploaded successfully!', 'success');
    renderTplFiles();
  } catch (error) {
    showToast(error.message, 'error');
    console.error('%c[Template Media Upload] Error:', 'color: #ef4444; font-weight: bold;', error.message);
  } finally {
    tplMediaFileInput.value = '';
  }
}

function removeTplMedia() {
  state.tplMediaFiles = [];
  state.tplMediaPath = null;
  state.tplMediaMimetype = null;
  state.tplMediaFilename = null;
  state.tplMediaSize = 0;
  tplMediaFileInput.value = '';
  renderTplFiles();
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

async function handleMediaFileSelect() {
  const selectedFiles = Array.from(mediaFileInput.files);
  if (selectedFiles.length === 0) return;

  console.log(`%c[Media Upload] ${selectedFiles.length} files selected.`, 'color: #10b981; font-weight: bold;');

  // Validation limits
  const maxSizeBytes = 20 * 1024 * 1024; // 20MB per file
  const maxCombinedBytes = 50 * 1024 * 1024; // 50MB combined
  
  if (state.mediaFiles.length + selectedFiles.length > 10) {
    showToast('Maximum of 10 media files can be attached.', 'error');
    mediaFileInput.value = '';
    return;
  }

  // Validate each file size and type
  for (const file of selectedFiles) {
    if (file.size > maxSizeBytes) {
      showToast(`File "${file.name}" exceeds the 20MB limit.`, 'error');
      mediaFileInput.value = '';
      return;
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    let allowed = [];
    if (state.messageType === 'image') allowed = ['.jpg', '.jpeg', '.png'];
    else if (state.messageType === 'pdf') allowed = ['.pdf'];
    else if (state.messageType === 'video') allowed = ['.mp4'];
    else if (state.messageType === 'audio') allowed = ['.mp3'];

    if (!allowed.includes(ext)) {
      showToast(`Invalid file type for "${file.name}". For ${state.messageType}, please upload: ${allowed.join(', ')}`, 'error');
      mediaFileInput.value = '';
      return;
    }
  }

  // Check combined size
  const currentTotal = state.mediaFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const newTotal = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  if (currentTotal + newTotal > maxCombinedBytes) {
    showToast('Combined file size exceeds the 50MB limit.', 'error');
    mediaFileInput.value = '';
    return;
  }

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append('media', file);
  });

  try {
    showToast('Uploading media file(s)...', 'info');
    const res = await fetch(`${API_BASE}/upload-media`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to upload media.');
    }

    const data = await res.json();
    const uploadedFiles = data.files || [data];
    
    state.mediaFiles = state.mediaFiles.concat(uploadedFiles);
    
    // Sync fallbacks for backward compatibility
    state.mediaPath = state.mediaFiles[0].path;
    state.mediaMimetype = state.mediaFiles[0].mimetype;
    state.mediaFilename = state.mediaFiles[0].filename;
    state.mediaSize = state.mediaFiles[0].size;

    showToast('Media uploaded successfully!', 'success');
    renderCampaignFiles();
  } catch (error) {
    showToast(error.message, 'error');
    console.error('%c[Media Upload] Error:', 'color: #ef4444; font-weight: bold;', error.message);
  } finally {
    mediaFileInput.value = '';
  }
}

function removeMedia() {
  state.mediaFiles = [];
  state.mediaPath = null;
  state.mediaMimetype = null;
  state.mediaFilename = null;
  state.mediaSize = 0;
  mediaFileInput.value = '';
  renderCampaignFiles();
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

  // If a media type is selected, verify we actually uploaded a file
  if (state.messageType !== 'text' && state.mediaFiles.length === 0) {
    showToast('Please upload a media file for this campaign type.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/bulk/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: state.selectedTemplateId,
        leads: state.uploadedLeads,
        delaySeconds: delay,
        messageType: state.messageType,
        mediaPath: state.mediaPath,
        mediaMimetype: state.mediaMimetype,
        mediaFilename: state.mediaFilename,
        mediaFiles: state.mediaFiles
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

    // Reset media input for future campaigns
    messageTypeSelect.value = 'text';
    state.messageType = 'text';
    removeMedia();
    mediaUploadWrapper.classList.add('hidden');

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
    logsTbody.innerHTML = `
      <tr>
        <td colspan="5" class="no-logs">
          <div class="empty-state">
            <div class="empty-state-icon">📤</div>
            <div class="empty-state-title">No Transmission Logs</div>
            <div class="empty-state-desc">Active campaign messages will appear here in real-time once sending begins.</div>
          </div>
        </td>
      </tr>
    `;
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
      <td colspan="5" class="logs-info-row">
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
  if (!(await showConfirmModal(
    'Cancel Campaign',
    'Are you sure you want to cancel the active campaign? Messages currently queued will not be sent.',
    'Cancel Campaign'
  ))) return;
  
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
          <td colspan="6" class="no-history">
            <div class="empty-state">
              <div class="empty-state-icon">📜</div>
              <div class="empty-state-title">No Campaign History</div>
              <div class="empty-state-desc">You haven't run any campaigns yet. Send your first campaign to view history and download reports.</div>
            </div>
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
          <a href="${API_BASE}/bulk/batches/${b.id}/export" class="btn btn-sm btn-secondary btn-export-link">Download CSV</a>
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

function renderFilesList(filesArray, listEl, summaryEl, containerEl, dropZoneEl, removeFn, messageType) {
  listEl.innerHTML = '';
  
  if (!filesArray || filesArray.length === 0) {
    containerEl.classList.add('hidden');
    if (messageType !== 'text') {
      dropZoneEl.classList.remove('hidden');
    }
    return;
  }
  
  containerEl.classList.remove('hidden');
  
  const count = filesArray.length;
  const totalSize = filesArray.reduce((sum, f) => sum + (f.size || 0), 0);
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
  summaryEl.textContent = `${count} file(s) attached (${totalSizeMB} MB / Max 50 MB)`;
  
  if (count >= 10) {
    dropZoneEl.classList.add('hidden');
  } else if (messageType !== 'text') {
    dropZoneEl.classList.remove('hidden');
  }
  
  filesArray.forEach((file, index) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'media-preview-card media-preview-card-item';
    
    const isImage = messageType === 'image';
    const filenameOnly = file.path ? file.path.replace(/\\/g, '/').split('/').pop() : file.filename;
    
    fileItem.innerHTML = `
      <div class="media-preview-details">
        ${isImage ? `
          <div class="media-preview-thumbnail-container media-preview-thumbnail-container-compact">
            <img src="/uploads/${filenameOnly}" alt="Thumbnail Preview" class="media-preview-thumbnail-img">
          </div>
        ` : ''}
        <div class="media-preview-info">
          <div class="media-preview-filename">
            ${escapeHtml(file.filename)}
          </div>
          <div class="media-preview-size">
            ${file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Size unknown'}
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-danger btn-remove-file">Remove</button>
      </div>
    `;
    
    const removeBtn = fileItem.querySelector('.btn-remove-file');
    removeBtn.addEventListener('click', () => {
      removeFn(index);
    });
    
    listEl.appendChild(fileItem);
  });
}

function removeMediaFile(index) {
  state.mediaFiles.splice(index, 1);
  if (state.mediaFiles.length === 0) {
    state.mediaPath = null;
    state.mediaMimetype = null;
    state.mediaFilename = null;
    state.mediaSize = 0;
  } else {
    state.mediaPath = state.mediaFiles[0].path;
    state.mediaMimetype = state.mediaFiles[0].mimetype;
    state.mediaFilename = state.mediaFiles[0].filename;
    state.mediaSize = state.mediaFiles[0].size;
  }
  mediaFileInput.value = '';
  renderCampaignFiles();
}

function renderCampaignFiles() {
  renderFilesList(
    state.mediaFiles,
    mediaFilesList,
    mediaFilesSummary,
    mediaFilesContainer,
    mediaDropZone,
    removeMediaFile,
    state.messageType
  );
}

function removeTestMediaFile(index) {
  state.testMediaFiles.splice(index, 1);
  if (state.testMediaFiles.length === 0) {
    state.testMediaPath = null;
    state.testMediaMimetype = null;
    state.testMediaFilename = null;
    state.testMediaSize = 0;
  } else {
    state.testMediaPath = state.testMediaFiles[0].path;
    state.testMediaMimetype = state.testMediaFiles[0].mimetype;
    state.testMediaFilename = state.testMediaFiles[0].filename;
    state.testMediaSize = state.testMediaFiles[0].size;
  }
  testMediaFileInput.value = '';
  renderTestFiles();
}

function renderTestFiles() {
  renderFilesList(
    state.testMediaFiles,
    testMediaFilesList,
    testMediaFilesSummary,
    testMediaFilesContainer,
    testMediaDropZone,
    removeTestMediaFile,
    state.testMessageType
  );
}

function removeTplMediaFile(index) {
  state.tplMediaFiles.splice(index, 1);
  if (state.tplMediaFiles.length === 0) {
    state.tplMediaPath = null;
    state.tplMediaMimetype = null;
    state.tplMediaFilename = null;
    state.tplMediaSize = 0;
  } else {
    state.tplMediaPath = state.tplMediaFiles[0].path;
    state.tplMediaMimetype = state.tplMediaFiles[0].mimetype;
    state.tplMediaFilename = state.tplMediaFiles[0].filename;
    state.tplMediaSize = state.tplMediaFiles[0].size;
  }
  tplMediaFileInput.value = '';
  renderTplFiles();
}

function renderTplFiles() {
  renderFilesList(
    state.tplMediaFiles,
    tplMediaFilesList,
    tplMediaFilesSummary,
    tplMediaFilesContainer,
    tplMediaDropZone,
    removeTplMediaFile,
    state.tplMessageType
  );
}
