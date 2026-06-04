const { getSessionStatus, sendTextMessage } = require('./wa-client');
const { saveBatch, getBatch } = require('./db');

let activeSendingState = {
  isSending: false,
  currentBatchId: null,
  cancelRequested: false
};

/**
 * Returns the current active sending status.
 */
async function getActiveStatus() {
  if (!activeSendingState.isSending) {
    return { isSending: false, currentBatchId: null };
  }
  const batch = await getBatch(activeSendingState.currentBatchId);
  if (!batch) {
    return { isSending: false, currentBatchId: null };
  }
  return {
    isSending: true,
    batchId: batch.id,
    status: batch.status,
    totalLeads: batch.totalLeads,
    sentCount: batch.sentCount,
    failedCount: batch.failedCount,
    pendingCount: batch.leads.filter(l => l.status === 'PENDING').length,
    leads: batch.leads
  };
}

/**
 * Requests cancellation of the currently active sending process.
 */
function cancelActiveBatch() {
  if (activeSendingState.isSending) {
    activeSendingState.cancelRequested = true;
    return true;
  }
  return false;
}

/**
 * Formats a message template by substituting {{name}} placeholders.
 */
function personalizeMessage(templateContent, name) {
  return templateContent.replace(/\{\{\s*name\s*\}\}/gi, name);
}

/**
 * Start the sequential sending process.
 * Runs in the background (async).
 */
async function startBulkSend(batchId, templateContent, delaySeconds) {
  if (activeSendingState.isSending) {
    throw new Error('A bulk sending job is already in progress.');
  }

  activeSendingState.isSending = true;
  activeSendingState.currentBatchId = batchId;
  activeSendingState.cancelRequested = false;

  console.log(`Starting bulk send for batch ${batchId} with a ${delaySeconds}s delay.`);

  // run in background
  processQueue(batchId, templateContent, delaySeconds).catch(err => {
    console.error('Fatal error in processQueue:', err);
  }).finally(() => {
    activeSendingState.isSending = false;
    activeSendingState.currentBatchId = null;
    activeSendingState.cancelRequested = false;
  });
}

/**
 * Worker loop that processes the queue sequentially.
 */
async function processQueue(batchId, templateContent, delaySeconds) {
  const delayMs = delaySeconds * 1000;
  
  while (true) {
    const batch = await getBatch(batchId);
    if (!batch) break;

    // Check for cancellation request
    if (activeSendingState.cancelRequested) {
      batch.status = 'CANCELLED';
      await saveBatch(batch);
      console.log(`Batch ${batchId} was cancelled by user.`);
      break;
    }

    // Find the next pending lead
    const nextLeadIndex = batch.leads.findIndex(l => l.status === 'PENDING');
    if (nextLeadIndex === -1) {
      batch.status = 'COMPLETED';
      await saveBatch(batch);
      console.log(`Batch ${batchId} completed successfully.`);
      break;
    }

    const lead = batch.leads[nextLeadIndex];

    // Check WhatsApp gateway status before sending
    const waStatus = await getSessionStatus();
    if (waStatus.status !== 'CONNECTED' && waStatus.status !== 'ready') {
      batch.status = 'PAUSED';
      await saveBatch(batch);
      console.log(`WhatsApp is disconnected (Status: ${waStatus.status}). Pausing batch.`);
      break;
    }

    // Personalize message
    const customizedText = personalizeMessage(templateContent, lead.name);

    // Send the message
    console.log(`Sending message to ${lead.name} (${lead.phone})...`);
    const sendResult = await sendTextMessage(lead.phone, customizedText);

    // Update lead status
    if (sendResult.success) {
      lead.status = 'SENT';
      lead.messageId = sendResult.messageId;
      batch.sentCount += 1;
    } else {
      lead.status = 'FAILED';
      lead.error = sendResult.error;
      batch.failedCount += 1;
    }
    lead.timestamp = new Date().toISOString();
    lead.sentMessage = customizedText;

    // Save batch progress
    await saveBatch(batch);

    // If there are more leads, wait for the configured delay
    const hasMore = batch.leads.some(l => l.status === 'PENDING');
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  startBulkSend,
  getActiveStatus,
  cancelActiveBatch
};
