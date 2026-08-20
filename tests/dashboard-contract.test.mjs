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
assert.equal(snapshot.data.reviewItems.length, 234, "each quarterly period needs movement and financial review items");

for (const companyKey of companies) {
  assert.equal(getLatestQuarterPeriodKey(snapshot.data, companyKey), "2026-q1");
  const financial = getFinancialMetric(snapshot.data, companyKey, "2026-q1");
  assert.ok(Number.isFinite(financial.insuranceProfit), `${companyKey} insurance profit`);
  assert.ok(Number.isFinite(financial.netIncome), `${companyKey} net income`);
  assert.ok(Number.isFinite(financial.kics), `${companyKey} K-ICS`);
  assert.equal(financial.investmentProfit, null, "unavailable investment profit must stay null");
}

const clean = getReviewSummary(snapshot.data, "samsung-life", "2026-q1");
assert.equal(clean.status, "passed");

const review = getReviewSummary(snapshot.data, "shinhan-life", "2026-q1");
assert.equal(review.status, "needs_review");
assert.equal(review.needsReview, 1);
assert.equal(
  review.items.find((item) => item.metric === "csm_movement")
    .validation.openingReconciliationDifference,
  -104,
);
