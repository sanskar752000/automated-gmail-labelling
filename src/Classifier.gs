/**
 * Classifier.gs — Classification Logic
 * 
 * Contains:
 *   - DEFAULT_RULES: Built-in classification rules
 *   - RuleEngine: Evaluates rules against emails
 *   - ConfidenceScorer: Multi-factor confidence calculation
 *   - ThresholdManager: Decision thresholds
 *   - ClassificationRouter: Decides rule vs LLM path
 *   - FallbackClassifier: Last-resort classification
 */

// ============================================================
// DEFAULT RULES
// ============================================================

var DEFAULT_RULES = [
  // Shopping
  {
    id: 'amazon-domain',
    type: 'sender',
    patterns: [{ domain: 'amazon.com' }, { domain: 'amazon.in' }],
    label: 'Shopping',
    confidence: 0.90,
    priority: 100,
    enabled: true
  },
  {
    id: 'shopping-domains',
    type: 'sender',
    patterns: [
      { domain: 'flipkart.com' },
      { domain: 'myntra.com' },
      { domain: 'ajio.com' },
      { domain: 'ebay.com' },
      { domain: 'etsy.com' }
    ],
    label: 'Shopping',
    confidence: 0.85,
    priority: 95,
    enabled: true
  },
  {
    id: 'order-keywords',
    type: 'keyword',
    patterns: [{
      location: 'subject',
      keywords: ['order confirmed', 'order shipped', 'order delivered', 'your order', 'shipment', 'tracking number', 'out for delivery', 'shipped', 'delivered', 'dispatched'],
      match: 'any'
    }],
    label: 'Shopping',
    confidence: 0.80,
    priority: 90,
    enabled: true
  },
  
  // Finance
  {
    id: 'finance-keywords',
    type: 'keyword',
    patterns: [{
      location: 'subject',
      keywords: ['invoice', 'bill', 'payment', 'statement', 'receipt', 'transaction'],
      match: 'any'
    }],
    label: 'Finance/Invoices',
    confidence: 0.75,
    priority: 85,
    enabled: true
  },
  {
    id: 'bank-domains',
    type: 'sender',
    patterns: [
      { domain: 'hdfcbank.net' },
      { domain: 'icicibank.com' },
      { domain: 'sbi.co.in' },
      { domain: 'axisbank.com' },
      { domain: 'kotak.com' },
      { domain: 'paypal.com' },
      { domain: 'razorpay.com' }
    ],
    label: 'Finance/Invoices',
    confidence: 0.90,
    priority: 100,
    enabled: true
  },
  
  // Travel
  {
    id: 'travel-domains',
    type: 'sender',
    patterns: [
      { domain: 'makemytrip.com' },
      { domain: 'goibibo.com' },
      { domain: 'booking.com' },
      { domain: 'airbnb.com' },
      { domain: 'irctc.co.in' },
      { domain: 'cleartrip.com' }
    ],
    label: 'Travel',
    confidence: 0.90,
    priority: 100,
    enabled: true
  },
  {
    id: 'travel-pattern',
    type: 'pattern',
    patterns: [{
      location: 'subject',
      regex: '(booking|flight|hotel|reservation|itinerary|boarding pass)\\s*(confirm|detail|receipt)',
      flags: 'i'
    }],
    label: 'Travel',
    confidence: 0.85,
    priority: 110,
    enabled: true
  },
  
  // Newsletters
  {
    id: 'list-id-header',
    type: 'header',
    patterns: [{
      header: 'List-Id',
      exists: true
    }],
    label: 'Newsletters',
    confidence: 0.90,
    priority: 150,
    enabled: true
  },
  {
    id: 'unsubscribe-keyword',
    type: 'keyword',
    patterns: [{
      location: 'body',
      keywords: ['unsubscribe', 'opt out', 'manage preferences', 'email preferences'],
      match: 'any'
    }],
    label: 'Newsletters',
    confidence: 0.70,
    priority: 50,
    enabled: true
  },
  
  // Work / Meetings
  {
    id: 'calendar-invite',
    type: 'keyword',
    patterns: [{
      location: 'subject',
      keywords: ['invitation', 'meeting', 'calendar', 'invite', 'rsvp', 'agenda', 'standup', 'sync'],
      match: 'any'
    }],
    label: 'Work/Meetings',
    confidence: 0.75,
    priority: 80,
    enabled: true
  },
  {
    id: 'google-calendar',
    type: 'sender',
    patterns: [{ domain: 'calendar-notification@google.com', exact: true }],
    label: 'Work/Meetings',
    confidence: 0.95,
    priority: 140,
    enabled: true
  },
  
  // Marketing
  {
    id: 'marketing-keywords',
    type: 'keyword',
    patterns: [{
      location: 'subject',
      keywords: ['sale', 'discount', 'offer', 'deal', 'promotion', 'limited time', 'exclusive', 'free'],
      match: 'any'
    }],
    label: 'Marketing',
    confidence: 0.65,
    priority: 40,
    enabled: true
  }
];

// ============================================================
// RULE ENGINE
// ============================================================

var RuleEngine = {
  
  /**
   * Evaluate all rules against an email.
   * Rules are processed in priority order (highest first).
   * 
   * @param {Object} email - Parsed email object
   * @returns {Object|null} Best match: { label, confidence, ruleId, source }
   */
  evaluate: function(email) {
    var rules = ConfigManager.getRules();
    
    // Sort by priority (highest first)
    rules.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
    
    var bestMatch = null;
    
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.enabled) continue;
      
      var matched = this.evaluateRule(rule, email);
      
      if (matched) {
        var confidence = ConfidenceScorer.calculate(rule, email, matched);
        
        // Short-circuit for very high confidence matches
        if (confidence >= 0.95) {
          return {
            label: rule.label,
            confidence: confidence,
            ruleId: rule.id,
            source: 'rule',
            reasoning: 'High confidence rule match: ' + rule.id
          };
        }
        
        // Track best match
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            label: rule.label,
            confidence: confidence,
            ruleId: rule.id,
            source: 'rule',
            reasoning: 'Rule match: ' + rule.id
          };
        }
      }
    }
    
    return bestMatch;
  },
  
  /**
   * Evaluate a single rule against an email.
   * @param {Object} rule - Rule definition
   * @param {Object} email - Email object
   * @returns {boolean} Whether the rule matched
   */
  evaluateRule: function(rule, email) {
    switch (rule.type) {
      case 'sender':
        return this.evaluateSenderRule(rule, email);
      case 'keyword':
        return this.evaluateKeywordRule(rule, email);
      case 'pattern':
        return this.evaluatePatternRule(rule, email);
      case 'header':
        return this.evaluateHeaderRule(rule, email);
      case 'composite':
        return this.evaluateCompositeRule(rule, email);
      default:
        Logger.log('Unknown rule type: ' + rule.type);
        return false;
    }
  },
  
  /**
   * Evaluate a sender-based rule.
   */
  evaluateSenderRule: function(rule, email) {
    var senderEmail = (email.from || '').toLowerCase();
    
    for (var i = 0; i < rule.patterns.length; i++) {
      var pattern = rule.patterns[i];
      
      if (pattern.exact) {
        if (senderEmail === pattern.domain.toLowerCase()) return true;
      } else if (pattern.domain) {
        if (senderEmail.endsWith('@' + pattern.domain.toLowerCase()) ||
            senderEmail.endsWith('.' + pattern.domain.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  },
  
  /**
   * Evaluate a keyword-based rule.
   */
  evaluateKeywordRule: function(rule, email) {
    for (var p = 0; p < rule.patterns.length; p++) {
      var pattern = rule.patterns[p];
      var text = '';
      
      if (pattern.location === 'subject') {
        text = (email.subject || '').toLowerCase();
      } else if (pattern.location === 'body') {
        text = (email.body || '').toLowerCase();
      } else {
        text = ((email.subject || '') + ' ' + (email.body || '')).toLowerCase();
      }
      
      var matchCount = 0;
      for (var k = 0; k < pattern.keywords.length; k++) {
        if (text.indexOf(pattern.keywords[k].toLowerCase()) !== -1) {
          matchCount++;
        }
      }
      
      if (pattern.match === 'all') {
        if (matchCount === pattern.keywords.length) return true;
      } else {
        // match: 'any' (default)
        if (matchCount > 0) return true;
      }
    }
    return false;
  },
  
  /**
   * Evaluate a regex pattern-based rule.
   */
  evaluatePatternRule: function(rule, email) {
    for (var p = 0; p < rule.patterns.length; p++) {
      var pattern = rule.patterns[p];
      var text = '';
      
      if (pattern.location === 'subject') {
        text = email.subject || '';
      } else if (pattern.location === 'body') {
        text = email.body || '';
      } else {
        text = (email.subject || '') + ' ' + (email.body || '');
      }
      
      try {
        var regex = new RegExp(pattern.regex, pattern.flags || '');
        if (regex.test(text)) return true;
      } catch (e) {
        Logger.log('Invalid regex in rule ' + rule.id + ': ' + e.message);
      }
    }
    return false;
  },
  
  /**
   * Evaluate a header-based rule.
   */
  evaluateHeaderRule: function(rule, email) {
    var headers = email.headers || {};
    
    for (var p = 0; p < rule.patterns.length; p++) {
      var pattern = rule.patterns[p];
      
      if (pattern.exists) {
        // Check if header exists
        if (headers[pattern.header] !== undefined && headers[pattern.header] !== null) {
          return true;
        }
      } else if (pattern.value) {
        // Check header value
        var headerVal = headers[pattern.header] || '';
        if (headerVal.toLowerCase().indexOf(pattern.value.toLowerCase()) !== -1) {
          return true;
        }
      }
    }
    return false;
  },
  
  /**
   * Evaluate a composite rule (AND/OR of sub-rules).
   */
  evaluateCompositeRule: function(rule, email) {
    if (!rule.rules || rule.rules.length === 0) return false;
    
    if (rule.operator === 'AND') {
      for (var i = 0; i < rule.rules.length; i++) {
        if (!this.evaluateRule(rule.rules[i], email)) return false;
      }
      return true;
    } else {
      // OR (default)
      for (var j = 0; j < rule.rules.length; j++) {
        if (this.evaluateRule(rule.rules[j], email)) return true;
      }
      return false;
    }
  }
};

// ============================================================
// CONFIDENCE SCORER
// ============================================================

var ConfidenceScorer = {
  
  WEIGHTS: {
    ruleMatch: 0.25,
    ruleSpecificity: 0.25,
    emailClarity: 0.20,
    historicalAccuracy: 0.15,
    senderReputation: 0.15
  },
  
  /**
   * Calculate confidence score for a rule match.
   * @param {Object} rule - The matched rule
   * @param {Object} email - The email
   * @param {boolean} matched - Whether the rule matched
   * @returns {number} Confidence score between 0 and 1
   */
  calculate: function(rule, email, matched) {
    if (!matched) return 0;
    
    var ruleMatchScore = rule.confidence || 0.5;
    var specificityScore = this.getRuleSpecificity(rule.type);
    var clarityScore = this.getEmailClarity(email);
    var historicalScore = this.getHistoricalAccuracy(rule.id);
    var reputationScore = this.getSenderReputation(email.from);
    
    var finalScore = 
      this.WEIGHTS.ruleMatch * ruleMatchScore +
      this.WEIGHTS.ruleSpecificity * specificityScore +
      this.WEIGHTS.emailClarity * clarityScore +
      this.WEIGHTS.historicalAccuracy * historicalScore +
      this.WEIGHTS.senderReputation * reputationScore;
    
    return Math.min(1, Math.max(0, finalScore));
  },
  
  /**
   * Score rule type specificity (more specific = higher score).
   */
  getRuleSpecificity: function(ruleType) {
    var scores = {
      'composite': 0.95,
      'header': 0.90,
      'sender': 0.85,
      'pattern': 0.70,
      'keyword': 0.50
    };
    return scores[ruleType] || 0.50;
  },
  
  /**
   * Assess email clarity (well-formed = higher score).
   */
  getEmailClarity: function(email) {
    var clarity = 0.5;
    if (email.subject && email.subject.length > 5) clarity += 0.15;
    if (email.body && email.body.length > 50) clarity += 0.15;
    if (email.from && email.from.indexOf('@') !== -1) clarity += 0.10;
    if (!this.hasUnusualCharacters(email)) clarity += 0.10;
    return Math.min(1, Math.max(0, clarity));
  },
  
  /**
   * Check for excessive non-ASCII characters.
   */
  hasUnusualCharacters: function(email) {
    var text = (email.subject || '') + (email.body || '').substring(0, 500);
    var unusualCount = (text.match(/[^\x00-\x7F]/g) || []).length;
    return unusualCount > text.length * 0.3;
  },
  
  /**
   * Get historical accuracy for a rule.
   */
  getHistoricalAccuracy: function(ruleId) {
    // Guard: AnalyticsManager is optional
    if (typeof AnalyticsManager !== 'undefined' && AnalyticsManager.SPREADSHEET_ID) {
      try {
        var stats = AnalyticsManager.getRuleStats(ruleId);
        if (stats && stats.total > 0) {
          return stats.correct / stats.total;
        }
      } catch (e) {
        // Analytics unavailable
      }
    }
    return 0.8; // Default when analytics is unavailable
  },
  
  /**
   * Get sender reputation from history.
   */
  getSenderReputation: function(senderEmail) {
    var senderHistory = ConfigManager.getSenderHistory(senderEmail);
    if (senderHistory && senderHistory.total > 0) {
      return senderHistory.accuracy;
    }
    return 0.5; // Unknown sender
  }
};

// ============================================================
// THRESHOLD MANAGER
// ============================================================

var ThresholdManager = {
  
  /**
   * Determine if a confidence score meets the threshold for a given action.
   * @param {number} confidence - The confidence score
   * @param {string} action - 'accept' or 'escalate'
   * @returns {boolean}
   */
  meetsThreshold: function(confidence, action) {
    if (action === 'accept') {
      return confidence >= ConfigManager.getConfidenceThreshold();
    }
    if (action === 'escalate') {
      return confidence < ConfigManager.getConfidenceThreshold();
    }
    return false;
  }
};

// ============================================================
// CLASSIFICATION ROUTER
// ============================================================

var ClassificationRouter = {
  
  /**
   * Main classification entry point. Decides between rule-based and LLM classification.
   * 
   * Flow:
   *   1. Try rules first (fast, free)
   *   2. If confident enough → accept
   *   3. If not → escalate to LLM
   *   4. If LLM agrees with rules → boost confidence
   *   5. If all fails → fallback classifier
   * 
   * @param {Object} email - Parsed email object
   * @returns {Object} { label, confidence, source, reasoning }
   */
  classify: function(email) {
    // Validate input
    var validation = InputValidator.validateEmail(email);
    if (!validation.valid) {
      Logger.log('Invalid email: ' + validation.error);
      return FallbackClassifier.classify(email);
    }
    
    // Step 1: Try rule engine
    var ruleResult = RuleEngine.evaluate(email);
    
    if (ruleResult && ThresholdManager.meetsThreshold(ruleResult.confidence, 'accept')) {
      // High confidence rule match — accept without LLM
      return ruleResult;
    }
    
    // Step 2: Escalate to LLM
    try {
      LLMClient.initialize();
      var labels = ConfigManager.getLabels();
      var llmResult = LLMClient.classify(email, labels);
      
      if (llmResult && llmResult.label) {
        // If we had a rule result, check consensus
        if (ruleResult && ruleResult.label === llmResult.label) {
          // Consensus — boost confidence
          return {
            label: llmResult.label,
            confidence: Math.min(1, (ruleResult.confidence + llmResult.confidence) / 2 + 0.15),
            source: 'rule+llm-consensus',
            reasoning: 'Rule and LLM agree on classification'
          };
        }
        
        // LLM result takes precedence over low-confidence rule
        return {
          label: llmResult.label,
          confidence: llmResult.confidence,
          source: 'llm',
          reasoning: llmResult.reasoning || 'LLM classification'
        };
      }
    } catch (llmError) {
      Logger.log('LLM classification failed: ' + llmError.message);
    }
    
    // Step 3: Use rule result if we had one (even low confidence)
    if (ruleResult) {
      return ruleResult;
    }
    
    // Step 4: Fallback classifier
    return FallbackClassifier.classify(email);
  }
};

// ============================================================
// FALLBACK CLASSIFIER
// ============================================================

var FallbackClassifier = {
  
  /**
   * Last-resort classification when both rules and LLM fail.
   * Uses sender history and simple heuristics.
   * 
   * @param {Object} email - Parsed email object
   * @returns {Object} Classification result
   */
  classify: function(email) {
    // Try sender history first
    var senderHistory = ConfigManager.getSenderHistory(email.from);
    if (senderHistory && senderHistory.total >= 3) {
      // Find the most common label for this sender
      var bestLabel = null;
      var bestCount = 0;
      for (var label in senderHistory.labels) {
        if (senderHistory.labels[label] > bestCount) {
          bestCount = senderHistory.labels[label];
          bestLabel = label;
        }
      }
      
      if (bestLabel) {
        return {
          label: bestLabel,
          confidence: senderHistory.accuracy * 0.7,
          source: 'fallback',
          reasoning: 'Based on sender history (' + senderHistory.total + ' previous emails)'
        };
      }
    }
    
    // Simple keyword fallback
    var subject = (email.subject || '').toLowerCase();
    var body = (email.body || '').toLowerCase().substring(0, 1000);
    var text = subject + ' ' + body;
    
    var keywordMap = {
      'Shopping': ['order', 'shipped', 'delivery', 'tracking', 'amazon', 'flipkart'],
      'Finance/Invoices': ['invoice', 'payment', 'bill', 'transaction', 'bank'],
      'Travel': ['flight', 'hotel', 'booking', 'reservation', 'travel'],
      'Work/Meetings': ['meeting', 'agenda', 'calendar', 'invite'],
      'Newsletters': ['unsubscribe', 'newsletter'],
      'Marketing': ['sale', 'discount', 'offer', 'deal']
    };
    
    var bestLabel = 'Uncategorized';
    var bestScore = 0;
    
    for (var label in keywordMap) {
      var keywords = keywordMap[label];
      var score = 0;
      for (var k = 0; k < keywords.length; k++) {
        if (text.indexOf(keywords[k]) !== -1) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }
    
    return {
      label: bestLabel,
      confidence: bestScore > 0 ? 0.4 : 0.1,
      source: 'fallback',
      reasoning: bestScore > 0 ? 'Keyword fallback match' : 'Default classification'
    };
  }
};
