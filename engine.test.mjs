import assert from "node:assert/strict";
import {
  calculateForecast,
  checkWeightInput,
  feedingCalculation,
  normaliseEntries,
  scenarioForecast,
  spoonCombination,
  supplementCalibration,
  supplementPlan,
  withAges
} from "../engine.js";

const profile = {
  dob: "2026-01-08",
  referenceAdultKg: 50,
  feedingBands: [
    { id: "a", label: "0-6", minMonths: 0, maxMonths: 6, percent: 6 },
    { id: "b", label: "6-12", minMonths: 6, maxMonths: 12, percent: 4 },
    { id: "c", label: "12+", minMonths: 12, maxMonths: 99, percent: 2.5 }
  ]
};

const entries = normaliseEntries([
  { date: "2026-03-05", weightKg: 13.8 },
  { date: "2026-03-19", weightKg: 17.7 },
  { date: "2026-04-02", weightKg: 21.9 },
  { date: "2026-04-16", weightKg: 25.3 },
  { date: "2026-04-30", weightKg: 27.9 },
  { date: "2026-05-14", weightKg: 30.4 },
  { date: "2026-05-28", weightKg: 34.4 },
  { date: "2026-06-12", weightKg: 38.0 },
  { date: "2026-06-26", weightKg: 39.5 },
  { date: "2026-07-10", weightKg: 40.8 }
], profile.dob);

assert.equal(entries.length, 10, "all valid weights should remain");
assert.equal(withAges(entries, profile.dob).at(-1).weightKg, 40.8);

const forecast = calculateForecast(entries, profile, { iterations: 500 });
assert.equal(forecast.ready, true, "forecast should be available");
assert.ok(forecast.models.length >= 3, "multiple models should be active");
assert.ok(forecast.adult.median > 40.8 && forecast.adult.median < 100, "adult estimate should be plausible");
assert.ok(forecast.adult.likelyLow < forecast.adult.median, "lower range should be below the median");
assert.ok(forecast.adult.likelyHigh > forecast.adult.median, "upper range should be above the median");
assert.ok(forecast.predictAtAge(withAges(entries, profile.dob).at(-1).ageDays + 56) >= 40.8, "future forecast should not fall below latest weight in normal growth");

const feeding = feedingCalculation(40.8, withAges(entries, profile.dob).at(-1).ageDays, profile.feedingBands);
assert.equal(feeding.mealsPerDay, 2, "meal count must stay fixed at two");
assert.equal(feeding.dailyGrams, 1632, "4% of 40.8 kg should equal 1632 g");
assert.equal(feeding.perMealGrams, 816, "daily amount should split equally across two meals");

const calibration = supplementCalibration([22.1, 21.7, 22.0], 10);
assert.ok(Math.abs(calibration.gramsPerTsp - 2.1933333333) < 0.001, "calibration should average all trials");
assert.ok(["Excellent", "Good"].includes(calibration.quality), "consistent trials should score well");

const spoons = spoonCombination(7.7, 2.2);
assert.equal(spoons.label, "1 tbsp + ½ tsp", "3.5 tsp should use the simplest practical combination");
assert.ok(Math.abs(spoons.deliveredGrams - 7.7) < 0.001);

const plan = supplementPlan([{
  id: "mussel",
  name: "Mussel",
  enabled: true,
  rule: "per10Kg",
  amount: 0.5,
  calibrationTrials: [22, 22, 22],
  teaspoonsPerTrial: 10,
  timing: "morning"
}], 40);
assert.equal(plan[0].targetGrams, 2, "per-10kg rule should scale by current weight");
assert.ok(plan[0].spoons, "calibrated supplement should produce spoon guidance");

const poundsIssue = checkWeightInput({ dateIso: "2026-07-24", weightKg: 90, entries, dobIso: profile.dob, forecast });
assert.ok(poundsIssue.some(issue => issue.code === "pounds"), "likely pounds entry should be detected");

const scenario = scenarioForecast(entries, profile, { growthAdjustmentPercent: -10 });
assert.ok(scenario.forecast.adult.median < forecast.adult.median, "reduced-growth scenario should lower adult estimate");

console.log("Pickle Pants engine tests passed.");
