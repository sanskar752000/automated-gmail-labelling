/**
 * GmailService.gs — Gmail Operations
 * 
 * Contains:
 *   - GmailService: Fetch, parse, and manage emails
 *   - LabelManager: Create, apply, and manage Gmail labels
 * 
 * Requires Gmail Advanced Service to be enabled for header extraction.
 */

// ============================================================
// GMAIL SERVICE
// ============================================================

var GmailService = {
  
  /**
   * Fetch new unread emails since the last processed timestamp.
   * Uses timestamp-based tracking (not message IDs).
   * 
   * @param {number} lastTimestamp - Epoch milliseconds of last processed email
   * @returns {Array} Array of parsed email objects, sorted oldest-first
   */
  fetchNewEmails: function(lastTimestamp) {
    var emails = [];
    var query = 'is:unread';
    
    // Use epoch-based date query for incremental processing
    if (lastTimestamp && lastTimestamp > 0) {
      var epochSeconds = Math.floor(lastTimestamp / 1000);
      query += ' after:' + epochSeconds;
    }
    
    // GmailApp.search returns threads
    var threads = GmailApp.search(query, 0, 500);
    
    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();
      
      for (var m = 0; m < messages.length; m++) {
        var message = messages[m];
        
        // Skip emails older than our last processed timestamp
        if (lastTimestamp && message.getDate().getTime() <= lastTimestamp) {
          continue;
        }
        
        // Skip already-read messages
        if (!message.isUnread()) {
          continue;
        }
        
        var email = this.parseMessage(message);
        emails.push(email);
      }
      
      // Check read quota
      QuotaManager.checkReadQuota();
    }
    
    // Sort by date (oldest first for consistent processing)
    emails.sort(function(a, b) {
      return a.date.getTime() - b.date.getTime();
    });
    
    return emails;
  },
  
  /**
   * Parse a GmailMessage into a standard email object.
   * @param {GmailMessage} message - The Gmail message
   * @returns {Object} Parsed email object
   */
  parseMessage: function(message) {
    return {
      id: message.getId(),
      threadId: message.getThread().getId(),
      from: this.extractEmailAddress(message.getFrom()),
      fromFull: message.getFrom(),
      to: message.getTo(),
      subject: message.getSubject() || '(no subject)',
      body: this.extractBodyText(message),
      date: message.getDate(),
      headers: this.extractHeaders(message.getId()),
      isRead: !message.isUnread()
    };
  },
  
  /**
   * Extract plain text body, truncated for LLM token limits.
   * @param {GmailMessage} message - The Gmail message
   * @returns {string} Plain text body
   */
  extractBodyText: function(message) {
    var body = message.getPlainBody();
    
    var MAX_BODY_LENGTH = 5000;
    if (body && body.length > MAX_BODY_LENGTH) {
      body = body.substring(0, MAX_BODY_LENGTH) + '... [truncated]';
    }
    
    return body || '';
  },
  
  /**
   * Extract email headers using the Gmail Advanced Service (REST API).
   * GmailApp's GmailMessage class does NOT have a getHeader() method.
   * 
   * Requires Gmail Advanced Service to be enabled:
   *   Services > Gmail API > Enable
   * 
   * @param {string} messageId - The Gmail message ID
   * @returns {Object} Key-value map of requested headers
   */
  extractHeaders: function(messageId) {
    try {
      var msg = Gmail.Users.Messages.get('me', messageId, {
        format: 'metadata',
        metadataHeaders: ['List-Id', 'Precedence', 'X-Priority', 'Reply-To', 'List-Unsubscribe']
      });
      
      var headers = {};
      if (msg.payload && msg.payload.headers) {
        msg.payload.headers.forEach(function(h) {
          headers[h.name] = h.value;
        });
      }
      return headers;
    } catch (error) {
      // Gmail Advanced Service may not be enabled, or message may not be accessible
      Logger.log('Header extraction failed: ' + error.message);
      return {};
    }
  },
  
  /**
   * Extract email address from "Name <email@domain.com>" format.
   * @param {string} fromString - The From field value
   * @returns {string} Just the email address
   */
  extractEmailAddress: function(fromString) {
    if (!fromString) return '';
    var match = fromString.match(/<([^>]+)>/);
    return match ? match[1] : fromString;
  },
  
  /**
   * Get or create a Gmail label by name.
   * Supports hierarchical labels (e.g., "Finance/Invoices").
   * 
   * @param {string} labelName - Label name
   * @returns {GmailLabel} The Gmail label object
   */
  getOrCreateLabel: function(labelName) {
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      Logger.log('Created new label: ' + labelName);
    }
    return label;
  }
};

// ============================================================
// LABEL MANAGER
// ============================================================

var LabelManager = {
  
  /**
   * Default label taxonomy.
   */
  DEFAULT_LABELS: [
    'Shopping',
    'Finance/Invoices',
    'Finance/Receipts',
    'Work/Projects',
    'Work/Meetings',
    'Travel',
    'Newsletters',
    'Marketing',
    'Personal',
    'Uncategorized'
  ],
  
  /**
   * Initialize all default labels in Gmail.
   * Run once during setup to create the label hierarchy.
   */
  initialize: function() {
    var labels = this.DEFAULT_LABELS;
    for (var i = 0; i < labels.length; i++) {
      GmailService.getOrCreateLabel(labels[i]);
    }
    Logger.log('Initialized ' + labels.length + ' labels.');
  },
  
  /**
   * Get or create a Gmail label.
   * Delegates to GmailService.getOrCreateLabel.
   */
  getOrCreateLabel: function(labelName) {
    return GmailService.getOrCreateLabel(labelName);
  },
  
  /**
   * Apply a label to an email's thread.
   * Gmail labels are thread-level, not message-level.
   * GmailMessage does NOT have addLabel() — only GmailThread does.
   * 
   * @param {Object} email - Parsed email object (must have threadId)
   * @param {string} labelName - Label to apply
   * @returns {boolean} Success
   */
  applyLabelToEmail: function(email, labelName) {
    try {
      var label = this.getOrCreateLabel(labelName);
      var thread = GmailApp.getThreadById(email.threadId);
      thread.addLabel(label);
      
      QuotaManager.checkWriteQuota();
      
      Logger.log('Applied label "' + labelName + '" to: ' + email.subject);
      return true;
    } catch (error) {
      Logger.log('Error applying label "' + labelName + '": ' + error.message);
      return false;
    }
  },
  
  /**
   * Apply multiple labels to an email's thread.
   * @param {Object} email - Parsed email object
   * @param {Array<string>} labelNames - Labels to apply
   */
  applyMultipleLabels: function(email, labelNames) {
    for (var i = 0; i < labelNames.length; i++) {
      this.applyLabelToEmail(email, labelNames[i]);
    }
  },
  
  /**
   * Remove a label from an email's thread.
   * @param {Object} email - Parsed email object
   * @param {string} labelName - Label to remove
   */
  removeLabelFromEmail: function(email, labelName) {
    try {
      var label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        var thread = GmailApp.getThreadById(email.threadId);
        thread.removeLabel(label);
      }
    } catch (error) {
      Logger.log('Error removing label: ' + error.message);
    }
  },
  
  /**
   * Get all user labels from Gmail (cached for 1 hour).
   * @returns {Array<string>} Label names
   */
  getAllLabels: function() {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('all_labels');
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    var labels = GmailApp.getUserLabels();
    var names = labels.map(function(label) {
      return label.getName();
    });
    
    // Cache for 1 hour
    cache.put('all_labels', JSON.stringify(names), 3600);
    
    return names;
  }
};
