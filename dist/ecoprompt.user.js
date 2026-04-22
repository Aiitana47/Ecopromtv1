// ==UserScript==
// @name         EcoPrompt for Gmail
// @namespace    https://ecoprompt.local
// @version      2.0.0
// @description  Energy-aware prompt coaching for Gemini inside Gmail
// @author       EcoPrompt
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  /* ─── Constants ─────────────────────────────────────────── */
  const ROOT_ID   = 'ecoprompt-root';
  const STORE_KEY = 'ecoprompt_v2';
  // Source: Google Gemini Apps energy report (median per-prompt estimates)
  const WH_PER_AVOIDED   = 0.24;   // watt-hours
  const CO2G_PER_AVOIDED = 0.03;   // grams CO₂e
  const ML_PER_AVOIDED   = 0.26;   // millilitres of water (~5 drops)

  const TYPE_DEFS = {
    meeting: {
      keywords: ['meeting', 'schedule', 'call', 'appointment', 'sync', 'catch up', 'meet', 'calendar'],
      checks: ['Tone?', 'Recipient', 'Goal', 'When?', 'Length?']
    },
    followup: {
      keywords: ['follow up', 'following up', "haven't heard", 'reminder', 'check in', 'update', 'status'],
      checks: ['Tone?', 'Context?', 'Urgency?', 'Goal', 'Length?']
    },
    apology: {
      keywords: ['sorry', 'apologize', 'apologise', 'my fault', 'mistake', 'error'],
      checks: ['Tone?', 'Incident?', 'Resolution?', 'Goal', 'Length?']
    },
    announcement: {
      keywords: ['announce', 'announcement', 'inform', 'launch', 'introduce', 'share'],
      checks: ['Audience?', 'Tone?', 'Goal', 'Call to action?', 'Length?']
    },
    general: {
      keywords: [],
      checks: ['Tone?', 'Recipient', 'Goal', 'Length?', 'Context?']
    }
  };

  const HINTS = {
    'Tone?':          'formal / friendly / urgent',
    'Recipient':      'who is this for?',
    'Goal':           'what outcome do you want?',
    'When?':          'preferred date / time slot',
    'Length?':        'short / medium / detailed',
    'Urgency?':       'ASAP / deadline / optional',
    'Context?':       'previous email / background',
    'Incident?':      'what happened exactly?',
    'Resolution?':    'how will you fix it?',
    'Audience?':      'team / clients / everyone',
    'Call to action?':'reply / confirm / register'
  };

  const SIGNAL_TESTS = {
    'Tone?':          /formal|friendly|urgent|professional|polite|warm|casual|tone/,
    'Recipient':      /to my|to the|for my|for the|boss|manager|director|team|client|customer|supplier|professor|teacher/,
    'Goal':           /write|draft|compose|send|reply|ask|request|email|message/,
    'When?':          /today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|morning|afternoon|evening|asap|this week/,
    'Length?':        /short|brief|concise|one paragraph|two paragraphs|detailed|bullet|medium|long/,
    'Urgency?':       /urgent|asap|soon|deadline|before eod|by tomorrow|time-sensitive|priority/,
    'Context?':       /following up|follow up|last email|previous email|waiting|regarding|about the|after our conversation/,
    'Incident?':      /because|after|mistake|error|issue|delay|wrong|forgot|problem|missed|failed/,
    'Resolution?':    /fix|refund|replace|correct|reschedule|resolve|clarify|provide|i will/,
    'Audience?':      /team|everyone|all staff|company|department|clients|customers|users|stakeholders/,
    'Call to action?':/reply|confirm|join|register|review|let me know|action required|approve|respond/
  };

  const INSIGHTS = {
    meeting:      'Specifying tone + time slot in meeting request emails reduces follow-ups by ~65%.',
    followup:     'Adding the original thread context + deadline often avoids another clarification round.',
    apology:      'A clear incident + solution usually makes the first draft usable in one go.',
    announcement: 'Naming the audience + call to action usually reduces edits and re-prompts.',
    general:      'Adding tone, recipient and desired length often avoids follow-up prompts.'
  };

  /* ─── State ──────────────────────────────────────────────── */
  const state = {
    store:      loadStore(),
    activeInput: null,
    activeComposeRoot: null,
    dismissed:  false,
    lastInputId: null,
    root:       null
  };

  /* ─── Storage ────────────────────────────────────────────── */
  function loadStore() {
    try {
      const raw = typeof GM_getValue === 'function'
        ? GM_getValue(STORE_KEY, '{}')
        : (localStorage.getItem(STORE_KEY) || '{}');
      const parsed = JSON.parse(raw);
      return {
        mode:           ['mini','small','large'].includes(parsed.mode) ? parsed.mode : 'mini',
        promptsAvoided: parsed.promptsAvoided || 0,
        kWhSaved:       parsed.kWhSaved || 0,
        history:        parsed.history || {},
        improvementsApplied: parsed.improvementsApplied || 0
      };
    } catch (_) {
      return { mode: 'mini', promptsAvoided: 0, kWhSaved: 0, history: {}, improvementsApplied: 0 };
    }
  }

  function saveStore() {
    const payload = JSON.stringify(state.store);
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, payload);
      else localStorage.setItem(STORE_KEY, payload);
    } catch (_) {}
  }

  /* ─── Styles ─────────────────────────────────────────────── */
  function injectStyles() {
    const css = `
      #${ROOT_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        font-family: 'Google Sans', Inter, Arial, sans-serif !important;
        font-size: 12px !important;
        line-height: 1.35 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
      }
      #${ROOT_ID} * { box-sizing: border-box !important; font-family: inherit !important; }
      #${ROOT_ID} .ecp-wrap { pointer-events: auto; display: flex; gap: 8px; align-items: flex-end; }
      #${ROOT_ID}[data-mode="mini"] .ecp-wrap { display: block; }

      /* Advisor card */
      #${ROOT_ID} .ecp-advisor {
        background: #fdf4e0;
        border: 2px solid #f2a41a;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 6px 20px rgba(0,0,0,.16);
        min-width: 220px;
      }
      #${ROOT_ID}[data-mode="large"] .ecp-advisor { flex: 1 1 60%; }
      #${ROOT_ID}[data-mode="small"] .ecp-advisor { flex: 1 1 55%; }

      #${ROOT_ID} .ecp-head {
        background: #f2a41a;
        color: #fff;
        padding: 7px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      #${ROOT_ID} .ecp-head-title { font-weight: 700; font-size: 11px; display: flex; align-items: center; gap: 5px; }
      #${ROOT_ID} .ecp-head-btns { display: flex; gap: 4px; }
      #${ROOT_ID} .ecp-icn {
        width: 20px; height: 20px; border-radius: 5px; border: 1px solid rgba(255,255,255,.35);
        background: rgba(255,255,255,.15); color: #fff; font-size: 11px; cursor: pointer;
        display: grid; place-items: center; line-height: 1;
      }
      #${ROOT_ID} .ecp-icn:hover { background: rgba(255,255,255,.3); }

      #${ROOT_ID} .ecp-body { padding: 8px 10px 3px; }
      #${ROOT_ID} .ecp-quality-row { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
      #${ROOT_ID} .ecp-qlabel { font-size: 10px; color: #666; min-width: 76px; }
      #${ROOT_ID} .ecp-qbar  { flex: 1; height: 7px; background: rgba(0,0,0,.1); border-radius: 99px; overflow: hidden; }
      #${ROOT_ID} .ecp-qfill { height: 100%; border-radius: 99px; background: linear-gradient(90deg,#ff6b57,#ffb627 40%,#49d67d 72%,#7f8cff 100%); }
      #${ROOT_ID} .ecp-qscore { font-size: 10px; font-weight: 700; color: #e06000; white-space: nowrap; }

      #${ROOT_ID} .ecp-hint  { font-size: 10px; color: #555; margin-bottom: 6px; }
      #${ROOT_ID} .ecp-list  { display: grid; gap: 5px; margin-bottom: 6px; }
      #${ROOT_ID} .ecp-item  { display: flex; align-items: center; gap: 6px; }
      #${ROOT_ID} .ecp-chk   {
        width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid rgba(0,0,0,.2);
        background: rgba(255,255,255,.6); display: grid; place-items: center; font-size: 10px;
        color: transparent; flex-shrink: 0;
      }
      #${ROOT_ID} .ecp-item.ok .ecp-chk { background: rgba(73,214,125,.2); border-color: #3bbf63; color: #2e8d4d; }
      #${ROOT_ID} .ecp-iname { font-weight: 600; font-size: 11px; color: #333; }
      #${ROOT_ID} .ecp-iname span { font-weight: 400; color: #888; margin-left: 4px; font-size: 10px; }
      #${ROOT_ID} .ecp-item.ok .ecp-iname span { color: #5d8f62; }

      #${ROOT_ID} .ecp-divider { border-top: 1px solid rgba(0,0,0,.08); margin: 3px -10px; }
      #${ROOT_ID} .ecp-foot { padding: 4px 10px 3px; font-size: 10px; color: #4b8b49; }
      #${ROOT_ID} .ecp-actions { display: flex; gap: 6px; padding: 6px 10px 8px; }
      #${ROOT_ID} .ecp-btn {
        border: none; border-radius: 7px; padding: 6px 10px; font-size: 11px;
        font-weight: 600; cursor: pointer;
      }
      #${ROOT_ID} .ecp-btn-primary { background: #1a73e8; color: #fff; }
      #${ROOT_ID} .ecp-btn-primary:hover { background: #1558b0; }
      #${ROOT_ID} .ecp-btn-secondary { background: rgba(0,0,0,.08); color: #444; }
      #${ROOT_ID} .ecp-btn-secondary:hover { background: rgba(0,0,0,.14); }

      /* Mini two-column layout */
      #${ROOT_ID}[data-mode="mini"] .ecp-cols { display: grid; grid-template-columns: 1.4fr 1fr; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-main { padding: 7px 9px 4px; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side {
        padding: 7px 9px 4px;
        border-left: 1px solid rgba(0,0,0,.1);
        background: rgba(255,255,255,.2);
      }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side-title { font-size: 9px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 10px; color: #333; }
      #${ROOT_ID}[data-mode="mini"] .ecp-mini-actions { padding: 0 9px 7px; }

      /* Stats card */
      #${ROOT_ID} .ecp-stats {
        background: linear-gradient(180deg,#252442,#17162a);
        border: 1px solid rgba(159,130,255,.28);
        border-radius: 12px;
        color: #e9e8ff;
        overflow: hidden;
        box-shadow: 0 6px 20px rgba(0,0,0,.22);
        min-width: 200px;
      }
      #${ROOT_ID}[data-mode="large"] .ecp-stats { flex: 0 0 310px; }
      #${ROOT_ID}[data-mode="small"] .ecp-stats { flex: 0 0 230px; }

      #${ROOT_ID} .ecp-stats-head { padding: 9px 12px 6px; border-bottom: 1px solid rgba(255,255,255,.07); }
      #${ROOT_ID} .ecp-stats-title { font-weight: 700; font-size: 11px; }
      #${ROOT_ID} .ecp-stats-sub   { font-size: 10px; opacity: .65; margin-top: 2px; }
      #${ROOT_ID} .ecp-stats-body  { padding: 8px 12px 12px; }

      #${ROOT_ID} .ecp-section { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: rgba(233,232,255,.55); margin-bottom: 6px; }
      #${ROOT_ID} .ecp-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 9px; }
      #${ROOT_ID} .ecp-metric { background: rgba(255,255,255,.06); border-radius: 8px; padding: 7px 6px; text-align: center; }
      #${ROOT_ID} .ecp-metric-val { font-size: 18px; font-weight: 800; color: #58f394; }
      #${ROOT_ID} .ecp-metric-lbl { font-size: 10px; color: rgba(233,232,255,.65); margin-top: 1px; }

      #${ROOT_ID} .ecp-week { display: grid; gap: 4px; margin-bottom: 9px; }
      #${ROOT_ID} .ecp-week-row { display: grid; grid-template-columns: 26px 1fr 30px; gap: 6px; align-items: center; font-size: 10px; }
      #${ROOT_ID} .ecp-week-track { height: 6px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
      #${ROOT_ID} .ecp-week-fill  { height: 100%; border-radius: 99px; background: linear-gradient(90deg,#ff7f7f,#ffb04d 30%,#b8de22 58%,#49d67d 78%,#9f82ff 100%); }

      #${ROOT_ID} .ecp-equiv {
        background: rgba(39,113,255,.18);
        border: 1px solid rgba(83,152,255,.28);
        border-radius: 9px;
        padding: 7px 9px;
        margin-bottom: 7px;
      }
      #${ROOT_ID} .ecp-equiv ul { margin: 4px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: 10px; }
      #${ROOT_ID} .ecp-callout {
        background: linear-gradient(180deg,rgba(20,65,18,.72),rgba(20,48,18,.92));
        border: 1px solid rgba(98,226,123,.25);
        border-radius: 9px;
        padding: 7px 9px;
        font-size: 10px;
        color: #9bf0ab;
      }
      #${ROOT_ID} .ecp-callout-title { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: rgba(233,232,255,.55); margin-bottom: 4px; }

      /* Toast */
      .ecp-toast {
        position: fixed !important; bottom: 16px !important; right: 16px !important;
        z-index: 2147483647 !important; background: rgba(28,32,53,.95) !important;
        border: 1px solid rgba(159,130,255,.35) !important; color: #fff !important;
        padding: 7px 10px !important; border-radius: 8px !important;
        font-family: 'Google Sans', Inter, Arial, sans-serif !important; font-size: 11px !important;
        box-shadow: 0 6px 18px rgba(0,0,0,.25) !important;
      }
    `;
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const el = document.createElement('style');
      el.textContent = css;
      document.head.appendChild(el);
    }
  }

  /* ─── Detection ──────────────────────────────────────────── */
  let _lastDebugLog = 0;
  function debugLog(...args) {
    const now = Date.now();
    if (now - _lastDebugLog > 3000) { // log at most once per 3s
      console.log('[EcoPrompt]', ...args);
      _lastDebugLog = now;
    }
  }

  function btnLabel(btn) {
    return ((btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findGeminiBar() {
    // ── Strategy 1: Cancel + Create buttons share an ancestor that also has an input ──
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const cancelBtns = allBtns.filter(b => isVisible(b) && btnLabel(b).includes('cancel'));
    const createBtns = allBtns.filter(b => isVisible(b) && btnLabel(b).includes('create'));

    debugLog(`Buttons on page: ${allBtns.length}, cancel: ${cancelBtns.length}, create: ${createBtns.length}`);

    for (const cancelBtn of cancelBtns) {
      let node = cancelBtn.parentElement;
      for (let d = 0; d < 14 && node && node !== document.body; d++, node = node.parentElement) {
        // Does this ancestor also contain a Create button?
        const hasCreate = createBtns.some(b => node.contains(b));
        if (!hasCreate) continue;

        // Find a text input inside this ancestor
        const input = findEditableIn(node);
        if (input) {
          debugLog('Strategy 1 matched:', node.tagName, node.className.slice(0, 60));
          return { input, container: node };
        }
      }
    }

    // ── Strategy 2: Any small visible input near a Cancel button (by screen proximity) ──
    const allInputs = Array.from(document.querySelectorAll(
      'textarea, input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), [contenteditable], [role="textbox"]'
    )).filter(el => !el.closest('#' + ROOT_ID) && isVisible(el));

    debugLog(`Visible inputs: ${allInputs.length}`);

    for (const input of allInputs) {
      const ir = input.getBoundingClientRect();
      if (ir.height > 180 || ir.width < 60) continue;
      // Is any Cancel button within 120px vertically of this input?
      const nearCancel = cancelBtns.some(b => {
        const br = b.getBoundingClientRect();
        return Math.abs(br.top - ir.top) < 120 && Math.abs(br.left - ir.left) < 800;
      });
      if (nearCancel) {
        debugLog('Strategy 2 matched input at:', Math.round(ir.top), Math.round(ir.bottom));
        return { input, container: input.closest('form') || input.parentElement };
      }
    }

    // ── Strategy 3: Input at bottom of screen in a compose window ──
    for (const input of allInputs) {
      const ir = input.getBoundingClientRect();
      if (ir.height > 100 || ir.width < 100) continue;
      if (ir.bottom < window.innerHeight * 0.55) continue;
      // Must NOT be the main compose body (which is very tall and wide)
      const isComposeBody = ir.height > 60 && ir.width > window.innerWidth * 0.4;
      if (isComposeBody) continue;
      // Must be inside a compose-like dialog
      const inCompose = !!input.closest('[role="dialog"], .AD, .M9');
      if (!inCompose) continue;
      debugLog('Strategy 3 matched input at bottom of compose');
      return { input, container: input.closest('[role="dialog"], .AD, .M9') || input.parentElement };
    }

    return null;
  }

  function findEditableIn(node) {
    const sel = 'textarea, input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="search"]), [contenteditable], [role="textbox"]';
    const els = Array.from(node.querySelectorAll(sel)).filter(el => !el.closest('#' + ROOT_ID) && isVisible(el));
    return els[0] || null;
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function getInputValue(el) {
    if (!el) return '';
    if ('value' in el) return el.value || '';
    return el.innerText || el.textContent || '';
  }

  function setInputValue(el, value) {
    if ('value' in el) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.setSelectionRange(value.length, value.length); } catch (_) {}
    } else {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertText', bubbles: true }));
    }
  }

  /* ─── Trusted Types helper (Gmail enforces this) ─────────── */
  let _ttPolicy = null;
  function setHTML(el, html) {
    try {
      if (!_ttPolicy && typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
        _ttPolicy = trustedTypes.createPolicy('ecoprompt#html', { createHTML: s => s });
      }
      el.innerHTML = _ttPolicy ? _ttPolicy.createHTML(html) : html;
    } catch (e) {
      // fallback: build via DOMParser
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        el.replaceChildren(...Array.from(doc.body.childNodes));
      } catch (_) {
        el.textContent = '';
      }
    }
  }

  /* ─── Overlay mounting & positioning ─────────────────────── */
  function ensureRoot() {
    if (!state.root) {
      state.root = document.createElement('div');
      state.root.id = ROOT_ID;
    }
    if (!document.body.contains(state.root)) {
      document.body.appendChild(state.root);
    }
  }

  function removeRoot() {
    if (state.root && state.root.parentElement) {
      state.root.parentElement.removeChild(state.root);
    }
    if (state.root) setHTML(state.root, '');
  }

  function positionOverlay() {
    if (!state.root || !state.activeInput) return;
    const r = state.activeInput.getBoundingClientRect();
    if (!r || r.width === 0) return;

    const mode = state.store.mode;
    const GAP = 10;

    // Place above the input bar
    state.root.style.bottom = (window.innerHeight - r.top + GAP) + 'px';
    state.root.style.top    = 'auto';

    if (mode === 'mini') {
      const w = Math.min(380, Math.round(r.width * 0.85));
      state.root.style.right  = Math.max(8, window.innerWidth - r.right) + 'px';
      state.root.style.left   = 'auto';
      state.root.style.width  = w + 'px';
    } else {
      // For small/large use the compose window bounds
      const composeRoot = findComposeRoot(state.activeInput);
      const cr = composeRoot ? composeRoot.getBoundingClientRect() : r;
      state.root.style.left  = Math.max(8, cr.left + 8) + 'px';
      state.root.style.right = Math.max(8, window.innerWidth - cr.right + 8) + 'px';
      state.root.style.width = 'auto';
    }
  }

  function findComposeRoot(el) {
    if (!el) return null;
    const selectors = ['div[role="dialog"]', '.AD', '.M9', '.nH'];
    for (const sel of selectors) {
      const found = el.closest(sel);
      if (found) return found;
    }
    return null;
  }

  function extractComposeContext(composeRoot) {
    const root = composeRoot || document;
    const toSels = ['input[aria-label^="To"]', 'input[aria-label*="To "]', 'input[peoplekit-id]', 'span[email]', '[data-hovercard-id]'];
    const recipients = new Set();
    toSels.forEach(sel => root.querySelectorAll(sel).forEach(el => {
      const v = (el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.value || el.textContent || '').trim();
      if (v) recipients.add(v);
    }));
    const subjectEl = root.querySelector('input[name="subjectbox"], input[placeholder*="Subject"], input[aria-label*="Subject"]');
    return {
      to:      Array.from(recipients).join(', '),
      subject: subjectEl ? (subjectEl.value || '').trim() : ''
    };
  }

  /* ─── Analysis ───────────────────────────────────────────── */
  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }

  function detectType(text) {
    let best = 'general', bestN = 0;
    for (const [type, def] of Object.entries(TYPE_DEFS)) {
      if (type === 'general') continue;
      const n = def.keywords.filter(k => text.includes(normalize(k))).length;
      if (n > bestN) { bestN = n; best = type; }
    }
    return best;
  }

  function analyzePrompt(rawText, compose) {
    const text = normalize(rawText);
    const type = detectType(text);
    const checks = TYPE_DEFS[type].checks;
    const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;

    const items = checks.map(label => {
      const test = SIGNAL_TESTS[label];
      let detected = test ? test.test(text) : false;
      if (label === 'Recipient' && compose.to) detected = true;
      if (label === 'Goal' && type !== 'general') detected = true;
      return { label, hint: HINTS[label] || '', detected };
    });

    const missing = items.filter(i => !i.detected);

    let score = 5 + Math.min(12, Math.floor(wordCount / 2));
    if (compose.to)      score += 3;
    if (compose.subject) score += 2;
    items.forEach(i => { if (i.detected) score += 12; });
    if (missing.length === 0) score += 8;
    score = Math.max(0, Math.min(100, score));

    const label = score >= 90 ? 'excellent' : score >= 75 ? 'strong' : score >= 60 ? 'decent' : 'needs work';
    return { type, items, missing, score, scoreLabel: label, wordCount, insight: INSIGHTS[type] };
  }

  /* ─── Render ─────────────────────────────────────────────── */
  function render() {
    if (!state.root || !state.activeInput || state.dismissed) return;

    const rawText = getInputValue(state.activeInput).trim();
    const compose = extractComposeContext(findComposeRoot(state.activeInput));
    const analysis = analyzePrompt(rawText || 'write an email', compose);
    analysis.isEmpty = !rawText;
    if (analysis.isEmpty) {
      analysis.items.forEach(i => { i.detected = false; });
      analysis.missing = analysis.items;
    }

    state.root.dataset.mode = state.store.mode;
    setHTML(state.root, buildMarkup(analysis));
    positionOverlay();
  }

  function buildMarkup(a) {
    const mode = state.store.mode;
    if (mode === 'mini')  return buildMini(a);
    if (mode === 'small') return buildSmall(a);
    return buildLarge(a);
  }

  /* ── Mini ── */
  function buildMini(a) {
    return `
      <div class="ecp-wrap">
        <div class="ecp-advisor">
          ${head('mini')}
          <div class="ecp-cols">
            <div class="ecp-col-main">
              <div class="ecp-hint">Adding these details saves energy:</div>
              <div class="ecp-list">${a.items.slice(0, 4).map(checkItem).join('')}</div>
            </div>
            <div class="ecp-col-side">
              <div class="ecp-col-side-title">This saves:</div>
              <ul><li>${waterItem()}</li><li>${energyItem()}</li><li>${co2Item()}</li></ul>
            </div>
          </div>
          <div class="ecp-mini-actions">
            <button class="ecp-btn ecp-btn-primary" data-act="improve">Improve my prompt</button>
          </div>
        </div>
      </div>`;
  }

  /* ── Small ── */
  function buildSmall(a) {
    return `
      <div class="ecp-wrap">
        <div class="ecp-advisor">
          ${head('small')}
          <div class="ecp-body">
            ${qualityRow(a)}
            <div class="ecp-hint">Adding these details avoids follow-up prompts and saves energy:</div>
            <div class="ecp-list">${a.items.map(checkItem).join('')}</div>
          </div>
          <div class="ecp-divider"></div>
          <div class="ecp-foot">💡 Each avoided follow-up ≈ LED bulb on for 4 extra min</div>
          <div class="ecp-actions">
            <button class="ecp-btn ecp-btn-primary" data-act="improve">Improve my prompt</button>
            <button class="ecp-btn ecp-btn-secondary" data-act="dismiss">Dismiss</button>
          </div>
        </div>
        <div class="ecp-stats">${statsCard(a, false)}</div>
      </div>`;
  }

  /* ── Large ── */
  function buildLarge(a) {
    return `
      <div class="ecp-wrap">
        <div class="ecp-advisor">
          ${head('large')}
          <div class="ecp-body">
            ${qualityRow(a)}
            <div class="ecp-hint">Adding these details avoids follow-up prompts and saves energy:</div>
            <div class="ecp-list">${a.items.map(checkItem).join('')}</div>
          </div>
          <div class="ecp-divider"></div>
          <div class="ecp-foot">💡 Each avoided follow-up ≈ LED bulb on for 4 extra min</div>
          <div class="ecp-actions">
            <button class="ecp-btn ecp-btn-primary" data-act="improve">Improve my prompt</button>
            <button class="ecp-btn ecp-btn-secondary" data-act="dismiss">Dismiss</button>
          </div>
        </div>
        <div class="ecp-stats">${statsCard(a, true)}</div>
      </div>`;
  }

  function head(mode) {
    const shrink  = mode !== 'mini'  ? `<button class="ecp-icn" data-act="mode" data-mode="mini"  title="Mini">–</button>` : '';
    const medium  = mode !== 'small' ? `<button class="ecp-icn" data-act="mode" data-mode="small" title="Compact">▣</button>` : '';
    const expand  = mode !== 'large' ? `<button class="ecp-icn" data-act="mode" data-mode="large" title="Expanded">⬚</button>` : '';
    return `
      <div class="ecp-head">
        <div class="ecp-head-title">🌱 EcoPrompt — prompt efficiency tip</div>
        <div class="ecp-head-btns">${shrink}${medium}${expand}<button class="ecp-icn" data-act="dismiss" title="Hide">×</button></div>
      </div>`;
  }

  function qualityRow(a) {
    const score  = a.isEmpty ? 0    : a.score;
    const label  = a.isEmpty ? 'start typing' : a.scoreLabel;
    return `
      <div class="ecp-quality-row">
        <div class="ecp-qlabel">Prompt quality</div>
        <div class="ecp-qbar"><div class="ecp-qfill" style="width:${score}%"></div></div>
        <div class="ecp-qscore">${a.isEmpty ? '—' : score + '%'} — ${label}</div>
      </div>`;
  }

  function checkItem(item) {
    const cls = item.detected ? ' ok' : '';
    const hint = item.detected ? 'detected ✓' : item.hint;
    return `<div class="ecp-item${cls}"><div class="ecp-chk">✓</div><div class="ecp-iname">${esc(item.label)}<span>${esc(hint)}</span></div></div>`;
  }

  function statsCard(a, showWeek) {
    const s = state.store;
    const wh = (s.promptsAvoided * WH_PER_AVOIDED).toFixed(2);
    return `
      <div class="ecp-stats-head">
        <div class="ecp-stats-title">EcoPrompt — session stats</div>
        <div class="ecp-stats-sub">Today, ${formatDate()}</div>
      </div>
      <div class="ecp-stats-body">
        <div class="ecp-section">Today's Session</div>
        <div class="ecp-metrics">
          <div class="ecp-metric"><div class="ecp-metric-val">${s.promptsAvoided}</div><div class="ecp-metric-lbl">prompts avoided</div></div>
          <div class="ecp-metric"><div class="ecp-metric-val">${wh}</div><div class="ecp-metric-lbl">Wh saved</div></div>
        </div>
        ${showWeek ? weekBars() : ''}
        <div class="ecp-equiv">
          <div class="ecp-section">That's equivalent to</div>
          <ul>
            <li>${waterItem()}</li>
            <li>${energyItem()}</li>
            <li>${co2Item()}</li>
          </ul>
        </div>
        <div class="ecp-callout">
          <div class="ecp-callout-title">Email detected</div>
          ${esc(a.insight)}
        </div>
      </div>`;
  }

  function weekBars() {
    const days = [];
    const fmt = new Intl.DateTimeFormat('en', { weekday: 'short' });
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const h = state.store.history[key];
      days.push({ label: i === 0 ? 'Today' : fmt.format(d), avoided: h ? (h.avoided || 0) : 0 });
    }
    const maxAvoided = Math.max(1, ...days.map(d => d.avoided));
    return `
      <div class="ecp-section" style="margin-top:4px">Prompts avoided — last 6 days</div>
      <div class="ecp-week">
        ${days.map(r => `
          <div class="ecp-week-row">
            <div>${esc(r.label)}</div>
            <div class="ecp-week-track"><div class="ecp-week-fill" style="width:${Math.round(r.avoided / maxAvoided * 100)}%"></div></div>
            <div>${r.avoided}</div>
          </div>`).join('')}
      </div>`;
  }

  function waterItem() {
    const n = state.store.promptsAvoided;
    const ml = n * ML_PER_AVOIDED;
    const drops = Math.round(ml * 20); // ~20 drops per ml
    return `💧 ${drops} drop${drops !== 1 ? 's' : ''} of water (${ml.toFixed(2)} ml)`;
  }

  function energyItem() {
    const n = state.store.promptsAvoided;
    const wh = n * WH_PER_AVOIDED;
    // LED bulb at 10W
    const mins = (wh / 10) * 60;
    let timeStr;
    if (mins <= 0)      timeStr = '0 sec';
    else if (mins < 1)  timeStr = Math.round(mins * 60) + ' sec';
    else if (mins < 60) timeStr = Math.round(mins) + ' min';
    else { const h = Math.floor(mins / 60), m = Math.round(mins % 60); timeStr = m ? `${h} hr ${m} min` : `${h} hr`; }
    return `💡 LED bulb on for ${timeStr} (${wh.toFixed(2)} Wh)`;
  }

  function co2Item() {
    const n = state.store.promptsAvoided;
    const g = n * CO2G_PER_AVOIDED;
    // ~120 g CO₂/km driven → 0.12 g/m
    const cm = Math.round(g / 0.0012);
    let dist = cm < 100 ? cm + ' cm' : cm < 100000 ? Math.round(cm / 100) + ' m' : (cm / 100000).toFixed(1) + ' km';
    return `🌿 ${g.toFixed(2)} g CO₂e = ${dist} not driven`;
  }

  function formatDate() {
    try { return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date()); }
    catch (_) { return new Date().toLocaleDateString(); }
  }

  /* ─── Improve prompt ─────────────────────────────────────── */
  const SUFFIXES = {
    'Tone?':           'Use a formal and professional tone.',
    'Recipient':       'Make clear who the email is for.',
    'Goal':            'State clearly the outcome you want.',
    'When?':           'Include 2 possible time slots.',
    'Length?':         'Keep it concise in one short paragraph.',
    'Urgency?':        'Add when you need a reply.',
    'Context?':        'Mention the previous email or thread.',
    'Incident?':       'Briefly explain what happened.',
    'Resolution?':     'Explain the fix or resolution you are offering.',
    'Audience?':       'Specify who the announcement is for.',
    'Call to action?': 'Include the action you want recipients to take.'
  };

  function improvePrompt() {
    if (!state.activeInput) return;
    const raw = getInputValue(state.activeInput).trim();
    const compose = extractComposeContext(findComposeRoot(state.activeInput));
    const analysis = analyzePrompt(raw || 'write an email', compose);
    const additions = analysis.missing.slice(0, 4).map(i => SUFFIXES[i.label]).filter(Boolean);

    // Always count as an avoided follow-up prompt and record the session
    state.store.improvementsApplied++;
    state.store.promptsAvoided++;
    state.store.kWhSaved += WH_PER_AVOIDED / 1000;
    recordSession(analysis.score);
    saveStore();

    if (!additions.length) {
      render();
      showToast('Great prompt! Saved to your stats ✓');
      return;
    }
    const sep = /[.!?]$/.test(raw) ? ' ' : '. ';
    const improved = (raw || 'Write an email') + sep + additions.join(' ');
    setInputValue(state.activeInput, improved);
    render();
    showToast('Prompt improved ✓');
  }

  /* ─── Event handling ─────────────────────────────────────── */
  function onInput(e) {
    if (state.activeInput && e.target === state.activeInput) render();
  }

  function onClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest('[data-act]');
    if (!btn) return;
    const act  = btn.getAttribute('data-act');
    const mode = btn.getAttribute('data-mode');
    if (act === 'mode' && mode) {
      e.stopPropagation();
      state.store.mode = mode;
      saveStore();
      render();
    } else if (act === 'dismiss') {
      e.stopPropagation();
      state.dismissed = true;
      removeRoot();
    } else if (act === 'improve') {
      e.stopPropagation();
      improvePrompt();
    }
  }

  /* ─── Main scan loop ─────────────────────────────────────── */
  function scan() {
    const found = findGeminiBar();

    if (!found) {
      // Bar closed — clean up
      if (state.activeInput) {
        state.activeInput = null;
        state.dismissed = false;
        removeRoot();
      }
      return;
    }

    const { input, container } = found;

    // New bar opened
    if (input !== state.activeInput) {
      state.activeInput = input;
      state.activeComposeRoot = container;
      state.dismissed = false;
      ensureRoot();
      render();
      return;
    }

    // Same bar, keep overlay positioned
    if (!state.dismissed) {
      ensureRoot();
      positionOverlay();
    }
  }

  /* ─── Toast ──────────────────────────────────────────────── */
  function showToast(msg) {
    document.querySelectorAll('.ecp-toast').forEach(el => el.remove());
    const t = document.createElement('div');
    t.className = 'ecp-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  /* ─── History helpers ─────────────────────────────────────── */
  function recordSession(score) {
    const key = new Date().toISOString().slice(0, 10);
    const h = state.store.history[key] || { sessions: 0, totalScore: 0, avoided: 0 };
    h.sessions++;
    h.totalScore += score;
    h.avoided = (h.avoided || 0) + 1;
    state.store.history[key] = h;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ─── Init ───────────────────────────────────────────────── */
  function init() {
    injectStyles();

    document.addEventListener('input',  onInput,  true);
    document.addEventListener('click',  onClick,  true);
    window.addEventListener('resize',   () => positionOverlay());
    window.addEventListener('scroll',   () => positionOverlay(), true);

    // Scan for the Gemini bar every 500ms
    setInterval(scan, 500);
    scan(); // immediate first check

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('EcoPrompt: Reset stats', () => {
        state.store.promptsAvoided = 0;
        state.store.kWhSaved = 0;
        state.store.history = {};
        saveStore();
        render();
        showToast('Stats reset');
      });
    }
  }

  init();
})();
