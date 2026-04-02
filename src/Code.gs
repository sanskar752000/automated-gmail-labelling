/**
 * Code.gs — Main Entry Point
 * 
 * Contains:
 *   - Trigger setup (createTimeDrivenTrigger)
 *   - Main processing loop (processNewEmails)
 *   - Bridge functions (classifyEmail, applyClassificationLabel, handleError)
 *   - Backfill mode (startBackfill, backfillEmails, getBackfillProgress, stopBackfill)
 *   - Test function (testClassification)
 *   - PerformanceManager
 *   - QuotaManager
 *   - UI menu (onOpen)
 */

// ============================================================
// TRIGGER SETUP
// ============================================================

/**
 * Create the time-based trigger for ongoing email processing.
 * Run this ONCE from the script editor to start the system.
 */
function createTimeDrivenTrigger() {
  // Delete existing processNewEmails triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'processNewEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new time-based trigger (every 10 minutes)
  ScriptApp.newTrigger('processNewEmails')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log('Trigger created: processNewEmails() will run every 10 minutes.');
}

/**
 * Stop all triggers (both ongoing and backfill).
 * Run this from the script editor to halt all processing.
 */
function stopEverything() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  Logger.log('All triggers removed. System stopped.');
}

// ============================================================
// MAIN PROCESSING LOOP
// ============================================================

/**
 * Main entry point — called by the time-based trigger every 10 minutes.
 * Processes new unread emails, classifies them, and applies labels.
 */
function processNewEmails() {
  // Prevent concurrent execution with LockService
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Another instance is running. Skipping this execution.');
    return;
  }
  
  var startTime = Date.now();
  
  try {
    // Initialize configuration
    ConfigManager.initialize();
    QuotaManager.reset();
    
    // Get last processed timestamp for incremental processing
    var lastTimestamp = ConfigManager.getLastProcessedTimestamp();
    
    // Fetch new unread emails since last processed
    var emails = GmailService.fetchNewEmails(lastTimestamp);
    
    if (emails.length === 0) {
      Logger.log('No new emails to process.');
      return;
    }
    
    Logger.log('Found ' + emails.length + ' new emails to process.');
    
    // Process emails in order (oldest first)
    var processedCount = 0;
    for (var i = 0; i < emails.length; i++) {
      var email = emails[i];
      
      // Check execution time before processing each email
      if (Date.now() - startTime > PerformanceManager.MAX_EXECUTION_TIME) {
        Logger.log('Approaching execution limit. Processed ' + processedCount + ' emails.');
        break;
      }
      
      // Check quota
      if (QuotaManager.isQuotaExceeded()) {
        Logger.log('Quota limit reached. Will resume on next trigger.');
        break;
      }
      
      try {
        // Classify and apply label
        var result = classifyEmail(email);
        applyClassificationLabel(email, result);
        processedCount++;
      } catch (emailError) {
        Logger.log('Error processing email "' + email.subject + '": ' + emailError.message);
        // Continue with next email
      }
    }
    
    // Update last processed timestamp
    if (processedCount > 0) {
      var lastProcessed = emails[Math.min(processedCount, emails.length) - 1];
      ConfigManager.setLastProcessedTimestamp(lastProcessed.date.getTime());
    }
    
    Logger.log('Processed ' + processedCount + '/' + emails.length + ' emails successfully.');
    
  } catch (error) {
    handleError(error, 'processNewEmails');
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// BRIDGE FUNCTIONS
// ============================================================

/**
 * Classify a single email using the ClassificationRouter.
 * @param {Object} email - Parsed email object
 * @returns {Object} Classification result { label, confidence, source, reasoning }
 */
function classifyEmail(email) {
  return ClassificationRouter.classify(email);
}

/**
 * Apply label and update stats/history after classification.
 * @param {Object} email - Parsed email object
 * @param {Object} result - Classification result
 */
function applyClassificationLabel(email, result) {
  LabelManager.applyLabelToEmail(email, result.label);
  ConfigManager.updateSenderHistory(email.from, result.label);
  ConfigManager.incrementStats(result.source);
  
  // Optional: Log to analytics
  if (typeof AnalyticsManager !== 'undefined') {
    try {
      AnalyticsManager.logClassification(email, result, Date.now());
    } catch (e) {
      // Analytics is optional — don't break processing if it fails
      Logger.log('Analytics logging skipped: ' + e.message);
    }
  }
}

/**
 * Handle errors with logging and classification.
 * @param {Error} error - The error object
 * @param {string} context - Where the error occurred
 */
function handleError(error, context) {
  var result = ErrorHandler.handleError(error, context);
  Logger.log('Error in ' + context + ': ' + JSON.stringify(result));
}

// ============================================================
// BACKFILL MODE
// ============================================================

/**
 * Start backfill processing of ALL historical emails (read + unread).
 * Creates a separate trigger that processes emails in batches every 5 minutes.
 * 
 * @param {string} [afterDate] - Optional start date, e.g. '2023-01-01'
 * @param {string} [beforeDate] - Optional end date, e.g. '2025-12-31'
 */
function startBackfill(afterDate, beforeDate) {
  var props = PropertiesService.getScriptProperties();
  
  // Build the search query — no 'is:unread' filter = ALL emails
  var query = '-label:backfill-processed';
  if (afterDate) query += ' after:' + afterDate;
  if (beforeDate) query += ' before:' + beforeDate;
  
  // Store backfill state
  props.setProperty('backfill_status', 'running');
  props.setProperty('backfill_query', query);
  props.setProperty('backfill_offset', '0');
  props.setProperty('backfill_total_processed', '0');
  props.setProperty('backfill_started_at', new Date().toISOString());
  
  // Create the backfill tracking label
  LabelManager.getOrCreateLabel('backfill-processed');
  
  // Remove any existing backfill triggers
  cleanupBackfillTrigger();
  
  // Create a separate trigger for backfill (every 5 minutes)
  ScriptApp.newTrigger('backfillEmails')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  Logger.log('Backfill started. Query: ' + query);
  Logger.log('Will process emails across multiple runs (every 5 minutes).');
  
  // Run the first batch immediately
  backfillEmails();
}

/**
 * Process one batch of historical emails.
 * Called automatically by the backfill trigger every 5 minutes.
 */
function backfillEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Backfill: Another instance running. Skipping.');
    return;
  }
  
  var startTime = Date.now();
  var MAX_BACKFILL_TIME = 300000; // 5 minutes (conservative)
  
  try {
    var props = PropertiesService.getScriptProperties();
    var status = props.getProperty('backfill_status');
    
    if (status !== 'running') {
      Logger.log('Backfill is not active. Cleaning up trigger.');
      cleanupBackfillTrigger();
      return;
    }
    
    // Initialize if needed
    ConfigManager.initialize();
    
    var query = props.getProperty('backfill_query');
    var offset = parseInt(props.getProperty('backfill_offset') || '0', 10);
    var totalProcessed = parseInt(props.getProperty('backfill_total_processed') || '0', 10);
    
    // Fetch next batch of threads
    var BATCH_SIZE = 100;
    var threads = GmailApp.search(query, offset, BATCH_SIZE);
    
    if (threads.length === 0) {
      // Backfill complete!
      props.setProperty('backfill_status', 'complete');
      props.setProperty('backfill_completed_at', new Date().toISOString());
      Logger.log('🎉 Backfill complete! Total emails processed: ' + totalProcessed);
      cleanupBackfillTrigger();
      return;
    }
    
    var batchProcessed = 0;
    var backfillLabel = GmailApp.getUserLabelByName('backfill-processed');
    
    for (var t = 0; t < threads.length; t++) {
      var thread = threads[t];
      
      // Check execution time
      if (Date.now() - startTime > MAX_BACKFILL_TIME) {
        Logger.log('Approaching time limit. Will continue in next run.');
        break;
      }
      
      var messages = thread.getMessages();
      
      for (var m = 0; m < messages.length; m++) {
        try {
          var email = GmailService.parseMessage(messages[m]);
          var result = classifyEmail(email);
          
          LabelManager.applyLabelToEmail(email, result.label);
          ConfigManager.updateSenderHistory(email.from, result.label);
          ConfigManager.incrementStats(result.source);
          
          batchProcessed++;
          totalProcessed++;
        } catch (msgError) {
          Logger.log('Backfill: Error processing message: ' + msgError.message);
        }
      }
      
      // Mark thread as backfill-processed
      thread.addLabel(backfillLabel);
    }
    
    // Update progress
    props.setProperty('backfill_offset', (offset + threads.length).toString());
    props.setProperty('backfill_total_processed', totalProcessed.toString());
    
    Logger.log('Backfill batch: ' + batchProcessed + ' emails. ' +
      'Total: ' + totalProcessed + '. Offset: ' + (offset + threads.length));
    
  } catch (error) {
    Logger.log('Backfill error: ' + error.message);
    handleError(error, 'backfillEmails');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Check backfill progress. Run from the script editor.
 * @returns {Object} Status object
 */
function getBackfillProgress() {
  var props = PropertiesService.getScriptProperties();
  var status = props.getProperty('backfill_status') || 'not_started';
  var total = props.getProperty('backfill_total_processed') || '0';
  var startedAt = props.getProperty('backfill_started_at') || '';
  var completedAt = props.getProperty('backfill_completed_at') || '';
  
  Logger.log('=== Backfill Status ===');
  Logger.log('Status: ' + status);
  Logger.log('Emails processed: ' + total);
  Logger.log('Started at: ' + startedAt);
  if (completedAt) Logger.log('Completed at: ' + completedAt);
  
  return {
    status: status,
    totalProcessed: parseInt(total, 10),
    startedAt: startedAt,
    completedAt: completedAt
  };
}

/**
 * Stop a running backfill.
 */
function stopBackfill() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('backfill_status', 'stopped');
  cleanupBackfillTrigger();
  Logger.log('Backfill stopped. Run startBackfill() to restart.');
}

/**
 * Remove backfill triggers.
 */
function cleanupBackfillTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'backfillEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

// ============================================================
// TEST FUNCTION
// ============================================================

/**
 * Manual test: classify the last 5 unread emails without applying labels.
 * Run from the script editor to verify classification logic.
 */
function testClassification() {
  ConfigManager.initialize();
  
  var threads = GmailApp.search('is:unread', 0, 5);
  
  if (threads.length === 0) {
    Logger.log('No unread emails found for testing.');
    return;
  }
  
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      if (!messages[m].isUnread()) continue;
      
      var email = GmailService.parseMessage(messages[m]);
      var result = classifyEmail(email);
      
      Logger.log('---');
      Logger.log('Email: ' + email.subject);
      Logger.log('  From: ' + email.from);
      Logger.log('  → Label: ' + result.label);
      Logger.log('  → Confidence: ' + result.confidence);
      Logger.log('  → Source: ' + result.source);
      if (result.reasoning) {
        Logger.log('  → Reasoning: ' + result.reasoning);
      }
    }
  }
}

// ============================================================
// EMAIL ANALYSIS (run once to discover patterns for rules)
// ============================================================

/**
 * Analyze your recent emails to discover sender patterns.
 * Run this from the editor — it only READS emails, never modifies anything.
 * Share the output so we can build custom rules.
 */
function analyzeMyEmails() {
  var domains = {};
  var senders = {};
  var subjectWords = {};
  
  // Scan last 400 threads (mix of read + unread)
  var threads = GmailApp.search('', 0, 400);
  var totalEmails = 0;
  
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var from = msg.getFrom();
      var subject = msg.getSubject() || '';
      
      // Extract email address
      var emailMatch = from.match(/<([^>]+)>/);
      var email = emailMatch ? emailMatch[1] : from;
      email = email.toLowerCase();
      
      // Extract domain
      var domainMatch = email.match(/@(.+)$/);
      var domain = domainMatch ? domainMatch[1] : 'unknown';
      
      // Count
      domains[domain] = (domains[domain] || 0) + 1;
      senders[email] = (senders[email] || 0) + 1;
      
      // Track subject keywords (top words)
      var words = subject.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
      var stopWords = ['the','a','an','is','are','was','were','for','and','or','to','in','of','your','you','has','have','been','this','that','with','from','on','at','by','re','fwd'];
      for (var w = 0; w < words.length; w++) {
        if (words[w].length > 3 && stopWords.indexOf(words[w]) === -1) {
          subjectWords[words[w]] = (subjectWords[words[w]] || 0) + 1;
        }
      }
      
      totalEmails++;
    }
  }
  
  // Sort by frequency
  var topDomains = Object.keys(domains).sort(function(a,b) { return domains[b] - domains[a]; }).slice(0, 30);
  var topSenders = Object.keys(senders).sort(function(a,b) { return senders[b] - senders[a]; }).slice(0, 30);
  var topWords = Object.keys(subjectWords).sort(function(a,b) { return subjectWords[b] - subjectWords[a]; }).slice(0, 25);
  
  Logger.log('========================================');
  Logger.log('EMAIL ANALYSIS — ' + totalEmails + ' emails scanned');
  Logger.log('========================================');
  
  Logger.log('\n📧 TOP SENDER DOMAINS:');
  for (var i = 0; i < topDomains.length; i++) {
    Logger.log('  ' + (i+1) + '. ' + topDomains[i] + ' (' + domains[topDomains[i]] + ' emails)');
  }
  
  Logger.log('\n👤 TOP SENDERS:');
  for (var j = 0; j < topSenders.length; j++) {
    Logger.log('  ' + (j+1) + '. ' + topSenders[j] + ' (' + senders[topSenders[j]] + ' emails)');
  }
  
  Logger.log('\n🔤 COMMON SUBJECT WORDS:');
  for (var k = 0; k < topWords.length; k++) {
    Logger.log('  ' + (k+1) + '. "' + topWords[k] + '" (' + subjectWords[topWords[k]] + ' times)');
  }
  
  Logger.log('\n========================================');
  Logger.log('Share this output to build custom rules!');
  Logger.log('========================================');
}

// ============================================================
// PERFORMANCE MANAGER
// ============================================================

var PerformanceManager = {
  MAX_EXECUTION_TIME: 340000, // 5 min 40 sec (safety margin for 6-min limit)
  startTime: null,
  
  start: function() {
    this.startTime = Date.now();
  },
  
  getElapsedTime: function() {
    return Date.now() - (this.startTime || Date.now());
  },
  
  getRemainingTime: function() {
    return this.MAX_EXECUTION_TIME - this.getElapsedTime();
  },
  
  shouldContinue: function() {
    return this.getRemainingTime() > 30000; // 30 second buffer
  }
};

// ============================================================
// QUOTA MANAGER
// ============================================================

var QuotaManager = {
  READ_COUNT: 0,
  WRITE_COUNT: 0,
  API_COUNT: 0,
  _quotaExceeded: false,
  
  reset: function() {
    this.READ_COUNT = 0;
    this.WRITE_COUNT = 0;
    this.API_COUNT = 0;
    this._quotaExceeded = false;
  },
  
  isQuotaExceeded: function() {
    return this._quotaExceeded;
  },
  
  checkReadQuota: function() {
    this.READ_COUNT++;
    if (this.READ_COUNT > 80) {
      Logger.log('Approaching read quota limit. Will resume on next trigger.');
      this._quotaExceeded = true;
      return false;
    }
    return true;
  },
  
  checkWriteQuota: function() {
    this.WRITE_COUNT++;
    if (this.WRITE_COUNT > 50) {
      Logger.log('Approaching write quota limit. Will resume on next trigger.');
      this._quotaExceeded = true;
      return false;
    }
    return true;
  },
  
  checkApiQuota: function() {
    this.API_COUNT++;
    if (this.API_COUNT > 20) {
      Logger.log('Approaching API quota limit. Will resume on next trigger.');
      this._quotaExceeded = true;
      return false;
    }
    return true;
  }
};

// ============================================================
// UI MENU (when opened from Apps Script editor)
// ============================================================

/**
 * Adds a custom menu to the Apps Script editor sidebar.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Email Labeler')
    .addItem('Configure Rules', 'showRulesDialog')
    .addItem('Configure Labels', 'showLabelsDialog')
    .addItem('Setup API Key', 'showApiKeyDialog')
    .addSeparator()
    .addItem('Run Now', 'processNewEmails')
    .addItem('Test Classification', 'testClassification')
    .addSeparator()
    .addItem('Start Backfill', 'startBackfill')
    .addItem('Check Backfill Progress', 'getBackfillProgress')
    .addItem('Stop Backfill', 'stopBackfill')
    .addSeparator()
    .addItem('Stop All Triggers', 'stopEverything')
    .addToUi();
}

function showRulesDialog() {
  var html = HtmlService.createHtmlOutputFromFile('src/RulesDialog')
    .setWidth(600)
    .setHeight(500)
    .setTitle('Configure Classification Rules');
  SpreadsheetApp.getUi().showModalDialog(html, 'Classification Rules');
}

function showLabelsDialog() {
  var html = HtmlService.createHtmlOutputFromFile('src/LabelsDialog')
    .setWidth(500)
    .setHeight(400)
    .setTitle('Configure Labels');
  SpreadsheetApp.getUi().showModalDialog(html, 'Label Configuration');
}

function showApiKeyDialog() {
  var html = HtmlService.createHtmlOutputFromFile('src/ApiKeyDialog')
    .setWidth(450)
    .setHeight(350)
    .setTitle('API Key Setup');
  SpreadsheetApp.getUi().showModalDialog(html, 'API Key Setup');
}
