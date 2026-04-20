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
  const KWH_PER_AVOIDED = 0.001;

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
        line-height: 1.4 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
      }
      #${ROOT_ID} * { box-sizing: border-box !important; font-family: inherit !important; }
      #${ROOT_ID} .ecp-wrap { pointer-events: auto; display: flex; gap: 12px; align-items: flex-end; }
      #${ROOT_ID}[data-mode="mini"] .ecp-wrap { display: block; }

      /* Advisor card */
      #${ROOT_ID} .ecp-advisor {
        background: #fdf4e0;
        border: 2px solid #f2a41a;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,.18);
        min-width: 280px;
      }
      #${ROOT_ID}[data-mode="large"] .ecp-advisor { flex: 1 1 60%; }
      #${ROOT_ID}[data-mode="small"] .ecp-advisor { flex: 1 1 55%; }

      #${ROOT_ID} .ecp-head {
        background: #f2a41a;
        color: #fff;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${ROOT_ID} .ecp-head-title { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px; }
      #${ROOT_ID} .ecp-head-btns { display: flex; gap: 5px; }
      #${ROOT_ID} .ecp-icn {
        width: 26px; height: 26px; border-radius: 7px; border: 1px solid rgba(255,255,255,.35);
        background: rgba(255,255,255,.15); color: #fff; font-size: 13px; cursor: pointer;
        display: grid; place-items: center; line-height: 1;
      }
      #${ROOT_ID} .ecp-icn:hover { background: rgba(255,255,255,.3); }

      #${ROOT_ID} .ecp-body { padding: 12px 14px 4px; }
      #${ROOT_ID} .ecp-quality-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      #${ROOT_ID} .ecp-qlabel { font-size: 13px; color: #666; min-width: 95px; }
      #${ROOT_ID} .ecp-qbar  { flex: 1; height: 10px; background: rgba(0,0,0,.1); border-radius: 99px; overflow: hidden; }
      #${ROOT_ID} .ecp-qfill { height: 100%; border-radius: 99px; background: linear-gradient(90deg,#ff6b57,#ffb627 40%,#49d67d 72%,#7f8cff 100%); }
      #${ROOT_ID} .ecp-qscore { font-size: 13px; font-weight: 700; color: #e06000; white-space: nowrap; }

      #${ROOT_ID} .ecp-hint  { font-size: 12px; color: #555; margin-bottom: 8px; }
      #${ROOT_ID} .ecp-list  { display: grid; gap: 7px; margin-bottom: 8px; }
      #${ROOT_ID} .ecp-item  { display: flex; align-items: center; gap: 8px; }
      #${ROOT_ID} .ecp-chk   {
        width: 20px; height: 20px; border-radius: 5px; border: 2px solid rgba(0,0,0,.2);
        background: rgba(255,255,255,.6); display: grid; place-items: center; font-size: 12px;
        color: transparent; flex-shrink: 0;
      }
      #${ROOT_ID} .ecp-item.ok .ecp-chk { background: rgba(73,214,125,.2); border-color: #3bbf63; color: #2e8d4d; }
      #${ROOT_ID} .ecp-iname { font-weight: 600; font-size: 13px; color: #333; }
      #${ROOT_ID} .ecp-iname span { font-weight: 400; color: #888; margin-left: 5px; }
      #${ROOT_ID} .ecp-item.ok .ecp-iname span { color: #5d8f62; }

      #${ROOT_ID} .ecp-divider { border-top: 1px solid rgba(0,0,0,.08); margin: 4px -14px; }
      #${ROOT_ID} .ecp-foot { padding: 6px 14px 4px; font-size: 12px; color: #4b8b49; }
      #${ROOT_ID} .ecp-actions { display: flex; gap: 8px; padding: 8px 14px 12px; }
      #${ROOT_ID} .ecp-btn {
        border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px;
        font-weight: 600; cursor: pointer;
      }
      #${ROOT_ID} .ecp-btn-primary { background: #1a73e8; color: #fff; }
      #${ROOT_ID} .ecp-btn-primary:hover { background: #1558b0; }
      #${ROOT_ID} .ecp-btn-secondary { background: rgba(0,0,0,.08); color: #444; }
      #${ROOT_ID} .ecp-btn-secondary:hover { background: rgba(0,0,0,.14); }

      /* Mini two-column layout */
      #${ROOT_ID}[data-mode="mini"] .ecp-cols { display: grid; grid-template-columns: 1.4fr 1fr; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-main { padding: 10px 12px 6px; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side {
        padding: 10px 12px 6px;
        border-left: 1px solid rgba(0,0,0,.1);
        background: rgba(255,255,255,.2);
      }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side-title { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
      #${ROOT_ID}[data-mode="mini"] .ecp-col-side ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: 12px; color: #333; }
      #${ROOT_ID}[data-mode="mini"] .ecp-mini-actions { padding: 0 12px 10px; }

      /* Stats card */
      #${ROOT_ID} .ecp-stats {
        background: linear-gradient(180deg,#252442,#17162a);
        border: 1px solid rgba(159,130,255,.28);
        border-radius: 16px;
        color: #e9e8ff;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,.22);
        min-width: 260px;
      }
      #${ROOT_ID}[data-mode="large"] .ecp-stats { flex: 0 0 400px; }
      #${ROOT_ID}[data-mode="small"] .ecp-stats { flex: 0 0 300px; }

      #${ROOT_ID} .ecp-stats-head { padding: 14px 16px 8px; border-bottom: 1px solid rgba(255,255,255,.07); }
      #${ROOT_ID} .ecp-stats-title { font-weight: 700; font-size: 14px; }
      #${ROOT_ID} .ecp-stats-sub   { font-size: 12px; opacity: .65; margin-top: 3px; }
      #${ROOT_ID} .ecp-stats-body  { padding: 12px 16px 16px; }

      #${ROOT_ID} .ecp-section { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: rgba(233,232,255,.55); margin-bottom: 8px; }
      #${ROOT_ID} .ecp-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
      #${ROOT_ID} .ecp-metric { background: rgba(255,255,255,.06); border-radius: 10px; padding: 10px; text-align: center; }
      #${ROOT_ID} .ecp-metric-val { font-size: 22px; font-weight: 800; color: #58f394; }
      #${ROOT_ID} .ecp-metric-lbl { font-size: 12px; color: rgba(233,232,255,.65); margin-top: 2px; }

      #${ROOT_ID} .ecp-week { display: grid; gap: 6px; margin-bottom: 12px; }
      #${ROOT_ID} .ecp-week-row { display: grid; grid-template-columns: 32px 1fr 38px; gap: 8px; align-items: center; font-size: 13px; }
      #${ROOT_ID} .ecp-week-track { height: 8px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
      #${ROOT_ID} .ecp-week-fill  { height: 100%; border-radius: 99px; background: linear-gradient(90deg,#ff7f7f,#ffb04d 30%,#b8de22 58%,#49d67d 78%,#9f82ff 100%); }

      #${ROOT_ID} .ecp-equiv {
        background: rgba(39,113,255,.18);
        border: 1px solid rgba(83,152,255,.28);
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 10px;
      }
      #${ROOT_ID} .ecp-equiv ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: 13px; }
      #${ROOT_ID} .ecp-callout {
        background: linear-gradient(180deg,rgba(20,65,18,.72),rgba(20,48,18,.92));
        border: 1px solid rgba(98,226,123,.25);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 13px;
        color: #9bf0ab;
      }
      #${ROOT_ID} .ecp-callout-title { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: rgba(233,232,255,.55); margin-bottom: 5px; }

      /* Toast */
      .ecp-toast {
        position: fixed !important; bottom: 20px !important; right: 20px !important;
        z-index: 2147483647 !important; background: rgba(28,32,53,.95) !important;
        border: 1px solid rgba(159,130,255,.35) !important; color: #fff !important;
        padding: 10px 14px !important; border-radius: 10px !important;
        font-family: 'Google Sans', Inter, Arial, sans-serif !important; font-size: 13px !important;
        box-shadow: 0 8px 24px rgba(0,0,0,.25) !important;
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
  function findGeminiBar() {
    // Find every "Cancel" button on the page
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));

    for (const cancelBtn of allBtns) {
      const cancelText = (cancelBtn.textContent || cancelBtn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (cancelText !== 'cancel') continue;
      if (!isVisible(cancelBtn)) continue;

      // Walk up and find a node that ALSO contains a "Create" button AND a text input
      let node = cancelBtn.parentElement;
      for (let d = 0; d < 12 && node && node !== document.body; d++, node = node.parentElement) {
        // Check for "Create" button inside this node
        const btns = Array.from(node.querySelectorAll('button, [role="button"]'));
        const hasCreate = btns.some(b => (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase() === 'create');
        if (!hasCreate) continue;

        // Check for a text input inside this node
        const inputSel = [
          'textarea',
          'input[type="text"]',
          'input:not([type])',
          '[contenteditable="true"]',
          '[role="textbox"]'
        ].join(',');
        const inputs = Array.from(node.querySelectorAll(inputSel))
          .filter(el => !el.closest('#' + ROOT_ID) && isVisible(el));

        if (inputs.length > 0) {
          const input = inputs[0];
          return { input, container: node };
        }
        // Has Cancel+Create but no input yet at this level — keep going up
      }
    }
    return null;
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
    if (state.root) state.root.innerHTML = '';
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

    state.root.dataset.mode = state.store.mode;
    state.root.innerHTML = buildMarkup(analysis);
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
              <ul>${waterItems().concat(energyItems()).slice(0, 3).map(i => `<li>${i}</li>`).join('')}</ul>
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
    return `
      <div class="ecp-quality-row">
        <div class="ecp-qlabel">Prompt quality</div>
        <div class="ecp-qbar"><div class="ecp-qfill" style="width:${a.score}%"></div></div>
        <div class="ecp-qscore">${a.score}% — ${a.scoreLabel}</div>
      </div>`;
  }

  function checkItem(item) {
    const cls = item.detected ? ' ok' : '';
    const hint = item.detected ? 'detected ✓' : item.hint;
    return `<div class="ecp-item${cls}"><div class="ecp-chk">✓</div><div class="ecp-iname">${esc(item.label)}<span>${esc(hint)}</span></div></div>`;
  }

  function statsCard(a, showWeek) {
    const s = state.store;
    const kwh = Math.round(s.promptsAvoided * KWH_PER_AVOIDED * 1000) / 1000;
    return `
      <div class="ecp-stats-head">
        <div class="ecp-stats-title">EcoPrompt — session stats</div>
        <div class="ecp-stats-sub">Today, ${formatDate()}</div>
      </div>
      <div class="ecp-stats-body">
        <div class="ecp-section">Today's Session</div>
        <div class="ecp-metrics">
          <div class="ecp-metric"><div class="ecp-metric-val">${s.promptsAvoided}</div><div class="ecp-metric-lbl">prompts avoided</div></div>
          <div class="ecp-metric"><div class="ecp-metric-val">${kwh.toFixed(3)}</div><div class="ecp-metric-lbl">kWh saved</div></div>
        </div>
        ${showWeek ? weekBars() : ''}
        <div class="ecp-equiv">
          <div class="ecp-section">That's equivalent to</div>
          <ul>${waterItems().map(i => `<li>${i}</li>`).join('')}</ul>
        </div>
        <div class="ecp-equiv" style="margin-top:8px">
          <div class="ecp-section">That's equivalent to</div>
          <ul>${energyItems().map(i => `<li>${i}</li>`).join('')}</ul>
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
      const v = h && h.sessions ? Math.min(100, Math.round(h.totalScore / h.sessions)) : 0;
      days.push({ label: i === 0 ? 'Now' : fmt.format(d), v });
    }
    return `
      <div class="ecp-section" style="margin-top:4px">Prompt efficiency — this week</div>
      <div class="ecp-week">
        ${days.map(r => `
          <div class="ecp-week-row">
            <div>${esc(r.label)}</div>
            <div class="ecp-week-track"><div class="ecp-week-fill" style="width:${r.v}%"></div></div>
            <div>${r.v}%</div>
          </div>`).join('')}
      </div>`;
  }

  function waterItems() {
    const kwh = state.store.promptsAvoided * KWH_PER_AVOIDED;
    const ml  = Math.round(kwh * 3600000 / (4186 * 50));
    const tap = Math.max(1, Math.round(kwh * 360000 / 4186));
    return [
      `🥛 ${ml >= 100 ? 'A half full glass of water' : ml + ' ml of heated water'}`,
      `🚿 Leaving the tap running ${tap < 60 ? tap + ' sec' : Math.round(tap / 60) + ' min'}`
    ];
  }

  function energyItems() {
    const kwh = state.store.promptsAvoided * KWH_PER_AVOIDED;
    return [
      `💡 Lightbulb on for ${dur(kwh, 10)}`,
      `📺 TV running for ~${dur(kwh, 100)}`,
      `🔥 Microwave for ~${dur(kwh, 1000)}`
    ];
  }

  function dur(kwh, watts) {
    if (!kwh || kwh <= 0) return '0 sec';
    const mins = (kwh / (watts / 1000)) * 60;
    if (mins < 1)  return Math.max(1, Math.round(mins * 60)) + ' sec';
    if (mins < 60) return Math.round(mins) + ' min';
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m ? `${h} hr ${m} min` : `${h} hr`;
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
    if (!additions.length) { showToast('Your prompt already looks great!'); return; }
    const sep = /[.!?]$/.test(raw) ? ' ' : '. ';
    const improved = (raw || 'Write an email') + sep + additions.join(' ');
    setInputValue(state.activeInput, improved);
    state.store.improvementsApplied++;
    saveStore();
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
    const h = state.store.history[key] || { sessions: 0, totalScore: 0 };
    h.sessions++;
    h.totalScore += score;
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
