import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("csm-prototype/index.html", "utf8");
const script = readFileSync("csm-prototype/script.js", "utf8");
const styles = readFileSync("csm-prototype/styles.css", "utf8");
const xlsxExporter = readFileSync("csm-prototype/xlsx-export.js", "utf8");

for (const section of [
  "market",
  "movement",
  "liability-assumption",
  "claim-experience",
  "trend",
  "claim-public",
  "duration-metrics",
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
  html.indexOf('data-section-link="movement"') <
    html.indexOf('data-section-link="liability-assumption"') &&
    html.indexOf('data-section-link="liability-assumption"') <
      html.indexOf('data-section-link="claim-experience"') &&
    html.indexOf('data-section-link="claim-experience"') <
      html.indexOf('data-section-link="trend"') &&
    html.indexOf('data-section-link="trend"') <
      html.indexOf('data-section-link="claim-public"') &&
    html.indexOf('data-section-link="claim-public"') <
      html.indexOf('data-section-link="duration-metrics"') &&
    html.indexOf('data-section-link="duration-metrics"') <
      html.indexOf('data-section-link="quality"'),
  "navigation should follow the requested main, reference, and data order",
);
assert.match(html, /\(참고사항\)/, "navigation should label the reference group");
assert.match(html, /최적가정 관련 지표/, "navigation should name the best-estimate reference group");
assert.match(html, /class="nav-label-stack"[\s\S]*?5% 관리기준/, "claim navigation should show the small 5% label");
assert.match(html, /예실차 \(공시기준\)/, "public claim experience should be a standalone reference page");
assert.match(html, /경과기간 손해율·유지비율/, "loss and maintenance ratios should share one reference page");
assert.match(html, /data-duration-metric="loss"/, "duration page should expose a loss-ratio tab");
assert.match(html, /data-duration-metric="expense"/, "duration page should expose a maintenance-ratio tab");
assert.match(html, /data-duration-panel="expense" hidden/, "maintenance ratio should be hidden until selected");
assert.match(script, /function syncDurationMetricView\(/, "duration tabs should switch the visible metric panel");
assert.match(html, /보험부채 변동내역/);
assert.match(html, /data-full-metric="liability"/);
assert.match(html, /liability-assumption-data\.generated\.js/);
assert.match(script, /function renderLiabilityAssumption\(/);
assert.match(script, /function fullLiabilityAssumptionTable\(/);
assert.match(script, /Open DART \$\{hasPrior/);
assert.match(script, /원본·검증 기준은 Open DART로 단일화/);
assert.match(script, /첨부 양식과 ref_data는 화면 구조 참고에만 사용/, "dashboard methodology should state the reference-data exclusion rule");
assert.match(script, /연간 순양\(\+\) 조정/, "dashboard methodology should disclose the one-off positive adjustment exclusion");
assert.match(script, /백테스트 통제/, "dashboard methodology should disclose the forecast bias control");
assert.doesNotMatch(script, /fetch\([^)]*ref_data|import[^;]*ref_data/, "dashboard runtime must not load static reference data");
assert.match(script, /function latestAnnualPeriodAtOrBefore\(/);
assert.match(script, /annualDisclosureTargetYear/);
assert.doesNotMatch(script, /comparePeriodKeys/, "annual disclosure fallback must use the shared period comparator");
assert.match(script, /periodKey \? periodLabel\(periodKey\) : periodLabel\(state\.periodKey\)/, "quarter selection should show the latest available year-end disclosure label");
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
assert.match(html, /id="assumption-table-download"/);
assert.match(html, /xlsx-export\.js/);
assert.match(script, /function downloadAssumptionTable\(/);
assert.match(script, /CSM_Lens_\$\{meta\.filename\}/);
assert.match(xlsxExporter, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(styles, /\.modal-download/);
assert.match(styles, /\.peer-trend-panel\b/, "nine-company trend chart should have a dedicated responsive panel");
assert.match(styles, /--type-metadata:\s*11px/, "metadata should remain readable without competing with core content");
assert.match(styles, /--type-body:\s*13px/, "dashboard body text should use the unified readable scale");
assert.match(styles, /\.movement-table tbody td,[\s\S]*?font-size:\s*var\(--type-body\)/, "main table values should use the readable body size");
assert.match(styles, /\.claim-current-value strong[\s\S]*?font-size:\s*26px/, "claim experience headline values should remain prominent");
assert.match(html, /id="assumption-table-modal"/);
assert.match(html, /id="assumption-chart-modal"/);
assert.match(styles, /\.compact-ratio-table\b/);
assert.match(styles, /\.duration-spark-button\b/);
assert.match(html, /data-nav-scroll="-1"/, "compact navigation should expose a previous control");
assert.match(html, /data-nav-scroll="1"/, "compact navigation should expose a next control");
assert.match(script, /primaryNav\?\.scrollBy/, "compact navigation controls should scroll the menu");
assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.liability-summary-grid,[\s\S]*?\.trend-grid[\s\S]*?grid-template-columns:\s*1fr/, "tablet cards should stack sector groups before they become unreadable");
assert.match(html, /표시 단위: 조원/, "liability cards should declare the normalized trillion-won display unit");
assert.match(script, /trillion = Math\.abs\(number\) \/ 10000/, "liability display values should convert eok-won source values to trillion won");
assert.match(script, /금액: 조원 · 비율 행: %/, "liability full view should state its amount and ratio units");
assert.match(script, /금액: 억원 · 비율: %/, "duration full views should state their amount and ratio units");
assert.match(styles, /\.duration-bucket-14/, "mobile duration summaries should retain a long-duration anchor");
assert.match(styles, /\.duration-point-value-14/, "mobile duration charts should retain the terminal value label");

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
assert.match(html, /CSM 추이 전망/, "dashboard should name the fifth page as history and forecast");
assert.ok(
  html.indexOf('class="panel peer-trend-panel"') < html.indexOf('class="panel forecast-method-panel"') &&
    html.indexOf('class="panel forecast-method-panel"') < html.indexOf('id="trend-grid"'),
  "the integrated peer view should precede methodology and company graph cards",
);
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
assert.doesNotMatch(script, /terminalPeriod|horizon\?\.terminal/, "forecast series should stop at the fifth annual horizon");
assert.doesNotMatch(script, /mini-long-term-base-line/, "trend cards should use one continuous five-year scenario line");
assert.doesNotMatch(script, /terminal-scenario-label/, "trend modal should not expose a separate terminal scenario");
assert.match(script, /baseSeries\.map\(\(item, index\) => `<circle class="base-point"/, "every Base horizon should use the same point renderer");
assert.match(script, /worstSeries\.map\(\(item, index\) => `<circle class="worst-point"/, "every Worst horizon should use the same point renderer");
assert.doesNotMatch(script, /baseSeriesLabel|worstSeriesLabel/, "forecast point labels should rely on the legend and color instead of repeating scenario names");
assert.match(script, /chart-value-label actual-value/, "trend modal should label each actual CSM value");
assert.match(script, /function trendPeriodLabel\(/, "fourth-quarter trend points should be labeled as year-end");
assert.match(script, /function formatTrendWon\(/, "trend values should use the compact 조 unit");
assert.match(script, /function formatSignedTrendWon\(/, "signed trend values should use the compact 조 unit");
assert.match(
  html,
  /향후 1년부터 5년까지 매년 Base와 Worst로 전망/,
  "trend copy should explain that all five annual horizons have Base and Worst values",
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
assert.match(html, /CSM 전망은 이렇게 계산합니다/, "forecast methodology should lead with plain business language");
assert.match(html, /기시 CSM \+ 신계약 CSM \+ 이자부리 \+ CSM 조정 - CSM 상각/, "forecast methodology should expose the annual movement formula");
assert.match(script, /id="forecast-method-summary"/, "forecast detail should show the method before the chart");
assert.match(script, /function renderForecastMethodSummary\(/, "forecast detail should render the common Base method");
assert.match(script, /function annualNewBusinessHistory\(/, "company commentary should use actual new-business history");
assert.match(script, /yearEnd\?\.movement \?\? fourthQuarter\?\.quarterlyAudit\?\.disclosedCumulativeMovement/, "annual new-business commentary should prefer cumulative year-end movement");
assert.match(script, /function forecastTrajectoryLabel\(/, "long-term commentary should distinguish the medium- and long-term path");
assert.match(script, /중기 상승 후 보합/, "long-term commentary should avoid flattening a mixed path into one direction");
assert.match(script, /① 최근 흐름/, "company commentary should label the weighted growth step");
assert.match(script, /② 공통 상·하한/, "company commentary should explain the common growth cap");
assert.match(script, /③ 과거 예측오차/, "company commentary should explain the backtest adjustment");
assert.match(script, /④ 최종 적용/, "company commentary should separate the final applied rate");
assert.match(script, /01 · 전망 결론/, "CEO commentary should lead with the forecast conclusion");
assert.match(script, /class="insight-conclusion-title"/, "the conclusion direction should sit on its own line before the forecast path");
assert.match(script, /class="forecast-chart-scenario-detail" id="driver-forecast-panel"/, "the chart should contain the full Base and Worst scenario detail");
assert.doesNotMatch(script, /<article class="driver-forecast-panel"/, "the Base and Worst scenario box should not be duplicated below the chart layout");
assert.match(script, /Base 전망과 Worst 산정 기준/, "the chart should name the embedded scenario detail clearly");
assert.match(styles, /\.forecast-chart-scenario-detail\b/, "the in-chart scenario detail should have a dedicated responsive layout");
assert.match(script, /class="scenario-confidence-note"/, "the chart should label long-horizon values as scenarios");
assert.match(script, /경상 CSM 조정/, "management-target adjustment should be separated from recurring adjustment");
assert.match(script, /경영목표 연결/, "management-target reconciliation should be visible as its own adjustment component");
assert.match(script, /2026 최대 기여항목/, "Movement conclusion should distinguish current-year contribution");
assert.match(script, /전년 대비 최대 변화/, "Movement conclusion should distinguish year-over-year change");
assert.match(script, /<details class="movement-supporting-summary movement-secondary-details">/, "supporting Movement should be collapsed by default");
assert.match(script, /<details class="driver-stress-disclosure">/, "Worst detail should be collapsed by default");
assert.match(script, /02 · 핵심 성장동력/, "CEO commentary should explain the main growth driver second");
assert.match(script, /03 · CSM 유지 구조/, "CEO commentary should close with the sustainability of CSM inflows and outflows");
assert.match(script, /<b>감소요인<\/b><p class="insight-movement-components">/, "CSM adjustment and amortization should sit under the decrease-driver row");
assert.match(script, /CSM 조정 <em>\$\{formatSignedTrendWon\(base\.adjustment\)\}/, "CSM sustainability should disclose adjustment separately");
assert.match(script, /CSM 상각 <em>\$\{formatSignedTrendWon\(base\.amortization\)\}/, "CSM sustainability should disclose amortization separately");
assert.match(script, /class="insight-fact-list"/, "forecast explanations should separate assumptions and results into labeled rows");
assert.match(script, /3~4분기 Base 대비 10% 감소/, "forecast path should state the common new-business Worst rule");
assert.match(script, /3~4분기 Base 대비 10% 악화/, "forecast path should state the common adjustment Worst rule");
assert.match(styles, /\.driver-worst-rules\b/, "the common Worst rule should have a dedicated readable block");
assert.match(styles, /\.forecast-method-summary\b/, "the forecast method summary should have dedicated executive styling");
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
