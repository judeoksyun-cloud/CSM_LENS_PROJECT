import assert from "node:assert/strict";
import test from "node:test";

import {
  getCompanyForecast,
  readForecastSnapshot,
  summarizeForecastEntry,
  validateForecastEntry,
} from "../tools/forecast-contract.mjs";

test("all nine forecasts satisfy the shared Movement and reconciliation contract", async () => {
  const snapshot = await readForecastSnapshot();
  const companyKeys = Object.keys(snapshot.data.forecasts);

  assert.equal(companyKeys.length, 9);
  assert.equal(snapshot.data.version, "2026.08.16-v7.3");
  assert.equal(snapshot.data.runtimeContractVersion, "csm-forecast-runtime/v1");

  for (const companyKey of companyKeys) {
    const entry = getCompanyForecast(snapshot.data, companyKey);
    const validation = validateForecastEntry(entry);
    const summary = summarizeForecastEntry(entry);

    assert.equal(validation.status, "passed", `${companyKey}: ${validation.reasons.join("; ")}`);
    assert.ok(Number.isFinite(summary.independentModel));
    assert.ok(Number.isFinite(summary.base));
    assert.ok(Number.isFinite(summary.worst));
    assert.ok(summary.validation.sampleCount >= 6);
  }
});

test("management target overlay is included in CSM adjustment with an audit trail", async () => {
  const snapshot = await readForecastSnapshot();
  const samsung = getCompanyForecast(snapshot.data, "samsung-life");
  const economicClosing = samsung.base.opening
    + samsung.base.newbiz
    + samsung.base.interest
    + samsung.base.adjustment
    + samsung.base.amortization;

  assert.equal(economicClosing, samsung.base.closing);
  assert.equal(samsung.base.modelClosing, samsung.independentModel.base.closing);
  assert.equal(samsung.base.adjustmentBeforeTargetOverlay, -1640);
  assert.equal(samsung.base.targetAdjustmentOverlay, -635);
  assert.equal(
    samsung.base.adjustmentBeforeTargetOverlay + samsung.base.targetAdjustmentOverlay,
    samsung.base.adjustment,
  );
  assert.equal(samsung.base.modelClosing + samsung.base.targetAdjustmentOverlay, samsung.base.closing);
  assert.equal(samsung.anchor.verificationStatus, "unverified");
});
