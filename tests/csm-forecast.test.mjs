import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");
const forecast = JSON.parse(readFileSync("external-data/csm-forecast-2026.json", "utf8"));
const dashboard = JSON.parse(readFileSync("external-data/csm-quarterly-dashboard-data.json", "utf8"));

assert.equal(forecast.asOfPeriod, "2026-q1");
assert.equal(forecast.targetPeriod, "2026-ye");
assert.equal(forecast.version, "2026.08.16-v7.5");
assert.equal(forecast.methodology.model, "rolling-origin-seasonal/v2 + samsung-driver-ensemble/v2");
assert.equal(forecast.backtest.method, "rolling-origin Q1/Q2/Q3-to-year-end hindcast");
assert.deepEqual(forecast.backtest.originQuarters, [1, 2, 3]);
assert.equal(forecast.backtest.global.sampleCount, 54);
assert.equal(forecast.backtest.bySector["생명보험"].sampleCount, 24);
assert.equal(forecast.backtest.bySector["손해보험"].sampleCount, 30);
assert.equal(forecast.backtest.global.quantile, 0.8);
assert.ok(forecast.backtest.global.newbizStress >= 0.1);
assert.ok(forecast.backtest.global.newbizStress <= 0.35);
assert.ok(forecast.backtest.global.adjustmentDownsideRateToOpening >= 0.01);
assert.ok(forecast.backtest.global.adjustmentDownsideRateToOpening <= 0.08);
assert.deepEqual(forecast.nearTermPeriods, ["2026-ye", "2027-ye", "2028-ye", "2030-ye"]);
assert.equal(forecast.terminalPeriod, "2035-ye");
assert.equal(Object.keys(forecast.forecasts).length, 9, "all nine dashboard companies need forecasts");

for (const [companyKey, entry] of Object.entries(forecast.forecasts)) {
  assert.ok(entry.sources.length >= 1, `${companyKey} should retain analyst evidence`);
  assert.ok(entry.sources.every((source) => source.type === "sell_side"), `${companyKey} sources must be sell-side analyst reports`);
  assert.ok(entry.sources.every((source) => source.id), `${companyKey} analyst sources should have stable ids`);
  assert.ok(entry.evidenceSources.some((source) => source.type === "official_filing"), `${companyKey} should link its Q1 DART filing`);
  assert.deepEqual(Object.keys(entry.movementEvidence), ["newbiz", "interest", "adjustment", "amortization"]);
  const movementSourceIds = new Set([...entry.sources, ...entry.evidenceSources].map((source) => source.id));
  for (const [movementKey, evidence] of Object.entries(entry.movementEvidence)) {
    assert.ok(evidence.statement, `${companyKey} ${movementKey} should expose an executive statement`);
    assert.ok(evidence.items.length >= 2, `${companyKey} ${movementKey} should expose actual and model evidence`);
    assert.ok(
      evidence.items.every((item) => movementSourceIds.has(item.sourceId)),
      `${companyKey} ${movementKey} evidence source ids should resolve`,
    );
  }
  assert.ok(entry.qualitativeJudgment.baseNewbiz, `${companyKey} should explain new business judgment`);
  assert.ok(entry.qualitativeJudgment.baseAdjustment, `${companyKey} should explain adjustment judgment`);
  assert.equal(
    entry.model.version,
    companyKey === "samsung-life" ? "samsung-driver-ensemble/v2" : "rolling-origin-seasonal/v2",
  );
  assert.equal(entry.model.backtest.sampleCount, 6, `${companyKey} should retain six rolling backtests`);
  assert.equal(entry.model.backtest.samples.length, 6);
  assert.equal(entry.validation.label, "검증 제한");
  assert.equal(entry.validation.sampleCount, 6);
  assert.ok(["입력 검증 필요", "근거 보통", "모델 중심"].includes(entry.evidenceProfile.rating));
  assert.ok(entry.model.backtest.meanAbsolutePercentageError >= 0);
  for (const sample of entry.model.backtest.samples) {
    assert.ok(
      sample.inputAudit.rateLookbackPeriods.every(
        (period) => period.localeCompare(sample.asOfPeriod) <= 0,
      ),
      `${companyKey} backtest must not read future rate periods`,
    );
    assert.equal(sample.inputAudit.originQuarter, sample.originQuarter);
  }
  assert.ok([0, 0.25].includes(entry.model.analystOverlay.weight));
  assert.ok(entry.model.baseline.remainingNewbiz > 0);
  assert.ok(Number.isFinite(entry.model.baseline.remainingAdjustment));
  assert.equal(
    entry.model.finalInputs.remainingNewbiz,
    entry.base.remainingForecast.newbiz,
    `${companyKey} should expose the exact final new business input`,
  );
  assert.equal(
    entry.model.finalInputs.remainingAdjustment,
    entry.base.remainingForecast.adjustmentBeforeTargetOverlay
      ?? entry.base.remainingForecast.adjustment,
    `${companyKey} should expose the exact final adjustment input`,
  );
  assert.ok(entry.ratios.interestRate > 0, `${companyKey} should have a mechanical interest rate`);
  assert.ok(entry.ratios.amortizationRate > 0, `${companyKey} should have a mechanical amortization rate`);
  for (const scenarioKey of ["base", "worst"]) {
    const scenario = entry[scenarioKey];
    assert.equal(
      scenario.opening + scenario.newbiz + scenario.interest + scenario.adjustment + scenario.amortization,
      scenario.closing,
      `${companyKey} ${scenarioKey} movement should reconcile`,
    );
    assert.equal(scenario.quarters.length, 4, `${companyKey} ${scenarioKey} should combine Q1 actual and Q2-Q4 forecast`);
    assert.equal(scenario.quarters[0].actual, true, `${companyKey} should identify Q1 as actual`);
    for (const quarter of scenario.quarters) {
      assert.equal(
        quarter.opening + quarter.newbiz + quarter.interest + quarter.adjustment + quarter.amortization,
        quarter.closing,
        `${companyKey} ${scenarioKey} ${quarter.period} should reconcile`,
      );
    }
  }
  assert.deepEqual(entry.horizon.nearTermPeriods, forecast.nearTermPeriods);
  assert.equal(entry.horizon.terminalPeriod, forecast.terminalPeriod);
  assert.equal(entry.worstAssumption.newbizDiscount, 0.1);
  assert.equal(entry.worstAssumption.adjustmentStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstNewbizStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstAdjustmentStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstPolicy.newbizDiscount, 0.1);
  assert.equal(entry.horizon.assumptions.worstPolicy.adjustmentStress, 0.1);
  assert.equal(entry.horizon.assumptions.stressCalibrationSampleCount, 6);
  assert.deepEqual(entry.horizon.horizonConfidence, {
    oneYear: "제한적 검증",
    twoToThreeYears: "모델 경로",
    fiveYear: "시나리오",
    tenYear: "장기 시나리오",
  });
  for (const scenarioKey of ["base", "worst"]) {
    assert.equal(entry.horizon[scenarioKey].length, 4, `${companyKey} should display 1Y, 2Y, 3Y and 5Y forecasts`);
    for (const point of entry.horizon[scenarioKey]) {
      assert.equal(
        point.opening + point.newbiz + point.interest + point.adjustment + point.amortization,
        point.closing,
        `${companyKey} ${scenarioKey} ${point.period} should reconcile`,
      );
    }
    const terminal = entry.horizon.terminal[scenarioKey];
    assert.equal(
      terminal.opening + terminal.newbiz + terminal.interest + terminal.adjustment + terminal.amortization,
      terminal.closing,
      `${companyKey} ${scenarioKey} terminal should reconcile`,
    );
  }
  assert.equal(entry.horizon.terminal.base.period, "2035-ye");
  assert.equal(entry.horizon.terminal.worst.period, "2035-ye");
  assert.ok(entry.horizon.terminal.worst.closing < entry.horizon.terminal.base.closing, `${companyKey} 10-year Worst should be below Base`);
  assert.equal(entry.horizon.longTermScenarios, undefined, `${companyKey} should expose only Base and Worst at ten years`);
  assert.ok(
    Math.abs(
      entry.worst.remainingForecast.newbiz
        - entry.base.remainingForecast.newbiz * (1 - entry.horizon.assumptions.worstNewbizStress),
    ) <= 0.5,
    `${companyKey} Worst remaining new business should be 10% below Base within rounding tolerance`,
  );
  const expectedWorstAdjustment = entry.base.remainingForecast.adjustment < 0
    ? entry.base.remainingForecast.adjustment * 1.1
    : entry.base.remainingForecast.adjustment * 0.9;
  assert.ok(
    Math.abs(entry.worst.remainingForecast.adjustment - expectedWorstAdjustment) <= 0.5,
    `${companyKey} Worst remaining adjustment should be 10% worse than Base within rounding tolerance`,
  );
  assert.ok(entry.worst.closing < entry.base.closing, `${companyKey} worst should be below base`);
  assert.ok(entry.horizon.executiveRationale.years1to3);
  assert.ok(entry.horizon.executiveRationale.year5);
  assert.ok(entry.horizon.executiveRationale.year10);
}

const samsung = forecast.forecasts["samsung-life"];
const driver = samsung.driverForecast;
const samsungPriorMovement = dashboard.sampleData["samsung-life"].periods["2025-ye"].movement;
assert.equal(samsung.anchor.type, "management_target");
assert.equal(samsung.anchor.value, 13500);
assert.equal(samsung.anchor.modelClosing, 14135);
assert.equal(samsung.anchor.reconciliation, -635);
assert.equal(samsung.anchor.verificationStatus, "unverified");
assert.equal(samsung.anchor.originalAttached, false);
assert.equal(samsung.base.closing, 13500);
assert.equal(samsung.base.modelClosing, 14135);
assert.equal(samsung.base.adjustmentBeforeTargetOverlay, -1640);
assert.equal(samsung.base.targetAdjustmentOverlay, -635);
assert.equal(samsung.base.adjustment, -2275, "management target gap should be included in CSM adjustment");
assert.equal(samsung.base.quarters.at(-1).targetAdjustmentOverlay, -635);
assert.equal(samsung.base.quarters.at(-1).closing, 13500);
assert.equal(samsung.independentModel.base.closing, 14135);
assert.equal(samsung.worst.closing, 13040);
assert.equal(samsung.horizon.base[1].closing, 13869);
assert.ok(samsung.horizon.base[1].closing - samsung.base.closing < 500, "2027 should not rebound through a one-year target-overlay cliff");
assert.deepEqual(samsung.horizon.assumptions.targetAdjustmentNormalization.schedule, {
  "2026-ye": -635,
  "2027-ye": -423,
  "2028-ye": -212,
  "2029-ye": 0,
});
assert.equal(samsung.horizon.base.at(-1).closing, 14988);
assert.equal(samsung.horizon.terminal.base.closing, 15391);
assert.equal(samsung.horizon.terminal.worst.closing, 11758);
assert.equal(samsung.horizon.longTermScenarios, undefined);
assert.deepEqual(Object.keys(driver.movementEvidence), ["newbiz", "interest", "adjustment", "amortization"]);
const driverSourceIds = new Set(driver.sources.map((source) => source.id));
for (const [movementKey, evidence] of Object.entries(driver.movementEvidence)) {
  assert.ok(evidence.statement, `${movementKey} should expose an executive movement statement`);
  assert.ok(evidence.items.length >= 2, `${movementKey} should expose evidence and source items`);
  assert.ok(
    evidence.items.every((item) => driverSourceIds.has(item.sourceId)),
    `${movementKey} evidence source ids should resolve through the driver source registry`,
  );
}
assert.match(driver.movementEvidence.newbiz.items[2].detail, /60%.*40%/);
assert.match(driver.movementEvidence.adjustment.items.find((item) => item.label === "경영진 설명").detail, /1~2%/);
assert.match(driver.movementEvidence.adjustment.statement, /13\.5조원.*경영목표 연결분.*-0\.64조원.*CSM 조정에 포함/);
assert.ok(driver, "Samsung Life should expose the driver forecast pilot");
assert.equal(
  samsung.base.newbiz + samsung.base.interest
    - samsungPriorMovement.newbiz - samsungPriorMovement.interest,
  512,
  "Samsung growth drivers should improve KRW 512bn year over year",
);
assert.equal(samsung.base.newbiz - samsungPriorMovement.newbiz, 483);
assert.equal(samsung.base.interest - samsungPriorMovement.interest, 29);
assert.equal(samsung.base.adjustment - samsungPriorMovement.adjustment, -517);
assert.equal(samsung.base.amortization - samsungPriorMovement.amortization, -29);
assert.equal(driver.modelVersion, "samsung-driver-ensemble/v2");
assert.equal(driver.status, "pilot");
assert.equal(driver.interval.coverage, null);
assert.equal(driver.interval.sampleCount, 6);
assert.equal(driver.interval.sectorSampleCount, 24);
assert.equal(driver.interval.companyBacktestSamples, 6);
assert.equal(driver.interval.newbizDiscount, 0.1);
assert.equal(driver.interval.adjustmentStress, 0.1);
assert.equal(driver.distribution.p10.closing, samsung.worst.closing);
assert.ok(driver.distribution.p10.closing < driver.distribution.p50.closing);
assert.deepEqual(Object.keys(driver.distribution), ["p10", "p50"]);
assert.equal(driver.distribution.p50.closing, samsung.base.closing);
assert.equal(driver.distribution.p10.closing, samsung.worst.closing);
assert.equal(driver.knownBaseAnchor.value, 13500);
assert.equal(driver.knownBaseAnchor.verificationLabel, "담당자 별도 기입");
assert.match(driver.sources.find((source) => source.type === "user_provided").use, /담당자가 별도 기입/);
assert.equal(driver.knownBaseAnchor.reconciliation, -635);
assert.equal(driver.knownBaseAnchor.verificationStatus, "unverified");
assert.equal(driver.independentModel.base.closing, 14135);
assert.equal(driver.distribution.p50.quarters[0].actual, true);
assert.equal(driver.distribution.p50.quarters[0].newbiz, 849);
assert.equal(driver.distribution.p10.label, "Worst");
assert.equal(driver.distribution.p50.label, "Base");
assert.match(samsung.base.rationale, /Base/);
assert.doesNotMatch(samsung.base.rationale, /60%|40%|P50/);
for (const [quantile, scenario] of Object.entries(driver.distribution)) {
  assert.equal(
    scenario.opening + scenario.newbiz + scenario.interest + scenario.adjustment + scenario.amortization,
    scenario.closing,
    `Samsung ${quantile} movement should reconcile`,
  );
}
assert.equal(
  Object.values(driver.adjustmentBridge.components).reduce((sum, value) => sum + value, 0),
  driver.adjustmentBridge.p50Remaining,
);
assert.equal(driver.inputPolicy.apeUsed, false);
assert.equal(driver.inputPolicy.newBusinessMultipleUsed, false);
assert.match(driver.inputPolicy.excludedMetric, /11\.4/);
assert.ok(driver.sources.some((source) => source.type === "official_filing"));
assert.deepEqual(
  Object.keys(driver.stressScenarios),
  ["salesSlowdown", "marginCompression", "lapseAndExpense", "combined"],
);
assert.ok(driver.stressScenarios.salesSlowdown.closing < driver.distribution.p50.closing);
assert.ok(driver.stressScenarios.lapseAndExpense.closing < driver.distribution.p50.closing);
assert.match(driver.stressScenarios.lapseAndExpense.label, /장래손해율/);
assert.match(driver.stressScenarios.lapseAndExpense.description, /장래손해율.*CSM 조정/);
assert.match(driver.stressScenarios.combined.description, /공통 Worst 룰/);
assert.equal(
  Object.values(forecast.forecasts).filter((entry) => entry.driverForecast).length,
  1,
  "the first driver pilot should be limited to Samsung Life",
);

assert.match(html, /forecast-data\.generated\.js/);
assert.match(html, /CSM 전망은 이렇게 계산합니다/);
assert.match(html, /id="forecast-summary-body"/);
assert.match(html, /CSM_FORECAST_METHODOLOGY\.md/);
assert.match(script, /window\.CSM_FORECAST_DATA/);
assert.match(script, /function renderForecastMethodology\(/);
assert.match(script, /source\.type === "user_provided"/);
assert.match(script, /storedEntry\.asOfPeriod === context\.periodKey/);
assert.match(script, /확정 사실 · 외부 전망 · 모델 추정 · 경영 입력 · 가정/);
assert.match(script, /전망 판단/);
assert.match(script, /1년 예상/);
assert.match(script, /10년 예상/);
assert.doesNotMatch(script, /assumption-strip/);
assert.match(script, /개 검증 시점 · MAPE/);
assert.match(script, /function renderForecastExecutiveSummary\(/);
assert.match(script, /예상 CSM/);
assert.doesNotMatch(script, /executive-summary-metrics/);
assert.doesNotMatch(script, /회사·업권 오차 계층 보정/);
assert.match(script, /function bindForecastDetailTabs\(/);
assert.doesNotMatch(script, /data-forecast-tab="summary"/);
assert.match(script, /data-forecast-tab="outlook">전망 경로/);
assert.match(script, /data-forecast-tab="outlook">전망 경로[\s\S]*data-forecast-tab="movement">Movement[\s\S]*data-forecast-tab="evidence">근거·검증/);
assert.match(script, /function renderDriverForecastPanel\(/);
assert.match(script, /function renderDriverForecastPanel\(driver, base, worst\)[\s\S]*driver\?\.knownBaseAnchor/);
assert.match(script, /function renderDriverStressPanel\(/);
assert.match(script, /if \(!driver\) \{[\s\S]*Worst 신계약 CSM[\s\S]*Worst CSM 조정/);
assert.match(script, /이자부리·상각 연동효과 반영/);
assert.match(script, /data-forecast-open-tab="movement" data-forecast-focus="#driver-stress-panel"/);
assert.match(script, /data-forecast-panel="movement"[\s\S]*id="forecast-decision-brief"[\s\S]*id="driver-stress-panel"/);
assert.match(script, /2026 SCENARIO/);
assert.match(script, /WORST DETAIL/);
assert.match(script, /Base/);
assert.match(script, /Worst/);
assert.match(script, /driver-stress-group/);
assert.match(script, /신계약 CSM과 CSM 조정으로 구분/);
assert.match(script, /장래손해율·해지·사업비 가정 악화/);
assert.match(script, /function renderForecastDecisionBrief\(/);
assert.match(script, /if \(rounded === 0\) return/);
assert.doesNotMatch(script, /movementImprovementDirection/);
assert.match(script, /2026 CSM MOVEMENT/);
assert.match(script, /MOVEMENT COMMENTARY/);
assert.match(script, /forecast-movement-waterfall/);
assert.match(script, /movement-primary-grid/);
assert.match(script, /movement-supporting-summary/);
assert.match(script, /이자부리·CSM 상각/);
assert.doesNotMatch(script, /formatSignedTrendWon\(item\.current, 2\)/);
assert.doesNotMatch(script, /formatTrendWon\(item\.value, 2\)/);
assert.match(script, /function renderMovementEvidenceDrawer\(/);
assert.match(script, /movement-evidence-tab/);
assert.match(script, /movement-evidence-drawer/);
assert.match(script, /근거·출처/);
assert.match(script, /movementGeometry\(base\)/);
assert.match(script, /function renderForecastInsightRail\(/);
assert.doesNotMatch(script, /function renderLongTermOutlook\(/);
assert.match(script, /function forecastTenYear\(/);
assert.match(script, /return \[\.\.\.nearTerm, terminal\]/);
assert.doesNotMatch(script, /priorNetMovement/);
assert.doesNotMatch(script, /movementImprovement/);
assert.match(script, /2026년 CSM 효과/);
assert.match(script, /2025년 실제/);
assert.match(script, /변동 이유/);
assert.match(script, /산출 근거와 출처/);
assert.match(styles, /\.forecast-decision-brief/);
assert.match(styles, /\.forecast-executive-summary/);
assert.match(styles, /\.forecast-detail-tabs/);
assert.doesNotMatch(styles, /\.forecast-summary-readout/);
assert.match(styles, /\.executive-outlook-grid/);
assert.match(styles, /\.forecast-waterfall-columns/);
assert.match(styles, /\.forecast-waterfall-plot/);
assert.match(styles, /\.movement-evidence-source/);
assert.match(styles, /\.movement-evidence-tab/);
assert.match(styles, /\.movement-evidence-drawer-heading/);
assert.doesNotMatch(script, /terminalScenarioLabels/);
assert.doesNotMatch(script, /terminal-scenario-marker/);
assert.doesNotMatch(script, /long-term-outlook/);
assert.doesNotMatch(styles, /\.terminal-scenario-marker/);
assert.doesNotMatch(styles, /\.long-term-outlook-grid/);
assert.match(styles, /\.movement-bridge-grid/);
assert.match(styles, /\.movement-bridge-conclusion/);
assert.match(styles, /\.forecast-insight-rail/);
assert.match(styles, /\.scenario-range-track/);
assert.match(styles, /\.forecast-audit-details summary/);
