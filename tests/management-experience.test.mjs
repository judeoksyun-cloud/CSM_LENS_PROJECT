import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");
const sourceData = JSON.parse(readFileSync("external-data/management-experience-2025.json", "utf8"));
const generatedText = readFileSync("csm-prototype/management-experience-data.generated.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(generatedText, sandbox);
const generatedData = JSON.parse(JSON.stringify(sandbox.window.CSM_MANAGEMENT_EXPERIENCE_DATA));

assert.equal(sourceData.schemaVersion, "management-experience/v2");
assert.deepEqual(sourceData.comparisonPeriods, ["2024-ye", "2025-ye"]);
assert.equal(sourceData.basis, "별도 · SAP 손익계산서");
assert.equal(Object.keys(sourceData.companies).length, 9);
assert.match(sourceData.definitionNote, /화면 구조 참고에만 사용/);
assert.match(sourceData.sourcePolicy.primary, /공식 홈페이지.*별도 SAP/);
assert.ok(sourceData.sourcePolicy.excludedAsSourceOrValidator.includes("ref_data"));
assert.equal(sourceData.periodSelectionPolicy.frequency, "annual_only");
assert.match(sourceData.periodSelectionPolicy.prior, /미수록이면 null/);
assert.match(sourceData.validationPolicy.missingRule, /다른 지표로 대체하지 않는다/);

assert.equal(sourceData.formulas.total, "보험금 예실차 + 사업비 예실차");
assert.equal(sourceData.formulas.claim, "예상보험금 - (발생보험금 + 발생사고요소조정)");
assert.match(sourceData.formulas.expense, /예상손해조사비/);
assert.match(sourceData.formulas.totalRatio, /예상보험금 \+ 예상사업비/);
assert.equal(sourceData.guidance.thresholdPercent, 5);

for (const [companyKey, item] of Object.entries(sourceData.companies)) {
  assert.deepEqual(Object.keys(item.periods), ["2024-ye", "2025-ye"], `${companyKey} should have prior and current periods`);
  for (const [periodKey, period] of Object.entries(item.periods)) {
    assert.ok(Math.abs(period.totalExperience - period.claimExperience - period.expenseExperience) < 1e-8,
      `${companyKey} ${periodKey} combined experience should equal claim plus expense`);
    assert.match(period.source.url, /^https:\/\//);
    assert.match(period.source.scope, /별도/);
    assert.doesNotMatch(period.source.url, /ref_data|관리기준.*양식/);
  }
}

const recalculatedKeys = [
  "samsung-life",
  "hanwha-life",
  "samsung-fire",
  "meritz-fire",
  "db-insurance",
  "hyundai-marine",
];
for (const companyKey of recalculatedKeys) {
  const item = sourceData.companies[companyKey];
  assert.equal(item.verificationStatus, "official_component_recalculated");
  for (const [periodKey, period] of Object.entries(item.periods)) {
    const c = period.components;
    const claim = c.expectedClaims - (c.incurredClaims + c.incurredClaimAdjustment);
    const expense = c.expectedExpenseTotal - c.actualExpenseTotal;
    assert.ok(Math.abs(claim - period.claimExperience) < 1e-7, `${companyKey} ${periodKey} claim should recalculate`);
    assert.ok(Math.abs(expense - period.expenseExperience) < 1e-7, `${companyKey} ${periodKey} expense should recalculate`);
    assert.ok(Math.abs(period.ratios.claim - claim / c.expectedClaims * 100) < 1e-8,
      `${companyKey} ${periodKey} claim ratio should use expected claims`);
    assert.ok(Math.abs(period.ratios.expense - expense / c.expectedExpenseTotal * 100) < 1e-8,
      `${companyKey} ${periodKey} expense ratio should use expected expense`);
    assert.ok(Math.abs(period.ratios.total - (claim + expense) / (c.expectedClaims + c.expectedExpenseTotal) * 100) < 1e-8,
      `${companyKey} ${periodKey} total ratio should use combined expected amount`);
  }
}

assert.equal(Math.round(sourceData.companies["samsung-life"].periods["2024-ye"].totalExperience), -5468);
assert.equal(Math.round(sourceData.companies["samsung-life"].periods["2025-ye"].totalExperience), -2973);
assert.equal(Number(sourceData.companies["hanwha-life"].periods["2024-ye"].ratios.total.toFixed(1)), -6.9);
assert.equal(Number(sourceData.companies["hanwha-life"].periods["2025-ye"].ratios.total.toFixed(1)), -10.3);
assert.equal(sourceData.companies["kyobo-life"].periods["2024-ye"].totalExperience, 1281);
assert.equal(sourceData.companies["shinhan-life"].periods["2025-ye"].ratios.claim, null);
assert.equal(sourceData.companies["kb-insurance"].periods["2025-ye"].ratios.total, null);
assert.match(sourceData.companies["kb-insurance"].periods["2025-ye"].coverageNote, /분모/);

assert.deepEqual(generatedData, sourceData, "browser data must exactly mirror the normalized JSON contract");
assert.match(html, /관리기준 예실차 비율/);
assert.match(html, /id="management-period-label"/);
assert.match(html, /data-full-metric="management"/);
assert.match(html, /종합 예실차 = 보험금 예실차 \+ 사업비 예실차/);
assert.match(script, /function managementExperiencePeriodKey\(/);
assert.match(script, /annualDisclosureTargetYear\(\)/);
assert.match(script, /const priorPeriodKey = `\$\{currentYear - 1\}-ye`/);
assert.match(script, /function fullManagementExperienceTable\(/);
assert.match(script, /\["종합 예실차", "total", "보험금 \+ 사업비"\]/);
assert.match(script, /management:\s*\{ filename: "관리기준_예실차"/);
assert.match(styles, /\.management-claim-ratio-list\b/);
assert.match(styles, /\.management-claim-metric\b/);
assert.match(styles, /\.management-full-table-wrap\b/);

console.log("management-experience.test.mjs passed");
