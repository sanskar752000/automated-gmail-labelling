/**
 * Analytics.gs — Google Sheets Analytics (Optional)
 * 
 * Logs classification results to a Google Sheet for tracking and analysis.
 * 
 * Setup:
 *   1. Create a new Google Sheet
 *   2. Copy the Spreadsheet ID from the URL
 *   3. Set 'ANALYTICS_SPREADSHEET_ID' in Script Properties
 */

var AnalyticsManager = {
  
  SPREADSHEET_ID: null,
  SHEET_NAME: 'Classification Log',
  STATS_SHEET_NAME: 'Daily Stats',
  MAX_LOG_ROWS: 10000,
  
  _initialized: false,
  
  /**
   * Initialize analytics. Returns false if not configured.
   */
  initialize: function() {
    if (this._initialized) return !!this.SPREADSHEET_ID;
    
    this.SPREADSHEET_ID = PropertiesService.getScriptProperties()
      .getProperty('ANALYTICS_SPREADSHEET_ID');
    
    this._initialized = true;
    
    if (!this.SPREADSHEET_ID) {
      Logger.log('Analytics not configured. Set ANALYTICS_SPREADSHEET_ID in Script Properties.');
      return false;
    }
    
    // Ensure sheets exist
    this._ensureSheets();
    return true;
  },
  
  /**
   * Create the required sheets if they don't exist.
   */
  _ensureSheets: function() {
    try {
      var ss = SpreadsheetApp.openById(this.SPREADSHEET_ID);
      
      // Classification Log sheet
      var logSheet = ss.getSheetByName(this.SHEET_NAME);
      if (!logSheet) {
        logSheet = ss.insertSheet(this.SHEET_NAME);
        logSheet.appendRow([
          'Timestamp', 'From', 'Subject', 'Label', 'Confidence',
          'Source', 'Reasoning', 'Rule ID', 'Processing Time (ms)'
        ]);
        logSheet.setFrozenRows(1);
        logSheet.getRange(1, 1, 1, 9).setFontWeight('bold');
      }
      
      // Daily Stats sheet
      var statsSheet = ss.getSheetByName(this.STATS_SHEET_NAME);
      if (!statsSheet) {
        statsSheet = ss.insertSheet(this.STATS_SHEET_NAME);
        statsSheet.appendRow([
          'Date', 'Total', 'Rule-Based', 'LLM', 'Fallback',
          'Rule %', 'Avg Confidence'
        ]);
        statsSheet.setFrozenRows(1);
        statsSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
      }
    } catch (e) {
      Logger.log('Error setting up analytics sheets: ' + e.message);
    }
  },
  
  /**
   * Log a classification result.
   */
  logClassification: function(email, result, startTime) {
    if (!this.initialize()) return;
    
    try {
      var ss = SpreadsheetApp.openById(this.SPREADSHEET_ID);
      var sheet = ss.getSheetByName(this.SHEET_NAME);
      
      if (!sheet) return;
      
      // Enforce max rows (delete oldest rows if over limit)
      var lastRow = sheet.getLastRow();
      if (lastRow > this.MAX_LOG_ROWS) {
        sheet.deleteRows(2, lastRow - this.MAX_LOG_ROWS);
      }
      
      var processingTime = startTime ? Date.now() - startTime : 0;
      
      sheet.appendRow([
        new Date().toISOString(),
        email.from,
        email.subject,
        result.label,
        result.confidence,
        result.source,
        result.reasoning || '',
        result.ruleId || '',
        processingTime
      ]);
    } catch (e) {
      Logger.log('Error logging to analytics: ' + e.message);
    }
  },
  
  /**
   * Generate daily statistics and append to stats sheet.
   */
  generateDailyStats: function() {
    if (!this.initialize()) return;
    
    var stats = ConfigManager.getStats();
    
    try {
      var ss = SpreadsheetApp.openById(this.SPREADSHEET_ID);
      var sheet = ss.getSheetByName(this.STATS_SHEET_NAME);
      
      if (!sheet) return;
      
      var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
      
      // Check if today's stats already exist
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === today) {
          // Update existing row
          sheet.getRange(i + 1, 2, 1, 6).setValues([[
            stats.total,
            stats.rule,
            stats.llm,
            stats.fallback,
            stats.rulePercentage + '%',
            '—' // Avg confidence not tracked per-day yet
          ]]);
          return;
        }
      }
      
      // Append new row
      sheet.appendRow([
        today,
        stats.total,
        stats.rule,
        stats.llm,
        stats.fallback,
        stats.rulePercentage + '%',
        '—'
      ]);
    } catch (e) {
      Logger.log('Error generating daily stats: ' + e.message);
    }
  },
  
  /**
   * Get overall stats for display.
   */
  getOverallStats: function() {
    var stats = ConfigManager.getStats();
    
    Logger.log('=== Classification Statistics ===');
    Logger.log('Total processed: ' + stats.total);
    Logger.log('Rule-based: ' + stats.rule + ' (' + stats.rulePercentage + '%)');
    Logger.log('LLM: ' + stats.llm + ' (' + stats.llmPercentage + '%)');
    Logger.log('Fallback: ' + stats.fallback);
    
    return stats;
  },
  
  /**
   * Get accuracy stats for a specific rule (used by ConfidenceScorer).
   * @param {string} ruleId - Rule identifier
   * @returns {Object|null} { total, correct }
   */
  getRuleStats: function(ruleId) {
    if (!this.initialize()) return null;
    
    try {
      var ss = SpreadsheetApp.openById(this.SPREADSHEET_ID);
      var sheet = ss.getSheetByName(this.SHEET_NAME);
      if (!sheet) return null;
      
      var data = sheet.getDataRange().getValues();
      var total = 0;
      var correct = 0;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][7] === ruleId) { // Column H = Rule ID
          total++;
          if (data[i][4] >= 0.7) { // Column E = Confidence threshold
            correct++;
          }
        }
      }
      
      return total > 0 ? { total: total, correct: correct } : null;
    } catch (e) {
      return null;
    }
  }
};

// ============================================================
// SERVER-SIDE FUNCTIONS (called from HTML dialogs)
// ============================================================

/**
 * Get rules for the Rules dialog.
 */
function getRulesForDialog() {
  ConfigManager.initialize();
  return ConfigManager.getRules();
}

/**
 * Save rules from the Rules dialog.
 */
function saveRulesFromDialog(rules) {
  ConfigManager.setRules(rules);
  return { success: true, message: 'Rules saved (' + rules.length + ' rules)' };
}

/**
 * Get labels for the Labels dialog.
 */
function getLabelsForDialog() {
  ConfigManager.initialize();
  return ConfigManager.getLabels();
}

/**
 * Save labels from the Labels dialog.
 */
function saveLabelsFromDialog(labels) {
  PropertiesService.getScriptProperties().setProperty('labels', JSON.stringify(labels));
  // Create labels in Gmail
  for (var i = 0; i < labels.length; i++) {
    LabelManager.getOrCreateLabel(labels[i]);
  }
  return { success: true, message: 'Labels saved (' + labels.length + ' labels)' };
}
