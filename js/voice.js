// voice.js — turns a spoken or typed description like
// "spinach about two cups, half an avocado, six cherry tomatoes and an ounce of feta"
// into separate items with amounts, then helps match each to a food and a portion.
// No AI and no cost: plain text rules plus the USDA database.

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20,
  dozen: 12
};

// Units we recognise, mapped to a canonical name.
const UNIT_WORDS = {
  cup: 'cup', cups: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  gram: 'g', grams: 'g', g: 'g', gr: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  handful: 'handful', handfuls: 'handful',
  scoop: 'scoop', scoops: 'scoop',
  serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving',
  bowl: 'bowl', bowls: 'bowl',
  can: 'can', cans: 'can',
  glass: 'glass', glasses: 'glass',
  clove: 'clove', cloves: 'clove',
  stalk: 'stalk', stalks: 'stalk',
  leaf: 'leaf', leaves: 'leaf'
};
const SIZE_WORDS = { large: 'large', big: 'large', medium: 'medium', small: 'small', jumbo: 'jumbo' };

// Phrases that contain "and"/"with" but are one food.
const COMPOUNDS = [
  'mac and cheese', 'macaroni and cheese', 'salt and pepper', 'peanut butter and jelly',
  'fish and chips', 'rice and beans', 'bread and butter', 'sweet and sour', 'half and half',
  'chips and salsa', 'chicken and rice', 'biscuits and gravy', 'pb and j', 'cookies and cream',
  'sour cream and onion', 'oil and vinegar', 'franks and beans'
];

const FILLER = /\b(i had|i ate|i've had|i have had|i'm having|i am having|for (breakfast|lunch|dinner|a snack|snack)|about|around|roughly|approximately|approx|like|maybe|probably|some|just|also|then|um+|uh+|a bit of|a little bit of|a little|little|of|the|my|kind|sort|ish|or so)\b/g;

function fracToNumber(s) {
  return s
    .replace(/½/g, ' 0.5').replace(/¼/g, ' 0.25').replace(/¾/g, ' 0.75').replace(/⅓/g, ' 0.33').replace(/⅔/g, ' 0.67')
    .replace(/(\d+)\s+(\d+)\/(\d+)/g, (m, w, n, d) => String(Number(w) + Number(n) / Number(d)))
    .replace(/(\d+)\/(\d+)/g, (m, n, d) => String(Math.round((Number(n) / Number(d)) * 100) / 100))
    .replace(/(\d+)\s+0\.(\d+)/g, (m, w, f) => String(Number(w) + Number('0.' + f)));
}

function wordsToNumbers(s) {
  let t = s;
  // "one and a half" / "two and a half"
  t = t.replace(/\b(\w+) and a half\b/g, (m, w) => {
    const n = NUMBER_WORDS[w] ?? (Number(w) || null);
    return n !== null ? String(n + 0.5) : m;
  });
  t = t.replace(/\b(a|one) half( of)?( a| an)?\b/g, ' 0.5 ');
  t = t.replace(/\bhalf( of)?( a| an)\b/g, ' 0.5 ');
  t = t.replace(/\bhalf\b/g, ' 0.5 ');
  t = t.replace(/\b(a|one) quarter( of)?( a| an)?\b/g, ' 0.25 ');
  t = t.replace(/\bquarter( of)?( a| an)\b/g, ' 0.25 ');
  t = t.replace(/\bthree quarters?( of)?( a| an)?\b/g, ' 0.75 ');
  t = t.replace(/\ba third( of)?( a| an)?\b/g, ' 0.33 ');
  t = t.replace(/\ba couple( of)?\b/g, ' 2 ');
  t = t.replace(/\ba few\b/g, ' 3 ');
  t = t.replace(/\ba dozen\b/g, ' 12 ');
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty|dozen)\b/g, (m) => String(NUMBER_WORDS[m]));
  return t;
}

const unitAlt = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
const sizeAlt = Object.keys(SIZE_WORDS).join('|');

function parseChunk(raw) {
  let t = ' ' + raw.toLowerCase() + ' ';
  t = t.replace(/[^\w\s.'-]/g, ' ');
  // "a"/"an" right before a unit or size or at the start means 1
  t = t.replace(new RegExp(`\\b(a|an)\\s+(?=(${unitAlt}|${sizeAlt})\\b)`, 'g'), ' 1 ');
  t = t.replace(FILLER, ' ');
  t = t.replace(/^\s*(a|an)\s+/, ' 1 ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  let qty = null;
  let unit = null;
  let size = null;

  // number followed by a unit: "2 cups", "1.5 oz", "200g"
  const nu = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitAlt})\\b`));
  if (nu) {
    qty = Number(nu[1]);
    unit = UNIT_WORDS[nu[2]];
    t = t.replace(nu[0], ' ');
  } else {
    const n = t.match(/(\d+(?:\.\d+)?)/);
    if (n) { qty = Number(n[1]); t = t.replace(n[0], ' '); }
    const u = t.match(new RegExp(`\\b(${unitAlt})\\b`));
    if (u) { unit = UNIT_WORDS[u[1]]; t = t.replace(new RegExp(`\\b${u[1]}\\b`), ' '); }
  }
  const sz = t.match(new RegExp(`\\b(${sizeAlt})\\b`));
  if (sz) { size = SIZE_WORDS[sz[1]]; t = t.replace(new RegExp(`\\b${sz[1]}\\b`), ' '); }

  const name = t.replace(/[-.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^((a|an|and|with|plus)\s+)+/, '').replace(/(\s+(and|with|plus|a|an))+$/, '');
  if (!name || name.length < 2) return null;
  return { raw: raw.trim(), name, qty, unit, size };
}

export function parseFoodText(text) {
  let t = ' ' + fracToNumber(String(text || '').toLowerCase()) + ' ';
  t = wordsToNumbers(t);
  COMPOUNDS.forEach((c, i) => { t = t.split(c).join(`compound${i}x`); });
  const chunks = t
    .split(/,|;|\n|\.\s|\band then\b|\band also\b|\band\b|\bplus\b|\bwith\b|\balong with\b|\bon top\b|\btopped\b/)
    .map((c) => c.replace(/compound(\d+)x/g, (m, i) => COMPOUNDS[Number(i)]).trim())
    .filter(Boolean);
  return chunks.map(parseChunk).filter(Boolean);
}

// ---------- matching ----------

function stem(w) {
  return w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/(oes|es|s)$/, (m) => (m === 'oes' ? 'o' : '')) : w;
}
function wordsOf(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem);
}

const AVOID = ['babyfood', 'baby', 'infant', 'toddler', 'formula', 'powder', 'dehydrated', 'dried', 'frozen', 'canned', 'imitation', 'substitute', 'industrial', 'supplement'];

// True when every word of the spoken name appears in the food's name.
export function matchesAll(food, name) {
  const have = wordsOf(food.name + ' ' + (food.brand || ''));
  return wordsOf(name).every((w) => have.includes(w));
}

// Rank candidate foods for a spoken name; best first.
export function rankMatches(foods, name) {
  const want = wordsOf(name);
  return foods
    .map((f) => {
      const have = wordsOf(f.name + ' ' + (f.brand || ''));
      const hits = want.filter((w) => have.includes(w)).length;
      let score = hits * 10 - have.length * 0.6;
      if (hits === want.length) score += 6;
      if (have[0] && want.includes(have[0])) score += 3;
      if (!f.branded) score += 5;
      if (have.includes('raw') && !want.some((w) => ['cooked', 'fried', 'grilled', 'baked', 'roasted', 'boiled', 'steamed'].includes(w))) score += 2;
      for (const a of AVOID) if (have.includes(a) && !want.includes(a)) score -= 8;
      return { f, score, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.f);
}

// ---------- amounts ----------

const VOLUME_IN_TSP = { tsp: 1, tbsp: 3, cup: 48 };
const UNIT_LABEL_WORDS = {
  cup: ['cup', 'cups'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
  tsp: ['tsp', 'teaspoon', 'teaspoons']
};
const NON_COUNT = /\b(cup|cups|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|fl|lb|pounds?|grams?|ml)\b/;

function measureAmount(label) {
  const m = String(label).match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 1;
}
function labelHas(label, words) {
  const l = String(label).toLowerCase().replace(/\([^)]*\)\s*$/, '');
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(l));
}

// Choose unit + quantity in the food's unit list (from foods.unitsFor) for a parsed item.
// Returns { unitIdx, qty, estimated }.
export function resolveAmount(units, parsed) {
  const gramsIdx = units.findIndex((u) => u.kind === 'grams');
  const servingIdx = units.findIndex((u) => u.kind === 'serving');
  const measures = units.map((u, i) => ({ ...u, i })).filter((u) => u.kind === 'measure');
  const q = parsed.qty ?? 1;

  if (servingIdx >= 0) return { unitIdx: servingIdx, qty: q, estimated: parsed.qty === null };

  if (parsed.unit === 'oz') {
    const ozM = measures.find((m) => labelHas(m.label, ['oz', 'ounce']) && !labelHas(m.label, ['fl']));
    if (ozM) return { unitIdx: ozM.i, qty: round2(q / measureAmount(ozM.label)), estimated: false };
  }
  const toGrams = { g: 1, kg: 1000, oz: 28.35, lb: 453.6, ml: 1 };
  if (parsed.unit && toGrams[parsed.unit] && gramsIdx >= 0) {
    return { unitIdx: gramsIdx, qty: Math.round(q * toGrams[parsed.unit]), estimated: parsed.unit === 'ml' };
  }

  if (parsed.unit && VOLUME_IN_TSP[parsed.unit]) {
    const same = measures.find((m) => labelHas(m.label, UNIT_LABEL_WORDS[parsed.unit]));
    if (same) return { unitIdx: same.i, qty: round2(q / measureAmount(same.label)), estimated: false };
    for (const other of ['cup', 'tbsp', 'tsp']) {
      const m = measures.find((x) => labelHas(x.label, UNIT_LABEL_WORDS[other]));
      if (m) {
        const gramsPerTsp = m.grams / (measureAmount(m.label) * VOLUME_IN_TSP[other]);
        return { unitIdx: gramsIdx, qty: Math.round(q * VOLUME_IN_TSP[parsed.unit] * gramsPerTsp), estimated: false };
      }
    }
  }

  if (parsed.unit === 'handful' && gramsIdx >= 0) return { unitIdx: gramsIdx, qty: Math.round(q * 30), estimated: true };

  // Count words: "2 slices", "3 large", "6 cherry tomatoes", "half an avocado"
  const wanted = [parsed.unit, parsed.size].filter(Boolean);
  if (wanted.length) {
    const m = measures.find((x) => labelHas(x.label, wanted.flatMap((w) => [w, w + 's', w + 'es'])));
    if (m) return { unitIdx: m.i, qty: round2(q / measureAmount(m.label)), estimated: false };
  }
  const natural = measures.find((x) => !NON_COUNT.test(x.label.toLowerCase().replace(/\([^)]*\)\s*$/, '')));
  if (natural) return { unitIdx: natural.i, qty: round2(q / measureAmount(natural.label)), estimated: parsed.qty === null };
  if (measures.length) return { unitIdx: measures[0].i, qty: q, estimated: true };
  return { unitIdx: gramsIdx >= 0 ? gramsIdx : 0, qty: gramsIdx >= 0 ? Math.round(100 * q) : q, estimated: true };
}

function round2(n) { return Math.round(n * 100) / 100; }
