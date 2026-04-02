Now I'll create a comprehensive implementation plan for the Google Apps Script email labeling system.

# Implementation Plan: Intelligent Email Labeling System (Google Apps Script)

## Overview

Build a hybrid email classification system that automatically labels incoming Gmail messages using a two-tier strategy: fast rule-based classification for straightforward cases (targeting 70%+ of emails), with LLM escalation for complex/ambiguous emails. The system runs entirely on Google Apps Script infrastructure using time-based triggers, eliminating the need for external servers, OAuth management, or webhooks.

## Requirements

### Functional Requirements
- Automatic label assignment for new emails detected on 1-5 minute intervals
- Rule-based classification for 70%+ of emails (minimize LLM dependency and costs)
- LLM fallback for ambiguous emails with confidence threshold management
- Dynamic label creation and management via GmailApp
- User-configurable rules stored in PropertiesService
- Optional Google Sheets integration for analytics and learning

### Non-Functional Requirements
- Latency: <5 seconds per email for rule-based, <30 seconds for LLM classification
- Throughput: Process batches within 6-minute execution limit
- Cost: Minimize LLM API calls (target: <30% of total emails processed)
- Accuracy: 95%+ classification accuracy
- Reliability: Handle Apps Script quota limits and execution time constraints

---

## System Architecture Overview

### Apps Script Architecture Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Google Apps Script Project                          │
│                     (Runs on Google's Infrastructure)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
                    ▼                                   ▼
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│   Time-Based Trigger              │   │   Manual Trigger (for testing)   │
│   (1-5 minute intervals)          │   │   (Run from Script Editor)       │
│   File: Code.gs                   │   │   File: Code.gs                  │
│   - Check for new emails          │   │   - Process single email          │
│   - Batch processing logic        │   │   - Test rule evaluation         │
│   - Execution time management     │   │   - Debug classification         │
└──────────────────────────────────┘   └──────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GmailApp Service (Native)                           │
│                     File: GmailService.gs                                    │
│   - Fetch new/unread emails                                                  │
│   - Apply/remove labels                                                      │
│   - Create labels dynamically                                                │
│   - Get email content (headers, body, attachments)                         │
│   - Batch operations for performance                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Classification Engine                                    │
│                     File: Classifier.gs                                       │
│                                                                              │
│   ┌────────────────────────────────┐  ┌─────────────────────────────────┐  │
│   │  Rule-Based Classifier          │  │  LLM Classifier (UrlFetchApp)   │  │
│   │  (Fast Path - Local)            │  │  (Fallback Path - External API) │  │
│   │                                 │  │                                 │  │
│   │  - Sender patterns              │  │  - OpenAI/Claude API calls      │  │
│   │  - Keyword matching              │  │  - Prompt construction          │  │
│   │  - Header analysis               │  │  - Response parsing             │  │
│   │  - Confidence scoring            │  │  - Error handling               │  │
│   │  - Priority-based routing        │  │  - Timeout management           │  │
│   └────────────────────────────────┘  └─────────────────────────────────┘  │
│                    │                                   │                     │
│                    └─────────────────┬─────────────────┘                     │
│                                      ▼                                       │
│                          Confidence Evaluator                                │
│                    - Threshold comparison                                    │
│                    - Escalation decision                                     │
│                    - Result aggregation                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PropertiesService Storage                                │
│                     File: Config.gs                                           │
│   - User configuration (thresholds, preferences)                             │
│   - Label taxonomy definitions                                                │
│   - Rule definitions (JSON-serialized)                                        │
│   - API keys (Script Properties, encrypted)                                  │
│   - Last processed email ID (state tracking)                                 │
│   - Processing statistics                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Optional: Google Sheets Analytics                        │
│                     File: Analytics.gs                                        │
│   - Classification history log                                               │
│   - Accuracy metrics                                                         │
│   - LLM usage statistics                                                     │
│   - Rule performance tracking                                                 │
│   - User feedback collection                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Trigger Activation**: Time-based trigger fires every 1-5 minutes
2. **Email Fetch**: GmailApp searches for new/unread emails since last run
3. **Batch Processing**: Process emails in batches respecting 6-minute limit
4. **Fast Path**: Rule-based classifier evaluates each email, calculates confidence
5. **Escalation Check**: If confidence < threshold, route to LLM classifier
6. **Label Application**: Apply determined label(s) via GmailApp
7. **State Update**: Store last processed email ID and statistics
8. **Optional Logging**: Record classification to Google Sheets

---

## Time-Based Trigger Setup

### File: `Code.gs`

**Purpose**: Main entry point and trigger management

**Requirements**:

1. **Initial Setup Function**
   - Action: Create time-based trigger for periodic email checking
   - Why: Automate email processing without manual intervention
   - Apps Script API:
     ```javascript
     function createTimeDrivenTrigger() {
       // Delete existing triggers to avoid duplicates
       const triggers = ScriptApp.getProjectTriggers();
       triggers.forEach(trigger => {
         if (trigger.getHandlerFunction() === 'processNewEmails') {
           ScriptApp.deleteTrigger(trigger);
         }
       });
       
       // Create new time-based trigger (every 10 minutes)
       ScriptApp.newTrigger('processNewEmails')
         .timeBased()
         .everyMinutes(10)  // Options: 1, 5, 10, 15, 30 minutes
         .create();
       
       Logger.log('Time-based trigger created for processNewEmails');
     }
     ```
   - Dependencies: None
   - Risk: LOW - Standard Apps Script functionality

2. **Main Processing Function**
   - Action: Entry point for time-based trigger, orchestrates email processing
   - Why: Coordinate all classification and labeling activities
   - Implementation:
     ```javascript
     function processNewEmails() {
       // Prevent concurrent execution with LockService
       const lock = LockService.getScriptLock();
       if (!lock.tryLock(10000)) { // Wait up to 10 seconds for lock
         Logger.log('Another instance is running. Skipping this execution.');
         return;
       }
       
       const startTime = Date.now();
       const MAX_EXECUTION_TIME = 340000; // 5min 40sec safety margin (6min limit)
       
       try {
         // Initialize configuration on first run
         ConfigManager.initialize();
         
         // Get last processed timestamp for incremental processing
         const lastTimestamp = ConfigManager.getLastProcessedTimestamp();
         
         // Fetch new emails (unread or newer than last processed)
         const emails = GmailService.fetchNewEmails(lastTimestamp);
         
         if (emails.length === 0) {
           Logger.log('No new emails to process');
           return;
         }
         
         // Process emails in batches
         let processedCount = 0;
         for (const email of emails) {
           // Check execution time before processing each email
           if (Date.now() - startTime > MAX_EXECUTION_TIME) {
             Logger.log(`Approaching execution limit. Processed ${processedCount} emails.`);
             break;
           }
           
           // Classify and label
           const result = classifyEmail(email);
           applyClassificationLabel(email, result);
           
           processedCount++;
         }
         
         // Update last processed timestamp
         if (processedCount > 0) {
           const lastProcessed = emails[processedCount - 1];
           ConfigManager.setLastProcessedTimestamp(lastProcessed.date.getTime());
         }
         
         Logger.log(`Processed ${processedCount} emails successfully`);
         
       } catch (error) {
         handleError(error, 'processNewEmails');
       } finally {
         lock.releaseLock();
       }
     }
     
     // Bridge functions connecting top-level calls to service objects
     function classifyEmail(email) {
       return ClassificationRouter.classify(email);
     }
     
     function applyClassificationLabel(email, result) {
       LabelManager.applyLabelToEmail(email, result.label);
       ConfigManager.updateSenderHistory(email.from, result.label);
       ConfigManager.incrementStats(result.source);
       
       // Optional: Log to analytics
       if (typeof AnalyticsManager !== 'undefined') {
         try {
           AnalyticsManager.logClassification(email, result, Date.now());
         } catch (e) {
           Logger.log('Analytics logging skipped: ' + e.message);
         }
       }
     }
     
     function handleError(error, context) {
       const result = ErrorHandler.handleError(error, context);
       Logger.log(`Error handled in ${context}: ${JSON.stringify(result)}`);
       
       // Send email notification for critical errors
       if (result.action === 'retry') {
         Logger.log('Will retry on next trigger execution.');
       }
     }
     ```
   - Dependencies: GmailService.gs, Classifier.gs, Config.gs, LockService
   - Risk: MEDIUM - Must handle execution time limits and concurrent execution carefully

3. **Manual Trigger for Testing**
   - Action: Allow manual testing from Script Editor
   - Why: Debug and validate classification logic
   - Implementation:
     ```javascript
     function testClassification() {
       // Get last 5 emails for testing
       const threads = GmailApp.search('is:unread', 0, 5);
       
       for (const thread of threads) {
         const messages = thread.getMessages();
         for (const message of messages) {
           const email = GmailService.parseMessage(message);
           const result = classifyEmail(email);
           
           Logger.log(`Email: ${email.subject}`);
           Logger.log(`  → Label: ${result.label}`);
           Logger.log(`  → Confidence: ${result.confidence}`);
           Logger.log(`  → Source: ${result.source}`);
           
           // Don't actually apply labels in test mode
         }
       }
     }
     ```
   - Dependencies: None
   - Risk: LOW - Read-only operation

4. **Backfill Mode — Process All Historical Emails**
   - Action: Classify and label ALL existing emails (read + unread, past + present)
   - Why: The ongoing trigger only processes new unread emails. Backfill handles your entire email history.
   - Implementation:
     ```javascript
     /**
      * BACKFILL MODE: Process all historical emails (read + unread).
      * 
      * This runs across MULTIPLE trigger executions because you may have
      * thousands of emails. It tracks progress via an offset in
      * PropertiesService and picks up where it left off each run.
      *
      * Usage:
      *   1. Run startBackfill() once to begin
      *   2. It creates a trigger that runs backfillEmails() every 5 minutes
      *   3. Each run processes a batch within the 6-minute limit
      *   4. When complete, the trigger auto-deletes itself
      *
      * Optional: Pass a date range to limit scope:
      *   startBackfill('2024-01-01', '2025-12-31')
      */
     function startBackfill(afterDate, beforeDate) {
       const props = PropertiesService.getScriptProperties();
       
       // Build the search query — no 'is:unread' filter = ALL emails
       let query = '-label:backfill-processed'; // Skip already-processed
       if (afterDate) query += ' after:' + afterDate;
       if (beforeDate) query += ' before:' + beforeDate;
       
       // Store backfill state
       props.setProperty('backfill_status', 'running');
       props.setProperty('backfill_query', query);
       props.setProperty('backfill_offset', '0');
       props.setProperty('backfill_total_processed', '0');
       props.setProperty('backfill_started_at', new Date().toISOString());
       
       // Create a backfill label to mark processed threads
       GmailService.getOrCreateLabel('backfill-processed');
       
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
      * Called by the backfill trigger every 5 minutes.
      */
     function backfillEmails() {
       const lock = LockService.getScriptLock();
       if (!lock.tryLock(10000)) {
         Logger.log('Backfill: Another instance running. Skipping.');
         return;
       }
       
       const startTime = Date.now();
       const MAX_EXECUTION_TIME = 300000; // 5 minutes (conservative for backfill)
       
       try {
         const props = PropertiesService.getScriptProperties();
         const status = props.getProperty('backfill_status');
         
         if (status !== 'running') {
           Logger.log('Backfill is not active. Cleaning up trigger.');
           cleanupBackfillTrigger();
           return;
         }
         
         const query = props.getProperty('backfill_query');
         const offset = parseInt(props.getProperty('backfill_offset') || '0', 10);
         let totalProcessed = parseInt(props.getProperty('backfill_total_processed') || '0', 10);
         
         // Fetch next batch of threads
         const BATCH_SIZE = 100; // Process 100 threads per run
         const threads = GmailApp.search(query, offset, BATCH_SIZE);
         
         if (threads.length === 0) {
           // Backfill complete!
           props.setProperty('backfill_status', 'complete');
           props.setProperty('backfill_completed_at', new Date().toISOString());
           Logger.log('🎉 Backfill complete! Total emails processed: ' + totalProcessed);
           cleanupBackfillTrigger();
           return;
         }
         
         let batchProcessed = 0;
         const backfillLabel = GmailApp.getUserLabelByName('backfill-processed');
         
         for (const thread of threads) {
           // Check execution time
           if (Date.now() - startTime > MAX_EXECUTION_TIME) {
             Logger.log('Approaching time limit. Will continue in next run.');
             break;
           }
           
           const messages = thread.getMessages();
           
           for (const message of messages) {
             // Parse and classify
             const email = GmailService.parseMessage(message);
             const result = classifyEmail(email);
             
             // Apply the classification label to the thread
             LabelManager.applyLabelToEmail(email, result.label);
             ConfigManager.updateSenderHistory(email.from, result.label);
             ConfigManager.incrementStats(result.source);
             
             batchProcessed++;
             totalProcessed++;
           }
           
           // Mark thread as backfill-processed (prevents re-processing)
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
      */
     function getBackfillProgress() {
       const props = PropertiesService.getScriptProperties();
       const status = props.getProperty('backfill_status') || 'not_started';
       const total = props.getProperty('backfill_total_processed') || '0';
       const startedAt = props.getProperty('backfill_started_at') || '';
       const completedAt = props.getProperty('backfill_completed_at') || '';
       
       Logger.log('=== Backfill Status ===');
       Logger.log('Status: ' + status);
       Logger.log('Emails processed: ' + total);
       Logger.log('Started at: ' + startedAt);
       if (completedAt) Logger.log('Completed at: ' + completedAt);
       
       return { status, totalProcessed: parseInt(total, 10), startedAt, completedAt };
     }
     
     /**
      * Stop a running backfill. Run startBackfill() again to resume.
      */
     function stopBackfill() {
       const props = PropertiesService.getScriptProperties();
       props.setProperty('backfill_status', 'stopped');
       cleanupBackfillTrigger();
       Logger.log('Backfill stopped.');
     }
     
     /**
      * Remove the backfill trigger.
      */
     function cleanupBackfillTrigger() {
       ScriptApp.getProjectTriggers().forEach(function(trigger) {
         if (trigger.getHandlerFunction() === 'backfillEmails') {
           ScriptApp.deleteTrigger(trigger);
         }
       });
     }
     ```
   - Dependencies: GmailService.gs, Classifier.gs, Config.gs, LockService
   - Risk: MEDIUM - Must handle large email volumes across multiple execution runs
   - **Notes**:
     - Backfill runs on a **separate 5-minute trigger** (doesn't interfere with ongoing processing)
     - Uses a `backfill-processed` Gmail label to track which threads have been handled
     - Each run processes up to **100 threads** within a 5-minute window
     - Progress is stored in PropertiesService and survives across runs
     - Can be **stopped/resumed** at any time with `stopBackfill()` / `startBackfill()`
     - Optional date range: `startBackfill('2023-01-01', '2025-12-31')`
     - Cost with Gemini free tier: **$0.00** (1,500 requests/day handles ~5,000 emails/day through LLM)

---

## Gmail Service Integration

### File: `GmailService.gs`

**Purpose**: Wrapper for GmailApp operations with performance optimization

**Requirements**:

1. **Fetch New Emails**
   - Action: Retrieve new emails since last processed timestamp
   - Why: Incremental processing to avoid reprocessing
   - **Note**: Requires Gmail Advanced Service to be enabled for header extraction
   - Apps Script API:
     ```javascript
     const GmailService = {
       /**
        * Fetch new unread emails since the last processed timestamp.
        * Uses timestamp-based tracking (not message IDs) because Gmail
        * message IDs are opaque strings with no embedded timestamp.
        */
       fetchNewEmails: function(lastTimestamp) {
         const emails = [];
         let query = 'is:unread';
         
         // Use epoch-based date query for incremental processing
         if (lastTimestamp && lastTimestamp > 0) {
           // Gmail search 'after:' uses epoch seconds
           const epochSeconds = Math.floor(lastTimestamp / 1000);
           query += ` after:${epochSeconds}`;
         }
         
         // GmailApp.search returns threads, need to extract messages
         const threads = GmailApp.search(query, 0, 500); // Max 500 threads per call
         
         for (const thread of threads) {
           const messages = thread.getMessages();
           
           for (const message of messages) {
             // Skip emails older than our last processed timestamp
             if (lastTimestamp && message.getDate().getTime() <= lastTimestamp) {
               continue;
             }
             
             // Skip already-read messages
             if (!message.isUnread()) {
               continue;
             }
             
             // Parse message into our email format
             const email = this.parseMessage(message);
             emails.push(email);
           }
         }
         
         // Sort by date (oldest first for consistent processing)
         emails.sort((a, b) => a.date.getTime() - b.date.getTime());
         
         return emails;
       },
       
       parseMessage: function(message) {
         return {
           id: message.getId(),
           threadId: message.getThread().getId(),
           from: this.extractEmailAddress(message.getFrom()),
           to: message.getTo(),
           subject: message.getSubject(),
           body: this.extractBodyText(message),
           date: message.getDate(),
           headers: this.extractHeaders(message.getId()),
           isRead: !message.isUnread()
         };
       },
       
       extractBodyText: function(message) {
         // Get plain text body (GmailApp only provides plain text or HTML)
         let body = message.getPlainBody();
         
         // Truncate if too long (LLM token limit)
         const MAX_BODY_LENGTH = 5000;
         if (body && body.length > MAX_BODY_LENGTH) {
           body = body.substring(0, MAX_BODY_LENGTH) + '... [truncated]';
         }
         
         return body || '';
       },
       
       /**
        * Extract email headers using the Gmail Advanced Service (REST API).
        * GmailApp's GmailMessage class does NOT have a getHeader() method.
        * You must enable the Gmail Advanced Service in Apps Script:
        *   Services > Gmail API > Enable
        * @param {string} messageId - The Gmail message ID
        * @returns {Object} Key-value map of requested headers
        */
       extractHeaders: function(messageId) {
         try {
           // Gmail Advanced Service call (requires 'Gmail' service enabled)
           const msg = Gmail.Users.Messages.get('me', messageId, {
             format: 'metadata',
             metadataHeaders: ['List-Id', 'Precedence', 'X-Priority', 'Reply-To', 'List-Unsubscribe']
           });
           
           const headers = {};
           if (msg.payload && msg.payload.headers) {
             msg.payload.headers.forEach(function(h) {
               headers[h.name] = h.value;
             });
           }
           return headers;
         } catch (error) {
           Logger.log('Header extraction failed (Gmail Advanced Service may not be enabled): ' + error.message);
           return {};
         }
       },
       
       extractEmailAddress: function(fromString) {
         // Extract email from "Name <email@domain.com>" format
         const match = fromString.match(/<([^>]+)>/);
         return match ? match[1] : fromString;
       }
     };
     ```
   - Dependencies: Config.gs, Gmail Advanced Service (must be enabled)
   - Risk: LOW - Standard GmailApp usage + Gmail Advanced Service for headers

2. **Apply Labels**
   - Action: Apply Gmail labels to email threads
   - Why: Execute classification decisions
   - **Important**: Gmail labels are applied at the **thread** level, not the message level.
     `GmailMessage` does NOT have `addLabel()`/`removeLabel()` methods — only `GmailThread` does.
   - Apps Script API:
     ```javascript
     const GmailService = {
       // ... existing methods ...
       
       /**
        * Apply a label to an email's thread.
        * IMPORTANT: Gmail labels are thread-level, not message-level.
        * GmailMessage does NOT have addLabel() — use GmailThread instead.
        */
       applyLabel: function(email, labelName) {
         // Get or create label
         const label = this.getOrCreateLabel(labelName);
         
         // Get the Gmail thread (NOT message — labels are thread-level)
         const thread = GmailApp.getThreadById(email.threadId);
         
         // Apply label to thread
         thread.addLabel(label);
         
         Logger.log(`Applied label "${labelName}" to thread for "${email.subject}"`);
       },
       
       getOrCreateLabel: function(labelName) {
         // Gmail label names can use "/" for hierarchy
         // e.g., "Finance/Invoices" creates nested labels
         
         let label = GmailApp.getUserLabelByName(labelName);
         
         if (!label) {
           // Create new label
           label = GmailApp.createLabel(labelName);
           Logger.log(`Created new label: ${labelName}`);
         }
         
         return label;
       },
       
       removeLabel: function(email, labelName) {
         const label = GmailApp.getUserLabelByName(labelName);
         if (label) {
           // Use thread, not message
           const thread = GmailApp.getThreadById(email.threadId);
           thread.removeLabel(label);
         }
       },
       
       batchApplyLabels: function(emails, labelName) {
         // Batch operation for performance
         const label = this.getOrCreateLabel(labelName);
         
         // Use a Set to avoid applying labels to the same thread twice
         const processedThreads = new Set();
         
         for (const email of emails) {
           if (processedThreads.has(email.threadId)) continue;
           
           try {
             const thread = GmailApp.getThreadById(email.threadId);
             thread.addLabel(label);
             processedThreads.add(email.threadId);
           } catch (error) {
             Logger.log(`Error applying label to thread ${email.threadId}: ${error.message}`);
           }
         }
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Standard GmailApp thread operations

3. **Performance Optimizations**
   - Action: Minimize API calls and optimize batch processing
   - Why: Respect Apps Script quotas and execution time limits
   - Implementation:
     ```javascript
     const GmailService = {
       // ... existing methods ...
       
       // Cache for label objects
       _labelCache: null,
       
       getAllLabels: function() {
         if (!this._labelCache) {
           this._labelCache = GmailApp.getUserLabels();
         }
         return this._labelCache;
       },
       
       // Use search efficiently with pagination
       searchPaginated: function(query, maxResults) {
         const allEmails = [];
         let start = 0;
         const batchSize = 100; // GmailApp max per call
         
         while (allEmails.length < maxResults) {
           const threads = GmailApp.search(query, start, batchSize);
           
           if (threads.length === 0) break;
           
           for (const thread of threads) {
             const messages = thread.getMessages();
             for (const message of messages) {
               allEmails.push(this.parseMessage(message));
               
               if (allEmails.length >= maxResults) break;
             }
             if (allEmails.length >= maxResults) break;
           }
           
           start += batchSize;
         }
         
         return allEmails;
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Performance optimization

---

## Rule-Based Classification Engine

### File: `Classifier.gs` (Part 1: Rule Engine)

**Purpose**: Fast classification using predefined rules without LLM calls

**Requirements**:

1. **Rule Definition Structure**
   - Action: Define rule schema compatible with Apps Script
   - Why: Structured rule format for easy configuration
   - Implementation:
     ```javascript
     // Rule structure (stored as JSON in PropertiesService)
     const RuleTypes = {
       SENDER: 'sender',
       KEYWORD: 'keyword',
       PATTERN: 'pattern',
       HEADER: 'header',
       COMPOSITE: 'composite'
     };
     
     // Example rule definition
     const exampleRule = {
       id: 'amazon-orders',
       type: 'sender',
       patterns: [
         { field: 'domain', match: 'contains', value: 'amazon' }
       ],
       label: 'Shopping',
       confidence: 0.85,
       priority: 100,
       enabled: true
     };
     ```
   - Dependencies: None
   - Risk: LOW - Data structure definition

2. **Rule Evaluation Engine**
   - Action: Evaluate email against all rules, return best match
   - Why: Fast path classification without LLM
   - Implementation:
     ```javascript
     const RuleEngine = {
       evaluate: function(email, rules) {
         // Sort rules by priority (highest first)
         const sortedRules = rules
           .filter(r => r.enabled)
           .sort((a, b) => b.priority - a.priority);
         
         let bestMatch = null;
         let bestConfidence = 0;
         
         for (const rule of sortedRules) {
           const match = this.matchRule(rule, email);
           
           if (match && rule.confidence > bestConfidence) {
             bestMatch = {
               label: rule.label,
               confidence: rule.confidence,
               matchedRule: rule,
               source: 'rule'
             };
             bestConfidence = rule.confidence;
             
             // Early exit if we find a very high confidence match
             if (rule.confidence >= 0.95) {
               break;
             }
           }
         }
         
         return bestMatch;
       },
       
       matchRule: function(rule, email) {
         switch (rule.type) {
           case 'sender':
             return this.matchSenderRule(rule, email);
           case 'keyword':
             return this.matchKeywordRule(rule, email);
           case 'pattern':
             return this.matchPatternRule(rule, email);
           case 'header':
             return this.matchHeaderRule(rule, email);
           case 'composite':
             return this.matchCompositeRule(rule, email);
           default:
             return false;
         }
       },
       
       matchSenderRule: function(rule, email) {
         const fromEmail = email.from.toLowerCase();
         const fromDomain = fromEmail.split('@')[1] || '';
         
         for (const pattern of rule.patterns) {
           const value = pattern.value.toLowerCase();
           
           switch (pattern.match) {
             case 'exact':
               if (fromEmail === value) return true;
               break;
             case 'contains':
               if (fromEmail.includes(value) || fromDomain.includes(value)) return true;
               break;
             case 'regex':
               if (new RegExp(value, 'i').test(fromEmail)) return true;
               break;
             case 'domain':
               if (fromDomain === value || fromDomain.endsWith('.' + value)) return true;
               break;
           }
         }
         
         return false;
       },
       
       matchKeywordRule: function(rule, email) {
         const subject = email.subject.toLowerCase();
         const body = (email.body || '').toLowerCase();
         
         for (const pattern of rule.patterns) {
           const keywords = pattern.keywords.map(k => k.toLowerCase());
           const location = pattern.location || 'both';
           const matchType = pattern.match || 'any';
           
           let foundCount = 0;
           
           for (const keyword of keywords) {
             let found = false;
             
             if (location === 'subject' || location === 'both') {
               found = found || subject.includes(keyword);
             }
             if (location === 'body' || location === 'both') {
               found = found || body.includes(keyword);
             }
             
             if (found) foundCount++;
             
             if (matchType === 'any' && found) return true;
             if (matchType === 'all' && !found) return false;
           }
           
           if (matchType === 'all' && foundCount === keywords.length) return true;
         }
         
         return false;
       },
       
       matchPatternRule: function(rule, email) {
         for (const pattern of rule.patterns) {
           const regex = new RegExp(pattern.regex, pattern.flags || 'i');
           const location = pattern.location || 'both';
           
           let textToSearch = '';
           if (location === 'subject') textToSearch = email.subject;
           else if (location === 'body') textToSearch = email.body || '';
           else textToSearch = email.subject + ' ' + (email.body || '');
           
           if (regex.test(textToSearch)) return true;
         }
         
         return false;
       },
       
       matchHeaderRule: function(rule, email) {
         for (const pattern of rule.patterns) {
           const headerValue = email.headers[pattern.header];
           
           if (!headerValue && pattern.match === 'exists') {
             return false;
           }
           if (headerValue && pattern.match === 'exists') {
             return true;
           }
           
           if (pattern.match === 'exact' && headerValue === pattern.value) return true;
           if (pattern.match === 'contains' && headerValue && headerValue.includes(pattern.value)) return true;
           if (pattern.match === 'regex' && new RegExp(pattern.value, 'i').test(headerValue)) return true;
         }
         
         return false;
       },
       
       matchCompositeRule: function(rule, email) {
         const results = rule.rules.map(r => this.matchRule(r, email));
         
         switch (rule.operator) {
           case 'and':
             return results.every(r => r);
           case 'or':
             return results.some(r => r);
           case 'not':
             return !results[0]; // Single rule for NOT
           default:
             return false;
         }
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Pure logic, no external calls

3. **Default Rule Library**
   - Action: Predefined rules for common email categories
   - Why: Jumpstart classification without LLM for common patterns
   - Implementation:
     ```javascript
     const DEFAULT_RULES = [
       // E-commerce / Shopping
       {
         id: 'amazon-domain',
         type: 'sender',
         patterns: [{ field: 'domain', match: 'contains', value: 'amazon' }],
         label: 'Shopping',
         confidence: 0.85,
         priority: 100,
         enabled: true
       },
       {
         id: 'order-keywords',
         type: 'keyword',
         patterns: [{
           location: 'subject',
           keywords: ['order', 'confirmation', 'shipped', 'delivered', 'tracking'],
           match: 'any'
         }],
         label: 'Shopping',
         confidence: 0.80,
         priority: 90,
         enabled: true
       },
       
       // Newsletters
       {
         id: 'list-id-header',
         type: 'header',
         patterns: [{ header: 'List-Id', match: 'exists' }],
         label: 'Newsletters',
         confidence: 0.95,
         priority: 150,
         enabled: true
       },
       {
         id: 'unsubscribe-keyword',
         type: 'keyword',
         patterns: [{
           location: 'body',
           keywords: ['unsubscribe', 'opt out', 'manage preferences', 'email preferences'],
           match: 'any'  // Changed from 'all' — most newsletters have only ONE of these
         }],
         label: 'Newsletters',
         confidence: 0.70,
         priority: 50,
         enabled: true
       },
       
       // Finance
       {
         id: 'finance-keywords',
         type: 'keyword',
         patterns: [{
           location: 'subject',
           keywords: ['invoice', 'receipt', 'payment', 'transaction', 'statement'],
           match: 'any'
         }],
         label: 'Finance',
         confidence: 0.85,
         priority: 100,
         enabled: true
       },
       
       // Travel
       {
         id: 'travel-pattern',
         type: 'pattern',
         patterns: [{
           regex: '\\b(booking|reservation|flight|hotel)\\s+(confirmation|details)\\b',
           location: 'subject',
           flags: 'i'
         }],
         label: 'Travel',
         confidence: 0.90,
         priority: 110,
         enabled: true
       },
       
       // Work / Meetings
       {
         id: 'meeting-keywords',
         type: 'keyword',
         patterns: [{
           location: 'subject',
           keywords: ['meeting', 'calendar invite', 'schedule', 'appointment'],
           match: 'any'
         }],
         label: 'Work',
         confidence: 0.75,
         priority: 85,
         enabled: true
       },
       
       // Marketing / Promotions
       {
         id: 'marketing-composite',
         type: 'composite',
         operator: 'and',
         rules: [
           {
             type: 'keyword',
             patterns: [{
               location: 'subject',
               keywords: ['free', 'limited time', 'act now', 'special offer'],
               match: 'any'
             }],
             label: 'Marketing',
             confidence: 0.6,
             priority: 30,
             enabled: true
           },
           {
             type: 'keyword',
             patterns: [{
               location: 'body',
               keywords: ['click here', 'buy now', 'subscribe'],
               match: 'any'
             }],
             label: 'Marketing',
             confidence: 0.6,
             priority: 30,
             enabled: true
           }
         ],
         label: 'Marketing',
         confidence: 0.75,
         priority: 60,
         enabled: true
       }
     ];
     ```
   - Dependencies: None
   - Risk: LOW - Configuration data

---

## LLM Classification Engine

### File: `LLMClient.gs`

**Purpose**: External LLM API integration for complex email classification

**Requirements**:

1. **UrlFetchApp Integration**
   - Action: Make HTTP requests to LLM APIs (Google Gemini, OpenAI, Anthropic)
   - Why: Fallback classification for ambiguous emails
   - **Recommended**: Use **Google Gemini** (free tier: 1,500 requests/day, no credit card needed)
   - Implementation:
     ```javascript
     const LLMClient = {
       // Configuration stored in Script Properties
       API_KEY: null,
       API_PROVIDER: 'gemini', // 'gemini' (free, recommended), 'openai', or 'anthropic'
       MODEL: 'gemini-2.0-flash', // Free, fast, and capable for classification
       MAX_TOKENS: 150,
       TIMEOUT_MS: 25000, // 25 second timeout (within 30s limit)
       
       initialize: function() {
         const props = PropertiesService.getScriptProperties();
         this.API_KEY = props.getProperty('LLM_API_KEY');
         this.API_PROVIDER = props.getProperty('LLM_PROVIDER') || 'gemini';
         this.MODEL = props.getProperty('LLM_MODEL') || 'gemini-2.0-flash';
         
         if (!this.API_KEY) {
           throw new Error('LLM API key not configured. Set LLM_API_KEY in Script Properties. ' +
             'Get a free Gemini API key from https://aistudio.google.com/apikey');
         }
       },
       
       classify: function(email, labels) {
         if (!this.API_KEY) {
           this.initialize();
         }
         
         const prompt = this.buildPrompt(email, labels);
         
         try {
           let response;
           
           if (this.API_PROVIDER === 'openai') {
             response = this.callOpenAI(prompt);
           } else if (this.API_PROVIDER === 'anthropic') {
             response = this.callAnthropic(prompt);
           } else {
             throw new Error('Unsupported LLM provider: ' + this.API_PROVIDER);
           }
           
           return this.parseResponse(response);
           
         } catch (error) {
           Logger.log('LLM API error: ' + error.message);
           return {
             label: 'Uncategorized',
             confidence: 0.3,
             source: 'llm-error',
             reasoning: 'LLM API call failed: ' + error.message
           };
         }
       },
       
       buildPrompt: function(email, labels) {
         const labelList = labels.map(l => `- ${l.name}`).join('\n');
         
         const prompt = `Classify this email into exactly one of the following labels:
     ${labelList}
     
     Email Details:
     - From: ${email.from}
     - Subject: ${email.subject}
     - Preview: ${email.body.substring(0, 500)}
     
     Respond in JSON format only:
     {
       "label": "exact_label_name",
       "confidence": 0.0_to_1.0,
       "reasoning": "brief explanation"
     }`;
         
         return prompt;
       },
       
       /**
        * Call Google Gemini API (FREE tier: 1,500 requests/day).
        * Get API key from: https://aistudio.google.com/apikey
        * No credit card required. Best fit for Apps Script (same Google ecosystem).
        */
       callGemini: function(prompt) {
         const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + 
           this.MODEL + ':generateContent?key=' + this.API_KEY;
         
         const payload = {
           contents: [
             {
               parts: [
                 {
                   text: 'You are an email classification assistant. Respond only with valid JSON containing "label", "confidence", and "reasoning" fields.\n\n' + prompt
                 }
               ]
             }
           ],
           generationConfig: {
             temperature: 0.1,
             maxOutputTokens: this.MAX_TOKENS
           }
         };
         
         const options = {
           method: 'post',
           contentType: 'application/json',
           payload: JSON.stringify(payload),
           muteHttpExceptions: true
         };
         
         const response = UrlFetchApp.fetch(url, options);
         const responseCode = response.getResponseCode();
         const responseText = response.getContentText();
         
         if (responseCode !== 200) {
           throw new Error('Gemini API error ' + responseCode + ': ' + responseText);
         }
         
         const json = JSON.parse(responseText);
         
         // Gemini response structure: candidates[0].content.parts[0].text
         if (json.candidates && json.candidates[0] && json.candidates[0].content) {
           return json.candidates[0].content.parts[0].text;
         }
         
         throw new Error('Unexpected Gemini response format');
       },
       
       callOpenAI: function(prompt) {
         const url = 'https://api.openai.com/v1/chat/completions';
         
         const payload = {
           model: this.MODEL,
           messages: [
             {
               role: 'system',
               content: 'You are an email classification assistant. Respond only with valid JSON containing "label", "confidence", and "reasoning" fields.'
             },
             {
               role: 'user',
               content: prompt
             }
           ],
           max_tokens: this.MAX_TOKENS,
           temperature: 0.1 // Low temperature for consistency
         };
         
         const options = {
           method: 'post',
           headers: {
             'Authorization': 'Bearer ' + this.API_KEY,
             'Content-Type': 'application/json'
           },
           payload: JSON.stringify(payload),
           muteHttpExceptions: true
         };
         
         const response = UrlFetchApp.fetch(url, options);
         const responseCode = response.getResponseCode();
         const responseText = response.getContentText();
         
         if (responseCode !== 200) {
           throw new Error(`OpenAI API error ${responseCode}: ${responseText}`);
         }
         
         const json = JSON.parse(responseText);
         return json.choices[0].message.content;
       },
       
       callAnthropic: function(prompt) {
         const url = 'https://api.anthropic.com/v1/messages';
         
         const payload = {
           model: this.MODEL,
           max_tokens: this.MAX_TOKENS,
           system: 'You are an email classification assistant. Respond only with valid JSON containing "label", "confidence", and "reasoning" fields.',
           messages: [
             {
               role: 'user',
               content: prompt
             }
           ]
         };
         
         const options = {
           method: 'post',
           headers: {
             'x-api-key': this.API_KEY,
             'Content-Type': 'application/json',
             'anthropic-version': '2023-06-01'
           },
           payload: JSON.stringify(payload),
           muteHttpExceptions: true
         };
         
         const response = UrlFetchApp.fetch(url, options);
         const responseCode = response.getResponseCode();
         const responseText = response.getContentText();
         
         if (responseCode !== 200) {
           throw new Error(`Anthropic API error ${responseCode}: ${responseText}`);
         }
         
         const json = JSON.parse(responseText);
         return json.content[0].text;
       },
       
       parseResponse: function(responseText) {
         try {
           // Extract JSON from response (handle markdown code blocks)
           let jsonStr = responseText;
           
           const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
           if (jsonMatch) {
             jsonStr = jsonMatch[1];
           } else {
             // Try to find raw JSON
             const rawMatch = responseText.match(/\{[\s\S]*\}/);
             if (rawMatch) {
               jsonStr = rawMatch[0];
             }
           }
           
           const parsed = JSON.parse(jsonStr);
           
           // Validate required fields
           if (!parsed.label || typeof parsed.confidence !== 'number') {
             throw new Error('Missing required fields in LLM response');
           }
           
           // Clamp confidence to 0-1 range
           parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
           
           return {
             label: parsed.label,
             confidence: parsed.confidence,
             reasoning: parsed.reasoning || 'No reasoning provided',
             source: 'llm'
           };
           
         } catch (error) {
           Logger.log('Failed to parse LLM response: ' + error.message);
           
           // Fallback parsing
           const labelMatch = responseText.match(/label["']?\s*:\s*["']([^"']+)["']/i);
           const confidenceMatch = responseText.match(/confidence["']?\s*:\s*([\d.]+)/i);
           
           return {
             label: labelMatch ? labelMatch[1] : 'Uncategorized',
             confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.3,
             reasoning: 'Parsed from malformed response',
             source: 'llm-fallback'
           };
         }
       }
     };
     ```
   - Dependencies: Config.gs (for API key)
   - Risk: MEDIUM - External API call, handle errors gracefully

2. **Cost Optimization Strategies**
   - Action: Minimize token usage and API calls
   - Why: Reduce LLM costs while maintaining accuracy
   - Implementation:
     ```javascript
     const LLMClient = {
       // ... existing methods ...
       
       // Smart truncation to reduce token count
       truncateEmailContent: function(email) {
         // Prioritize: Subject > From > First 500 chars of body
         const parts = [
           'Subject: ' + email.subject,
           'From: ' + email.from
         ];
         
         // Add truncated body
         const bodyPreview = (email.body || '').substring(0, 500);
         if (bodyPreview) {
           parts.push('Body: ' + bodyPreview);
         }
         
         return parts.join('\n\n');
       },
       
       // Batch classification (if processing multiple emails)
       classifyBatch: function(emails, labels) {
         const results = [];
         
         // Group similar emails to potentially reduce API calls
         // For now, process individually
         for (const email of emails) {
           const result = this.classify(email, labels);
           results.push(result);
           
           // Small delay between API calls to avoid rate limits
           Utilities.sleep(100);
         }
         
         return results;
       },
       
       // Model selection based on provider and complexity
       selectModel: function(email, complexity) {
         if (this.API_PROVIDER === 'gemini') {
           // Gemini models (all free tier)
           return complexity === 'high' ? 'gemini-2.0-flash' : 'gemini-2.0-flash';
         }
         // OpenAI models (paid)
         if (complexity === 'low' || complexity === 'medium') {
           return 'gpt-4o-mini'; // Cheapest
         }
         return 'gpt-4o'; // Most capable
       },
       
       assessComplexity: function(email) {
         const bodyLength = (email.body || '').length;
         const hasAttachments = email.attachments && email.attachments.length > 0;
         const hasSpecialChars = /[^\x00-\x7F]/.test(email.subject + (email.body || ''));
         
         let complexity = 'low';
         
         if (bodyLength > 2000 || hasAttachments) {
           complexity = 'high';
         } else if (bodyLength > 500 || hasSpecialChars) {
           complexity = 'medium';
         }
         
         return complexity;
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Performance optimization

---

## Confidence Scoring & Threshold Logic

### File: `Classifier.gs` (Part 2: Confidence Logic)

**Purpose**: Determine when to use rule-based vs LLM classification

**Requirements**:

1. **Confidence Calculator**
   - Action: Calculate confidence score for rule-based matches
   - Why: Route emails appropriately between fast path and LLM
   - Implementation:
     ```javascript
     const ConfidenceScorer = {
       // Default weights for confidence factors
       WEIGHTS: {
         ruleMatchStrength: 0.25,
         ruleSpecificity: 0.25,
         emailClarity: 0.20,
         historicalAccuracy: 0.15,
         senderReputation: 0.15
       },
       
       calculateConfidence: function(rule, email) {
         const factors = {
           ruleMatchStrength: this.calculateMatchStrength(rule, email),
           ruleSpecificity: this.calculateSpecificity(rule),
           emailClarity: this.assessEmailClarity(email),
           historicalAccuracy: this.getHistoricalAccuracy(rule.id),
           senderReputation: this.getSenderReputation(email.from)
         };
         
         let score = 0;
         score += factors.ruleMatchStrength * this.WEIGHTS.ruleMatchStrength;
         score += factors.ruleSpecificity * this.WEIGHTS.ruleSpecificity;
         score += factors.emailClarity * this.WEIGHTS.emailClarity;
         score += factors.historicalAccuracy * this.WEIGHTS.historicalAccuracy;
         score += factors.senderReputation * this.WEIGHTS.senderReputation;
         
         return Math.max(0, Math.min(1, score));
       },
       
       calculateMatchStrength: function(rule, email) {
         // How many patterns matched?
         const patternCount = rule.patterns ? rule.patterns.length : 1;
         // For single pattern rules, assume full match
         return rule.confidence || 0.7;
       },
       
       calculateSpecificity: function(rule) {
         // Domain-specific rules are more specific
         if (rule.type === 'composite') return 0.95;
         if (rule.type === 'header') return 0.90;
         if (rule.type === 'sender') return 0.85;
         if (rule.type === 'pattern') return 0.75;
         if (rule.type === 'keyword') return 0.60;
         return 0.50;
       },
       
       assessEmailClarity: function(email) {
         let clarity = 1.0;
         
         if (!email.subject || email.subject.length < 5) clarity -= 0.2;
         if (!email.body || email.body.length < 50) clarity -= 0.1;
         if (this.hasUnusualCharacters(email)) clarity -= 0.2;
         
         return Math.max(0, clarity);
       },
       
       hasUnusualCharacters: function(email) {
         const text = email.subject + (email.body || '');
         // Check for excessive special characters or unusual patterns
         const unusualCount = (text.match(/[^\x00-\x7F]/g) || []).length;
         return unusualCount > text.length * 0.3;
       },
       
       getHistoricalAccuracy: function(ruleId) {
         // Retrieve from Analytics (if available)
         const stats = AnalyticsManager.getRuleStats(ruleId);
         if (stats && stats.total > 0) {
           return stats.correct / stats.total;
         }
         return 0.8; // Default
       },
       
       getSenderReputation: function(senderEmail) {
         // Retrieve sender history from PropertiesService
         const senderHistory = ConfigManager.getSenderHistory(senderEmail);
         if (senderHistory && senderHistory.total > 0) {
           return senderHistory.accuracy;
         }
         return 0.5; // Unknown sender
       }
     };
     ```
   - Dependencies: Config.gs, Analytics.gs
   - Risk: LOW - Pure calculation

2. **Threshold Manager**
   - Action: Compare confidence against thresholds for routing decisions
   - Why: Decide when to use LLM vs accept rule result
   - Implementation:
     ```javascript
     const ThresholdManager = {
       // Default thresholds
       CONFIG: {
         ruleConfidenceThreshold: 0.75,  // Minimum confidence for rule-based
         autoApplyThreshold: 0.85,       // Auto-apply without review
         reviewThreshold: 0.60,          // Queue for manual review
         llmConfidenceThreshold: 0.50   // Minimum confidence from LLM
       },
       
       shouldUseRule: function(confidence) {
         return confidence >= this.CONFIG.ruleConfidenceThreshold;
       },
       
       shouldAutoApply: function(confidence) {
         return confidence >= this.CONFIG.autoApplyThreshold;
       },
       
       shouldRequestReview: function(confidence) {
         return confidence < this.CONFIG.autoApplyThreshold && 
                confidence >= this.CONFIG.reviewThreshold;
       },
       
       shouldEscalateToLLM: function(confidence) {
         return confidence < this.CONFIG.ruleConfidenceThreshold;
       },
       
       adjustThresholds: function(feedback) {
         // Adaptive threshold adjustment based on user feedback
         // If user frequently corrects rules, increase threshold
         const props = PropertiesService.getUserProperties();
         const correctionRate = this.calculateCorrectionRate();
         
         if (correctionRate > 0.1) { // More than 10% corrections
           this.CONFIG.ruleConfidenceThreshold = Math.min(
             0.90,
             this.CONFIG.ruleConfidenceThreshold + 0.05
           );
         }
         
         // Store adjusted thresholds
         props.setProperty('thresholds', JSON.stringify(this.CONFIG));
       },
       
       calculateCorrectionRate: function() {
         const stats = AnalyticsManager.getOverallStats();
         if (stats.total === 0) return 0;
         return stats.corrections / stats.total;
       },
       
       loadThresholds: function() {
         const props = PropertiesService.getUserProperties();
         const stored = props.getProperty('thresholds');
         
         if (stored) {
           try {
             this.CONFIG = JSON.parse(stored);
           } catch (e) {
             Logger.log('Failed to load thresholds, using defaults');
           }
         }
       }
     };
     ```
   - Dependencies: Config.gs
   - Risk: LOW - Configuration management

3. **Classification Router**
   - Action: Route email to appropriate classifier based on confidence
   - Why: Orchestrate fast path vs LLM fallback
   - Implementation:
     ```javascript
     const ClassificationRouter = {
       classify: function(email) {
         // Load thresholds
         ThresholdManager.loadThresholds();
         
         // Step 1: Try rule-based classification
         const rules = ConfigManager.getRules();
         const ruleResult = RuleEngine.evaluate(email, rules);
         
         if (ruleResult && ThresholdManager.shouldUseRule(ruleResult.confidence)) {
           // High confidence rule match
           return {
             label: ruleResult.label,
             confidence: ruleResult.confidence,
             source: 'rule',
             matchedRule: ruleResult.matchedRule.id
           };
         }
         
         // Step 2: Escalate to LLM if confidence is low
         if (!ruleResult || ThresholdManager.shouldEscalateToLLM(ruleResult.confidence)) {
           const labels = ConfigManager.getLabels();
           const llmResult = LLMClient.classify(email, labels);
           
           // Step 3: Compare results if both available
           if (ruleResult && llmResult.label === ruleResult.label) {
             // LLM agrees with rule - boost confidence
             return {
               label: ruleResult.label,
               confidence: Math.min(1, ruleResult.confidence + 0.15),
               source: 'rule+llm-consensus',
               reasoning: llmResult.reasoning
             };
           }
           
           // Return LLM result
           return llmResult;
         }
         
         // Step 3: Medium confidence - return rule result
         return {
           label: ruleResult.label,
           confidence: ruleResult.confidence,
           source: 'rule',
           matchedRule: ruleResult.matchedRule.id
         };
       }
     };
     ```
   - Dependencies: RuleEngine, LLMClient, ConfigManager, ThresholdManager
   - Risk: MEDIUM - Orchestrates multiple components

---

## Gmail Label Management

### File: `GmailService.gs` (Extended)

**Purpose**: Create and manage Gmail labels dynamically

**Requirements**:

1. **Label Taxonomy Management**
   - Action: Define and sync label structure with Gmail
   - Why: Organize emails with hierarchical labels
   - Implementation:
     ```javascript
     const LabelManager = {
       // Default label taxonomy
       DEFAULT_TAXONOMY: [
         { name: 'Shopping', description: 'Online purchases and orders', priority: 80 },
         { name: 'Finance', description: 'Financial transactions and statements', priority: 110 },
         { name: 'Finance/Invoices', description: 'Invoices and bills', priority: 115 },
         { name: 'Finance/Receipts', description: 'Purchase receipts', priority: 115 },
         { name: 'Work', description: 'Work-related emails', priority: 100 },
         { name: 'Work/Projects', description: 'Project communications', priority: 95 },
         { name: 'Work/Meetings', description: 'Meeting invites and notes', priority: 95 },
         { name: 'Travel', description: 'Travel bookings and itineraries', priority: 70 },
         { name: 'Newsletters', description: 'Newsletter subscriptions', priority: 60 },
         { name: 'Marketing', description: 'Marketing and promotional emails', priority: 50 },
         { name: 'Personal', description: 'Personal correspondence', priority: 90 },
         { name: 'Uncategorized', description: 'Emails needing manual review', priority: 10 }
       ],
       
       initialize: function() {
         // Ensure all default labels exist in Gmail
         for (const labelDef of this.DEFAULT_TAXONOMY) {
           this.getOrCreateLabel(labelDef.name, labelDef.description);
         }
         
         Logger.log('Label taxonomy initialized');
       },
       
       getOrCreateLabel: function(labelName, description) {
         // Gmail label names can use "/" for hierarchy
         let label = GmailApp.getUserLabelByName(labelName);
         
         if (!label) {
           label = GmailApp.createLabel(labelName);
           Logger.log('Created label: ' + labelName);
         }
         
         // Store label metadata in PropertiesService
         ConfigManager.storeLabel({
           name: labelName,
           description: description || '',
           gmailId: label.getName()
         });
         
         return label;
       },
       
       getAllLabels: function() {
         // Get from cache or Gmail
         const cached = CacheService.getScriptCache().get('all_labels');
         
         if (cached) {
           return JSON.parse(cached);
         }
         
         const labels = GmailApp.getUserLabels();
         const labelData = labels.map(l => ({
           name: l.getName(),
           gmailId: l.getName()
         }));
         
         // Cache for 1 hour
         CacheService.getScriptCache().put('all_labels', JSON.stringify(labelData), 3600);
         
         return labelData;
       },
       
       syncLabels: function() {
         // Sync between PropertiesService and Gmail
         const storedLabels = ConfigManager.getLabels();
         const gmailLabels = this.getAllLabels();
         
         // Find labels in storage but not in Gmail
         for (const stored of storedLabels) {
           if (!gmailLabels.some(g => g.name === stored.name)) {
             // Create in Gmail
             GmailApp.createLabel(stored.name);
           }
         }
         
         // Find labels in Gmail but not in storage
         for (const gmail of gmailLabels) {
           if (!storedLabels.some(s => s.name === gmail.name)) {
             // Add to storage
             ConfigManager.storeLabel({
               name: gmail.name,
               description: ''
             });
           }
         }
         
         Logger.log('Labels synced');
       }
     };
     ```
   - Dependencies: Config.gs
   - Risk: LOW - Standard GmailApp operations

2. **Apply Labels to Emails**
   - Action: Apply classification results to Gmail threads
   - Why: Execute the classification decision
   - **Important**: Labels are applied at the thread level in Gmail, not the message level.
   - Implementation:
     ```javascript
     const LabelManager = {
       // ... existing methods ...
       
       /**
        * Apply a label to an email's thread.
        * IMPORTANT: Gmail labels are thread-level, not message-level.
        * GmailMessage does NOT have addLabel() — only GmailThread does.
        */
       applyLabelToEmail: function(email, labelName) {
         try {
           const label = this.getOrCreateLabel(labelName);
           // Use thread (NOT message) — labels are thread-level in Gmail
           const thread = GmailApp.getThreadById(email.threadId);
           thread.addLabel(label);
           
           Logger.log(`Applied label "${labelName}" to thread for "${email.subject}"`);
           return true;
         } catch (error) {
           Logger.log(`Error applying label: ${error.message}`);
           return false;
         }
       },
       
       applyMultipleLabels: function(email, labelNames) {
         for (const labelName of labelNames) {
           this.applyLabelToEmail(email, labelName);
         }
       },
       
       removeLabelFromEmail: function(email, labelName) {
         try {
           const label = GmailApp.getUserLabelByName(labelName);
           if (label) {
             // Use thread (NOT message) — labels are thread-level in Gmail
             const thread = GmailApp.getThreadById(email.threadId);
             thread.removeLabel(label);
           }
         } catch (error) {
           Logger.log(`Error removing label: ${error.message}`);
         }
       },
       
       markAsProcessed: function(email) {
         // Optionally mark email as read or remove from inbox
         const message = GmailApp.getMessageById(email.id);
         message.markRead();
       }
     };
   - Dependencies: None
   - Risk: LOW - Standard GmailApp operations

---

## Performance Considerations

### File: `Code.gs` (Performance Utilities)

**Purpose**: Manage Apps Script execution limits and quotas

**Requirements**:

1. **Execution Time Management**
   - Action: Monitor and manage 6-minute execution limit
   - Why: Prevent script termination mid-processing
   - Implementation:
     ```javascript
     const PerformanceManager = {
       START_TIME: null,
       MAX_EXECUTION_TIME: 340000, // 5min 40sec (leave safety margin)
       MAX_EMAILS_PER_RUN: 100,    // Limit emails per execution
       
       startTimer: function() {
         this.START_TIME = Date.now();
       },
       
       getElapsedTime: function() {
         return Date.now() - this.START_TIME;
       },
       
       getRemainingTime: function() {
         return this.MAX_EXECUTION_TIME - this.getElapsedTime();
       },
       
       shouldContinue: function() {
         return this.getRemainingTime() > 30000; // 30 second buffer
       },
       
       checkAndResume: function(lastTimestamp) {
         if (!this.shouldContinue()) {
           // Store state and trigger continuation
           ConfigManager.setLastProcessedTimestamp(lastTimestamp);
           Logger.log('Approaching execution limit. Will resume on next trigger.');
           return false;
         }
         return true;
       },
       
       // Batch processing with time checks
       processBatch: function(items, processFn) {
         const results = [];
         
         for (let i = 0; i < items.length && i < this.MAX_EMAILS_PER_RUN; i++) {
           if (!this.shouldContinue()) {
             Logger.log(`Processed ${i} items before time limit`);
             break;
           }
           
           const result = processFn(items[i]);
           results.push(result);
           
           // Small delay between items to avoid quota issues
           Utilities.sleep(100);
         }
         
         return results;
       }
     };
     ```
   - Dependencies: None
   - Risk: MEDIUM - Critical for reliability

2. **Quota Management**
   - Action: Respect GmailApp and UrlFetchApp quotas
   - Why: Prevent quota exceeded errors
   - Implementation:
     ```javascript
     const QuotaManager = {
       // GmailApp quotas (varies by account type)
       // Free Gmail: ~100 read operations per minute
       // Google Workspace: higher limits
       // IMPORTANT: Do NOT sleep for 60 seconds inside the 6-minute execution limit.
       // Instead, return a signal to stop processing and resume on next trigger.
       
       READ_COUNT: 0,
       WRITE_COUNT: 0,
       API_COUNT: 0,
       QUOTA_EXCEEDED: false,
       
       reset: function() {
         this.READ_COUNT = 0;
         this.WRITE_COUNT = 0;
         this.API_COUNT = 0;
         this.QUOTA_EXCEEDED = false;
       },
       
       isQuotaExceeded: function() {
         return this.QUOTA_EXCEEDED;
       },
       
       checkReadQuota: function() {
         this.READ_COUNT++;
         
         // Conservative limit — do NOT sleep, just signal to stop
         if (this.READ_COUNT > 80) {
           Logger.log('Approaching read quota limit. Will resume on next trigger.');
           this.QUOTA_EXCEEDED = true;
           return false; // Signal caller to stop processing
         }
         return true;
       },
       
       checkWriteQuota: function() {
         this.WRITE_COUNT++;
         
         if (this.WRITE_COUNT > 50) {
           Logger.log('Approaching write quota limit. Will resume on next trigger.');
           this.QUOTA_EXCEEDED = true;
           return false;
         }
         return true;
       },
       
       checkApiQuota: function() {
         this.API_COUNT++;
         
         if (this.API_COUNT > 20) {
           Logger.log('Approaching API quota limit. Will resume on next trigger.');
           this.QUOTA_EXCEEDED = true;
           return false;
         }
         return true;
       }
     };
     ```
   - Dependencies: None
   - Risk: MEDIUM - Important for production reliability

---

## Error Handling & Retry Logic

### File: `Utils.gs`

**Purpose**: Robust error handling and retry mechanisms

**Requirements**:

1. **Error Types and Handling**
   - Action: Define error types and handling strategies
   - Why: Graceful degradation and recovery
   - Implementation:
     ```javascript
     const ErrorHandler = {
       ErrorTypes: {
         GMAIL_API_ERROR: 'GMAIL_API_ERROR',
         LLM_API_ERROR: 'LLM_API_ERROR',
         PARSE_ERROR: 'PARSE_ERROR',
         TIMEOUT_ERROR: 'TIMEOUT_ERROR',
         QUOTA_ERROR: 'QUOTA_ERROR',
         UNKNOWN_ERROR: 'UNKNOWN_ERROR'
       },
       
       classifyError: function(error) {
         const message = error.message.toLowerCase();
         
         if (message.includes('rate limit') || message.includes('quota')) {
           return this.ErrorTypes.QUOTA_ERROR;
         }
         if (message.includes('timeout')) {
           return this.ErrorTypes.TIMEOUT_ERROR;
         }
         if (message.includes('gmail')) {
           return this.ErrorTypes.GMAIL_API_ERROR;
         }
         if (message.includes('llm') || message.includes('api')) {
           return this.ErrorTypes.LLM_API_ERROR;
         }
         if (message.includes('parse') || message.includes('json')) {
           return this.ErrorTypes.PARSE_ERROR;
         }
         
         return this.ErrorTypes.UNKNOWN_ERROR;
       },
       
       handleError: function(error, context) {
         const errorType = this.classifyError(error);
         
         Logger.log(`Error in ${context}: ${errorType} - ${error.message}`);
         
         switch (errorType) {
           case this.ErrorTypes.QUOTA_ERROR:
             // Do NOT sleep here — will consume execution time budget.
             // Signal to stop processing; next trigger invocation will resume.
             return { action: 'stop', reason: 'quota_exceeded' };
             
           case this.ErrorTypes.TIMEOUT_ERROR:
             // Reduce batch size and retry
             return { action: 'retry', reduceBatch: true };
             
           case this.ErrorTypes.LLM_API_ERROR:
             // Fall back to rule-based or default
             return { action: 'fallback', useDefault: true };
             
           case this.ErrorTypes.PARSE_ERROR:
             // Use fallback parsing
             return { action: 'fallback', useFallbackParser: true };
             
           default:
             // Log and continue
             return { action: 'skip' };
         }
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Error handling framework

2. **Retry Logic**
   - Action: Exponential backoff retry for transient failures
   - Why: Recover from temporary errors
   - Implementation:
     ```javascript
     const RetryManager = {
       MAX_RETRIES: 3,
       BASE_DELAY: 1000,  // 1 second
       MAX_DELAY: 30000,  // 30 seconds
       
       executeWithRetry: function(operation, context) {
         let lastError = null;
         
         for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
           try {
             const result = operation();
             return { success: true, result: result };
           } catch (error) {
             lastError = error;
             
             const errorType = ErrorHandler.classifyError(error);
             
             // Don't retry non-retryable errors
             if (!this.isRetryable(errorType)) {
               break;
             }
             
             const delay = this.calculateDelay(attempt);
             Logger.log(`Retry ${attempt + 1}/${this.MAX_RETRIES} after ${delay}ms`);
             Utilities.sleep(delay);
           }
         }
         
         return { success: false, error: lastError };
       },
       
       calculateDelay: function(attempt) {
         // Exponential backoff with jitter
         const baseDelay = this.BASE_DELAY * Math.pow(2, attempt);
         const jitter = Math.random() * 1000;
         return Math.min(this.MAX_DELAY, baseDelay + jitter);
       },
       
       isRetryable: function(errorType) {
         const retryableErrors = [
           ErrorHandler.ErrorTypes.QUOTA_ERROR,
           ErrorHandler.ErrorTypes.TIMEOUT_ERROR,
           ErrorHandler.ErrorTypes.LLM_API_ERROR
         ];
         return retryableErrors.includes(errorType);
       }
     };
     ```
   - Dependencies: ErrorHandler
   - Risk: LOW - Standard retry pattern

3. **Fallback Mechanisms**
   - Action: Provide fallback classification when primary methods fail
   - Why: Ensure system never leaves emails unprocessed
   - Implementation:
     ```javascript
     const FallbackClassifier = {
       classify: function(email) {
         // Strategy 1: Use sender history
         const senderHistory = ConfigManager.getSenderHistory(email.from);
         if (senderHistory && senderHistory.total > 2) {
           return {
             label: senderHistory.mostCommon,
             confidence: 0.5,
             source: 'fallback-sender-history'
           };
         }
         
         // Strategy 2: Simple keyword match
         const keywordResult = this.simpleKeywordMatch(email);
         if (keywordResult) {
           return keywordResult;
         }
         
         // Strategy 3: Default to Uncategorized
         return {
           label: 'Uncategorized',
           confidence: 0.0,
           source: 'fallback-default'
         };
       },
       
       simpleKeywordMatch: function(email) {
         const keywordMap = {
           'invoice': 'Finance',
           'receipt': 'Finance',
           'order': 'Shopping',
           'meeting': 'Work',
           'newsletter': 'Newsletters',
           'booking': 'Travel',
           'reservation': 'Travel'
         };
         
         const subjectLower = email.subject.toLowerCase();
         const bodyLower = (email.body || '').toLowerCase();
         
         for (const [keyword, label] of Object.entries(keywordMap)) {
           if (subjectLower.includes(keyword) || bodyLower.includes(keyword)) {
             return {
               label: label,
               confidence: 0.4,
               source: 'fallback-keyword'
             };
           }
         }
         
         return null;
       }
     };
     ```
   - Dependencies: Config.gs
   - Risk: LOW - Simple fallback logic

---

## Configuration & User Preferences

### File: `Config.gs`

**Purpose**: Store and manage configuration via PropertiesService

**Requirements**:

1. **PropertiesService Integration**
   - Action: Use Script Properties for configuration storage
   - Why: Persistent storage without external database
   - Implementation:
     ```javascript
     const ConfigManager = {
       // Initialize default configuration
       initialize: function() {
         const props = PropertiesService.getScriptProperties();
         
         // Set defaults if not already set
         if (!props.getProperty('initialized')) {
           // Default rules
           props.setProperty('rules', JSON.stringify(DEFAULT_RULES));
           
           // Default thresholds
           props.setProperty('thresholds', JSON.stringify({
             ruleConfidenceThreshold: 0.75,
             autoApplyThreshold: 0.85,
             reviewThreshold: 0.60,
             llmConfidenceThreshold: 0.50
           }));
           
           // Default labels
           props.setProperty('labels', JSON.stringify(LabelManager.DEFAULT_TAXONOMY));
           
           // Processing state
           props.setProperty('lastProcessedId', '');
           props.setProperty('lastProcessedTimestamp', '0');
           
           // Statistics
           props.setProperty('stats', JSON.stringify({
             totalProcessed: 0,
             ruleBasedCount: 0,
             llmBasedCount: 0,
             fallbackCount: 0
           }));
           
           props.setProperty('initialized', 'true');
           Logger.log('Configuration initialized');
         }
       },
       
       // Rules management
       getRules: function() {
         const props = PropertiesService.getScriptProperties();
         const rulesJson = props.getProperty('rules');
         return rulesJson ? JSON.parse(rulesJson) : DEFAULT_RULES;
       },
       
       setRules: function(rules) {
         const props = PropertiesService.getScriptProperties();
         props.setProperty('rules', JSON.stringify(rules));
       },
       
       addRule: function(rule) {
         const rules = this.getRules();
         rules.push(rule);
         this.setRules(rules);
       },
       
       updateRule: function(ruleId, updates) {
         const rules = this.getRules();
         const index = rules.findIndex(r => r.id === ruleId);
         if (index !== -1) {
           rules[index] = { ...rules[index], ...updates };
           this.setRules(rules);
         }
       },
       
       deleteRule: function(ruleId) {
         const rules = this.getRules();
         const filtered = rules.filter(r => r.id !== ruleId);
         this.setRules(filtered);
       },
       
       // Labels management
       getLabels: function() {
         const props = PropertiesService.getScriptProperties();
         const labelsJson = props.getProperty('labels');
         return labelsJson ? JSON.parse(labelsJson) : LabelManager.DEFAULT_TAXONOMY;
       },
       
       storeLabel: function(label) {
         const labels = this.getLabels();
         const existingIndex = labels.findIndex(l => l.name === label.name);
         if (existingIndex !== -1) {
           labels[existingIndex] = label;
         } else {
           labels.push(label);
         }
         const props = PropertiesService.getScriptProperties();
         props.setProperty('labels', JSON.stringify(labels));
       },
       
       // Threshold management
       getThresholds: function() {
         const props = PropertiesService.getScriptProperties();
         const thresholdsJson = props.getProperty('thresholds');
         return thresholdsJson ? JSON.parse(thresholdsJson) : ThresholdManager.CONFIG;
       },
       
       setThresholds: function(thresholds) {
         const props = PropertiesService.getScriptProperties();
         props.setProperty('thresholds', JSON.stringify(thresholds));
       },
       
       // API key management (SENSITIVE)
       setApiKey: function(apiKey) {
         const props = PropertiesService.getScriptProperties();
         // Note: Script Properties are visible to anyone with script access
         // Consider encryption for production use
         props.setProperty('LLM_API_KEY', apiKey);
       },
       
       setLlmProvider: function(provider) {
         const props = PropertiesService.getScriptProperties();
         props.setProperty('LLM_PROVIDER', provider);
       },
       
        // Processing state (timestamp-based, not ID-based)
        // Gmail message IDs are opaque strings — do NOT contain timestamps.
        getLastProcessedTimestamp: function() {
          const props = PropertiesService.getScriptProperties();
          const ts = props.getProperty('lastProcessedTimestamp');
          return ts ? parseInt(ts, 10) : 0;
        },
        
        setLastProcessedTimestamp: function(timestamp) {
          const props = PropertiesService.getScriptProperties();
          props.setProperty('lastProcessedTimestamp', timestamp.toString());
        },
       // Sender history (for fallback classification)
       getSenderHistory: function(senderEmail) {
         const props = PropertiesService.getUserProperties();
         const key = 'sender_' + senderEmail.replace(/[^a-zA-Z0-9]/g, '_');
         const historyJson = props.getProperty(key);
         return historyJson ? JSON.parse(historyJson) : null;
       },
       
       updateSenderHistory: function(senderEmail, label) {
         const props = PropertiesService.getUserProperties();
         const key = 'sender_' + senderEmail.replace(/[^a-zA-Z0-9]/g, '_');
         
         let history = this.getSenderHistory(senderEmail);
         if (!history) {
           history = { total: 0, labels: {}, mostCommon: '' };
         }
         
         history.total++;
         history.labels[label] = (history.labels[label] || 0) + 1;
         
         // Update most common label
         let maxCount = 0;
         for (const [lbl, count] of Object.entries(history.labels)) {
           if (count > maxCount) {
             maxCount = count;
             history.mostCommon = lbl;
           }
         }
         
         props.setProperty(key, JSON.stringify(history));
       },
       
       // Statistics
       getStats: function() {
         const props = PropertiesService.getScriptProperties();
         const statsJson = props.getProperty('stats');
         return statsJson ? JSON.parse(statsJson) : {
           totalProcessed: 0,
           ruleBasedCount: 0,
           llmBasedCount: 0,
           fallbackCount: 0
         };
       },
       
       incrementStats: function(statType) {
         const stats = this.getStats();
         stats.totalProcessed++;
         
         switch (statType) {
           case 'rule':
             stats.ruleBasedCount++;
             break;
           case 'llm':
             stats.llmBasedCount++;
             break;
           case 'fallback':
             stats.fallbackCount++;
             break;
         }
         
         const props = PropertiesService.getScriptProperties();
         props.setProperty('stats', JSON.stringify(stats));
       }
     };
     ```
   - Dependencies: None (core infrastructure)
   - Risk: MEDIUM - Sensitive data storage (API keys)

2. **User Preferences UI** (Optional)
   - Action: Create a simple UI for user configuration
   - Why: Allow users to customize rules and thresholds
   - Implementation:
     ```javascript
     // Create custom menu in Gmail UI
     function onOpen() {
       const ui = SpreadsheetApp.getUi(); // If using Sheets
       // Or const ui = SlidesApp.getUi();
       
       ui.createMenu('Email Labeler')
         .addItem('Configure Rules', 'showRulesDialog')
         .addItem('Configure Labels', 'showLabelsDialog')
         .addItem('View Statistics', 'showStatsDialog')
         .addItem('Set API Key', 'showApiKeyDialog')
         .addSeparator()
         .addItem('Run Now', 'processNewEmails')
         .addItem('Setup Triggers', 'createTimeDrivenTrigger')
         .addToUi();
     }
     
     function showRulesDialog() {
       const html = HtmlService.createHtmlOutputFromFile('RulesDialog')
         .setWidth(600)
         .setHeight(400);
       SpreadsheetApp.getUi().showModalDialog(html, 'Configure Classification Rules');
     }
     
     function showLabelsDialog() {
       const html = HtmlService.createHtmlOutputFromFile('LabelsDialog')
         .setWidth(600)
         .setHeight(400);
       SpreadsheetApp.getUi().showModalDialog(html, 'Configure Labels');
     }
     
     function showApiKeyDialog() {
       const html = HtmlService.createHtmlOutputFromFile('ApiKeyDialog')
         .setWidth(400)
         .setHeight(200);
       SpreadsheetApp.getUi().showModalDialog(html, 'Set LLM API Key');
     }
     ```
   - Dependencies: HTML dialogs (separate files)
   - Risk: LOW - Optional UI enhancement

---

## Analytics with Google Sheets (Optional)

### File: `Analytics.gs`

**Purpose**: Track classification performance and statistics

**Requirements**:

1. **Google Sheets Integration**
   - Action: Log classifications to a Google Sheet for analysis
   - Why: Track accuracy, LLM usage, and performance over time
   - Implementation:
     ```javascript
     const AnalyticsManager = {
       SPREADSHEET_ID: null,
       SHEET_NAME: 'Classification Log',
       
       initialize: function() {
         const props = PropertiesService.getScriptProperties();
         this.SPREADSHEET_ID = props.getProperty('analyticsSpreadsheetId');
         
         if (!this.SPREADSHEET_ID) {
           // Create new spreadsheet for analytics
           const spreadsheet = SpreadsheetApp.create('Email Labeler Analytics');
           this.SPREADSHEET_ID = spreadsheet.getId();
           props.setProperty('analyticsSpreadsheetId', this.SPREADSHEET_ID);
           
           // Setup sheets
           this.setupSheets(spreadsheet);
         }
       },
       
       setupSheets: function(spreadsheet) {
         // Classification Log sheet
         const logSheet = spreadsheet.getSheetByName(this.SHEET_NAME);
         if (!logSheet) {
           const sheet = spreadsheet.insertSheet(this.SHEET_NAME);
           sheet.appendRow([
             'Timestamp',
             'Email ID',
             'From',
             'Subject',
             'Label',
             'Confidence',
             'Source',
             'Rule ID',
             'Processing Time (ms)',
             'User Feedback'
           ]);
         }
         
         // Statistics sheet
         const statsSheet = spreadsheet.getSheetByName('Statistics');
         if (!statsSheet) {
           const sheet = spreadsheet.insertSheet('Statistics');
           sheet.appendRow([
             'Date',
             'Total Processed',
             'Rule-Based %',
             'LLM-Based %',
             'Fallback %',
             'Avg Confidence'
           ]);
         }
       },
       
       logClassification: function(email, result, processingTimeMs) {
         if (!this.SPREADSHEET_ID) {
           this.initialize();
         }
         
         const spreadsheet = SpreadsheetApp.openById(this.SPREADSHEET_ID);
         const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);
         
         sheet.appendRow([
           new Date().toISOString(),
           email.id,
           email.from,
           email.subject,
           result.label,
           result.confidence,
           result.source,
           result.matchedRule || '',
           processingTimeMs,
           ''  // User feedback (empty initially)
         ]);
         
         // Keep only last 10,000 rows to avoid sheet size issues
         const lastRow = sheet.getLastRow();
         if (lastRow > 10000) {
           sheet.deleteRow(2); // Delete oldest (after header)
         }
       },
       
       recordUserFeedback: function(emailId, feedback) {
         const spreadsheet = SpreadsheetApp.openById(this.SPREADSHEET_ID);
         const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);
         
         // Find row by email ID
         const data = sheet.getDataRange().getValues();
         for (let i = 1; i < data.length; i++) {
           if (data[i][1] === emailId) {
             sheet.getRange(i + 1, 10).setValue(feedback); // Column J
             break;
           }
         }
       },
       
       getRuleStats: function(ruleId) {
         if (!this.SPREADSHEET_ID) {
           return { total: 0, correct: 0 };
         }
         
         const spreadsheet = SpreadsheetApp.openById(this.SPREADSHEET_ID);
         const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);
         const data = sheet.getDataRange().getValues();
         
         let total = 0;
         let correct = 0;
         
         for (let i = 1; i < data.length; i++) {
           if (data[i][7] === ruleId) {  // Rule ID column
             total++;
             if (data[i][9] === 'correct') {  // User feedback column
               correct++;
             }
           }
         }
         
         return { total, correct };
       },
       
       getOverallStats: function() {
         const stats = ConfigManager.getStats();
         
         return {
           total: stats.totalProcessed,
           ruleBased: stats.ruleBasedCount,
           llmBased: stats.llmBasedCount,
           fallback: stats.fallbackCount,
           rulePercentage: stats.totalProcessed > 0 
             ? (stats.ruleBasedCount / stats.totalProcessed * 100).toFixed(2) 
             : 0,
           llmPercentage: stats.totalProcessed > 0 
             ? (stats.llmBasedCount / stats.totalProcessed * 100).toFixed(2) 
             : 0
         };
       },
       
       generateDailyStats: function() {
         const stats = this.getOverallStats();
         const spreadsheet = SpreadsheetApp.openById(this.SPREADSHEET_ID);
         const sheet = spreadsheet.getSheetByName('Statistics');
         
         sheet.appendRow([
           new Date().toISOString().split('T')[0],
           stats.total,
           stats.rulePercentage,
           stats.llmPercentage,
           (stats.fallback / stats.total * 100).toFixed(2),
           this.calculateAverageConfidence()
         ]);
       },
       
       calculateAverageConfidence: function() {
         const spreadsheet = SpreadsheetApp.openById(this.SPREADSHEET_ID);
         const sheet = spreadsheet.getSheetByName(this.SHEET_NAME);
         const data = sheet.getDataRange().getValues();
         
         let totalConfidence = 0;
         let count = 0;
         
         for (let i = 1; i < data.length; i++) {
           if (data[i][5]) {  // Confidence column
             totalConfidence += parseFloat(data[i][5]);
             count++;
           }
         }
         
         return count > 0 ? (totalConfidence / count).toFixed(2) : 0;
       }
     };
     ```
   - Dependencies: None (optional feature)
   - Risk: LOW - Analytics only, doesn't affect classification

---

## Testing Strategy

### File: `Tests.gs`

**Purpose**: Unit and integration tests for Apps Script

**Requirements**:

1. **Unit Tests**
   - Action: Test individual components in isolation
   - Why: Verify logic correctness without external dependencies
   - Implementation:
     ```javascript
     const Tests = {
       runAll: function() {
         console.log('=== Running Tests ===\n');
         
         let passed = 0;
         let failed = 0;
         
         // Rule Engine Tests
         const ruleResults = this.testRuleEngine();
         passed += ruleResults.passed;
         failed += ruleResults.failed;
         
         // Confidence Scorer Tests
         const confidenceResults = this.testConfidenceScorer();
         passed += confidenceResults.passed;
         failed += confidenceResults.failed;
         
         // Threshold Manager Tests
         const thresholdResults = this.testThresholdManager();
         passed += thresholdResults.passed;
         failed += thresholdResults.failed;
         
         // LLM Client Tests (mocked)
         const llmResults = this.testLLMClient();
         passed += llmResults.passed;
         failed += llmResults.failed;
         
         console.log(`\n=== Test Results ===`);
         console.log(`Passed: ${passed}`);
         console.log(`Failed: ${failed}`);
         
         return { passed, failed };
       },
       
       testRuleEngine: function() {
         let passed = 0;
         let failed = 0;
         
         console.log('\n--- Rule Engine Tests ---');
         
         // Test sender rule
         const senderRule = {
           id: 'test-sender',
           type: 'sender',
           patterns: [{ field: 'domain', match: 'contains', value: 'amazon' }],
           label: 'Shopping',
           confidence: 0.85,
           priority: 100,
           enabled: true
         };
         
         const email1 = {
           from: 'ship-confirm@amazon.com',
           subject: 'Your order has shipped',
           body: 'Your order #123 has shipped'
         };
         
         const match1 = RuleEngine.matchSenderRule(senderRule, email1);
         if (match1 === true) {
           console.log('✓ Sender rule matched correctly');
           passed++;
         } else {
           console.log('✗ Sender rule failed to match');
           failed++;
         }
         
         // Test keyword rule
         const keywordRule = {
           id: 'test-keyword',
           type: 'keyword',
           patterns: [{
             location: 'subject',
             keywords: ['invoice', 'receipt', 'payment'],
             match: 'any'
           }],
           label: 'Finance',
           confidence: 0.85,
           priority: 100,
           enabled: true
         };
         
         const email2 = {
           from: 'billing@company.com',
           subject: 'Invoice #12345',
           body: 'Please find attached invoice'
         };
         
         const match2 = RuleEngine.matchKeywordRule(keywordRule, email2);
         if (match2 === true) {
           console.log('✓ Keyword rule matched correctly');
           passed++;
         } else {
           console.log('✗ Keyword rule failed to match');
           failed++;
         }
         
         // Test pattern rule
         const patternRule = {
           id: 'test-pattern',
           type: 'pattern',
           patterns: [{
             regex: '\\b(booking|reservation)\\s+(confirmation|details)\\b',
             location: 'subject',
             flags: 'i'
           }],
           label: 'Travel',
           confidence: 0.90,
           priority: 110,
           enabled: true
         };
         
         const email3 = {
           from: 'reservations@hotel.com',
           subject: 'Booking confirmation for your stay',
           body: 'Your reservation details'
         };
         
         const match3 = RuleEngine.matchPatternRule(patternRule, email3);
         if (match3 === true) {
           console.log('✓ Pattern rule matched correctly');
           passed++;
         } else {
           console.log('✗ Pattern rule failed to match');
           failed++;
         }
         
         return { passed, failed };
       },
       
       testConfidenceScorer: function() {
         let passed = 0;
         let failed = 0;
         
         console.log('\n--- Confidence Scorer Tests ---');
         
         const rule = {
           id: 'test',
           type: 'sender',
           patterns: [{ field: 'domain', match: 'exact', value: 'amazon.com' }],
           confidence: 0.85
         };
         
         const email = {
           from: 'test@amazon.com',
           subject: 'Test email',
           body: 'Test body'
         };
         
         const specificity = ConfidenceScorer.calculateSpecificity(rule);
         if (specificity >= 0.85) {
           console.log('✓ Specificity calculation correct for sender rule');
           passed++;
         } else {
           console.log('✗ Specificity calculation incorrect');
           failed++;
         }
         
         const clarity = ConfidenceScorer.assessEmailClarity(email);
         if (clarity > 0 && clarity <= 1) {
           console.log('✓ Email clarity calculation valid');
           passed++;
         } else {
           console.log('✗ Email clarity calculation invalid');
           failed++;
         }
         
         return { passed, failed };
       },
       
       testThresholdManager: function() {
         let passed = 0;
         let failed = 0;
         
         console.log('\n--- Threshold Manager Tests ---');
         
         // Test should use rule
         if (ThresholdManager.shouldUseRule(0.80) === true) {
           console.log('✓ Should use rule at 0.80 confidence');
           passed++;
         } else {
           console.log('✗ Should use rule logic incorrect');
           failed++;
         }
         
         if (ThresholdManager.shouldUseRule(0.60) === false) {
           console.log('✓ Should not use rule at 0.60 confidence');
           passed++;
         } else {
           console.log('✗ Should not use rule logic incorrect');
           failed++;
         }
         
         // Test escalation to LLM
         if (ThresholdManager.shouldEscalateToLLM(0.50) === true) {
           console.log('✓ Should escalate to LLM at 0.50 confidence');
           passed++;
         } else {
           console.log('✗ LLM escalation logic incorrect');
           failed++;
         }
         
         return { passed, failed };
       },
       
       testLLMClient: function() {
         let passed = 0;
         let failed = 0;
         
         console.log('\n--- LLM Client Tests ---');
         
         // Test prompt building
         const email = {
           from: 'test@example.com',
           subject: 'Test Subject',
           body: 'Test body content'
         };
         
         const labels = [
           { name: 'Shopping' },
           { name: 'Finance' }
         ];
         
         const prompt = LLMClient.buildPrompt(email, labels);
         if (prompt.includes('test@example.com') && 
             prompt.includes('Shopping') && 
             prompt.includes('Finance')) {
           console.log('✓ Prompt building correct');
           passed++;
         } else {
           console.log('✗ Prompt building incorrect');
           failed++;
         }
         
         // Test response parsing
         const validResponse = '{"label": "Shopping", "confidence": 0.85, "reasoning": "Test"}';
         const parsed = LLMClient.parseResponse(validResponse);
         
         if (parsed.label === 'Shopping' && parsed.confidence === 0.85) {
           console.log('✓ Response parsing correct');
           passed++;
         } else {
           console.log('✗ Response parsing incorrect');
           failed++;
         }
         
         // Test malformed response
         const malformedResponse = 'This is not JSON';
         const fallbackParsed = LLMClient.parseResponse(malformedResponse);
         
         if (fallbackParsed.label && fallbackParsed.source === 'llm-fallback') {
           console.log('✓ Fallback parsing handles malformed response');
           passed++;
         } else {
           console.log('✗ Fallback parsing failed');
           failed++;
         }
         
         return { passed, failed };
       }
     };
     
     // Test runner function
     function runTests() {
       return Tests.runAll();
     }
     ```
   - Dependencies: All components
   - Risk: LOW - Testing infrastructure

2. **Integration Tests**
   - Action: Test full classification pipeline
   - Why: Verify end-to-end functionality
   - Implementation:
     ```javascript
     const IntegrationTests = {
       runAll: function() {
         console.log('\n=== Running Integration Tests ===\n');
         
         let passed = 0;
         let failed = 0;
         
         // Test full classification flow
         const result = this.testFullClassification();
         if (result) passed++;
         else failed++;
         
         return { passed, failed };
       },
       
       testFullClassification: function() {
         console.log('\n--- Full Classification Flow Test ---');
         
         // Mock email
         const email = {
           id: 'test-123',
           from: 'ship-confirm@amazon.com',
           subject: 'Your Amazon order has shipped',
           body: 'Your order #123-456 has shipped...',
           date: new Date(),
           headers: {}
         };
         
         // Initialize configuration
         ConfigManager.initialize();
         
         // Classify email
         const result = ClassificationRouter.classify(email);
         
         console.log('Classification result:', JSON.stringify(result, null, 2));
         
         // Verify result
         if (result.label === 'Shopping' && result.confidence > 0.7) {
           console.log('✓ Full classification flow works correctly');
           return true;
         } else {
           console.log('✗ Classification result incorrect');
           console.log('Expected: Shopping with confidence > 0.7');
           console.log('Got:', result.label, 'with confidence', result.confidence);
           return false;
         }
       }
     };
     
     // Integration test runner
     function runIntegrationTests() {
       return IntegrationTests.runAll();
     }
     ```
   - Dependencies: All components
   - Risk: LOW - Testing infrastructure

---

## Security Considerations

### File: `Security.gs`

**Purpose**: Security best practices for Apps Script

**Requirements**:

1. **API Key Management**
   - Action: Secure storage of LLM API keys
   - Why: Protect sensitive credentials
   - Implementation:
     ```javascript
     const SecurityManager = {
       // API keys should be stored in Script Properties
       // Note: Script Properties are visible to anyone with edit access to the script
       // For production, consider using external secret manager
       
       storeApiKey: function(apiKey, provider) {
         if (!apiKey || apiKey.length < 10) {
           throw new Error('Invalid API key format');
         }
         
         const props = PropertiesService.getScriptProperties();
         
         // Encrypt API key before storing (basic obfuscation)
         const encrypted = this.obfuscate(apiKey);
         props.setProperty('LLM_API_KEY', encrypted);
         props.setProperty('LLM_PROVIDER', provider);
         
         Logger.log('API key stored securely');
       },
       
       getApiKey: function() {
         const props = PropertiesService.getScriptProperties();
         const encrypted = props.getProperty('LLM_API_KEY');
         
         if (!encrypted) {
           throw new Error('API key not configured. Run setupApiKey() first.');
         }
         
         return this.deobfuscate(encrypted);
       },
       
       // Basic obfuscation (NOT encryption - use external secret manager for production)
       obfuscate: function(text) {
         const key = 'email-labeler-2024';
         let result = '';
         for (let i = 0; i < text.length; i++) {
           result += String.fromCharCode(
             text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
           );
         }
         return Utilities.base64Encode(result);
       },
       
       deobfuscate: function(encoded) {
         const key = 'email-labeler-2024';
         const decoded = Utilities.base64Decode(encoded);
         let result = '';
         for (let i = 0; i < decoded.length; i++) {
           result += String.fromCharCode(
             decoded[i] ^ key.charCodeAt(i % key.length)
           );
         }
         return result;
       },
       
       validateApiKey: function(apiKey, provider) {
         // Basic validation
         if (!apiKey || apiKey.trim().length === 0) {
           return { valid: false, error: 'API key is required' };
         }
         
         if (provider === 'openai' && !apiKey.startsWith('sk-')) {
           return { valid: false, error: 'OpenAI API key should start with "sk-"' };
         }
         
         if (provider === 'anthropic' && apiKey.length < 20) {
           return { valid: false, error: 'Invalid Anthropic API key format' };
         }
         
         return { valid: true };
       }
     };
     ```
   - Dependencies: None
   - Risk: MEDIUM - API key security (consider external secret manager for production)

2. **Input Validation**
   - Action: Validate all external inputs
   - Why: Prevent injection attacks and malformed data
   - Implementation:
     ```javascript
     const InputValidator = {
       validateEmail: function(email) {
         if (!email || typeof email !== 'object') {
           return { valid: false, error: 'Invalid email object' };
         }
         
         if (!email.id || email.id.length > 100) {
           return { valid: false, error: 'Invalid email ID' };
         }
         
         if (!email.from || !this.isValidEmail(email.from)) {
           return { valid: false, error: 'Invalid sender email' };
         }
         
         if (email.subject && email.subject.length > 1000) {
           // Truncate to prevent issues
           email.subject = email.subject.substring(0, 1000);
         }
         
         if (email.body && email.body.length > 100000) {
           // Truncate to prevent memory issues
           email.body = email.body.substring(0, 5000);
         }
         
         return { valid: true };
       },
       
       isValidEmail: function(email) {
         const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
         return emailRegex.test(email);
       },
       
       validateRule: function(rule) {
         if (!rule || typeof rule !== 'object') {
           return { valid: false, error: 'Invalid rule object' };
         }
         
         const validTypes = ['sender', 'keyword', 'pattern', 'header', 'composite'];
         if (!validTypes.includes(rule.type)) {
           return { valid: false, error: 'Invalid rule type' };
         }
         
         if (!rule.label || rule.label.length > 100) {
           return { valid: false, error: 'Invalid label name' };
         }
         
         if (typeof rule.confidence !== 'number' || 
             rule.confidence < 0 || 
             rule.confidence > 1) {
           return { valid: false, error: 'Confidence must be between 0 and 1' };
         }
         
         return { valid: true };
       },
       
       sanitizeInput: function(input) {
         if (typeof input !== 'string') return input;
         
         // Remove potentially dangerous characters
         return input
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;')
           .replace(/'/g, '&#x27;')
           .replace(/\//g, '&#x2F;');
       }
     };
     ```
   - Dependencies: None
   - Risk: LOW - Input validation best practices

---

## Implementation Phases

### Phase 1: Foundation (Files: Code.gs, Config.gs, Utils.gs)
1. Create time-based trigger setup
2. Implement configuration management via PropertiesService
3. Setup error handling and retry logic
4. Create basic utilities (performance management, quota tracking)

### Phase 2: Gmail Integration (File: GmailService.gs)
1. Implement email fetching logic
2. Create label management functions
3. Add performance optimizations (caching, pagination)
4. Test with real Gmail data

### Phase 3: Rule-Based Classification (File: Classifier.gs - Part 1)
1. Define rule schema
2. Implement rule evaluation engine
3. Create default rule library
4. Test all rule types (sender, keyword, pattern, header, composite)

### Phase 4: LLM Integration (File: LLMClient.gs)
1. Setup API key management
2. Implement OpenAI API client with UrlFetchApp
3. Implement Anthropic API client (alternative)
4. Add prompt engineering and response parsing
5. Implement cost optimization strategies

### Phase 5: Classification Router (File: Classifier.gs - Part 2)
1. Implement confidence scoring
2. Create threshold manager
3. Build classification router (rule vs LLM decision)
4. Add fallback mechanisms

### Phase 6: Label Application (File: GmailService.gs - Extended)
1. Implement label application logic
2. Add batch processing
3. Implement state tracking (last processed email)
4. Test end-to-end labeling

### Phase 7: Analytics (Optional) (File: Analytics.gs)
1. Setup Google Sheets integration
2. Implement classification logging
3. Create statistics tracking
4. Add user feedback collection

### Phase 8: Backfill Mode (File: Code.gs)
1. Implement backfill trigger and batch processing
2. Add backfill state tracking in PropertiesService
3. Create progress monitoring function
4. Test with small date ranges first, then full backfill
5. Verify labels applied correctly to historical emails

### Phase 9: Testing & Documentation (File: Tests.gs)
1. Write unit tests
2. Create integration tests
3. Test end-to-end flow (ongoing + backfill)
4. Write user documentation
5. Create setup guide

---

## Success Criteria

- [ ] System processes new emails within 1-5 minutes of arrival
- [ ] Rule-based classification achieves 70%+ coverage (minimizes LLM usage)
- [ ] LLM fallback handles ambiguous emails correctly
- [ ] Classification accuracy reaches 95%+ on test dataset
- [ ] System respects 6-minute execution limit (batch processing works)
- [ ] API keys stored securely in Script Properties
- [ ] Error handling prevents script crashes
- [ ] Analytics track performance (optional)
- [ ] User can configure rules and thresholds (via PropertiesService)
- [ ] Backfill mode processes all historical emails across multiple runs
- [ ] Backfill progress tracking works correctly (stop/resume/status)
- [ ] All tests pass with 80%+ code coverage

---

## File Structure Summary

```
EmailLabeler/
├── appsscript.json            # Project manifest (OAuth scopes, advanced services)
├── Code.gs                    # Main entry point, trigger setup, bridge functions
│                              #   - processNewEmails(), classifyEmail(), handleError()
│                              #   - createTimeDrivenTrigger(), testClassification()
│                              #   - PerformanceManager, QuotaManager objects
├── Config.gs                  # Configuration management (PropertiesService)
│                              #   - ConfigManager object (rules, labels, thresholds, state)
├── GmailService.gs            # Gmail operations (fetch, label, parse)
│                              #   - GmailService object (fetchNewEmails, extractHeaders)
│                              #   - LabelManager object (applyLabelToEmail, taxonomy)
│                              #   - Requires Gmail Advanced Service for header extraction
├── Classifier.gs              # Classification logic
│                              #   - RuleEngine object (rule evaluation)
│                              #   - ConfidenceScorer, ThresholdManager objects
│                              #   - ClassificationRouter (rule vs LLM decision)
│                              #   - FallbackClassifier object
│                              #   - DEFAULT_RULES array
├── LLMClient.gs               # LLM API integration (OpenAI, Anthropic)
│                              #   - LLMClient object (API calls, prompt, parsing)
├── Utils.gs                   # Error handling, retry logic, input validation
│                              #   - ErrorHandler, RetryManager objects
│                              #   - InputValidator object
├── Security.gs                # API key management
│                              #   - SecurityManager object
├── Analytics.gs               # Optional: Google Sheets analytics
│                              #   - AnalyticsManager object
├── Tests.gs                   # Unit and integration tests
│                              #   - Tests, IntegrationTests objects
├── RulesDialog.html           # Optional: UI dialog for rule configuration
├── LabelsDialog.html          # Optional: UI dialog for label configuration
└── ApiKeyDialog.html          # Optional: UI dialog for API key setup
```

---

## Project Manifest

### File: `appsscript.json`

**Purpose**: Required manifest file for Apps Script project configuration

```json
{
  "timeZone": "America/New_York",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Gmail",
        "serviceId": "gmail",
        "version": "v1"
      }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

**Notes**:
- The Gmail Advanced Service (`Gmail`) must be enabled for header extraction (`extractHeaders()`)
- `gmail.modify` scope is needed to apply labels
- `script.external_request` scope is needed for LLM API calls via `UrlFetchApp`
- `spreadsheets` scope is only needed if Analytics is enabled
- `script.scriptapp` scope is needed for trigger management

---

## Deployment Guide

### Prerequisites
- A Google account (Gmail or Google Workspace)
- A free Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card needed)
- Alternatively: An OpenAI or Anthropic API key (paid)

### Step 1: Create the Apps Script Project
1. Go to [https://script.google.com](https://script.google.com)
2. Click **"New project"**
3. Name it **"Email Labeler"**

### Step 2: Enable Gmail Advanced Service
1. In the Apps Script editor, click **"Services"** (+ icon in left sidebar)
2. Find **"Gmail API"** and click **"Add"**
3. Keep the default identifier as `Gmail`

### Step 3: Add Script Files
1. Create each `.gs` file listed in the File Structure above
2. Copy the code from this requirements document into each file
3. Ensure `appsscript.json` is configured (View > Show manifest file)

### Step 4: Configure API Key
1. Get a free API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. In the Apps Script editor, go to **Project Settings** (gear icon)
3. Under **"Script Properties"**, add:
   - `LLM_API_KEY`: Your Gemini API key (starts with `AIza...`)
   - `LLM_PROVIDER`: `gemini` (free, recommended) — or `openai` / `anthropic` (paid)
   - `LLM_MODEL`: `gemini-2.0-flash` (free, recommended) or your preferred model

### Step 5: Initialize and Test
1. Run `ConfigManager.initialize()` from the editor to set up defaults
2. Run `LabelManager.initialize()` to create Gmail labels
3. Run `testClassification()` to verify the system works
4. Run `runTests()` to execute unit tests

### Step 6: Set Up Automatic Trigger
1. Run `createTimeDrivenTrigger()` from the editor
2. Approve the OAuth permission prompts
3. The system will now check for new emails every 10 minutes

### Step 7: (Optional) Backfill Historical Emails
1. To label ALL your past emails, run `startBackfill()` from the editor
2. Optionally, limit by date: `startBackfill('2023-01-01', '2025-12-31')`
3. This creates a separate trigger that processes emails in batches every 5 minutes
4. Check progress anytime: run `getBackfillProgress()` 
5. Stop anytime: run `stopBackfill()`
6. When complete, the backfill trigger auto-deletes itself

### Step 8: Monitor
- Check **Executions** tab in Apps Script for logs
- If Analytics is enabled, check the Google Sheets for classification stats
- Run `AnalyticsManager.getOverallStats()` to see usage statistics
- Run `getBackfillProgress()` to check backfill status

### Troubleshooting
| Issue | Solution |
|---|---|
| "Gmail is not defined" error | Enable Gmail Advanced Service (Step 2) |
| "Authorization required" | Re-run any function and approve OAuth prompts |
| Labels not appearing | Run `LabelManager.initialize()` manually |
| LLM API errors | Verify API key in Script Properties |
| Duplicate processing | Check `LockService` is working; increase trigger interval |
| Quota exceeded | Increase trigger interval from 10 to 15 or 30 minutes |
| Backfill seems stuck | Run `getBackfillProgress()` to check status |
| Want to re-backfill | Delete `backfill-processed` label in Gmail, then `startBackfill()` |
| Backfill too slow | Normal — processes ~100 threads every 5 minutes (safe for quotas) |

---

## PropertiesService Size Limits

> **Important**: PropertiesService has a **9KB limit per property value** and a **500KB total limit**.
> As the system scales, the `rules` and `sender_*` properties may approach these limits.

### Mitigation Strategies
1. **Monitor size**: Before writing, check `JSON.stringify(data).length < 9000`
2. **Chunk large data**: Split across multiple properties (e.g., `rules_0`, `rules_1`)
3. **Use CacheService**: For transient data like label caches (6MB limit, 25MB total)
4. **Archive to Sheets**: Move historical sender data to Analytics spreadsheet periodically
5. **Prune old data**: Remove sender histories that haven't been updated in 30+ days

---

This plan provides a comprehensive roadmap for implementing the email labeling system using Google Apps Script, with specific Apps Script APIs, quota considerations, and best practices integrated throughout.
