export const DAY_MS = 86_400_000;
export const APP_SCHEMA_VERSION = 6;
export const DEFAULT_DOB = "2026-01-08";
export const FIXED_MEALS_PER_DAY = 2;

export const DEFAULT_FEEDING_BANDS = [
  { id: "under3", label: "Under 3 months", minMonths: 0, maxMonths: 3, percent: 8 },
  { id: "3to6", label: "3 to 6 months", minMonths: 3, maxMonths: 6, percent: 6 },
  { id: "6to9", label: "6 to 9 months", minMonths: 6, maxMonths: 9, percent: 4 },
  { id: "9to12", label: "9 to 12 months", minMonths: 9, maxMonths: 12, percent: 3 },
  { id: "12plus", label: "12 months and over", minMonths: 12, maxMonths: 99, percent: 2.5 }
];

const MODEL_PRIORS = {
  maturity: 1.15,
  logistic: 1,
  gompertz: 1,
  quadratic: 0.85,
  recent: 0.7
};

export function parseIso(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function iso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0);
}

export function daysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return 0;
  const ta = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12).getTime();
  const tb = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12).getTime();
  return Math.round((tb - ta) / DAY_MS);
}

export function ageDaysOn(dateIso, dobIso = DEFAULT_DOB) {
  const date = parseIso(dateIso);
  const dob = parseIso(dobIso);
  if (!date || !dob) return null;
  return Math.max(0, daysBetween(dob, date));
}

export function ageParts(ageDays) {
  const days = Math.max(0, Math.round(Number(ageDays) || 0));
  const totalMonths = Math.floor(days / 30.4375);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  return { days, weeks, remainingDays, totalMonths, years, months };
}

export function exactAgeLabel(ageDays) {
  const p = ageParts(ageDays);
  if (p.years > 0) return `${p.years}y ${p.months}m`;
  if (p.totalMonths >= 2) return `${p.totalMonths} months`;
  return `${p.weeks}w ${p.remainingDays}d`;
}

export function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * factor) / factor : null;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

export function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function quantile(values, q) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const position = (clean.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(position);
  const remainder = position - base;
  return clean[base + 1] == null ? clean[base] : clean[base] + remainder * (clean[base + 1] - clean[base]);
}

export function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = mean(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (clean.length - 1));
}

export function weightedMedian(items) {
  const clean = items
    .filter(item => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!clean.length) return null;
  const total = clean.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of clean) {
    cumulative += item.weight;
    if (cumulative >= total / 2) return item.value;
  }
  return clean.at(-1).value;
}

export function normaliseEntries(rawEntries, dobIso = DEFAULT_DOB) {
  const dob = parseIso(dobIso) || parseIso(DEFAULT_DOB);
  const byDate = new Map();
  for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
    const date = parseIso(raw?.date);
    const weightKg = Number(raw?.weightKg);
    if (!date || date < dob || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 150) continue;
    const entry = {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
      date: iso(date),
      weightKg: round(weightKg, 1),
      notes: typeof raw.notes === "string" ? raw.notes.slice(0, 500) : "",
      excluded: Boolean(raw.excluded),
      confirmed: Boolean(raw.confirmed),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
    };
    byDate.set(entry.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function withAges(entries, dobIso = DEFAULT_DOB, includeExcluded = false) {
  return normaliseEntries(entries, dobIso)
    .filter(entry => includeExcluded || !entry.excluded)
    .map(entry => ({ ...entry, ageDays: ageDaysOn(entry.date, dobIso) }));
}

export function growthPercent(ageDays) {
  const days = Math.max(0, Number(ageDays) || 0);
  const weeks = Math.max(days / 7, 0.1);
  const atEightWeeks = clamp((36.61 * Math.log(8) - 62.39) / 100, 0.08, 0.45);
  if (weeks < 8) {
    const birth = 0.012;
    return birth + (atEightWeeks - birth) * (weeks / 8) ** 1.35;
  }
  if (days <= 365) return clamp((36.61 * Math.log(weeks) - 62.39) / 100, atEightWeeks, 0.92);
  const p365 = clamp((36.61 * Math.log(365 / 7) - 62.39) / 100, 0.86, 0.94);
  return clamp(1 - (1 - p365) * Math.exp(-(days - 365) / 210), p365, 0.998);
}

export function referenceWeight(ageDays, adultKg = 50) {
  return Math.max(0, Number(adultKg) || 50) * growthPercent(ageDays);
}

export function linearRegression(points) {
  const clean = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 2) return null;
  const xMean = mean(clean.map(point => point.x));
  const yMean = mean(clean.map(point => point.y));
  const denominator = clean.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator === 0) return null;
  const slope = clean.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const residuals = clean.map(point => point.y - (intercept + slope * point.x));
  const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
  return { slope, intercept, rmse, predict: x => intercept + slope * x, residuals };
}

function solve3x3(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j < 4; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j < 4; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[3]);
}

export function quadraticRegression(points) {
  const clean = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 3) return null;
  const xs = clean.map(point => point.x);
  const ys = clean.map(point => point.y);
  const sx = xs.reduce((sum, x) => sum + x, 0);
  const sx2 = xs.reduce((sum, x) => sum + x ** 2, 0);
  const sx3 = xs.reduce((sum, x) => sum + x ** 3, 0);
  const sx4 = xs.reduce((sum, x) => sum + x ** 4, 0);
  const sy = ys.reduce((sum, y) => sum + y, 0);
  const sxy = clean.reduce((sum, point) => sum + point.x * point.y, 0);
  const sx2y = clean.reduce((sum, point) => sum + point.x ** 2 * point.y, 0);
  const coefficients = solve3x3(
    [[clean.length, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]],
    [sy, sxy, sx2y]
  );
  if (!coefficients) return null;
  const [a, b, c] = coefficients;
  const predict = x => a + b * x + c * x ** 2;
  const residuals = clean.map(point => point.y - predict(point.x));
  const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
  return { a, b, c, rmse, residuals, predict };
}

function fitAsymptoticModel(points, type, referenceAdultKg = 50) {
  if (points.length < 4) return null;
  const latest = points.at(-1);
  const maxWeight = Math.max(...points.map(point => point.weightKg));
  const minimumAdult = Math.max(maxWeight + 0.5, referenceAdultKg * 0.78);
  const maximumAdult = Math.min(100, Math.max(minimumAdult + 15, referenceAdultKg * 1.8, maxWeight * 1.7));
  let best = null;
  for (let adult = Math.ceil(minimumAdult * 2) / 2; adult <= maximumAdult; adult += 0.5) {
    const transformed = [];
    let valid = true;
    for (const point of points) {
      const ratio = point.weightKg / adult;
      if (!(ratio > 0 && ratio < 0.995)) { valid = false; break; }
      const y = type === "logistic"
        ? Math.log(adult / point.weightKg - 1)
        : Math.log(-Math.log(ratio));
      if (!Number.isFinite(y)) { valid = false; break; }
      transformed.push({ x: point.ageDays, y });
    }
    if (!valid) continue;
    const regression = linearRegression(transformed);
    if (!regression || regression.slope >= -0.00005) continue;
    const predict = ageDays => {
      const z = regression.intercept + regression.slope * ageDays;
      return type === "logistic"
        ? adult / (1 + Math.exp(z))
        : adult * Math.exp(-Math.exp(z));
    };
    const residuals = points.map(point => point.weightKg - predict(point.ageDays));
    const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
    const latestPenalty = Math.abs(predict(latest.ageDays) - latest.weightKg) * 0.15;
    const adultPenalty = Math.max(0, adult - 82) * 0.03;
    const score = rmse + latestPenalty + adultPenalty;
    if (!best || score < best.score) best = { type, adultKg: adult, rmse, score, predict, residuals };
  }
  return best;
}

function buildMaturityModel(points, referenceAdultKg = 50) {
  if (!points.length) return null;
  const recent = points.slice(-8);
  const weighted = recent.map((point, index) => {
    const maturity = Math.max(0.05, growthPercent(point.ageDays));
    const adult = point.weightKg / maturity;
    const recency = 0.5 + (index + 1) / recent.length;
    const ageWeight = 0.55 + maturity;
    return { value: adult, weight: recency * ageWeight };
  }).filter(item => item.value > 20 && item.value < 100);
  const adultKg = weightedMedian(weighted) || referenceAdultKg;
  const predict = ageDays => adultKg * growthPercent(ageDays);
  const residuals = points.map(point => point.weightKg - predict(point.ageDays));
  const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
  return { type: "maturity", adultKg, rmse, predict, residuals };
}

function buildQuadraticModel(points, referenceAdultKg = 50) {
  if (points.length < 4) return null;
  const latest = points.at(-1);
  const subset = points.slice(-10);
  const origin = subset[0].ageDays;
  const regression = quadraticRegression(subset.map(point => ({ x: (point.ageDays - origin) / 7, y: point.weightKg })));
  if (!regression) return null;
  const rawPredict = ageDays => regression.predict((ageDays - origin) / 7);
  const candidateAdult = rawPredict(730);
  const sensibleAdult = clamp(candidateAdult, latest.weightKg, Math.max(95, referenceAdultKg * 1.8));
  const predict = ageDays => {
    const raw = rawPredict(ageDays);
    if (ageDays <= latest.ageDays + 84) return clamp(raw, latest.weightKg - 2, sensibleAdult);
    const at12Weeks = clamp(rawPredict(latest.ageDays + 84), latest.weightKg, sensibleAdult);
    const remaining = Math.max(0, sensibleAdult - at12Weeks);
    return clamp(at12Weeks + remaining * (1 - Math.exp(-(ageDays - latest.ageDays - 84) / 220)), latest.weightKg, sensibleAdult);
  };
  const residuals = subset.map(point => point.weightKg - predict(point.ageDays));
  const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
  return { type: "quadratic", adultKg: sensibleAdult, rmse, predict, residuals };
}

function buildRecentModel(points, referenceAdultKg = 50) {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const subset = points.slice(-6);
  const regression = linearRegression(subset.map(point => ({ x: point.ageDays / 7, y: point.weightKg })));
  if (!regression) return null;
  const weeklySlope = Math.max(-0.15, regression.slope);
  const ageFactor = clamp(1 - latest.ageDays / 760, 0.08, 0.8);
  const decayWeeks = 20 + 38 * ageFactor;
  const remaining = Math.max(0, weeklySlope) * decayWeeks;
  const adultKg = clamp(latest.weightKg + remaining, latest.weightKg, Math.max(95, referenceAdultKg * 1.8));
  const predict = ageDays => {
    if (ageDays <= latest.ageDays) return regression.predict(ageDays / 7);
    const weeksAhead = (ageDays - latest.ageDays) / 7;
    return clamp(latest.weightKg + remaining * (1 - Math.exp(-weeksAhead / decayWeeks)), 0, adultKg);
  };
  const residuals = subset.map(point => point.weightKg - predict(point.ageDays));
  const rmse = Math.sqrt(mean(residuals.map(value => value ** 2)) || 0);
  return { type: "recent", adultKg, rmse, predict, residuals, weeklySlope };
}

export function buildForecastModels(entries, profile = {}) {
  const dobIso = profile.dob || DEFAULT_DOB;
  const referenceAdultKg = Number(profile.referenceAdultKg) || 50;
  const points = withAges(entries, dobIso).filter(point => Number.isFinite(point.ageDays));
  if (!points.length) return [];
  const models = [
    buildMaturityModel(points, referenceAdultKg),
    fitAsymptoticModel(points, "logistic", referenceAdultKg),
    fitAsymptoticModel(points, "gompertz", referenceAdultKg),
    buildQuadraticModel(points, referenceAdultKg),
    buildRecentModel(points, referenceAdultKg)
  ].filter(Boolean);
  return models.map(model => ({
    ...model,
    adultKg: clamp(model.adultKg, points.at(-1).weightKg, 100),
    predict: ageDays => clamp(model.predict(ageDays), 0, 100)
  }));
}

function findActualNear(points, targetAgeDays, toleranceDays = 10) {
  let best = null;
  for (const point of points) {
    const gap = Math.abs(point.ageDays - targetAgeDays);
    if (gap <= toleranceDays && (!best || gap < best.gap)) best = { point, gap };
  }
  return best?.point || null;
}

export function backtestForecastModels(entries, profile = {}) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  const horizons = [28, 56, 84];
  const records = [];
  if (points.length < 4) return { records, byModel: {}, byHorizon: {}, overallMae: null, bias: null };
  for (let cutoffIndex = 2; cutoffIndex < points.length - 1; cutoffIndex += 1) {
    const training = points.slice(0, cutoffIndex + 1);
    const cutoffAge = training.at(-1).ageDays;
    const models = buildForecastModels(training, profile);
    for (const horizonDays of horizons) {
      const actual = findActualNear(points.slice(cutoffIndex + 1), cutoffAge + horizonDays, 12);
      if (!actual) continue;
      for (const model of models) {
        const predicted = model.predict(actual.ageDays);
        if (!Number.isFinite(predicted)) continue;
        records.push({
          model: model.type,
          horizonDays,
          cutoffDate: training.at(-1).date,
          targetDate: actual.date,
          predictedKg: predicted,
          actualKg: actual.weightKg,
          errorKg: predicted - actual.weightKg,
          absoluteErrorKg: Math.abs(predicted - actual.weightKg)
        });
      }
    }
  }
  const byModel = {};
  for (const name of Object.keys(MODEL_PRIORS)) {
    const rows = records.filter(record => record.model === name);
    if (!rows.length) continue;
    byModel[name] = {
      count: rows.length,
      mae: mean(rows.map(row => row.absoluteErrorKg)),
      bias: mean(rows.map(row => row.errorKg)),
      fourWeekMae: mean(rows.filter(row => row.horizonDays === 28).map(row => row.absoluteErrorKg)),
      eightWeekMae: mean(rows.filter(row => row.horizonDays === 56).map(row => row.absoluteErrorKg)),
      twelveWeekMae: mean(rows.filter(row => row.horizonDays === 84).map(row => row.absoluteErrorKg))
    };
  }
  const byHorizon = {};
  for (const horizonDays of horizons) {
    const rows = records.filter(record => record.horizonDays === horizonDays);
    byHorizon[horizonDays] = rows.length ? {
      count: rows.length,
      mae: mean(rows.map(row => row.absoluteErrorKg)),
      bias: mean(rows.map(row => row.errorKg))
    } : null;
  }
  return {
    records,
    byModel,
    byHorizon,
    overallMae: records.length ? mean(records.map(row => row.absoluteErrorKg)) : null,
    bias: records.length ? mean(records.map(row => row.errorKg)) : null
  };
}

export function modelWeights(models, backtest) {
  const raw = models.map(model => {
    const history = backtest?.byModel?.[model.type];
    const mae = history?.mae ?? Math.max(0.75, model.rmse || 1.5);
    const countBoost = history ? clamp(0.8 + history.count / 12, 0.8, 1.35) : 0.8;
    const prior = MODEL_PRIORS[model.type] || 0.8;
    return { name: model.type, value: prior * countBoost / (mae + 0.65) ** 2 };
  });
  const total = raw.reduce((sum, item) => sum + item.value, 0) || 1;
  return Object.fromEntries(raw.map(item => [item.name, item.value / total]));
}

function seedFromText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function normalRandom(random) {
  const u = Math.max(1e-12, random());
  const v = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function chooseWeighted(models, weights, random) {
  const threshold = random();
  let cumulative = 0;
  for (const model of models) {
    cumulative += weights[model.type] || 0;
    if (threshold <= cumulative) return model;
  }
  return models.at(-1);
}

export function calculateForecast(entries, profile = {}, options = {}) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  if (!points.length) return emptyForecast();
  const models = buildForecastModels(points, profile);
  if (!models.length) return emptyForecast();
  const backtest = options.skipBacktest ? { records: [], byModel: {}, byHorizon: {}, overallMae: null, bias: null } : backtestForecastModels(points, profile);
  const weights = modelWeights(models, backtest);
  const latest = points.at(-1);
  const predictAtAge = ageDays => models.reduce((sum, model) => sum + model.predict(ageDays) * (weights[model.type] || 0), 0);
  const adultCentral = models.reduce((sum, model) => sum + model.adultKg * (weights[model.type] || 0), 0);
  const modelSpread = standardDeviation(models.map(model => model.adultKg));
  const residualNoise = Math.max(
    0.35,
    median(models.map(model => model.rmse)) || 0.8,
    backtest.overallMae || 0
  );
  const random = mulberry32(seedFromText(points.map(point => `${point.date}:${point.weightKg}`).join("|") + JSON.stringify(weights)));
  const iterations = clamp(Number(options.iterations) || 1400, 300, 4000);
  const targetAges = options.targetAges || [latest.ageDays + 28, latest.ageDays + 56, latest.ageDays + 84, 730];
  const simulations = Object.fromEntries(targetAges.map(age => [age, []]));
  const adultSamples = [];
  for (let i = 0; i < iterations; i += 1) {
    const model = chooseWeighted(models, weights, random);
    const adultNoise = normalRandom(random) * Math.max(0.45, residualNoise * 0.75, modelSpread * 0.35);
    adultSamples.push(clamp(model.adultKg + adultNoise, latest.weightKg, 100));
    for (const age of targetAges) {
      const horizonDays = Math.max(0, age - latest.ageDays);
      const horizonScale = 0.65 + Math.sqrt(horizonDays / 28) * 0.38;
      const noise = normalRandom(random) * residualNoise * horizonScale;
      simulations[age].push(clamp(model.predict(age) + noise, 0, 100));
    }
  }
  const distributionAtAge = ageDays => {
    const values = simulations[ageDays] || [];
    return {
      median: quantile(values, 0.5),
      likelyLow: quantile(values, 0.2),
      likelyHigh: quantile(values, 0.8),
      wideLow: quantile(values, 0.05),
      wideHigh: quantile(values, 0.95)
    };
  };
  const adult = {
    median: quantile(adultSamples, 0.5) ?? adultCentral,
    likelyLow: quantile(adultSamples, 0.2),
    likelyHigh: quantile(adultSamples, 0.8),
    wideLow: quantile(adultSamples, 0.05),
    wideHigh: quantile(adultSamples, 0.95)
  };
  const forecastPoints = [];
  const finalAge = Math.max(730, latest.ageDays + 364);
  for (let age = latest.ageDays; age <= finalAge; age += 14) {
    const direct = predictAtAge(age);
    const horizonDays = age - latest.ageDays;
    const spread = residualNoise * (0.65 + Math.sqrt(Math.max(0, horizonDays) / 28) * 0.38) + modelSpread * (horizonDays / Math.max(1, finalAge - latest.ageDays)) * 0.3;
    forecastPoints.push({
      ageDays: age,
      centralKg: direct,
      likelyLowKg: Math.max(latest.weightKg - 0.5, direct - spread),
      likelyHighKg: Math.min(100, direct + spread),
      wideLowKg: Math.max(latest.weightKg - 1, direct - spread * 1.8),
      wideHighKg: Math.min(100, direct + spread * 1.8)
    });
  }
  const stability = options.skipStability ? { label: "Developing", detail: "Stability comparison skipped for this internal calculation.", changeKg: null } : forecastStability(points, profile, adult.median);
  return {
    ready: true,
    latest,
    models: models.map(model => ({
      name: model.type,
      adultKg: model.adultKg,
      rmse: model.rmse,
      weight: weights[model.type] || 0,
      predict: model.predict
    })),
    weights,
    backtest,
    adult,
    distributionAtAge,
    predictAtAge,
    forecastPoints,
    residualNoise,
    modelSpread,
    stability,
    progressPercent: adult.median ? clamp(latest.weightKg / adult.median * 100, 0, 100) : null
  };
}

function emptyForecast() {
  return {
    ready: false,
    latest: null,
    models: [],
    weights: {},
    backtest: { records: [], byModel: {}, byHorizon: {}, overallMae: null, bias: null },
    adult: { median: null, likelyLow: null, likelyHigh: null, wideLow: null, wideHigh: null },
    distributionAtAge: () => ({ median: null, likelyLow: null, likelyHigh: null, wideLow: null, wideHigh: null }),
    predictAtAge: () => null,
    forecastPoints: [],
    residualNoise: null,
    modelSpread: null,
    stability: { label: "Needs more data", detail: "Save a weight to begin forecasting.", changeKg: null },
    progressPercent: null
  };
}

function forecastStability(points, profile, currentAdult) {
  if (points.length < 3) return { label: "Early estimate", detail: "The range will change materially as more weights are added.", changeKg: null };
  const previous = calculateForecast(points.slice(0, -1), profile, { skipBacktest: true, skipStability: true, iterations: 320 });
  if (!previous.ready || !Number.isFinite(previous.adult.median)) return { label: "Developing", detail: "The estimate is beginning to use Reggie’s own trend.", changeKg: null };
  const changeKg = currentAdult - previous.adult.median;
  const absolute = Math.abs(changeKg);
  if (absolute < 0.5 && points.length >= 6) return { label: "Stable", detail: "The central estimate changed by less than 0.5 kg after the latest reading.", changeKg };
  if (absolute < 1.25) return { label: "Becoming stable", detail: "The estimate changed only slightly after the latest reading.", changeKg };
  return { label: "Still moving", detail: "The latest reading materially changed the estimate, so the range remains provisional.", changeKg };
}

export function intervalMetrics(entries, dobIso = DEFAULT_DOB) {
  const points = withAges(entries, dobIso);
  const intervals = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const days = Math.max(1, current.ageDays - previous.ageDays);
    const changeKg = current.weightKg - previous.weightKg;
    intervals.push({
      from: previous,
      to: current,
      days,
      changeKg,
      kgPerWeek: changeKg / days * 7
    });
  }
  const regressionForDays = windowDays => {
    if (!points.length) return null;
    const cutoff = points.at(-1).ageDays - windowDays;
    const subset = points.filter(point => point.ageDays >= cutoff);
    if (subset.length < 2) return null;
    const regression = linearRegression(subset.map(point => ({ x: point.ageDays / 7, y: point.weightKg })));
    return regression ? { kgPerWeek: regression.slope, rmse: regression.rmse, points: subset.length } : null;
  };
  return {
    intervals,
    latest: intervals.at(-1) || null,
    fourWeek: regressionForDays(35),
    eightWeek: regressionForDays(63),
    allTime: points.length >= 2 ? linearRegression(points.map(point => ({ x: point.ageDays / 7, y: point.weightKg }))) : null,
    totalChangeKg: points.length >= 2 ? points.at(-1).weightKg - points[0].weightKg : 0,
    daysCovered: points.length >= 2 ? points.at(-1).ageDays - points[0].ageDays : 0
  };
}

export function detectChangePoint(entries, dobIso = DEFAULT_DOB) {
  const points = withAges(entries, dobIso);
  if (points.length < 6) return { status: "insufficient", label: "Not enough data", detail: "Six or more included readings are needed to detect a sustained change.", currentRate: null, previousRate: null, changePercent: null };
  const windowSize = points.length >= 8 ? 4 : 3;
  const recent = points.slice(-windowSize);
  const previous = points.slice(-(windowSize * 2), -windowSize);
  const recentFit = linearRegression(recent.map(point => ({ x: point.ageDays / 7, y: point.weightKg })));
  const previousFit = linearRegression(previous.map(point => ({ x: point.ageDays / 7, y: point.weightKg })));
  if (!recentFit || !previousFit) return { status: "insufficient", label: "Trend unavailable", detail: "The readings are too close together to assess a change reliably.", currentRate: null, previousRate: null, changePercent: null };
  const currentRate = recentFit.slope;
  const previousRate = previousFit.slope;
  const change = currentRate - previousRate;
  const changePercent = Math.abs(previousRate) > 0.05 ? change / Math.abs(previousRate) * 100 : null;
  const material = Math.abs(change) >= 0.16 && (changePercent == null || Math.abs(changePercent) >= 25);
  if (!material) return {
    status: "steady",
    label: "Broadly steady",
    detail: `The recent underlying rate is close to the preceding period.`,
    currentRate,
    previousRate,
    changePercent
  };
  if (currentRate < 0) return {
    status: "decline",
    label: "Sustained reduction detected",
    detail: "The recent fitted trend is negative across several readings. This is a data observation, not a diagnosis.",
    currentRate,
    previousRate,
    changePercent
  };
  if (currentRate < previousRate) return {
    status: "slowing",
    label: "Growth is slowing",
    detail: "The reduction has persisted across multiple readings rather than appearing in one isolated result.",
    currentRate,
    previousRate,
    changePercent
  };
  return {
    status: "accelerating",
    label: "Growth has accelerated",
    detail: "The recent fitted rate is materially higher than the preceding period.",
    currentRate,
    previousRate,
    changePercent
  };
}

export function checkWeightInput({ dateIso, weightKg, entries, dobIso = DEFAULT_DOB, forecast = null }) {
  const issues = [];
  const weight = Number(weightKg);
  const date = parseIso(dateIso);
  const dob = parseIso(dobIso);
  const normalised = normaliseEntries(entries, dobIso);
  const included = normalised.filter(entry => !entry.excluded);
  const latest = included.at(-1);
  if (!date || !dob || date < dob) issues.push({ severity: "error", code: "date", message: "The date cannot be before Reggie’s date of birth." });
  if (!Number.isFinite(weight) || weight <= 0) issues.push({ severity: "error", code: "invalid", message: "Enter a valid weight in kilograms." });
  if (weight > 150) issues.push({ severity: "error", code: "impossible", message: "That value is outside the permitted range." });
  const duplicate = normalised.find(entry => entry.date === dateIso);
  if (duplicate) issues.push({ severity: "info", code: "duplicate", message: "A reading already exists on this date. Saving will update it." });
  if (latest && Number.isFinite(weight) && weight > 0) {
    const convertedLb = weight / 2.2046226218;
    if (weight > latest.weightKg * 1.65 && Math.abs(convertedLb - latest.weightKg) <= Math.max(2.5, latest.weightKg * 0.12)) {
      issues.push({ severity: "warning", code: "pounds", suggestionKg: round(convertedLb, 1), message: `${weight} may be pounds rather than kilograms. That equals ${round(convertedLb, 1)} kg.` });
    }
    if (weight > 100 && Math.abs(weight / 10 - latest.weightKg) <= Math.max(3, latest.weightKg * 0.15)) {
      issues.push({ severity: "warning", code: "decimal", suggestionKg: round(weight / 10, 1), message: `This may be a missing decimal point. Did you mean ${round(weight / 10, 1)} kg?` });
    }
    const enteredAge = date ? daysBetween(dob, date) : latest.ageDays;
    const expected = forecast?.ready ? forecast.predictAtAge(enteredAge) : latest.weightKg;
    const uncertainty = Math.max(1.2, forecast?.residualNoise ? forecast.residualNoise * 2.5 : latest.weightKg * 0.08);
    if (Math.abs(weight - expected) > uncertainty) {
      issues.push({
        severity: "warning",
        code: "outlier",
        message: `This is ${round(Math.abs(weight - expected), 1)} kg ${weight > expected ? "above" : "below"} the current expected trend. Confirm it if genuine.`
      });
    }
    if (date) {
      const days = Math.abs(daysBetween(parseIso(latest.date), date));
      if (days > 0 && days < 3) issues.push({ severity: "info", code: "close", message: "This reading is very close to the previous weigh-in and may add limited trend information." });
    }
  }
  return issues;
}

export function nextWeighInRecommendation(entries, profile = {}, forecast = null) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  if (!points.length) return { days: 0, reason: "No weight has been recorded yet.", urgent: true };
  const latest = points.at(-1);
  const ageMonths = latest.ageDays / 30.4375;
  const all = normaliseEntries(entries, profile.dob || DEFAULT_DOB);
  const latestRaw = all.find(entry => entry.id === latest.id);
  if (latestRaw && !latestRaw.confirmed) {
    const inputIssues = checkWeightInput({ dateIso: latest.date, weightKg: latest.weightKg, entries: all.filter(entry => entry.id !== latest.id), dobIso: profile.dob, forecast });
    if (inputIssues.some(issue => issue.code === "outlier" || issue.code === "pounds" || issue.code === "decimal")) return { days: 3, reason: "A short-interval confirmation would help verify the latest unusual reading.", urgent: true };
  }
  const rangeWidth = forecast?.ready ? forecast.adult.likelyHigh - forecast.adult.likelyLow : Infinity;
  if (ageMonths < 9 || rangeWidth > 7) return { days: 7, reason: "Weekly readings remain useful while growth or forecast uncertainty is relatively high.", urgent: false };
  if (ageMonths < 18 || rangeWidth > 4) return { days: 14, reason: "Fortnightly weighing should provide enough information as growth slows.", urgent: false };
  return { days: 30, reason: "Monthly weighing is proportionate now that growth should be comparatively stable.", urgent: false };
}

export function feedingBandForAge(ageDays, bands = DEFAULT_FEEDING_BANDS) {
  const months = Math.max(0, ageDays / 30.4375);
  const clean = normaliseFeedingBands(bands);
  return clean.find(band => months >= band.minMonths && months < band.maxMonths) || clean.at(-1);
}

export function normaliseFeedingBands(rawBands) {
  const source = Array.isArray(rawBands) && rawBands.length ? rawBands : DEFAULT_FEEDING_BANDS;
  return source.map((raw, index) => ({
    id: typeof raw.id === "string" ? raw.id : `band-${index}`,
    label: typeof raw.label === "string" ? raw.label.slice(0, 60) : `Band ${index + 1}`,
    minMonths: Math.max(0, Number(raw.minMonths) || 0),
    maxMonths: Math.max(Number(raw.minMonths) || 0, Number(raw.maxMonths) || 99),
    percent: clamp(Number(raw.percent) || 0, 0.1, 20)
  })).sort((a, b) => a.minMonths - b.minMonths);
}

export function feedingCalculation(weightKg, ageDays, bands = DEFAULT_FEEDING_BANDS) {
  if (!Number.isFinite(Number(weightKg)) || weightKg <= 0) return null;
  const band = feedingBandForAge(ageDays, bands);
  const dailyGrams = weightKg * 1000 * band.percent / 100;
  return {
    band,
    percent: band.percent,
    mealsPerDay: FIXED_MEALS_PER_DAY,
    dailyGrams: round(dailyGrams, 0),
    perMealGrams: round(dailyGrams / FIXED_MEALS_PER_DAY, 0),
    weeklyKg: round(dailyGrams * 7 / 1000, 1),
    monthlyKg: round(dailyGrams * 30.4375 / 1000, 1)
  };
}

export function feedingForecast(entries, profile = {}, forecast = null, horizons = [0, 28, 56, 84]) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  if (!points.length) return [];
  const latest = points.at(-1);
  const bands = normaliseFeedingBands(profile.feedingBands);
  return horizons.map(days => {
    const ageDays = latest.ageDays + days;
    const projectedWeightKg = days === 0 ? latest.weightKg : forecast?.ready ? forecast.predictAtAge(ageDays) : latest.weightKg;
    return {
      days,
      ageDays,
      projectedWeightKg,
      ...feedingCalculation(projectedWeightKg, ageDays, bands)
    };
  });
}

export function supplementCalibration(trials, teaspoonsPerTrial = 10) {
  const clean = (Array.isArray(trials) ? trials : []).map(Number).filter(value => Number.isFinite(value) && value > 0);
  if (!clean.length) return { ready: false, gramsPerTsp: null, averageTrialGrams: null, cvPercent: null, quality: "Missing" };
  const averageTrialGrams = mean(clean);
  const gramsPerTsp = averageTrialGrams / teaspoonsPerTrial;
  const cvPercent = averageTrialGrams ? standardDeviation(clean) / averageTrialGrams * 100 : null;
  const quality = clean.length < 3 ? "Provisional" : cvPercent <= 2.5 ? "Excellent" : cvPercent <= 5 ? "Good" : cvPercent <= 8 ? "Variable" : "Poor";
  return { ready: true, gramsPerTsp, averageTrialGrams, cvPercent, quality, count: clean.length };
}

export function supplementTargetGrams(supplement, weightKg) {
  if (!supplement?.enabled) return null;
  const amount = Number(supplement.amount);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  let target;
  switch (supplement.rule) {
    case "perKg": target = amount * weightKg; break;
    case "per5Kg": target = amount * weightKg / 5; break;
    case "per10Kg": target = amount * weightKg / 10; break;
    case "bands": {
      const band = (supplement.bands || []).find(item => weightKg >= Number(item.minKg) && weightKg < Number(item.maxKg));
      target = band ? Number(band.grams) : null;
      break;
    }
    default: target = amount;
  }
  if (!Number.isFinite(target)) return null;
  const maximum = Number(supplement.maximumGrams);
  if (Number.isFinite(maximum) && maximum > 0) target = Math.min(target, maximum);
  return round(target, 3);
}

const SPOON_DENOMINATIONS = [
  { tsp: 9, label: "3 tbsp" },
  { tsp: 6, label: "2 tbsp" },
  { tsp: 3, label: "1 tbsp" },
  { tsp: 2, label: "2 tsp" },
  { tsp: 1, label: "1 tsp" },
  { tsp: 0.75, label: "¾ tsp" },
  { tsp: 0.5, label: "½ tsp" },
  { tsp: 0.25, label: "¼ tsp" }
];

export function spoonCombination(targetGrams, gramsPerTsp) {
  if (!Number.isFinite(targetGrams) || targetGrams <= 0 || !Number.isFinite(gramsPerTsp) || gramsPerTsp <= 0) return null;
  const exactTsp = targetGrams / gramsPerTsp;
  const lower = Math.max(0.25, Math.floor(exactTsp * 4) / 4);
  const upper = Math.max(0.25, Math.ceil(exactTsp * 4) / 4);
  const roundedTsp = [lower, upper].sort((a, b) => {
    const ea = Math.abs(a * gramsPerTsp - targetGrams);
    const eb = Math.abs(b * gramsPerTsp - targetGrams);
    if (Math.abs(ea - eb) > 1e-9) return ea - eb;
    return combinationParts(a).length - combinationParts(b).length;
  })[0];
  const parts = combinationParts(roundedTsp);
  const deliveredGrams = roundedTsp * gramsPerTsp;
  return {
    exactTsp,
    roundedTsp,
    parts,
    label: parts.join(" + "),
    deliveredGrams,
    differenceGrams: deliveredGrams - targetGrams,
    differencePercent: targetGrams ? (deliveredGrams - targetGrams) / targetGrams * 100 : 0
  };
}

function combinationParts(totalTsp) {
  let remaining = Math.round(totalTsp * 4) / 4;
  const parts = [];
  for (const denomination of SPOON_DENOMINATIONS) {
    while (remaining + 1e-9 >= denomination.tsp) {
      parts.push(denomination.label);
      remaining = Math.round((remaining - denomination.tsp) * 4) / 4;
    }
  }
  return parts.length ? parts : ["¼ tsp"];
}

export function supplementPlan(supplements, weightKg) {
  return (Array.isArray(supplements) ? supplements : [])
    .filter(item => item?.enabled)
    .map(item => {
      const targetGrams = supplementTargetGrams(item, weightKg);
      const calibration = supplementCalibration(item.calibrationTrials, Number(item.teaspoonsPerTrial) || 10);
      const spoons = targetGrams && calibration.ready ? spoonCombination(targetGrams, calibration.gramsPerTsp) : null;
      return { ...item, targetGrams, calibration, spoons };
    });
}

export function findProjectedDateForWeight(targetKg, forecast, dobIso = DEFAULT_DOB) {
  if (!forecast?.ready || !Number.isFinite(targetKg) || targetKg <= forecast.latest.weightKg) return null;
  const dob = parseIso(dobIso);
  for (let age = forecast.latest.ageDays; age <= 913; age += 1) {
    if (forecast.predictAtAge(age) >= targetKg) return addDays(dob, age);
  }
  return null;
}

export function buildMilestones(entries, profile = {}, forecast = null) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  if (!points.length) return { weight: [], age: [], growth: [] };
  const dob = parseIso(profile.dob || DEFAULT_DOB);
  const latest = points.at(-1);
  const adult = forecast?.adult?.median || Number(profile.referenceAdultKg) || 50;
  const highest = Math.max(...points.map(point => point.weightKg));
  const weightTargets = [];
  const limit = Math.ceil(Math.max(highest + 10, adult) / 5) * 5;
  for (let kg = 5; kg <= Math.min(100, limit); kg += 5) {
    const reached = points.find(point => point.weightKg >= kg);
    const projectedDate = reached ? parseIso(reached.date) : findProjectedDateForWeight(kg, forecast, profile.dob || DEFAULT_DOB);
    weightTargets.push({
      id: `weight-${kg}`,
      label: `${kg} kg`,
      type: "weight",
      complete: Boolean(reached),
      date: reached?.date || (projectedDate ? iso(projectedDate) : null),
      detail: reached ? `Reached at ${exactAgeLabel(reached.ageDays)}` : projectedDate ? "Projected from the current combined model" : "Not currently projected"
    });
  }
  const ageMonths = [3, 6, 9, 12, 18, 24];
  const age = ageMonths.map(months => {
    const targetDate = new Date(dob.getFullYear(), dob.getMonth() + months, dob.getDate(), 12);
    return {
      id: `age-${months}`,
      label: months % 12 === 0 ? `${months / 12} year${months === 12 ? "" : "s"}` : `${months} months`,
      type: "age",
      complete: latest.ageDays >= daysBetween(dob, targetDate),
      date: iso(targetDate),
      detail: "Age milestone"
    };
  });
  const change = detectChangePoint(entries, profile.dob || DEFAULT_DOB);
  const growth = [
    {
      id: "highest",
      label: "Current highest weight",
      type: "growth",
      complete: true,
      date: latest.date,
      detail: `${round(highest, 1)} kg`
    },
    {
      id: "forecast-progress-90",
      label: "90% of projected adult weight",
      type: "growth",
      complete: forecast?.progressPercent >= 90,
      date: forecast?.progressPercent >= 90 ? latest.date : findProjectedDateForWeight(adult * 0.9, forecast, profile.dob || DEFAULT_DOB) ? iso(findProjectedDateForWeight(adult * 0.9, forecast, profile.dob || DEFAULT_DOB)) : null,
      detail: forecast?.ready ? `${round(adult * 0.9, 1)} kg target` : "Needs forecast"
    },
    {
      id: "trend-change",
      label: change.status === "slowing" ? "Sustained growth slowdown" : "Trend-change analysis",
      type: "growth",
      complete: change.status === "slowing",
      date: change.status === "slowing" ? latest.date : null,
      detail: change.label
    }
  ];
  return { weight: weightTargets, age, growth };
}

export function scenarioForecast(entries, profile, scenario = {}) {
  let workingEntries = normaliseEntries(entries, profile.dob || DEFAULT_DOB);
  if (Array.isArray(scenario.excludeIds) && scenario.excludeIds.length) workingEntries = workingEntries.map(entry => scenario.excludeIds.includes(entry.id) ? { ...entry, excluded: true } : entry);
  if (scenario.recentDays) {
    const included = workingEntries.filter(entry => !entry.excluded);
    const latestDate = parseIso(included.at(-1)?.date || "");
    if (latestDate) {
      const cutoff = addDays(latestDate, -Number(scenario.recentDays));
      workingEntries = workingEntries.map(entry => parseIso(entry.date) < cutoff ? { ...entry, excluded: true } : entry);
    }
  }
  if (Number.isFinite(Number(scenario.hypotheticalWeightKg))) {
    const included = workingEntries.filter(entry => !entry.excluded);
    const latest = included.at(-1);
    const date = scenario.hypotheticalDate || (latest ? iso(addDays(parseIso(latest.date), 7)) : iso(new Date()));
    workingEntries = [...workingEntries.filter(entry => entry.date !== date), {
      id: "scenario-hypothetical",
      date,
      weightKg: Number(scenario.hypotheticalWeightKg),
      notes: "Forecast Lab hypothetical reading",
      excluded: false,
      confirmed: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
  }
  const forecast = calculateForecast(workingEntries, profile);
  const growthAdjustment = clamp(Number(scenario.growthAdjustmentPercent) || 0, -50, 50) / 100;
  if (forecast.ready && growthAdjustment !== 0) {
    const basePredict = forecast.predictAtAge;
    const latest = forecast.latest;
    forecast.predictAtAge = age => {
      const base = basePredict(age);
      const increment = Math.max(0, base - latest.weightKg);
      return latest.weightKg + increment * (1 + growthAdjustment);
    };
    forecast.adult = {
      ...forecast.adult,
      median: latest.weightKg + Math.max(0, forecast.adult.median - latest.weightKg) * (1 + growthAdjustment),
      likelyLow: latest.weightKg + Math.max(0, forecast.adult.likelyLow - latest.weightKg) * (1 + growthAdjustment),
      likelyHigh: latest.weightKg + Math.max(0, forecast.adult.likelyHigh - latest.weightKg) * (1 + growthAdjustment),
      wideLow: latest.weightKg + Math.max(0, forecast.adult.wideLow - latest.weightKg) * (1 + growthAdjustment),
      wideHigh: latest.weightKg + Math.max(0, forecast.adult.wideHigh - latest.weightKg) * (1 + growthAdjustment)
    };
  }
  return { entries: workingEntries, forecast };
}

export function generateInsight(entries, profile = {}, forecast = null) {
  const points = withAges(entries, profile.dob || DEFAULT_DOB);
  if (!points.length) return "Add Reggie’s first weight to activate personalised growth, feeding and milestone analysis.";
  const metrics = intervalMetrics(points, profile.dob || DEFAULT_DOB);
  const change = detectChangePoint(points, profile.dob || DEFAULT_DOB);
  const latest = points.at(-1);
  const fragments = [];
  if (metrics.fourWeek) fragments.push(`The fitted four-week rate is ${round(metrics.fourWeek.kgPerWeek, 2)} kg per week.`);
  else if (metrics.latest) fragments.push(`The latest interval changed by ${round(metrics.latest.changeKg, 1)} kg over ${metrics.latest.days} days.`);
  if (change.status === "slowing") fragments.push("Growth has slowed across several readings rather than one isolated result.");
  if (change.status === "accelerating") fragments.push("The recent underlying rate is materially higher than the preceding period.");
  if (forecast?.ready) fragments.push(`The adult estimate is ${round(forecast.adult.median, 1)} kg with a likely range of ${round(forecast.adult.likelyLow, 1)}–${round(forecast.adult.likelyHigh, 1)} kg.`);
  if (!fragments.length) fragments.push(`${latest.weightKg} kg is the latest included weight.`);
  return fragments.join(" ");
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
