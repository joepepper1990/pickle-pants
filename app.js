import {
  APP_SCHEMA_VERSION,
  DEFAULT_DOB,
  DEFAULT_FEEDING_BANDS,
  FIXED_MEALS_PER_DAY,
  addDays,
  ageDaysOn,
  ageParts,
  backtestForecastModels,
  buildMilestones,
  calculateForecast,
  checkWeightInput,
  createId,
  detectChangePoint,
  exactAgeLabel,
  feedingCalculation,
  feedingForecast,
  findProjectedDateForWeight,
  generateInsight,
  intervalMetrics,
  iso,
  linearRegression,
  normaliseEntries,
  normaliseFeedingBands,
  parseIso,
  round,
  scenarioForecast,
  spoonCombination,
  supplementCalibration,
  supplementPlan,
  supplementTargetGrams,
  withAges
} from "./engine.js";

const APP_VERSION = "6.0.0";
const STORAGE_KEY = "picklePants.v6";
const PREVIOUS_STORAGE_KEYS = ["picklePants.v5"];
const LEGACY_HISTORY_KEYS = [
  "picklePantsReggieWeightHistoryFixedV2",
  "picklePantsReggieWeightHistory",
  "picklePantsWeightHistoryV3",
  "reggieRawFeedHistory"
];

const ROUTES = {
  home: { title: "Home", eyebrow: "Pickle Pants", nav: "home" },
  growth: { title: "Growth", eyebrow: "Analysis and projections", nav: "growth" },
  feeding: { title: "Feeding", eyebrow: "Two meals every day", nav: "feeding" },
  forecast: { title: "Forecast Lab", eyebrow: "Temporary scenarios", nav: "forecast" },
  more: { title: "More", eyebrow: "Tools and data", nav: "more" },
  ask: { title: "Ask Pickle Pants", eyebrow: "Local data assistant", nav: "more" },
  history: { title: "Weight history", eyebrow: "Every recorded weight", nav: "more" },
  milestones: { title: "Milestones", eyebrow: "Completed and projected", nav: "more" },
  data: { title: "Data & settings", eyebrow: "Backup, profile and app", nav: "more" }
};

const MODEL_LABELS = {
  maturity: "Growth-percentage model",
  logistic: "Logistic curve",
  gompertz: "Gompertz curve",
  quadratic: "Curved regression",
  recent: "Recent trend"
};

const DEFAULT_STATE = {
  schemaVersion: APP_SCHEMA_VERSION,
  profile: {
    name: "Reggie",
    nickname: "Pickle Pants",
    breed: "Rottweiler",
    sex: "Male",
    dob: DEFAULT_DOB,
    referenceAdultKg: 50,
    feedingBands: structuredClone(DEFAULT_FEEDING_BANDS),
    theme: "system"
  },
  entries: [],
  supplements: [
    supplementTemplate("Scottish salmon oil"),
    supplementTemplate("Pumpkin powder"),
    supplementTemplate("Green-lipped mussel powder"),
    supplementTemplate("Plaque powder")
  ],
  forecastSnapshots: [],
  snapshots: [],
  ui: {
    route: "home",
    growthTab: "overview",
    chartRange: "3m",
    chartLayers: { actual: true, trend: true, forecast: true, reference: true, milestones: true },
    milestoneType: "weight",
    historyFilter: "all",
    homeCards: ["adult", "food", "milestone", "growth"],
    hiddenHomeCards: [],
    scenario: {
      growthAdjustmentPercent: 0,
      dataWindow: "all",
      hypotheticalWeightKg: ""
    },
    assistantMessages: []
  }
};

const dom = {
  app: document.getElementById("app"),
  pageTitle: document.getElementById("pageTitle"),
  pageEyebrow: document.getElementById("pageEyebrow"),
  desktopNav: document.getElementById("desktopNav"),
  mobileNav: document.getElementById("mobileNav"),
  desktopAddWeight: document.getElementById("desktopAddWeight"),
  topAddWeight: document.getElementById("topAddWeight"),
  mobileAddWeight: document.getElementById("mobileAddWeight"),
  themeButton: document.getElementById("themeButton"),
  themeColorMeta: document.getElementById("themeColorMeta"),
  connectionDot: document.getElementById("connectionDot"),
  connectionText: document.getElementById("connectionText"),
  updateBanner: document.getElementById("updateBanner"),
  applyUpdateButton: document.getElementById("applyUpdateButton"),
  weightSheet: document.getElementById("weightSheet"),
  weightForm: document.getElementById("weightForm"),
  weightSheetTitle: document.getElementById("weightSheetTitle"),
  entryId: document.getElementById("entryId"),
  entryWeight: document.getElementById("entryWeight"),
  entryDate: document.getElementById("entryDate"),
  entryNotes: document.getElementById("entryNotes"),
  entryExclude: document.getElementById("entryExclude"),
  entryIssues: document.getElementById("entryIssues"),
  liveComparison: document.getElementById("liveComparison"),
  saveWeightButton: document.getElementById("saveWeightButton"),
  feedingProfileDialog: document.getElementById("feedingProfileDialog"),
  feedingProfileForm: document.getElementById("feedingProfileForm"),
  feedingBandEditor: document.getElementById("feedingBandEditor"),
  supplementDialog: document.getElementById("supplementDialog"),
  supplementForm: document.getElementById("supplementForm"),
  supplementDialogTitle: document.getElementById("supplementDialogTitle"),
  supplementId: document.getElementById("supplementId"),
  supplementName: document.getElementById("supplementName"),
  supplementRule: document.getElementById("supplementRule"),
  supplementAmount: document.getElementById("supplementAmount"),
  supplementMaximum: document.getElementById("supplementMaximum"),
  calibrationTrial1: document.getElementById("calibrationTrial1"),
  calibrationTrial2: document.getElementById("calibrationTrial2"),
  calibrationTrial3: document.getElementById("calibrationTrial3"),
  calibrationQuality: document.getElementById("calibrationQuality"),
  calibrationResult: document.getElementById("calibrationResult"),
  supplementTiming: document.getElementById("supplementTiming"),
  supplementNotes: document.getElementById("supplementNotes"),
  supplementEnabled: document.getElementById("supplementEnabled"),
  deleteSupplementButton: document.getElementById("deleteSupplementButton"),
  homeEditDialog: document.getElementById("homeEditDialog"),
  homeEditForm: document.getElementById("homeEditForm"),
  homeCardEditor: document.getElementById("homeCardEditor"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmForm: document.getElementById("confirmForm"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmAction: document.getElementById("confirmAction"),
  importFile: document.getElementById("importFile"),
  toastRegion: document.getElementById("toastRegion")
};

let state = loadState();
let pendingConfirmation = null;
let undoRecord = null;
let serviceWorkerRegistration = null;
let chartInteraction = { tooltip: null };
let analyticsCache = { key: null, value: null };
let weightSheetForecast = null;
let homeEditDraft = null;

function supplementTemplate(name) {
  return {
    id: createId(),
    name,
    rule: "fixed",
    amount: null,
    maximumGrams: null,
    calibrationTrials: [],
    teaspoonsPerTrial: 10,
    timing: "morning",
    notes: "",
    enabled: true
  };
}

function loadState() {
  let raw = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (!raw) {
    for (const key of PREVIOUS_STORAGE_KEYS) {
      const previous = safeJsonParse(localStorage.getItem(key));
      if (previous) { raw = migratePreviousState(previous); break; }
    }
  }
  const merged = mergeState(structuredClone(DEFAULT_STATE), raw || {});
  if (!merged.entries.length) merged.entries = loadLegacyHistory();
  merged.schemaVersion = APP_SCHEMA_VERSION;
  merged.entries = normaliseEntries(merged.entries, merged.profile.dob);
  merged.profile.feedingBands = normaliseFeedingBands(merged.profile.feedingBands);
  merged.supplements = normaliseSupplements(merged.supplements);
  merged.ui.route = ROUTES[merged.ui.route] ? merged.ui.route : "home";
  merged.ui.growthTab = ["overview", "chart", "forecasts", "accuracy"].includes(merged.ui.growthTab) ? merged.ui.growthTab : "overview";
  merged.ui.chartRange = ["4w", "3m", "6m", "1y", "all"].includes(merged.ui.chartRange) ? merged.ui.chartRange : "3m";
  merged.ui.milestoneType = ["weight", "age", "growth"].includes(merged.ui.milestoneType) ? merged.ui.milestoneType : "weight";
  merged.ui.historyFilter = ["all", "included", "excluded", "questionable"].includes(merged.ui.historyFilter) ? merged.ui.historyFilter : "all";
  const allowedHomeCards = ["adult", "food", "milestone", "growth"];
  merged.ui.homeCards = Array.isArray(merged.ui.homeCards) ? merged.ui.homeCards.filter(value => allowedHomeCards.includes(value)) : [...allowedHomeCards];
  for (const value of allowedHomeCards) if (!merged.ui.homeCards.includes(value)) merged.ui.homeCards.push(value);
  merged.ui.hiddenHomeCards = Array.isArray(merged.ui.hiddenHomeCards) ? merged.ui.hiddenHomeCards.filter(value => allowedHomeCards.includes(value)) : [];
  merged.ui.scenario = { ...DEFAULT_STATE.ui.scenario, ...(merged.ui.scenario || {}) };
  merged.ui.assistantMessages = Array.isArray(merged.ui.assistantMessages) ? merged.ui.assistantMessages.slice(-30) : [];
  const cutoff = Date.now() - 30 * 86_400_000;
  merged.snapshots = (Array.isArray(merged.snapshots) ? merged.snapshots : []).filter(item => Date.parse(item.createdAt) >= cutoff).slice(-30);
  return merged;
}

function mergeState(base, incoming) {
  return {
    ...base,
    ...incoming,
    profile: { ...base.profile, ...(incoming.profile || {}) },
    ui: {
      ...base.ui,
      ...(incoming.ui || {}),
      chartLayers: { ...base.ui.chartLayers, ...(incoming.ui?.chartLayers || {}) }
    },
    entries: Array.isArray(incoming.entries) ? incoming.entries : base.entries,
    supplements: Array.isArray(incoming.supplements) ? incoming.supplements : base.supplements,
    forecastSnapshots: Array.isArray(incoming.forecastSnapshots) ? incoming.forecastSnapshots : [],
    snapshots: Array.isArray(incoming.snapshots) ? incoming.snapshots : []
  };
}

function migratePreviousState(previous) {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    profile: {
      name: previous.profile?.name || "Reggie",
      nickname: previous.profile?.nickname || "Pickle Pants",
      breed: previous.profile?.breed || "Rottweiler",
      sex: previous.profile?.sex || "Male",
      dob: previous.profile?.dob || DEFAULT_DOB,
      referenceAdultKg: Number(previous.profile?.referenceAdultKg) || 50,
      feedingBands: structuredClone(DEFAULT_FEEDING_BANDS),
      theme: previous.profile?.theme || previous.theme || "system"
    },
    entries: (previous.entries || []).map(entry => ({
      id: entry.id || createId(),
      date: entry.date,
      weightKg: entry.weightKg,
      notes: entry.notes || "",
      excluded: Boolean(entry.excluded),
      confirmed: Boolean(entry.confirmed),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    })),
    supplements: (previous.supplements || []).map(item => ({
      id: item.id || createId(),
      name: item.name || "Supplement",
      rule: ["fixed", "perKg", "per5Kg", "per10Kg"].includes(item.rule) ? item.rule : "fixed",
      amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : null,
      maximumGrams: null,
      calibrationTrials: [],
      teaspoonsPerTrial: 10,
      timing: "morning",
      notes: item.notes || "",
      enabled: item.enabled !== false
    })),
    forecastSnapshots: [],
    snapshots: [],
    ui: structuredClone(DEFAULT_STATE.ui)
  };
}

function loadLegacyHistory() {
  for (const key of LEGACY_HISTORY_KEYS) {
    const raw = safeJsonParse(localStorage.getItem(key));
    if (!Array.isArray(raw) || !raw.length) continue;
    return raw.map(item => ({
      id: createId(),
      date: item.date,
      weightKg: item.weightKg,
      notes: item.confirmed ? "Migrated from the previous app; previously confirmed." : "Migrated from the previous app.",
      excluded: false,
      confirmed: Boolean(item.confirmed),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }
  return [];
}

function normaliseSupplements(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item.name === "string")
    .map(item => ({
      id: typeof item.id === "string" ? item.id : createId(),
      name: item.name.slice(0, 80),
      rule: ["fixed", "perKg", "per5Kg", "per10Kg"].includes(item.rule) ? item.rule : "fixed",
      amount: positiveOrNull(item.amount),
      maximumGrams: positiveOrNull(item.maximumGrams),
      calibrationTrials: (Array.isArray(item.calibrationTrials) ? item.calibrationTrials : []).map(Number).filter(value => Number.isFinite(value) && value > 0).slice(0, 3),
      teaspoonsPerTrial: 10,
      timing: ["morning", "evening", "split"].includes(item.timing) ? item.timing : "morning",
      notes: typeof item.notes === "string" ? item.notes.slice(0, 400) : "",
      enabled: item.enabled !== false
    }));
}

function safeJsonParse(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function positiveOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function createSnapshot(label) {
  const snapshot = {
    id: createId(),
    createdAt: new Date().toISOString(),
    label,
    data: {
      profile: structuredClone(state.profile),
      entries: structuredClone(state.entries),
      supplements: structuredClone(state.supplements),
      forecastSnapshots: structuredClone(state.forecastSnapshots),
      ui: structuredClone(state.ui)
    }
  };
  state.snapshots = [...(state.snapshots || []), snapshot]
    .filter(item => Date.parse(item.createdAt) >= Date.now() - 30 * 86_400_000)
    .slice(-30);
}

function restoreSnapshot(id) {
  const snapshot = state.snapshots.find(item => item.id === id);
  if (!snapshot) return;
  requestConfirmation("Restore automatic snapshot", `Restore the app to its state before ${snapshot.label}? A new safety snapshot will be created first.`, () => {
    createSnapshot("snapshot restore");
    const retainedSnapshots = state.snapshots;
    state = mergeState(structuredClone(DEFAULT_STATE), snapshot.data);
    state.snapshots = retainedSnapshots;
    state.entries = normaliseEntries(state.entries, state.profile.dob);
    state.supplements = normaliseSupplements(state.supplements);
    saveState();
    applyTheme(state.profile.theme);
    toast("Automatic snapshot restored.");
    render();
  }, "Restore");
}

function saveState() {
  state.schemaVersion = APP_SCHEMA_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function analytics() {
  const key = JSON.stringify({ entries: state.entries, profile: state.profile, supplements: state.supplements });
  if (analyticsCache.key === key && analyticsCache.value) return analyticsCache.value;
  const forecast = calculateForecast(state.entries, state.profile);
  const metrics = intervalMetrics(state.entries, state.profile.dob);
  const change = detectChangePoint(state.entries, state.profile.dob);
  const points = withAges(state.entries, state.profile.dob);
  const latest = points.at(-1) || null;
  const food = latest ? feedingCalculation(latest.weightKg, latest.ageDays, state.profile.feedingBands) : null;
  const foodForecast = feedingForecast(state.entries, state.profile, forecast);
  const supplements = latest ? supplementPlan(state.supplements, latest.weightKg) : [];
  const milestones = buildMilestones(state.entries, state.profile, forecast);
  const nextWeigh = nextWeighIn(forecast);
  const value = { forecast, metrics, change, points, latest, food, foodForecast, supplements, milestones, nextWeigh };
  analyticsCache = { key, value };
  return value;
}

function nextWeighIn(forecast) {
  const points = withAges(state.entries, state.profile.dob);
  if (!points.length) return { date: new Date(), days: 0, dueInDays: 0, reason: "Add the first weight.", overdue: false };
  const latest = points.at(-1);
  const ageMonths = latest.ageDays / 30.4375;
  const rawLatest = state.entries.find(entry => entry.id === latest.id);
  let days = ageMonths < 9 ? 7 : ageMonths < 18 ? 14 : 30;
  let reason = ageMonths < 9 ? "Weekly readings remain useful during faster growth." : ageMonths < 18 ? "Fortnightly readings are proportionate as growth slows." : "Monthly readings should be sufficient once growth is comparatively stable.";
  if (rawLatest && !rawLatest.confirmed) {
    const issues = checkWeightInput({ dateIso: rawLatest.date, weightKg: rawLatest.weightKg, entries: state.entries.filter(entry => entry.id !== rawLatest.id), dobIso: state.profile.dob, forecast });
    if (issues.some(issue => ["outlier", "pounds", "decimal"].includes(issue.code))) { days = 3; reason = "A short confirmation interval would help verify the latest unusual result."; }
  }
  if (forecast.ready && forecast.adult.likelyHigh - forecast.adult.likelyLow > 8) { days = Math.min(days, 7); reason = "Forecast uncertainty remains wide, so a weekly reading would materially improve the model."; }
  const date = addDays(parseIso(latest.date), days);
  const today = todayDate();
  const dueInDays = Math.ceil((date - today) / 86_400_000);
  return { date, days, dueInDays, reason, overdue: dueInDays < 0 };
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
}

function init() {
  applyTheme(state.profile.theme);
  const params = new URLSearchParams(location.search);
  if (ROUTES[params.get("screen")]) state.ui.route = params.get("screen");
  bindGlobalEvents();
  render();
  if (params.get("action") === "add-weight") setTimeout(() => openWeightSheet(), 120);
  updateConnectionState();
  registerServiceWorker();
  saveState();
}

function bindGlobalEvents() {
  document.addEventListener("click", handleDocumentClick);
  dom.weightForm.addEventListener("submit", handleWeightSubmit);
  dom.entryWeight.addEventListener("input", renderWeightSheetFeedback);
  dom.entryDate.addEventListener("input", renderWeightSheetFeedback);
  dom.entryExclude.addEventListener("change", renderWeightSheetFeedback);
  dom.feedingProfileForm.addEventListener("submit", handleFeedingProfileSubmit);
  dom.supplementForm.addEventListener("submit", handleSupplementSubmit);
  dom.homeEditForm.addEventListener("submit", handleHomeEditSubmit);
  [dom.calibrationTrial1, dom.calibrationTrial2, dom.calibrationTrial3].forEach(input => input.addEventListener("input", renderCalibrationPreview));
  dom.deleteSupplementButton.addEventListener("click", deleteCurrentSupplement);
  dom.confirmForm.addEventListener("submit", handleConfirmSubmit);
  dom.importFile.addEventListener("change", importBackupFile);
  window.addEventListener("online", updateConnectionState);
  window.addEventListener("offline", updateConnectionState);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (state.profile.theme === "system") applyTheme("system"); });
}

function handleDocumentClick(event) {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    navigate(routeButton.dataset.route);
    return;
  }
  if (event.target.closest("#desktopAddWeight, #topAddWeight, #mobileAddWeight, [data-action='add-weight']")) {
    openWeightSheet();
    return;
  }
  if (event.target.closest("#themeButton")) {
    cycleTheme();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  handleAction(action.dataset.action, action);
}

function handleAction(action, element) {
  switch (action) {
    case "growth-tab": state.ui.growthTab = element.dataset.value; saveState(); render(); break;
    case "chart-range": state.ui.chartRange = element.dataset.value; saveState(); render(); break;
    case "chart-layer": state.ui.chartLayers[element.dataset.value] = !state.ui.chartLayers[element.dataset.value]; saveState(); render(); break;
    case "edit-entry": openWeightSheet(element.dataset.id); break;
    case "delete-entry": requestConfirmation("Delete weight", "This weight will be removed. You can still undo immediately afterwards.", () => deleteEntry(element.dataset.id)); break;
    case "toggle-exclude": toggleEntryExclusion(element.dataset.id); break;
    case "confirm-entry": confirmEntry(element.dataset.id); break;
    case "undo": undoLastAction(); break;
    case "open-feeding-profile": openFeedingProfile(); break;
    case "open-home-editor": openHomeEditor(); break;
    case "move-home-card": moveHomeCard(element.dataset.value, Number(element.dataset.direction)); break;
    case "toggle-home-card": toggleHomeCard(element.dataset.value); break;
    case "edit-supplement": openSupplementDialog(element.dataset.id); break;
    case "add-supplement": openSupplementDialog(); break;
    case "scenario-adjust": state.ui.scenario.growthAdjustmentPercent = Number(element.dataset.value); saveState(); render(); break;
    case "scenario-window": state.ui.scenario.dataWindow = element.dataset.value; saveState(); render(); break;
    case "scenario-reset": state.ui.scenario = structuredClone(DEFAULT_STATE.ui.scenario); saveState(); render(); break;
    case "milestone-type": state.ui.milestoneType = element.dataset.value; saveState(); render(); break;
    case "history-filter": state.ui.historyFilter = element.dataset.value; saveState(); render(); break;
    case "ask-question": askQuestion(element.dataset.question || element.textContent.trim()); break;
    case "export-json": exportJson(); break;
    case "export-csv": exportCsv(); break;
    case "import-json": dom.importFile.click(); break;
    case "calendar": downloadCalendar(); break;
    case "save-profile": saveProfileFromScreen(); break;
    case "restore-snapshot": restoreSnapshot(element.dataset.id); break;
    case "clear-data": requestConfirmation("Clear all Pickle Pants data", "This permanently removes weights, supplements, settings and forecast history from this browser.", clearAllData, "Clear everything"); break;
    case "chart-point": showChartTooltip(element, Number(element.dataset.index)); break;
    case "dismiss-tooltip": hideChartTooltip(); break;
    case "apply-suggestion": applyWeightSuggestion(Number(element.dataset.weight)); break;
    default: break;
  }
}

function navigate(route) {
  if (!ROUTES[route]) return;
  state.ui.route = route;
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  dom.app.focus({ preventScroll: true });
}

function render() {
  const route = ROUTES[state.ui.route] || ROUTES.home;
  dom.pageTitle.textContent = route.title;
  dom.pageEyebrow.textContent = route.eyebrow;
  syncNavigation(route.nav);
  const data = analytics();
  switch (state.ui.route) {
    case "home": renderHome(data); break;
    case "growth": renderGrowth(data); break;
    case "feeding": renderFeeding(data); break;
    case "forecast": renderForecastLab(data); break;
    case "ask": renderAssistant(data); break;
    case "history": renderHistory(data); break;
    case "milestones": renderMilestones(data); break;
    case "data": renderDataSettings(data); break;
    default: renderMore(data); break;
  }
}

function syncNavigation(activeRoute) {
  document.querySelectorAll("[data-route]").forEach(button => button.classList.toggle("is-active", button.dataset.route === activeRoute));
}

function renderHome(data) {
  if (!data.latest) {
    dom.app.innerHTML = `<section class="screen page-grid">
      <article class="hero-card empty-hero">
        <div class="hero-main"><p class="hero-kicker">${escapeHtml(state.profile.name)}</p><h2>Start with one weight.</h2><p>That single entry activates age, feeding, trend, milestone and forecast calculations. Only weight is required.</p><button class="button primary" data-action="add-weight" type="button"><svg><use href="#i-plus"/></svg>Add first weight</button></div>
      </article>
      <div class="more-grid">
        ${moreCard("growth", "Growth analysis", "Multi-model forecasts, change detection and forecast accuracy.", "i-growth")}
        ${moreCard("feeding", "Two-meal feeding", "Bodyweight-percentage calculations with projected future amounts.", "i-food")}
        ${moreCard("forecast", "Forecast Lab", "Run temporary what-if scenarios without altering saved data.", "i-flask")}
        ${moreCard("data", "Data ownership", "Local storage, JSON backup, CSV export and offline operation.", "i-download")}
      </div>
    </section>`;
    return;
  }

  const previous = data.points.at(-2);
  const latestDelta = previous ? data.latest.weightKg - previous.weightKg : null;
  const latestDays = previous ? data.latest.ageDays - previous.ageDays : null;
  const weekly = data.metrics.fourWeek?.kgPerWeek ?? data.metrics.latest?.kgPerWeek;
  const nextMilestone = nextIncompleteMilestone(data.milestones.weight);
  const food = data.food;
  const forecast = data.forecast;
  const dueText = data.nextWeigh.overdue ? `${Math.abs(data.nextWeigh.dueInDays)} days overdue` : data.nextWeigh.dueInDays === 0 ? "Due today" : `In ${data.nextWeigh.dueInDays} days`;

  dom.app.innerHTML = `<section class="screen page-grid">
    <article class="hero-card">
      <div class="hero-main">
        <p class="hero-kicker">${escapeHtml(state.profile.name)} · ${escapeHtml(exactAgeLabel(data.latest.ageDays))}</p>
        <div class="hero-weight"><strong>${formatNumber(data.latest.weightKg, 1)}</strong><span>kg</span></div>
        <div class="hero-delta">
          <span class="hero-pill">${latestDelta == null ? "First reading" : `${signed(latestDelta, 1)} kg in ${latestDays} days`}</span>
          <span class="hero-pill">${Number.isFinite(weekly) ? `${signed(weekly, 2)} kg/week trend` : "Trend building"}</span>
        </div>
      </div>
      <div class="hero-side">
        <div class="hero-age">Recorded ${formatDate(parseIso(data.latest.date), { day: "numeric", month: "long", year: "numeric" })}</div>
        <div class="next-weigh-card"><small>Next weigh-in</small><strong>${formatDate(data.nextWeigh.date, { weekday: "short", day: "numeric", month: "short" })}</strong><span>${escapeHtml(dueText)} · ${escapeHtml(data.nextWeigh.reason)}</span></div>
      </div>
    </article>

    <div class="screen-toolbar"><p style="margin:0">Swipe through the cards that matter most.</p><button class="button ghost" data-action="open-home-editor" type="button">Edit Home</button></div>
    <div class="insight-carousel" aria-label="Dashboard insights">${renderHomeInsightCards(data, food, forecast, nextMilestone)}</div>

    <div class="auto-summary"><span class="summary-icon"><svg><use href="#i-growth"/></svg></span><p>${escapeHtml(generateInsight(state.entries, state.profile, forecast))}</p></div>

    <div class="quick-actions">
      ${quickAction("add-weight", "i-plus", "Add weight")}
      ${quickRoute("growth", "i-growth", "View chart")}
      ${quickRoute("ask", "i-chat", "Ask a question")}
      ${quickRoute("forecast", "i-flask", "Forecast Lab")}
    </div>
  </section>`;
}

function renderGrowth(data) {
  const tabs = [
    ["overview", "Overview"], ["chart", "Chart"], ["forecasts", "Forecasts"], ["accuracy", "Accuracy"]
  ];
  let content = "";
  if (!data.latest) content = emptyState("i-growth", "No growth data yet", "Add a weight to activate trends and forecasts.", "Add weight");
  else if (state.ui.growthTab === "overview") content = growthOverview(data);
  else if (state.ui.growthTab === "chart") content = growthChart(data);
  else if (state.ui.growthTab === "forecasts") content = growthForecasts(data);
  else content = growthAccuracy(data);
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="screen-toolbar"><div class="segmented">${tabs.map(([value, label]) => `<button class="segment-button ${state.ui.growthTab === value ? "is-active" : ""}" data-action="growth-tab" data-value="${value}" type="button">${label}</button>`).join("")}</div></div>
    ${content}
  </section>`;
  if (state.ui.growthTab === "chart" && data.latest) bindChartEvents();
}

function growthOverview(data) {
  const f = data.forecast;
  return `<div class="metric-grid">
      ${metricCard("Current weight", `${formatNumber(data.latest.weightKg, 1)} kg`, formatDate(parseIso(data.latest.date)))}
      ${metricCard("4-week gain", data.metrics.fourWeek ? `${signed(data.metrics.fourWeek.kgPerWeek * 4, 1)} kg` : "Building", data.metrics.fourWeek ? `${signed(data.metrics.fourWeek.kgPerWeek, 2)} kg/week fitted rate` : "Needs more recent readings")}
      ${metricCard("Weekly trend", Number.isFinite(data.metrics.fourWeek?.kgPerWeek) ? `${signed(data.metrics.fourWeek.kgPerWeek, 2)} kg` : "—", "Regression-based, not just two points")}
      ${metricCard("Adult estimate", f.ready ? `${formatNumber(f.adult.median, 1)} kg` : "Building", f.ready ? `${formatNumber(f.adult.likelyLow, 1)}–${formatNumber(f.adult.likelyHigh, 1)} kg likely range` : "Needs weight data")}
    </div>
    <div class="grid-two">
      <article class="status-panel">
        <div class="status-panel-head"><span class="status-orb"><svg><use href="#i-growth"/></svg></span><div><p class="eyebrow">Growth status</p><h2>${escapeHtml(data.change.label)}</h2></div></div>
        <p>${escapeHtml(data.change.detail)}</p>
        <dl>
          <div><dt>Previous fitted rate</dt><dd>${Number.isFinite(data.change.previousRate) ? `${signed(data.change.previousRate, 2)} kg/week` : "Not available"}</dd></div>
          <div><dt>Current fitted rate</dt><dd>${Number.isFinite(data.change.currentRate) ? `${signed(data.change.currentRate, 2)} kg/week` : "Not available"}</dd></div>
        </dl>
      </article>
      <article class="card card-pad">
        <div class="card-head"><div class="card-title"><h3>Forecast stability</h3><p>How much the central adult estimate moved after the latest reading.</p></div><span class="status-badge ${f.stability.label === "Stable" ? "good" : ""}">${escapeHtml(f.stability.label)}</span></div>
        <p>${escapeHtml(f.stability.detail)}</p>
        ${f.ready ? `<div class="result-list"><div class="comparison-row"><span>Current central estimate</span><strong>${formatNumber(f.adult.median, 1)} kg</strong></div><div class="comparison-row"><span>Change after latest reading</span><strong>${Number.isFinite(f.stability.changeKg) ? `${signed(f.stability.changeKg, 1)} kg` : "—"}</strong></div><div class="comparison-row"><span>Estimated growth reached</span><strong>${formatNumber(f.progressPercent, 0)}%</strong></div></div>` : ""}
      </article>
    </div>`;
}

function growthChart(data) {
  const rangeButtons = [["4w", "4W"], ["3m", "3M"], ["6m", "6M"], ["1y", "1Y"], ["all", "All"]];
  const layerButtons = [["actual", "Actual"], ["trend", "Trend"], ["forecast", "Forecast"], ["reference", "Reference"], ["milestones", "Milestones"]];
  return `<article class="card chart-card">
    <div class="screen-toolbar">
      <div class="toolbar-group">${rangeButtons.map(([value, label]) => `<button class="chip ${state.ui.chartRange === value ? "is-active" : ""}" data-action="chart-range" data-value="${value}" type="button">${label}</button>`).join("")}</div>
      <div class="toolbar-group">${layerButtons.map(([value, label]) => `<button class="chip ${state.ui.chartLayers[value] ? "is-active" : ""}" data-action="chart-layer" data-value="${value}" type="button">${label}</button>`).join("")}</div>
    </div>
    ${buildChartSvg(data)}
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-line"></span>Actual weights</span>
      <span class="legend-item"><span class="legend-line forecast"></span>Personal forecast</span>
      <span class="legend-item"><span class="legend-line band"></span>Forecast range</span>
      <span class="legend-item"><span class="legend-line reference"></span>50 kg reference trajectory</span>
    </div>
  </article>`;
}

function buildChartSvg(data) {
  const allPoints = data.points;
  if (!allPoints.length) return `<div class="chart-empty">No chart data.</div>`;
  const latest = allPoints.at(-1);
  const rangeDays = { "4w": 28, "3m": 92, "6m": 183, "1y": 365, all: Infinity }[state.ui.chartRange];
  const minAge = rangeDays === Infinity ? Math.max(0, allPoints[0].ageDays - 10) : Math.max(0, latest.ageDays - rangeDays);
  const maxAge = state.ui.chartLayers.forecast ? Math.max(latest.ageDays + 168, latest.ageDays + 28) : latest.ageDays + 7;
  const actual = allPoints.filter(point => point.ageDays >= minAge);
  const forecastPoints = data.forecast.ready ? data.forecast.forecastPoints.filter(point => point.ageDays >= latest.ageDays && point.ageDays <= maxAge) : [];
  const reference = [];
  for (let age = minAge; age <= maxAge; age += Math.max(7, Math.round((maxAge - minAge) / 80))) reference.push({ ageDays: age, weightKg: state.profile.referenceAdultKg * growthRatio(age) });
  const trend = smoothTrend(actual);
  const weights = actual.map(point => point.weightKg)
    .concat(forecastPoints.flatMap(point => [point.wideLowKg, point.wideHighKg, point.centralKg]))
    .concat(reference.map(point => point.weightKg));
  let minWeight = Math.max(0, Math.min(...weights) - 2);
  let maxWeight = Math.max(...weights) + 3;
  if (maxWeight - minWeight < 10) maxWeight = minWeight + 10;
  const W = 1000, H = 420, pad = { left: 55, right: 22, top: 25, bottom: 48 };
  const x = age => pad.left + (age - minAge) / Math.max(1, maxAge - minAge) * (W - pad.left - pad.right);
  const y = weight => pad.top + (1 - (weight - minWeight) / Math.max(1, maxWeight - minWeight)) * (H - pad.top - pad.bottom);
  const linePath = points => points.length ? `M ${points.map(point => `${x(point.ageDays).toFixed(1)} ${y(point.weightKg ?? point.centralKg).toFixed(1)}`).join(" L ")}` : "";
  const bandPath = forecastPoints.length ? `M ${forecastPoints.map(point => `${x(point.ageDays).toFixed(1)} ${y(point.likelyHighKg).toFixed(1)}`).join(" L ")} L ${[...forecastPoints].reverse().map(point => `${x(point.ageDays).toFixed(1)} ${y(point.likelyLowKg).toFixed(1)}`).join(" L ")} Z` : "";
  const yTicks = Array.from({ length: 6 }, (_, index) => minWeight + (maxWeight - minWeight) * index / 5);
  const xTicks = Array.from({ length: 5 }, (_, index) => minAge + (maxAge - minAge) * index / 4);
  const milestoneMarkers = state.ui.chartLayers.milestones ? data.milestones.weight.filter(item => item.date).map(item => ({ ...item, ageDays: ageDaysOn(item.date, state.profile.dob) })).filter(item => item.ageDays >= minAge && item.ageDays <= maxAge) : [];
  chartInteraction.points = actual;
  chartInteraction.x = x;
  chartInteraction.y = y;
  return `<div class="chart-stage" id="chartStage">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Reggie’s weight chart">
      ${yTicks.map(value => `<g><line x1="${pad.left}" x2="${W - pad.right}" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)"/><text x="${pad.left - 10}" y="${y(value) + 4}" text-anchor="end" fill="var(--faint)" font-size="12">${formatNumber(value, 0)}</text></g>`).join("")}
      ${xTicks.map(age => `<text x="${x(age)}" y="${H - 16}" text-anchor="middle" fill="var(--faint)" font-size="12">${formatDate(addDays(parseIso(state.profile.dob), Math.round(age)), { month: "short", year: maxAge - minAge > 330 ? "2-digit" : undefined })}</text>`).join("")}
      ${state.ui.chartLayers.forecast && bandPath ? `<path d="${bandPath}" fill="color-mix(in srgb, var(--copper) 18%, transparent)" stroke="none"/>` : ""}
      ${state.ui.chartLayers.reference ? `<path d="${linePath(reference)}" fill="none" stroke="var(--faint)" stroke-width="2.5" stroke-dasharray="8 8"/>` : ""}
      ${state.ui.chartLayers.trend && trend.length > 1 ? `<path d="${linePath(trend)}" fill="none" stroke="color-mix(in srgb, var(--accent) 55%, var(--text))" stroke-width="7" opacity=".18"/><path d="${linePath(trend)}" fill="none" stroke="var(--accent)" stroke-width="3.5"/>` : ""}
      ${state.ui.chartLayers.forecast && forecastPoints.length > 1 ? `<path d="${linePath(forecastPoints)}" fill="none" stroke="var(--copper)" stroke-width="3" stroke-dasharray="10 8"/>` : ""}
      ${state.ui.chartLayers.actual ? actual.map((point, index) => `<circle class="chart-point" data-action="chart-point" data-index="${index}" cx="${x(point.ageDays)}" cy="${y(point.weightKg)}" r="${index === actual.length - 1 ? 7 : 5.5}" fill="var(--panel)" stroke="var(--accent)" stroke-width="3" tabindex="0"/>`).join("") : ""}
      ${milestoneMarkers.map(item => `<g><line x1="${x(item.ageDays)}" x2="${x(item.ageDays)}" y1="${pad.top}" y2="${H-pad.bottom}" stroke="color-mix(in srgb, var(--copper) 28%, transparent)" stroke-dasharray="3 7"/><circle cx="${x(item.ageDays)}" cy="${pad.top + 8}" r="5" fill="var(--copper)"/></g>`).join("")}
    </svg>
    <div class="chart-tooltip is-hidden" id="chartTooltip"></div>
  </div>`;
}

function growthRatio(ageDays) {
  const weeks = Math.max(ageDays / 7, .1);
  if (weeks < 8) return .012 + (.136 - .012) * (weeks / 8) ** 1.35;
  if (ageDays <= 365) return Math.min(.92, Math.max(.13, (36.61 * Math.log(weeks) - 62.39) / 100));
  const p365 = Math.min(.94, Math.max(.86, (36.61 * Math.log(365 / 7) - 62.39) / 100));
  return Math.min(.998, 1 - (1 - p365) * Math.exp(-(ageDays - 365) / 210));
}

function smoothTrend(points) {
  if (points.length < 3) return points.map(point => ({ ageDays: point.ageDays, weightKg: point.weightKg }));
  const bandwidth = Math.max(21, Math.min(70, (points.at(-1).ageDays - points[0].ageDays) / 4));
  return points.map(target => {
    const weighted = points.map(point => {
      const distance = Math.abs(point.ageDays - target.ageDays) / bandwidth;
      const weight = distance >= 1 ? 0 : (1 - distance ** 3) ** 3;
      return { x: point.ageDays, y: point.weightKg, weight };
    }).filter(point => point.weight > 0);
    const total = weighted.reduce((sum, point) => sum + point.weight, 0) || 1;
    const xMean = weighted.reduce((sum, point) => sum + point.x * point.weight, 0) / total;
    const yMean = weighted.reduce((sum, point) => sum + point.y * point.weight, 0) / total;
    const denominator = weighted.reduce((sum, point) => sum + point.weight * (point.x - xMean) ** 2, 0);
    const slope = denominator ? weighted.reduce((sum, point) => sum + point.weight * (point.x - xMean) * (point.y - yMean), 0) / denominator : 0;
    return { ageDays: target.ageDays, weightKg: yMean + slope * (target.ageDays - xMean) };
  });
}

function bindChartEvents() {
  const stage = document.getElementById("chartStage");
  if (!stage) return;
  stage.addEventListener("click", event => { if (!event.target.closest(".chart-point")) hideChartTooltip(); });
}

function showChartTooltip(element, index) {
  const tooltip = document.getElementById("chartTooltip");
  const stage = document.getElementById("chartStage");
  const point = chartInteraction.points?.[index];
  if (!tooltip || !stage || !point) return;
  const svg = stage.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  const cx = Number(element.getAttribute("cx")) / 1000 * rect.width;
  const cy = Number(element.getAttribute("cy")) / 420 * rect.height;
  const previous = chartInteraction.points[index - 1];
  const delta = previous ? point.weightKg - previous.weightKg : null;
  tooltip.innerHTML = `<strong>${formatDate(parseIso(point.date), { day: "numeric", month: "long", year: "numeric" })}</strong><span class="answer-value">${formatNumber(point.weightKg, 1)} kg</span><small>Age: ${escapeHtml(exactAgeLabel(point.ageDays))}</small>${previous ? `<small>Change: ${signed(delta, 1)} kg over ${point.ageDays - previous.ageDays} days</small>` : ""}`;
  tooltip.style.left = `${Math.min(rect.width - 105, Math.max(105, cx))}px`;
  tooltip.style.top = `${Math.max(110, cy)}px`;
  tooltip.classList.remove("is-hidden");
}

function hideChartTooltip() {
  document.getElementById("chartTooltip")?.classList.add("is-hidden");
}

function growthForecasts(data) {
  const models = [...data.forecast.models].sort((a, b) => b.weight - a.weight);
  return `<article class="card card-pad">
      <div class="card-head"><div class="card-title"><h3>Model comparison</h3><p>The combined estimate gives greater influence to models that have performed better against Reggie’s later weights.</p></div></div>
      <div class="model-carousel">
        <article class="model-card is-leading"><span class="status-badge good">Combined</span><div class="model-value">${formatNumber(data.forecast.adult.median, 1)} kg</div><p>Likely ${formatNumber(data.forecast.adult.likelyLow, 1)}–${formatNumber(data.forecast.adult.likelyHigh, 1)} kg</p><div class="model-bar"><span style="width:100%"></span></div></article>
        ${models.map((model, index) => `<article class="model-card ${index === 0 ? "is-leading" : ""}"><span class="status-badge">${escapeHtml(MODEL_LABELS[model.name] || model.name)}</span><div class="model-value">${formatNumber(model.adultKg, 1)} kg</div><p>${formatNumber(model.weight * 100, 0)}% influence · fit error ${formatNumber(model.rmse, 2)} kg</p><div class="model-bar"><span style="width:${Math.max(4, model.weight * 100)}%"></span></div></article>`).join("")}
      </div>
    </article>
    <div class="grid-equal">
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Monte Carlo range</h3><p>Simulated from model disagreement, measurement noise and forecast distance.</p></div></div><div class="result-list"><div class="comparison-row"><span>Central estimate</span><strong>${formatNumber(data.forecast.adult.median, 1)} kg</strong></div><div class="comparison-row"><span>Most likely range</span><strong>${formatNumber(data.forecast.adult.likelyLow, 1)}–${formatNumber(data.forecast.adult.likelyHigh, 1)} kg</strong></div><div class="comparison-row"><span>Wider model range</span><strong>${formatNumber(data.forecast.adult.wideLow, 1)}–${formatNumber(data.forecast.adult.wideHigh, 1)} kg</strong></div></div></article>
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Forecast checkpoints</h3><p>Current combined projection.</p></div></div><div class="result-list">${[28,56,84].map(days => { const dist = data.forecast.distributionAtAge(data.latest.ageDays + days); return `<div class="comparison-row"><span>${days / 7} weeks</span><strong>${formatNumber(dist.median ?? data.forecast.predictAtAge(data.latest.ageDays + days), 1)} kg</strong></div>`; }).join("")}</div></article>
    </div>`;
}

function growthAccuracy(data) {
  const backtest = data.forecast.backtest;
  const modelRows = Object.entries(backtest.byModel).sort((a, b) => a[1].mae - b[1].mae);
  if (!backtest.records.length) return emptyState("i-history", "Accuracy history is still building", "Forecasts need later actual weights before they can be scored. The app will backtest automatically as the history grows.");
  return `<div class="metric-grid">
      ${metricCard("4-week error", backtest.byHorizon[28] ? `${formatNumber(backtest.byHorizon[28].mae, 2)} kg` : "—", "Mean absolute error")}
      ${metricCard("8-week error", backtest.byHorizon[56] ? `${formatNumber(backtest.byHorizon[56].mae, 2)} kg` : "—", "Mean absolute error")}
      ${metricCard("12-week error", backtest.byHorizon[84] ? `${formatNumber(backtest.byHorizon[84].mae, 2)} kg` : "—", "Mean absolute error")}
      ${metricCard("Forecast bias", Number.isFinite(backtest.bias) ? `${signed(backtest.bias, 2)} kg` : "—", backtest.bias > 0 ? "Predictions tend to run high" : backtest.bias < 0 ? "Predictions tend to run low" : "No consistent bias")}
    </div>
    <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Model performance</h3><p>Lower error is better. These results automatically affect the combined-model weighting.</p></div></div><div class="accuracy-list">${modelRows.map(([name, result], index) => `<div class="accuracy-row"><strong>${escapeHtml(MODEL_LABELS[name] || name)}</strong><span>${formatNumber(result.mae, 2)} kg average error</span><span>${index === 0 ? "Best so far" : `${result.count} scored forecasts`}</span></div>`).join("")}</div></article>`;
}

function renderFeeding(data) {
  if (!data.latest || !data.food) {
    dom.app.innerHTML = `<section class="screen">${emptyState("i-food", "Feeding calculation needs a weight", "Pickle Pants uses your configured bodyweight percentage and always divides the result across two meals.", "Add weight")}</section>`;
    return;
  }
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="feeding-hero">
      <article class="daily-food-card"><p class="eyebrow">Today</p><h2>Daily raw food</h2><div class="food-total">${formatNumber(data.food.dailyGrams, 0)} g</div><div class="food-unit">${formatNumber(data.food.percent, 2)}% of current bodyweight</div><div class="meal-grid"><div class="meal-card"><small>Morning</small><strong>${formatNumber(data.food.perMealGrams, 0)} g</strong></div><div class="meal-card"><small>Evening</small><strong>${formatNumber(data.food.perMealGrams, 0)} g</strong></div></div></article>
      <div class="feeding-facts"><article class="fact-card"><small>Meals</small><strong>${FIXED_MEALS_PER_DAY} every day</strong><p>This is fixed and does not change with age.</p></article><article class="fact-card"><small>Weekly requirement</small><strong>${formatNumber(data.food.weeklyKg, 1)} kg</strong><p>Calculated from the current configured percentage.</p></article><article class="fact-card"><small>Monthly requirement</small><strong>${formatNumber(data.food.monthlyKg, 1)} kg</strong><p>Uses an average month of 30.44 days.</p></article></div>
    </div>

    <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Feeding forecast</h3><p>Combines the personalised weight forecast with the percentage active at each future age.</p></div></div><div class="forecast-strip">${data.foodForecast.map(item => `<article class="forecast-card ${item.days === 0 ? "is-now" : ""}"><span class="status-badge">${item.days === 0 ? "Now" : `${item.days / 7} weeks`}</span><div class="forecast-value">${formatNumber(item.dailyGrams, 0)} g</div><small>${formatNumber(item.perMealGrams, 0)} g per meal · ${formatNumber(item.percent, 2)}%</small></article>`).join("")}</div></article>

    <div class="grid-two">
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Current feeding profile</h3><p>${escapeHtml(data.food.band.label)}</p></div><button class="button ghost" data-action="open-feeding-profile" type="button">Edit profile</button></div><div class="result-list"><div class="comparison-row"><span>Active percentage</span><strong>${formatNumber(data.food.percent, 2)}%</strong></div><div class="comparison-row"><span>Current weight</span><strong>${formatNumber(data.latest.weightKg, 1)} kg</strong></div><div class="comparison-row"><span>Calculation</span><strong>Weight × ${formatNumber(data.food.percent, 2)}%</strong></div></div></article>
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Supplements</h3><p>Target grams converted into calibrated practical spoon measures.</p></div><button class="button ghost" data-action="add-supplement" type="button"><svg><use href="#i-plus"/></svg>Add</button></div>${renderSupplementList(data.supplements)}</article>
    </div>
  </section>`;
}

function renderSupplementList(plans) {
  if (!plans.length) return `<div class="empty-state"><div class="empty-state-inner"><p>No active supplements.</p></div></div>`;
  return `<div class="supplement-list">${plans.map(plan => {
    const calibrated = plan.calibration.ready;
    const dose = plan.targetGrams == null ? "Dose rule incomplete" : !calibrated ? `${formatNumber(plan.targetGrams, 2)} g/day` : plan.spoons?.label || "—";
    const detail = plan.targetGrams == null ? "Enter the manufacturer dose." : !calibrated ? "Add three teaspoon calibration trials to convert this into spoons." : `${formatNumber(plan.targetGrams, 2)} g target · ${formatNumber(plan.spoons.deliveredGrams, 2)} g delivered · ${signed(plan.spoons.differenceGrams, 2)} g difference`;
    return `<button class="supplement-card" data-action="edit-supplement" data-id="${escapeHtml(plan.id)}" type="button"><div class="supplement-top"><div><h3>${escapeHtml(plan.name)}</h3><div class="supplement-dose">${escapeHtml(dose)}</div><p>${escapeHtml(detail)}</p></div><svg><use href="#i-chevron"/></svg></div><div class="supplement-meta"><span class="status-badge ${calibrated && ["Excellent","Good"].includes(plan.calibration.quality) ? "good" : calibrated ? "warn" : ""}">${escapeHtml(plan.calibration.quality)}</span><span class="status-badge">${escapeHtml(timingLabel(plan.timing))}</span></div></button>`;
  }).join("")}</div>`;
}

function renderForecastLab(data) {
  if (!data.latest) {
    dom.app.innerHTML = `<section class="screen">${emptyState("i-flask", "Forecast Lab needs weight data", "Add at least one weight before running temporary scenarios.", "Add weight")}</section>`;
    return;
  }
  const scenario = state.ui.scenario;
  const options = {
    growthAdjustmentPercent: Number(scenario.growthAdjustmentPercent) || 0,
    recentDays: scenario.dataWindow === "8w" ? 56 : scenario.dataWindow === "12w" ? 84 : null,
    hypotheticalWeightKg: scenario.hypotheticalWeightKg === "" ? null : Number(scenario.hypotheticalWeightKg)
  };
  const result = scenarioForecast(state.entries, state.profile, options);
  const normalAdult = data.forecast.adult.median;
  const scenarioAdult = result.forecast.adult.median;
  const difference = scenarioAdult - normalAdult;
  const target50 = findProjectedDateForWeight(50, result.forecast, state.profile.dob);
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="lab-layout">
      <article class="card lab-controls">
        <div class="control-group"><span class="control-label">Growth scenario</span><div class="choice-grid">${[0,-5,-10,-20].map(value => `<button class="choice-button ${Number(scenario.growthAdjustmentPercent) === value ? "is-active" : ""}" data-action="scenario-adjust" data-value="${value}" type="button">${value === 0 ? "Current" : `${value}%`}</button>`).join("")}</div></div>
        <div class="control-group"><span class="control-label">Data window</span><div class="choice-grid">${[["all","All readings"],["8w","Last 8 weeks"],["12w","Last 12 weeks"]].map(([value,label]) => `<button class="choice-button ${scenario.dataWindow === value ? "is-active" : ""}" data-action="scenario-window" data-value="${value}" type="button">${label}</button>`).join("")}</div></div>
        <div class="control-group"><label for="hypotheticalWeight">Hypothetical next weight</label><div class="field"><input id="hypotheticalWeight" type="number" inputmode="decimal" step="0.1" min="0" max="150" value="${escapeHtml(scenario.hypotheticalWeightKg)}" placeholder="Optional kg" /></div></div>
        <button class="button ghost" data-action="scenario-reset" type="button">Reset scenario</button>
      </article>
      <article class="lab-result"><p class="eyebrow">Scenario result</p><h2>Adult estimate</h2><div class="lab-result-main"><div class="value">${formatNumber(scenarioAdult, 1)} kg</div><p>Likely ${formatNumber(result.forecast.adult.likelyLow, 1)}–${formatNumber(result.forecast.adult.likelyHigh, 1)} kg</p></div><div class="lab-comparison"><div class="comparison-row"><span>Normal forecast</span><strong>${formatNumber(normalAdult, 1)} kg</strong></div><div class="comparison-row"><span>Scenario forecast</span><strong>${formatNumber(scenarioAdult, 1)} kg</strong></div><div class="comparison-row"><span>Difference</span><strong>${signed(difference, 1)} kg</strong></div><div class="comparison-row"><span>Estimated 50 kg date</span><strong>${target50 ? formatDate(target50, { day: "numeric", month: "short", year: "numeric" }) : "Not reached in model"}</strong></div></div><div class="scenario-note">Scenario only — Reggie’s actual records and normal forecast have not been changed.</div></article>
    </div>
  </section>`;
  document.getElementById("hypotheticalWeight")?.addEventListener("input", event => { state.ui.scenario.hypotheticalWeightKg = event.target.value; saveState(); render(); });
}

function renderMore(data) {
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="more-grid">
      ${moreCard("ask", "Ask Pickle Pants", "Ask questions about gains, milestones, feeding, trends and forecast performance.", "i-chat")}
      ${moreCard("history", "Weight history", `${data.points.length} included reading${data.points.length === 1 ? "" : "s"}; edit, exclude or remove individual entries.`, "i-history")}
      ${moreCard("milestones", "Milestones", "A visual timeline of completed and projected weight, age and growth events.", "i-trophy")}
      ${moreCard("data", "Data & settings", "Profile, feeding bands, backups, exports, theme and app maintenance.", "i-settings")}
    </div>
    ${undoRecord ? `<button class="button ghost" data-action="undo" type="button">Undo last ${escapeHtml(undoRecord.label)}</button>` : ""}
  </section>`;
}

function renderAssistant(data) {
  const questions = [
    "How much has he gained this month?",
    "When might he reach 50 kg?",
    "Has growth started slowing?",
    "How accurate are the forecasts?",
    "What will he eat in eight weeks?"
  ];
  const messages = state.ui.assistantMessages;
  dom.app.innerHTML = `<section class="screen"><div class="assistant-shell">
    <div class="assistant-intro"><h2>Ask about Reggie’s data</h2><p>Answers come from the tested calculation engine. The assistant interprets the question but does not invent the arithmetic.</p><div class="question-chips">${questions.map(question => `<button class="question-chip" data-action="ask-question" data-question="${escapeHtml(question)}" type="button">${escapeHtml(question)}</button>`).join("")}</div></div>
    <div class="assistant-thread" id="assistantThread">${messages.length ? messages.map(message => `<div class="message ${message.role}">${message.html || escapeHtml(message.text)}</div>`).join("") : `<div class="message assistant">Ask a question or choose one of the prompts above.</div>`}</div>
    <form class="assistant-form" id="assistantForm"><input id="assistantInput" type="text" maxlength="300" placeholder="Ask about weight, growth, feeding or forecasts…" autocomplete="off" /><button class="button primary" type="submit"><svg><use href="#i-arrow"/></svg><span class="desktop-only">Ask</span></button></form>
  </div></section>`;
  const form = document.getElementById("assistantForm");
  form.addEventListener("submit", event => { event.preventDefault(); const input = document.getElementById("assistantInput"); if (input.value.trim()) askQuestion(input.value.trim()); });
  requestAnimationFrame(() => { const thread = document.getElementById("assistantThread"); if (thread) thread.scrollTop = thread.scrollHeight; });
}

function askQuestion(question) {
  const data = analytics();
  const answer = answerQuestion(question, data);
  state.ui.assistantMessages.push({ role: "user", text: question }, { role: "assistant", html: answer });
  state.ui.assistantMessages = state.ui.assistantMessages.slice(-30);
  state.ui.route = "ask";
  saveState();
  render();
}

function answerQuestion(question, data) {
  if (!data.latest) return "Add a weight first so I have Reggie’s data to analyse.";
  const q = question.toLowerCase();
  if ((q.includes("gain") || q.includes("gained")) && (q.includes("month") || q.includes("30"))) {
    const cutoff = data.latest.ageDays - 30;
    const base = [...data.points].reverse().find(point => point.ageDays <= cutoff) || data.points[0];
    const days = data.latest.ageDays - base.ageDays;
    const gain = data.latest.weightKg - base.weightKg;
    return `<strong>Last-month change</strong><span class="answer-value">${signed(gain, 1)} kg</span><small>From ${formatNumber(base.weightKg, 1)} kg to ${formatNumber(data.latest.weightKg, 1)} kg over ${days} days. That is ${signed(gain / Math.max(1, days) * 7, 2)} kg per week.</small>`;
  }
  if (q.includes("50") && (q.includes("when") || q.includes("reach"))) {
    const date = findProjectedDateForWeight(50, data.forecast, state.profile.dob);
    return date ? `<strong>Projected 50 kg date</strong><span class="answer-value">${formatDate(date, { day: "numeric", month: "long", year: "numeric" })}</span><small>This comes from the current combined forecast and will move as new weights are added.</small>` : `<strong>50 kg projection</strong><span class="answer-value">Not currently available</span><small>The current model does not reach 50 kg within its forecast horizon, or there is not enough data.</small>`;
  }
  if (q.includes("slow")) {
    return `<strong>${escapeHtml(data.change.label)}</strong><span class="answer-value">${Number.isFinite(data.change.currentRate) ? `${formatNumber(data.change.currentRate, 2)} kg/week` : "Building"}</span><small>${escapeHtml(data.change.detail)}${Number.isFinite(data.change.previousRate) ? ` The preceding fitted rate was ${formatNumber(data.change.previousRate, 2)} kg/week.` : ""}</small>`;
  }
  if (q.includes("accur") || q.includes("error")) {
    const backtest = data.forecast.backtest;
    if (!backtest.records.length) return `<strong>Forecast accuracy</strong><span class="answer-value">Still building</span><small>The app needs predictions followed by later actual weights before it can score them.</small>`;
    const best = Object.entries(backtest.byModel).sort((a,b) => a[1].mae - b[1].mae)[0];
    return `<strong>Forecast accuracy</strong><span class="answer-value">${formatNumber(backtest.overallMae, 2)} kg</span><small>Average absolute historical error across scored forecasts. The best-performing model so far is ${escapeHtml(MODEL_LABELS[best[0]] || best[0])} at ${formatNumber(best[1].mae, 2)} kg.</small>`;
  }
  if ((q.includes("eat") || q.includes("food") || q.includes("feed")) && (q.includes("8") || q.includes("eight"))) {
    const item = data.foodForecast.find(row => row.days === 56);
    return `<strong>Eight-week feeding projection</strong><span class="answer-value">${formatNumber(item.dailyGrams, 0)} g/day</span><small>${formatNumber(item.perMealGrams, 0)} g at each of two meals, using a projected weight of ${formatNumber(item.projectedWeightKg, 1)} kg and the ${formatNumber(item.percent, 2)}% age-band setting.</small>`;
  }
  if (q.includes("adult") || q.includes("final") || q.includes("estimate")) {
    return `<strong>Adult-weight forecast</strong><span class="answer-value">${formatNumber(data.forecast.adult.median, 1)} kg</span><small>Most likely range ${formatNumber(data.forecast.adult.likelyLow, 1)}–${formatNumber(data.forecast.adult.likelyHigh, 1)} kg. The estimate is currently ${escapeHtml(data.forecast.stability.label.toLowerCase())}.</small>`;
  }
  if (q.includes("fastest")) {
    const fastest = [...data.metrics.intervals].sort((a,b) => b.kgPerWeek - a.kgPerWeek)[0];
    return fastest ? `<strong>Fastest recorded interval</strong><span class="answer-value">${formatNumber(fastest.kgPerWeek, 2)} kg/week</span><small>${formatDate(parseIso(fastest.from.date))} to ${formatDate(parseIso(fastest.to.date))}: ${signed(fastest.changeKg, 1)} kg over ${fastest.days} days.</small>` : "Two included weights are needed to calculate the fastest interval.";
  }
  if (q.includes("supplement")) {
    const active = data.supplements.filter(item => item.targetGrams != null);
    return active.length ? `<strong>Current supplement plan</strong><span class="answer-value">${active.length} active</span><small>${active.map(item => `${escapeHtml(item.name)}: ${item.spoons ? escapeHtml(item.spoons.label) : `${formatNumber(item.targetGrams, 2)} g; calibration needed`}`).join("<br>")}</small>` : "No active supplement has a complete dose rule yet.";
  }
  if (q.includes("summary") || q.includes("month")) return `<strong>Current summary</strong><span class="answer-value">${formatNumber(data.latest.weightKg, 1)} kg</span><small>${escapeHtml(generateInsight(state.entries, state.profile, data.forecast))}</small>`;
  return `<strong>Reggie’s current position</strong><span class="answer-value">${formatNumber(data.latest.weightKg, 1)} kg</span><small>${escapeHtml(generateInsight(state.entries, state.profile, data.forecast))} Try asking about 50 kg, growth slowing, forecast accuracy, adult weight, feeding in eight weeks or the fastest interval.</small>`;
}

function renderHistory(data) {
  const all = normaliseEntries(state.entries, state.profile.dob).sort((a,b) => b.date.localeCompare(a.date));
  const forecast = data.forecast;
  const filtered = all.filter(entry => {
    if (state.ui.historyFilter === "included") return !entry.excluded;
    if (state.ui.historyFilter === "excluded") return entry.excluded;
    if (state.ui.historyFilter === "questionable") return entryIssuesForExisting(entry, forecast).some(issue => issue.severity === "warning") && !entry.confirmed;
    return true;
  });
  const groups = groupByMonth(filtered);
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="history-toolbar"><div class="toolbar-group">${[["all","All"],["included","Included"],["excluded","Excluded"],["questionable","Questionable"]].map(([value,label]) => `<button class="chip ${state.ui.historyFilter === value ? "is-active" : ""}" data-action="history-filter" data-value="${value}" type="button">${label}</button>`).join("")}</div><button class="button primary" data-action="add-weight" type="button"><svg><use href="#i-plus"/></svg>Add weight</button></div>
    ${filtered.length ? `<div class="history-groups">${Object.entries(groups).map(([month, entries]) => `<section class="history-month"><h3>${escapeHtml(month)}</h3><div class="history-list">${entries.map((entry, index) => historyRow(entry, all, forecast)).join("")}</div></section>`).join("")}</div>` : emptyState("i-history", "No matching weights", "Change the filter or add another weight.")}
  </section>`;
}

function historyRow(entry, allDescending, forecast) {
  const chronological = [...allDescending].sort((a,b) => a.date.localeCompare(b.date));
  const index = chronological.findIndex(item => item.id === entry.id);
  const previous = index > 0 ? chronological[index - 1] : null;
  const delta = previous ? entry.weightKg - previous.weightKg : null;
  const issues = entryIssuesForExisting(entry, forecast);
  const questionable = issues.some(issue => issue.severity === "warning") && !entry.confirmed;
  return `<article class="history-item">
    <div class="history-date"><strong>${formatDate(parseIso(entry.date), { weekday: "short", day: "numeric", month: "short" })}</strong><small>${entry.excluded ? "Excluded from calculations" : questionable ? "Needs confirmation" : entry.notes ? escapeHtml(entry.notes) : exactAgeLabel(ageDaysOn(entry.date, state.profile.dob))}</small></div>
    <div class="history-value">${formatNumber(entry.weightKg, 1)} kg${delta == null ? "" : `<small style="display:block;color:var(--muted);font-size:.72rem">${signed(delta,1)} kg</small>`}</div>
    <div class="history-actions">
      ${questionable ? `<button class="mini-button" data-action="confirm-entry" data-id="${entry.id}" type="button" aria-label="Confirm"><svg><use href="#i-check"/></svg></button>` : ""}
      <button class="mini-button" data-action="toggle-exclude" data-id="${entry.id}" type="button" aria-label="${entry.excluded ? "Include" : "Exclude"}"><svg><use href="#i-alert"/></svg></button>
      <button class="mini-button" data-action="edit-entry" data-id="${entry.id}" type="button" aria-label="Edit"><svg><use href="#i-edit"/></svg></button>
      <button class="mini-button danger" data-action="delete-entry" data-id="${entry.id}" type="button" aria-label="Delete"><svg><use href="#i-trash"/></svg></button>
    </div>
  </article>`;
}

function entryIssuesForExisting(entry, forecast) {
  return checkWeightInput({ dateIso: entry.date, weightKg: entry.weightKg, entries: state.entries.filter(item => item.id !== entry.id), dobIso: state.profile.dob, forecast });
}

function renderMilestones(data) {
  const type = state.ui.milestoneType;
  const items = data.milestones[type] || [];
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="segmented timeline-switch">${[["weight","Weight"],["age","Age"],["growth","Growth"]].map(([value,label]) => `<button class="segment-button ${type === value ? "is-active" : ""}" data-action="milestone-type" data-value="${value}" type="button">${label}</button>`).join("")}</div>
    ${items.length ? `<article class="card card-pad"><div class="milestone-timeline">${items.map(item => `<div class="milestone-item ${item.complete ? "complete" : ""}"><strong>${item.complete ? "✓ " : "○ "}${escapeHtml(item.label)}</strong><small>${item.date ? `${item.complete ? "Completed" : "Estimated"} ${formatDate(parseIso(item.date), { day: "numeric", month: "long", year: "numeric" })}` : "No projected date"} · ${escapeHtml(item.detail)}</small></div>`).join("")}</div></article>` : emptyState("i-trophy", "No milestones yet", "Add weight data to create the timeline.")}
  </section>`;
}

function renderDataSettings(data) {
  dom.app.innerHTML = `<section class="screen page-grid">
    <div class="grid-equal">
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Reggie’s profile</h3><p>Core settings used throughout the app.</p></div></div><div class="form-grid two"><label class="field"><span>Name</span><input id="profileName" type="text" maxlength="50" value="${escapeHtml(state.profile.name)}" /></label><label class="field"><span>Date of birth</span><input id="profileDob" type="date" value="${escapeHtml(state.profile.dob)}" /></label><label class="field"><span>Reference adult weight</span><input id="profileReference" type="number" min="20" max="100" step="0.5" value="${escapeHtml(state.profile.referenceAdultKg)}" /></label><label class="field"><span>Meals per day</span><input value="2 — fixed" disabled /></label></div><button class="button primary" data-action="save-profile" type="button" style="margin-top:14px">Save profile</button></article>
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Data ownership</h3><p>Everything remains in this browser unless you export it.</p></div></div><div class="data-actions"><button class="button ghost" data-action="export-json" type="button"><svg><use href="#i-download"/></svg>Full JSON backup</button><button class="button ghost" data-action="import-json" type="button"><svg><use href="#i-upload"/></svg>Restore JSON</button><button class="button ghost" data-action="export-csv" type="button"><svg><use href="#i-download"/></svg>Weight CSV</button><button class="button ghost" data-action="calendar" type="button"><svg><use href="#i-calendar"/></svg>Next weigh-in</button></div></article>
    </div>
    <div class="grid-equal">
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Appearance</h3><p>Current preference: ${escapeHtml(capitalise(state.profile.theme))}</p></div></div><div class="result-list"><button class="settings-row" id="themeButtonInline" type="button"><span class="settings-row-main"><span class="settings-row-icon"><svg><use href="#i-theme"/></svg></span><span><strong>Cycle theme</strong><small>System, light and dark</small></span></span><svg><use href="#i-chevron"/></svg></button><div class="settings-row"><span class="settings-row-main"><span class="settings-row-icon"><svg><use href="#i-check"/></svg></span><span><strong>Offline ready</strong><small>Service worker caches the application shell.</small></span></span><span class="status-badge good">Active</span></div></div></article>
      <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Application</h3><p>Pickle Pants ${APP_VERSION}</p></div></div><div class="result-list"><div class="comparison-row"><span>Saved weights</span><strong>${state.entries.length}</strong></div><div class="comparison-row"><span>Forecast snapshots</span><strong>${state.forecastSnapshots.length}</strong></div><div class="comparison-row"><span>Active supplements</span><strong>${state.supplements.filter(item => item.enabled).length}</strong></div></div></article>
    </div>
    <article class="card card-pad"><div class="card-head"><div class="card-title"><h3>Automatic snapshots</h3><p>Created before important edits and retained locally for 30 days.</p></div><span class="status-badge">${state.snapshots.length} saved</span></div>${state.snapshots.length ? `<div class="accuracy-list">${[...state.snapshots].reverse().slice(0, 6).map(item => `<div class="accuracy-row"><strong>${escapeHtml(capitalise(item.label))}</strong><span>${formatDate(new Date(item.createdAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button class="text-button" data-action="restore-snapshot" data-id="${item.id}" type="button">Restore</button></div>`).join("")}</div>` : `<p>No automatic snapshots yet. One will be created before the next significant edit.</p>`}</article>
    <article class="card card-pad danger-zone"><div class="card-head"><div class="card-title"><h3>Clear local data</h3><p>This cannot be recovered unless you have exported a JSON backup.</p></div></div><button class="button danger ghost" data-action="clear-data" type="button">Clear everything</button></article>
  </section>`;
  document.getElementById("themeButtonInline")?.addEventListener("click", cycleTheme);
}

function renderHomeInsightCards(data, food, forecast, nextMilestone) {
  const cards = {
    adult: `<article class="insight-card accent"><span class="label">Adult forecast</span><div><div class="big">${forecast.ready ? `${formatNumber(forecast.adult.median, 1)} kg` : "Building"}</div><div class="sub">${forecast.ready ? `Likely range ${formatNumber(forecast.adult.likelyLow, 1)}–${formatNumber(forecast.adult.likelyHigh, 1)} kg · ${escapeHtml(forecast.stability.label)}` : "More readings will personalise the estimate."}</div></div></article>`,
    food: `<article class="insight-card copper"><span class="label">Food today</span><div><div class="big">${food ? `${formatNumber(food.dailyGrams, 0)} g` : "—"}</div><div class="sub">${food ? `${formatNumber(food.perMealGrams, 0)} g twice daily · ${formatNumber(food.percent, 2)}% of bodyweight` : "Needs a current weight."}</div></div></article>`,
    milestone: `<article class="insight-card blue"><span class="label">Next milestone</span><div><div class="big">${nextMilestone ? escapeHtml(nextMilestone.label) : "—"}</div><div class="sub">${nextMilestone?.date ? `Projected ${formatDate(parseIso(nextMilestone.date), { month: "short", year: "numeric" })}` : "No future milestone available yet."}</div></div></article>`,
    growth: `<article class="insight-card"><span class="label">Growth state</span><div><div class="big">${escapeHtml(data.change.label)}</div><div class="sub">${Number.isFinite(data.change.currentRate) ? `${formatNumber(data.change.currentRate, 2)} kg/week now versus ${formatNumber(data.change.previousRate, 2)} previously.` : escapeHtml(data.change.detail)}</div></div></article>`
  };
  const visible = state.ui.homeCards.filter(value => !state.ui.hiddenHomeCards.includes(value));
  return visible.length ? visible.map(value => cards[value]).join("") : `<article class="insight-card"><span class="label">Home cards</span><div><div class="big">Hidden</div><div class="sub">Use Edit Home to show dashboard cards again.</div></div></article>`;
}

function openHomeEditor() {
  homeEditDraft = {
    order: [...state.ui.homeCards],
    hidden: [...state.ui.hiddenHomeCards]
  };
  renderHomeCardEditor();
  dom.homeEditDialog.showModal();
}

function renderHomeCardEditor() {
  if (!homeEditDraft) return;
  const labels = {
    adult: ["Adult forecast", "Central estimate and current likely range"],
    food: ["Food today", "Daily and per-meal raw food amount"],
    milestone: ["Next milestone", "Next projected weight milestone"],
    growth: ["Growth state", "Current change-point analysis"]
  };
  dom.homeCardEditor.innerHTML = homeEditDraft.order.map((value, index) => `<div class="reorder-row"><input type="checkbox" data-action="toggle-home-card" data-value="${value}" ${homeEditDraft.hidden.includes(value) ? "" : "checked"} aria-label="Show ${escapeHtml(labels[value][0])}"/><div class="reorder-copy"><strong>${escapeHtml(labels[value][0])}</strong><small>${escapeHtml(labels[value][1])}</small></div><div class="reorder-actions"><button data-action="move-home-card" data-value="${value}" data-direction="-1" type="button" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button data-action="move-home-card" data-value="${value}" data-direction="1" type="button" ${index === homeEditDraft.order.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button></div></div>`).join("");
}

function moveHomeCard(value, direction) {
  if (!homeEditDraft) return;
  const index = homeEditDraft.order.indexOf(value);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= homeEditDraft.order.length) return;
  [homeEditDraft.order[index], homeEditDraft.order[target]] = [homeEditDraft.order[target], homeEditDraft.order[index]];
  renderHomeCardEditor();
}

function toggleHomeCard(value) {
  if (!homeEditDraft) return;
  const hidden = homeEditDraft.hidden.includes(value);
  homeEditDraft.hidden = hidden ? homeEditDraft.hidden.filter(item => item !== value) : [...homeEditDraft.hidden, value];
  renderHomeCardEditor();
}

function handleHomeEditSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    homeEditDraft = null;
    dom.homeEditDialog.close();
    return;
  }
  if (homeEditDraft) {
    state.ui.homeCards = [...homeEditDraft.order];
    state.ui.hiddenHomeCards = [...homeEditDraft.hidden];
    saveState();
  }
  homeEditDraft = null;
  dom.homeEditDialog.close();
  toast("Home dashboard updated.");
  render();
}

function openWeightSheet(entryId = null) {
  const entry = entryId ? state.entries.find(item => item.id === entryId) : null;
  weightSheetForecast = calculateForecast(entryId ? state.entries.filter(item => item.id !== entryId) : state.entries, state.profile, { iterations: 700 });
  dom.weightSheetTitle.textContent = entry ? "Edit weight" : "Add weight";
  dom.entryId.value = entry?.id || "";
  dom.entryDate.min = state.profile.dob;
  dom.entryDate.value = entry?.date || iso(todayDate());
  dom.entryWeight.value = entry ? formatNumber(entry.weightKg, 1) : "";
  dom.entryNotes.value = entry?.notes || "";
  dom.entryExclude.checked = Boolean(entry?.excluded);
  dom.saveWeightButton.textContent = entry ? "Update weight" : "Save weight";
  renderWeightSheetFeedback();
  dom.weightSheet.showModal();
  setTimeout(() => { dom.entryWeight.focus(); dom.entryWeight.select(); }, 80);
}

function renderWeightSheetFeedback() {
  const weight = dom.entryWeight.value.trim() === "" ? Number.NaN : Number(dom.entryWeight.value);
  const dateIso = dom.entryDate.value;
  const editId = dom.entryId.value;
  const entriesWithoutCurrent = editId ? state.entries.filter(item => item.id !== editId) : state.entries;
  const forecast = weightSheetForecast || analytics().forecast;
  const issues = checkWeightInput({ dateIso, weightKg: weight, entries: entriesWithoutCurrent, dobIso: state.profile.dob, forecast });
  const previous = [...normaliseEntries(entriesWithoutCurrent, state.profile.dob)].filter(entry => entry.date < dateIso && !entry.excluded).at(-1);
  if (!dom.entryWeight.value) dom.liveComparison.textContent = previous ? `Previous: ${formatNumber(previous.weightKg, 1)} kg on ${formatDate(parseIso(previous.date))}` : "Enter Reggie’s weight.";
  else if (previous) {
    const days = Math.max(1, ageDaysOn(dateIso, state.profile.dob) - ageDaysOn(previous.date, state.profile.dob));
    const change = weight - previous.weightKg;
    dom.liveComparison.textContent = `Previous ${formatNumber(previous.weightKg, 1)} kg · ${signed(change, 1)} kg · ${days} days · ${signed(change / days * 7, 2)} kg/week`;
  } else dom.liveComparison.textContent = "This will be the first recorded weight.";
  dom.entryIssues.innerHTML = issues.map(issue => `<div class="issue ${issue.severity}"><svg><use href="#i-alert"/></svg><span>${escapeHtml(issue.message)}${Number.isFinite(issue.suggestionKg) ? ` <button class="text-button" data-action="apply-suggestion" data-weight="${issue.suggestionKg}" type="button">Use ${issue.suggestionKg} kg</button>` : ""}</span></div>`).join("");
  dom.saveWeightButton.disabled = issues.some(issue => issue.severity === "error");
}

function applyWeightSuggestion(weight) {
  dom.entryWeight.value = formatNumber(weight, 1);
  renderWeightSheetFeedback();
}

function handleWeightSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") { dom.weightSheet.close(); return; }
  const id = dom.entryId.value;
  const date = dom.entryDate.value;
  const weightKg = Number(dom.entryWeight.value);
  const entriesWithoutCurrent = id ? state.entries.filter(item => item.id !== id) : state.entries;
  const forecast = weightSheetForecast || analytics().forecast;
  const issues = checkWeightInput({ dateIso: date, weightKg, entries: entriesWithoutCurrent, dobIso: state.profile.dob, forecast });
  if (issues.some(issue => issue.severity === "error")) { renderWeightSheetFeedback(); return; }
  const warning = issues.some(issue => issue.severity === "warning");
  const existingByDate = state.entries.find(item => item.date === date && item.id !== id);
  const oldEntries = structuredClone(state.entries);
  createSnapshot(id || existingByDate ? "weight update" : "weight entry");
  const now = new Date().toISOString();
  const previous = id ? state.entries.find(item => item.id === id) : existingByDate;
  const entry = {
    id: previous?.id || createId(),
    date,
    weightKg: round(weightKg, 1),
    notes: dom.entryNotes.value.trim().slice(0, 500),
    excluded: dom.entryExclude.checked,
    confirmed: warning ? false : Boolean(previous?.confirmed),
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  state.entries = normaliseEntries([...state.entries.filter(item => item.id !== entry.id && item.date !== date), entry], state.profile.dob);
  saveForecastSnapshot(entry.date);
  undoRecord = { label: previous ? "weight update" : "weight entry", restore: () => { state.entries = oldEntries; saveState(); render(); } };
  saveState();
  dom.weightSheet.close();
  weightSheetForecast = null;
  toast(previous ? "Weight updated." : "Weight saved.");
  render();
}

function saveForecastSnapshot(sourceDate) {
  const forecast = calculateForecast(state.entries, state.profile);
  if (!forecast.ready) return;
  const latest = withAges(state.entries, state.profile.dob).at(-1);
  state.forecastSnapshots.push({
    id: createId(),
    createdAt: new Date().toISOString(),
    sourceDate,
    sourceWeightKg: latest.weightKg,
    adultMedianKg: round(forecast.adult.median, 2),
    adultLikelyLowKg: round(forecast.adult.likelyLow, 2),
    adultLikelyHighKg: round(forecast.adult.likelyHigh, 2),
    predictions: [28,56,84].map(days => ({ targetDate: iso(addDays(parseIso(latest.date), days)), horizonDays: days, predictedKg: round(forecast.predictAtAge(latest.ageDays + days), 2) })),
    modelWeights: forecast.weights
  });
  state.forecastSnapshots = state.forecastSnapshots.slice(-250);
}

function deleteEntry(id) {
  createSnapshot("weight deletion");
  const oldEntries = structuredClone(state.entries);
  state.entries = state.entries.filter(entry => entry.id !== id);
  undoRecord = { label: "deletion", restore: () => { state.entries = oldEntries; saveState(); render(); } };
  saveState();
  toast("Weight deleted. Undo is available from More.");
  render();
}

function toggleEntryExclusion(id) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry) return;
  createSnapshot(entry.excluded ? "include weight" : "exclude weight");
  entry.excluded = !entry.excluded;
  entry.updatedAt = new Date().toISOString();
  saveState();
  toast(entry.excluded ? "Weight excluded from calculations." : "Weight included in calculations.");
  render();
}

function confirmEntry(id) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry) return;
  createSnapshot("confirm weight");
  entry.confirmed = true;
  entry.updatedAt = new Date().toISOString();
  saveState();
  toast("Weight confirmed as genuine.");
  render();
}

function undoLastAction() {
  if (!undoRecord) return;
  const action = undoRecord;
  undoRecord = null;
  action.restore();
  toast("Last action undone.");
}

function openFeedingProfile() {
  dom.feedingBandEditor.innerHTML = state.profile.feedingBands.map((band, index) => `<div class="feeding-band-row"><div><strong>${escapeHtml(band.label)}</strong><small>${band.minMonths} to ${band.maxMonths >= 99 ? "∞" : band.maxMonths} months · always 2 meals</small></div><label class="percent-input"><input data-band-index="${index}" type="number" min="0.1" max="20" step="0.1" value="${formatNumber(band.percent, 2)}"/><span>%</span></label></div>`).join("");
  dom.feedingProfileDialog.showModal();
}

function handleFeedingProfileSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") { dom.feedingProfileDialog.close(); return; }
  const inputs = [...dom.feedingBandEditor.querySelectorAll("[data-band-index]")];
  createSnapshot("feeding profile update");
  state.profile.feedingBands = state.profile.feedingBands.map((band, index) => ({ ...band, percent: Math.min(20, Math.max(.1, Number(inputs[index]?.value) || band.percent)) }));
  saveState();
  dom.feedingProfileDialog.close();
  toast("Feeding profile updated.");
  render();
}

function openSupplementDialog(id = null) {
  const item = id ? state.supplements.find(supplement => supplement.id === id) : supplementTemplate("New supplement");
  dom.supplementDialogTitle.textContent = id ? "Edit supplement" : "Add supplement";
  dom.supplementId.value = id || "";
  dom.supplementName.value = item.name;
  dom.supplementRule.value = item.rule;
  dom.supplementAmount.value = item.amount ?? "";
  dom.supplementMaximum.value = item.maximumGrams ?? "";
  dom.calibrationTrial1.value = item.calibrationTrials?.[0] ?? "";
  dom.calibrationTrial2.value = item.calibrationTrials?.[1] ?? "";
  dom.calibrationTrial3.value = item.calibrationTrials?.[2] ?? "";
  dom.supplementTiming.value = item.timing || "morning";
  dom.supplementNotes.value = item.notes || "";
  dom.supplementEnabled.checked = item.enabled !== false;
  dom.deleteSupplementButton.classList.toggle("is-hidden", !id);
  renderCalibrationPreview();
  dom.supplementDialog.showModal();
}

function renderCalibrationPreview() {
  const trials = [dom.calibrationTrial1.value, dom.calibrationTrial2.value, dom.calibrationTrial3.value].map(Number).filter(value => Number.isFinite(value) && value > 0);
  const calibration = supplementCalibration(trials, 10);
  dom.calibrationQuality.textContent = calibration.quality;
  dom.calibrationQuality.className = `status-badge ${["Excellent","Good"].includes(calibration.quality) ? "good" : calibration.ready ? "warn" : ""}`;
  dom.calibrationResult.textContent = calibration.ready
    ? `${formatNumber(calibration.gramsPerTsp, 3)} g per level teaspoon. Trial variation: ${formatNumber(calibration.cvPercent, 1)}%. ${trials.length < 3 ? "Add all three trials for a stronger calibration." : ""}`
    : "Enter calibration trials to calculate grams per teaspoon.";
}

function handleSupplementSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") { dom.supplementDialog.close(); return; }
  const id = dom.supplementId.value || createId();
  const existing = state.supplements.find(item => item.id === id);
  const item = {
    id,
    name: dom.supplementName.value.trim().slice(0, 80),
    rule: dom.supplementRule.value,
    amount: positiveOrNull(dom.supplementAmount.value),
    maximumGrams: positiveOrNull(dom.supplementMaximum.value),
    calibrationTrials: [dom.calibrationTrial1.value, dom.calibrationTrial2.value, dom.calibrationTrial3.value].map(Number).filter(value => Number.isFinite(value) && value > 0),
    teaspoonsPerTrial: 10,
    timing: dom.supplementTiming.value,
    notes: dom.supplementNotes.value.trim().slice(0, 400),
    enabled: dom.supplementEnabled.checked
  };
  if (!item.name) return;
  createSnapshot(existing ? "supplement update" : "supplement addition");
  if (existing) Object.assign(existing, item); else state.supplements.push(item);
  saveState();
  dom.supplementDialog.close();
  toast(existing ? "Supplement updated." : "Supplement added.");
  render();
}

function deleteCurrentSupplement() {
  const id = dom.supplementId.value;
  if (!id) return;
  dom.supplementDialog.close();
  requestConfirmation("Delete supplement", "The dose rule and calibration will be removed.", () => {
    createSnapshot("supplement deletion");
    state.supplements = state.supplements.filter(item => item.id !== id);
    saveState();
    toast("Supplement deleted.");
    render();
  });
}

function requestConfirmation(title, message, callback, actionLabel = "Delete") {
  pendingConfirmation = callback;
  dom.confirmTitle.textContent = title;
  dom.confirmMessage.textContent = message;
  dom.confirmAction.textContent = actionLabel;
  dom.confirmDialog.showModal();
}

function handleConfirmSubmit(event) {
  event.preventDefault();
  const confirmed = event.submitter?.value === "default";
  dom.confirmDialog.close();
  if (confirmed && pendingConfirmation) pendingConfirmation();
  pendingConfirmation = null;
}

function saveProfileFromScreen() {
  const name = document.getElementById("profileName")?.value.trim();
  const dob = document.getElementById("profileDob")?.value;
  const reference = Number(document.getElementById("profileReference")?.value);
  if (!name || !parseIso(dob) || !Number.isFinite(reference) || reference < 20 || reference > 100) { toast("Check the profile values."); return; }
  createSnapshot("profile update");
  state.profile.name = name.slice(0, 50);
  state.profile.dob = dob;
  state.profile.referenceAdultKg = reference;
  state.entries = normaliseEntries(state.entries, dob);
  saveState();
  toast("Profile saved.");
  render();
}

function exportJson() {
  downloadBlob(`pickle-pants-backup-${iso(todayDate())}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), appVersion: APP_VERSION, ...state }, null, 2), "application/json");
  toast("JSON backup downloaded.");
}

function exportCsv() {
  const rows = [["Date", "WeightKg", "IncludedInForecasts", "Confirmed", "Notes"]];
  normaliseEntries(state.entries, state.profile.dob).forEach(entry => rows.push([entry.date, entry.weightKg, !entry.excluded, entry.confirmed, entry.notes]));
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  downloadBlob(`pickle-pants-weights-${iso(todayDate())}.csv`, csv, "text/csv;charset=utf-8");
  toast("CSV exported.");
}

function importBackupFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = safeJsonParse(String(reader.result));
    if (!parsed || !Array.isArray(parsed.entries)) { toast("That file is not a valid Pickle Pants backup."); return; }
    requestConfirmation("Restore backup", "Current local data will be replaced by the selected backup.", () => {
      state = mergeState(structuredClone(DEFAULT_STATE), parsed);
      state.schemaVersion = APP_SCHEMA_VERSION;
      state.entries = normaliseEntries(state.entries, state.profile.dob || DEFAULT_DOB);
      state.profile.feedingBands = normaliseFeedingBands(state.profile.feedingBands);
      state.supplements = normaliseSupplements(state.supplements);
      saveState();
      applyTheme(state.profile.theme);
      toast("Backup restored.");
      render();
    }, "Restore");
  };
  reader.readAsText(file);
}

function downloadCalendar() {
  const data = analytics();
  if (!data.latest) { toast("Add a weight first."); return; }
  const date = data.nextWeigh.date;
  const nextDay = addDays(date, 1);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pickle Pants//Weight reminder//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${createId()}@pickle-pants`, `DTSTAMP:${icsTimestamp(new Date())}`,
    `DTSTART;VALUE=DATE:${iso(date).replaceAll("-", "")}`, `DTEND;VALUE=DATE:${iso(nextDay).replaceAll("-", "")}`,
    `SUMMARY:Weigh ${escapeIcs(state.profile.name)}`, `DESCRIPTION:${escapeIcs(data.nextWeigh.reason)}`, "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  downloadBlob(`weigh-${state.profile.name.toLowerCase()}-${iso(date)}.ics`, ics, "text/calendar;charset=utf-8");
  toast("Calendar reminder downloaded.");
}

function clearAllData() {
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  applyTheme(state.profile.theme);
  saveState();
  toast("All local data cleared.");
  render();
}

function cycleTheme() {
  const choices = ["system", "light", "dark"];
  const index = choices.indexOf(state.profile.theme);
  state.profile.theme = choices[(index + 1) % choices.length];
  saveState();
  applyTheme(state.profile.theme);
  toast(`Theme: ${capitalise(state.profile.theme)}.`);
  if (state.ui.route === "data") render();
}

function applyTheme(preference) {
  const resolved = preference === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  const colour = resolved === "dark" ? "#0e1512" : "#173f38";
  dom.themeColorMeta.setAttribute("content", colour);
}

function updateConnectionState() {
  const online = navigator.onLine;
  dom.connectionDot.classList.toggle("is-offline", !online);
  dom.connectionText.textContent = online ? "Online · offline-ready" : "Offline mode";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./service-worker.js");
    if (serviceWorkerRegistration.waiting) showUpdateBanner();
    serviceWorkerRegistration.addEventListener("updatefound", () => {
      const worker = serviceWorkerRegistration.installing;
      worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(); });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
    dom.applyUpdateButton.addEventListener("click", () => serviceWorkerRegistration?.waiting?.postMessage({ type: "SKIP_WAITING" }));
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function showUpdateBanner() { dom.updateBanner.classList.remove("is-hidden"); }

function groupByMonth(entries) {
  return entries.reduce((groups, entry) => {
    const label = formatDate(parseIso(entry.date), { month: "long", year: "numeric" });
    (groups[label] ||= []).push(entry);
    return groups;
  }, {});
}

function nextIncompleteMilestone(items) {
  return items.find(item => !item.complete && item.date) || items.find(item => !item.complete) || null;
}

function quickAction(action, icon, label) {
  return `<button class="quick-action" data-action="${action}" type="button"><svg><use href="#${icon}"/></svg><strong>${escapeHtml(label)}</strong></button>`;
}

function quickRoute(route, icon, label) {
  return `<button class="quick-action" data-route="${route}" type="button"><svg><use href="#${icon}"/></svg><strong>${escapeHtml(label)}</strong></button>`;
}

function moreCard(route, title, description, icon) {
  return `<button class="more-card" data-route="${route}" type="button"><svg><use href="#${icon}"/></svg><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><svg><use href="#i-chevron"/></svg></button>`;
}

function metricCard(label, value, meta) {
  return `<article class="metric-card"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span><span class="meta">${escapeHtml(meta)}</span></article>`;
}

function emptyState(icon, title, text, buttonLabel = "") {
  return `<div class="empty-state"><div class="empty-state-inner"><span class="empty-state-icon"><svg><use href="#${icon}"/></svg></span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${buttonLabel ? `<button class="button primary" data-action="add-weight" type="button">${escapeHtml(buttonLabel)}</button>` : ""}</div></div>`;
}

function timingLabel(value) {
  return value === "evening" ? "Evening meal" : value === "split" ? "Split across both" : "Morning meal";
}

function formatNumber(value, decimals = 1) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(Number(value));
}

function formatDate(date, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  return date ? new Intl.DateTimeFormat("en-GB", options).format(date) : "—";
}

function signed(value, decimals = 1) {
  if (!Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : number < 0 ? "−" : ""}${formatNumber(Math.abs(number), decimals)}`;
}

function capitalise(value) { return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1); }

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function icsTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  dom.toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

init();
