/**
 * LLMClient.gs — LLM API Integration
 * 
 * Supports:
 *   - Google Gemini (free tier, default)
 *   - OpenAI (paid)
 *   - Anthropic (paid)
 */

var LLMClient = {
  API_KEY: null,
  API_PROVIDER: 'gemini',
  MODEL: 'gemini-2.0-flash',
  MAX_TOKENS: 150,
  TIMEOUT_MS: 25000,
  
  _initialized: false,
  
  /**
   * Initialize from Script Properties.
   */
  initialize: function() {
    if (this._initialized) return;
    
    var props = PropertiesService.getScriptProperties();
    this.API_KEY = props.getProperty('LLM_API_KEY');
    this.API_PROVIDER = props.getProperty('LLM_PROVIDER') || 'gemini';
    this.MODEL = props.getProperty('LLM_MODEL') || 'gemini-2.0-flash';
    
    if (!this.API_KEY) {
      throw new Error(
        'LLM API key not configured. Set LLM_API_KEY in Script Properties. ' +
        'Get a free Gemini key from https://aistudio.google.com/apikey'
      );
    }
    
    this._initialized = true;
  },
  
  /**
   * Classify an email using the configured LLM provider.
   * 
   * @param {Object} email - Parsed email object
   * @param {Array<string>} labels - Available label names
   * @returns {Object} { label, confidence, reasoning }
   */
  classify: function(email, labels) {
    // Check API quota
    if (!QuotaManager.checkApiQuota()) {
      throw new Error('API quota exceeded');
    }
    
    var prompt = this.buildPrompt(email, labels);
    var response;
    
    try {
      if (this.API_PROVIDER === 'gemini') {
        response = this.callGemini(prompt);
      } else if (this.API_PROVIDER === 'openai') {
        response = this.callOpenAI(prompt);
      } else if (this.API_PROVIDER === 'anthropic') {
        response = this.callAnthropic(prompt);
      } else {
        throw new Error('Unsupported LLM provider: ' + this.API_PROVIDER);
      }
      
      return this.parseResponse(response);
    } catch (error) {
      Logger.log('LLM API error (' + this.API_PROVIDER + '): ' + error.message);
      throw error;
    }
  },
  
  /**
   * Build the classification prompt.
   */
  buildPrompt: function(email, labels) {
    return 'Classify the following email into one of these categories: ' +
      labels.join(', ') + '\n\n' +
      'Email Details:\n' +
      'From: ' + email.from + '\n' +
      'Subject: ' + email.subject + '\n' +
      'Body (preview): ' + (email.body || '').substring(0, 2000) + '\n\n' +
      'Respond ONLY with valid JSON in this exact format:\n' +
      '{"label": "category_name", "confidence": 0.85, "reasoning": "brief explanation"}\n\n' +
      'Rules:\n' +
      '- "label" must be exactly one of the categories listed above\n' +
      '- "confidence" must be a number between 0 and 1\n' +
      '- Respond ONLY with the JSON, no other text';
  },
  
  // ============================================================
  // GEMINI (Free tier: 1,500 requests/day)
  // ============================================================
  
  /**
   * Call Google Gemini API.
   * Get a free API key from: https://aistudio.google.com/apikey
   */
  callGemini: function(prompt) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      this.MODEL + ':generateContent?key=' + this.API_KEY;
    
    var payload = {
      contents: [{
        parts: [{
          text: 'You are an email classification assistant. Respond only with valid JSON containing "label", "confidence", and "reasoning" fields.\n\n' + prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: this.MAX_TOKENS
      }
    };
    
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error('Gemini API error ' + responseCode + ': ' + responseText);
    }
    
    var json = JSON.parse(responseText);
    
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    }
    
    throw new Error('Unexpected Gemini response format');
  },
  
  // ============================================================
  // OPENAI (Paid)
  // ============================================================
  
  /**
   * Call OpenAI API.
   */
  callOpenAI: function(prompt) {
    var url = 'https://api.openai.com/v1/chat/completions';
    
    var payload = {
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
      temperature: 0.1
    };
    
    var options = {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + this.API_KEY,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error('OpenAI API error ' + responseCode + ': ' + responseText);
    }
    
    var json = JSON.parse(responseText);
    return json.choices[0].message.content;
  },
  
  // ============================================================
  // ANTHROPIC (Paid)
  // ============================================================
  
  /**
   * Call Anthropic API.
   */
  callAnthropic: function(prompt) {
    var url = 'https://api.anthropic.com/v1/messages';
    
    var payload = {
      model: this.MODEL,
      max_tokens: this.MAX_TOKENS,
      system: 'You are an email classification assistant. Respond only with valid JSON containing "label", "confidence", and "reasoning" fields.',
      messages: [{
        role: 'user',
        content: prompt
      }]
    };
    
    var options = {
      method: 'post',
      headers: {
        'x-api-key': this.API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error('Anthropic API error ' + responseCode + ': ' + responseText);
    }
    
    var json = JSON.parse(responseText);
    return json.content[0].text;
  },
  
  // ============================================================
  // RESPONSE PARSING
  // ============================================================
  
  /**
   * Parse the LLM response text into a classification result.
   * Handles JSON in markdown code blocks, malformed JSON, etc.
   */
  parseResponse: function(responseText) {
    try {
      // Try to extract JSON from markdown code block
      var jsonStr = responseText;
      
      var jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // Try to find raw JSON object
        var braceMatch = responseText.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          jsonStr = braceMatch[0];
        }
      }
      
      var parsed = JSON.parse(jsonStr);
      
      // Validate required fields
      if (!parsed.label) {
        throw new Error('Missing "label" in LLM response');
      }
      
      return {
        label: parsed.label,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        reasoning: parsed.reasoning || '',
        source: 'llm'
      };
    } catch (parseError) {
      Logger.log('Failed to parse LLM response: ' + parseError.message);
      Logger.log('Raw response: ' + responseText.substring(0, 500));
      
      // Attempt regex fallback
      return this.regexFallbackParse(responseText);
    }
  },
  
  /**
   * Fallback: extract label from response using regex.
   */
  regexFallbackParse: function(responseText) {
    var labels = ConfigManager.getLabels();
    var text = responseText.toLowerCase();
    
    for (var i = 0; i < labels.length; i++) {
      if (text.indexOf(labels[i].toLowerCase()) !== -1) {
        return {
          label: labels[i],
          confidence: 0.5,
          reasoning: 'Extracted via regex fallback',
          source: 'llm'
        };
      }
    }
    
    return {
      label: 'Uncategorized',
      confidence: 0.1,
      reasoning: 'Could not parse LLM response',
      source: 'llm'
    };
  }
};
