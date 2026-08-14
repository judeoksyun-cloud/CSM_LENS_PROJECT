import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("external-data/liability-assumption-dashboard-data.json", "utf8"));
const expectedCompanies = [
  "samsung-life", "hanwha-life", "kyobo-life", "shinhan-life", "samsung-fire",
  "meritz-fire", "db-insurance", "hyundai-marine", "kb-insurance",
];

assert.deepEqual(Object.keys(data.companies), expectedCompanies);
assert.deepEqual(data.availablePeriods, ["2024-ye", "2025-ye"]);
assert.equal(data.searchedFromYear, 2022);
assert.equal(data.firstDisclosureYear, 2024);
assert.equal(data.disclosureHistoryAudit["2022"].status, "not_available");
assert.equal(data.disclosureHistoryAudit["2023"].status, "not_available");
assert.equal(data.disclosureHistoryAudit["2024"].status, "available");
assert.ok(Object.values(data.disclosureHistoryAudit["2022"].fullTableCandidateCountByCompany).every((count) => count === 0));
assert.ok(Object.values(data.disclosureHistoryAudit["2023"].fullTableCandidateCountByCompany).every((count) => count === 0));
assert.equal(data.unit, "억원");
assert.match(data.sourcePolicy, /Open DART/);
assert.match(data.sourcePolicy, /sole source and validation basis/);
assert.doesNotMatch(data.sourcePolicy, /ref_data/i);

for (const [companyKey, company] of Object.entries(data.companies)) {
  for (const periodKey of data.availablePeriods) {
    const period = company.periods[periodKey];
    assert.equal(period.rows.length, 9, `${companyKey} ${periodKey} should preserve the normalized DART rows`);
    assert.equal(period.summary.drivers.length, 4, `${companyKey} should expose four assumption drivers`);
    assert.equal(period.checks.status, "passed", `${companyKey} ${periodKey} should reconcile`);
    assert.ok(Math.abs(period.checks.driversToAssumptionEffectDelta) <= 1);
    assert.equal(period.sourceReference.sourceType, "Open DART");
    assert.match(period.sourceReference.dartUrl, /^https:\/\/dart\.fss\.or\.kr\//);
    assert.match(period.sourceReference.rceptNo, /^\d{14}$/);
    assert.match(period.sourceReference.document, /\.xml$/);
    assert.ok(Number.isInteger(period.sourceReference.tableIndex));
    assert.ok(period.sourceReference.originalUnit);
    assert.ok(Math.abs(period.checks.driversToAssumptionEffectDelta) <= 1);
    assert.equal(period.checks.sourceTraceComplete, true);
    assert.ok(["disclosed", "calculated-from-open-dart-components"].includes(period.checks.estimateChangeValueType));
  }
}

const samsung = data.companies["samsung-life"].periods["2025-ye"].summary;
assert.equal(samsung.assumptionEffect.csm, -11334.58);
assert.deepEqual(samsung.drivers.map((item) => item.csm), [-2580.04, -4215.43, -4879.58, 340.47]);
