import assert from "node:assert/strict";

import {
  getFinancialMetric,
  getLatestQuarterPeriodKey,
  getReviewSummary,
  getSupportedCompanyKeys,
  readDashboardSnapshot,
} from "../tools/dashboard-contract.mjs";

const snapshot = await readDashboardSnapshot();
const companies = getSupportedCompanyKeys(snapshot.data);

assert.equal(snapshot.data.dataContractVersion, "csm-dashboard-quarterly/v1");
assert.equal(snapshot.data.runtimeContractVersion, "csm-dashboard-runtime/v1");
assert.equal(companies.length, 9);
assert.equal(snapshot.data.reviewItems.length, 252, "each quarterly period needs movement and financial review items");

for (const companyKey of companies) {
  assert.equal(getLatestQuarterPeriodKey(snapshot.data, companyKey), "2026-q2");
  const financial = getFinancialMetric(snapshot.data, companyKey, "2026-q2");
  assert.ok(Number.isFinite(financial.insuranceProfit), `${companyKey} insurance profit`);
  assert.ok(Number.isFinite(financial.netIncome), `${companyKey} net income`);
  assert.ok(Number.isFinite(financial.kics), `${companyKey} K-ICS`);
  assert.equal(financial.investmentProfit, null, "unavailable investment profit must stay null");
}

const clean = getReviewSummary(snapshot.data, "samsung-life", "2026-q2");
assert.equal(clean.status, "passed");

const corrected = getReviewSummary(snapshot.data, "shinhan-life", "2026-q2");
assert.equal(corrected.status, "passed");
assert.equal(snapshot.data.sampleData["shinhan-life"].periods["2026-q1"].csm, 7722);
assert.equal(snapshot.data.sampleData["shinhan-life"].periods["2026-q2"].csm, 7911);
assert.deepEqual(
  snapshot.data.sampleData["shinhan-life"].periods["2026-q2"].sourceReference.sourceTables,
  [434, 436, 438],
);
assert.equal(
  corrected.items.find((item) => item.metric === "csm_movement")
    .validation.openingReconciliationDifference,
  0,
);

const hanwha = getReviewSummary(snapshot.data, "hanwha-life", "2026-q2");
assert.equal(hanwha.status, "passed");
assert.equal(getFinancialMetric(snapshot.data, "hanwha-life", "2026-q2").kics, 168.0);
assert.equal(
  snapshot.data.sampleData["hanwha-life"].periods["2026-q2"].sourceReference.rceptNo,
  "20260831001232",
);
assert.deepEqual(
  hanwha.items.find((item) => item.metric === "financial_metrics").validation.pendingMetrics,
  [],
);
