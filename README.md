# Intelligent Email Labeling System

An automated email classification system built on **Google Apps Script** that labels your Gmail emails using a hybrid approach: rule-based classification (fast, free) with LLM fallback (Google Gemini free tier).

## Features

- 🏷️ **Automatic email labeling** — Classifies and labels emails every 10 minutes
- 🧠 **Hybrid classification** — Rules first (free), LLM fallback (Gemini free tier)
- 📧 **Backfill mode** — Label all your historical emails (read + unread)
- 📊 **Analytics** — Optional Google Sheets logging for classification stats
- ⚙️ **Configurable** — Custom rules, labels, and thresholds via HTML dialogs
- 🔒 **Secure** — API keys stored in Google's Script Properties
- 💰 **Free** — $0.00/month with Google Gemini

## Quick Start

### 1. Create Apps Script Project
Go to [script.google.com](https://script.google.com) and create a new project.

### 2. Enable Gmail Advanced Service
In the editor: **Services** (+) → **Gmail API** → **Add**

### 3. Deploy Files
Using **clasp** (recommended):
```bash
npm install -g @google/clasp
clasp login
clasp clone <your-script-id>
clasp push
```

Or manually copy `.gs` and `.html` files from `src/` and `test/` into the editor.

### 4. Get a Free API Key
Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no credit card needed.

### 5. Configure
In Apps Script: **Project Settings** → **Script Properties** → Add:
- `LLM_API_KEY`: Your Gemini API key
- `LLM_PROVIDER`: `gemini`
- `LLM_MODEL`: `gemini-2.0-flash`

### 6. Start
Run `createTimeDrivenTrigger()` from the editor to begin processing.

### 7. (Optional) Backfill Historical Emails
Run `startBackfill()` to label all past emails. Check progress with `getBackfillProgress()`.

## Project Structure

```
├── appsscript.json          # Apps Script manifest
├── src/
│   ├── Code.gs              # Main entry point, triggers, backfill
│   ├── Config.gs            # Configuration management
│   ├── GmailService.gs      # Gmail operations, label management
│   ├── Classifier.gs        # Rules, confidence scoring, routing
│   ├── LLMClient.gs         # Gemini/OpenAI/Anthropic integration
│   ├── Utils.gs             # Error handling, retry, validation
│   ├── Security.gs          # API key management
│   ├── Analytics.gs         # Google Sheets analytics (optional)
│   ├── RulesDialog.html     # UI for rule configuration
│   ├── LabelsDialog.html    # UI for label management
│   └── ApiKeyDialog.html    # UI for API key setup
├── test/
│   └── Tests.gs             # Unit & integration tests
├── .clasp.json              # Clasp deployment config
└── REQUIREMENTS.md          # Full specification
```

## Testing

```bash
# In Apps Script editor, run:
runTests()              # All unit tests
testClassification()    # Dry-run on real emails (no labels applied)
```

## License

MIT
