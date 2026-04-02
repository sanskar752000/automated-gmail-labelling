/**
 * Utils.gs — Error Handling, Retry Logic, Input Validation
 */

// ============================================================
// ERROR HANDLER
// ============================================================

var ErrorHandler = {
  
  ErrorTypes: {
    QUOTA_ERROR: 'QUOTA_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    LLM_API_ERROR: 'LLM_API_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    AUTH_ERROR: 'AUTH_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  },
  
  /**
   * Classify an error into a known type.
   */
  classifyError: function(error) {
    var message = (error.message || '').toLowerCase();
    
    if (message.indexOf('quota') !== -1 || message.indexOf('rate limit') !== -1 ||
        message.indexOf('429') !== -1 || message.indexOf('too many') !== -1) {
      return this.ErrorTypes.QUOTA_ERROR;
    }
    
    if (message.indexOf('timeout') !== -1 || message.indexOf('timed out') !== -1 ||
        message.indexOf('deadline') !== -1) {
      return this.ErrorTypes.TIMEOUT_ERROR;
    }
    
    if (message.indexOf('api error') !== -1 || message.indexOf('api key') !== -1 ||
        message.indexOf('401') !== -1 || message.indexOf('403') !== -1) {
      return this.ErrorTypes.LLM_API_ERROR;
    }
    
    if (message.indexOf('parse') !== -1 || message.indexOf('json') !== -1 ||
        message.indexOf('unexpected token') !== -1) {
      return this.ErrorTypes.PARSE_ERROR;
    }
    
    if (message.indexOf('authorization') !== -1 || message.indexOf('permission') !== -1) {
      return this.ErrorTypes.AUTH_ERROR;
    }
    
    return this.ErrorTypes.UNKNOWN_ERROR;
  },
  
  /**
   * Handle an error based on its type.
   * @returns {Object} Action to take
   */
  handleError: function(error, context) {
    var errorType = this.classifyError(error);
    
    Logger.log('Error in ' + context + ': [' + errorType + '] ' + error.message);
    
    switch (errorType) {
      case this.ErrorTypes.QUOTA_ERROR:
        // Do NOT sleep — just signal to stop processing
        return { action: 'stop', reason: 'quota_exceeded' };
        
      case this.ErrorTypes.TIMEOUT_ERROR:
        return { action: 'retry', reduceBatch: true };
        
      case this.ErrorTypes.LLM_API_ERROR:
        return { action: 'fallback', useDefault: true };
        
      case this.ErrorTypes.PARSE_ERROR:
        return { action: 'fallback', useRegex: true };
        
      case this.ErrorTypes.AUTH_ERROR:
        return { action: 'stop', reason: 'auth_failed' };
        
      default:
        return { action: 'skip', reason: 'unknown_error' };
    }
  }
};

// ============================================================
// RETRY MANAGER
// ============================================================

var RetryManager = {
  
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 1000,
  
  /**
   * Execute a function with retry logic and exponential backoff.
   * 
   * @param {Function} fn - Function to execute
   * @param {number} [maxRetries] - Max retry attempts
   * @returns {*} Function result
   */
  withRetry: function(fn, maxRetries) {
    var retries = maxRetries || this.MAX_RETRIES;
    var lastError = null;
    
    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        return fn();
      } catch (error) {
        lastError = error;
        var errorType = ErrorHandler.classifyError(error);
        
        // Don't retry auth or quota errors
        if (errorType === ErrorHandler.ErrorTypes.AUTH_ERROR ||
            errorType === ErrorHandler.ErrorTypes.QUOTA_ERROR) {
          throw error;
        }
        
        if (attempt < retries) {
          // Exponential backoff: 1s, 2s, 4s
          var delay = this.BASE_DELAY_MS * Math.pow(2, attempt);
          Logger.log('Retry ' + (attempt + 1) + '/' + retries + ' after ' + delay + 'ms');
          Utilities.sleep(delay);
        }
      }
    }
    
    throw lastError;
  }
};

// ============================================================
// INPUT VALIDATOR
// ============================================================

var InputValidator = {
  
  /**
   * Validate a parsed email object.
   * @param {Object} email - Email to validate
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateEmail: function(email) {
    if (!email || typeof email !== 'object') {
      return { valid: false, error: 'Invalid email object' };
    }
    
    if (!email.id || (typeof email.id === 'string' && email.id.length > 100)) {
      return { valid: false, error: 'Invalid email ID' };
    }
    
    if (!email.from || !this.isValidEmail(email.from)) {
      return { valid: false, error: 'Invalid sender email: ' + email.from };
    }
    
    // Truncate oversized fields to prevent issues
    if (email.subject && email.subject.length > 1000) {
      email.subject = email.subject.substring(0, 1000);
    }
    
    if (email.body && email.body.length > 100000) {
      email.body = email.body.substring(0, 5000);
    }
    
    return { valid: true };
  },
  
  /**
   * Basic email address validation.
   */
  isValidEmail: function(email) {
    if (!email || typeof email !== 'string') return false;
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  
  /**
   * Validate a rule object.
   */
  validateRule: function(rule) {
    if (!rule || typeof rule !== 'object') {
      return { valid: false, error: 'Invalid rule object' };
    }
    
    var validTypes = ['sender', 'keyword', 'pattern', 'header', 'composite'];
    if (validTypes.indexOf(rule.type) === -1) {
      return { valid: false, error: 'Invalid rule type: ' + rule.type };
    }
    
    if (!rule.label || rule.label.length > 100) {
      return { valid: false, error: 'Invalid label name' };
    }
    
    if (typeof rule.confidence !== 'number' || rule.confidence < 0 || rule.confidence > 1) {
      return { valid: false, error: 'Confidence must be between 0 and 1' };
    }
    
    return { valid: true };
  },
  
  /**
   * Sanitize a string for safe display.
   * Does NOT escape slashes (needed for email addresses and label paths).
   */
  sanitizeInput: function(input) {
    if (typeof input !== 'string') return input;
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
};
