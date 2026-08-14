import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rootHtml = readFileSync("index.html", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
const dashboardData = JSON.parse(
  readFileSync("external-data/csm-annual-dashboard-data.json", "utf8"),
);
const dashboardHtml = readFileSync("csm-prototype/index.html", "utf8");
const dashboardScript = readFileSync("csm-prototype/script.js", "utf8");

assert.match(
  rootHtml,
  /\/csm-prototype\/index\.html/,
  "workspace root should forward users to the CSM dashboard",
);
assert.ok(
  vercelConfig.redirects.some(
    (rule) =>
      rule.source === "/" &&
      rule.destination === "/csm-prototype/index.html" &&
      rule.permanent === false,
  ),
  "production root should redirect to the CSM dashboard",
);

const expectedLifeCsm = {
  "samsung-life": [10749, 12247, 12902, 13218],
  "hanwha-life": [9763, 9238, 9109, 8714],
  "kyobo-life": [5534, 6115, 6438, 6511],
  "shinhan-life": [6925, 7169, 7224, 7554],
};

for (const [companyKey, expected] of Object.entries(expectedLifeCsm)) {
  const periods = dashboardData.sampleData[companyKey].periods;
  const actual = dashboardData.years.map((year) => periods[`${year}-ye`].csm);
  assert.deepEqual(
    actual,
    expected,
    `${companyKey} should use separate-statement CSM year-end values`,
  );
  for (const year of dashboardData.years) {
    const period = periods[`${year}-ye`];
    const movement = period.movement;
    assert.equal(
      movement.closing,
      movement.opening +
        movement.newbiz +
        movement.interest +
        movement.amortization +
        movement.adjustment,
      `${companyKey} ${year} movement should reconcile`,
    );
    assert.ok(period.validation, `${companyKey} ${year} should include validation metadata`);
  }
}

assert.equal(
  dashboardData.sampleData["samsung-life"].periods["2025-ye"].kics,
  197.97,
  "Samsung Life should fall back to the pre-transition FISIS K-ICS field",
);
assert.equal(
  dashboardData.sampleData["kyobo-life"].periods["2023-ye"].insuranceProfit,
  232.682,
  "Kyobo Life 2023 insurance profit should use the FISIS-restated separate value",
);

const meritz2025 = dashboardData.sampleData["meritz-fire"].periods["2025-ye"];
assert.deepEqual(
  meritz2025.movement,
  {
    opening: 11188,
    newbiz: 1588,
    interest: 362,
    amortization: -1167,
    closing: 11104,
    adjustment: -867,
  },
  "Meritz Fire 2025 should combine both issued-insurance CSM movement tables",
);
assert.deepEqual(
  meritz2025.sourceReference.sourceTables,
  [324, 328],
  "Meritz Fire 2025 should retain both source table references",
);
assert.equal(
  meritz2025.kics,
  241.33,
  "Meritz Fire 2025 K-ICS should match FISIS SI021/D",
);
assert.equal(
  meritz2025.validation.movement.status,
  "matched",
  "Meritz Fire 2025 movement should match official IR",
);

assert.match(dashboardHtml, /선택 데이터 감사 기록/);
assert.match(dashboardHtml, /quality-method-table-body/);
assert.match(dashboardHtml, /quality-method-history/);
assert.match(dashboardHtml, /quality-processing-record/);
assert.match(dashboardScript, /methodologyRegistry/);
assert.match(dashboardScript, /renderProcessingLineage/);
assert.match(dashboardScript, /생보 SH154\/A, 손보 SI150\/A/);
assert.match(dashboardScript, /생보 SH154\/G, 손보 SI150\/G/);
assert.match(dashboardScript, /생보 SH021\/D·손보 SI021\/D/);
assert.match(dashboardHtml, /FISIS에 없는 CSM과 Movement는 각 회사 공식 IR/);
