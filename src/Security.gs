/**
 * Security.gs — API Key Management
 * 
 * API keys are stored in Script Properties, which are access-controlled
 * by Google — only script editors can view them.
 */

var SecurityManager = {
  
  /**
   * Store an API key in Script Properties.
   * @param {string} apiKey - The API key
   * @param {string} provider - 'gemini', 'openai', or 'anthropic'
   */
  storeApiKey: function(apiKey, provider) {
    var validation = this.validateApiKey(apiKey, provider);
    if (!validation.valid) {
      throw new Error('Invalid API key: ' + validation.error);
    }
    
    var props = PropertiesService.getScriptProperties();
    props.setProperty('LLM_API_KEY', apiKey);
    props.setProperty('LLM_PROVIDER', provider);
    
    // Set default model for provider
    var defaultModels = {
      'gemini': 'gemini-2.0-flash',
      'openai': 'gpt-4o-mini',
      'anthropic': 'claude-3-haiku-20240307'
    };
    props.setProperty('LLM_MODEL', defaultModels[provider] || 'gemini-2.0-flash');
    
    // Reset LLMClient so it re-initializes
    LLMClient._initialized = false;
    
    Logger.log('API key stored for provider: ' + provider);
  },
  
  /**
   * Get the stored API key.
   * @returns {string} The API key
   */
  getApiKey: function() {
    var apiKey = PropertiesService.getScriptProperties().getProperty('LLM_API_KEY');
    if (!apiKey) {
      throw new Error('API key not configured. Run setupApiKey() or use the API Key dialog.');
    }
    return apiKey;
  },
  
  /**
   * Validate an API key format.
   * @param {string} apiKey - Key to validate
   * @param {string} provider - Provider name
   * @returns {Object} { valid, error? }
   */
  validateApiKey: function(apiKey, provider) {
    if (!apiKey || apiKey.trim().length === 0) {
      return { valid: false, error: 'API key is required' };
    }
    
    if (apiKey.length < 10) {
      return { valid: false, error: 'API key is too short' };
    }
    
    // Provider-specific hints (not strict validation — key formats change)
    if (provider === 'gemini' && !apiKey.startsWith('AIza')) {
      Logger.log('Warning: Gemini API key usually starts with "AIza". Verify the key.');
    }
    
    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
      Logger.log('Warning: OpenAI API key usually starts with "sk-". Verify the key.');
    }
    
    if (provider === 'anthropic' && apiKey.length < 20) {
      return { valid: false, error: 'Invalid Anthropic API key format' };
    }
    
    return { valid: true };
  },
  
  /**
   * Check if an API key is configured.
   * @returns {boolean}
   */
  isConfigured: function() {
    var key = PropertiesService.getScriptProperties().getProperty('LLM_API_KEY');
    return !!key && key.length > 0;
  },
  
  /**
   * Get the current provider name.
   * @returns {string}
   */
  getProvider: function() {
    return PropertiesService.getScriptProperties().getProperty('LLM_PROVIDER') || 'gemini';
  }
};

// ============================================================
// SERVER-SIDE FUNCTIONS FOR HTML DIALOGS
// ============================================================

/**
 * Called from ApiKeyDialog.html to save the API key.
 */
function saveApiKey(apiKey, provider) {
  SecurityManager.storeApiKey(apiKey, provider);
  return { success: true, message: 'API key saved for ' + provider };
}

/**
 * Called from ApiKeyDialog.html to check if API key is configured.
 */
function getApiKeyStatus() {
  return {
    configured: SecurityManager.isConfigured(),
    provider: SecurityManager.getProvider()
  };
}
