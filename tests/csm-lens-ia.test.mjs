import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");

for (const section of [
  "market",
  "movement",
  "trend",
  "liability-assumption",
  "claim-experience",
  "loss-duration",
  "expense-duration",
  "quality",
]) {
  assert.match(
    html,
    new RegExp(`data-section-link="${section}"`),
    `navigation should link to ${section}`,
  );
  assert.match(
    html,
    new RegExp(`data-page-section="${section}"`),
    `page should expose the ${section} section`,
  );
}
assert.match(html, /class="dashboard-page is-active" id="market"/, "market should be the default page");
assert.match(
  html,
  /class="dashboard-page section-block movement-section"[^>]*hidden/,
  "non-default dashboard pages should be hidden before navigation initializes",
);
assert.match(styles, /\.dashboard-page\[hidden\]/, "inactive dashboard pages should be removed from layout");
assert.match(script, /section\.hidden = !isActive/, "navigation should show exactly one dashboard page");
assert.match(script, /window\.history\.pushState/, "page navigation should preserve URL history");
assert.doesNotMatch(script, /new IntersectionObserver/, "navigation should no longer follow long-page scrolling");

assert.ok(
  html.indexOf('data-page-section="trend"') <
    html.indexOf('data-page-section="liability-assumption"') &&
    html.indexOf('data-page-section="liability-assumption"') <
    html.indexOf('data-page-section="claim-experience"') &&
    html.indexOf('data-page-section="claim-experience"') <
      html.indexOf('data-page-section="loss-duration"') &&
    html.indexOf('data-page-section="loss-duration"') <
      html.indexOf('data-page-section="expense-duration"'),
  "liability and assumption metrics should follow the requested 04–07 order",
);
assert.match(html, /보험부채 변동내역/);
assert.match(html, /data-full-metric="liability"/);
assert.match(html, /liability-assumption-data\.generated\.js/);
assert.match(script, /function renderLiabilityAssumption\(/);
assert.match(script, /function fullLiabilityAssumptionTable\(/);
assert.match(script, /Open DART \$\{hasPrior/);
assert.match(script, /원본·검증 기준은 Open DART로 단일화/);
assert.doesNotMatch(script, /ref_data/, "dashboard methodology must not use static reference data as validation");
assert.match(script, /if \(kind !== "ye" && quarter !== 4\) return null/);
assert.match(script, /disabled = !periodKey/, "quarter selection should disable liability full view");
assert.match(script, /row\.label\.startsWith\("\*"\)/, "only the dedicated ratio row should use percent formatting");
assert.match(html, /보험금 예실차 비율/);
assert.match(html, /예상손해율 = 당기 예상보험금\(종신연금지급금 포함\) ÷ 당기 실제위험보험료/);
assert.match(html, /실제손해율 = \(당기 발생보험금 \+ 당기 발생사고요소조정\) ÷ 당기 실제위험보험료/);
assert.match(styles, /\.claim-formula-note\b/);
assert.doesNotMatch(script, /class="zero-axis/, "baseline should not use a numeric zero badge");
assert.match(styles, /\.liability-driver-track::after/, "liability bars should draw a visible zero line");
assert.match(styles, /\.claim-diverging::after/, "claim variance bars should draw a visible zero line");
assert.match(html, /\(경과기간별\) 손해율 현황/);
assert.match(html, /\(경과기간별\) 유지비율 현황/);
assert.match(html, /assumption-data\.generated\.js/);
assert.match(script, /function renderAssumptionMetrics\(/);
assert.match(script, /assumptionPeriodAvailable/);
assert.match(script, /2024년말부터 연 1회 공시/);
assert.match(script, /state\.periodKey/);
assert.match(script, /openAssumptionTable/);
assert.match(script, /openDurationChart/);
assert.match(html, /data-full-metric="claim"/);
assert.match(html, /id="assumption-table-modal"/);
assert.match(html, /id="assumption-chart-modal"/);
assert.match(styles, /\.compact-ratio-table\b/);
assert.match(styles, /\.duration-spark-button\b/);

assert.match(html, /id="industry-comparison-title"[^>]*>업권별 보유 CSM 비교/, "market view should name the active comparison metric");
assert.match(script, /업권별 \$\{metric\.label\} 비교/, "market title should follow the selected metric tab");
assert.doesNotMatch(script, /escapeHtml\(row\.company\.type\)/, "market chart should not show subjective company-type labels");
assert.match(script, /const sectorCatalog = \[/, "dashboard should define reusable life/non-life groups");
assert.match(script, /function renderSectorCardGroups\(/, "multi-company cards should share one sector grouping renderer");
assert.match(script, /rowspan="\$\{companiesInSector/, "tables should label each sector once with a merged row group");
assert.match(html, /<th class="table-sector-heading">업권<\/th>\s*<th class="table-company-heading">회사<\/th>/, "table identity columns should lead with sector, then company");
assert.match(styles, /\.industry-sector-group\b/, "market chart should visually box life and non-life companies");
assert.match(styles, /\.sector-card-group\b/, "card dashboards should visually group companies by sector");
assert.match(styles, /\.sector-group-cell\b/, "tables should give sector row groups a distinct visual treatment");
assert.match(styles, /\.table-company-cell\b/, "company alignment should use a stable class instead of child position");
assert.match(styles, /\.table-company-heading\b/, "company headings should share one alignment rule");
assert.match(
  styles,
  /\.liability-summary-grid,[\s\S]*?\.claim-summary-grid,[\s\S]*?\.trend-grid[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "trend, liability, and claim sector panels should use equal widths",
);
assert.match(html, /data-value-basis="cumulative"/, "dashboard should offer a cumulative basis");
assert.match(html, /data-value-basis="quarter"/, "dashboard should offer a quarterly basis");
assert.match(script, /valueBasis:\s*"cumulative"/, "cumulative basis should be the default");
assert.match(
  script,
  /function contextForValueBasis\(/,
  "industry and movement values should share a basis-aware context",
);
assert.match(
  script,
  /disclosedCumulativeMovement/,
  "cumulative movement should use the preserved DART cumulative disclosure",
);
assert.match(styles, /\.basis-toggle\b/, "the basis selector should have a visible selected state");
assert.match(html, /CSM 추이/, "dashboard should combine historical CSM and year-end forecasts");
assert.match(html, /2026 Base/, "forecast should display the Base path");
assert.match(html, /2026 Worst/, "forecast should display the Worst path");
assert.match(script, /legend-dot actual[^\n]*실적/, "trend detail should distinguish historical actuals in business terms");
assert.match(
  script,
  /function latestActualPeriodKey\(/,
  "trend should resolve the latest parsed actual independently from the dashboard period",
);
assert.match(
  script,
  /function getTrendContext\(/,
  "trend cards and modal should share a latest-actual context",
);
assert.match(
  script,
  /function trendHistoryPeriodKeys\(/,
  "trend history should keep year-end actuals plus the latest parsed quarter",
);
assert.match(
  script,
  /key === latestKey \|\| kind === "ye" \|\| quarter === 4/,
  "trend history should exclude non-year-end quarters except for the latest actual",
);
assert.doesNotMatch(script, /mini-actual-value/, "trend mini charts should not repeat point values");
assert.match(script, /trend-card-values/, "trend cards should preserve the bottom numeric summary");
assert.match(script, /return \[\.\.\.nearTerm, terminal\]/, "2035 should be appended to the common forecast horizon series");
assert.doesNotMatch(script, /mini-long-term-base-line/, "trend cards should not special-case the 2035 segment");
assert.doesNotMatch(script, /terminal-scenario-label/, "trend modal should use the common Base and Worst label design for 2035");
assert.match(script, /baseSeries\.map\(\(item, index\) => `<circle class="base-point"/, "every Base horizon should use the same point renderer");
assert.match(script, /worstSeries\.map\(\(item, index\) => `<circle class="worst-point"/, "every Worst horizon should use the same point renderer");
assert.doesNotMatch(script, /baseSeriesLabel|worstSeriesLabel/, "forecast point labels should rely on the legend and color instead of repeating scenario names");
assert.match(script, /chart-value-label actual-value/, "trend modal should label each actual CSM value");
assert.match(script, /function trendPeriodLabel\(/, "fourth-quarter trend points should be labeled as year-end");
assert.match(script, /function formatTrendWon\(/, "trend values should use the compact 조 unit");
assert.match(script, /function formatSignedTrendWon\(/, "signed trend values should use the compact 조 unit");
assert.match(
  html,
  /1년·2년·3년·5년·10년을 모두 Base와 Worst로 전망/,
  "trend copy should explain that every forecast horizon has Base and Worst values",
);
assert.doesNotMatch(
  html,
  /Optimistic/,
  "forecast should avoid an unrelated optimistic label",
);
for (const company of [
  "삼성생명",
  "한화생명",
  "교보생명",
  "신한라이프",
  "삼성화재",
  "메리츠화재",
  "DB손해보험",
  "현대해상",
  "KB손해보험",
]) {
  assert.match(script, new RegExp(company), `dashboard universe should include ${company}`);
}
assert.match(html, /id="trend-grid"/, "nine-company trend cards should have a grid");
assert.match(html, /id="trend-modal"/, "trend cards should open a large company detail modal");
assert.match(
  html,
  /id="movement-table-body"/,
  "movement should expose a nine-company numeric table",
);
assert.match(
  html,
  /id="movement-modal"/,
  "movement flow should open a large company waterfall modal",
);
assert.doesNotMatch(
  html,
  /id="market-kpi-grid"/,
  "industry view should not emphasize aggregated market totals",
);
assert.ok(
  html.indexOf('data-page-section="movement"') < html.indexOf('data-page-section="trend"'),
  "CSM Movement should appear before CSM trend",
);

for (const label of [
  "기시 CSM",
  "신계약",
  "이자부리",
  "CSM 조정 등",
  "CSM 상각",
  "기말 CSM",
]) {
  assert.match(script, new RegExp(label), `movement should preserve the IR label ${label}`);
}

assert.match(
  script,
  /function calculateForecast\(/,
  "forecast should be calculated from explicit movement assumptions",
);
assert.match(
  script,
  /newbizFactor:\s*0\.95/,
  "Base scenario should keep an explicit new-business assumption",
);
assert.match(
  script,
  /newbizFactor:\s*0\.8/,
  "Worst scenario should keep an explicit downside new-business assumption",
);
assert.match(
  script,
  /opening \+ newbiz \+ interest \+ adjustment \+ amortization/,
  "forecast should reconcile through the CSM movement formula",
);
assert.match(
  script,
  /movement\.opening \+\s*movement\.newbiz \+\s*movement\.interest \+\s*movement\.adjustment \+\s*movement\.amortization/s,
  "actual movement should retain a deterministic closing-balance check",
);

assert.match(styles, /\.industry-board\b/, "industry comparison board should have dedicated styling");
assert.match(
  styles,
  /\.industry-column-bar\b/,
  "industry comparison should use vertical company columns",
);
assert.doesNotMatch(
  styles,
  /\.industry-bar-track\b/,
  "industry comparison should not use horizontal gauge tracks",
);
assert.match(styles, /\.forecast-layout\b/, "forecast should have a visual comparison layout");
assert.match(styles, /\.trend-grid\b/, "nine-company CSM trend should use a card grid");
assert.match(styles, /\.trend-modal\b/, "company trend detail should have modal styling");
assert.match(styles, /\.mini-actual-line\b/, "trend cards should use actual time-series lines");
assert.match(styles, /\.mini-base-line\b/, "trend cards should connect to Base year-end");
assert.match(styles, /\.mini-worst-line\b/, "trend cards should connect to Worst year-end");
assert.match(styles, /\.movement-table\b/, "IR movement should have a numeric comparison table");
assert.match(styles, /\.movement-spark\b/, "each movement row should include a flow graph");
assert.match(
  styles,
  /\.movement-table th:last-child,[\s\S]*?width:\s*184px;[\s\S]*?padding-left:\s*28px;/,
  "movement flow should sit close to the closing CSM column",
);
assert.match(
  styles,
  /\.movement-table th:last-child\s*\{\s*text-align:\s*center;/,
  "movement flow heading should use centered alignment",
);
assert.match(
  script,
  /function movementGeometry\(/,
  "movement mini charts should use cumulative actual movement geometry",
);
assert.match(
  script,
  /openMovementModal/,
  "movement mini charts should open a large actual-value waterfall",
);
assert.match(
  styles,
  /@media\s*\(max-width:\s*580px\)/,
  "dashboard should include a mobile layout",
);
