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
    console.log(`\x1b[33m[Campaign Queue]\x1b[0m User requested cancellation for batch ${activeSendingState.currentBatchId}`);
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

  console.log(`\x1b[36m[Campaign Queue]\x1b[0m Starting campaign worker for batch ${batchId}. Delay setting: ${delaySeconds}s.`);

  // run in background
  processQueue(batchId, templateContent, delaySeconds).catch(err => {
    console.error('\x1b[31m[Campaign Queue Err]\x1b[0m Fatal error in campaign worker loop:', err);
  }).finally(() => {
    console.log(`\x1b[36m[Campaign Queue]\x1b[0m Campaign worker loop completed. Resetting active state.`);
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
    if (!batch) {
      console.log(`\x1b[33m[Campaign Queue]\x1b[0m Batch record ${batchId} not found in database. Halting.`);
      break;
    }

    // Check for cancellation request
    if (activeSendingState.cancelRequested) {
      batch.status = 'CANCELLED';
      await saveBatch(batch);
      console.log(`\x1b[31m[Campaign Queue]\x1b[0m Batch ${batchId} marked CANCELLED in database. Halting.`);
      break;
    }

    // Find the next pending lead
    const nextLeadIndex = batch.leads.findIndex(l => l.status === 'PENDING');
    if (nextLeadIndex === -1) {
      batch.status = 'COMPLETED';
      await saveBatch(batch);
      console.log(`\x1b[32m[Campaign Queue]\x1b[0m Batch ${batchId} fully COMPLETED. All messages dispatched.`);
      break;
    }

    const lead = batch.leads[nextLeadIndex];
    console.log(`\x1b[36m[Campaign Queue]\x1b[0m Processing lead ${nextLeadIndex + 1}/${batch.totalLeads}: ${lead.name} (${lead.phone})`);

    // Check WhatsApp gateway status before sending
    const waStatus = await getSessionStatus();
    if (waStatus.status !== 'CONNECTED' && waStatus.status !== 'ready') {
      batch.status = 'PAUSED';
      await saveBatch(batch);
      console.log(`\x1b[31m[Campaign Queue]\x1b[0m WhatsApp Disconnected (Status: ${waStatus.status}). Pausing batch ${batchId}.`);
      break;
    }

    // Personalize message
    const customizedText = personalizeMessage(templateContent, lead.name);
    console.log(`\x1b[35m[Campaign Queue]\x1b[0m Compiled template: recipient = "${lead.name}", length = ${customizedText.length} chars.`);

    // Send the message
    const sendResult = await sendTextMessage(lead.phone, customizedText);

    // Update lead status
    if (sendResult.success) {
      lead.status = 'SENT';
      lead.messageId = sendResult.messageId;
      batch.sentCount += 1;
      console.log(`\x1b[32m[Campaign Queue]\x1b[0m Dispatch Success for ${lead.name}. MsgID: ${lead.messageId}`);
    } else {
      lead.status = 'FAILED';
      lead.error = sendResult.error;
      batch.failedCount += 1;
      console.log(`\x1b[31m[Campaign Queue]\x1b[0m Dispatch Failed for ${lead.name}. Error: ${lead.error}`);
    }
    lead.timestamp = new Date().toISOString();
    lead.sentMessage = customizedText;

    // Save batch progress
    console.log(`\x1b[35m[Campaign Queue]\x1b[0m Persisting campaign progress to SQLite (Sent: ${batch.sentCount}, Failed: ${batch.failedCount}, Remaining: ${batch.leads.filter(l => l.status === 'PENDING').length})`);
    await saveBatch(batch);

    // If there are more leads, wait for the configured delay
    const hasMore = batch.leads.some(l => l.status === 'PENDING');
    if (hasMore) {
      console.log(`\x1b[36m[Campaign Queue]\x1b[0m Enforcing anti-spam delay: waiting ${delaySeconds} seconds before next send...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  startBulkSend,
  getActiveStatus,
  cancelActiveBatch
};
