// store.js — the ONLY place the app reads or writes saved data.
// Everything is kept on this device in localStorage under one key.
// To move to Firestore (or anything else) later, replace load() and save()
// here; the rest of the app only talks to these functions.

const KEY = 'calorieTracker.v1';

export const DEFAULT_SETTINGS = {
  goals: { kcal: 2000, protein: 130, carbs: 220, fat: 65 },
  usdaKey: '',
  name: ''
};

function emptyState() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    // days: { 'YYYY-MM-DD': [entry, ...] }
    // entry: { id, meal, name, detail, kcal, protein, carbs, fat, foodId, at }
    days: {},
    // foods: { id: food } — foods you've used or created, for instant search
    // food: { id, name, brand, source, per100: {kcal,protein,carbs,fat} | null,
    //         serving: { label, grams, kcal, protein, carbs, fat } | null,
    //         barcode, uses, lastUsed }
    foods: {}
  };
}

function normalize(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  return {
    version: 1,
    settings: {
      ...base.settings,
      ...(s.settings || {}),
      goals: { ...base.settings.goals, ...((s.settings && s.settings.goals) || {}) }
    },
    days: s.days && typeof s.days === 'object' ? s.days : {},
    foods: s.foods && typeof s.foods === 'object' ? s.foods : {}
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.warn('Could not read saved data', e);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Could not save data', e);
    return false;
  }
}

// Ask the browser not to clear our data under storage pressure (best effort).
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}

// Backups never include the USDA key, so a backup file is safe to share or store anywhere.
export function exportJSON(state) {
  const settings = { ...state.settings };
  delete settings.usdaKey;
  return JSON.stringify({ app: 'calorie-tracker', exportedAt: new Date().toISOString(), ...state, settings }, null, 2);
}

// Restoring keeps the key already saved on this phone.
export function importJSON(text, currentKey = '') {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || (!parsed.days && !parsed.foods)) {
    throw new Error('This file does not look like a Calorie Tracker backup.');
  }
  const next = normalize(parsed);
  next.settings.usdaKey = currentKey || '';
  return next;
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return emptyState();
}
