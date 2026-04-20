# EcoPrompt

EcoPrompt is a **Tampermonkey** userscript for Gmail that improves Gemini prompts directly inside `mail.google.com`.

## What it does

EcoPrompt detects the Gemini prompt box ("Help me write"), analyzes the user’s text **without using AI**, and displays an overlay with:

- a checklist of missing context
- a prompt quality bar
- **mini**, **small**, and **large** UI modes
- estimated energy savings from avoided follow-up prompts
- session statistics with visual equivalents
- an **"Improve my prompt"** button that enriches the prompt automatically

## Repository contents

- `dist/ecoprompt.user.js` - installable Tampermonkey userscript
- `src/ecoprompt.user.js` - source file
- `README.md`
- `package.json`
- `.gitignore`

## Installation

### Quick install

1. Install **Tampermonkey** in Chrome or Edge.
2. Open `dist/ecoprompt.user.js`.
3. Tampermonkey will show the install screen.
4. Click **Install**.
5. Open Gmail and then open Gemini "Help me write".

### Manual install

1. Create a new script in Tampermonkey.
2. Copy the contents of `dist/ecoprompt.user.js`.
3. Save the script.
4. Reload Gmail.

## How it works

### 1. Gemini prompt detection

The script uses `MutationObserver` plus heuristic matching on visible inputs near text such as:

- `Gemini`
- `Help me write`
- `Create`
- `Cancel`

Because Gmail changes its DOM frequently, the script is not tied to a single CSS class.

### 2. Email type classification

The current prototype detects these prompt types through keyword matching:

- meeting request
- follow-up
- apology
- announcement
- general email

### 3. Signals it looks for

Depending on the prompt type, EcoPrompt looks for signals such as:

- tone
- recipient
- goal
- date or time slot
- desired length
- previous context
- urgency
- incident
- resolution
- audience
- call to action

### 4. Prompt scoring

EcoPrompt calculates a score from 0 to 100 using:

- minimum useful length
- contextual richness
- subject or recipient presence in the Gmail compose window
- relevant fields detected for that email type

### 5. Energy savings estimate

The extension uses a configurable prototype estimate:

- `1 avoided prompt ~= 0.001 kWh`

This is not intended to be an exact scientific measurement. It is a design metric for the prototype.

## UI modes

### Mini

Base mode with a compact checklist and quick equivalence summary.

### Small

Shows the advice card plus a side stats card.

### Large

Shows the expanded version with:

- quality bar
- full checklist
- session statistics
- weekly bars
- contextual insight based on email type

## Buttons and behavior

### Improve my prompt

Appends missing helpful instructions to the prompt, such as:

- tone
- preferred time slot
- call to action
- previous context

### Dismiss

Hides the overlay for the current prompt.

### Mode switching

You can switch between:

- mini
- small
- large

Tampermonkey menu commands are also registered for:

- cycling the UI mode
- resetting EcoPrompt stats

## Current limitations

- The real Gmail/Gemini DOM could not be tested directly here, so the detection logic is intentionally heuristic and may need a small selector adjustment depending on the user account layout.
- Gmail changes DOM structure and class names frequently.
- The energy estimate is illustrative.
- The Gemini "Create" action is also detected through visible text, so if Google changes that copy a regex update may be needed.
- This version is intentionally **English-only** for both UI copy and prompt classification.

## Recommended next steps

- add a persistent settings panel
- split statistics by email type
- export stats
- run A/B tests on improved prompts
- add unit tests for `detectPromptType()` and `detectSignals()`
- build a visual Gmail-like demo page for UI testing
- package a Chrome extension version after the Tampermonkey prototype

## Local development

Syntax check:

```bash
node --check dist/ecoprompt.user.js
```
