// ==UserScript==
// @name         EcoPrompt for Gmail
// @namespace    https://ecoprompt.local
// @version      1.0.1
// @description  Energy-aware prompt coaching for Gemini inside Gmail
// @author       OpenAI
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ecoprompt_state_v1';
  const ROOT_ID = 'ecoprompt-root';
  const STYLE_ID = 'ecoprompt-style';
  const HOST_CLASS = 'ecoprompt-host';
  const ENERGY_PER_AVOIDED_PROMPT_KWH = 0.001;
  const LIGHTBULB_WATTS = 10;
  const LAPTOP_WATTS = 60;
  const TV_WATTS = 100;
  const MICROWAVE_WATTS = 1000;

  const TYPE_DEFS = {
    meeting: {
      keywords: ['meeting', 'schedule', 'call', 'appointment', 'sync', 'catch up', 'meet', 'calendar'],
      items: ['tone', 'recipient', 'goal', 'when', 'length'],
      insightKey: 'meetingInsight'
    },
    followup: {
      keywords: ['follow up', 'following up', "haven't heard", 'waiting', 'reminder', 'check in', 'update', 'status'],
      items: ['tone', 'context', 'urgency', 'goal', 'length'],
      insightKey: 'followupInsight'
    },
    apology: {
      keywords: ['sorry', 'apologise', 'apologize', 'my fault', 'mistake', 'error', 'issue'],
      items: ['tone', 'incident', 'resolution', 'goal', 'length'],
      insightKey: 'apologyInsight'
    },
    announcement: {
      keywords: ['announce', 'announcement', 'share', 'inform', 'launch', 'rollout', 'introduce'],
      items: ['audience', 'tone', 'goal', 'cta', 'length'],
      insightKey: 'announcementInsight'
    },
    general: {
      keywords: [],
      items: ['tone', 'recipient', 'goal', 'length', 'context'],
      insightKey: 'generalInsight'
    }
  };

  const STRINGS = {
    brand: 'EcoPrompt',
    tipTitle: 'prompt efficiency tip',
    sessionStats: 'session stats',
    promptQuality: 'Prompt quality',
    needsWork: 'needs work',
    decent: 'decent',
    strong: 'strong',
    excellent: 'excellent',
    addingDetails: 'Adding these details avoids follow-up prompts and saves energy:',
    thisSaves: 'This saves:',
    promptsAvoided: 'prompts avoided',
    kWhSaved: 'kWh saved',
    improve: 'Improve my prompt',
    dismiss: 'Dismiss',
    tone: 'Tone?',
    toneHint: 'formal / friendly / urgent',
    recipient: 'Recipient',
    recipientHint: 'who is this for?',
    goal: 'Goal',
    goalHint: 'what outcome do you want?',
    when: 'When?',
    whenHint: 'preferred date / time slot',
    length: 'Length?',
    lengthHint: 'short / medium / detailed',
    urgency: 'Urgency?',
    urgencyHint: 'ASAP / deadline / optional',
    context: 'Context?',
    contextHint: 'previous email / background',
    incident: 'Incident?',
    incidentHint: 'what happened exactly?',
    resolution: 'Resolution?',
    resolutionHint: 'how will you fix it?',
    audience: 'Audience?',
    audienceHint: 'team / clients / everyone',
    cta: 'Call to action?',
    ctaHint: 'reply / confirm / register',
    detected: 'detected',
    eachAvoided: 'Each avoided follow-up ≈ LED bulb on for {{minutes}} extra min',
    thisWeek: 'Prompt efficiency — this week',
    today: 'Today',
    type_meeting: 'Meeting request',
    type_followup: 'Follow-up',
    type_apology: 'Apology',
    type_announcement: 'Announcement',
    type_general: 'General email',
    emailDetected: 'EMAIL DETECTED',
    setMini: 'Switch to mini mode',
    setSmall: 'Switch to compact mode',
    setLarge: 'Switch to expanded mode',
    hide: 'Hide',
    improvedToast: 'Prompt improved',
    resetStats: 'Reset EcoPrompt stats',
    toggleMode: 'Cycle EcoPrompt mode',
    statsResetDone: 'EcoPrompt stats reset',
    meetingInsight: 'Specifying tone + a time slot in meeting request emails usually reduces follow-ups.',
    followupInsight: 'Adding the original thread context + deadline often avoids another clarification round.',
    apologyInsight: 'A clear incident + solution usually makes the first draft usable in one go.',
    announcementInsight: 'Naming the audience + call to action usually reduces edits and re-prompts.',
    generalInsight: 'Adding tone, recipient and desired length often avoids follow-up prompts.',
    equivalentTitle: 'That is equivalent to',
    equivalentLightbulb: 'LED bulb on for {{time}}',
    equivalentLaptop: 'Laptop charging for {{time}}',
    equivalentTv: 'TV on for {{time}}',
    equivalentMicrowave: 'Microwave running for {{time}}',
    qualityBadge: '{{score}}% — {{label}}',
    todaysSession: 'Today, {{date}}',
    energyEstimateNote: 'Estimated savings based on avoided follow-up prompts.',
    promptImprovedSuffixMeetingTone: 'Use a formal and professional tone.',
    promptImprovedSuffixMeetingWhen: 'Include 2 possible time slots for next week.',
    promptImprovedSuffixMeetingLength: 'Keep it concise in one short paragraph.',
    promptImprovedSuffixMeetingRecipient: 'Make clear who the email is for.',
    promptImprovedSuffixMeetingGoal: 'State clearly that you are requesting a meeting about the project update.',
    promptImprovedSuffixFollowupTone: 'Keep the tone polite and professional.',
    promptImprovedSuffixFollowupContext: 'Mention the previous email or thread you are following up on.',
    promptImprovedSuffixFollowupUrgency: 'Add when you need a reply or update.',
    promptImprovedSuffixFollowupLength: 'Keep it short and direct.',
    promptImprovedSuffixFollowupGoal: 'State the exact update or action you need.',
    promptImprovedSuffixApologyTone: 'Use an empathetic and accountable tone.',
    promptImprovedSuffixApologyIncident: 'Briefly explain what happened.',
    promptImprovedSuffixApologyResolution: 'Explain the fix or resolution you are offering.',
    promptImprovedSuffixApologyLength: 'Keep it sincere and concise.',
    promptImprovedSuffixApologyGoal: 'State the next step you want to agree on.',
    promptImprovedSuffixAnnouncementAudience: 'Specify who the announcement is for.',
    promptImprovedSuffixAnnouncementTone: 'Keep the tone clear and professional.',
    promptImprovedSuffixAnnouncementGoal: 'State the key message you want to communicate.',
    promptImprovedSuffixAnnouncementCta: 'Include the action you want recipients to take.',
    promptImprovedSuffixAnnouncementLength: 'Keep it easy to scan.',
    promptImprovedSuffixGeneralTone: 'Use the right tone for the recipient.',
    promptImprovedSuffixGeneralRecipient: 'Specify who should receive the email.',
    promptImprovedSuffixGeneralGoal: 'State the exact outcome you want.',
    promptImprovedSuffixGeneralLength: 'Mention whether the email should be short or detailed.',
    promptImprovedSuffixGeneralContext: 'Add any background context Gemini should include.',
    toastSaved: '+{{count}} avoided follow-up prompt(s) estimated'
  };

  const state = {
    lang: pickLanguage(),
    store: normalizeStore(loadStore()),
    activeInput: null,
    activeContext: null,
    activeComposeRoot: null,
    currentAnalysis: null,
    root: null,
    promptSession: null,
    hiddenInput: null,
    activeInputId: null,
    scanTimer: null
  };

  function pickLanguage() {
    return 'en';
  }

  function t(key, vars) {
    let value = STRINGS[key] || key;
    if (vars) {
      Object.entries(vars).forEach(([name, replacement]) => {
        value = value.replace(new RegExp(`{{${name}}}`, 'g'), String(replacement));
      });
    }
    return value;
  }

  function normalizeStore(raw) {
    const store = raw && typeof raw === 'object' ? raw : {};
    const settings = store.settings && typeof store.settings === 'object' ? store.settings : {};
    const stats = store.stats && typeof store.stats === 'object' ? store.stats : {};
    return {
      settings: {
        mode: ['mini', 'small', 'large'].includes(settings.mode) ? settings.mode : 'mini'
      },
      stats: {
        promptsAvoided: numberOrZero(stats.promptsAvoided),
        totalSessions: numberOrZero(stats.totalSessions),
        kWhSaved: numberOrZero(stats.kWhSaved),
        improvementsApplied: numberOrZero(stats.improvementsApplied),
        history: stats.history && typeof stats.history === 'object' ? stats.history : {}
      }
    };
  }

  function numberOrZero(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function loadStore() {
    try {
      if (typeof GM_getValue === 'function') {
        return JSON.parse(GM_getValue(STORAGE_KEY, '{}'));
      }
    } catch (_) {}
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveStore() {
    const payload = JSON.stringify(state.store);
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEY, payload);
      } else {
        localStorage.setItem(STORAGE_KEY, payload);
      }
    } catch (error) {
      console.warn('[EcoPrompt] Could not save state', error);
    }
  }

  function setMode(mode) {
    if (!['mini', 'small', 'large'].includes(mode)) return;
    state.store.settings.mode = mode;
    saveStore();
    render();
  }

  function cycleMode() {
    const order = ['mini', 'small', 'large'];
    const current = state.store.settings.mode;
    const next = order[(order.indexOf(current) + 1) % order.length];
    setMode(next);
  }

  function resetStats() {
    state.store.stats = {
      promptsAvoided: 0,
      totalSessions: 0,
      kWhSaved: 0,
      improvementsApplied: 0,
      history: {}
    };
    saveStore();
    render();
    showToast(t('statsResetDone'));
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand(t('toggleMode'), cycleMode);
      GM_registerMenuCommand(t('resetStats'), resetStats);
    } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${ROOT_ID} {
        --ecp-brand: #f2a41a;
        --ecp-advisor-bg: #f4f0dd;
        --ecp-primary: #1a73e8;
        --ecp-dark-bg: linear-gradient(180deg, #252442 0%, #17162a 100%);
        position: absolute;
        z-index: 2147483000;
        pointer-events: none;
        font-family: Inter, Arial, Helvetica, sans-serif;
        line-height: 1.25;
      }
      .${HOST_CLASS} { position: relative !important; overflow: visible !important; }
      #${ROOT_ID}[data-mode="mini"] { right: 18px; bottom: 58px; width: min(360px, calc(100% - 36px)); left: auto; }
      #${ROOT_ID}[data-mode="small"] { left: 18px; right: 18px; bottom: 62px; }
      #${ROOT_ID}[data-mode="large"] { left: 18px; right: 18px; bottom: 68px; }
      #${ROOT_ID} * { box-sizing: border-box; }
      .ecp-layout, .ecp-card, .ecp-button, .ecp-icon-button { pointer-events: auto; }
      .ecp-layout { display: flex; gap: 14px; align-items: stretch; }
      #${ROOT_ID}[data-mode="mini"] .ecp-layout { display: block; }
      #${ROOT_ID}[data-mode="small"] .ecp-layout { justify-content: flex-end; }
      .ecp-card { border-radius: 18px; box-shadow: 0 14px 35px rgba(0, 0, 0, 0.18); overflow: hidden; backdrop-filter: blur(4px); }
      .ecp-card--advisor { background: var(--ecp-advisor-bg); border: 2px solid var(--ecp-brand); color: #3d3d3d; }
      .ecp-card--stats { background: var(--ecp-dark-bg); border: 1px solid rgba(159, 130, 255, 0.28); color: #e9e8ff; }
      .ecp-advisor-header { background: var(--ecp-brand); color: white; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .ecp-advisor-title, .ecp-stats-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
      .ecp-subtitle { opacity: 0.92; font-size: 13px; }
      .ecp-controls { display: flex; gap: 6px; flex-wrap: wrap; }
      .ecp-icon-button { border: 1px solid rgba(255,255,255,0.24); color: white; background: rgba(255,255,255,0.12); border-radius: 8px; width: 28px; height: 28px; display: grid; place-items: center; cursor: pointer; font-size: 13px; }
      .ecp-advisor-body { padding: 14px 16px 14px; }
      .ecp-quality-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
      .ecp-quality-label { min-width: 110px; color: #6e6e6e; font-size: 14px; }
      .ecp-quality-bar { position: relative; flex: 1 1 220px; height: 12px; background: rgba(0,0,0,0.10); border-radius: 999px; overflow: hidden; }
      .ecp-quality-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, #ff6b57 0%, #ffb627 40%, #49d67d 75%, #7f8cff 100%); }
      .ecp-quality-score { font-size: 14px; font-weight: 700; color: #f36d00; }
      .ecp-helper { color: #606060; font-size: 13px; margin-bottom: 10px; }
      .ecp-list { display: grid; gap: 8px; }
      .ecp-item { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; }
      .ecp-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(0,0,0,0.22); display: grid; place-items: center; font-weight: 700; font-size: 14px; color: transparent; background: rgba(255,255,255,0.6); }
      .ecp-item--detected .ecp-check { background: rgba(73,214,125,0.18); border-color: #3bbf63; color: #2e8d4d; }
      .ecp-item-title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 700; font-size: 15px; }
      .ecp-item-title span:last-child { color: #8a8a8a; font-weight: 500; font-size: 14px; }
      .ecp-item--detected .ecp-item-title span:last-child { color: #5d8f62; }
      .ecp-divider { border-top: 1px solid rgba(0,0,0,0.08); margin: 12px -16px 0; }
      .ecp-footer-note { padding: 10px 16px 0; color: #4b8b49; font-size: 13px; }
      .ecp-actions { display: flex; gap: 10px; padding: 12px 16px 16px; }
      .ecp-button { border: none; border-radius: 9px; padding: 10px 14px; font-size: 14px; cursor: pointer; }
      .ecp-button--primary { background: var(--ecp-primary); color: white; }
      .ecp-button--secondary { background: rgba(0,0,0,0.08); color: #555; }
      .ecp-stats { min-width: 300px; width: 100%; }
      .ecp-stats-header { padding: 18px 20px 8px; border-bottom: 1px solid rgba(255,255,255,0.07); }
      .ecp-stats-header .ecp-subtitle { color: rgba(233,232,255,0.68); display: block; margin-top: 6px; }
      .ecp-stats-body { padding: 14px 20px 20px; }
      .ecp-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
      .ecp-metric { border-radius: 12px; background: rgba(255,255,255,0.06); padding: 14px 14px 10px; text-align: center; }
      .ecp-metric-value { font-size: 22px; font-weight: 800; color: #58f394; margin-bottom: 4px; }
      .ecp-metric-label { font-size: 13px; color: rgba(233,232,255,0.72); }
      .ecp-week-title { font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; color: rgba(233,232,255,0.58); margin: 6px 0 8px; }
      .ecp-week-bars { display: grid; gap: 8px; margin-bottom: 16px; }
      .ecp-week-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 44px; gap: 10px; align-items: center; color: rgba(233,232,255,0.88); font-size: 14px; }
      .ecp-week-track { position: relative; height: 9px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
      .ecp-week-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, #ff7f7f 0%, #ffb04d 30%, #b8de22 58%, #49d67d 78%, #9f82ff 100%); }
      .ecp-equivalents, .ecp-callout { border-radius: 14px; padding: 12px 16px; margin-top: 12px; }
      .ecp-equivalents { background: rgba(39,113,255,0.18); border: 1px solid rgba(83,152,255,0.28); }
      .ecp-callout { background: linear-gradient(180deg, rgba(20,65,18,0.72), rgba(20,48,18,0.92)); border: 1px solid rgba(98,226,123,0.25); }
      .ecp-callout.ecp-callout--insight { background: linear-gradient(180deg, rgba(82,55,8,0.55), rgba(48,31,10,0.95)); border-color: rgba(255,182,39,0.25); }
      .ecp-section-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; color: rgba(233,232,255,0.62); margin-bottom: 8px; }
      .ecp-equivalents ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
      .ecp-mini-columns { display: grid; grid-template-columns: 1.45fr 1fr; }
      .ecp-mini-main, .ecp-mini-side { padding: 12px 14px 14px; }
      .ecp-mini-side { border-left: 1px solid rgba(0,0,0,0.12); background: rgba(255,255,255,0.15); }
      .ecp-mini-side ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; color: #2a2a2a; }
      .ecp-mini-actions { padding: 0 14px 14px; }
      .ecp-card--small-advisor { flex: 1 1 58%; max-width: 720px; }
      .ecp-card--small-stats { flex: 0 0 34%; min-width: 270px; max-width: 430px; }
      .ecp-card--large-advisor { flex: 1 1 62%; min-width: 420px; }
      .ecp-card--large-stats { flex: 0 0 430px; max-width: 430px; }
      .ecp-toast { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; background: rgba(28,32,53,0.95); border: 1px solid rgba(159,130,255,0.35); color: white; padding: 10px 14px; border-radius: 12px; box-shadow: 0 14px 35px rgba(0,0,0,0.2); font-family: Inter, Arial, sans-serif; }
      @media (max-width: 1240px) { #${ROOT_ID}[data-mode="large"] .ecp-layout { flex-direction: column; } .ecp-card--large-stats { max-width: none; width: 100%; flex-basis: auto; } }
      @media (max-width: 1024px) { #${ROOT_ID}[data-mode="small"] .ecp-layout { flex-direction: column; align-items: stretch; } .ecp-card--small-stats, .ecp-card--small-advisor, .ecp-card--large-advisor { max-width: none; min-width: 0; width: 100%; flex-basis: auto; } }
      @media (max-width: 640px) { #${ROOT_ID}[data-mode="mini"] { width: calc(100% - 24px); right: 12px; bottom: 12px; } .ecp-mini-columns, .ecp-metric-grid { grid-template-columns: 1fr; } .ecp-actions { flex-wrap: wrap; } }
    `;
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function init() {
    injectStyles();
    registerMenuCommands();
    document.addEventListener('click', handleGlobalClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('focusin', scanForPrompt, true);
    window.addEventListener('resize', render);
    observeDom();
    scanForPrompt();
    state.scanTimer = window.setInterval(scanForPrompt, 1400);
  }

  function observeDom() {
    const observer = new MutationObserver(() => {
      if (state.activeInput && !document.contains(state.activeInput)) {
        finalizePromptSession(false);
        clearActive();
      }
      scanForPrompt();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function handleInput(event) {
    const target = event.target;
    if (target === state.activeInput) {
      ensureSession();
      render();
      return;
    }
    if (isPotentialPromptInput(target)) {
      scanForPrompt();
    }
  }

  function handleGlobalClick(event) {
    const root = state.root;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionTarget = target.closest('[data-ecp-action]');
    if (actionTarget && root && root.contains(actionTarget)) {
      const action = actionTarget.getAttribute('data-ecp-action');
      if (action === 'improve') {
        event.preventDefault();
        event.stopPropagation();
        improvePrompt();
      } else if (action === 'dismiss') {
        event.preventDefault();
        event.stopPropagation();
        dismissOverlay();
      } else if (action === 'mode') {
        event.preventDefault();
        event.stopPropagation();
        const nextMode = actionTarget.getAttribute('data-mode');
        setMode(nextMode);
      }
      return;
    }

    if (!state.activeContext || !state.activeContext.contains(target)) return;
    const label = normalizeText(target.textContent || '');
    if (/(^|\s)(create|generate|insert|crear|generar|insertar)(\s|$)/.test(label)) {
      finalizePromptSession(true);
    }
    if (/(^|\s)(cancel|close|cancelar|cerrar)(\s|$)/.test(label)) {
      finalizePromptSession(false);
      clearActive();
    }
  }

  function dismissOverlay() {
    state.hiddenInput = state.activeInput;
    unmountOverlay();
  }

  function clearActive() {
    state.activeInput = null;
    state.activeContext = null;
    state.activeComposeRoot = null;
    state.currentAnalysis = null;
    state.activeInputId = null;
    state.promptSession = null;
    unmountOverlay();
  }

  function ensureSession() {
    if (!state.activeInput) return;
    if (state.promptSession && state.promptSession.inputId === state.activeInputId) return;
    state.promptSession = { inputId: state.activeInputId, startedAt: Date.now(), baselineScore: null, baselineMissingCount: null, lastScore: 0, lastMissingCount: 0, usedImproveButton: false, finalized: false };
  }

  function finalizePromptSession(shouldCount) {
    if (!state.promptSession || state.promptSession.finalized) return;
    state.promptSession.finalized = true;
    if (!shouldCount || !state.currentAnalysis || state.promptSession.baselineScore == null) return;
    const delta = state.currentAnalysis.score - state.promptSession.baselineScore;
    const missingResolved = Math.max(0, (state.promptSession.baselineMissingCount || 0) - state.currentAnalysis.missingItems.length);
    let avoided = 0;
    if (delta >= 14) avoided += 1;
    if (delta >= 32) avoided += 1;
    if (delta >= 52 || missingResolved >= 3) avoided += 1;
    if (state.promptSession.usedImproveButton && avoided === 0 && state.currentAnalysis.score >= 68) avoided = 1;
    avoided = Math.max(0, Math.min(3, avoided));
    state.store.stats.totalSessions += 1;
    if (avoided > 0) {
      state.store.stats.promptsAvoided += avoided;
      state.store.stats.kWhSaved = round3(state.store.stats.promptsAvoided * ENERGY_PER_AVOIDED_PROMPT_KWH);
      showToast(t('toastSaved', { count: avoided }));
    }
    recordHistory(avoided, state.currentAnalysis.score);
    saveStore();
    render();
  }

  function recordHistory(promptsAvoided, score) {
    const day = todayKey();
    const history = state.store.stats.history;
    const current = history[day] || { sessions: 0, promptsAvoided: 0, totalScore: 0 };
    current.sessions += 1;
    current.promptsAvoided += promptsAvoided;
    current.totalScore += score;
    history[day] = current;
  }

  function todayKey(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function scanForPrompt() {
    const candidate = detectActivePrompt();
    if (!candidate) {
      if (state.activeInput && !document.contains(state.activeInput)) {
        finalizePromptSession(false);
        clearActive();
      }
      return;
    }
    if (candidate.input !== state.activeInput) {
      finalizePromptSession(false);
      state.activeInput = candidate.input;
      state.activeContext = candidate.context;
      state.activeComposeRoot = candidate.composeRoot;
      state.activeInputId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      state.hiddenInput = null;
      ensureSession();
      mountOverlay();
    } else {
      state.activeContext = candidate.context;
      state.activeComposeRoot = candidate.composeRoot;
      mountOverlay();
    }
    render();
  }

  function detectActivePrompt() {
    const allCandidates = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'))
      .filter(isPotentialPromptInput)
      .map(buildCandidate)
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (!allCandidates.length) return null;
    const focused = allCandidates.find((candidate) => candidate.input === document.activeElement || candidate.input.contains?.(document.activeElement));
    return focused || allCandidates[0];
  }

  function buildCandidate(input) {
    const rect = safeRect(input);
    if (!rect || rect.width < 220 || rect.height > 140) return null;
    let bestContext = null;
    let bestScore = 0;
    let node = input;
    for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
      const score = scoreContext(node);
      if (score > bestScore) {
        bestScore = score;
        bestContext = node;
      }
    }
    let score = bestScore;
    const placeholder = normalizeText(input.getAttribute?.('placeholder') || input.getAttribute?.('aria-label') || input.getAttribute?.('title') || '');
    if (/gemini|prompt|write|email|draft|pregunta|correo|redactar|escribir|borrador/.test(placeholder)) score += 2;
    if (document.activeElement === input || input.contains?.(document.activeElement)) score += 2;
    if (rect.bottom > (window.innerHeight - 260)) score += 1;
    if (rect.height < 80) score += 1;
    if (score < 4 || !bestContext) return null;
    return { input, context: bestContext, composeRoot: findComposeRoot(bestContext), score };
  }

  function scoreContext(node) {
    if (!(node instanceof Element)) return 0;
    if (node.id === ROOT_ID || node.closest(`#${ROOT_ID}`)) return -100;
    const sample = normalizeText(sampleVisibleText(node));
    let score = 0;
    if (/gemini/.test(sample)) score += 4;
    if (/help me write|help me draft|ask gemini|pregunta a gemini|ayudame a escribir|ayúdame a escribir|redactar/.test(sample)) score += 4;
    if (/(create|generate|insert|crear|generar|insertar)/.test(sample)) score += 2;
    if (/(cancel|close|cancelar|cerrar)/.test(sample)) score += 1;
    if (node.querySelector('button, [role="button"]')) score += 1;
    if (node.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) score += 1;
    return score;
  }

  function findComposeRoot(startNode) {
    const selectors = ['div[role="dialog"]', '.AD', '.M9', '.nH'];
    for (const selector of selectors) {
      const found = startNode.closest(selector);
      if (found) return found;
    }
    return startNode;
  }

  function sampleVisibleText(node) {
    if (!(node instanceof Element)) return '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = '';
    while (walker.nextNode() && text.length < 550) {
      text += ` ${walker.currentNode.textContent || ''}`;
    }
    return text.trim();
  }

  function isPotentialPromptInput(node) {
    if (!(node instanceof Element)) return false;
    if (node.id === ROOT_ID || node.closest(`#${ROOT_ID}`)) return false;
    const rect = safeRect(node);
    if (!rect || rect.width < 180 || rect.height < 18) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const role = (node.getAttribute('role') || '').toLowerCase();
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    const isTextLike = tag === 'textarea' || (tag === 'input' && type === 'text') || node.getAttribute('contenteditable') === 'true' || role === 'textbox';
    if (!isTextLike) return false;
    if (rect.height > 180 || rect.width > window.innerWidth * 0.95) return false;
    return true;
  }

  function safeRect(node) {
    if (!(node instanceof Element)) return null;
    const rect = node.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function mountOverlay() {
    if (!state.activeContext) return;
    if (!state.activeContext.classList.contains(HOST_CLASS)) state.activeContext.classList.add(HOST_CLASS);
    if (!state.root) {
      const root = document.createElement('div');
      root.id = ROOT_ID;
      state.root = root;
    }
    if (!state.activeContext.contains(state.root)) state.activeContext.appendChild(state.root);
  }

  function unmountOverlay() {
    if (state.root && state.root.parentElement) state.root.parentElement.removeChild(state.root);
  }

  function render() {
    if (!state.root || !state.activeInput || state.hiddenInput === state.activeInput) return;
    const text = getInputValue(state.activeInput).trim();
    if (!text) {
      state.currentAnalysis = null;
      state.root.dataset.mode = state.store.settings.mode;
      state.root.innerHTML = '';
      return;
    }
    const composeContext = extractComposeContext(state.activeComposeRoot);
    const analysis = analyzePrompt(text, composeContext);
    state.currentAnalysis = analysis;
    ensureSession();
    if (state.promptSession && state.promptSession.baselineScore == null && analysis.wordCount >= 4) {
      state.promptSession.baselineScore = analysis.score;
      state.promptSession.baselineMissingCount = analysis.missingItems.length;
    }
    if (state.promptSession) {
      state.promptSession.lastScore = analysis.score;
      state.promptSession.lastMissingCount = analysis.missingItems.length;
    }
    state.root.dataset.mode = state.store.settings.mode;
    state.root.innerHTML = buildMarkup(analysis);
  }

  function extractComposeContext(composeRoot) {
    const root = composeRoot || document;
    const toSelectors = ['input[aria-label^="To"]', 'input[aria-label*="To "]', 'input[aria-label^="Para"]', 'input[aria-label*="Destinat"]', 'input[peoplekit-id]', 'span[email]', '[data-hovercard-id]'];
    const recipients = new Set();
    toSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((el) => {
        const value = (el.getAttribute('email') || el.getAttribute('data-hovercard-id') || ('value' in el ? el.value : '') || el.textContent || '').trim();
        if (value) recipients.add(value);
      });
    });
    const subjectEl = root.querySelector('input[name="subjectbox"], textarea[name="subjectbox"], input[placeholder*="Subject"], input[aria-label*="Subject"], input[placeholder*="Asunto"], input[aria-label*="Asunto"]');
    return { to: Array.from(recipients).join(', '), subject: subjectEl ? getInputValue(subjectEl).trim() : '' };
  }

  function analyzePrompt(text, compose) {
    const normalized = normalizeText(text);
    const type = detectPromptType(normalized);
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const signals = detectSignals(normalized, text, compose, type);
    const items = TYPE_DEFS[type].items.map((id) => ({ id, detected: Boolean(signals[id]), label: t(id), hint: t(`${id}Hint`) }));
    const missingItems = items.filter((item) => !item.detected);
    let score = 4 + Math.min(10, Math.floor(wordCount / 2));
    if (signals.contextRich) score += 6;
    if (compose.to) score += 2;
    if (compose.subject) score += 2;
    const weights = { tone: 12, recipient: 12, goal: 15, when: 17, length: 10, urgency: 13, context: 12, incident: 14, resolution: 14, audience: 12, cta: 13 };
    items.forEach((item) => { if (item.detected) score += weights[item.id] || 10; });
    if (missingItems.length === 0) score += 8;
    score = clamp(score, 0, 100);
    return { text, normalized, type, typeLabel: t(`type_${type}`), wordCount, items, missingItems, score, scoreLabel: qualityLabel(score), insight: t(TYPE_DEFS[type].insightKey), compose, signals };
  }

  function detectPromptType(normalized) {
    let bestType = 'general';
    let bestScore = 0;
    Object.entries(TYPE_DEFS).forEach(([type, config]) => {
      if (type === 'general') return;
      const matches = config.keywords.reduce((count, keyword) => count + (normalized.includes(normalizeText(keyword)) ? 1 : 0), 0);
      if (matches > bestScore) {
        bestScore = matches;
        bestType = type;
      }
    });
    return bestType;
  }

  function detectSignals(normalized, originalText, compose, type) {
    const lower = normalized;
    const signals = {};
    signals.tone = /(formal|friendly|urgent|professional|polite|warm|casual|tone)/.test(lower);
    signals.recipient = Boolean(compose.to) || /(to my|to the|for my|for the|boss|manager|director|team|client|customer|supplier|professor|teacher|vendor|stakeholder)/.test(lower);
    signals.goal = /(write|draft|compose|send|reply|ask|request|email|message)/.test(lower) || ['meeting', 'followup', 'apology', 'announcement'].includes(type);
    signals.when = /(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|morning|afternoon|evening|before|after|by\s+\w+|at\s+\d|asap|this week)/.test(lower);
    signals.length = /(short|brief|concise|one paragraph|two paragraphs|detailed|bullet|medium|long)/.test(lower);
    signals.urgency = /(urgent|asap|soon|deadline|before eod|by tomorrow|time-sensitive|priority)/.test(lower);
    signals.context = /(following up|follow up|last email|previous email|waiting|regarding|about the|about my|based on|after our conversation|thread)/.test(lower) || (Boolean(compose.subject) && lower.length > 30);
    signals.incident = /(because|after|mistake|error|issue|delay|wrong|forgot|problem|because of|missed|failed)/.test(lower) && originalText.length > 28;
    signals.resolution = /(fix|refund|replace|correct|reschedule|offer|will send|i will|resolve|clarify|provide|share)/.test(lower);
    signals.audience = /(team|everyone|all staff|company|department|clients|customers|users|stakeholders|leadership)/.test(lower) || (Boolean(compose.to) && /,|;/.test(compose.to));
    signals.cta = /(reply|confirm|join|register|review|let me know|action required|approve|respond|sign off)/.test(lower);
    signals.contextRich = originalText.trim().split(/\s+/).length >= 9 && /(project|update|invoice|launch|budget|proposal|meeting|timeline|scope|deliverable|milestone)/.test(lower);
    if (type === 'meeting' && !signals.goal) signals.goal = /(meeting|schedule|call)/.test(lower);
    if (type === 'announcement' && !signals.goal) signals.goal = /(announce|inform|share)/.test(lower);
    if (type === 'followup' && !signals.goal) signals.goal = /(update|status|reply)/.test(lower);
    if (type === 'apology' && !signals.goal) signals.goal = /(apolog|sorry)/.test(lower);
    return signals;
  }

  function qualityLabel(score) {
    if (score >= 90) return t('excellent');
    if (score >= 75) return t('strong');
    if (score >= 60) return t('decent');
    return t('needsWork');
  }

  function buildMarkup(analysis) {
    const mode = state.store.settings.mode;
    if (mode === 'mini') return buildMiniMarkup(analysis);
    if (mode === 'small') return buildSmallMarkup(analysis);
    return buildLargeMarkup(analysis);
  }

  function buildMiniMarkup(analysis) {
    return `
      <div class="ecp-card ecp-card--advisor">
        <div class="ecp-advisor-header">
          <div><div class="ecp-advisor-title">🌱 ${escapeHtml(t('brand'))}</div></div>
          <div class="ecp-controls">${modeButton('small', '▣', t('setSmall'))}${modeButton('large', '⬚', t('setLarge'))}${dismissButton()}</div>
        </div>
        <div class="ecp-mini-columns">
          <div class="ecp-mini-main">
            <div class="ecp-helper">${escapeHtml(t('addingDetails'))}</div>
            <div class="ecp-list">${analysis.items.slice(0, 4).map(renderChecklistItem).join('')}</div>
          </div>
          <div class="ecp-mini-side">
            <div class="ecp-section-heading" style="color:#4f4f4f;">${escapeHtml(t('thisSaves'))}</div>
            <ul>${buildEquivalentItems().slice(0, 3).map((item) => `<li>${item}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="ecp-mini-actions"><button class="ecp-button ecp-button--primary" data-ecp-action="improve">${escapeHtml(t('improve'))}</button></div>
      </div>
    `;
  }

  function buildSmallMarkup(analysis) {
    return `
      <div class="ecp-layout">
        <div class="ecp-card ecp-card--advisor ecp-card--small-advisor">
          <div class="ecp-advisor-header">
            <div><div class="ecp-advisor-title">🌱 ${escapeHtml(t('brand'))} — ${escapeHtml(t('tipTitle'))}</div></div>
            <div class="ecp-controls">${modeButton('mini', '–', t('setMini'))}${modeButton('large', '⬚', t('setLarge'))}${dismissButton()}</div>
          </div>
          <div class="ecp-advisor-body">${renderQuality(analysis)}<div class="ecp-helper">${escapeHtml(t('addingDetails'))}</div><div class="ecp-list">${analysis.items.map(renderChecklistItem).join('')}</div></div>
          <div class="ecp-divider"></div>
          <div class="ecp-footer-note">💡 ${escapeHtml(t('eachAvoided', { minutes: 4 }))}</div>
          <div class="ecp-actions"><button class="ecp-button ecp-button--primary" data-ecp-action="improve">${escapeHtml(t('improve'))}</button><button class="ecp-button ecp-button--secondary" data-ecp-action="dismiss">${escapeHtml(t('dismiss'))}</button></div>
        </div>
        <div class="ecp-card ecp-card--stats ecp-card--small-stats">${renderStatsCard(analysis, false)}</div>
      </div>
    `;
  }

  function buildLargeMarkup(analysis) {
    return `
      <div class="ecp-layout">
        <div class="ecp-card ecp-card--advisor ecp-card--large-advisor">
          <div class="ecp-advisor-header">
            <div><div class="ecp-advisor-title">🌱 ${escapeHtml(t('brand'))} — ${escapeHtml(t('tipTitle'))}</div></div>
            <div class="ecp-controls">${modeButton('mini', '–', t('setMini'))}${modeButton('small', '▣', t('setSmall'))}${dismissButton()}</div>
          </div>
          <div class="ecp-advisor-body">${renderQuality(analysis)}<div class="ecp-helper">${escapeHtml(t('addingDetails'))}</div><div class="ecp-list">${analysis.items.map(renderChecklistItem).join('')}</div></div>
          <div class="ecp-divider"></div>
          <div class="ecp-footer-note">💡 ${escapeHtml(t('eachAvoided', { minutes: 4 }))}</div>
          <div class="ecp-actions"><button class="ecp-button ecp-button--primary" data-ecp-action="improve">${escapeHtml(t('improve'))}</button><button class="ecp-button ecp-button--secondary" data-ecp-action="dismiss">${escapeHtml(t('dismiss'))}</button></div>
        </div>
        <div class="ecp-card ecp-card--stats ecp-card--large-stats">${renderStatsCard(analysis, true)}</div>
      </div>
    `;
  }

  function renderQuality(analysis) {
    return `
      <div class="ecp-quality-row">
        <div class="ecp-quality-label">${escapeHtml(t('promptQuality'))}</div>
        <div class="ecp-quality-bar"><div class="ecp-quality-fill" style="width:${clamp(analysis.score, 0, 100)}%"></div></div>
        <div class="ecp-quality-score">${escapeHtml(t('qualityBadge', { score: analysis.score, label: analysis.scoreLabel }))}</div>
      </div>
    `;
  }

  function renderStatsCard(analysis, includeWeek) {
    const stats = state.store.stats;
    const totalKWh = round3(stats.promptsAvoided * ENERGY_PER_AVOIDED_PROMPT_KWH);
    return `
      <div class="ecp-stats">
        <div class="ecp-stats-header">
          <div class="ecp-stats-title">${escapeHtml(t('brand'))} — ${escapeHtml(t('sessionStats'))}</div>
          <span class="ecp-subtitle">${escapeHtml(t('todaysSession', { date: formatToday() }))}</span>
        </div>
        <div class="ecp-stats-body">
          <div class="ecp-section-heading">${escapeHtml(t('today'))}</div>
          <div class="ecp-metric-grid">
            <div class="ecp-metric"><div class="ecp-metric-value">${stats.promptsAvoided}</div><div class="ecp-metric-label">${escapeHtml(t('promptsAvoided'))}</div></div>
            <div class="ecp-metric"><div class="ecp-metric-value">${totalKWh.toFixed(3)}</div><div class="ecp-metric-label">${escapeHtml(t('kWhSaved'))}</div></div>
          </div>
          ${includeWeek ? renderWeekBars() : ''}
          <div class="ecp-equivalents"><div class="ecp-section-heading">${escapeHtml(t('equivalentTitle'))}</div><ul>${buildEquivalentItems().map((item) => `<li>${item}</li>`).join('')}</ul></div>
          <div class="ecp-callout"><div class="ecp-section-heading">${escapeHtml(t('emailDetected'))}</div><div><strong>${escapeHtml(analysis.typeLabel)}</strong></div><div style="margin-top:6px; color:#9bf0ab;">${escapeHtml(analysis.insight)}</div></div>
          <div class="ecp-callout ecp-callout--insight"><div class="ecp-section-heading">${escapeHtml(t('sessionStats'))}</div><div>${escapeHtml(t('energyEstimateNote'))}</div></div>
        </div>
      </div>
    `;
  }

  function renderWeekBars() {
    const rows = getWeekRows();
    return `
      <div class="ecp-week-title">${escapeHtml(t('thisWeek'))}</div>
      <div class="ecp-week-bars">${rows.map((row) => `<div class="ecp-week-row"><div>${escapeHtml(row.label)}</div><div class="ecp-week-track"><div class="ecp-week-fill" style="width:${row.value}%"></div></div><div>${row.value}%</div></div>`).join('')}</div>
    `;
  }

  function getWeekRows() {
    const rows = [];
    const formatter = new Intl.DateTimeFormat(state.lang, { weekday: 'short' });
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = todayKey(date);
      const history = state.store.stats.history[key];
      const value = history && history.sessions > 0 ? clamp(Math.round(history.totalScore / history.sessions), 0, 100) : 0;
      rows.push({ label: offset === 0 ? t('today') : formatter.format(date), value });
    }
    return rows;
  }

  function renderChecklistItem(item) {
    return item.detected
      ? `<div class="ecp-item ecp-item--detected"><div class="ecp-check">✓</div><div class="ecp-item-title"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(t('detected'))} ✓</span></div></div>`
      : `<div class="ecp-item"><div class="ecp-check">✓</div><div class="ecp-item-title"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.hint)}</span></div></div>`;
  }

  function buildEquivalentItems() {
    const kWh = round3(state.store.stats.promptsAvoided * ENERGY_PER_AVOIDED_PROMPT_KWH);
    return [
      `💡 ${escapeHtml(t('equivalentLightbulb', { time: formatDurationFromKWh(kWh, LIGHTBULB_WATTS) }))}`,
      `💻 ${escapeHtml(t('equivalentLaptop', { time: formatDurationFromKWh(kWh, LAPTOP_WATTS) }))}`,
      `📺 ${escapeHtml(t('equivalentTv', { time: formatDurationFromKWh(kWh, TV_WATTS) }))}`,
      `🔥 ${escapeHtml(t('equivalentMicrowave', { time: formatDurationFromKWh(kWh, MICROWAVE_WATTS) }))}`
    ];
  }

  function improvePrompt() {
    if (!state.activeInput || !state.currentAnalysis) return;
    const improved = buildImprovedPrompt(state.currentAnalysis);
    if (!improved || improved === state.currentAnalysis.text.trim()) return;
    setInputValue(state.activeInput, improved);
    state.hiddenInput = null;
    ensureSession();
    if (state.promptSession) state.promptSession.usedImproveButton = true;
    state.store.stats.improvementsApplied += 1;
    saveStore();
    render();
    showToast(t('improvedToast'));
  }

  function buildImprovedPrompt(analysis) {
    const current = analysis.text.trim().replace(/\s+/g, ' ');
    const suffixes = [];
    const keyMap = {
      meeting: { tone: 'promptImprovedSuffixMeetingTone', recipient: 'promptImprovedSuffixMeetingRecipient', goal: 'promptImprovedSuffixMeetingGoal', when: 'promptImprovedSuffixMeetingWhen', length: 'promptImprovedSuffixMeetingLength' },
      followup: { tone: 'promptImprovedSuffixFollowupTone', context: 'promptImprovedSuffixFollowupContext', urgency: 'promptImprovedSuffixFollowupUrgency', goal: 'promptImprovedSuffixFollowupGoal', length: 'promptImprovedSuffixFollowupLength' },
      apology: { tone: 'promptImprovedSuffixApologyTone', incident: 'promptImprovedSuffixApologyIncident', resolution: 'promptImprovedSuffixApologyResolution', goal: 'promptImprovedSuffixApologyGoal', length: 'promptImprovedSuffixApologyLength' },
      announcement: { audience: 'promptImprovedSuffixAnnouncementAudience', tone: 'promptImprovedSuffixAnnouncementTone', goal: 'promptImprovedSuffixAnnouncementGoal', cta: 'promptImprovedSuffixAnnouncementCta', length: 'promptImprovedSuffixAnnouncementLength' },
      general: { tone: 'promptImprovedSuffixGeneralTone', recipient: 'promptImprovedSuffixGeneralRecipient', goal: 'promptImprovedSuffixGeneralGoal', length: 'promptImprovedSuffixGeneralLength', context: 'promptImprovedSuffixGeneralContext' }
    }[analysis.type] || {};
    analysis.missingItems.forEach((item) => { const key = keyMap[item.id]; if (key) suffixes.push(t(key)); });
    const uniqueSuffixes = Array.from(new Set(suffixes)).slice(0, 4);
    if (!uniqueSuffixes.length) return current;
    const separator = /[.!?]$/.test(current) ? ' ' : '. ';
    return `${current}${separator}${uniqueSuffixes.join(' ')}`;
  }

  function formatDurationFromKWh(kWh, watts) {
    if (!kWh || kWh <= 0 || !watts) return '0 min';
    const hours = kWh / (watts / 1000);
    const totalMinutes = Math.round(hours * 60);
    if (totalMinutes < 1) {
      const seconds = Math.max(1, Math.round(hours * 3600));
      return state.lang === 'es' ? `${seconds} s` : `${seconds} sec`;
    }
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (!mins) return state.lang === 'es' ? `${hrs} h` : `${hrs} hr`;
    return state.lang === 'es' ? `${hrs} h ${mins} min` : `${hrs} hr ${mins} min`;
  }

  function formatToday() {
    try {
      return new Intl.DateTimeFormat(state.lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
    } catch (_) {
      return new Date().toLocaleDateString();
    }
  }

  function getInputValue(input) {
    if (!input) return '';
    if ('value' in input) return input.value || '';
    return input.innerText || input.textContent || '';
  }

  function setInputValue(input, value) {
    if ('value' in input) {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try { input.setSelectionRange(value.length, value.length); } catch (_) {}
      return;
    }
    input.focus();
    input.textContent = value;
    input.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertText', bubbles: true, cancelable: true }));
  }

  function modeButton(mode, label, title) {
    return `<button class="ecp-icon-button" data-ecp-action="mode" data-mode="${escapeHtml(mode)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${label}</button>`;
  }

  function dismissButton() {
    return `<button class="ecp-icon-button" data-ecp-action="dismiss" title="${escapeHtml(t('hide'))}" aria-label="${escapeHtml(t('hide'))}">×</button>`;
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function round3(value) { return Math.round(value * 1000) / 1000; }
  function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function showToast(message) {
    const existing = document.querySelector('.ecp-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'ecp-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  init();
})();
