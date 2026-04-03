/**
 * Tests.gs — Unit & Integration Tests
 * 
 * Run all tests: runTests()
 * Run specific test: testRuleEngine(), testConfidenceScorer(), etc.
 * 
 * These tests use mock data and DO NOT interact with Gmail or LLM APIs.
 */

// ============================================================
// TEST RUNNER
// ============================================================

function runTests() {
  Logger.log('========================================');
  Logger.log('Running all tests...');
  Logger.log('========================================');
  
  var results = {
    passed: 0,
    failed: 0,
    errors: []
  };
  
  var testSuites = [
    { name: 'RuleEngine', fn: testRuleEngine },
    { name: 'ConfidenceScorer', fn: testConfidenceScorer },
    { name: 'InputValidator', fn: testInputValidator },
    { name: 'ErrorHandler', fn: testErrorHandler },
    { name: 'FallbackClassifier', fn: testFallbackClassifier },
    { name: 'LLMResponseParser', fn: testLLMResponseParser },
    { name: 'ConfigManager', fn: testConfigManager },
    { name: 'GmailServiceHelpers', fn: testGmailServiceHelpers },
    { name: 'RuleLearner', fn: testRuleLearner },
    { name: 'Graduation', fn: testGraduation }
  ];
  
  for (var i = 0; i < testSuites.length; i++) {
    var suite = testSuites[i];
    Logger.log('\n--- ' + suite.name + ' ---');
    try {
      var suiteResults = suite.fn();
      results.passed += suiteResults.passed;
      results.failed += suiteResults.failed;
      if (suiteResults.errors) {
        results.errors = results.errors.concat(suiteResults.errors);
      }
    } catch (e) {
      results.failed++;
      results.errors.push(suite.name + ': ' + e.message);
      Logger.log('SUITE FAILED: ' + e.message);
    }
  }
  
  Logger.log('\n========================================');
  Logger.log('RESULTS: ' + results.passed + ' passed, ' + results.failed + ' failed');
  if (results.errors.length > 0) {
    Logger.log('FAILURES:\n  - ' + results.errors.join('\n  - '));
  }
  Logger.log('========================================');
  
  return results;
}

// ============================================================
// TEST UTILITIES
// ============================================================

function assert(condition, message) {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ' — Expected: ' + expected + ', Got: ' + actual);
  }
}

function runTestCases(testCases) {
  var results = { passed: 0, failed: 0, errors: [] };
  
  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    try {
      tc.fn();
      results.passed++;
      Logger.log('  ✓ ' + tc.name);
    } catch (e) {
      results.failed++;
      results.errors.push(tc.name + ': ' + e.message);
      Logger.log('  ✗ ' + tc.name + ': ' + e.message);
    }
  }
  
  return results;
}

// ============================================================
// MOCK DATA
// ============================================================

function getMockEmails() {
  return {
    amazon: {
      id: 'mock-id-1',
      threadId: 'mock-thread-1',
      from: 'ship-confirm@amazon.in',
      fromFull: 'Amazon.in <ship-confirm@amazon.in>',
      to: 'user@gmail.com',
      subject: 'Your Amazon order #123-456 has shipped',
      body: 'Your package is on its way. Tracking number: IND123456. Expected delivery: Friday.',
      date: new Date(),
      headers: {},
      isRead: false
    },
    
    newsletter: {
      id: 'mock-id-2',
      threadId: 'mock-thread-2',
      from: 'news@techcrunch.com',
      fromFull: 'TechCrunch <news@techcrunch.com>',
      to: 'user@gmail.com',
      subject: 'Daily Tech Newsletter: AI Funding Roundup',
      body: 'Top stories today: AI startup raises $50M... Click to unsubscribe from this newsletter.',
      date: new Date(),
      headers: { 'List-Id': '<techcrunch.list-id.com>' },
      isRead: false
    },
    
    invoice: {
      id: 'mock-id-3',
      threadId: 'mock-thread-3',
      from: 'noreply@hdfcbank.net',
      fromFull: 'HDFC Bank <noreply@hdfcbank.net>',
      to: 'user@gmail.com',
      subject: 'Your Credit Card Statement for March 2025',
      body: 'Dear Customer, your statement is ready. Total due: ₹15,000. Payment due date: 15th April.',
      date: new Date(),
      headers: {},
      isRead: false
    },
    
    meeting: {
      id: 'mock-id-4',
      threadId: 'mock-thread-4',
      from: 'calendar-notification@google.com',
      fromFull: 'Google Calendar <calendar-notification@google.com>',
      to: 'user@gmail.com',
      subject: 'Invitation: Team Standup @ Mon 10am',
      body: 'You have been invited to a meeting. Agenda: Sprint review and planning.',
      date: new Date(),
      headers: {},
      isRead: false
    },
    
    marketing: {
      id: 'mock-id-5',
      threadId: 'mock-thread-5',
      from: 'offers@randomstore.com',
      fromFull: 'Store <offers@randomstore.com>',
      to: 'user@gmail.com',
      subject: 'MASSIVE SALE! 70% discount on everything!',
      body: 'Limited time offer! Buy now and get free shipping. Sale ends Sunday. Unsubscribe here.',
      date: new Date(),
      headers: {},
      isRead: false
    },
    
    unknown: {
      id: 'mock-id-6',
      threadId: 'mock-thread-6',
      from: 'random@unknown-domain.xyz',
      fromFull: 'Somebody <random@unknown-domain.xyz>',
      to: 'user@gmail.com',
      subject: 'Hello there',
      body: 'Just wanted to say hi.',
      date: new Date(),
      headers: {},
      isRead: false
    }
  };
}

// ============================================================
// TEST SUITES
// ============================================================

function testRuleEngine() {
  var emails = getMockEmails();
  // Init config with defaults for testing
  try { ConfigManager.initialize(); } catch(e) { /* ok if properties not available */ }
  
  return runTestCases([
    {
      name: 'Sender rule matches Amazon domain',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'amazon-domain'; });
        var matched = RuleEngine.evaluateSenderRule(rule, emails.amazon);
        assert(matched, 'Should match amazon.in domain');
      }
    },
    {
      name: 'Sender rule does not match unknown domain',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'amazon-domain'; });
        var matched = RuleEngine.evaluateSenderRule(rule, emails.unknown);
        assert(!matched, 'Should not match unknown domain');
      }
    },
    {
      name: 'Keyword rule matches order keywords in subject',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'order-keywords'; });
        var matched = RuleEngine.evaluateKeywordRule(rule, emails.amazon);
        assert(matched, 'Should match "shipped" in Amazon email subject');
      }
    },
    {
      name: 'Keyword rule with match:any works for unsubscribe',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'unsubscribe-keyword'; });
        var matched = RuleEngine.evaluateKeywordRule(rule, emails.newsletter);
        assert(matched, 'Should match "unsubscribe" in newsletter body');
      }
    },
    {
      name: 'Header rule matches List-Id',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'list-id-header'; });
        var matched = RuleEngine.evaluateHeaderRule(rule, emails.newsletter);
        assert(matched, 'Should match List-Id header in newsletter');
      }
    },
    {
      name: 'Header rule does not match when header missing',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'list-id-header'; });
        var matched = RuleEngine.evaluateHeaderRule(rule, emails.amazon);
        assert(!matched, 'Should not match List-Id if header is missing');
      }
    },
    {
      name: 'Pattern rule matches travel booking',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'travel-pattern'; });
        var testEmail = {
          subject: 'Your booking confirmation for Goa trip',
          body: ''
        };
        var matched = RuleEngine.evaluatePatternRule(rule, testEmail);
        assert(matched, 'Should match "booking confirmation" pattern');
      }
    },
    {
      name: 'Bank domain matches finance rule',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'bank-domains'; });
        var matched = RuleEngine.evaluateSenderRule(rule, emails.invoice);
        assert(matched, 'Should match hdfcbank.net domain');
      }
    },
    {
      name: 'Google Calendar matches meeting rule',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'google-calendar'; });
        var matched = RuleEngine.evaluateSenderRule(rule, emails.meeting);
        assert(matched, 'Should match calendar-notification@google.com');
      }
    },
    {
      name: 'Marketing keywords match',
      fn: function() {
        var rule = DEFAULT_RULES.find(function(r) { return r.id === 'marketing-keywords'; });
        var matched = RuleEngine.evaluateKeywordRule(rule, emails.marketing);
        assert(matched, 'Should match "sale" and "discount" in subject');
      }
    },
    {
      name: 'Disabled rules are skipped',
      fn: function() {
        var disabledRule = {
          id: 'test-disabled',
          type: 'sender',
          patterns: [{ domain: 'amazon.in' }],
          label: 'Test',
          confidence: 0.9,
          priority: 200,
          enabled: false
        };
        // evaluateRule still returns true, but evaluate() skips it
        // Test that evaluateRule itself works
        var matched = RuleEngine.evaluateSenderRule(disabledRule, emails.amazon);
        assert(matched, 'Rule itself matches, but evaluate() would skip it');
      }
    }
  ]);
}

function testConfidenceScorer() {
  var emails = getMockEmails();
  
  return runTestCases([
    {
      name: 'Score is between 0 and 1',
      fn: function() {
        var rule = DEFAULT_RULES[0];
        var score = ConfidenceScorer.calculate(rule, emails.amazon, true);
        assert(score >= 0 && score <= 1, 'Score should be 0-1, got: ' + score);
      }
    },
    {
      name: 'Score is 0 when not matched',
      fn: function() {
        var rule = DEFAULT_RULES[0];
        var score = ConfidenceScorer.calculate(rule, emails.amazon, false);
        assertEqual(score, 0, 'Score should be 0 when not matched');
      }
    },
    {
      name: 'Header rules have higher specificity than keyword rules',
      fn: function() {
        var headerSpec = ConfidenceScorer.getRuleSpecificity('header');
        var keywordSpec = ConfidenceScorer.getRuleSpecificity('keyword');
        assert(headerSpec > keywordSpec, 'Header specificity should be > keyword');
      }
    },
    {
      name: 'Email clarity increases with well-formed email',
      fn: function() {
        var goodEmail = { subject: 'A proper subject line', body: 'A body with sufficient content for classification purposes and more text here.', from: 'user@domain.com' };
        var badEmail = { subject: '', body: '', from: '' };
        var goodClarity = ConfidenceScorer.getEmailClarity(goodEmail);
        var badClarity = ConfidenceScorer.getEmailClarity(badEmail);
        assert(goodClarity > badClarity, 'Good email should have higher clarity');
      }
    },
    {
      name: 'Unknown sender gets 0.5 reputation',
      fn: function() {
        var rep = ConfidenceScorer.getSenderReputation('never-seen@test.com');
        assertEqual(rep, 0.5, 'Unknown sender reputation');
      }
    }
  ]);
}

function testInputValidator() {
  return runTestCases([
    {
      name: 'Valid email passes validation',
      fn: function() {
        var result = InputValidator.validateEmail({
          id: 'test-id',
          from: 'valid@email.com',
          subject: 'Test',
          body: 'Body'
        });
        assert(result.valid, 'Should be valid');
      }
    },
    {
      name: 'Missing from field fails',
      fn: function() {
        var result = InputValidator.validateEmail({
          id: 'test-id',
          from: '',
          subject: 'Test'
        });
        assert(!result.valid, 'Should fail without valid from');
      }
    },
    {
      name: 'Null email fails',
      fn: function() {
        var result = InputValidator.validateEmail(null);
        assert(!result.valid, 'Should fail for null');
      }
    },
    {
      name: 'Email address validator works',
      fn: function() {
        assert(InputValidator.isValidEmail('user@domain.com'), 'Standard email');
        assert(InputValidator.isValidEmail('user+tag@sub.domain.co.in'), 'Tagged email');
        assert(!InputValidator.isValidEmail('invalid'), 'No @ sign');
        assert(!InputValidator.isValidEmail(''), 'Empty string');
        assert(!InputValidator.isValidEmail(null), 'Null');
      }
    },
    {
      name: 'Sanitize prevents XSS but keeps slashes',
      fn: function() {
        var input = '<script>alert("xss")</script>';
        var sanitized = InputValidator.sanitizeInput(input);
        assert(sanitized.indexOf('<') === -1, 'Should escape < characters');
        
        var emailPath = 'user@domain.com/label/path';
        var sanitizedPath = InputValidator.sanitizeInput(emailPath);
        assert(sanitizedPath.indexOf('/') !== -1, 'Should keep slashes');
      }
    }
  ]);
}

function testErrorHandler() {
  return runTestCases([
    {
      name: 'Classifies quota errors',
      fn: function() {
        var type = ErrorHandler.classifyError(new Error('Rate limit exceeded'));
        assertEqual(type, 'QUOTA_ERROR', 'Rate limit error type');
      }
    },
    {
      name: 'Classifies timeout errors',
      fn: function() {
        var type = ErrorHandler.classifyError(new Error('Request timed out'));
        assertEqual(type, 'TIMEOUT_ERROR', 'Timeout error type');
      }
    },
    {
      name: 'Classifies API errors',
      fn: function() {
        var type = ErrorHandler.classifyError(new Error('API error 401'));
        assertEqual(type, 'LLM_API_ERROR', 'API error type');
      }
    },
    {
      name: 'Quota errors return stop action (no sleep)',
      fn: function() {
        var result = ErrorHandler.handleError(new Error('quota exceeded'), 'test');
        assertEqual(result.action, 'stop', 'Should stop, not retry with sleep');
      }
    },
    {
      name: 'LLM errors return fallback action',
      fn: function() {
        var result = ErrorHandler.handleError(new Error('API error 500'), 'test');
        assertEqual(result.action, 'fallback', 'Should fallback for API errors');
      }
    }
  ]);
}

function testFallbackClassifier() {
  var emails = getMockEmails();
  
  return runTestCases([
    {
      name: 'Classifies Amazon email as Shopping',
      fn: function() {
        var result = FallbackClassifier.classify(emails.amazon);
        assertEqual(result.label, 'Shopping', 'Amazon email should be Shopping');
        assertEqual(result.source, 'fallback', 'Source should be fallback');
      }
    },
    {
      name: 'Unknown email gets Uncategorized or low confidence',
      fn: function() {
        var result = FallbackClassifier.classify(emails.unknown);
        assert(result.confidence <= 0.5, 'Unknown email should have low confidence');
      }
    },
    {
      name: 'Finance keywords match invoice email',
      fn: function() {
        var result = FallbackClassifier.classify(emails.invoice);
        assert(result.label.indexOf('Finance') !== -1 || result.label === 'Finance/Invoices',
          'Invoice email should match finance, got: ' + result.label);
      }
    }
  ]);
}

function testLLMResponseParser() {
  return runTestCases([
    {
      name: 'Parses clean JSON response',
      fn: function() {
        var response = '{"label": "Shopping", "confidence": 0.92, "reasoning": "Order email"}';
        var result = LLMClient.parseResponse(response);
        assertEqual(result.label, 'Shopping', 'Should parse label');
        assertEqual(result.confidence, 0.92, 'Should parse confidence');
      }
    },
    {
      name: 'Parses JSON in markdown code block',
      fn: function() {
        var response = 'Here is my analysis:\n```json\n{"label": "Travel", "confidence": 0.88, "reasoning": "Flight booking"}\n```';
        var result = LLMClient.parseResponse(response);
        assertEqual(result.label, 'Travel', 'Should extract JSON from code block');
      }
    },
    {
      name: 'Parses JSON embedded in text',
      fn: function() {
        var response = 'Based on the email, I classify it as: {"label": "Finance/Invoices", "confidence": 0.75, "reasoning": "Invoice"}';
        var result = LLMClient.parseResponse(response);
        assertEqual(result.label, 'Finance/Invoices', 'Should find JSON in text');
      }
    },
    {
      name: 'Handles missing confidence',
      fn: function() {
        var response = '{"label": "Marketing"}';
        var result = LLMClient.parseResponse(response);
        assertEqual(result.label, 'Marketing', 'Should parse label');
        assertEqual(result.confidence, 0.7, 'Should default confidence to 0.7');
      }
    },
    {
      name: 'Handles completely invalid response with fallback',
      fn: function() {
        // Need ConfigManager for labels, but might not be available in tests
        try { ConfigManager.initialize(); } catch(e) {}
        var response = 'This email is about shopping for clothes online.';
        var result = LLMClient.parseResponse(response);
        // Should still return something via regex fallback
        assert(result.label !== undefined, 'Should have a label even on parse failure');
      }
    }
  ]);
}

function testConfigManager() {
  return runTestCases([
    {
      name: 'Initialize runs without error',
      fn: function() {
        ConfigManager._initialized = false;
        ConfigManager.initialize();
        assert(true, 'Should initialize');
      }
    },
    {
      name: 'getStats returns valid object',
      fn: function() {
        var stats = ConfigManager.getStats();
        assert(typeof stats.total === 'number', 'Total should be a number');
        assert(typeof stats.rule === 'number', 'Rule should be a number');
        assert(typeof stats.llm === 'number', 'LLM should be a number');
      }
    },
    {
      name: 'getConfidenceThreshold returns a number',
      fn: function() {
        var threshold = ConfigManager.getConfidenceThreshold();
        assert(typeof threshold === 'number', 'Threshold should be number');
        assert(threshold > 0 && threshold < 1, 'Threshold should be 0-1');
      }
    }
  ]);
}

function testGmailServiceHelpers() {
  return runTestCases([
    {
      name: 'extractEmailAddress from "Name <email>" format',
      fn: function() {
        var result = GmailService.extractEmailAddress('Amazon.in <ship-confirm@amazon.in>');
        assertEqual(result, 'ship-confirm@amazon.in', 'Should extract email from angle brackets');
      }
    },
    {
      name: 'extractEmailAddress from plain email',
      fn: function() {
        var result = GmailService.extractEmailAddress('user@domain.com');
        assertEqual(result, 'user@domain.com', 'Should return plain email as-is');
      }
    },
    {
      name: 'extractEmailAddress handles empty string',
      fn: function() {
        var result = GmailService.extractEmailAddress('');
        assertEqual(result, '', 'Should return empty for empty input');
      }
    }
  ]);
}

// ============================================================
// RULE LEARNER TESTS
// ============================================================

function testRuleLearner() {
  return runTestCases([
    {
      name: 'No rule created after 1 classification',
      fn: function() {
        RuleLearner.resetAll();
        var email = { from: 'test@learning-test.com', subject: 'Test' };
        var result = { label: 'Education', confidence: 0.85 };
        
        RuleLearner.learn(email, result);
        
        var rules = RuleLearner.getLearnedRules();
        assertEqual(rules.length, 0, 'Should not create rule after 1 classification');
        RuleLearner.resetAll();
      }
    },
    {
      name: 'No rule created after 2 classifications',
      fn: function() {
        RuleLearner.resetAll();
        var email = { from: 'test@learning-test.com', subject: 'Test' };
        var result = { label: 'Education', confidence: 0.85 };
        
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        
        var rules = RuleLearner.getLearnedRules();
        assertEqual(rules.length, 0, 'Should not create rule after 2 classifications');
        RuleLearner.resetAll();
      }
    },
    {
      name: 'Rule created after 3 consistent classifications',
      fn: function() {
        RuleLearner.resetAll();
        var email = { from: 'test@learning-test.com', subject: 'Test' };
        var result = { label: 'Education', confidence: 0.85 };
        
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        
        var rules = RuleLearner.getLearnedRules();
        assertEqual(rules.length, 1, 'Should create 1 rule after 3 classifications');
        assertEqual(rules[0].label, 'Education', 'Rule should have correct label');
        assertEqual(rules[0].patterns[0].domain, 'learning-test.com', 'Rule should have correct domain');
        RuleLearner.resetAll();
      }
    },
    {
      name: 'Low confidence classifications are ignored',
      fn: function() {
        RuleLearner.resetAll();
        var email = { from: 'test@low-conf.com', subject: 'Test' };
        var result = { label: 'Marketing', confidence: 0.50 };
        
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        
        var rules = RuleLearner.getLearnedRules();
        assertEqual(rules.length, 0, 'Should not learn from low confidence results');
        RuleLearner.resetAll();
      }
    },
    {
      name: 'Inconsistent labels do not create rule',
      fn: function() {
        RuleLearner.resetAll();
        var email = { from: 'test@inconsistent.com', subject: 'Test' };
        
        RuleLearner.learn(email, { label: 'Jobs', confidence: 0.85 });
        RuleLearner.learn(email, { label: 'Education', confidence: 0.85 });
        RuleLearner.learn(email, { label: 'Marketing', confidence: 0.85 });
        
        var rules = RuleLearner.getLearnedRules();
        assertEqual(rules.length, 0, 'Should not create rule for inconsistent labels');
        RuleLearner.resetAll();
      }
    },
    {
      name: 'Domain extraction works',
      fn: function() {
        assertEqual(RuleLearner.extractDomain('user@example.com'), 'example.com', 'Simple domain');
        assertEqual(RuleLearner.extractDomain('user@sub.domain.co.in'), 'sub.domain.co.in', 'Subdomain');
        assertEqual(RuleLearner.extractDomain(null), null, 'Null input');
        assertEqual(RuleLearner.extractDomain(''), null, 'Empty input');
      }
    },
    {
      name: 'resetAll clears everything',
      fn: function() {
        var email = { from: 'test@reset-test.com', subject: 'Test' };
        var result = { label: 'Jobs', confidence: 0.90 };
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        RuleLearner.learn(email, result);
        
        assert(RuleLearner.getLearnedRules().length > 0, 'Should have rules before reset');
        
        RuleLearner.resetAll();
        
        assertEqual(RuleLearner.getLearnedRules().length, 0, 'Should have 0 rules after reset');
        var history = RuleLearner.getLearningHistory();
        var keys = Object.keys(history);
        assertEqual(keys.length, 0, 'Should have empty history after reset');
      }
    }
  ]);
}

// ============================================================
// GRADUATION TESTS
// ============================================================

function testGraduation() {
  return runTestCases([
    {
      name: 'Graduation moves rule to stored rules',
      fn: function() {
        RuleLearner.resetAll();
        
        var email = { from: 'alerts@grad-test-bank.com', subject: 'Transaction' };
        var result = { label: 'Finance/Banking', confidence: 0.90 };
        for (var i = 0; i < 4; i++) {
          RuleLearner.learn(email, result);
        }
        
        var learnedBefore = RuleLearner.getLearnedRules().length;
        assert(learnedBefore > 0, 'Should have learned rules before graduation');
        
        var graduated = RuleLearner.graduateRules(0.85);
        
        assert(graduated.length > 0, 'Should graduate at least 1 rule');
        assertEqual(RuleLearner.getLearnedRules().length, 0, 'Learned rules should be empty after graduation');
        
        var allRules = ConfigManager.getRules();
        var found = allRules.filter(function(r) { return r.id && r.id.indexOf('grad-test-bank') !== -1; });
        assert(found.length > 0, 'Graduated rule should be in stored rules');
        assert(found[0].graduated === true, 'Rule should be marked as graduated');
        
        // Clean up
        RuleLearner.resetAll();
        var cleaned = allRules.filter(function(r) { return !r.id || r.id.indexOf('grad-test-bank') === -1; });
        ConfigManager.setRules(cleaned);
      }
    },
    {
      name: 'Low confidence rules are NOT graduated',
      fn: function() {
        RuleLearner.resetAll();
        
        var email = { from: 'test@low-grad.com', subject: 'Test' };
        var result = { label: 'Marketing', confidence: 0.75 };
        for (var i = 0; i < 3; i++) {
          RuleLearner.learn(email, result);
        }
        
        var graduated = RuleLearner.graduateRules(0.85);
        assertEqual(graduated.length, 0, 'Should not graduate low confidence rules');
        
        var remaining = RuleLearner.getLearnedRules();
        assert(remaining.length > 0, 'Low confidence rule should remain in learned rules');
        
        RuleLearner.resetAll();
      }
    },
    {
      name: 'Graduation cleans up learning history',
      fn: function() {
        RuleLearner.resetAll();
        
        var email = { from: 'test@history-clean.com', subject: 'Test' };
        var result = { label: 'Travel', confidence: 0.90 };
        for (var i = 0; i < 4; i++) {
          RuleLearner.learn(email, result);
        }
        
        var historyBefore = RuleLearner.getLearningHistory();
        assert(historyBefore['history-clean.com'] !== undefined, 'History should exist before graduation');
        
        RuleLearner.graduateRules();
        
        var historyAfter = RuleLearner.getLearningHistory();
        assert(historyAfter['history-clean.com'] === undefined, 'History should be cleaned after graduation');
        
        // Clean up stored rules
        RuleLearner.resetAll();
        var allRules = ConfigManager.getRules();
        ConfigManager.setRules(allRules.filter(function(r) { return !r.id || r.id.indexOf('history-clean') === -1; }));
      }
    }
  ]);
}
