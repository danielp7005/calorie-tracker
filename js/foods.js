// foods.js — food lookups: your own saved foods, USDA FoodData Central search,
// and Open Food Facts barcode lookup. Every result is turned into one "food" shape:
// { id, name, brand, source, per100, perServing, measures, barcode }
//   per100:     nutrition per 100 g (or null)
//   perServing: { label, kcal, protein, carbs, fat } for foods with no gram basis (or null)
//   measures:   [{ label, grams }] handy portions for per100 foods

const USDA_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function titleCase(s) {
  if (!s) return '';
  // USDA names are often ALL CAPS for branded foods
  if (s === s.toUpperCase()) {
    return s.toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Your foods ----------

export function searchLocal(foods, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  return Object.values(foods)
    .filter((f) => {
      const hay = (f.name + ' ' + (f.brand || '')).toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (b.uses || 0) - (a.uses || 0))
    .slice(0, limit);
}

export function recentFoods(foods, limit = 20) {
  return Object.values(foods)
    .filter((f) => f.lastUsed)
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    .slice(0, limit);
}

// ---------- USDA FoodData Central ----------

function nutrientValue(list, ids, kcalOnly) {
  for (const n of list) {
    const id = n.nutrientId;
    const unit = (n.unitName || '').toUpperCase();
    if (ids.includes(id) && (!kcalOnly || unit === 'KCAL')) return Number(n.value) || 0;
  }
  return null;
}

function fromUSDA(item) {
  const list = item.foodNutrients || [];
  let kcal = nutrientValue(list, [1008], true);
  if (kcal === null) kcal = nutrientValue(list, [2047, 2048], true);
  if (kcal === null) {
    const kj = nutrientValue(list, [1062], false);
    if (kj !== null) kcal = kj / 4.184;
  }
  if (kcal === null) return null;

  const per100 = {
    kcal: Math.round(kcal),
    protein: round1(nutrientValue(list, [1003]) || 0),
    carbs: round1(nutrientValue(list, [1005]) || 0),
    fat: round1(nutrientValue(list, [1004]) || 0)
  };

  const measures = [];
  const unit = (item.servingSizeUnit || '').toLowerCase();
  if (item.servingSize && (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt')) {
    const grams = Number(item.servingSize);
    const label = item.householdServingFullText
      ? `${item.householdServingFullText} (${Math.round(grams)} ${unit.startsWith('m') ? 'ml' : 'g'})`
      : `1 serving (${Math.round(grams)} ${unit.startsWith('m') ? 'ml' : 'g'})`;
    measures.push({ label, grams });
  }
  for (const m of item.foodMeasures || []) {
    if (!m.gramWeight || !m.disseminationText || /quantity not specified/i.test(m.disseminationText)) continue;
    if (measures.length >= 5) break;
    measures.push({ label: `${m.disseminationText} (${Math.round(m.gramWeight)} g)`, grams: Number(m.gramWeight) });
  }

  return {
    id: 'usda:' + item.fdcId,
    name: titleCase(item.description || 'Food'),
    brand: titleCase(item.brandName || item.brandOwner || ''),
    source: 'usda',
    branded: item.dataType === 'Branded',
    per100,
    perServing: null,
    measures,
    barcode: item.gtinUpc || ''
  };
}

export async function searchUSDA(query, apiKey, signal) {
  // Keep the request to the documented basics (key, query, page size).
  // Data types are filtered here instead of in the request.
  const params = new URLSearchParams({
    api_key: (apiKey || '').trim() || 'DEMO_KEY',
    query,
    pageSize: '50'
  });
  const res = await fetch(`${USDA_URL}?${params}`, { signal });
  if (res.status === 429) throw new Error('Search limit reached. Add your free USDA key in Settings, or try again in an hour.');
  if (res.status === 403 || res.status === 401) throw new Error('The USDA key was not accepted. Check it in Settings.');
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 120); } catch (e) { /* ignore */ }
    throw new Error('Food search is unavailable right now (' + res.status + ').' + (detail ? ' ' + detail : ''));
  }
  const data = await res.json();
  const keep = new Set(['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded']);
  const foods = (data.foods || [])
    .filter((item) => !item.dataType || keep.has(item.dataType))
    .map(fromUSDA)
    .filter(Boolean)
    .slice(0, 30);
  // Generic foods (banana, rice) before branded products
  const generic = foods.filter((f) => !f.branded);
  const branded = foods.filter((f) => f.branded);
  return [...generic, ...branded];
}

// ---------- Open Food Facts (barcodes) ----------

export async function lookupBarcode(code, signal) {
  const clean = String(code).replace(/\D/g, '');
  if (!clean) throw new Error('That barcode is empty.');
  const fields = 'code,product_name,brands,nutriments,serving_size,serving_quantity,quantity';
  const res = await fetch(`${OFF_URL}${clean}.json?fields=${fields}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Barcode lookup is unavailable right now (' + res.status + ').');
  const data = await res.json();
  if (!data || data.status !== 1 || !data.product) return null;
  const p = data.product;
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal === undefined && n['energy_100g'] !== undefined) kcal = n['energy_100g'] / 4.184;
  if (kcal === undefined || kcal === null || kcal === '') return { incomplete: true, barcode: clean, name: p.product_name || '' };

  const measures = [];
  const sq = Number(p.serving_quantity);
  if (sq > 0) {
    const ss = (p.serving_size || '').trim();
    const label = ss && /\d\s*(g|ml)\b/i.test(ss) ? `1 serving (${ss})` : `1 serving (${Math.round(sq)} g)`;
    measures.push({ label, grams: sq });
  }

  return {
    id: 'off:' + clean,
    name: titleCase(p.product_name || 'Scanned product'),
    brand: (p.brands || '').split(',')[0].trim(),
    source: 'off',
    per100: {
      kcal: Math.round(Number(kcal)),
      protein: round1(n['proteins_100g']),
      carbs: round1(n['carbohydrates_100g']),
      fat: round1(n['fat_100g'])
    },
    perServing: null,
    measures,
    barcode: clean
  };
}

// ---------- Portions ----------

// Units offered in the serving picker for a food.
export function unitsFor(food) {
  if (food.perServing) {
    return [{ label: food.perServing.label || 'serving', kind: 'serving' }];
  }
  const units = (food.measures || []).map((m) => ({ label: m.label, kind: 'measure', grams: m.grams }));
  units.push({ label: 'grams', kind: 'grams', grams: 1 });
  return units;
}

// Nutrition for `qty` of unit `unit` of `food`.
export function nutritionFor(food, qty, unit) {
  const q = Math.max(0, Number(qty) || 0);
  if (food.perServing) {
    const s = food.perServing;
    return {
      kcal: Math.round(s.kcal * q),
      protein: round1(s.protein * q),
      carbs: round1(s.carbs * q),
      fat: round1(s.fat * q)
    };
  }
  const grams = q * (unit.grams || 1);
  const p = food.per100;
  return {
    kcal: Math.round((p.kcal * grams) / 100),
    protein: round1((p.protein * grams) / 100),
    carbs: round1((p.carbs * grams) / 100),
    fat: round1((p.fat * grams) / 100)
  };
}

export function describeAmount(qty, unit) {
  const q = Number(qty);
  const qs = Number.isInteger(q) ? String(q) : String(round1(q));
  if (unit.kind === 'grams') return `${qs} g`;
  if (unit.kind === 'serving') return q === 1 ? unit.label : `${qs} × ${unit.label}`;
  // measure labels look like "1 cup (240 g)" — show "2 × 1 cup" style when q ≠ 1
  const short = unit.label.replace(/\s*\([^)]*\)\s*$/, '');
  return q === 1 ? short : `${qs} × ${short}`;
}
