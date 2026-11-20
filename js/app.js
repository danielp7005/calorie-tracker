import * as store from './store.js';
import {
  searchLocal, recentFoods, searchUSDA, fetchUSDAPortions, lookupBarcode,
  unitsFor, nutritionFor, describeAmount
} from './foods.js';
import { parseFoodText, rankMatches, matchesAll, resolveAmount } from './voice.js';

// ---------------------------------------------------------------- setup

const APP_VERSION = '1.3.2'; // keep in step with VERSION in sw.js
let S = store.load();
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const view = document.getElementById('view');
const sheetRoot = document.getElementById('sheet-root');

const ui = {
  date: dateKey(new Date()),
  meal: defaultMeal(),
  q: '',
  remote: { q: '', loading: false, error: '', items: [] },
  pool: {},            // id -> food, for anything currently on screen
  range: 'week'
};
let searchTimer = null;
let searchAbort = null;

const I = {
  gear: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  search: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  barcode: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/></svg>',
  download: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  upload: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>',
  close: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  mic: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  share: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v13M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>'
};

// ---------------------------------------------------------------- helpers

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
function fmt1(n) { const r = Math.round((Number(n) || 0) * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
function todayKey() { return dateKey(new Date()); }
function longDate(k) { return parseKey(k).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
function shortDate(k) { return parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function dayTitle(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  return parseKey(k).toLocaleDateString('en-US', { weekday: 'long' });
}
function defaultMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'Breakfast';
  if (h < 14.5) return 'Lunch';
  if (h < 17) return 'Snacks';
  if (h < 21) return 'Dinner';
  return 'Snacks';
}
function persist() {
  if (!store.save(S)) toast('Could not save — your phone may be out of storage.');
}
function entriesFor(k) { return S.days[k] || []; }
function totalsFor(k) {
  return entriesFor(k).reduce((t, e) => ({
    kcal: t.kcal + (e.kcal || 0), protein: t.protein + (e.protein || 0),
    carbs: t.carbs + (e.carbs || 0), fat: t.fat + (e.fat || 0)
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

// ---------------------------------------------------------------- router

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  return { name: name || 'today', arg: arg ? decodeURIComponent(arg) : '' };
}

function render() {
  const r = currentRoute();
  ui.pool = {};
  document.body.classList.toggle('hide-tabs', r.name === 'settings');
  document.querySelectorAll('#tabbar [data-tab]').forEach((a) => {
    if (a.dataset.tab === r.name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (r.name === 'add') {
    if (MEALS.includes(r.arg)) ui.meal = r.arg;
    view.innerHTML = renderAdd();
    bindAdd();
    renderResults();
  } else if (r.name === 'history') {
    view.innerHTML = renderHistory();
  } else if (r.name === 'settings') {
    view.innerHTML = renderSettings();
    bindSettings();
  } else {
    view.innerHTML = renderToday();
  }
  document.title = { add: 'Add food', history: 'History', settings: 'Settings' }[r.name] || 'Calories';
}

// ---------------------------------------------------------------- Today

function renderToday() {
  const g = S.settings.goals;
  const t = totalsFor(ui.date);
  const left = g.kcal - t.kcal;
  const over = left < 0;
  const pct = g.kcal > 0 ? Math.min(t.kcal / g.kcal, 1) : 0;
  const C = 2 * Math.PI * 84;
  const isToday = ui.date === todayKey();
  const entries = entriesFor(ui.date);

  const macro = (key, label, cls) => {
    const goal = g[key] || 0;
    const val = t[key];
    const w = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
    return `<div class="macro ${cls}">
      <span class="label">${label}</span>
      <div class="track"><div class="fill" style="width:${w.toFixed(1)}%"></div></div>
      <span class="val">${fmt(val)} <span>/ ${fmt(goal)} g</span></span>
    </div>`;
  };

  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m);
    const kcal = list.reduce((s, e) => s + (e.kcal || 0), 0);
    return `<section class="card meal" aria-label="${m}">
      <div class="meal-head">
        <h3>${m}</h3>
        ${list.length ? `<span class="kcal">${fmt(kcal)} cal</span>` : '<span class="kcal muted small" style="font-weight:500">Nothing yet</span>'}
        <a class="add" href="#/add/${m}" aria-label="Add to ${m}">${I.plus}</a>
      </div>
      ${list.map((e) => `<button class="entry" data-action="entry" data-id="${esc(e.id)}">
          <span class="grow"><span class="name">${esc(e.name)}</span><span class="detail">${esc([e.brand, e.detail].filter(Boolean).join(' · '))}</span></span>
          <span class="kcal">${fmt(e.kcal)}</span>
        </button>`).join('')}
    </section>`;
  }).join('');

  let banner = '';
  if (isIOS() && !isStandalone() && !S.settings.hideInstallTip) {
    banner = `<div class="banner" role="note"><p><b>Install it like an app:</b> tap the Share button in Safari, then <b>Add to Home Screen</b>. Your data is safest when you use it from the Home Screen icon.</p>
      <button class="icon-btn plain" data-action="hide-install" aria-label="Dismiss">${I.close}</button></div>`;
  } else if (needsBackupNudge()) {
    banner = `<div class="banner" role="note"><p>It's been a while since your last backup. <a href="#/settings">Export one in Settings</a> so you don't lose your history.</p>
      <button class="icon-btn plain" data-action="snooze-backup" aria-label="Dismiss">${I.close}</button></div>`;
  }

  return `
    <header class="page-head">
      <div>
        <p class="eyebrow">${esc(longDate(ui.date))}</p>
        <h1>${esc(dayTitle(ui.date))}</h1>
      </div>
      <div class="row" style="gap:8px">
        <button class="icon-btn" data-action="day-prev" aria-label="Previous day">${I.left}</button>
        <button class="icon-btn" data-action="day-next" aria-label="Next day" ${isToday ? 'disabled style="opacity:.35"' : ''}>${I.right}</button>
        <a class="icon-btn" href="#/settings" aria-label="Settings">${I.gear}</a>
      </div>
    </header>
    ${banner}
    <section class="card ring-card">
      <div class="ring ${over ? 'over' : ''}">
        <svg viewBox="0 0 196 196" role="img" aria-label="${fmt(t.kcal)} of ${fmt(g.kcal)} calories eaten">
          <circle class="track" cx="98" cy="98" r="84"></circle>
          <circle class="prog" cx="98" cy="98" r="84" stroke-linecap="round" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}" ${pct === 0 ? 'stroke-opacity="0"' : ''}></circle>
        </svg>
        <div class="center">
          <span class="big">${fmt(Math.abs(left))}</span>
          <span class="sub">${over ? 'cal over' : 'cal left'}</span>
        </div>
      </div>
      <div class="stats3">
        <div><b>${fmt(g.kcal)}</b><span>Goal</span></div>
        <div><b>${fmt(t.kcal)}</b><span>Eaten</span></div>
        <div><b>${g.kcal > 0 ? Math.round((t.kcal / g.kcal) * 100) : 0}%</b><span>Of goal</span></div>
      </div>
    </section>
    <section class="card macros" aria-label="Macros">
      ${macro('protein', 'Protein', 'protein')}
      ${macro('carbs', 'Carbs', 'carbs')}
      ${macro('fat', 'Fat', 'fat')}
    </section>
    <h2 class="section-title">Meals</h2>
    ${meals}
    ${!isToday ? `<button class="btn ghost block" data-action="day-today">Back to today</button>` : ''}
  `;
}

function needsBackupNudge() {
  const days = Object.keys(S.days).filter((k) => S.days[k].length);
  if (days.length < 5) return false;
  const last = Math.max(S.settings.lastExport || 0, S.settings.backupSnooze || 0);
  return Date.now() - last > 14 * 864e5;
}

// ---------------------------------------------------------------- Add food

function renderAdd() {
  const isToday = ui.date === todayKey();
  return `
    <header class="bar-head">
      <a class="link-btn left" href="#/today" style="display:flex;align-items:center">Cancel</a>
      <h1>Add food</h1>
      <span class="right"></span>
    </header>
    ${!isToday ? `<p class="note" style="margin-top:-8px">Adding to ${esc(shortDate(ui.date))}</p>` : ''}
    <div class="seg" role="group" aria-label="Meal">
      ${MEALS.map((m) => `<button data-action="meal" data-meal="${m}" aria-pressed="${ui.meal === m}">${m === 'Snacks' ? 'Snack' : m}</button>`).join('')}
    </div>
    <div class="row" style="gap:10px">
      <label class="field grow">
        ${I.search}
        <span class="sr">Search foods</span>
        <input id="q" type="search" placeholder="Search foods" autocomplete="off" autocorrect="off" enterkeyhint="search" value="${esc(ui.q)}">
      </label>
      <button class="icon-btn" data-action="voice" aria-label="Say what you ate" style="width:52px;height:52px;border-radius:16px;background:var(--accent);color:#fff">${I.mic}</button>
      <button class="icon-btn" data-action="scan" aria-label="Scan barcode" style="width:52px;height:52px;border-radius:16px;background:var(--ink);color:#fff">${I.barcode}</button>
    </div>
    <div id="results" style="display:flex;flex-direction:column;gap:16px"></div>
  `;
}

function bindAdd() {
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    ui.q = q.value;
    clearTimeout(searchTimer);
    if (ui.q.trim().length >= 2) {
      ui.remote = { q: ui.q.trim(), loading: true, error: '', items: [] };
      searchTimer = setTimeout(runRemoteSearch, 450);
    } else {
      if (searchAbort) searchAbort.abort();
      ui.remote = { q: '', loading: false, error: '', items: [] };
    }
    renderResults();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); q.blur(); clearTimeout(searchTimer); if (ui.q.trim().length >= 2) runRemoteSearch(); }
  });
}

async function runRemoteSearch() {
  const query = ui.q.trim();
  if (!query) return;
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  ui.remote = { q: query, loading: true, error: '', items: [] };
  renderResults();
  if (!navigator.onLine) {
    ui.remote = { q: query, loading: false, error: "You're offline. Your own foods still work.", items: [] };
    renderResults();
    return;
  }
  try {
    const items = await searchUSDA(query, S.settings.usdaKey, searchAbort.signal);
    if (ui.q.trim() !== query) return;
    ui.remote = { q: query, loading: false, error: '', items };
  } catch (e) {
    if (e.name === 'AbortError') return;
    ui.remote = { q: query, loading: false, error: e.message || 'Search failed.', items: [] };
  }
  renderResults();
}

function foodMeta(f) {
  const parts = [];
  if (f.brand) parts.push(f.brand);
  if (f.perServing) {
    parts.push(`${fmt(f.perServing.kcal)} cal / ${f.perServing.label}`);
  } else if (f.per100) {
    const m = (f.measures || [])[0];
    if (m) {
      const n = nutritionFor(f, 1, { grams: m.grams });
      parts.push(`${fmt(n.kcal)} cal / ${m.label.replace(/\s*\([^)]*\)\s*$/, '')}`);
    } else {
      parts.push(`${fmt(f.per100.kcal)} cal / 100 g`);
    }
  }
  return parts.join(' · ');
}

function foodItem(f) {
  ui.pool[f.id] = f;
  return `<button class="item" data-action="pick" data-id="${esc(f.id)}">
    <span class="grow"><span class="name">${esc(f.name)}</span><span class="meta">${esc(foodMeta(f))}</span></span>
    <span class="plus" aria-hidden="true">${I.plus}</span>
  </button>`;
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  const q = ui.q.trim();

  if (!q) {
    const recents = recentFoods(S.foods);
    box.innerHTML = `
      <section class="card pad" style="display:flex;flex-direction:column;gap:12px" aria-label="Quick add">
        <h2 style="font-size:15px;font-weight:700">Quick add calories</h2>
        <form class="row" style="gap:10px" data-form="quick">
          <label class="field outline grow">
            <span class="sr">Calories</span>
            <input id="quick-kcal" type="number" inputmode="numeric" min="1" max="10000" placeholder="0" style="font-size:18px;font-weight:700">
            <span class="unit">cal</span>
          </label>
          <button class="btn" type="submit">Add</button>
        </form>
      </section>
      <button class="btn secondary block" data-action="custom">${I.plus} Create a custom food</button>
      <h2 class="section-title">Recent</h2>
      ${recents.length
        ? `<section class="card list">${recents.map(foodItem).join('')}</section>`
        : `<div class="card empty">Foods you log will show up here, so adding them again is one tap.</div>`}
    `;
    box.querySelector('[data-form="quick"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const kcal = Math.round(Number(document.getElementById('quick-kcal').value));
      if (!kcal || kcal < 1) { toast('Enter a number of calories.'); return; }
      addEntry({ name: 'Quick add', detail: '', kcal, protein: 0, carbs: 0, fat: 0, foodId: null });
    });
    return;
  }

  const local = searchLocal(S.foods, q);
  const localIds = new Set(local.map((f) => f.id));
  const r = ui.remote;
  let remoteHtml = '';
  if (q.length < 2) {
    remoteHtml = '';
  } else if (r.loading) {
    remoteHtml = `<div class="card empty"><div class="spinner" aria-label="Searching"></div></div>`;
  } else if (r.error) {
    remoteHtml = `<div class="card empty">${esc(r.error)}</div>`;
  } else if (r.q === q) {
    const items = r.items.filter((f) => !localIds.has(f.id));
    remoteHtml = items.length
      ? `<section class="card list">${items.map(foodItem).join('')}</section>`
      : `<div class="card empty">No matches for “${esc(q)}”. Try fewer words, or create a custom food.</div>`;
  }

  box.innerHTML = `
    ${local.length ? `<p class="list-label">Your foods</p><section class="card list">${local.map(foodItem).join('')}</section>` : ''}
    ${q.length >= 2 ? `<p class="list-label">USDA food database</p>${remoteHtml}` : ''}
    <button class="btn secondary block" data-action="custom">${I.plus} Create a custom food</button>
  `;
}

function addEntry(e) {
  const entry = { id: uid(), meal: ui.meal, at: Date.now(), ...e };
  (S.days[ui.date] = S.days[ui.date] || []).push(entry);
  persist();
  closeSheet();
  ui.q = '';
  ui.remote = { q: '', loading: false, error: '', items: [] };
  toast(`Added ${fmt(entry.kcal)} cal to ${entry.meal}`);
  go('#/today');
}

function rememberFood(food, qty, unit) {
  const prev = S.foods[food.id] || {};
  S.foods[food.id] = {
    ...food,
    uses: (prev.uses || 0) + 1,
    lastUsed: Date.now(),
    lastQty: qty,
    lastUnit: unit.label
  };
}

// ---------------------------------------------------------------- sheets

let sheetKeyHandler = null;
let sheetViewportCleanup = null;
function openSheet(html, label) {
  closeSheet();
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-backdrop>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <button type="button" class="sheet-x" data-sheet-close aria-label="Close">${I.close}</button>
      ${html}
    </div>
  </div>`;
  const back = sheetRoot.querySelector('[data-backdrop]');
  const sheet = sheetRoot.querySelector('.sheet');
  back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
  sheet.querySelector('[data-sheet-close]').addEventListener('click', closeSheet);
  sheetKeyHandler = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', sheetKeyHandler);
  document.body.style.overflow = 'hidden';

  // Keep the panel inside the visible area, right above the on-screen keyboard.
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      back.style.top = vv.offsetTop + 'px';
      back.style.height = vv.height + 'px';
      back.style.bottom = 'auto';
      const keyboardUp = window.innerHeight - vv.height > 120;
      sheet.classList.toggle('kb', keyboardUp);
      sheet.style.maxHeight = Math.round(vv.height - (keyboardUp ? 8 : vv.height * 0.08)) + 'px';
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
    sheetViewportCleanup = () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
  }
  return sheet;
}
function closeSheet() {
  stopListening();
  if (sheetViewportCleanup) { sheetViewportCleanup(); sheetViewportCleanup = null; }
  sheetRoot.innerHTML = '';
  document.body.style.overflow = '';
  if (sheetKeyHandler) document.removeEventListener('keydown', sheetKeyHandler);
  sheetKeyHandler = null;
}

function mealSeg(selected) {
  return `<div class="seg" role="group" aria-label="Meal">
    ${MEALS.map((m) => `<button type="button" data-sheet-meal="${m}" aria-pressed="${selected === m}">${m === 'Snacks' ? 'Snack' : m}</button>`).join('')}
  </div>`;
}
function bindMealSeg(sheet, onPick) {
  sheet.querySelectorAll('[data-sheet-meal]').forEach((b) => b.addEventListener('click', () => {
    sheet.querySelectorAll('[data-sheet-meal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.sheetMeal);
  }));
}

// Serving picker: for new entries (food) or editing an existing entry.
function openServing(food, entry) {
  const units = unitsFor(food);
  let unitIdx = 0;
  let qty = 1;
  let meal = entry ? entry.meal : ui.meal;
  const pref = entry ? { q: entry.qty, u: entry.unitLabel } : { q: food.lastQty, u: food.lastUnit };
  const found = units.findIndex((u) => u.label === pref.u);
  if (found >= 0) { unitIdx = found; qty = Number(pref.q) || 1; }
  else if (units[0].kind === 'grams') qty = 100;

  const sourceLine = {
    usda: 'USDA FoodData Central',
    off: 'Open Food Facts',
    custom: 'Your custom food',
    meal: 'Your saved meal'
  }[food.source] || '';

  const sheet = openSheet(`
    <div>
      <h2>${esc(food.name)}</h2>
      <p class="src">${esc([food.brand, sourceLine].filter(Boolean).join(' · '))}</p>
      ${food.ingredients && food.ingredients.length ? `<p class="small muted" style="margin-top:6px;line-height:1.5">${esc(food.ingredients.join(' · '))}</p>` : ''}
    </div>
    <div class="grid2">
      <label class="stack">Amount
        <span class="field outline"><input id="s-qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(qty)}"></span>
      </label>
      <label class="stack">Unit
        <span class="field outline"><select id="s-unit">${units.map((u, i) => `<option value="${i}" ${i === unitIdx ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></span>
      </label>
    </div>
    <div class="card nut4" id="s-nut" aria-live="polite"></div>
    ${entry ? mealSeg(meal) : ''}
    <button class="btn block" id="s-save">${entry ? 'Save changes' : 'Add to ' + esc(meal)}</button>
    ${entry ? `<button class="btn danger block" id="s-del">Delete entry</button>` : ''}
    ${!entry && S.foods[food.id] ? `<button class="link-btn" id="s-forget" style="color:var(--muted);font-size:14px;align-self:center">Remove from my foods</button>` : ''}
    ${food.source === 'off' ? '<p class="note">Product data from Open Food Facts (openfoodfacts.org), shared under the Open Database License. Entries are added by volunteers, so check them against the label.</p>' : ''}
  `, food.name);

  const qtyEl = sheet.querySelector('#s-qty');
  const unitEl = sheet.querySelector('#s-unit');
  const nutEl = sheet.querySelector('#s-nut');
  const saveEl = sheet.querySelector('#s-save');

  function update() {
    const n = nutritionFor(food, qtyEl.value, units[Number(unitEl.value)]);
    nutEl.innerHTML = `<div class="k"><b>${fmt(n.kcal)}</b><span>cal</span></div>
      <div><b>${fmt1(n.protein)}</b><span>protein g</span></div>
      <div><b>${fmt1(n.carbs)}</b><span>carbs g</span></div>
      <div><b>${fmt1(n.fat)}</b><span>fat g</span></div>`;
    saveEl.disabled = !(Number(qtyEl.value) > 0);
    return n;
  }
  qtyEl.addEventListener('input', update);
  unitEl.addEventListener('change', () => {
    const u = units[Number(unitEl.value)];
    if (u.kind === 'grams' && Number(qtyEl.value) < 10) qtyEl.value = 100;
    else if (u.kind !== 'grams' && Number(qtyEl.value) >= 10) qtyEl.value = 1;
    update();
  });
  bindMealSeg(sheet, (m) => { meal = m; if (!entry) saveEl.textContent = 'Add to ' + m; });
  update();

  saveEl.addEventListener('click', () => {
    const unit = units[Number(unitEl.value)];
    const q = Number(qtyEl.value);
    const n = nutritionFor(food, q, unit);
    rememberFood(food, q, unit);
    const data = {
      name: food.name, brand: food.brand || '', detail: describeAmount(q, unit),
      ...n, foodId: food.id, qty: q, unitLabel: unit.label, meal
    };
    if (entry) {
      Object.assign(entry, data);
      persist(); closeSheet(); render(); toast('Saved');
    } else {
      ui.meal = meal;
      addEntry(data);
    }
  });
  const del = sheet.querySelector('#s-del');
  if (del) del.addEventListener('click', () => deleteEntry(entry));
  const forget = sheet.querySelector('#s-forget');
  if (forget) forget.addEventListener('click', () => {
    delete S.foods[food.id]; persist(); closeSheet(); renderResults(); toast('Removed from your foods');
  });
}

// USDA foods often arrive with nutrition per 100 g only. Before showing the serving
// picker, look up real portions (e.g. "1 large (50 g)") once and remember them.
function needsPortions(food) {
  return food.source === 'usda' && !food.perServing && !(food.measures && food.measures.length) && !food.portionsChecked;
}

async function ensurePortions(food) {
  if (!needsPortions(food) || !navigator.onLine) return food;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let measures = [];
  try {
    measures = await fetchUSDAPortions(food, S.settings.usdaKey, ctrl.signal);
  } catch (e) {
    console.warn(e);
  }
  clearTimeout(timer);
  const updated = { ...food, measures, portionsChecked: true };
  ui.pool[food.id] = updated;
  if (S.foods[food.id]) { S.foods[food.id] = { ...S.foods[food.id], measures, portionsChecked: true }; persist(); }
  return S.foods[food.id] || updated;
}

async function pickFood(food) {
  if (!needsPortions(food) || !navigator.onLine) { openServing(food); return; }
  openSheet(`<h2>${esc(food.name)}</h2><div class="empty"><div class="spinner" aria-label="Loading serving sizes"></div><p style="margin-top:10px">Loading serving sizes…</p></div>`, food.name);
  const updated = await ensurePortions(food);
  if (!sheetRoot.firstChild) return; // closed while loading
  openServing(updated);
}

// ---------------------------------------------------------------- voice / describe

let recognition = null;

function stopListening() {
  if (recognition) { try { recognition.stop(); } catch (e) { /* ignore */ } }
  recognition = null;
}

function openVoice(prefill = '') {
  stopListening();
  // iPhones block in-page speech recognition in Home Screen apps, so they use the
  // keyboard's own microphone key. Other devices also get a "Tap to speak" button.
  const SR = !isIOS() && !S.settings.micBlocked ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const sheet = openSheet(`
    <h2>Say what you ate</h2>
    <label class="stack"><span class="sr">What you ate</span>
      <textarea id="v-text" rows="4" placeholder="e.g. 2 cups spinach, half an avocado, 6 cherry tomatoes and 1 oz feta" style="width:100%;height:112px;border:2px solid var(--accent);border-radius:14px;padding:12px 14px;font-size:16px;line-height:1.45;resize:none;background:#fff;outline:none">${esc(prefill)}</textarea>
    </label>
    <button class="btn block" id="v-go">Find foods</button>
    ${SR ? `<button class="btn secondary block" id="v-mic" type="button" aria-pressed="false">${I.mic} <span>Tap to speak</span></button>` : ''}
    <p class="note" id="v-hint">${SR ? 'Or use the microphone key on your keyboard.' : 'Tap the mic key on your keyboard to speak. Name each food with an amount.'}</p>
  `, 'Say what you ate');
  const text = sheet.querySelector('#v-text');
  // Focus right away (still inside the tap) so iPhone opens the keyboard with its mic key.
  if (!SR) { try { text.focus({ preventScroll: true }); } catch (e) { text.focus(); } if (prefill) text.setSelectionRange(text.value.length, text.value.length); }

  const mic = sheet.querySelector('#v-mic');
  if (mic && SR) {
    mic.addEventListener('click', () => {
      if (recognition) { stopListening(); return; }
      const rec = new SR();
      recognition = rec;
      rec.lang = navigator.language || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      const base = text.value.trim() ? text.value.trim() + ', ' : '';
      rec.onresult = (ev) => {
        let said = '';
        for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
        text.value = base + said.trim();
      };
      const setIdle = () => {
        mic.setAttribute('aria-pressed', 'false');
        mic.querySelector('span').textContent = 'Tap to speak';
        if (recognition === rec) recognition = null;
      };
      rec.onend = setIdle;
      rec.onerror = (ev) => {
        setIdle();
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          S.settings.micBlocked = true; persist(); // don't offer the button again on this device
          mic.remove();
          text.focus();
          sheet.querySelector('#v-hint').textContent = 'The mic button isn’t allowed here. Use the microphone key on your keyboard instead.';
        } else if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
          sheet.querySelector('#v-hint').textContent = 'Speech recognition stopped. Use the microphone key on your keyboard instead.';
        }
      };
      try {
        rec.start();
        mic.setAttribute('aria-pressed', 'true');
        mic.querySelector('span').textContent = 'Listening… tap to stop';
      } catch (e) { setIdle(); }
    });
  }

  sheet.querySelector('#v-go').addEventListener('click', () => {
    stopListening();
    const said = text.value.trim();
    if (!said) { toast('Say or type what you ate first.'); return; }
    runVoice(said);
  });
}

async function resolveVoiceItem(parsed) {
  const local = rankMatches(Object.values(S.foods), parsed.name).filter((f) => matchesAll(f, parsed.name));
  let candidates = local.slice(0, 2);
  if (navigator.onLine) {
    try {
      const remote = await searchUSDA(parsed.name, S.settings.usdaKey);
      const seen = new Set(candidates.map((f) => f.id));
      candidates = candidates.concat(rankMatches(remote, parsed.name).filter((f) => !seen.has(f.id))).slice(0, 8);
    } catch (e) {
      if (!candidates.length) return { parsed, status: 'error', error: e.message };
    }
  }
  if (!candidates.length) return { parsed, status: 'none' };
  return setVoiceFood({ parsed, candidates, status: 'ok' }, candidates[0]);
}

async function setVoiceFood(item, food) {
  const full = await ensurePortions(food);
  const units = unitsFor(full);
  const amt = resolveAmount(units, item.parsed);
  return { ...item, food: full, units, unitIdx: amt.unitIdx, qty: amt.qty, estimated: amt.estimated };
}

async function runVoice(text) {
  const parsed = parseFoodText(text);
  if (!parsed.length) { toast("I couldn't pick out any foods. Try naming each one."); return; }
  openSheet(`<h2>Finding ${parsed.length} ${parsed.length === 1 ? 'food' : 'foods'}…</h2><div class="empty"><div class="spinner" aria-label="Searching"></div></div>`, 'Finding foods');
  const items = await Promise.all(parsed.map(resolveVoiceItem));
  if (!sheetRoot.firstChild) return;
  openVoiceReview(items, text);
}

function prettyRaw(s) {
  return String(s).replace(/\b0\.5\b/g, '½').replace(/\b0\.25\b/g, '¼').replace(/\b0\.75\b/g, '¾').replace(/\b(\d+)\.5\b/g, '$1½');
}

function voiceRow(item, i) {
  if (item.status !== 'ok') {
    return `<div class="card vrow" data-i="${i}">
      <div class="row between"><b class="grow">No match for “${esc(prettyRaw(item.parsed.raw))}”</b>
        <button class="icon-btn plain" data-v-remove="${i}" aria-label="Remove">${I.close}</button></div>
      <p class="small muted">${esc(item.error || 'Try different words, or search for it yourself.')}</p>
      <button class="btn ghost" data-v-search="${i}" style="min-height:40px;font-size:14px">Search “${esc(item.parsed.name)}”</button>
    </div>`;
  }
  const n = nutritionFor(item.food, item.qty, item.units[item.unitIdx]);
  return `<div class="card vrow" data-i="${i}">
    <div class="row" style="gap:8px">
      <span class="field outline grow" style="min-height:44px"><span class="sr">Food</span>
        <select data-v-food="${i}" style="font-weight:600">${item.candidates.map((f, j) => `<option value="${j}" ${f.id === item.food.id ? 'selected' : ''}>${esc(f.name)}${f.brand ? ' – ' + esc(f.brand) : ''}</option>`).join('')}</select>
      </span>
      <button class="icon-btn plain" data-v-remove="${i}" aria-label="Remove ${esc(item.food.name)}">${I.close}</button>
    </div>
    <p class="small muted">You said “${esc(prettyRaw(item.parsed.raw))}”${item.estimated ? ' · amount estimated, please check' : ''}</p>
    <div class="row" style="gap:8px">
      <span class="field outline" style="width:84px;min-height:44px"><span class="sr">Amount</span><input data-v-qty="${i}" type="number" inputmode="decimal" min="0" step="any" value="${esc(item.qty)}"></span>
      <span class="field outline grow" style="min-height:44px"><span class="sr">Unit</span><select data-v-unit="${i}">${item.units.map((u, j) => `<option value="${j}" ${j === item.unitIdx ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></span>
      <b class="nowrap" data-v-cal="${i}" style="min-width:64px;text-align:right">${fmt(n.kcal)} cal</b>
    </div>
  </div>`;
}

function openVoiceReview(items, text) {
  let meal = ui.meal;
  const sheet = openSheet(`
    <div>
      <h2>Check your foods</h2>
      <p class="src">Adding to <b style="color:var(--ink)">${esc(meal)}</b> · fix anything that looks off</p>
    </div>
    <div id="vr-list" style="display:flex;flex-direction:column;gap:10px"></div>
    <div class="card pad row between"><b>Total</b><b id="vr-total"></b></div>
    <label class="row" style="gap:10px;min-height:44px;font-size:15px;font-weight:600"><input type="checkbox" id="vr-save" style="width:22px;height:22px;accent-color:var(--accent)"> Also save as a meal for next time</label>
    <label class="stack" id="vr-name-wrap" hidden>Meal name
      <span class="field outline"><input id="vr-name" maxlength="60" placeholder="e.g. My usual salad"></span>
    </label>
    <button class="btn block" id="vr-add"></button>
    <button class="btn ghost block" id="vr-edit">Change what I said</button>
  `, 'Check your foods');

  const list = sheet.querySelector('#vr-list');
  const addBtn = sheet.querySelector('#vr-add');
  const nameWrap = sheet.querySelector('#vr-name-wrap');
  const nameInput = sheet.querySelector('#vr-name');
  const saveBox = sheet.querySelector('#vr-save');

  const okItems = () => items.filter((it) => it && it.status === 'ok' && Number(it.qty) > 0);
  function totals() {
    return okItems().reduce((t, it) => {
      const n = nutritionFor(it.food, it.qty, it.units[it.unitIdx]);
      return { kcal: t.kcal + n.kcal, protein: t.protein + n.protein, carbs: t.carbs + n.carbs, fat: t.fat + n.fat };
    }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  }
  function refreshTotals() {
    const t = totals();
    const count = okItems().length;
    sheet.querySelector('#vr-total').textContent = `${fmt(t.kcal)} cal`;
    addBtn.textContent = count ? `Add ${count} ${count === 1 ? 'item' : 'items'} to ${meal}` : 'Nothing to add';
    addBtn.disabled = !count;
  }
  function renderList() {
    list.innerHTML = items.map((it, i) => (it ? voiceRow(it, i) : '')).join('') ||
      '<div class="card empty">Nothing left. Tap “Change what I said” to try again.</div>';
    refreshTotals();
  }
  renderList();

  list.addEventListener('input', (e) => {
    const i = e.target.dataset.vQty;
    if (i === undefined) return;
    const it = items[Number(i)];
    it.qty = Number(e.target.value);
    const n = nutritionFor(it.food, it.qty, it.units[it.unitIdx]);
    list.querySelector(`[data-v-cal="${i}"]`).textContent = `${fmt(n.kcal)} cal`;
    refreshTotals();
  });
  list.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.vUnit !== undefined) {
      const it = items[Number(t.dataset.vUnit)];
      const prev = it.units[it.unitIdx];
      it.unitIdx = Number(t.value);
      const u = it.units[it.unitIdx];
      if (u.kind === 'grams' && prev.kind !== 'grams') it.qty = Math.round((prev.grams || 100) * (Number(it.qty) || 1));
      else if (u.kind !== 'grams' && prev.kind === 'grams') it.qty = 1;
      renderList();
    } else if (t.dataset.vFood !== undefined) {
      const i = Number(t.dataset.vFood);
      const it = items[i];
      const food = it.candidates[Number(t.value)];
      t.disabled = true;
      items[i] = await setVoiceFood(it, food);
      renderList();
    }
  });
  list.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-v-remove]');
    if (rm) { items[Number(rm.dataset.vRemove)] = null; renderList(); return; }
    const se = e.target.closest('[data-v-search]');
    if (se) {
      const it = items[Number(se.dataset.vSearch)];
      closeSheet();
      ui.q = it.parsed.name;
      go('#/add');
      const q = document.getElementById('q');
      if (q) { q.value = ui.q; runRemoteSearch(); }
    }
  });
  saveBox.addEventListener('change', () => { nameWrap.hidden = !saveBox.checked; if (saveBox.checked) nameInput.focus(); });
  sheet.querySelector('#vr-edit').addEventListener('click', () => openVoice(text));

  addBtn.addEventListener('click', () => {
    const chosen = okItems();
    if (!chosen.length) return;
    if (saveBox.checked) {
      const name = nameInput.value.trim();
      if (!name) { toast('Give the meal a name, or untick “save as a meal”.'); nameInput.focus(); return; }
      const t = totals();
      const id = 'meal:' + uid();
      S.foods[id] = {
        id, name, brand: '', source: 'meal', per100: null, measures: [],
        perServing: { label: '1 meal', kcal: Math.round(t.kcal), protein: Math.round(t.protein * 10) / 10, carbs: Math.round(t.carbs * 10) / 10, fat: Math.round(t.fat * 10) / 10 },
        ingredients: chosen.map((it) => `${describeAmount(Number(it.qty), it.units[it.unitIdx])} ${it.food.name}`),
        uses: 0, lastUsed: Date.now()
      };
    }
    const entries = chosen.map((it) => {
      const unit = it.units[it.unitIdx];
      const q = Number(it.qty);
      rememberFood(it.food, q, unit);
      return {
        name: it.food.name, brand: it.food.brand || '', detail: describeAmount(q, unit),
        ...nutritionFor(it.food, q, unit), foodId: it.food.id, qty: q, unitLabel: unit.label
      };
    });
    ui.meal = meal;
    addEntries(entries, saveBox.checked ? `Saved “${nameInput.value.trim()}” · ` : '');
  });
}

function addEntries(list, prefix = '') {
  const day = (S.days[ui.date] = S.days[ui.date] || []);
  let total = 0;
  for (const e of list) {
    day.push({ id: uid(), meal: ui.meal, at: Date.now(), ...e });
    total += e.kcal || 0;
  }
  persist();
  closeSheet();
  ui.q = '';
  ui.remote = { q: '', loading: false, error: '', items: [] };
  toast(`${prefix}Added ${list.length} ${list.length === 1 ? 'item' : 'items'} · ${fmt(total)} cal`);
  go('#/today');
}

function openQuickEdit(entry) {
  let meal = entry.meal;
  const sheet = openSheet(`
    <h2>${esc(entry.name)}</h2>
    <label class="stack">Calories
      <span class="field outline"><input id="qe-kcal" type="number" inputmode="numeric" min="1" value="${esc(entry.kcal)}"><span class="unit">cal</span></span>
    </label>
    ${mealSeg(meal)}
    <button class="btn block" id="qe-save">Save changes</button>
    <button class="btn danger block" id="qe-del">Delete entry</button>
  `, 'Edit entry');
  bindMealSeg(sheet, (m) => { meal = m; });
  sheet.querySelector('#qe-save').addEventListener('click', () => {
    const kcal = Math.round(Number(sheet.querySelector('#qe-kcal').value));
    if (!(kcal > 0)) { toast('Enter a number of calories.'); return; }
    entry.kcal = kcal; entry.meal = meal;
    persist(); closeSheet(); render(); toast('Saved');
  });
  sheet.querySelector('#qe-del').addEventListener('click', () => deleteEntry(entry));
}

function deleteEntry(entry) {
  const list = entriesFor(ui.date);
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) delete S.days[ui.date];
  persist(); closeSheet(); render();
  toast('Entry deleted');
}

function openCustom(prefill = {}) {
  const sheet = openSheet(`
    <h2>Custom food</h2>
    ${prefill.barcode ? `<p class="src">Barcode ${esc(prefill.barcode)} wasn't found in Open Food Facts. Enter it from the label once and it's saved for next time.</p>` : '<p class="src">Enter the numbers from the nutrition label for one serving.</p>'}
    <form id="cf" style="display:flex;flex-direction:column;gap:12px">
      <label class="stack">Name
        <span class="field outline"><input name="name" required maxlength="80" value="${esc(prefill.name || '')}" placeholder="e.g. Protein bar"></span>
      </label>
      <label class="stack">Serving
        <span class="field outline"><input name="serving" maxlength="40" value="1 serving" placeholder="e.g. 1 bar, 1 cup"></span>
      </label>
      <div class="grid2">
        <label class="stack">Calories
          <span class="field outline"><input name="kcal" type="number" inputmode="decimal" min="0" step="any" required><span class="unit">cal</span></span>
        </label>
        <label class="stack">Protein
          <span class="field outline"><input name="protein" type="number" inputmode="decimal" min="0" step="any" placeholder="0"><span class="unit">g</span></span>
        </label>
        <label class="stack">Carbs
          <span class="field outline"><input name="carbs" type="number" inputmode="decimal" min="0" step="any" placeholder="0"><span class="unit">g</span></span>
        </label>
        <label class="stack">Fat
          <span class="field outline"><input name="fat" type="number" inputmode="decimal" min="0" step="any" placeholder="0"><span class="unit">g</span></span>
        </label>
      </div>
      <button class="btn block" type="submit">Save and continue</button>
    </form>
  `, 'Custom food');
  sheet.querySelector('#cf').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    const kcal = Number(f.get('kcal'));
    if (!name || !(kcal >= 0)) { toast('Add a name and calories.'); return; }
    const food = {
      id: prefill.barcode ? 'custom:' + prefill.barcode : 'custom:' + uid(),
      name, brand: '', source: 'custom', per100: null, measures: [],
      perServing: {
        label: String(f.get('serving') || '').trim() || '1 serving',
        kcal, protein: Number(f.get('protein')) || 0, carbs: Number(f.get('carbs')) || 0, fat: Number(f.get('fat')) || 0
      },
      barcode: prefill.barcode || ''
    };
    S.foods[food.id] = { ...food, uses: 0, lastUsed: Date.now() };
    persist();
    openServing(S.foods[food.id]);
  });
}

// ---------------------------------------------------------------- barcode scanner

let scanner = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('Could not load the scanner.'));
    document.head.appendChild(s);
  });
}

async function openScanner() {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'scanner';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Scan barcode');
  wrap.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="frame" aria-hidden="true"></div>
    <div class="top"><button class="link-btn" data-scan="cancel">Cancel</button><span style="font-weight:700">Scan barcode</span><span style="width:60px"></span></div>
    <div class="bottom">
      <p class="msg" id="scan-msg">Point the camera at the barcode.</p>
      <form class="row" style="gap:10px" id="scan-manual">
        <label class="field grow"><span class="sr">Barcode number</span><input type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Or type the number"></label>
        <button class="btn" type="submit">Look up</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  const video = wrap.querySelector('video');
  const msg = wrap.querySelector('#scan-msg');
  scanner = { wrap, stream: null, reader: null, raf: 0, done: false };

  wrap.querySelector('[data-scan="cancel"]').addEventListener('click', closeScanner);
  wrap.querySelector('#scan-manual').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = e.target.querySelector('input').value.replace(/\D/g, '');
    if (code.length < 6) { msg.textContent = 'Enter the full number under the barcode.'; return; }
    closeScanner();
    handleBarcode(code);
  });

  const found = (code) => {
    if (!scanner || scanner.done) return;
    scanner.done = true;
    if (navigator.vibrate) navigator.vibrate(40);
    closeScanner();
    handleBarcode(code);
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg.textContent = "This browser can't use the camera here. Type the number instead.";
    return;
  }

  try {
    // Native detector where the browser has one, otherwise the bundled ZXing library.
    let native = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => formats.includes(f));
        if (want.length) native = new window.BarcodeDetector({ formats: want });
      } catch (e) { native = null; }
    }
    if (native) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!scanner) { stream.getTracks().forEach((t) => t.stop()); return; }
      scanner.stream = stream;
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!scanner || scanner.done) return;
        try {
          const codes = await native.detect(video);
          if (codes.length) { found(codes[0].rawValue); return; }
        } catch (e) { /* keep trying */ }
        scanner.raf = requestAnimationFrame(tick);
      };
      tick();
    } else {
      const ZX = await loadZXing();
      if (!scanner) return;
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E]);
      const reader = new ZX.BrowserMultiFormatReader(hints, 300);
      scanner.reader = reader;
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result) => {
        if (result) found(result.getText());
      });
    }
  } catch (e) {
    console.warn(e);
    if (!scanner) return;
    msg.textContent = e && e.name === 'NotAllowedError'
      ? 'Camera access is off. Allow it for this site (Settings › Apps › Safari › Camera), or type the number.'
      : "Couldn't start the camera. Type the number instead.";
  }
}

function closeScanner() {
  if (!scanner) return;
  const s = scanner;
  scanner = null;
  cancelAnimationFrame(s.raf);
  try { if (s.reader) s.reader.reset(); } catch (e) { /* ignore */ }
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  const v = s.wrap.querySelector('video');
  if (v && v.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
  s.wrap.remove();
}

async function handleBarcode(code) {
  const clean = String(code).replace(/\D/g, '');
  const mine = Object.values(S.foods).find((f) => f.barcode && f.barcode.replace(/^0+/, '') === clean.replace(/^0+/, ''));
  if (mine) { openServing(mine); return; }
  if (!navigator.onLine) { toast("You're offline — add it as a custom food for now."); openCustom({ barcode: clean }); return; }
  toast('Looking up barcode…');
  try {
    const food = await lookupBarcode(clean);
    if (food && !food.incomplete) openServing(food);
    else openCustom({ barcode: clean, name: food && food.name ? food.name : '' });
  } catch (e) {
    toast(e.message || 'Lookup failed.');
    openCustom({ barcode: clean });
  }
}

// ---------------------------------------------------------------- History

function renderHistory() {
  const n = ui.range === 'week' ? 7 : 30;
  const t = todayKey();
  const keys = Array.from({ length: n }, (_, i) => addDays(t, i - (n - 1)));
  const goal = S.settings.goals.kcal || 0;
  const vals = keys.map((k) => ({ k, kcal: totalsFor(k).kcal, logged: entriesFor(k).length > 0 }));
  const logged = vals.filter((v) => v.logged && v.k !== t);
  const avgBase = logged.length ? logged : vals.filter((v) => v.logged);
  const avg = avgBase.length ? avgBase.reduce((s, v) => s + v.kcal, 0) / avgBase.length : 0;

  // streak: consecutive logged days ending today (or yesterday if today is empty)
  let streak = 0;
  let k = entriesFor(t).length ? t : addDays(t, -1);
  while (entriesFor(k).length) { streak++; k = addDays(k, -1); }

  const max = Math.max(goal * 1.2, ...vals.map((v) => v.kcal * 1.05), 100);
  const H = 160;
  const bars = vals.map((v) => {
    const h = v.logged ? Math.max(3, Math.round((v.kcal / max) * H)) : 3;
    const cls = !v.logged ? 'none' : v.k === t ? 'today' : v.kcal > goal ? 'over' : '';
    const label = `${shortDate(v.k)}: ${v.logged ? fmt(v.kcal) + ' cal' : 'nothing logged'}`;
    return `<div class="bar ${cls}" style="height:${h}px" title="${esc(label)}"></div>`;
  }).join('');
  const xl = vals.map((v, i) => {
    const d = parseKey(v.k);
    let txt = '';
    if (n === 7) txt = d.toLocaleDateString('en-US', { weekday: 'short' });
    else if (i % 5 === 4 || i === n - 1) txt = String(d.getDate());
    return `<span class="${v.k === t ? 't' : ''}">${txt}</span>`;
  }).join('');

  const rows = vals.slice().reverse().map((v) => `<button class="day-row" data-action="open-day" data-k="${v.k}">
      <span>${v.k === t ? 'Today' : esc(shortDate(v.k))}</span>
      ${v.logged ? `<b class="${v.kcal > goal ? 'over' : ''}">${fmt(v.kcal)} cal</b>` : '<span class="muted">—</span>'}
    </button>`).join('');

  return `
    <header class="page-head">
      <div>
        <p class="eyebrow">${esc(parseKey(keys[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} – ${esc(parseKey(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</p>
        <h1>History</h1>
      </div>
      <button class="icon-btn" data-action="export" aria-label="Export backup" style="width:auto;padding:0 14px;gap:6px;font-size:14px;font-weight:600">${I.download} Export</button>
    </header>
    <div class="seg" role="group" aria-label="Range">
      <button data-action="range" data-range="week" aria-pressed="${ui.range === 'week'}">Week</button>
      <button data-action="range" data-range="month" aria-pressed="${ui.range === 'month'}">Month</button>
    </div>
    <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div class="grid2">
        <div class="kpi"><span class="l">Daily average</span><span class="v">${avg ? fmt(avg) : '—'} <small>cal</small></span></div>
        <div class="kpi"><span class="l">Logging streak</span><span class="v">${streak} <small>${streak === 1 ? 'day' : 'days'}</small></span></div>
      </div>
      <div class="chart" role="img" aria-label="Calories per day, last ${n} days">
        ${goal ? `<div class="goal" style="bottom:${Math.round((goal / max) * H)}px"></div>` : ''}
        <div class="bars ${n === 30 ? 'month' : ''}">${bars}</div>
      </div>
      <div class="xlabels" aria-hidden="true">${xl}</div>
      <div class="legend">
        <span><i class="dash"></i>Goal ${fmt(goal)}</span>
        <span><i style="background:var(--accent)"></i>Under goal</span>
        <span><i style="background:var(--carbs)"></i>Over goal</span>
        <span><i style="background:var(--accent-pale)"></i>Today</span>
      </div>
    </section>
    <section class="card list" aria-label="Days">${rows}</section>
  `;
}

// ---------------------------------------------------------------- Settings

function renderSettings() {
  const g = S.settings.goals;
  const fromMacros = Math.round(g.protein * 4 + g.carbs * 4 + g.fat * 9);
  const lastExport = S.settings.lastExport ? new Date(S.settings.lastExport).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';
  const dayCount = Object.keys(S.days).length;
  return `
    <header class="bar-head">
      <span class="left"></span>
      <h1>Settings</h1>
      <a class="link-btn right" href="#/today" style="display:flex;align-items:center">Done</a>
    </header>

    <h2 class="section-title">Daily goals</h2>
    <section class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="grid2">
        <label class="stack">Calories<span class="field outline"><input data-goal="kcal" type="number" inputmode="numeric" min="0" value="${g.kcal}"><span class="unit">cal</span></span></label>
        <label class="stack">Protein<span class="field outline"><input data-goal="protein" type="number" inputmode="numeric" min="0" value="${g.protein}"><span class="unit">g</span></span></label>
        <label class="stack">Carbs<span class="field outline"><input data-goal="carbs" type="number" inputmode="numeric" min="0" value="${g.carbs}"><span class="unit">g</span></span></label>
        <label class="stack">Fat<span class="field outline"><input data-goal="fat" type="number" inputmode="numeric" min="0" value="${g.fat}"><span class="unit">g</span></span></label>
      </div>
      <p class="small muted" id="macro-kcal">Your macro goals add up to about ${fmt(fromMacros)} cal.</p>
    </section>

    <h2 class="section-title">Food search</h2>
    <section class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <label class="stack">USDA API key
        <span class="field outline"><input id="usda-key" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste your key" value="${esc(S.settings.usdaKey)}"></span>
      </label>
      <p class="small muted" style="line-height:1.5">${S.settings.usdaKey ? 'Key saved on this phone.' : 'Without a key, search uses a shared demo key that allows only about 30 searches an hour.'} Get a free key at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov</a> — it arrives by email in a minute.</p>
    </section>

    <h2 class="section-title">Backup</h2>
    <section class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <p class="small muted" style="line-height:1.5">Your data is saved only on this phone. Export a backup now and then and keep it in Files or iCloud Drive. Last backup: <b style="color:var(--ink)">${esc(lastExport)}</b>.</p>
      <button class="btn block" data-action="export">${I.share} Export backup</button>
      <label class="btn ghost block" style="cursor:pointer">${I.upload} Restore from backup
        <input id="import-file" type="file" accept=".json,application/json" class="sr">
      </label>
    </section>

    <h2 class="section-title">Data</h2>
    <section class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <p class="small muted">${dayCount} ${dayCount === 1 ? 'day' : 'days'} logged · ${Object.keys(S.foods).length} saved foods</p>
      <button class="btn danger block" data-action="wipe">Erase all data</button>
    </section>

    <h2 class="section-title">App</h2>
    <section class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <p class="small muted">Version <b style="color:var(--ink)">${APP_VERSION}</b>. Updates install automatically when you open the app online.</p>
      <button class="btn ghost block" data-action="force-update">Check for updates</button>
    </section>


    <p class="note">Food data: USDA FoodData Central (public domain). Barcode data: Open Food Facts, under the Open Database License. Nutrition numbers are estimates.</p>
  `;
}

function bindSettings() {
  view.querySelectorAll('[data-goal]').forEach((inp) => inp.addEventListener('input', () => {
    const v = Math.max(0, Math.round(Number(inp.value) || 0));
    S.settings.goals[inp.dataset.goal] = v;
    persist();
    const g = S.settings.goals;
    document.getElementById('macro-kcal').textContent = `Your macro goals add up to about ${fmt(g.protein * 4 + g.carbs * 4 + g.fat * 9)} cal.`;
  }));
  const key = document.getElementById('usda-key');
  key.addEventListener('change', () => { S.settings.usdaKey = key.value.trim(); persist(); toast(S.settings.usdaKey ? 'USDA key saved' : 'USDA key removed'); });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = store.importJSON(await file.text(), S.settings.usdaKey);
      const days = Object.keys(next.days).length;
      const sheet = openSheet(`
        <h2>Restore this backup?</h2>
        <p class="src" style="line-height:1.5">It has ${days} ${days === 1 ? 'day' : 'days'} of logs and ${Object.keys(next.foods).length} saved foods. It will <b>replace</b> everything currently in the app.</p>
        <button class="btn block" id="imp-yes">Replace with backup</button>
        <button class="btn ghost block" id="imp-no">Cancel</button>
      `, 'Restore backup');
      sheet.querySelector('#imp-no').addEventListener('click', closeSheet);
      sheet.querySelector('#imp-yes').addEventListener('click', () => {
        S = next; persist(); closeSheet(); render(); toast('Backup restored');
      });
    } catch (err) {
      toast(err.message && err.message.includes('backup') ? err.message : "That file couldn't be read as a backup.");
    }
  });
}

async function doExport() {
  const json = store.exportJSON(S);
  const name = `calorie-backup-${todayKey()}.json`;
  let shared = false;
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Calorie Tracker backup' });
      shared = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user closed the share sheet
  }
  if (!shared) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  S.settings.lastExport = Date.now();
  persist();
  if (currentRoute().name === 'settings') render();
  toast('Backup exported');
}

function confirmWipe() {
  const sheet = openSheet(`
    <h2>Erase all data?</h2>
    <p class="src" style="line-height:1.5">This deletes every log, saved food and setting on this phone. It can't be undone unless you have a backup file.</p>
    <button class="btn danger block" id="w-yes">Erase everything</button>
    <button class="btn ghost block" id="w-no">Cancel</button>
  `, 'Erase all data');
  sheet.querySelector('#w-no').addEventListener('click', closeSheet);
  sheet.querySelector('#w-yes').addEventListener('click', () => {
    S = store.wipe(); persist(); closeSheet(); ui.date = todayKey(); go('#/today'); toast('All data erased');
  });
}

// ---------------------------------------------------------------- actions

const actions = {
  'day-prev': () => { ui.date = addDays(ui.date, -1); render(); },
  'day-next': () => { if (ui.date < todayKey()) { ui.date = addDays(ui.date, 1); render(); } },
  'day-today': () => { ui.date = todayKey(); render(); },
  'hide-install': () => { S.settings.hideInstallTip = true; persist(); render(); },
  'snooze-backup': () => { S.settings.backupSnooze = Date.now(); persist(); render(); },
  entry: (el) => {
    const e = entriesFor(ui.date).find((x) => x.id === el.dataset.id);
    if (!e) return;
    const food = e.foodId && S.foods[e.foodId];
    if (food) openServing(food, e); else openQuickEdit(e);
  },
  meal: (el) => {
    ui.meal = el.dataset.meal;
    view.querySelectorAll('[data-action="meal"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },
  pick: (el) => { const f = ui.pool[el.dataset.id] || S.foods[el.dataset.id]; if (f) pickFood(f); },
  custom: () => openCustom({ name: ui.q.trim() }),
  scan: () => openScanner(),
  voice: () => openVoice(),
  range: (el) => { ui.range = el.dataset.range; render(); },
  'open-day': (el) => { ui.date = el.dataset.k; go('#/today'); },
  export: () => doExport(),
  wipe: () => confirmWipe(),
  'force-update': () => forceUpdate()
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

window.addEventListener('hashchange', () => { closeSheet(); closeScanner(); render(); window.scrollTo(0, 0); });

// If the app was left open past midnight, move "today" forward.
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayKey();
  if (t !== lastToday) {
    if (ui.date === lastToday) ui.date = t;
    lastToday = t;
    ui.meal = defaultMeal();
    render();
  }
});

// ---------------------------------------------------------------- no pinch zoom

// iPhone Safari ignores "user-scalable=no" in some cases, so block its pinch gestures directly.
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- start

render();
store.requestPersistence();
// ---------------------------------------------------------------- updates

// Clears the saved app files (never your food log) and reloads the newest version.
async function forceUpdate() {
  toast('Checking for updates…');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('calorie-tracker-')).map((k) => caches.delete(k)));
    }
  } catch (e) { console.warn(e); }
  location.replace(location.pathname + '?v=' + Date.now() + '#/today');
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Look for a new version each time the app comes to the front.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker not registered', e));
  // When a new version takes over, reload once so it's used right away (not mid-task).
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // first install: nothing to swap
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || sheetRoot.firstChild || scanner) return;
    reloading = true;
    location.reload();
  });
}
// Drop the one-time ?v= marker left by "Check for updates".
if (location.search.includes('v=')) history.replaceState(null, '', location.pathname + location.hash);
