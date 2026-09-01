import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");
const forecast = JSON.parse(readFileSync("external-data/csm-forecast-2026.json", "utf8"));
const dashboard = JSON.parse(readFileSync("external-data/csm-quarterly-dashboard-data.json", "utf8"));

assert.equal(forecast.asOfPeriod, "2026-q2");
assert.equal(forecast.targetPeriod, "2026-ye");
assert.equal(forecast.version, "2026.08.21-v10.3");
assert.equal(forecast.methodology.model, "rolling-origin-current-year/v5 + samsung-driver-ensemble/v5");
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
assert.deepEqual(forecast.nearTermPeriods, ["2026-ye", "2027-ye", "2028-ye", "2029-ye", "2030-ye"]);
assert.equal(forecast.terminalPeriod, undefined);
assert.equal(Object.keys(forecast.forecasts).length, 9, "all nine dashboard companies need forecasts");

for (const [companyKey, entry] of Object.entries(forecast.forecasts)) {
  assert.ok(entry.sources.length >= 1, `${companyKey} should retain analyst evidence`);
  assert.ok(entry.sources.every((source) => source.type === "sell_side"), `${companyKey} sources must be sell-side analyst reports`);
  assert.ok(entry.sources.every((source) => source.id), `${companyKey} analyst sources should have stable ids`);
  assert.ok(entry.evidenceSources.some((source) => source.type === "official_filing"), `${companyKey} should link its Q2 DART filing`);
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
    companyKey === "samsung-life" ? "samsung-driver-ensemble/v5" : "rolling-origin-current-year/v5",
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
    assert.ok(
      sample.inputAudit.adjustmentObservations.every(
        (observation) => observation.year < sample.forecastYear,
      ),
      `${companyKey} backtest adjustment target must use only prior full years`,
    );
  }
  assert.ok([0, 0.25].includes(entry.model.analystOverlay.weight));
  assert.ok(entry.model.baseline.remainingNewbiz > 0);
  assert.ok(Number.isFinite(entry.model.baseline.remainingAdjustment));
  assert.deepEqual(
    entry.model.baseline.drivers.adjustment.observations.map((observation) => observation.year),
    [2024, 2025],
    `${companyKey} 2026 normalized adjustment should use only the two prior year-ends`,
  );
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
    assert.equal(scenario.quarters.length, 4, `${companyKey} ${scenarioKey} should combine H1 actual and Q3-Q4 forecast`);
    assert.equal(scenario.quarters[0].actual, true, `${companyKey} should identify Q1 as actual`);
    assert.equal(scenario.quarters[1].actual, true, `${companyKey} should identify Q2 as actual`);
    assert.equal(scenario.quarters[2].actual, undefined, `${companyKey} should identify Q3 as forecast`);
    assert.equal(scenario.quarters[3].actual, undefined, `${companyKey} should identify Q4 as forecast`);
    for (const quarter of scenario.quarters) {
      assert.equal(
        quarter.opening + quarter.newbiz + quarter.interest + quarter.adjustment + quarter.amortization,
        quarter.closing,
        `${companyKey} ${scenarioKey} ${quarter.period} should reconcile`,
      );
    }
  }
  assert.deepEqual(entry.horizon.nearTermPeriods, forecast.nearTermPeriods);
  assert.equal(entry.horizon.terminalPeriod, undefined);
  assert.equal(entry.horizon.terminal, undefined);
  assert.equal(entry.worstAssumption.newbizDiscount, 0.1);
  assert.equal(entry.worstAssumption.adjustmentStress, 0.1);
  assert.equal(entry.worstAssumption.adjustmentRatePointFloor, 0.01);
  assert.equal(entry.horizon.assumptions.worstNewbizStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstAdjustmentStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstAdjustmentRatePointFloor, 0.01);
  assert.equal(entry.horizon.assumptions.worstPolicy.newbizDiscount, 0.1);
  assert.equal(entry.horizon.assumptions.worstPolicy.adjustmentStress, 0.1);
  assert.equal(entry.horizon.assumptions.worstPolicy.adjustmentRatePointFloor, 0.01);
  assert.ok(entry.horizon.assumptions.newbizGrowth >= -0.05);
  assert.ok(entry.horizon.assumptions.newbizGrowth <= 0.05);
  assert.deepEqual(entry.horizon.assumptions.newbizGrowthBounds, { lower: -0.05, upper: 0.05 });
  assert.equal(entry.horizon.assumptions.longTermNewbizGrowth, undefined);
  assert.ok(entry.horizon.assumptions.baseAdjustmentRate <= 0);
  assert.ok(entry.horizon.assumptions.optimismBiasPenalty >= 0);
  assert.ok(entry.horizon.assumptions.optimismBiasPenalty <= 0.02);
  assert.deepEqual(
    entry.horizon.assumptions.newbizTrendWindow.map((item) => [item.year, item.valueKind]),
    [[2024, "actual"], [2025, "actual"], [2026, "base_forecast"]],
    `${companyKey} new business trend should use 2024/2025 actuals and 2026 Base`,
  );
  assert.deepEqual(
    entry.horizon.assumptions.newbizGrowthObservations.map((item) => item.weight),
    [0.35, 0.65],
  );
  assert.deepEqual(
    entry.horizon.assumptions.adjustmentRateWindow.map((item) => [item.year, item.valueKind]),
    [[2024, "actual"], [2025, "actual"], [2026, "base_forecast"]],
    `${companyKey} CSM adjustment rate should use the same three-year window`,
  );
  assert.ok(
    Math.abs(entry.horizon.assumptions.adjustmentRateWeights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9,
    `${companyKey} included CSM adjustment weights should sum to one`,
  );
  assert.equal(entry.horizon.assumptions.stressCalibrationSampleCount, 6);
  assert.deepEqual(entry.horizon.horizonConfidence, {
    oneYear: "제한적 검증",
    twoToThreeYears: "모델 경로",
    fourToFiveYears: "시나리오",
  });
  for (const scenarioKey of ["base", "worst"]) {
    assert.equal(entry.horizon[scenarioKey].length, 5, `${companyKey} should display annual 1Y through 5Y forecasts`);
    assert.deepEqual(
      entry.horizon[scenarioKey].map((point) => point.period),
      forecast.nearTermPeriods,
      `${companyKey} ${scenarioKey} should include every annual horizon`,
    );
    for (const point of entry.horizon[scenarioKey]) {
      assert.equal(
        point.opening + point.newbiz + point.interest + point.adjustment + point.amortization,
        point.closing,
        `${companyKey} ${scenarioKey} ${point.period} should reconcile`,
      );
    }
  }
  entry.horizon.base.forEach((point, index) => {
    assert.ok(entry.horizon.worst[index].closing < point.closing, `${companyKey} ${point.period} Worst should be below Base`);
  });
  assert.ok(
    Math.abs(
      entry.worst.remainingForecast.newbiz
        - entry.base.remainingForecast.newbiz * (1 - entry.horizon.assumptions.worstNewbizStress),
    ) <= 0.5,
    `${companyKey} Worst remaining new business should be 10% below Base within rounding tolerance`,
  );
  const expectedWorstAdjustment = entry.base.remainingForecast.adjustment - Math.max(
    Math.round(Math.abs(entry.base.remainingForecast.adjustment) * 0.1),
    Math.round(entry.asOfCsm * 0.01),
  );
  assert.ok(
    Math.abs(entry.worst.remainingForecast.adjustment - expectedWorstAdjustment) <= 0.5,
    `${companyKey} Worst remaining adjustment should be 10% worse with a 1% opening CSM floor`,
  );
  assert.ok(entry.worst.closing < entry.base.closing, `${companyKey} worst should be below base`);
  assert.ok(entry.horizon.executiveRationale.years1to3);
  assert.ok(entry.horizon.executiveRationale.years4to5);
  assert.equal(entry.horizon.executiveRationale.year10, undefined);
}

for (const companyKey of ["kyobo-life", "hyundai-marine"]) {
  const entry = forecast.forecasts[companyKey];
  assert.ok(entry.horizon.assumptions.baseAdjustmentRate < 0, `${companyKey} must not repeat a positive adjustment reversal`);
  assert.ok(
    entry.horizon.base.at(-1).closing / entry.base.closing <= 1.55,
    `${companyKey} five-year Base should stay within the controlled path guardrail`,
  );
}

const meritzAdjustmentWindow = forecast.forecasts["meritz-fire"].horizon.assumptions.adjustmentRateWindow;
assert.equal(meritzAdjustmentWindow[0].reportedAdjustment, 151);
assert.equal(meritzAdjustmentWindow[0].oneOffExcluded, 151);
assert.equal(meritzAdjustmentWindow[0].included, false);
assert.equal(meritzAdjustmentWindow[0].weight, 0);

const samsung = forecast.forecasts["samsung-life"];
const driver = samsung.driverForecast;
const samsungPriorMovement = dashboard.sampleData["samsung-life"].periods["2025-ye"].movement;
assert.equal(samsung.anchor.type, "management_target");
assert.equal(samsung.anchor.value, 13500);
assert.equal(samsung.anchor.modelClosing, 13901);
assert.equal(samsung.anchor.reconciliation, -401);
assert.equal(samsung.anchor.verificationStatus, "unverified");
assert.equal(samsung.anchor.originalAttached, false);
assert.equal(samsung.base.closing, 13500);
assert.equal(samsung.base.modelClosing, 13901);
assert.equal(samsung.base.adjustmentBeforeTargetOverlay, -1812);
assert.equal(samsung.base.targetAdjustmentOverlay, -401);
assert.equal(samsung.base.adjustment, -2213, "management target gap should be included in CSM adjustment");
assert.equal(samsung.base.quarters.at(-1).targetAdjustmentOverlay, -401);
assert.equal(samsung.base.quarters.at(-1).closing, 13500);
assert.equal(samsung.independentModel.base.closing, 13901);
assert.equal(samsung.worst.closing, 13187);
assert.equal(samsung.horizon.base[1].closing, 14016);
assert.ok(samsung.horizon.base[1].closing - samsung.base.closing < 600, "2027 should not rebound through a one-year target-overlay cliff");
assert.deepEqual(samsung.horizon.assumptions.targetAdjustmentNormalization.schedule, {
  "2026-ye": -401,
  "2027-ye": -267,
  "2028-ye": -134,
  "2029-ye": 0,
});
assert.equal(samsung.horizon.base.at(-1).closing, 16315);
assert.equal(samsung.horizon.base.find((point) => point.period === "2029-ye").closing, 15511);
assert.equal(samsung.horizon.terminal, undefined);
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
assert.match(driver.movementEvidence.newbiz.items[2].detail, /70%.*30%/);
assert.match(driver.movementEvidence.adjustment.items.find((item) => item.label === "경영진 설명").detail, /1~2%/);
assert.match(driver.movementEvidence.adjustment.statement, /13\.5조원.*경영목표 연결분.*-0\.40조원.*CSM 조정에 포함/);
assert.ok(driver, "Samsung Life should expose the driver forecast pilot");
assert.equal(
  samsung.base.newbiz + samsung.base.interest
    - samsungPriorMovement.newbiz - samsungPriorMovement.interest,
  420,
  "Samsung growth drivers should improve KRW 420bn year over year",
);
assert.equal(samsung.base.newbiz - samsungPriorMovement.newbiz, 393);
assert.equal(samsung.base.interest - samsungPriorMovement.interest, 27);
assert.equal(samsung.base.adjustment - samsungPriorMovement.adjustment, -455);
assert.equal(samsung.base.amortization - samsungPriorMovement.amortization, 1);
assert.equal(driver.modelVersion, "samsung-driver-ensemble/v5");
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
assert.equal(driver.knownBaseAnchor.reconciliation, -401);
assert.equal(driver.knownBaseAnchor.verificationStatus, "unverified");
assert.equal(driver.independentModel.base.closing, 13901);
assert.equal(driver.distribution.p50.quarters[0].actual, true);
assert.equal(driver.distribution.p50.quarters[0].newbiz, 849);
assert.equal(driver.distribution.p50.quarters[1].actual, true);
assert.equal(driver.distribution.p50.quarters[1].newbiz, 868);
assert.equal(driver.distribution.p10.label, "Worst");
assert.equal(driver.distribution.p50.label, "Base");
assert.match(samsung.base.rationale, /Base/);
assert.doesNotMatch(samsung.base.rationale, /70%|30%|P50/);
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
assert.match(html, /id="peer-trend-chart"/, "trend page should include one integrated nine-company CSM trend chart");
assert.match(html, /9개사 보유 CSM 추이/, "peer chart should describe an absolute CSM trend rather than an indexed rate");
assert.doesNotMatch(html, /id="peer-trend-legend"/, "redundant company legend boxes should not appear below the integrated chart");
assert.match(html, /data-peer-trend-scenario="base"/, "peer trend chart should default to the Base scenario");
assert.match(html, /data-peer-trend-scenario="worst"/, "peer trend chart should allow the Worst scenario");
assert.match(html, /CSM_FORECAST_METHODOLOGY\.md/);
assert.match(script, /window\.CSM_FORECAST_DATA/);
assert.match(script, /function renderForecastMethodology\(/);
assert.match(script, /function renderPeerTrendChart\(/, "dashboard should render the integrated nine-company CSM trend chart");
assert.doesNotMatch(script, /\.YE| YE\b/, "visible year-end labels should use 4Q instead of YE");
assert.match(script, /30\.4Q/, "the five-year endpoint heading should use 4Q");
assert.match(script, /trendHistoryPeriodKeys\(context\.company\)/, "peer chart should connect annual actual history to the forecast");
assert.match(script, /values = \[\.\.\.history\.map/, "peer chart should compare absolute CSM values on one shared axis");
assert.doesNotMatch(script, /point\.closing \/ context\.period\.csm - 1/, "peer chart should not collapse all insurers to a zero-percent origin");
assert.match(script, /peer-trend-actual-line/, "peer chart should distinguish actual history with a dedicated line");
assert.match(script, /data-peer-history-point/, "historical year-end points should expose hover targets");
assert.match(script, /parsed\.kind === "ye" \|\| parsed\.quarter === 4/, "historical hover values should be limited to year-end observations");
assert.match(script, /class="peer-trend-tooltip" role="tooltip" hidden/, "historical values should stay hidden until hover or keyboard focus");
assert.match(script, /mouseenter[\s\S]*focus[\s\S]*blur/, "historical tooltips should support pointer and keyboard users");
assert.match(script, /peer-trend-forecast-line/, "peer chart should distinguish the forecast horizon with a dedicated line");
assert.match(script, /peer-trend-latest-labels/, "peer chart should label each company with its latest actual CSM inside the plot");
assert.match(script, /\$\{item\.catalog\.name\} · \$\{formatTrendWon\(actualValue\)\}/, "latest actual labels should include company and CSM value");
assert.doesNotMatch(script, /peer-trend-facet sector-/, "life and non-life should share one integrated plot");
assert.match(script, /peer-trend-line-halo/, "overlapping company lines should use a separating halo");
assert.match(script, /peer-trend-end-combined/, "peer chart should directly label every five-year endpoint");
assert.match(script, /peer-trend-label-lane peer-trend-latest-lane/, "latest actual labels should sit in a subtle dedicated lane");
assert.match(script, /peer-trend-label-lane peer-trend-final-lane/, "five-year forecast labels should sit in a subtle dedicated lane");
assert.match(script, /right: 160/, "the endpoint label lane should reserve enough width for long company names");
assert.doesNotMatch(script, /peer-trend-legend-group/, "company legend cards should not be rendered separately from direct chart labels");
assert.match(script, /document\.addEventListener\("click", \(event\) => \{[\s\S]*!state\.peerTrendCompanyKey[\s\S]*target\.closest\("\[data-peer-select\]/, "blank-page clicks should clear a selected peer trend without cancelling direct company selection");
assert.match(script, /state\.peerTrendCompanyKey = null;[\s\S]*renderPeerTrendChart\(\);/, "clearing the selected peer should redraw the full nine-company comparison");
assert.match(html, /● 생보 · ■ 손보/, "the integrated chart should retain a compact sector marker distinction");
assert.doesNotMatch(html, /회사명을 선택하면 해당 흐름을 강조합니다/, "the chart footer should avoid redundant interaction instructions");
assert.match(script, /horizon\.length !== 5/, "peer chart should require all five annual forecasts");
assert.match(script, /source\.type === "user_provided"/);
assert.match(script, /storedEntry\.asOfPeriod === context\.periodKey/);
assert.match(script, /확정 사실 · 외부 전망 · 모델 추정 · 경영 입력 · 가정/);
assert.match(script, /전망 판단/);
assert.match(script, /1년 예상/);
assert.match(script, /4년 예상/);
assert.match(script, /5년 예상/);
assert.doesNotMatch(script, /10년 예상/);
assert.doesNotMatch(script, /assumption-strip/);
assert.match(script, /개 검증 시점 · MAPE/);
assert.match(script, /function renderForecastExecutiveSummary\(/);
assert.match(script, /예상 CSM/);
assert.doesNotMatch(script, /executive-summary-metrics/);
assert.doesNotMatch(script, /회사·업권 오차 계층 보정/);
assert.match(script, /function bindForecastDetailTabs\(/);
assert.doesNotMatch(script, /data-forecast-tab="summary"/);
assert.match(script, /data-forecast-tab="outlook">실적·중장기 전망/);
assert.match(script, /data-forecast-tab="outlook">실적·중장기 전망[\s\S]*data-forecast-tab="movement"><span>Movement<\/span><small>\$\{movementTargetLabel\}<\/small>[\s\S]*data-forecast-tab="evidence">산출 근거·검증/);
assert.match(script, /forecastEntry\?\.targetPeriod[\s\S]*년말 전망/);
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
assert.match(script, /function forecastConclusionReason\(/);
assert.match(script, /신계약 CSM 성장으로 유입이 조정·상각 부담을 상회/);
assert.match(script, /신계약 CSM 둔화로 조정·상각 부담을 상쇄하지 못함/);
assert.match(script, /class="insight-conclusion-reason"/);
assert.doesNotMatch(script, /function renderLongTermOutlook\(/);
assert.doesNotMatch(script, /function forecastTenYear\(/);
assert.doesNotMatch(script, /terminalPeriod|horizon\?\.terminal/);
assert.doesNotMatch(script, /priorNetMovement/);
assert.doesNotMatch(script, /movementImprovement/);
assert.match(script, /2026년 CSM 효과/);
assert.match(script, /2025년 실제/);
assert.match(script, /변동 이유/);
assert.match(script, /산출 근거와 출처/);
assert.match(styles, /\.forecast-decision-brief/);
assert.match(styles, /\.forecast-executive-summary/);
assert.match(styles, /\.forecast-detail-tabs/);
assert.match(styles, /\.forecast-detail-tabs button \{[\s\S]*?align-items:\s*center;/, "forecast detail tab labels should be vertically centered");
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
assert.match(styles, /\.insight-conclusion-reason/);
assert.match(styles, /\.peer-trend-label-lane/);
assert.match(styles, /\.peer-trend-history-hit/);
assert.match(styles, /\.peer-trend-tooltip/);
assert.match(styles, /\.scenario-range-track/);
assert.match(styles, /\.forecast-audit-details summary/);
