/**
 * Config.gs — Configuration Management
 * 
 * Manages all persistent configuration via PropertiesService.
 * Handles rules, labels, thresholds, processing state, and sender history.
 * 
 * Storage limits:
 *   - 9KB per property value
 *   - 500KB total across all properties
 */

var ConfigManager = {
  _initialized: false,
  _config: null,
  
  /**
   * Initialize configuration. Creates defaults on first run.
   */
  initialize: function() {
    if (this._initialized) return;
    
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('config_version');
    
    if (!existing) {
      Logger.log('First run detected. Initializing default configuration...');
      this._setDefaults(props);
    }
    
    this._initialized = true;
  },
  
  /**
   * Set default configuration values.
   */
  _setDefaults: function(props) {
    var defaults = {
      'config_version': '1.0',
      'lastProcessedTimestamp': '0',
      'stats_ruleCount': '0',
      'stats_llmCount': '0',
      'stats_fallbackCount': '0',
      'confidence_threshold': '0.75',
      'llm_threshold': '0.50'
    };
    
    // Set LLM defaults only if not already configured
    if (!props.getProperty('LLM_PROVIDER')) {
      defaults['LLM_PROVIDER'] = 'gemini';
      defaults['LLM_MODEL'] = 'gemini-2.0-flash';
    }
    
    props.setProperties(defaults);
    
    // Store default rules
    props.setProperty('rules', JSON.stringify(DEFAULT_RULES));
    
    // Store default labels
    props.setProperty('labels', JSON.stringify(LabelManager.DEFAULT_LABELS));
    
    Logger.log('Default configuration initialized.');
  },
  
  // ============================================================
  // PROCESSING STATE (timestamp-based tracking)
  // ============================================================
  
  /**
   * Get the timestamp of the last processed email.
   * @returns {number} Epoch milliseconds, or 0 if never processed
   */
  getLastProcessedTimestamp: function() {
    var props = PropertiesService.getScriptProperties();
    var ts = props.getProperty('lastProcessedTimestamp');
    return ts ? parseInt(ts, 10) : 0;
  },
  
  /**
   * Save the timestamp of the last processed email.
   * @param {number} timestamp - Epoch milliseconds
   */
  setLastProcessedTimestamp: function(timestamp) {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('lastProcessedTimestamp', timestamp.toString());
  },
  
  // ============================================================
  // RULES
  // ============================================================
  
  /**
   * Get all classification rules.
   * @returns {Array} Array of rule objects
   */
  getRules: function() {
    var props = PropertiesService.getScriptProperties();
    var rulesJson = props.getProperty('rules');
    if (!rulesJson) return DEFAULT_RULES;
    
    try {
      return JSON.parse(rulesJson);
    } catch (e) {
      Logger.log('Error parsing rules, using defaults: ' + e.message);
      return DEFAULT_RULES;
    }
  },
  
  /**
   * Save rules to PropertiesService.
   * @param {Array} rules - Array of rule objects
   */
  setRules: function(rules) {
    var json = JSON.stringify(rules);
    if (json.length > 9000) {
      Logger.log('WARNING: Rules JSON is ' + json.length + ' bytes (limit: 9KB). Consider reducing.');
    }
    PropertiesService.getScriptProperties().setProperty('rules', json);
  },
  
  // ============================================================
  // LABELS
  // ============================================================
  
  /**
   * Get configured labels.
   * @returns {Array} Array of label names
   */
  getLabels: function() {
    var props = PropertiesService.getScriptProperties();
    var labelsJson = props.getProperty('labels');
    if (!labelsJson) return LabelManager.DEFAULT_LABELS;
    
    try {
      return JSON.parse(labelsJson);
    } catch (e) {
      return LabelManager.DEFAULT_LABELS;
    }
  },
  
  // ============================================================
  // THRESHOLDS
  // ============================================================
  
  /**
   * Get confidence threshold for accepting rule-based classification.
   * @returns {number} Threshold value between 0 and 1
   */
  getConfidenceThreshold: function() {
    var props = PropertiesService.getScriptProperties();
    var val = props.getProperty('confidence_threshold');
    return val ? parseFloat(val) : 0.75;
  },
  
  /**
   * Get the minimum threshold for LLM escalation.
   * @returns {number} Threshold value between 0 and 1
   */
  getLlmThreshold: function() {
    var props = PropertiesService.getScriptProperties();
    var val = props.getProperty('llm_threshold');
    return val ? parseFloat(val) : 0.50;
  },
  
  // ============================================================
  // SENDER HISTORY
  // ============================================================
  
  /**
   * Get classification history for a sender.
   * @param {string} senderEmail - Email address
   * @returns {Object|null} { total, labels: { labelName: count }, accuracy }
   */
  getSenderHistory: function(senderEmail) {
    var props = PropertiesService.getUserProperties();
    var key = 'sender_' + senderEmail.toLowerCase();
    var data = props.getProperty(key);
    
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  },
  
  /**
   * Update sender history with a new classification.
   * @param {string} senderEmail - Email address
   * @param {string} label - The label that was applied
   */
  updateSenderHistory: function(senderEmail, label) {
    var props = PropertiesService.getUserProperties();
    var key = 'sender_' + senderEmail.toLowerCase();
    
    var history = this.getSenderHistory(senderEmail) || {
      total: 0,
      labels: {},
      lastSeen: null
    };
    
    history.total++;
    history.labels[label] = (history.labels[label] || 0) + 1;
    history.lastSeen = new Date().toISOString();
    
    // Calculate accuracy (most common label / total)
    var maxCount = 0;
    for (var l in history.labels) {
      if (history.labels[l] > maxCount) maxCount = history.labels[l];
    }
    history.accuracy = history.total > 0 ? maxCount / history.total : 0;
    
    var json = JSON.stringify(history);
    if (json.length < 9000) {
      props.setProperty(key, json);
    }
  },
  
  // ============================================================
  // STATISTICS
  // ============================================================
  
  /**
   * Increment classification stats by source.
   * @param {string} source - 'rule', 'llm', or 'fallback'
   */
  incrementStats: function(source) {
    var props = PropertiesService.getScriptProperties();
    var key = 'stats_' + source + 'Count';
    var current = parseInt(props.getProperty(key) || '0', 10);
    props.setProperty(key, (current + 1).toString());
  },
  
  /**
   * Get overall classification statistics.
   * @returns {Object} Stats object
   */
  getStats: function() {
    var props = PropertiesService.getScriptProperties();
    var ruleCount = parseInt(props.getProperty('stats_ruleCount') || '0', 10);
    var llmCount = parseInt(props.getProperty('stats_llmCount') || '0', 10);
    var fallbackCount = parseInt(props.getProperty('stats_fallbackCount') || '0', 10);
    var total = ruleCount + llmCount + fallbackCount;
    
    return {
      total: total,
      rule: ruleCount,
      llm: llmCount,
      fallback: fallbackCount,
      rulePercentage: total > 0 ? (ruleCount / total * 100).toFixed(1) : '0.0',
      llmPercentage: total > 0 ? (llmCount / total * 100).toFixed(1) : '0.0'
    };
  },
  
  /**
   * Reset all statistics.
   */
  resetStats: function() {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('stats_ruleCount', '0');
    props.setProperty('stats_llmCount', '0');
    props.setProperty('stats_fallbackCount', '0');
  },

  // ============================================================
  // LLM CONFIGURATION
  // ============================================================
  
  getLlmProvider: function() {
    return PropertiesService.getScriptProperties().getProperty('LLM_PROVIDER') || 'gemini';
  },
  
  getLlmModel: function() {
    return PropertiesService.getScriptProperties().getProperty('LLM_MODEL') || 'gemini-2.0-flash';
  },
  
  getLlmApiKey: function() {
    return PropertiesService.getScriptProperties().getProperty('LLM_API_KEY') || '';
  }
};
