import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const forecast = JSON.parse(readFileSync("external-data/csm-forecast-2026.json", "utf8"));

assert.equal(forecast.asOfPeriod, "2026-q1");
assert.equal(forecast.targetPeriod, "2026-ye");
assert.deepEqual(forecast.nearTermPeriods, ["2026-ye", "2027-ye", "2028-ye", "2030-ye"]);
assert.equal(forecast.terminalPeriod, "2035-ye");
assert.equal(Object.keys(forecast.forecasts).length, 9, "all nine dashboard companies need forecasts");

for (const [companyKey, entry] of Object.entries(forecast.forecasts)) {
  assert.ok(entry.sources.length >= 1, `${companyKey} should retain analyst evidence`);
  assert.ok(entry.sources.every((source) => source.type === "sell_side"), `${companyKey} sources must be sell-side analyst reports`);
  assert.ok(entry.qualitativeJudgment.baseNewbiz, `${companyKey} should explain new business judgment`);
  assert.ok(entry.qualitativeJudgment.baseAdjustment, `${companyKey} should explain adjustment judgment`);
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
  assert.equal(entry.horizon.assumptions.worstNewbizStress, 0.2);
  assert.equal(entry.horizon.assumptions.worstAdjustmentStress, 0.2);
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
  assert.equal(entry.worst.remainingForecast.newbiz, Math.round(entry.base.remainingForecast.newbiz * 0.8));
  assert.equal(
    entry.worst.remainingForecast.adjustment,
    Math.round(entry.base.remainingForecast.adjustment * (entry.base.remainingForecast.adjustment < 0 ? 1.2 : 0.8)),
  );
  assert.ok(entry.worst.closing < entry.base.closing, `${companyKey} worst should be below base`);
  assert.ok(entry.horizon.executiveRationale.years1to3);
  assert.ok(entry.horizon.executiveRationale.year5);
  assert.ok(entry.horizon.executiveRationale.year10);
}

assert.match(html, /forecast-data\.generated\.js/);
assert.match(html, /2026~2035 CSM 전망 산출 기준/);
assert.match(html, /id="forecast-summary-body"/);
assert.match(html, /CSM_FORECAST_METHODOLOGY\.md/);
assert.match(script, /window\.CSM_FORECAST_DATA/);
assert.match(script, /function renderForecastMethodology\(/);
assert.match(script, /storedEntry\.asOfPeriod === context\.periodKey/);
assert.match(script, /회사별 판단 근거/);
assert.match(script, /전망 구간별 핵심 근거/);
assert.match(script, /1년 전망/);
assert.match(script, /10년 전망/);
assert.doesNotMatch(script, /assumption-strip/);
assert.match(script, /외부자료는 증권사 애널리스트 리포트만 사용/);
