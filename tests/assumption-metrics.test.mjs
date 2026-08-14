import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(
  readFileSync("external-data/insurance-assumption-dashboard-data.json", "utf8"),
);

const expectedCompanies = [
  "samsung-life",
  "hanwha-life",
  "kyobo-life",
  "shinhan-life",
  "samsung-fire",
  "meritz-fire",
  "db-insurance",
  "hyundai-marine",
  "kb-insurance",
];

assert.deepEqual(Object.keys(data.companies), expectedCompanies);
assert.equal(data.durationBuckets.length, 15);
assert.deepEqual(data.availablePeriods, ["2024-ye", "2025-ye"]);
assert.match(data.sourcePolicy, /Open DART annual-report consolidated notes/);
assert.doesNotMatch(data.sourcePolicy, /ref_data/i);

for (const [companyKey, company] of Object.entries(data.companies)) {
  assert.deepEqual(Object.keys(company.claimExperience.values).sort(), ["2024", "2025"]);
  assert.equal(company.claimExperience.checks.status, "passed");
  for (const value of Object.values(company.claimExperience.values)) assert.ok(Math.abs(value.formulaDifference) <= 0.02);
  for (const metric of [company.lossRatioByDuration, company.expenseRatioByDuration]) {
    assert.deepEqual(Object.keys(metric.periods), ["2024-ye", "2025-ye"]);
    for (const [periodKey, period] of Object.entries(metric.periods)) {
      const series = Object.values(period).filter(
        (value) => value && typeof value === "object" && Array.isArray(value.duration),
      );
      assert.equal(series.length, 3, `${companyKey} ${periodKey} should expose three table rows`);
      for (const item of series) {
        assert.equal(item.duration.length, 15, `${companyKey} should expose all duration buckets`);
        assert.ok(item.duration.every((value) => value != null), `${companyKey} should have no duration gaps`);
        assert.notEqual(item.presentValue, null, `${companyKey} should expose present value`);
      }
      assert.equal(period.sourceReference.sourceType, "Open DART");
      assert.equal(period.unit, "억원");
      assert.ok(period.sourceReference.sourceTables.length >= 1);
      assert.match(period.sourceReference.basis, /연결재무제표 주석/);
      assert.match(period.sourceReference.dartUrl, /^https:\/\/dart\.fss\.or\.kr\//);
    }
  }
}

assert.equal(data.companies["samsung-life"].lossRatioByDuration.periods["2025-ye"].expectedClaims.duration[0], 45711.44);
assert.equal(data.companies["hyundai-marine"].lossRatioByDuration.periods["2024-ye"].expectedClaims.duration[0], 50052.84);

assert.deepEqual(data.companies["samsung-life"].claimExperience.values["2025"], {
  expectedLossRatio: 92.1,
  actualLossRatio: 99.1,
  variance: -7,
  calculatedVariance: -7,
  formulaDifference: 0,
});
