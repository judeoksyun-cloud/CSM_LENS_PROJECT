const cloneData =
  typeof structuredClone === "function"
    ? structuredClone
    : (value) => JSON.parse(JSON.stringify(value));

const agentData = window.CSM_AGENT_DATA ?? {};
const companies = cloneData(agentData.sampleData ?? {});
const financialMetrics = cloneData(agentData.financialMetrics ?? {});
const reviewItems = cloneData(agentData.reviewItems ?? []);
const methodologyRegistry = cloneData(agentData.methodologyRegistry ?? { records: [] });
const assumptionData = cloneData(window.CSM_ASSUMPTION_DATA ?? {});
const forecastData = cloneData(window.CSM_FORECAST_DATA ?? { forecasts: {} });
const liabilityAssumptionData = cloneData(window.CSM_LIABILITY_ASSUMPTION_DATA ?? { companies: {} });
const managementExperienceData = cloneData(window.CSM_MANAGEMENT_EXPERIENCE_DATA ?? { companies: {} });

const companyCatalog = [
  { key: "samsung-life", name: "삼성생명", sector: "생명보험", shortSector: "생보" },
  { key: "hanwha-life", name: "한화생명", sector: "생명보험", shortSector: "생보" },
  { key: "kyobo-life", name: "교보생명", sector: "생명보험", shortSector: "생보" },
  { key: "shinhan-life", name: "신한라이프", sector: "생명보험", shortSector: "생보" },
  { key: "samsung-fire", name: "삼성화재", sector: "손해보험", shortSector: "손보" },
  { key: "meritz-fire", name: "메리츠화재", sector: "손해보험", shortSector: "손보" },
  { key: "db-insurance", name: "DB손해보험", sector: "손해보험", shortSector: "손보" },
  { key: "hyundai-marine", name: "현대해상", sector: "손해보험", shortSector: "손보" },
  { key: "kb-insurance", name: "KB손해보험", sector: "손해보험", shortSector: "손보" },
];

const sectorCatalog = [
  { key: "life", name: "생명보험", shortName: "생보", description: "Life Insurance" },
  { key: "nonlife", name: "손해보험", shortName: "손보", description: "Non-life Insurance" },
];

function companiesInSector(sectorName) {
  return companyCatalog.filter((company) => company.sector === sectorName);
}

function sectorMetaForCompany(company) {
  return sectorCatalog.find((sector) => sector.name === company.sector);
}

function renderSectorCardGroups(renderCard, gridClass = "") {
  return sectorCatalog
    .map((sector) => {
      const sectorCompanies = companiesInSector(sector.name);
      return `<section class="sector-card-group sector-${sector.key}" aria-label="${sector.name}">
        <header class="sector-group-heading"><span>${sector.shortName}</span><strong>${sector.name}</strong><small>${sector.description} · ${sectorCompanies.length}개사</small></header>
        <div class="sector-card-group-grid ${gridClass}">${sectorCompanies.map(renderCard).join("")}</div>
      </section>`;
    })
    .join("");
}

if (!Object.keys(companies).length) {
  throw new Error("CSM dashboard data is not available.");
}

const periodSelect = document.querySelector("#period-select");
const metricTabs = [...document.querySelectorAll("[data-market-metric]")];
const basisButtons = [...document.querySelectorAll("[data-value-basis]")];
const durationMetricButtons = [...document.querySelectorAll("[data-duration-metric]")];
const peerTrendScenarioButtons = [...document.querySelectorAll("[data-peer-trend-scenario]")];
const peerTrendReset = document.querySelector("#peer-trend-reset");
const trendModal = document.querySelector("#trend-modal");
const trendModalClose = document.querySelector("#trend-modal-close");
const movementModal = document.querySelector("#movement-modal");
const movementModalClose = document.querySelector("#movement-modal-close");
const assumptionTableModal = document.querySelector("#assumption-table-modal");
const assumptionTableModalClose = document.querySelector("#assumption-table-modal-close");
const assumptionTableDownload = document.querySelector("#assumption-table-download");
const assumptionChartModal = document.querySelector("#assumption-chart-modal");
const assumptionChartModalClose = document.querySelector("#assumption-chart-modal-close");
let activeAssumptionTableType = null;

const state = {
  companyKey: Object.keys(companies)[0],
  periodKey: null,
  marketMetric: "csm",
  valueBasis: "cumulative",
  durationMetric: "loss",
  peerTrendScenario: "base",
  peerTrendCompanyKey: null,
};

const peerTrendColors = {
  "samsung-life": "#2f65c7",
  "hanwha-life": "#7457b8",
  "kyobo-life": "#238a86",
  "shinhan-life": "#b34f80",
  "samsung-fire": "#c45142",
  "meritz-fire": "#d6782d",
  "db-insurance": "#3d8e63",
  "hyundai-marine": "#a27921",
  "kb-insurance": "#5f7088",
};

const marketMetrics = {
  csm: {
    label: "보유 CSM",
    getValue: ({ period }) => period?.csm ?? null,
    format: formatWon,
  },
  newbiz: {
    label: "신계약 CSM",
    getValue: ({ period }) => period?.movement?.newbiz ?? null,
    format: formatWon,
  },
  netIncome: {
    label: "당기순이익",
    getValue: ({ financial }) => financial?.netIncome ?? null,
    format: formatWon,
  },
  insurance: {
    label: "보험손익",
    getValue: ({ financial }) => financial?.insuranceProfit ?? null,
    format: formatWon,
  },
  kics: {
    label: "K-ICS",
    getValue: ({ financial }) => financial?.kics ?? null,
    format: (value) => formatPercent(value, 0),
  },
};

const forecastScenarios = {
  base: {
    label: "Base",
    description: "신계약 흐름이 완만하게 유지되고 조정 부담이 제한되는 기준 시나리오",
    newbizFactor: 0.95,
    interestRate: 0.014,
    adjustmentRate: -0.01,
    amortizationRate: 0.092,
  },
  worst: {
    label: "Worst",
    description: "전 보험사 공통 하방률을 적용한 Worst 시나리오",
    newbizFactor: 0.855,
    interestRate: 0.014,
    adjustmentRate: -0.011,
    amortizationRate: 0.105,
  },
};

function parsePeriodKey(periodKey) {
  const match = String(periodKey).match(/^(\d{4})-(ye|q([1-4]))$/);
  return {
    year: match ? Number(match[1]) : 0,
    quarter: match ? (match[2] === "ye" ? 4 : Number(match[3])) : 0,
    kind: match?.[2] === "ye" ? "ye" : "quarter",
  };
}

function comparePeriods(left, right) {
  const a = parsePeriodKey(left);
  const b = parsePeriodKey(right);
  return a.year * 4 + a.quarter - (b.year * 4 + b.quarter);
}

function periodLabel(periodKey) {
  const { year, quarter, kind } = parsePeriodKey(periodKey);
  if (kind === "ye") return `${year}년말`;
  return `${year}년 ${quarter}분기${quarter === 4 ? " (연말)" : ""}`;
}

function periodShortLabel(periodKey) {
  const { year, quarter, kind } = parsePeriodKey(periodKey);
  return kind === "ye" ? `${String(year).slice(2)}.4Q` : `${String(year).slice(2)}.${quarter}Q`;
}

function trendPeriodLabel(periodKey) {
  const { year, quarter, kind } = parsePeriodKey(periodKey);
  return kind === "ye" || quarter === 4
    ? `${String(year).slice(2)}.4Q`
    : periodShortLabel(periodKey);
}

function displayPeriodKeys(company) {
  const keys = Object.keys(company?.periods ?? {});
  return keys.filter((key) => {
    const { year, kind } = parsePeriodKey(key);
    return kind !== "ye" || !keys.includes(`${year}-q4`);
  });
}

function latestCommonPeriod() {
  const periodSets = Object.values(companies).map(displayPeriodKeys);
  return periodSets
    .reduce((common, periods) => common.filter((period) => periods.includes(period)), periodSets[0])
    .sort(comparePeriods)
    .at(-1);
}

function actualPeriodKeys(company) {
  return displayPeriodKeys(company)
    .filter((key) => {
      const period = company.periods[key];
      return (
        period?.csm != null &&
        period?.sourceReference?.valueKind !== "calculated" &&
        period?.sourceReference?.valueKind !== "forecast"
      );
    })
    .sort(comparePeriods);
}

function latestActualPeriodKey(company) {
  return actualPeriodKeys(company).at(-1) ?? null;
}

function trendHistoryPeriodKeys(company) {
  const keys = actualPeriodKeys(company);
  const latestKey = keys.at(-1);
  return keys.filter((key) => {
    const { kind, quarter } = parsePeriodKey(key);
    return key === latestKey || kind === "ye" || quarter === 4;
  });
}

function getTrendContext(companyKey) {
  const company = companies[companyKey];
  const latestPeriodKey = latestActualPeriodKey(company);
  return latestPeriodKey ? getContext(companyKey, latestPeriodKey) : getContext(companyKey, null);
}

function formatWon(value, digits = 1) {
  return `${(Number(value) / 1000).toFixed(digits)}조원`;
}

function formatSignedWon(value, digits = 1) {
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric / 1000).toFixed(digits)}조원`;
}

function formatTrendWon(value, digits = 1) {
  return `${(Number(value) / 1000).toFixed(digits)}조`;
}

function formatSignedTrendWon(value, digits = 1) {
  const numeric = Number(value);
  const rounded = Number((numeric / 1000).toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}조`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}조`;
}

function formatPercent(value, digits = null) {
  const numeric = Number(value);
  const precision = digits ?? (Number.isInteger(numeric) ? 0 : 2);
  return `${numeric.toFixed(precision)}%`;
}

function formatSignedPercent(value, digits = 1) {
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric).toFixed(digits)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getContext(companyKey = state.companyKey, periodKey = state.periodKey) {
  const catalog = companyCatalog.find((item) => item.key === companyKey);
  const company = companies[companyKey] ?? catalog;
  const period = companies[companyKey]?.periods?.[periodKey] ?? null;
  return {
    companyKey,
    company,
    periodKey,
    period,
    financial:
      financialMetrics[companyKey]?.[periodKey] ??
      (period
        ? {
            insuranceProfit: period.insuranceProfit,
            netIncome: period.parentNetIncome,
            kics: period.kics,
          }
        : null),
  };
}

function cumulativeNetIncome(context, financialValidation) {
  const usesSeparateBasis = context.period?.metricBasis?.parentNetIncome?.startsWith("별도");
  if (usesSeparateBasis) {
    return financialValidation?.fisisSeparateNetIncomeCumulative ?? context.period?.parentNetIncome ?? null;
  }
  return (
    financialValidation?.dartParentNetIncomeCumulative ??
    financialValidation?.fisisSeparateNetIncomeCumulative ??
    context.period?.parentNetIncome ??
    null
  );
}

function contextForValueBasis(context) {
  if (state.valueBasis !== "cumulative" || !context.period?.quarterlyAudit) return context;

  const audit = context.period.quarterlyAudit;
  const financialValidation = audit.financialValidation ?? {};
  const movement = audit.disclosedCumulativeMovement ?? context.period.movement;
  const insuranceProfit =
    financialValidation.dartInsuranceProfitCumulative ??
    financialValidation.fisisInsuranceProfitCumulative ??
    context.period.insuranceProfit ??
    null;

  return {
    ...context,
    period: { ...context.period, movement },
    financial: {
      ...(context.financial ?? {}),
      insuranceProfit,
      netIncome: cumulativeNetIncome(context, financialValidation),
    },
  };
}

function basisLabel() {
  return state.valueBasis === "cumulative" ? "누적" : "분기";
}

function marketMetricLabel(metricKey) {
  const metric = marketMetrics[metricKey];
  return ["newbiz", "netIncome", "insurance"].includes(metricKey)
    ? `${metric.label} · ${basisLabel()}`
    : metric.label;
}

function initializeControls() {
  state.periodKey = latestCommonPeriod();
  syncPeriodOptions();
}

function syncPeriodOptions(preferred = state.periodKey) {
  const periods = displayPeriodKeys(companies[state.companyKey]).sort(comparePeriods).reverse();
  periodSelect.innerHTML = periods
    .map((key) => `<option value="${key}">${periodLabel(key)}</option>`)
    .join("");
  state.periodKey = periods.includes(preferred) ? preferred : periods[0];
  periodSelect.value = state.periodKey;
}

function getIndustryRows() {
  return companyCatalog.map(({ key }) => contextForValueBasis(getContext(key, state.periodKey)));
}

function renderHeader() {
  const context = getContext();
  document.querySelector("#hero-period-label").textContent = periodLabel(state.periodKey);
  document.querySelector("#verified-label").textContent = context.period?.quality || "2개사 DART 검산";
  document.querySelector("#sidebar-status-text").textContent =
    `${periodLabel(state.periodKey)} 검증 스냅샷`;
  const cumulative = state.valueBasis === "cumulative";
  document.querySelector("#industry-basis-note").textContent = cumulative
    ? "신계약 CSM은 당해연도 누적, 당기순이익은 연결·누적, 보험손익은 별도·누적 기준입니다."
    : "신계약 CSM은 해당 분기 단독, 당기순이익은 연결·분기 단독, 보험손익은 별도·분기 단독 기준입니다.";
  document.querySelector("#comparison-newbiz-heading").textContent = `신계약 CSM (${basisLabel()})`;
  document.querySelector("#comparison-insurance-heading").innerHTML = `보험손익 <small class="metric-basis-badge">별도</small> (${basisLabel()})`;
  document.querySelector("#comparison-net-income-heading").innerHTML = `당기순이익 <small class="metric-basis-badge">연결</small> (${basisLabel()})`;
  document.querySelector("#movement-basis-note").textContent = cumulative
    ? "누적 기준 · 기시는 전년도말 · 공란은 데이터 미수집 상태입니다."
    : "분기 기준 · 기시는 전분기말 · 공란은 데이터 미수집 상태입니다.";
  basisButtons.forEach((button) => {
    const isActive = button.dataset.valueBasis === state.valueBasis;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderIndustryBoard() {
  const rows = getIndustryRows();
  const metric = marketMetrics[state.marketMetric];
  document.querySelector("#industry-comparison-title").textContent = `업권별 ${metric.label} 비교`;
  const values = rows.map((row) => metric.getValue(row)).filter((value) => value != null);
  const maxValue = Math.max(...values, 1);

  const rowByCompany = Object.fromEntries(rows.map((row) => [row.companyKey, row]));
  document.querySelector("#industry-board").innerHTML = sectorCatalog
    .map((sector) => {
      const sectorRows = companiesInSector(sector.name).map((company) => rowByCompany[company.key]);
      return `<section class="industry-sector-group sector-${sector.key}" aria-label="${sector.name}">
        <header class="sector-group-heading"><span>${sector.shortName}</span><strong>${sector.name}</strong><small>${sector.description} · ${sectorRows.length}개사</small></header>
        <div class="industry-sector-columns">
        ${sectorRows.map((row) => {
      const value = metric.getValue(row);
      const hasData = value != null;
      const share = hasData ? Math.max(12, (value / maxValue) * 100) : 0;
      const isSelected = row.companyKey === state.companyKey;
      return `
        <button
          type="button"
          class="industry-column ${isSelected ? "is-selected" : ""}"
          data-company-row="${row.companyKey}"
          aria-label="${row.company.name} 선택"
        >
          <span class="industry-value ${hasData ? "" : "is-empty"}">
            <small>${marketMetricLabel(state.marketMetric)}</small>
            <strong>${hasData ? metric.format(value) : "—"}</strong>
          </span>
          <span class="industry-column-plot" aria-hidden="true">
            ${
              hasData
                ? `<span class="industry-column-bar" style="--column-height:${share}%"></span>`
                : `<span class="industry-column-empty">데이터 준비중</span>`
            }
          </span>
          <span class="industry-identity">
            <span>
              <strong>${escapeHtml(row.company.name)}</strong>
            </span>
          </span>
        </button>
      `;
        }).join("")}
        </div>
      </section>`;
    })
    .join("");

  document.querySelectorAll("[data-company-row]").forEach((button) => {
    button.addEventListener("click", () => {
      if (companies[button.dataset.companyRow]) {
        state.companyKey = button.dataset.companyRow;
        renderDashboard();
      }
    });
  });
}

function renderComparisonTable() {
  const rows = sectorCatalog.flatMap((sector) =>
    getIndustryRows()
      .filter((row) => row.company.sector === sector.name)
      .sort((a, b) => (b.period?.csm ?? -1) - (a.period?.csm ?? -1)),
  );
  document.querySelector("#comparison-table-body").innerHTML = rows
    .map(
      (row, index) => `
        <tr class="${row.companyKey === state.companyKey ? "is-selected" : ""} ${companiesInSector(row.company.sector)[0].key === row.companyKey ? "sector-start" : ""}">
          ${companiesInSector(row.company.sector)[0].key === row.companyKey ? `<th class="sector-group-cell sector-${sectorMetaForCompany(row.company).key}" scope="rowgroup" rowspan="${companiesInSector(row.company.sector).length}"><span>${sectorMetaForCompany(row.company).shortName}</span><small>${escapeHtml(row.company.sector)}</small></th>` : ""}
          <td class="table-company-cell comparison-company-cell">
            <span class="table-company-layout">
              <span class="rank">${String(companiesInSector(row.company.sector).findIndex((company) => company.key === row.companyKey) + 1).padStart(2, "0")}</span>
              <span><strong>${escapeHtml(row.company.name)}</strong></span>
            </span>
          </td>
          <td><strong>${row.period ? formatWon(row.period.csm) : "—"}</strong></td>
          <td>${row.period ? formatWon(row.period.movement.newbiz) : "—"}</td>
          <td>${row.financial?.netIncome != null ? formatWon(row.financial.netIncome) : "—"}</td>
          <td>${row.financial?.insuranceProfit != null ? formatWon(row.financial.insuranceProfit) : "—"}</td>
          <td>${row.financial?.kics != null ? `<span class="kics-pill">${formatPercent(row.financial.kics, 0)}</span>` : "—"}</td>
        </tr>
      `,
    )
    .join("");
}

function calculateForecast(context, scenarioKey) {
  const scenario = forecastScenarios[scenarioKey];
  const storedEntry = forecastData.forecasts?.[context.companyKey];
  const storedProjection = storedEntry?.[scenarioKey];
  if (storedProjection && storedEntry.asOfPeriod === context.periodKey) {
    return {
      ...storedProjection,
      scenario,
      change: storedProjection.closing - storedProjection.opening,
      forecastMeta: storedEntry,
    };
  }
  const opening = context.period.csm;
  const parsed = parsePeriodKey(context.periodKey);
  const isInterim = parsed.kind === "quarter" && parsed.quarter < 4;
  const remainingQuarters = isInterim ? 4 - parsed.quarter : 4;
  const horizon = remainingQuarters / 4;
  const newbizRunRate = isInterim
    ? context.period.movement.newbiz * remainingQuarters
    : context.period.movement.newbiz;
  const newbiz = Math.round(newbizRunRate * scenario.newbizFactor);
  const interest = Math.round(opening * scenario.interestRate * horizon);
  const adjustment = Math.round(opening * scenario.adjustmentRate * horizon);
  const amortization = -Math.round(opening * scenario.amortizationRate * horizon);
  const closing = opening + newbiz + interest + adjustment + amortization;
  const change = closing - opening;

  return { scenario, opening, newbiz, interest, adjustment, amortization, closing, change };
}

function forecastTargetLabel(periodKey) {
  const { year, quarter, kind } = parsePeriodKey(periodKey);
  return `${kind === "quarter" && quarter < 4 ? year : year + 1}년말`;
}

function forecastPeriodLabel(periodKey) {
  const { year } = parsePeriodKey(periodKey);
  const term = { 2026: "1년 예상", 2027: "2년 예상", 2028: "3년 예상", 2029: "4년 예상", 2030: "5년 예상" }[year] ?? "전망";
  return { term, year: `${String(year).slice(2)} 4Q` };
}

function forecastHorizonSeries(projection, scenarioKey) {
  const horizon = projection.forecastMeta?.horizon;
  return horizon?.[scenarioKey] ?? [
    { period: projection.forecastMeta?.targetPeriod ?? "2026-ye", closing: projection.closing },
  ];
}

function peerTrendSeries() {
  return companyCatalog.flatMap((catalog) => {
    const context = getTrendContext(catalog.key);
    if (!context.period?.csm) return [];
    const projection = calculateForecast(context, state.peerTrendScenario);
    const horizon = forecastHorizonSeries(projection, state.peerTrendScenario);
    if (horizon.length !== 5) return [];
    const history = trendHistoryPeriodKeys(context.company).map((period) => ({
      period,
      value: context.company.periods[period].csm,
    }));
    if (!history.length) return [];
    const values = [...history.map((point) => point.value), ...horizon.map((point) => point.closing)];
    return [{ catalog, context, history, horizon, values, color: peerTrendColors[catalog.key] }];
  });
}

function formatPeerTrendAxisValue(value) {
  const trillion = value / 1000;
  return `${trillion.toFixed(Number.isInteger(trillion) ? 0 : 1)}조`;
}

function peerTrendEndLabelPositions(series, toY, plotTop, plotBottom, valueForItem = (item) => item.values.at(-1)) {
  if (!series.length) return new Map();
  const gap = Math.min(24, (plotBottom - plotTop - 20) / Math.max(1, series.length - 1));
  const labels = series
    .map((item) => ({ key: item.catalog.key, desired: toY(valueForItem(item)), y: toY(valueForItem(item)) }))
    .sort((left, right) => left.desired - right.desired);
  const topLimit = plotTop + 10;
  const bottomLimit = plotBottom - 10;
  labels[0].y = Math.max(topLimit, labels[0].y);
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].y = Math.max(labels[index].y, labels[index - 1].y + gap);
  }
  if (labels.at(-1).y > bottomLimit) {
    const shift = labels.at(-1).y - bottomLimit;
    labels.forEach((label) => {
      label.y -= shift;
    });
  }
  for (let index = labels.length - 2; index >= 0; index -= 1) {
    labels[index].y = Math.min(labels[index].y, labels[index + 1].y - gap);
  }
  if (labels[0].y < topLimit) {
    const shift = topLimit - labels[0].y;
    labels.forEach((label) => {
      label.y += shift;
    });
  }
  return new Map(labels.map((label) => [label.key, label.y]));
}

function renderPeerTrendChart() {
  const chart = document.querySelector("#peer-trend-chart");
  if (!chart) return;

  peerTrendScenarioButtons.forEach((button) => {
    const isActive = button.dataset.peerTrendScenario === state.peerTrendScenario;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  if (peerTrendReset) peerTrendReset.hidden = !state.peerTrendCompanyKey;

  const series = peerTrendSeries();
  if (!series.length) {
    chart.innerHTML = disclosureEmptyState("9개사 보유 CSM 추이");
    return;
  }

  const width = 960;
  const height = 560;
  const plot = { left: 68, right: 160, top: 52, bottom: 56 };
  const plotRight = width - plot.right;
  const plotBottom = height - plot.bottom;
  const allValues = series.flatMap((item) => item.values);
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = Math.max((rawMax - rawMin) * 0.08, 500);
  const roughStep = (rawMax - rawMin + padding * 2) / 5;
  const tickStep = Math.max(500, Math.ceil(roughStep / 500) * 500);
  const minValue = Math.floor((rawMin - padding) / tickStep) * tickStep;
  const maxValue = Math.ceil((rawMax + padding) / tickStep) * tickStep;
  const firstSeries = series[0];
  const xLabels = [
    ...firstSeries.history.map((point) => trendPeriodLabel(point.period)),
    ...firstSeries.horizon.map((point) => trendPeriodLabel(point.period)),
  ];
  const latestActualIndex = firstSeries.history.length - 1;
  const x = (index) => plot.left + index * ((plotRight - plot.left) / Math.max(1, xLabels.length - 1));
  const y = (value) => plot.top + (maxValue - value) / (maxValue - minValue) * (plotBottom - plot.top);
  const yTicks = [];
  for (let tick = minValue; tick <= maxValue + tickStep / 2; tick += tickStep) yTicks.push(tick);

  const selectedKey = state.peerTrendCompanyKey;
  const scenarioLabel = state.peerTrendScenario === "base" ? "Base" : "Worst";
  const endLabelPositions = peerTrendEndLabelPositions(series, y, plot.top + 50, plotBottom);
  const latestActualLabelPositions = peerTrendEndLabelPositions(
    series,
    y,
    plot.top + 50,
    plotBottom,
    (item) => item.history.at(-1).value,
  );
  const labelLaneTop = plot.top + 27;
  const labelLaneHeight = plotBottom - labelLaneTop - 4;
  const latestLabelLaneX = Math.max(plot.left + 4, x(latestActualIndex) - 156);
  const latestLabelLaneWidth = x(latestActualIndex) - latestLabelLaneX - 7;
  const finalLabelLaneX = plotRight + 8;

  chart.innerHTML = `<svg class="peer-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="9개 보험사의 보유 CSM 실적과 ${scenarioLabel} 5개년 전망 통합 비교 그래프">
    <rect class="peer-trend-forecast-zone" x="${x(latestActualIndex)}" y="${plot.top}" width="${plotRight - x(latestActualIndex)}" height="${plotBottom - plot.top}"></rect>
    <rect class="peer-trend-frame" x="${plot.left}" y="${plot.top}" width="${plotRight - plot.left}" height="${plotBottom - plot.top}"></rect>
    <rect class="peer-trend-label-lane peer-trend-latest-lane" x="${latestLabelLaneX}" y="${labelLaneTop}" width="${latestLabelLaneWidth}" height="${labelLaneHeight}" rx="6" aria-hidden="true"></rect>
    <rect class="peer-trend-label-lane peer-trend-final-lane" x="${finalLabelLaneX}" y="${labelLaneTop}" width="${width - finalLabelLaneX - 4}" height="${labelLaneHeight}" rx="6" aria-hidden="true"></rect>
    <g class="peer-trend-grid" aria-hidden="true">
      ${yTicks.map((tick) => `<line x1="${plot.left}" x2="${plotRight}" y1="${y(tick)}" y2="${y(tick)}"></line><text x="${plot.left - 12}" y="${y(tick) + 4}" text-anchor="end">${formatPeerTrendAxisValue(tick)}</text>`).join("")}
      ${xLabels.map((label, index) => `<text x="${x(index)}" y="${height - 25}" text-anchor="middle">${label}</text>`).join("")}
      <text class="peer-trend-axis-title" x="${plot.left}" y="18">보유 CSM (조원)</text>
      <text class="peer-trend-axis-title peer-trend-x-axis-title" x="${(plot.left + plotRight) / 2}" y="${height - 5}" text-anchor="middle">연도말 · 2026.2Q는 최근 실적</text>
      <line class="peer-trend-boundary" x1="${x(latestActualIndex)}" x2="${x(latestActualIndex)}" y1="${plot.top}" y2="${plotBottom}"></line>
      <text class="peer-trend-zone-label" x="${x(Math.max(0, latestActualIndex - 2))}" y="${plot.top + 20}" text-anchor="middle">실적</text>
      <text class="peer-trend-zone-label" x="${x(latestActualIndex + 2.5)}" y="${plot.top + 20}" text-anchor="middle">${scenarioLabel} 전망</text>
      <text class="peer-trend-latest-heading" x="${x(latestActualIndex) - 12}" y="${plot.top + 40}" text-anchor="end">최근 실적 · 26.2Q</text>
      <text class="peer-trend-end-heading" x="${plotRight + 18}" y="${plot.top + 40}">5년 전망 · 30.4Q</text>
    </g>
    <g class="peer-trend-series">
      ${series.map((item) => {
        const dimmed = selectedKey && selectedKey !== item.catalog.key;
        const highlighted = selectedKey === item.catalog.key;
        const actualPoints = item.history.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
        const forecastPoints = [
          `${x(item.history.length - 1)},${y(item.history.at(-1).value)}`,
          ...item.horizon.map((point, index) => `${x(item.history.length + index)},${y(point.closing)}`),
        ].join(" ");
        const actualY = y(item.history.at(-1).value);
        const finalY = y(item.values.at(-1));
        const isLife = item.catalog.sector === "생명보험";
        return `<g class="peer-trend-line-group ${dimmed ? "is-dimmed" : ""} ${highlighted ? "is-highlighted" : ""}" data-peer-series="${item.catalog.key}" data-peer-select="${item.catalog.key}" role="button" tabindex="0" aria-label="${item.catalog.name} 추이 강조" style="--peer-color:${item.color}">
          <title>${item.catalog.name} ${scenarioLabel}: 최근 ${formatTrendWon(item.context.period.csm)} → 5년 ${formatTrendWon(item.values.at(-1))}</title>
          <polyline class="peer-trend-line-halo peer-trend-actual-halo" points="${actualPoints}"></polyline>
          <polyline class="peer-trend-line-halo peer-trend-forecast-halo" points="${forecastPoints}"></polyline>
          <polyline class="peer-trend-line peer-trend-actual-line" points="${actualPoints}"></polyline>
          <polyline class="peer-trend-line peer-trend-forecast-line" points="${forecastPoints}"></polyline>
          ${isLife
            ? `<circle class="peer-trend-point is-latest" cx="${x(latestActualIndex)}" cy="${actualY}" r="4.5"></circle><circle class="peer-trend-point is-final" cx="${plotRight}" cy="${finalY}" r="3.8"></circle>`
            : `<rect class="peer-trend-point is-latest" x="${x(latestActualIndex) - 4}" y="${actualY - 4}" width="8" height="8"></rect><rect class="peer-trend-point is-final" x="${plotRight - 3.5}" y="${finalY - 3.5}" width="7" height="7"></rect>`}
        </g>`;
      }).join("")}
    </g>
    <g class="peer-trend-history-points">
      ${series.map((item) => {
        const dimmed = selectedKey && selectedKey !== item.catalog.key;
        const highlighted = selectedKey === item.catalog.key;
        return item.history
          .map((point, index) => ({ point, index, parsed: parsePeriodKey(point.period) }))
          .filter(({ index, parsed }) => index < item.history.length - 1 && (parsed.kind === "ye" || parsed.quarter === 4))
          .map(({ point, index }) => `<g class="peer-trend-history-point ${dimmed ? "is-dimmed" : ""} ${highlighted ? "is-highlighted" : ""}" data-peer-history-point data-company="${escapeHtml(item.catalog.name)}" data-period="${trendPeriodLabel(point.period)}" data-value="${formatTrendWon(point.value)}" role="img" tabindex="0" aria-label="${escapeHtml(item.catalog.name)} ${trendPeriodLabel(point.period)} 보유 CSM ${formatTrendWon(point.value)}" style="--peer-color:${item.color}">
            <circle class="peer-trend-history-hit" cx="${x(index)}" cy="${y(point.value)}" r="10"></circle>
            <circle class="peer-trend-history-marker" cx="${x(index)}" cy="${y(point.value)}" r="2.6"></circle>
          </g>`)
          .join("");
      }).join("")}
    </g>
    <g class="peer-trend-latest-labels">
      ${series.map((item) => {
        const dimmed = selectedKey && selectedKey !== item.catalog.key;
        const highlighted = selectedKey === item.catalog.key;
        const actualValue = item.history.at(-1).value;
        const actualY = y(actualValue);
        const labelY = latestActualLabelPositions.get(item.catalog.key);
        const labelX = x(latestActualIndex) - 12;
        const marker = item.catalog.sector === "생명보험" ? "●" : "■";
        return `<g class="peer-trend-latest-label ${dimmed ? "is-dimmed" : ""} ${highlighted ? "is-highlighted" : ""}" style="--peer-color:${item.color}">
          <line x1="${x(latestActualIndex) - 3}" x2="${labelX + 4}" y1="${actualY}" y2="${labelY}"></line>
          <text data-peer-select="${item.catalog.key}" role="button" tabindex="0" aria-label="${item.catalog.name} 최근 실적 ${formatTrendWon(actualValue)} 강조" x="${labelX}" y="${labelY + 4}" text-anchor="end">${marker} ${item.catalog.name} · ${formatTrendWon(actualValue)}</text>
        </g>`;
      }).join("")}
    </g>
    <g class="peer-trend-end-labels">
      ${series.map((item) => {
        const dimmed = selectedKey && selectedKey !== item.catalog.key;
        const highlighted = selectedKey === item.catalog.key;
        const endY = y(item.values.at(-1));
        const labelY = endLabelPositions.get(item.catalog.key);
        const labelX = plotRight + 18;
        const marker = item.catalog.sector === "생명보험" ? "●" : "■";
        return `<g class="peer-trend-end-label ${dimmed ? "is-dimmed" : ""} ${highlighted ? "is-highlighted" : ""}" style="--peer-color:${item.color}">
          <line x1="${plotRight + 4}" x2="${labelX - 7}" y1="${endY}" y2="${labelY}"></line>
          <text class="peer-trend-end-combined" data-peer-select="${item.catalog.key}" role="button" tabindex="0" aria-label="${item.catalog.name} 5년 전망 ${formatTrendWon(item.values.at(-1))} 강조" x="${labelX}" y="${labelY + 4}">${marker} ${item.catalog.name} · ${formatTrendWon(item.values.at(-1))}</text>
        </g>`;
      }).join("")}
    </g>
  </svg>
  <div class="peer-trend-tooltip" role="tooltip" hidden><strong></strong><span></span></div>`;

  const historyTooltip = chart.querySelector(".peer-trend-tooltip");
  const hideHistoryTooltip = () => {
    historyTooltip.hidden = true;
  };
  chart.querySelectorAll("[data-peer-history-point]").forEach((point) => {
    const showHistoryTooltip = () => {
      historyTooltip.querySelector("strong").textContent = point.dataset.company;
      historyTooltip.querySelector("span").textContent = `${point.dataset.period} · ${point.dataset.value}`;
      historyTooltip.hidden = false;
      const pointRect = point.getBoundingClientRect();
      const chartRect = chart.getBoundingClientRect();
      const desiredLeft = pointRect.left + pointRect.width / 2 - chartRect.left;
      const halfWidth = historyTooltip.offsetWidth / 2;
      historyTooltip.style.left = `${Math.max(halfWidth + 8, Math.min(chart.clientWidth - halfWidth - 8, desiredLeft))}px`;
      historyTooltip.style.top = `${pointRect.top + pointRect.height / 2 - chartRect.top}px`;
    };
    point.addEventListener("mouseenter", showHistoryTooltip);
    point.addEventListener("mouseleave", hideHistoryTooltip);
    point.addEventListener("focus", showHistoryTooltip);
    point.addEventListener("blur", hideHistoryTooltip);
  });

  document.querySelectorAll("[data-peer-select]").forEach((control) => {
    const companyKey = control.dataset.peerSelect;
    const selectCompany = () => {
      state.peerTrendCompanyKey = state.peerTrendCompanyKey === companyKey ? null : companyKey;
      renderPeerTrendChart();
    };
    control.addEventListener("click", selectCompany);
    if (control.dataset.peerSelect) {
      control.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectCompany();
        }
      });
    }
  });
}

function mergeForecastSources(...groups) {
  const sources = new Map();
  groups.flat().filter(Boolean).forEach((source) => {
    const key = source.id ?? source.url ?? source.title;
    if (!sources.has(key)) sources.set(key, source);
  });
  return [...sources.values()];
}

function renderForecast() {
  const grid = document.querySelector("#trend-grid");
  document.querySelector("#forecast-basis-label").textContent = "1Y · 2Y · 3Y · 4Y · 5Y";
  renderPeerTrendChart();

  grid.innerHTML = renderSectorCardGroups((catalog) => {
      const context = getTrendContext(catalog.key);
      if (!context.period) {
        return `
          <article class="trend-card is-empty">
            <div class="trend-card-heading">
              <strong>${catalog.name}</strong>
            </div>
            <div class="trend-empty-state">
              <span>—</span>
              <small>데이터 준비중</small>
            </div>
          </article>
        `;
      }

      const historyKeys = trendHistoryPeriodKeys(context.company);
      const history = historyKeys.map((key) => context.company.periods[key].csm);
      const base = calculateForecast(context, "base");
      const worst = calculateForecast(context, "worst");
      const baseSeries = forecastHorizonSeries(base, "base");
      const worstSeries = forecastHorizonSeries(worst, "worst");
      const fiveYearBase = baseSeries.at(-1);
      const fiveYearWorst = worstSeries.at(-1);
      const chartValues = [...history, ...baseSeries.map((item) => item.closing), ...worstSeries.map((item) => item.closing)];
      const min = Math.min(...chartValues) * 0.97;
      const max = Math.max(...chartValues) * 1.03;
      const range = Math.max(1, max - min);
      const toMiniY = (value) => 88 - ((value - min) / range) * 70;
      const actualX = history.map((_, index) =>
        history.length === 1 ? 6 : 6 + (index * 34) / (history.length - 1),
      );
      const forecastX = baseSeries.map((_, index) =>
        baseSeries.length === 1 ? 94 : 50 + (index * 44) / (baseSeries.length - 1),
      );
      const actualPoints = history
        .map((value, index) => `${actualX[index]},${toMiniY(value)}`)
        .join(" ");
      const lastX = actualX.at(-1);
      const lastValue = history.at(-1);
      const basePoints = `${lastX},${toMiniY(lastValue)} ${baseSeries.map((item, index) => `${forecastX[index]},${toMiniY(item.closing)}`).join(" ")}`;
      const worstPoints = `${lastX},${toMiniY(lastValue)} ${worstSeries.map((item, index) => `${forecastX[index]},${toMiniY(item.closing)}`).join(" ")}`;

      return `
        <button type="button" class="trend-card" data-trend-company="${catalog.key}">
          <div class="trend-card-heading">
            <strong>${catalog.name}</strong>
          </div>
          <div class="trend-mini-chart" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline class="mini-actual-line" points="${actualPoints}"></polyline>
              <polyline class="mini-base-line" points="${basePoints}"></polyline>
              <polyline class="mini-worst-line" points="${worstPoints}"></polyline>
              ${history
                .map((value, index) => `<circle class="mini-actual-point" cx="${actualX[index]}" cy="${toMiniY(value)}" r="1.8"></circle>`)
                .join("")}
              ${baseSeries.map((item, index) => `<circle class="mini-base-point" cx="${forecastX[index]}" cy="${toMiniY(item.closing)}" r="1.5"></circle>`).join("")}
              ${worstSeries.map((item, index) => `<circle class="mini-worst-point" cx="${forecastX[index]}" cy="${toMiniY(item.closing)}" r="1.5"></circle>`).join("")}
            </svg>
            <span class="mini-chart-labels"><small>실적</small><small>1년</small><small>2년</small><small>3년</small><small>4년</small><small>5년</small></span>
          </div>
          <div class="trend-card-values">
            <span><small>${periodLabel(context.periodKey)} 실적</small><strong>${formatTrendWon(context.period.csm)}</strong></span>
            <span><small>5년 예상 · Base / Worst</small><strong>${fiveYearBase && fiveYearWorst ? `${formatTrendWon(fiveYearBase.closing)} / ${formatTrendWon(fiveYearWorst.closing)}` : "—"}</strong></span>
          </div>
          <span class="trend-card-action">상세 보기 ↗</span>
        </button>
      `;
    }, "trend-sector-grid");

  document.querySelectorAll("[data-trend-company]").forEach((button) => {
    button.addEventListener("click", () => openTrendModal(button.dataset.trendCompany));
  });

  renderForecastMethodology();
}

function renderForecastMethodology() {
  const body = document.querySelector("#forecast-summary-body");
  if (!body) return;
  body.innerHTML = companyCatalog
    .map((catalog) => {
      const entry = forecastData.forecasts?.[catalog.key];
      const sectorCell = companiesInSector(catalog.sector)[0].key === catalog.key
        ? `<th class="sector-group-cell sector-${sectorMetaForCompany(catalog).key}" scope="rowgroup" rowspan="${companiesInSector(catalog.sector).length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>`
        : "";
      if (!entry) return `<tr class="${sectorCell ? "sector-start" : ""}">${sectorCell}<th class="table-company-cell forecast-company-cell" scope="row">${escapeHtml(catalog.name)}</th>${"<td>—</td>".repeat(13)}</tr>`;
      const baseByYear = Object.fromEntries(entry.horizon.base.map((point) => [parsePeriodKey(point.period).year, point]));
      const worstByYear = Object.fromEntries(entry.horizon.worst.map((point) => [parsePeriodKey(point.period).year, point]));
      const annualScenarioCells = [2026, 2027, 2028, 2029, 2030].map((year) => `
          <td class="forecast-base-cell">${baseByYear[year] ? formatTrendWon(baseByYear[year].closing) : "—"}</td>
          <td class="forecast-worst-cell">${worstByYear[year] ? formatTrendWon(worstByYear[year].closing) : "—"}</td>`).join("");
      return `
        <tr class="${sectorCell ? "sector-start" : ""}">
          ${sectorCell}
          <th class="table-company-cell forecast-company-cell" scope="row">${escapeHtml(catalog.name)}</th>
          <td>${formatTrendWon(entry.asOfCsm ?? entry.base.opening)}</td>
          <td class="forecast-model-cell">${formatTrendWon(entry.independentModel?.base?.closing ?? entry.base.closing)}</td>
          ${annualScenarioCells}
          <td><span class="forecast-confidence">${escapeHtml(entry.validation?.label ?? entry.confidence)}</span></td>
        </tr>`;
    })
    .join("");
}

function openTrendModal(companyKey) {
  const context = getTrendContext(companyKey);
  if (!context.period) return;
  const forecastEntry = forecastData.forecasts?.[companyKey];
  const driverPilot = forecastEntry?.driverForecast;
  const movementTargetLabel = forecastEntry?.targetPeriod
    ? `${parsePeriodKey(forecastEntry.targetPeriod).year}년말 전망`
    : `${forecastTargetLabel(context.periodKey)} 전망`;
  document.querySelector("#trend-modal-title").textContent = `${context.company.name} CSM 추이`;
  document.querySelector("#trend-modal-subtitle").textContent =
    driverPilot
      ? `${periodLabel(context.periodKey)} 실제 → Base · Worst 전망`
      : `${periodLabel(context.periodKey)} 최신 실적 → Base · Worst 전망`;
  document.querySelector("#trend-modal-content").innerHTML = `
    <article class="forecast-executive-summary" id="forecast-executive-summary"></article>
    <div class="forecast-detail-tabs" role="tablist" aria-label="전망 상세 구분">
      <button type="button" role="tab" aria-selected="true" data-forecast-tab="outlook">실적·중장기 전망</button>
      <button type="button" role="tab" aria-selected="false" data-forecast-tab="movement"><span>Movement</span><small>${movementTargetLabel}</small></button>
      <button type="button" role="tab" aria-selected="false" data-forecast-tab="evidence">산출 근거·검증</button>
    </div>
    <section class="forecast-detail-panel" data-forecast-panel="movement" hidden>
      <article class="forecast-decision-brief" id="forecast-decision-brief"></article>
      <article class="driver-stress-panel" id="driver-stress-panel" hidden></article>
    </section>
    <section class="forecast-detail-panel" data-forecast-panel="outlook">
      <article class="forecast-method-summary" id="forecast-method-summary"></article>
      <div class="forecast-layout modal-forecast-layout">
        <article class="forecast-chart-card">
          <div class="forecast-chart-header">
            <div>
              <span>과거 실적 → 1년 예상 → 2년 예상 → 3년 예상 → 4년 예상 → 5년 예상</span>
              <strong id="forecast-company-name">${context.company.name}</strong>
            </div>
            <div class="chart-legend">
              <span><i class="legend-dot actual"></i>실적</span>
              <span><i class="legend-dot base"></i>Base</span>
              <span><i class="legend-dot worst"></i>Worst</span>
            </div>
          </div>
          <div class="forecast-chart" id="forecast-chart"></div>
          <div class="forecast-axis-labels" id="forecast-axis-labels"></div>
          <div class="forecast-chart-scenario-detail" id="driver-forecast-panel" hidden></div>
        </article>
        <aside class="forecast-insight-rail" id="forecast-insight-rail"></aside>
      </div>
    </section>
    <section class="forecast-detail-panel" data-forecast-panel="evidence" hidden>
      <article class="forecast-evidence" id="forecast-evidence"></article>
    </section>
  `;
  renderTrendModalDetail(context);
  bindForecastDetailTabs();
  trendModal.showModal();
}

function bindForecastDetailTabs() {
  const tabs = [...document.querySelectorAll("[data-forecast-tab]")];
  const panels = [...document.querySelectorAll("[data-forecast-panel]")];
  const activateTab = (tabName) => {
    tabs.forEach((item) => item.setAttribute("aria-selected", String(item.dataset.forecastTab === tabName)));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.forecastPanel !== tabName;
    });
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.forecastTab);
    });
  });
  document.querySelectorAll("[data-forecast-open-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.forecastOpenTab);
      const focusTarget = button.dataset.forecastFocus
        ? document.querySelector(button.dataset.forecastFocus)
        : null;
      if (focusTarget) {
        const disclosure = focusTarget.matches("details") ? focusTarget : focusTarget.querySelector("details");
        if (disclosure) disclosure.open = true;
        requestAnimationFrame(() => focusTarget.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    });
  });
}

function renderTrendModalDetail(context) {
  const base = calculateForecast(context, "base");
  const worst = calculateForecast(context, "worst");
  const driverForecast = base.forecastMeta?.driverForecast;
  const target = forecastTargetLabel(context.periodKey);
  renderForecastExecutiveSummary(context, base, worst, target, driverForecast);
  renderForecastDecisionBrief(context, base, worst, target, driverForecast);
  renderForecastMethodSummary(context, base);
  const historyKeys = trendHistoryPeriodKeys(context.company);
  const history = historyKeys.map((key) => ({
    key,
    label: trendPeriodLabel(key),
    value: context.company.periods[key].csm,
  }));
  const baseSeries = forecastHorizonSeries(base, "base");
  const worstSeries = forecastHorizonSeries(worst, "worst");
  const values = [...history.map((item) => item.value), ...baseSeries.map((item) => item.closing), ...worstSeries.map((item) => item.closing)];
  const minValue = Math.min(...values) * 0.97;
  const maxValue = Math.max(...values) * 1.03;
  const range = Math.max(1, maxValue - minValue);
  const toY = (value) => 92 - ((value - minValue) / range) * 74;
  const historyEndX = 34;
  const historyX = history.map((_, index) =>
    history.length === 1 ? 4 : 4 + (index * (historyEndX - 4)) / (history.length - 1),
  );
  const actualPoints = history
    .map((item, index) => `${historyX[index]},${toY(item.value)}`)
    .join(" ");
  const latestActual = history.at(-1);
  const latestActualX = historyX.at(-1);
  const forecastX = baseSeries.map((_, index) =>
    baseSeries.length === 1 ? 92 : 46 + (index * 46) / (baseSeries.length - 1),
  );
  const basePoints = `${latestActualX},${toY(latestActual.value)} ${baseSeries.map((item, index) => `${forecastX[index]},${toY(item.closing)}`).join(" ")}`;
  const worstPoints = `${latestActualX},${toY(latestActual.value)} ${worstSeries.map((item, index) => `${forecastX[index]},${toY(item.closing)}`).join(" ")}`;

  document.querySelector("#forecast-company-name").textContent = context.company.name;
  document.querySelector("#forecast-chart").innerHTML = `
    <div class="chart-grid-lines" aria-hidden="true">
      <span></span><span></span><span></span><span></span>
    </div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="forecast-line actual-line" points="${actualPoints}"></polyline>
      <polyline class="forecast-line base-line" points="${basePoints}"></polyline>
      <polyline class="forecast-line worst-line" points="${worstPoints}"></polyline>
      ${history
        .map((item, index) => `<circle class="actual-point" cx="${historyX[index]}" cy="${toY(item.value)}" r="1.6"></circle>`)
        .join("")}
      ${baseSeries.map((item, index) => `<circle class="base-point" cx="${forecastX[index]}" cy="${toY(item.closing)}" r="1.5"></circle>`).join("")}
      ${worstSeries.map((item, index) => `<circle class="worst-point" cx="${forecastX[index]}" cy="${toY(item.closing)}" r="1.5"></circle>`).join("")}
    </svg>
    ${history
      .map(
        (item, index) =>
          `<span class="chart-value-label actual-value actual-value-${index}" style="left:${historyX[index]}%; top:${Math.max(0, toY(item.value) - 9)}%">${formatTrendWon(item.value)}</span>`,
      )
      .join("")}
    ${baseSeries.map((item, index) => `<span class="chart-value-label forecast-series-value forecast-series-value-${index} base-value" style="left:${forecastX[index]}%; top:${Math.max(0, toY(item.closing) - 8)}%">${formatTrendWon(item.closing)}</span>`).join("")}
    ${worstSeries.map((item, index) => `<span class="chart-value-label forecast-series-value forecast-series-value-${index} worst-value" style="left:${forecastX[index]}%; top:${Math.min(91, toY(item.closing) + 3)}%">${formatTrendWon(item.closing)}</span>`).join("")}
  `;

  document.querySelector("#forecast-axis-labels").innerHTML =
    [
      ...history.map((item, index) => ({ label: item.label, x: historyX[index], end: false, kind: "actual", index, latest: index === history.length - 1 })),
      ...baseSeries.map((item, index) => ({ label: forecastPeriodLabel(item.period), x: forecastX[index], end: index === baseSeries.length - 1, kind: "forecast", index })),
    ]
      .map(
        ({ label, x, end, kind, index, latest }) =>
          typeof label === "string"
            ? `<span class="axis-${kind} axis-${kind}-${index} ${latest ? `axis-${kind}-latest` : ""}" style="left:${x}%">${label}</span>`
            : `<span class="forecast-term-label forecast-term-label-${index} ${end ? "forecast-end-label" : ""}" style="left:${x}%"><strong data-mobile-label="${escapeHtml(label.term.replace(" 예상", ""))}">${label.term}</strong><small>${label.year}</small></span>`,
      )
      .join("");

  renderForecastInsightRail(context, base, worst, driverForecast);

  const meta = base.forecastMeta;
  const evidence = document.querySelector("#forecast-evidence");
  if (meta) {
    const backtestMape = meta.validation?.meanAbsolutePercentageError ?? meta.model?.backtest?.meanAbsolutePercentageError;
    const validationSamples = meta.validation?.sampleCount ?? meta.model?.backtest?.sampleCount;
    const confidenceDetail = Number.isFinite(backtestMape)
      ? `${meta.validation?.label ?? meta.confidence} · ${validationSamples ?? "—"}개 검증 시점 · MAPE ${(backtestMape * 100).toFixed(1)}%`
      : `${meta.validation?.label ?? meta.confidence}`;
    renderDriverForecastPanel(driverForecast, base, worst);
    renderDriverStressPanel(driverForecast, base, worst);
    const evidenceSources = mergeForecastSources(
      driverForecast?.sources ?? [],
      meta.evidenceSources ?? [],
      meta.sources ?? [],
    );
    evidence.innerHTML = `
      <details class="forecast-audit-details" open>
        <summary><span>산출 근거와 출처</span><strong>${escapeHtml(context.company.name)} · ${escapeHtml(confidenceDetail)}</strong></summary>
        <div class="forecast-audit-toolbar">
          <span>확정 사실 · 외부 전망 · 모델 추정 · 경영 입력 · 가정</span>
          <a href="../CSM_FORECAST_METHODOLOGY.md" target="_blank" rel="noreferrer">전체 방법론 ↗</a>
        </div>
        <div class="forecast-rationale-grid">
          <div><span>Base · 신계약</span><p>${escapeHtml(meta.qualitativeJudgment.baseNewbiz)}</p></div>
          <div><span>Base · CSM 조정</span><p>${escapeHtml(meta.qualitativeJudgment.baseAdjustment)}</p></div>
          <div><span>Worst</span><p>${escapeHtml(meta.qualitativeJudgment.worst)}</p></div>
        </div>
        ${driverForecast ? `
          <div class="forecast-audit-driver-grid">
            <div><span>신계약 산출</span><p>과거 하반기 패턴 ${formatTrendWon(driverForecast.newBusinessBridge.statisticalRemaining)}와 상반기 판매 흐름 ${formatTrendWon(driverForecast.newBusinessBridge.ytdRunRateRemaining)}를 결합</p></div>
            <div><span>서비스 제공률</span><p>최근 4개 분기 기준 분기 ${(driverForecast.serviceRelease.rate * 100).toFixed(2)}%</p></div>
            <div><span>입력 통제</span><p>${escapeHtml(driverForecast.inputPolicy.reason)}</p></div>
            ${driverForecast.knownBaseAnchor ? `<div><span>경영 입력 · ${escapeHtml(driverForecast.knownBaseAnchor.verificationLabel)}</span><p>Base ${formatTrendWon(driverForecast.knownBaseAnchor.value, 2)} · 독립 모델 ${formatTrendWon(driverForecast.knownBaseAnchor.modelClosing, 2)} · 연결 차이 ${formatSignedTrendWon(driverForecast.knownBaseAnchor.reconciliation, 2)}</p></div>` : ""}
          </div>` : ""}
        <ul class="forecast-source-list">
          ${evidenceSources.map((source) => `<li>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a>` : `<strong>${escapeHtml(source.title)}</strong>`}<span>${escapeHtml(source.use)}${source.url || source.type === "user_provided" ? "" : " · 원문 미첨부"}</span></li>`).join("")}
        </ul>
      </details>`;
  } else {
    evidence.hidden = true;
  }
}

function renderForecastExecutiveSummary(context, base, worst, target, driverForecast) {
  const hero = document.querySelector("#forecast-executive-summary");
  if (!hero) return;
  const yearEndChange = base.closing - base.opening;
  const yearEndChangeRate = base.opening ? (yearEndChange / base.opening) * 100 : 0;
  hero.innerHTML = `
    <div class="executive-summary-lead">
      <strong>${target} 예상 CSM ${formatTrendWon(base.closing)}</strong>
      <p>전년말 ${formatTrendWon(base.opening)} 대비 ${formatSignedTrendWon(yearEndChange)} · ${formatSignedPercent(yearEndChangeRate)}</p>
    </div>`;
}

function renderMovementEvidenceDrawer(evidence, sources = [], movementLabel = "Movement") {
  if (!evidence?.items?.length) return "";
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return `
    <div class="movement-evidence-drawer-heading">
      <div><span>EVIDENCE TRAIL</span><h4>${escapeHtml(movementLabel)} 전망 근거·출처</h4></div>
      <button type="button" class="movement-evidence-close" aria-label="근거·출처 닫기">×</button>
    </div>
    <div class="movement-evidence-list">
      ${evidence.items.map((item) => {
        const source = sourceById.get(item.sourceId);
        return `
          <section class="movement-evidence-item evidence-${escapeHtml(item.kind)}">
            <div class="movement-evidence-item-heading"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.headline)}</strong></div>
            <p>${escapeHtml(item.detail)}</p>
            ${source ? `<div class="movement-evidence-source"><span>출처</span>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a>` : `<strong>${escapeHtml(source.title)} · 원문 미첨부</strong>`}</div>` : ""}
          </section>`;
      }).join("")}
    </div>`;
}

function renderForecastDecisionBrief(context, base, worst, target, driverForecast) {
  const container = document.querySelector("#forecast-decision-brief");
  if (!container) return;
  const priorMovement = context.company.periods?.["2025-ye"]?.movement;
  const annualChange = base.closing - base.opening;
  const annualChangeRate = base.opening ? (annualChange / base.opening) * 100 : 0;
  const economicNetMovement = base.newbiz + base.interest + base.adjustment + base.amortization;
  const movementEvidence = driverForecast?.movementEvidence ?? base.forecastMeta?.movementEvidence;
  const movementEvidenceSources = mergeForecastSources(
    driverForecast?.sources ?? [],
    base.forecastMeta?.evidenceSources ?? [],
    base.forecastMeta?.sources ?? [],
  );
  const upper = base.closing;
  const lower = driverForecast?.distribution?.p10?.closing ?? worst.closing;
  const reasons = driverForecast
    ? {
        newbiz: "상반기 확정 판매 흐름과 과거 하반기 계절성을 반영하되, 연중 과도한 연율화는 제한했습니다.",
        interest: "보유 CSM과 신계약 CSM이 늘면서 계약서비스마진에 부리되는 이자도 소폭 증가합니다.",
        adjustment: "초기 해지율이 안정화돼 전년의 큰 조정 부담은 줄지만, 연말 계리 가정 재점검 부담은 남겼습니다.",
        amortization: "보유 CSM 증가와 보험서비스 제공 확대에 따라 손익으로 인식되는 CSM 규모가 소폭 커집니다.",
      }
    : {
        newbiz: "최근 신계약 판매 흐름과 과거 분기별 계절성을 반영했습니다.",
        interest: "보유 CSM과 신계약 CSM 규모에 연동해 이자부리를 산출했습니다.",
        adjustment: "최근 경험조정과 연말 계리 가정 재점검 부담을 반영했습니다.",
        amortization: "보험서비스 제공에 따라 손익으로 인식되는 최근 CSM 속도를 반영했습니다.",
      };
  const movementItems = [
    { key: "newbiz", label: "신계약 CSM", current: base.newbiz, prior: priorMovement?.newbiz, reason: movementEvidence?.newbiz?.statement ?? reasons.newbiz, evidence: movementEvidence?.newbiz },
    { key: "interest", label: "이자부리", current: base.interest, prior: priorMovement?.interest, reason: movementEvidence?.interest?.statement ?? reasons.interest, evidence: movementEvidence?.interest },
    { key: "adjustment", label: "CSM 조정", current: base.adjustment, prior: priorMovement?.adjustment, reason: movementEvidence?.adjustment?.statement ?? reasons.adjustment, evidence: movementEvidence?.adjustment },
    { key: "amortization", label: "CSM 상각", current: base.amortization, prior: priorMovement?.amortization, reason: movementEvidence?.amortization?.statement ?? reasons.amortization, evidence: movementEvidence?.amortization },
  ].map((item) => ({ ...item, effect: item.prior == null ? null : item.current - item.prior }));
  const primaryMovementItems = movementItems.filter((item) => item.key === "newbiz" || item.key === "adjustment");
  const supportingMovementItems = movementItems.filter((item) => item.key === "interest" || item.key === "amortization");
  const dominantContribution = [...movementItems]
    .sort((left, right) => Math.abs(right.current) - Math.abs(left.current))[0];
  const dominantYearChange = movementItems
    .filter((item) => item.effect != null)
    .sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect))[0];
  const targetAdjustmentOverlay = Number(
    base.targetAdjustmentOverlay ?? driverForecast?.knownBaseAnchor?.reconciliation ?? 0,
  );
  const recurringAdjustment = Number.isFinite(base.adjustmentBeforeTargetOverlay)
    ? Number(base.adjustmentBeforeTargetOverlay)
    : base.adjustment - targetAdjustmentOverlay;
  const waterfall = movementGeometry(base);
  container.innerHTML = `
    <div class="forecast-movement-waterfall">
      <div class="forecast-waterfall-heading">
        <div><span>2026 CSM MOVEMENT</span><h3>2025년말 CSM에서 2026년말 전망까지</h3></div>
        <strong>Base 순증 ${formatSignedTrendWon(economicNetMovement)} · 기말 ${formatTrendWon(base.closing)}</strong>
      </div>
      <div class="forecast-waterfall-stage">
        <div class="forecast-waterfall-grid" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="forecast-waterfall-columns" style="--waterfall-columns:${waterfall.length}">
          ${waterfall.map((item, index) => `
            <div class="forecast-waterfall-column ${index === 0 ? "waterfall-opening" : index === waterfall.length - 1 ? "waterfall-closing" : ""}">
              <strong>${index === 0 || index === waterfall.length - 1 ? formatTrendWon(item.value) : formatSignedTrendWon(item.value)}</strong>
              <div class="forecast-waterfall-plot"><i class="${item.kind}" style="--waterfall-bottom:${item.bottom}%; --waterfall-height:${Math.max(item.height, 2.5)}%"></i></div>
              <span>${escapeHtml(item.label)}</span>
              <small>${index === 0 ? "2025년말" : index === waterfall.length - 1 ? "2026년말 전망" : "2026년 Movement"}</small>
            </div>`).join("")}
        </div>
      </div>
    </div>
    <div class="executive-outlook-heading">
      <div><span>MOVEMENT COMMENTARY</span><h3>Movement별 전망 금액과 산출 근거</h3></div>
      <strong>2026 전망 · 2025 비교</strong>
    </div>
    <div class="movement-bridge-grid movement-primary-grid">
      ${primaryMovementItems.map((item, index) => `
        <section class="movement-bridge-item ${item.current >= 0 ? "movement-inflow" : "movement-outflow"}">
          <div class="movement-bridge-title"><span>0${index + 1}</span><strong>${item.label}</strong></div>
          <div class="movement-forecast-value ${item.current >= 0 ? "forecast-positive" : "forecast-negative"}"><span>2026년 CSM 효과</span><strong>${formatSignedTrendWon(item.current)}</strong></div>
          ${item.key === "adjustment" && targetAdjustmentOverlay ? `
            <div class="movement-adjustment-breakdown" aria-label="CSM 조정 구성">
              <div><span>경상 CSM 조정</span><strong>${formatSignedTrendWon(recurringAdjustment)}</strong></div>
              <div><span>경영목표 연결</span><strong>${formatSignedTrendWon(targetAdjustmentOverlay)}</strong></div>
              <div><span>합계</span><strong>${formatSignedTrendWon(item.current)}</strong></div>
            </div>` : ""}
          <div class="movement-year-comparison"><span>2025년 실제 ${item.prior == null ? "—" : formatSignedTrendWon(item.prior)}</span><b class="${item.effect != null && item.effect >= 0 ? "positive" : "negative"}">전년 대비 ${item.effect == null ? "—" : formatSignedTrendWon(item.effect)}</b></div>
          <p><b>변동 이유</b>${escapeHtml(item.reason)}</p>
          ${item.evidence ? `<button type="button" class="movement-evidence-tab" data-movement-evidence="${item.key}" aria-expanded="false"><span>근거·출처</span><b>${item.evidence.items.length}건</b></button>` : ""}
        </section>`).join("")}
      <details class="movement-supporting-summary movement-secondary-details">
        <summary>
          <span class="movement-supporting-heading"><i>03</i><strong>이자부리·CSM 상각</strong><small>보유 CSM에 연동되는 보조 Movement</small></span>
          <b>${supportingMovementItems.map((item) => `${item.label} ${formatSignedTrendWon(item.current)}`).join(" · ")}</b>
        </summary>
        <div class="movement-supporting-content">
          <div class="movement-supporting-values">
            ${supportingMovementItems.map((item) => `
              <div>
                <span>${item.label}</span>
                <strong class="${item.current >= 0 ? "positive" : "negative"}">${formatSignedTrendWon(item.current)}</strong>
                <small>전년 대비 ${item.effect == null ? "—" : formatSignedTrendWon(item.effect)}</small>
              </div>`).join("")}
          </div>
          <p>보유 CSM 규모와 최근 서비스 제공 패턴에 연동해 산출했습니다. 두 항목은 기말 CSM을 연결하는 보조 Movement로 간략히 반영합니다.</p>
        </div>
      </details>
    </div>
    <section class="movement-evidence-drawer" id="movement-evidence-drawer" hidden></section>
    <div class="movement-bridge-conclusion">
      <section class="movement-conclusion-number">
        <span>결론 · ${target} Base</span>
        <strong>${formatTrendWon(base.closing)}</strong>
        <b class="${annualChange >= 0 ? "positive" : "negative"}">2025년말 ${formatTrendWon(base.opening)} 대비 ${formatSignedTrendWon(annualChange)} · ${formatSignedPercent(annualChangeRate)}</b>
      </section>
      <section class="movement-conclusion-explanation">
        <div><span>2026 최대 기여항목</span><strong>${dominantContribution ? `${dominantContribution.label} ${formatSignedTrendWon(dominantContribution.current)}` : "—"}</strong><p>2026년 기말 CSM을 구성하는 Movement 중 절대 금액 기준</p></div>
        <div><span>전년 대비 최대 변화</span><strong>${dominantYearChange ? `${dominantYearChange.label} ${formatSignedTrendWon(dominantYearChange.effect)}` : "—"}</strong><p>${dominantYearChange ? `2025년 ${formatSignedTrendWon(dominantYearChange.prior)} → 2026년 ${formatSignedTrendWon(dominantYearChange.current)}` : "비교 가능한 전년 데이터가 없습니다."}</p></div>
        <div><span>Base / Worst</span><strong>${formatTrendWon(upper)} / ${formatTrendWon(lower)}</strong><p>2026년말 Base와 Worst 전망</p></div>
      </section>
    </div>
  `;

  const evidenceDrawer = container.querySelector("#movement-evidence-drawer");
  container.querySelectorAll("[data-movement-evidence]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = movementItems.find((movementItem) => movementItem.key === button.dataset.movementEvidence);
      if (!item?.evidence || !evidenceDrawer) return;
      container.querySelectorAll("[data-movement-evidence]").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-expanded", String(active));
      });
      evidenceDrawer.hidden = false;
      evidenceDrawer.innerHTML = renderMovementEvidenceDrawer(item.evidence, movementEvidenceSources, item.label);
      evidenceDrawer.querySelector(".movement-evidence-close")?.addEventListener("click", () => {
        evidenceDrawer.hidden = true;
        evidenceDrawer.innerHTML = "";
        container.querySelectorAll("[data-movement-evidence]").forEach((tab) => {
          tab.classList.remove("is-active");
          tab.setAttribute("aria-expanded", "false");
        });
      });
    });
  });
}

function annualNewBusinessHistory(context, limit = 3) {
  const periods = context.company?.periods ?? {};
  const years = [...new Set(Object.keys(periods).map((key) => parsePeriodKey(key).year))]
    .filter(Boolean)
    .sort((left, right) => left - right);
  return years
    .map((year) => {
      const yearEnd = periods[`${year}-ye`];
      const fourthQuarter = periods[`${year}-q4`];
      const annualMovement = yearEnd?.movement ?? fourthQuarter?.quarterlyAudit?.disclosedCumulativeMovement;
      return { year, value: annualMovement?.newbiz };
    })
    .filter((item) => Number.isFinite(item.value))
    .slice(-limit);
}

function formatForecastGrowth(rate) {
  const percentage = Number(rate) * 100;
  if (!Number.isFinite(percentage)) return "—";
  if (Math.abs(percentage) < 0.05) return "0.0%";
  return formatSignedPercent(percentage);
}

function forecastTrajectoryLabel(start, midpoint, end) {
  const phase = (left, right, years) => {
    if (!Number.isFinite(left) || !Number.isFinite(right) || left === 0) return "unknown";
    const annualRate = left > 0 && right > 0
      ? (right / left) ** (1 / years) - 1
      : (right - left) / Math.abs(left) / years;
    if (annualRate > 0.02) return "up";
    if (annualRate < -0.02) return "down";
    return "flat";
  };
  const middlePhase = phase(start, midpoint, 4);
  const longPhase = phase(midpoint, end, 5);
  const trajectoryLabels = {
    "up-up": "지속 우상향",
    "down-down": "지속 우하향",
    "up-down": "중기 상승 후 하향",
    "down-up": "중기 하락 후 회복",
    "up-flat": "중기 상승 후 보합",
    "down-flat": "중기 하락 후 보합",
    "flat-up": "완만한 우상향",
    "flat-down": "완만한 우하향",
    "flat-flat": "보합권",
  };
  return trajectoryLabels[`${middlePhase}-${longPhase}`] ?? "방향 확인 필요";
}

function forecastConclusionReason(base, horizonBase, assumptions = {}, direction = "") {
  const futurePoints = (horizonBase ?? []).filter((point) => point.period !== "2026-ye");
  const finalPoint = futurePoints.at(-1);
  if (!finalPoint || !Number.isFinite(base?.closing) || !Number.isFinite(finalPoint.closing)) {
    return "장기 Movement 근거를 추가 확인해야 합니다";
  }

  if (direction.includes("회복")) {
    return "신계약 CSM 유입이 조정·상각 부담을 점차 상쇄";
  }
  if (direction.includes("상승 후 하향")) {
    return "후반 신계약 유입이 조정·상각 부담을 충분히 상쇄하지 못함";
  }
  if (direction.includes("상승 후 보합")) {
    return "신계약·이자 유입이 증가를 이끈 뒤 조정·상각과 균형";
  }
  if (direction.includes("하락 후 보합")) {
    return "조정·상각 부담으로 감소한 뒤 신계약 유입과 균형";
  }

  const closingChange = finalPoint.closing - base.closing;
  const materiality = Math.max(Math.abs(base.closing) * 0.01, 100);
  const newbizGrowth = Number(assumptions.newbizGrowth);
  if (Math.abs(closingChange) <= materiality || direction === "보합권") {
    return "신계약·이자 유입과 조정·상각 부담이 대체로 균형";
  }
  if (closingChange > 0) {
    return newbizGrowth > 0.005
      ? "신계약 CSM 성장으로 유입이 조정·상각 부담을 상회"
      : "신계약·이자 유입이 조정·상각 부담을 상회";
  }
  return newbizGrowth < -0.005
    ? "신계약 CSM 둔화로 조정·상각 부담을 상쇄하지 못함"
    : "CSM 조정·상각 부담이 신계약·이자 유입을 상회";
}

function renderForecastMethodSummary(context, base) {
  const panel = document.querySelector("#forecast-method-summary");
  if (!panel) return;
  const knownBaseAnchor = base.forecastMeta?.driverForecast?.knownBaseAnchor;
  const baseSource = knownBaseAnchor
    ? `확인된 경영목표 ${formatTrendWon(knownBaseAnchor.value)}를 2026 Base에 우선 적용`
    : "확정 분기와 과거 계절성·최근 판매 흐름으로 2026 Base 산출";
  panel.innerHTML = `
    <div class="forecast-method-summary-heading">
      <span>BASE METHOD</span>
      <strong>최근 실적에서 시작해, 신계약과 감소요인을 매년 연결합니다</strong>
    </div>
    <div class="forecast-method-summary-flow">
      <div><span>01</span><small>출발점</small><strong>${escapeHtml(periodLabel(context.periodKey))} 실제 ${formatTrendWon(context.period.csm)}</strong></div>
      <i aria-hidden="true">→</i>
      <div><span>02</span><small>단기</small><strong>${escapeHtml(baseSource)}</strong></div>
      <i aria-hidden="true">→</i>
      <div><span>03</span><small>장기</small><strong>24·25년 실적과 26년 전망을 가중하고 일회성 CSM 조정은 제외</strong></div>
    </div>
    <p><b>계산식</b> 기말 CSM = 기시 CSM + 신계약 CSM + 이자부리 + CSM 조정 - CSM 상각</p>
  `;
}

function renderForecastInsightRail(context, base, worst, driverForecast) {
  const rail = document.querySelector("#forecast-insight-rail");
  if (!rail) return;
  const threeYearBase = base.forecastMeta?.horizon?.base?.find((point) => point.period === "2028-ye");
  const fiveYearBase = base.forecastMeta?.horizon?.base?.find((point) => point.period === "2030-ye");
  const assumptions = base.forecastMeta?.horizon?.assumptions ?? {};
  const history = annualNewBusinessHistory(context);
  const historyText = history.length
    ? history.map((item) => `${item.year}년 ${formatTrendWon(item.value)}`).join(" → ")
    : "과거 연간 신계약 CSM 데이터 없음";
  const nearTermGrowth = formatForecastGrowth(assumptions.newbizGrowth);
  const rawGrowth = formatForecastGrowth(assumptions.rawNewbizGrowth);
  const boundedGrowth = formatForecastGrowth(assumptions.boundedNewbizGrowth);
  const growthBounds = assumptions.newbizGrowthBounds ?? { lower: -0.05, upper: 0.05 };
  const optimismBiasPenalty = Number(assumptions.optimismBiasPenalty);
  const backtestMeanError = Number(assumptions.backtestMeanErrorBn);
  const trendWindow = assumptions.newbizTrendWindow ?? [];
  const trendWindowText = trendWindow.length
    ? trendWindow.map((item) => `${String(item.year).slice(-2)}년${item.valueKind === "base_forecast" ? " 전망" : ""} ${formatTrendWon(item.value)}`).join(" → ")
    : "최근 3개년 신계약 CSM";
  const growthControlSteps = `
    <span><b>기준 자료</b> ${trendWindowText}</span>
    <span><b>① 최근 흐름</b> 두 성장률을 35%·65%로 가중하면 ${rawGrowth}</span>
    <span><b>② 공통 상·하한</b> ${formatForecastGrowth(growthBounds.lower)}~${formatForecastGrowth(growthBounds.upper)} 범위 적용 후 ${boundedGrowth}</span>
    <span><b>③ 과거 예측오차</b> ${Number.isFinite(backtestMeanError) ? `연말 신계약 CSM을 평균 ${formatTrendWon(backtestMeanError, 2)} 높게 전망했던 오차의 일부를 반영해 ` : ""}${Number.isFinite(optimismBiasPenalty) ? `${(optimismBiasPenalty * 100).toFixed(1)}%p 차감` : "추가 차감 없음"}</span>
    <span class="insight-growth-result"><b>④ 최종 적용</b> 2027~2030년 신계약 CSM 증가율 ${nearTermGrowth}</span>
  `;
  const recurringAdjustmentRate = formatForecastGrowth(assumptions.baseAdjustmentRate);
  const adjustmentRateWindow = assumptions.adjustmentRateWindow ?? [];
  const adjustmentRateWindowText = adjustmentRateWindow.length
    ? adjustmentRateWindow.map((item) => `${String(item.year).slice(-2)}년${item.valueKind === "base_forecast" ? " 전망" : ""} ${formatForecastGrowth(item.rate)}`).join(" · ")
    : "최근 3개년 가중";
  const yearEndChange = base.closing - base.opening;
  const adjustmentAndAmortization = base.adjustment + base.amortization;
  const baseInflow = Math.round(base.newbiz / 100) * 100 + Math.round(base.interest / 100) * 100;
  const baseOutflow = Math.abs(adjustmentAndAmortization);
  const fiveYearInflow = fiveYearBase ? fiveYearBase.newbiz + fiveYearBase.interest : null;
  const fiveYearOutflow = fiveYearBase ? Math.abs(fiveYearBase.adjustment + fiveYearBase.amortization) : null;
  const fiveYearBalance = fiveYearInflow == null || fiveYearOutflow == null
    ? "5년차 Movement 데이터 없음"
    : Math.abs(fiveYearInflow - fiveYearOutflow) < 100
      ? `유입 ${formatTrendWon(fiveYearInflow)} · 감소 ${formatTrendWon(fiveYearOutflow)}로 거의 균형`
      : fiveYearInflow > fiveYearOutflow
        ? `유입 ${formatTrendWon(fiveYearInflow)} · 감소 ${formatTrendWon(fiveYearOutflow)}로 유입 우위`
        : `유입 ${formatTrendWon(fiveYearInflow)} · 감소 ${formatTrendWon(fiveYearOutflow)}로 감소 우위`;
  const direction = threeYearBase && fiveYearBase
    ? forecastTrajectoryLabel(base.closing, threeYearBase.closing, fiveYearBase.closing)
    : "방향 확인 필요";
  const conclusionReason = forecastConclusionReason(
    base,
    base.forecastMeta?.horizon?.base,
    assumptions,
    direction,
  );
  rail.innerHTML = `
    <div class="insight-rail-heading"><span>CEO READOUT</span><strong>${escapeHtml(context.company.name)} 전망 판단</strong></div>
    <ol>
      <li class="insight-conclusion">
        <span>01 · 전망 결론</span>
        <strong class="insight-conclusion-title"><span>${direction}</span><small>2026년 ${formatTrendWon(base.closing)} → 2030년 ${fiveYearBase ? formatTrendWon(fiveYearBase.closing) : "—"}</small></strong>
        <p class="insight-conclusion-reason"><b>주요 이유</b><span>${escapeHtml(conclusionReason)}</span></p>
        <div class="insight-fact-list">
          <div><b>2026 Base</b><p>${formatTrendWon(base.closing)} · 전년말 대비 ${formatSignedTrendWon(yearEndChange)}</p></div>
          <div><b>2028 전망</b><p>${threeYearBase ? formatTrendWon(threeYearBase.closing) : "—"}</p></div>
          <div><b>2030 전망</b><p>${fiveYearBase ? formatTrendWon(fiveYearBase.closing) : "—"} · ${direction}</p></div>
        </div>
      </li>
      <li>
        <span>02 · 핵심 성장동력</span>
        <strong>2026년 신계약 CSM ${formatSignedTrendWon(base.newbiz)}</strong>
        <div class="insight-fact-list">
          <div><b>단기 산출</b><p>확정 분기 실적과 과거 계절성을 반영</p></div>
          <div><b>과거 패턴</b><p>${historyText}</p></div>
          <div><b>성장 가정</b><p class="insight-growth-steps">${growthControlSteps}<span><b>적용 구간</b> 2027~2030년 동일 증가율 적용</span></p></div>
        </div>
      </li>
      <li>
        <span>03 · CSM 유지 구조</span>
        <strong>2026년 유입 ${formatTrendWon(baseInflow)} · 감소 ${formatTrendWon(baseOutflow)}</strong>
        <div class="insight-fact-list">
          <div><b>유입요인</b><p>신계약 ${formatSignedTrendWon(base.newbiz)} · 이자부리 ${formatSignedTrendWon(base.interest)}</p></div>
          <div><b>감소요인</b><p class="insight-movement-components"><span>CSM 조정 <em>${formatSignedTrendWon(base.adjustment)}</em></span><span>CSM 상각 <em>${formatSignedTrendWon(base.amortization)}</em></span><small>CSM 조정률 ${recurringAdjustmentRate} · ${adjustmentRateWindowText} 가중 · 일회성 조정 제외</small></p></div>
          <div><b>2030 구조</b><p>${fiveYearBalance}</p></div>
        </div>
      </li>
    </ol>
  `;
}

function renderDriverForecastPanel(driver, base, worst) {
  const panel = document.querySelector("#driver-forecast-panel");
  if (!panel) return;
  if (!base || !worst) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const p50 = driver?.distribution?.p50 ?? base;
  const p10 = driver?.distribution?.p10 ?? worst;
  const worstGap = p10.closing - p50.closing;
  const worstPolicy = base.forecastMeta?.horizon?.assumptions?.worstPolicy ?? {};
  const remainingOpening = Number(base.remainingForecast?.opening ?? base.opening);
  const remainingAdjustment = Number(base.remainingForecast?.adjustment ?? base.adjustment);
  const proportionalAdjustmentStress = Math.abs(remainingAdjustment) * Number(worstPolicy.adjustmentStress ?? 0.1);
  const minimumAdjustmentStress = Math.abs(remainingOpening) * Number(worstPolicy.adjustmentRatePointFloor ?? 0.01);
  const minimumStressApplied = minimumAdjustmentStress > proportionalAdjustmentStress;
  const adjustmentWorstRule = minimumStressApplied
    ? "3~4분기 Base 대비 10% 악화 · Base 조정 부담이 작아 기시 CSM의 1%를 최소 하방으로 적용"
    : "3~4분기 Base 대비 10% 악화";
  const confidence = base.forecastMeta?.horizon?.horizonConfidence;
  const baseSummary = driver?.knownBaseAnchor
    ? `경영목표 ${formatTrendWon(driver.knownBaseAnchor.value)}를 우선 적용했습니다. 독립 모델과의 ${formatSignedTrendWon(driver.knownBaseAnchor.reconciliation)} 차이는 CSM 조정에서 분리하고 2027~2029년에 단계적으로 정상화합니다.`
    : "상반기 확정 실적과 과거 계절성, 직전 2개 연말의 정상화 CSM 조정률을 반영한 Base 전망입니다.";
  panel.hidden = false;
  panel.innerHTML = `
    <div class="driver-panel-heading compact-driver-heading">
      <div><span>2026 SCENARIO</span><strong>Base 전망과 Worst 산정 기준</strong></div>
      <button type="button" class="driver-evidence-link" data-forecast-open-tab="movement" data-forecast-focus="#driver-stress-panel">Worst 상세 분석 →</button>
    </div>
    <div class="driver-scenario-summary">
      <section class="driver-scenario-base">
        <div><span>Base</span><strong>${formatTrendWon(p50.closing)}</strong></div>
        <p>${baseSummary}</p>
      </section>
      <section class="driver-scenario-worst">
        <div><span>Worst</span><strong>${formatTrendWon(p10.closing)}</strong><small>Base 대비 ${formatSignedTrendWon(worstGap)}</small></div>
        <div class="driver-worst-rules">
          <p>확정된 상반기는 유지하고, 남은 전망에 전 보험사 동일 기준을 적용합니다.</p>
          <ul>
            <li><span>신계약 CSM</span><b>3~4분기 Base 대비 10% 감소</b></li>
            <li><span>CSM 조정</span><b>${adjustmentWorstRule}</b></li>
          </ul>
        </div>
      </section>
    </div>
    <div class="scenario-confidence-note">
      <b>전망 해석</b>
      <span>2026 ${escapeHtml(confidence?.oneYear ?? "제한적 검증")}</span>
      <span>2027~2028 ${escapeHtml(confidence?.twoToThreeYears ?? "모델 경로")}</span>
      <span>2029~2030 ${escapeHtml(confidence?.fourToFiveYears ?? "시나리오")}</span>
    </div>
  `;
}

function renderDriverStressPanel(driver, base, worst) {
  const panel = document.querySelector("#driver-stress-panel");
  if (!panel) return;
  if (!base || !worst) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  if (!driver) {
    const newbizDelta = worst.newbiz - base.newbiz;
    const adjustmentDelta = worst.adjustment - base.adjustment;
    const newbizDownsideRate = base.newbiz ? Math.max(0, (1 - worst.newbiz / base.newbiz) * 100) : 0;
    panel.hidden = false;
    panel.innerHTML = `
      <details class="driver-stress-disclosure">
        <summary><span><i>WORST DETAIL</i><strong>Worst 하방요인 상세</strong></span><small>신계약 CSM과 CSM 조정으로 구분해 보기</small></summary>
        <div class="driver-stress-table">
          <section class="driver-stress-group">
            <div class="driver-stress-group-heading"><span>01</span><strong>신계약 CSM</strong><small>판매량과 계약당 수익성 하방</small></div>
            <div class="driver-stress-row">
              <strong>Worst 신계약 CSM</strong>
              <span>Q3~Q4 잔여 전망에 공통 -10% 적용 · 상반기 확정치를 포함한 연간 합계는 Base 대비 ${newbizDownsideRate.toFixed(1)}% 하락</span>
              <b>${formatSignedTrendWon(worst.newbiz)}<small>연간 Base 대비 ${formatSignedTrendWon(newbizDelta)}</small></b>
            </div>
          </section>
          <section class="driver-stress-group">
            <div class="driver-stress-group-heading"><span>02</span><strong>CSM 조정</strong><small>경험조정·계리 가정 부담 확대</small></div>
            <div class="driver-stress-row">
              <strong>Worst CSM 조정</strong>
              <span>Q3~Q4 잔여 전망에 공통 10% 악화 적용 · Base 조정 부담이 매우 작을 때만 기시 CSM의 1% 금액을 최소 하방으로 적용</span>
              <b>${formatSignedTrendWon(worst.adjustment)}<small>연간 Base 대비 ${formatSignedTrendWon(adjustmentDelta)}</small></b>
            </div>
          </section>
          <div class="driver-stress-combined">
            <div><span>최종 하방 전망</span><strong>복합 Worst</strong><small>신계약 CSM과 CSM 조정 하방 및 이자부리·상각 연동효과 반영</small></div>
            <b>${formatTrendWon(worst.closing)}<small>${formatSignedTrendWon(worst.closing - base.closing)}</small></b>
          </div>
        </div>
      </details>
    `;
    return;
  }

  const { p50 } = driver.distribution;
  const newBusinessStressRows = [driver.stressScenarios.salesSlowdown].filter(Boolean);
  const adjustmentStressRows = [driver.stressScenarios.lapseAndExpense].filter(Boolean);
  const combinedStress = driver.stressScenarios.combined;
  const renderStressRows = (rows) => rows.map((stress) => `
    <div class="driver-stress-row">
      <strong>${escapeHtml(stress.label)}</strong>
      <span>${escapeHtml(stress.description)}</span>
      <b>${formatTrendWon(stress.closing)}<small>${formatSignedTrendWon(stress.closing - p50.closing)}</small></b>
    </div>
  `).join("");
  panel.hidden = false;
  panel.innerHTML = `
    <details class="driver-stress-disclosure">
      <summary><span><i>WORST DETAIL</i><strong>Worst 하방요인 상세</strong></span><small>신계약 CSM과 CSM 조정으로 구분해 보기</small></summary>
      <div class="driver-stress-table">
        <section class="driver-stress-group">
          <div class="driver-stress-group-heading"><span>01</span><strong>신계약 CSM</strong><small>판매량과 계약당 수익성 하방</small></div>
          ${renderStressRows(newBusinessStressRows)}
        </section>
        <section class="driver-stress-group">
          <div class="driver-stress-group-heading"><span>02</span><strong>CSM 조정</strong><small>장래손해율·해지·사업비 가정 악화</small></div>
          ${renderStressRows(adjustmentStressRows)}
        </section>
        ${combinedStress ? `
          <div class="driver-stress-combined">
            <div><span>최종 하방 전망</span><strong>복합 Worst</strong><small>신계약 CSM과 CSM 조정의 하방 요인을 동시 반영</small></div>
            <b>${formatTrendWon(combinedStress.closing)}<small>${formatSignedTrendWon(combinedStress.closing - p50.closing)}</small></b>
          </div>
        ` : ""}
      </div>
    </details>
  `;
}

function movementItems(movement) {
  return [
    { key: "opening", label: "기시 CSM", value: movement.opening, kind: "total" },
    { key: "newbiz", label: "신계약", value: movement.newbiz, kind: "positive" },
    { key: "interest", label: "이자부리", value: movement.interest, kind: "positive" },
    { key: "adjustment", label: "CSM 조정 등", value: movement.adjustment, kind: movement.adjustment >= 0 ? "positive" : "negative" },
    { key: "amortization", label: "CSM 상각", value: movement.amortization, kind: "negative" },
    { key: "closing", label: "기말 CSM", value: movement.closing, kind: "total" },
  ];
}

function movementGeometry(movement) {
  const items = movementItems(movement);
  const cumulative = [movement.opening];
  for (const item of items.slice(1, -1)) {
    cumulative.push(cumulative.at(-1) + item.value);
  }
  const max = Math.max(movement.opening, movement.closing, ...cumulative) * 1.1;
  return items.map((item, index) => {
    if (index === 0 || index === items.length - 1) {
      return { ...item, bottom: 0, height: (item.value / max) * 100 };
    }
    const before = cumulative[index - 1];
    const after = cumulative[index];
    return {
      ...item,
      bottom: (Math.min(before, after) / max) * 100,
      height: (Math.abs(after - before) / max) * 100,
    };
  });
}

function renderMovement() {
  const rows = companyCatalog.map((catalog) =>
    contextForValueBasis(getContext(catalog.key, state.periodKey)),
  );
  const completed = rows.filter((row) => row.period?.movement).length;
  document.querySelector("#movement-coverage-value").textContent = `${completed} / ${rows.length}`;

  document.querySelector("#movement-table-body").innerHTML = rows
    .map((context) => {
      const movement = context.period?.movement;
      const isSectorStart = companiesInSector(context.company.sector)[0].key === context.companyKey;
      const sector = sectorMetaForCompany(context.company);
      const sectorCell = isSectorStart
        ? `<th class="sector-group-cell sector-${sector.key}" scope="rowgroup" rowspan="${companiesInSector(context.company.sector).length}"><span>${sector.shortName}</span><small>${escapeHtml(sector.name)}</small></th>`
        : "";
      if (!movement) {
        return `
          <tr class="movement-row is-empty ${isSectorStart ? "sector-start" : ""}">
            ${sectorCell}
            <td class="table-company-cell movement-company-cell">
              <span class="movement-company">
                <span><strong>${context.company.name}</strong><small>데이터 준비중</small></span>
              </span>
            </td>
            ${Array.from({ length: 6 }, () => "<td>—</td>").join("")}
            <td><span class="movement-empty-label">데이터 준비중</span></td>
          </tr>
        `;
      }

      const geometry = movementGeometry(movement);
      const check =
        movement.opening +
        movement.newbiz +
        movement.interest +
        movement.adjustment +
        movement.amortization;
      const review = reviewSummary(context.companyKey, context.periodKey);
      const movementStatusLabel = check !== movement.closing || review.failed
        ? "검토 필요"
        : review.needsReview
          ? "휴먼리뷰 필요"
          : "검증 통과";
      return `
        <tr class="movement-row ${isSectorStart ? "sector-start" : ""}">
          ${sectorCell}
          <td class="table-company-cell movement-company-cell">
            <span class="movement-company">
              <span>
                <strong>${context.company.name}</strong>
                <small>${movementStatusLabel}</small>
              </span>
            </span>
          </td>
          <td><strong>${formatWon(movement.opening)}</strong></td>
          <td class="movement-positive">${formatSignedWon(movement.newbiz, 2)}</td>
          <td class="movement-positive">${formatSignedWon(movement.interest, 2)}</td>
          <td class="${movement.adjustment >= 0 ? "movement-positive" : "movement-negative"}">${formatSignedWon(movement.adjustment, 2)}</td>
          <td class="movement-negative">${formatSignedWon(movement.amortization, 2)}</td>
          <td><strong>${formatWon(movement.closing)}</strong></td>
          <td>
            <button
              type="button"
              class="movement-spark"
              data-movement-company="${context.companyKey}"
              aria-label="${context.company.name} Movement 상세 보기"
            >
              ${geometry
                .map(
                  (item) => `
                    <i
                      class="${item.kind}"
                      style="--spark-bottom:${item.bottom}%; --spark-height:${Math.max(2, item.height)}%"
                      title="${item.label} ${formatSignedWon(item.value, 2)}"
                    ></i>
                  `,
                )
                .join("")}
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll("[data-movement-company]").forEach((button) => {
    button.addEventListener("click", () => openMovementModal(button.dataset.movementCompany));
  });
}

function openMovementModal(companyKey) {
  const context = contextForValueBasis(getContext(companyKey, state.periodKey));
  const movement = context.period?.movement;
  if (!movement) return;
  const geometry = movementGeometry(movement);
  const check =
    movement.opening +
    movement.newbiz +
    movement.interest +
    movement.adjustment +
    movement.amortization;
  const review = reviewSummary(context.companyKey, state.periodKey);
  const validationState = check !== movement.closing || review.failed
    ? { label: "검토 필요", className: "check-warning", detail: "Movement 산식 또는 필수 검증 항목 확인 필요" }
    : review.needsReview
      ? { label: "휴먼리뷰 필요", className: "check-warning", detail: review.items.find((item) => item.status !== "passed")?.reviewReason ?? "원문 대사 항목 확인 필요" }
      : { label: "검증 통과", className: "check-pass", detail: "Movement 산식과 원문 추적 검증 통과" };

  document.querySelector("#movement-modal-title").textContent =
    `${context.company.name} CSM Movement`;
  document.querySelector("#movement-modal-subtitle").textContent =
    `${periodLabel(state.periodKey)} ${basisLabel()} 기준 · ${state.valueBasis === "cumulative" ? "기시 전년도말" : "기시 전분기말"} · 별도재무제표 · 재보험 제외`;
  document.querySelector("#movement-modal-content").innerHTML = `
    <article class="panel movement-card modal-movement-card">
      <div class="movement-chart">
        ${geometry
          .map(
            (item, index) => `
              <div class="movement-column">
                <div class="movement-plot">
                  <span
                    class="movement-bar ${item.kind}"
                    style="--bar-bottom:${item.bottom}%; --bar-height:${Math.max(item.height, 1.5)}%"
                  >
                    <b>${index === 0 || index === 5 ? formatWon(item.value) : formatSignedWon(item.value, 2)}</b>
                  </span>
                </div>
                <strong>${item.label}</strong>
                <small>${index === 0 ? (state.valueBasis === "cumulative" ? "전년도말 기시" : "전분기말 기시") : index === 5 ? periodLabel(state.periodKey) : `${basisLabel()} Movement`}</small>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="movement-summary">
        <div><span>Movement 검증 상태</span><strong class="${validationState.className}">${validationState.label}</strong><small>${escapeHtml(validationState.detail)}</small></div>
        <div><span>기시 CSM</span><strong>${formatWon(movement.opening)}</strong></div>
        <div><span>기말 CSM</span><strong>${formatWon(movement.closing)}</strong></div>
        <div><span>총 변동</span><strong>${formatSignedWon(movement.closing - movement.opening)}</strong></div>
      </div>
    </article>
  `;
  movementModal.showModal();
}

function reviewSummary(companyKey, periodKey) {
  const items = reviewItems.filter(
    (item) => item.company === companyKey && item.period === periodKey,
  );
  if (!items.length) {
    const movement = companies[companyKey]?.periods?.[periodKey]?.movement;
    if (!movement) {
      return { total: 0, passed: 0, needsReview: 0, failed: 0, items: [] };
    }
    const reconciled =
      movement.opening +
        movement.newbiz +
        movement.interest +
        movement.adjustment +
        movement.amortization ===
      movement.closing;
    return {
      total: 1,
      passed: reconciled ? 1 : 0,
      needsReview: reconciled ? 0 : 1,
      failed: 0,
      items: [],
    };
  }
  return {
    total: items.length,
    passed: items.filter((item) => item.status === "passed").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}

const qualityMethodology = [
  {
    metric: "예실차 · 5% 관리기준",
    source:
      "각 보험사 홈페이지의 연말 결산 경영공시 중 별도 SAP 손익계산서 또는 공식 Factsheet만 원본으로 사용. 현재 수록기간은 2024·2025년말. 삼성생명·한화생명·삼성화재·메리츠화재·DB손해보험·현대해상은 예상·발생 세부 행, 교보생명·신한라이프·KB손해보험은 결산 경영공시의 공식 결과값을 사용.",
    validation:
      "회사·연도·별도 여부·원문 문서명·시트·열·행·부호·원단위를 확인하고 억원으로 정규화. 세부 행 공개 6개사는 예상액−실제액과 보험금·사업비 비율을 재계산해 원문 결과와 대조. 교보·신한·KB는 공식 결과값과 공개 분모 범위를 구분하며, 신한의 세부 비율과 KB의 비율처럼 분모가 없으면 미산출로 유지.",
    rule:
      "보험금 = 예상보험금 − (발생보험금 + 발생사고요소조정), 사업비 = 예상 손해조사비·계약유지비·투자관리비 합계 − 동일 발생액 합계. 각 비율은 대응 예상액을 분모로 사용. 상단 1~3분기는 직전 연말, 4분기·연말은 해당 연말을 당기로 선택하며 전기 미수록 값은 공란. ±5%는 참고선이고 Open DART·FISIS·공시기준 값으로 SAP 미공개 값을 대체하지 않음. 첨부 양식과 ref_data는 화면 구조 참고에만 사용.",
  },
  {
    metric: "보험부채 변동내역",
    source:
      "Open DART 사업보고서 재무제표 주석의 보험계약부채 변동표 중 회사계·발행한 보험계약 기준에서 2024·2025년 BEL·RA·CSM을 직접 수집.",
    validation:
      "2022년말부터 회사별 Open DART 사업보고서 원문 전체를 탐색. 2022년은 상세·유사표가 없고 2023년 일부 민감도 분석표만 확인되며, 9개사의 동일 상세 변동표는 2024년말부터 확인됨. 회사·연도별 접수번호, XML, 표 인덱스와 원단위를 저장.",
    rule: "원본·검증 기준은 Open DART로 단일화하고 연말 선택 시에만 표시. 원·천원·백만원·억원을 억원으로 정규화하며 구성요소 합계와 공시 합계의 반올림 차이만 허용.",
  },
  {
    metric: "예실차 · 공시기준",
    source:
      "Open DART 사업보고서 · 연결재무제표 주석의 합계 행에서 예상손해율(A), 실제손해율(B), 보험금 예실차비율(C)을 수집.",
    validation:
      "DART 공시의 예상손해율·실제손해율·예실차 공시값을 함께 저장하고 C = A − B를 재계산. 회사·연도별 접수번호와 표 인덱스로 원문 추적성을 확인.",
    rule: "C = A − B를 재계산해 공시값과 대조. 0.01%p 이내 반올림 차이만 허용.",
  },
  {
    metric: "경과기간별 손해율",
    source:
      "Open DART 연결재무제표 주석의 발행 보험계약 합계에서 경과기간별 예상보험금과 위험보험료를 수집.",
    validation:
      "DART 공시의 예상보험금·위험보험료를 15개 경과기간 및 현재가치 기준으로 합산한 뒤 각 구간의 A ÷ B를 재계산해 공시 비율과 대조.",
    rule: "각 구간 비율 = 예상보험금 ÷ 위험보험료. 원문 표시단위와 현재가치를 별도 보존.",
  },
  {
    metric: "경과기간별 유지비율",
    source:
      "Open DART 연결재무제표 주석의 발행 보험계약 합계에서 경과기간별 예상유지비와 예정유지비를 수집.",
    validation:
      "DART 공시의 예상유지비·예정유지비를 15개 경과기간 및 현재가치 기준으로 합산한 뒤 각 구간의 A ÷ B를 재계산해 공시 비율과 대조.",
    rule: "각 구간 비율 = 예상유지비 ÷ 예정유지비. 금액은 억원, 비율은 %로 표시.",
  },
  {
    metric: "보유 CSM",
    source:
      "Open DART 사업·분기·반기보고서 · 별도 보험계약 주석의 ‘보험계약마진’ 기말 잔액. 발행 보험계약만 포함하고 출재 재보험은 제외하며 분리된 계약군 표는 합산.",
    validation:
      "직전 연말·전분기 기말과 다음 공시 기초를 연속 대사하고, FISIS에 없는 CSM은 회사 공식 IR·경영공시로 보조검증.",
    rule: "Movement 항등식과 기초 연속성을 모두 통과해야 확정. DB손해보험 2025년은 분리 표 #281·#285를 합산해 2026 Q1 기초와 대사.",
  },
  {
    metric: "신계약 CSM",
    source:
      "Open DART 별도 보험계약 주석의 ‘당기 최초 인식한 보험계약’ 효과. 여러 측정모형·상품군 표는 합산.",
    validation:
      "회사 공식 연간 IR의 신계약 CSM. 연간 누계인지, 분기 단독 수치인지 먼저 확인.",
    rule: "누적 기준은 DART 공시 누적값, 분기 기준은 직전 누적 차감값을 표시한다. 동일 기간 기준끼리 비교하고 표시단위 반올림 차이만 허용.",
  },
  {
    metric: "CSM Movement",
    source:
      "Open DART 분기·반기·사업보고서 주석에서 기시·신계약·이자부리·가정/경험조정·상각·기말 값을 재구성.",
    validation:
      "회사 IR의 CSM Movement 표와 항목별 비교. 분기 원문은 직전 연말 CSM과 기초 잔액을 대사하고 재작성 차이를 별도 보존.",
    rule: "기말 = 기시 + 신계약 + 이자 + 조정 + 상각. 누적 기준은 전년도말 기시의 공시 누적값, 분기 기준은 누적 차감으로 산출한 전분기말 기시의 단독값을 표시.",
  },
  {
    metric: "CSM 전망",
    source:
      "파싱·검증이 끝난 분기별 CSM Movement를 원천으로 사용하고, 외부 보정 근거는 증권사 애널리스트 리포트만 연결. 기사·보도자료는 전망 입력에서 제외.",
    validation:
      "최근 4개 분기 비율·전년 계절성과 대조하고, 내부 계산한 2026~2030년 모든 연도에서 기시 + 신계약 + 이자 + 조정 + 상각 = 기말을 재검산.",
    rule: "신계약 추세율은 2024·2025년 실적과 2026년 Base 전망으로 계산한 두 전년 대비 변화율을 35%·65% 가중한 뒤 -5%~+5% 범위와 백테스트 통제를 적용. CSM 조정률은 같은 3개년을 20%·30%·50% 가중하며 연간 순양(+) 조정, 경영목표 연결분과 분기성 환입·재분류의 총액 반복을 제외. 회사별 직접 근거가 있을 때만 증권사 오버레이를 제한적으로 반영. Worst는 신계약 CSM -10%, CSM 조정 10% 악화를 적용하고, Base 조정 부담이 매우 작을 때만 기시 CSM의 1% 금액을 최소 하방으로 사용한 뒤 이자·상각을 다시 계산.",
  },
  {
    metric: "보험손익",
    source:
      "Open DART 별도 포괄손익계산서의 표준 계정 ID ifrs-full_InsuranceServiceResult. 누적값·당 3개월 직접값·누적 차감값을 함께 보존.",
    validation:
      "DART 당 3개월 직접 공시값과 누적 차감값을 먼저 대사. FISIS 게시 후 생보 SH154/A, 손보 SI150/A와 추가 비교.",
    rule: "직접값과 누적 차감값은 0.001십억원 이내면 일치. FISIS 미게시 기간은 not_published로 기록하고 DART 내부 검증을 유지.",
  },
  {
    metric: "당기순이익",
    source:
      "Open DART 연결 포괄손익계산서의 표준 계정 ID ifrs-full_ProfitLossAttributableToOwnersOfParent. 한글 계정명은 ID가 없을 때만 대체.",
    validation:
      "DART 당 3개월 직접 공시값과 누적 차감값을 0.001십억원 허용오차로 대사. FISIS 생보 SH154/G, 손보 SI150/G는 별도 손익이므로 기준차이로 병기.",
    rule: "연결 지배주주 귀속값을 대시보드 기준으로 확정하고 연결 총순이익·FISIS 별도 순이익으로 대체하지 않음.",
  },
  {
    metric: "K-ICS / RBC",
    source:
      "Open DART 지급여력 공시의 연도말 비율. 2023년 이후 K-ICS, 2022년은 RBC.",
    validation:
      "FISIS K-ICS: 생보 SH021/D·손보 SI021/D. 경과조치 적용 후 값이 없으면 A 사용. 2022 RBC: 생보 SH148/A·손보 SI139/A.",
    rule: "같은 경과조치 기준끼리 비교해 0.01%p 이내면 일치. 대체 필드 사용 시 사유를 기록.",
  },
  {
    metric: "CSM 전망",
    source:
      "외부 공시값이 아닌 시나리오 계산값. 최신 파싱 분기말 CSM과 최근 신계약·이자·조정·상각 흐름을 입력으로 사용.",
    validation:
      "Base와 Worst 가정을 분리하고 실제 공시 구간과 시각적으로 구분.",
    rule: "예측 정확도 판정 대상이 아니며, 다음 연말 실적 확정 후 오차를 별도 추적.",
  },
];

function formatDisclosureNumber(value, isRatio = false) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (isRatio) {
    return `${number.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }
  return number.toLocaleString("ko-KR", {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
    maximumFractionDigits: 2,
  });
}

function formatDashboardPercent(value, fractionDigits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

function formatLiabilityAmount(value, signed = true) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const sign = signed ? (number > 0 ? "+" : number < 0 ? "−" : "") : "";
  const trillion = Math.abs(number) / 10000;
  const digits = trillion < 0.1 ? 2 : 1;
  return `${sign}${trillion.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}조원`;
}

function formatLiabilityRaw(value, ratio = false) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  if (ratio) return formatDashboardPercent(Number(value) * 100, 2);
  const trillion = Number(value) / 10000;
  const digits = Math.abs(trillion) < 0.1 ? 2 : 1;
  return trillion.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function latestAnnualPeriodAtOrBefore(availablePeriods = [], maxYear) {
  return [...availablePeriods]
    .filter((key) => {
      const parsed = parsePeriodKey(key);
      return parsed.kind === "ye" && parsed.year <= maxYear;
    })
    .sort(comparePeriods)
    .at(-1) ?? null;
}

function annualDisclosureTargetYear() {
  const { year, quarter, kind } = parsePeriodKey(state.periodKey);
  return kind === "ye" || quarter === 4 ? year : year - 1;
}

function liabilityAvailablePeriodKey() {
  return latestAnnualPeriodAtOrBefore(
    liabilityAssumptionData.availablePeriods,
    annualDisclosureTargetYear(),
  );
}

function liabilityPeriodItem(companyKey, periodKey = liabilityAvailablePeriodKey()) {
  return liabilityAssumptionData.companies?.[companyKey]?.periods?.[periodKey];
}

function renderLiabilityAssumption() {
  const grid = document.querySelector("#liability-summary-grid");
  if (!grid) return;
  const periodKey = liabilityAvailablePeriodKey();
  const year = periodKey ? parsePeriodKey(periodKey).year : parsePeriodKey(state.periodKey).year;
  document.querySelector("#liability-period-label").textContent = periodKey ? periodLabel(periodKey) : periodLabel(state.periodKey);
  document.querySelector('[data-full-metric="liability"]').disabled = !periodKey;
  if (!periodKey) {
    grid.innerHTML = disclosureEmptyState("보험부채 변동내역");
    return;
  }

  const items = companyCatalog.map((catalog) => ({ catalog, item: liabilityPeriodItem(catalog.key, periodKey) }));
  const itemByCompany = Object.fromEntries(items.map(({ catalog, item }) => [catalog.key, item]));
  const maxDriver = Math.max(1, ...items.flatMap(({ item }) => (item?.summary?.drivers ?? []).map((driver) => Math.abs(driver.csm ?? 0))));
  grid.innerHTML = renderSectorCardGroups((catalog) => {
    const item = itemByCompany[catalog.key];
    const summary = item?.summary;
    if (!summary) return `<article class="liability-card is-empty"><strong>${escapeHtml(catalog.name)}</strong><span>데이터 없음</span></article>`;
    const effect = summary.assumptionEffect.csm;
    const prior = liabilityPeriodItem(catalog.key, `${year - 1}-ye`)?.summary?.assumptionEffect?.csm;
    const direction = effect >= 0 ? "positive" : "negative";
    const keyDrivers = [...summary.drivers]
      .sort((left, right) => Math.abs(right.csm ?? 0) - Math.abs(left.csm ?? 0))
      .slice(0, 2);
    return `<article class="liability-card ${state.companyKey === catalog.key ? "is-selected" : ""}">
      <div class="liability-card-head"><strong>${escapeHtml(catalog.name)}</strong><small>${item.checks.status === "passed" ? "검산 완료" : "검토 필요"}</small></div>
      <div class="liability-impact"><span>가정변경 CSM 영향</span><strong class="${direction}">${formatLiabilityAmount(effect)}</strong><small>원문 ${escapeHtml(item.sourceReference.originalUnit)} · 화면 조원 ${assumptionSourceLink(item.sourceReference)}</small></div>
      <div class="liability-prior"><span>전년</span><strong>${formatLiabilityAmount(prior)}</strong><i>→</i><span>당기</span><strong class="${direction}">${formatLiabilityAmount(effect)}</strong></div>
      <div class="liability-driver-heading"><span>주요 변동요인</span><small>영향액 상위 2개</small></div>
      <div class="liability-driver-list">
        ${keyDrivers.map((driver) => {
          const driverDirection = (driver.csm ?? 0) >= 0 ? "positive" : "negative";
          const extent = Math.min(Math.abs(driver.csm ?? 0) / maxDriver * 48, 48);
          return `<div class="liability-driver"><span>${escapeHtml(driver.label.replace("가정", ""))}</span><div class="liability-driver-track"><i class="${driverDirection}" style="--driver-extent:${extent}%"></i></div><strong class="${driverDirection}">${formatLiabilityAmount(driver.csm)}</strong></div>`;
        }).join("")}
      </div>
      <div class="liability-card-foot"><span><small>CSM 추정변경 전체</small><strong>${formatLiabilityAmount(summary.estimateChange.csm)}</strong></span><span><small>신계약 CSM</small><strong>${formatLiabilityAmount(summary.newBusiness.csm)}</strong></span></div>
    </article>`;
  }, "liability-sector-grid");
}

function fullLiabilityAssumptionTable() {
  const currentPeriodKey = liabilityAvailablePeriodKey();
  if (!currentPeriodKey) return "";
  const currentYear = parsePeriodKey(currentPeriodKey).year;
  const priorPeriodKey = `${currentYear - 1}-ye`;
  const periodKeys = liabilityAssumptionData.availablePeriods?.includes(priorPeriodKey)
    ? [priorPeriodKey, currentPeriodKey]
    : [currentPeriodKey];
  const rows = companyCatalog.flatMap((catalog) => {
    const current = liabilityPeriodItem(catalog.key, currentPeriodKey);
    if (!current) return [];
    const sectorCompanies = companiesInSector(catalog.sector).filter((company) => liabilityPeriodItem(company.key, currentPeriodKey));
    const isSectorStart = sectorCompanies[0]?.key === catalog.key;
    const sectorRowSpan = sectorCompanies.reduce((sum, company) => sum + (liabilityPeriodItem(company.key, currentPeriodKey)?.rows?.length ?? 0), 0);
    return current.rows.map((row, index) => {
      const isRatio = row.label.startsWith("*");
      return `<tr class="liability-level-${row.level} ${isRatio ? "liability-ratio-row" : ""}">
        ${index === 0 && isSectorStart ? `<th class="liability-sector-cell sector-${sectorMetaForCompany(catalog).key}" rowspan="${sectorRowSpan}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}
        ${index === 0 ? `<th class="liability-company-cell" rowspan="${current.rows.length}">${escapeHtml(catalog.name)}${assumptionSourceLink(current.sourceReference)}</th>` : ""}
        <th class="liability-label-cell"><span>${escapeHtml(row.label)}</span></th>
        ${periodKeys.map((key) => {
          const periodRow = liabilityPeriodItem(catalog.key, key)?.rows?.find((item) => item.label === row.label);
          return `<td>${formatLiabilityRaw(periodRow?.bel)}</td><td>${formatLiabilityRaw(periodRow?.ra)}</td><td>${formatLiabilityRaw(periodRow?.csm, isRatio)}</td>`;
        }).join("")}
      </tr>`;
    });
  }).join("");
  const yearHeadings = periodKeys.map((key) => `<th colspan="3">${periodLabel(key)}</th>`).join("");
  const metricHeadings = periodKeys.map(() => "<th>BEL</th><th>RA</th><th>CSM</th>").join("");
  return `<div class="liability-full-table-wrap" tabindex="0" aria-label="보험부채 변동내역 전체표"><table class="liability-full-table"><caption class="table-unit-caption">표시 단위 · 금액: 조원 · 비율 행: % · 좌우로 이동해 전체 항목 확인</caption><thead><tr><th rowspan="2">업권</th><th rowspan="2">회사</th><th rowspan="2">구분</th>${yearHeadings}</tr><tr>${metricHeadings}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function assumptionSourceLink(sourceReference) {
  if (!sourceReference?.dartUrl) return "";
  return `<a class="disclosure-source-link" href="${escapeHtml(sourceReference.dartUrl)}" target="_blank" rel="noreferrer" aria-label="DART 원문 열기">DART ↗</a>`;
}

function claimSourceForYear(item, year) {
  const table = item?.sourceReference?.sourceTables?.[String(year)];
  if (table?.reportYear === "2024" && item?.sourceReference?.comparativeReport) {
    return item.sourceReference.comparativeReport;
  }
  return item?.sourceReference;
}

function assumptionYear() {
  const periodKey = assumptionPeriodKey();
  return periodKey ? parsePeriodKey(periodKey).year : annualDisclosureTargetYear();
}

function assumptionPeriodKey() {
  return latestAnnualPeriodAtOrBefore(
    assumptionData.availablePeriods,
    annualDisclosureTargetYear(),
  );
}

function assumptionPeriodAvailable() {
  const periodKey = assumptionPeriodKey();
  return periodKey != null && assumptionData.availablePeriods?.includes(periodKey);
}

function disclosureEmptyState(label) {
  const { year, quarter, kind } = parsePeriodKey(state.periodKey);
  const heading = kind === "quarter" && quarter < 4 ? `${year}년 분기 공시 없음` : `${periodLabel(state.periodKey)} 공시 전`;
  return `<div class="assumption-unavailable"><strong>${heading}</strong><p>${label}은 2024년말부터 연 1회 공시됩니다.</p></div>`;
}

function formatSignedEok(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${Math.abs(number).toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}억원`;
}

function formatManagementRatio(value, suffix = "%") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const rounded = Number(Number(value).toFixed(1));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}${suffix}`;
}

function managementDirection(value) {
  if (value == null || !Number.isFinite(Number(value))) return "neutral";
  return Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral";
}

function managementSourceLink(source) {
  if (!source?.url) return "";
  return `<a class="disclosure-source-link management-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(source.publisher)} SAP 원문 열기">SAP 원문 ↗</a>`;
}

function managementExperienceAvailablePeriods() {
  const configured = managementExperienceData.comparisonPeriods ?? [];
  const companyPeriods = Object.values(managementExperienceData.companies ?? {})
    .flatMap((item) => Object.keys(item.periods ?? {}));
  return [...new Set([...configured, ...companyPeriods])].sort(comparePeriods);
}

function managementExperiencePeriodKey() {
  return latestAnnualPeriodAtOrBefore(
    managementExperienceAvailablePeriods(),
    annualDisclosureTargetYear(),
  );
}

function managementExperiencePeriodAvailable() {
  const periodKey = managementExperiencePeriodKey();
  return periodKey != null && managementExperienceAvailablePeriods().includes(periodKey);
}

function renderManagementExperience() {
  const grid = document.querySelector("#management-experience-grid");
  if (!grid) return;
  const currentPeriodKey = managementExperiencePeriodKey();
  const currentYear = currentPeriodKey ? parsePeriodKey(currentPeriodKey).year : annualDisclosureTargetYear();
  const priorPeriodKey = `${currentYear - 1}-ye`;
  const priorYear = currentYear - 1;
  const periodLabelElement = document.querySelector("#management-period-label");
  if (periodLabelElement) periodLabelElement.textContent = currentPeriodKey ? periodLabel(currentPeriodKey) : periodLabel(state.periodKey);
  const fullButton = document.querySelector('[data-full-metric="management"]');
  if (fullButton) fullButton.disabled = !managementExperiencePeriodAvailable();
  if (!managementExperiencePeriodAvailable()) {
    grid.innerHTML = disclosureEmptyState("예실차");
    return;
  }
  const values = companyCatalog.map((catalog) => ({ catalog, item: managementExperienceData.companies?.[catalog.key] }));
  const valuesByCompany = Object.fromEntries(values.map((entry) => [entry.catalog.key, entry.item]));
  const metricDefinitions = [
    ["보험금 예실차", "claim", "예실차 ÷ 예상보험금"],
    ["사업비 예실차", "expense", "예실차 ÷ 예상사업비"],
  ];
  const maxAbsByMetric = Object.fromEntries(metricDefinitions.map(([, key]) => [
    key,
    Math.max(...values.map(({ item }) => Math.abs(item?.periods?.[currentPeriodKey]?.ratios?.[key] ?? 0)), 1),
  ]));
  grid.innerHTML = renderSectorCardGroups((catalog) => {
    const item = valuesByCompany[catalog.key];
    if (!item?.periods?.[currentPeriodKey]) return `<article class="claim-summary-card management-claim-card is-empty"><strong>${escapeHtml(catalog.name)}</strong><span>${currentYear}년말 데이터 없음</span></article>`;
    const prior = item.periods?.[priorPeriodKey];
    const current = item.periods?.[currentPeriodKey];
    const metricRows = metricDefinitions.map(([label, key, description]) => {
      const priorValue = prior?.ratios?.[key];
      const currentValue = current?.ratios?.[key];
      const currentDirection = managementDirection(currentValue);
      const priorDirection = managementDirection(priorValue);
      const extent = Math.min(Math.abs(currentValue ?? 0) / maxAbsByMetric[key] * 48, 48);
      const status = currentValue == null ? "예상금액 분모 미공개" : currentValue < 0 ? "비우호적 경험차" : "우호적 경험차";
      return `<section class="management-claim-metric">
        <div class="management-claim-metric-head"><strong>${label}</strong><small>${description}</small></div>
        <div class="claim-period-values" aria-label="${escapeHtml(catalog.name)} ${label} 전기·당기 비율">
          <div class="claim-prior-value"><span>전기 ${priorYear}</span><strong class="${priorDirection}">${formatManagementRatio(priorValue)}</strong></div>
          <div class="claim-current-value"><span>당기 ${currentYear}</span><strong class="${currentDirection}">${formatManagementRatio(currentValue)}</strong></div>
        </div>
        <div class="claim-diverging" aria-label="${escapeHtml(catalog.name)} ${label} ${formatManagementRatio(currentValue)}"><i class="${currentDirection}" style="--claim-extent:${extent}%"></i></div>
        <small class="management-claim-status">${status}</small>
      </section>`;
    }).join("");
    const currentSource = current?.source ?? prior?.source;
    return `<article class="claim-summary-card management-claim-card ${state.companyKey === catalog.key ? "is-selected" : ""}">
      <div class="claim-summary-head"><strong>${escapeHtml(catalog.name)}</strong><span class="verification-badge ${item.verificationStatus === "official_component_recalculated" ? "is-recalculated" : ""}">${escapeHtml(item.verificationLabel)}</span></div>
      <div class="management-claim-ratio-list">${metricRows}</div>
      <div class="claim-summary-foot management-claim-foot"><small>${escapeHtml(currentSource?.location)}</small>${managementSourceLink(currentSource)}</div>
    </article>`;
  }, "management-sector-grid");
}

function renderPublicClaimExperience() {
  const grid = document.querySelector("#claim-summary-grid");
  const periodKey = assumptionPeriodKey();
  const year = assumptionYear();
  const priorYear = year - 1;
  document.querySelector("#claim-period-label").textContent = periodKey ? periodLabel(periodKey) : periodLabel(state.periodKey);
  const fullButton = document.querySelector('[data-full-metric="claim"]');
  fullButton.disabled = !assumptionPeriodAvailable();
  if (!assumptionPeriodAvailable()) {
    grid.innerHTML = disclosureEmptyState("보험금 예실차 비율");
    return;
  }
  const values = companyCatalog.map((catalog) => ({
    catalog,
    item: assumptionData.companies?.[catalog.key]?.claimExperience,
    value: assumptionData.companies?.[catalog.key]?.claimExperience?.values?.[String(year)]?.variance,
    priorValue: assumptionData.companies?.[catalog.key]?.claimExperience?.values?.[String(priorYear)]?.variance,
  }));
  const maxAbs = Math.max(...values.map(({ value }) => Math.abs(value ?? 0)), 1);
  const valuesByCompany = Object.fromEntries(values.map((entry) => [entry.catalog.key, entry]));
  grid.innerHTML = renderSectorCardGroups((catalog) => {
      const { item, value, priorValue } = valuesByCompany[catalog.key];
      const extent = Math.min(Math.abs(value ?? 0) / maxAbs * 48, 48);
      const direction = value < 0 ? "negative" : "positive";
      const priorDirection = priorValue == null ? "neutral" : priorValue < 0 ? "negative" : "positive";
      return `<article class="claim-summary-card ${state.companyKey === catalog.key ? "is-selected" : ""}">
        <div class="claim-summary-head"><strong>${escapeHtml(catalog.name)}</strong></div>
        <div class="claim-period-values">
          <div class="claim-prior-value"><span>전기 ${priorYear}</span><strong class="${priorDirection}">${formatDashboardPercent(priorValue, 1)}</strong></div>
          <div class="claim-current-value"><span>당기 ${year}</span><strong class="${direction}">${formatDashboardPercent(value, 1)}</strong></div>
        </div>
        <div class="claim-diverging" aria-label="${escapeHtml(catalog.name)} 예실차 ${formatDisclosureNumber(value, true)}"><i class="${direction}" style="--claim-extent:${extent}%"></i></div>
        <div class="claim-summary-foot"><small>${value < 0 ? "실제손해율이 예상 상회" : "예상손해율이 실제 상회"}</small>${assumptionSourceLink(claimSourceForYear(item, year))}</div>
      </article>`;
    }, "claim-sector-grid");
}

function renderClaimExperience() {
  renderManagementExperience();
  renderPublicClaimExperience();
}

function compactDurationLabels() {
  return assumptionData.durationBuckets ?? [];
}

function sparklineGeometry(values, width = 132, height = 42, pad = 4) {
  const numeric = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = Math.max(max - min, 1);
  return values.map((value, index) => ({
    x: pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2),
    y: height - pad - ((value - min) / range) * (height - pad * 2),
    value,
  }));
}

function durationSparkline(values) {
  const points = sparklineGeometry(values);
  return `<svg viewBox="0 0 132 42" aria-hidden="true"><polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}" />${points.map(({ x, y }) => `<circle cx="${x}" cy="${y}" r="1.5" />`).join("")}</svg>`;
}

function durationPeriodItem(catalogKey, type) {
  const company = assumptionData.companies?.[catalogKey];
  const periodKey = assumptionPeriodKey();
  return type === "loss"
    ? company?.lossRatioByDuration?.periods?.[periodKey]
    : company?.expenseRatioByDuration?.periods?.[periodKey];
}

function renderDurationSummary(type) {
  const isLoss = type === "loss";
  const head = document.querySelector(isLoss ? "#loss-ratio-summary-head" : "#expense-ratio-summary-head");
  const body = document.querySelector(isLoss ? "#loss-ratio-summary-body" : "#expense-ratio-summary-body");
  const periodKey = assumptionPeriodKey();
  document.querySelector(isLoss ? "#loss-period-label" : "#expense-period-label").textContent = periodKey ? periodLabel(periodKey) : periodLabel(state.periodKey);
  document.querySelector(`[data-full-metric="${type}"]`).disabled = !assumptionPeriodAvailable();
  const labels = compactDurationLabels();
  head.innerHTML = `<tr><th class="table-sector-heading">업권</th><th class="table-company-heading">회사</th>${labels.map((label, index) => `<th class="duration-bucket duration-bucket-${index}">${escapeHtml(label)}</th>`).join("")}<th>기간별 흐름</th></tr>`;
  if (!assumptionPeriodAvailable()) {
    body.innerHTML = `<tr><td colspan="${labels.length + 3}">${disclosureEmptyState(isLoss ? "경과기간별 손해율" : "경과기간별 유지비율")}</td></tr>`;
    return;
  }
  body.innerHTML = companyCatalog
    .map((catalog) => {
      const item = durationPeriodItem(catalog.key, type);
      const values = item?.ratio?.duration ?? [];
      const isSectorStart = companiesInSector(catalog.sector)[0].key === catalog.key;
      return `<tr class="${state.companyKey === catalog.key ? "is-selected" : ""} ${isSectorStart ? "sector-start" : ""}">
        ${isSectorStart ? `<th class="sector-group-cell sector-${sectorMetaForCompany(catalog).key}" scope="rowgroup" rowspan="${companiesInSector(catalog.sector).length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}
        <th class="table-company-cell duration-company-cell"><strong>${escapeHtml(catalog.name)}</strong></th>
        ${values.map((value, index) => `<td class="duration-bucket duration-bucket-${index}">${formatDashboardPercent(value, 0)}</td>`).join("")}
        <td><button type="button" class="duration-spark-button" data-duration-chart="${type}" data-company-key="${catalog.key}" aria-label="${escapeHtml(catalog.name)} 기간별 상세 그래프">${durationSparkline(values)}<span>상세 ↗</span></button></td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll(`[data-duration-chart="${type}"]`).forEach((button) => {
    button.addEventListener("click", () => openDurationChart(type, button.dataset.companyKey));
  });
}

function fullDurationTable(type) {
  const isLoss = type === "loss";
  const definitions = isLoss
    ? [["예상보험금", "expectedClaims"], ["위험보험료", "riskPremium"], ["비율", "ratio"]]
    : [["예상유지비", "expectedExpense"], ["예정유지비", "expectedMaintenanceExpense"], ["비율", "ratio"]];
  const rows = companyCatalog.flatMap((catalog) => {
    const item = durationPeriodItem(catalog.key, type);
    const isSectorStart = companiesInSector(catalog.sector)[0].key === catalog.key;
    return definitions.map(([label, key], index) => {
      const metric = item?.[key];
      const isRatio = key === "ratio";
      return `<tr class="${index === 0 && isSectorStart ? "sector-start" : ""}">${index === 0 && isSectorStart ? `<th class="modal-sector-cell sector-${sectorMetaForCompany(catalog).key}" rowspan="${companiesInSector(catalog.sector).length * definitions.length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}${index ? "" : `<th class="modal-company-cell" rowspan="3"><strong>${escapeHtml(catalog.name)}</strong>${assumptionSourceLink(item?.sourceReference)}</th>`}<th class="modal-metric-cell">${label}</th>${(metric?.duration ?? []).map((value, bucketIndex) => `<td class="duration-bucket duration-bucket-${bucketIndex}">${formatDisclosureNumber(value, isRatio)}</td>`).join("")}<td class="modal-current-value">${formatDisclosureNumber(metric?.presentValue, isRatio)}</td></tr>`;
    });
  }).join("");
  return `<div class="disclosure-table-wrap modal-disclosure-table-wrap"><table class="disclosure-table duration-table"><caption class="table-unit-caption">표시 단위 · 금액: 억원 · 비율: % · 좌우로 이동해 전체 경과구간 확인</caption><thead><tr><th class="modal-sector-cell">업권</th><th class="modal-company-cell">회사</th><th class="modal-metric-cell">구분</th>${(assumptionData.durationBuckets ?? []).map((bucket, index) => `<th class="duration-bucket duration-bucket-${index}">${escapeHtml(bucket)}</th>`).join("")}<th class="modal-current-value">현재가치</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function managementComponentValue(period, key) {
  const components = period?.components ?? {};
  if (key === "actualClaims") {
    if (components.incurredClaims == null || components.incurredClaimAdjustment == null) return null;
    return components.incurredClaims + components.incurredClaimAdjustment;
  }
  return components[key] ?? null;
}

function formatManagementTableValue(value, kind, isChange = false) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const rounded = Number(number.toFixed(1));
  const sign = isChange && rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  const suffix = kind === "ratio" ? (isChange ? "%p" : "%") : "";
  return `${sign}${Math.abs(rounded).toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}${suffix}`;
}

function fullManagementExperienceTable() {
  const currentPeriodKey = managementExperiencePeriodKey();
  if (!currentPeriodKey) return "";
  const currentYear = parsePeriodKey(currentPeriodKey).year;
  const priorPeriodKey = `${currentYear - 1}-ye`;
  const priorYear = currentYear - 1;
  const definitions = [
    { label: "보험금 예실차", kind: "amount", group: "claim", value: (period) => period?.claimExperience },
    { label: "보험금 예실차비율", kind: "ratio", group: "claim", value: (period) => period?.ratios?.claim },
    { label: "예상보험금", kind: "amount", group: "claim", value: (period) => managementComponentValue(period, "expectedClaims") },
    { label: "실제보험금", kind: "amount", group: "claim", value: (period) => managementComponentValue(period, "actualClaims") },
    { label: "발생보험금", kind: "amount", group: "claim-detail", value: (period) => managementComponentValue(period, "incurredClaims") },
    { label: "발생사고요소조정", kind: "amount", group: "claim-detail", value: (period) => managementComponentValue(period, "incurredClaimAdjustment") },
    { label: "사업비 예실차", kind: "amount", group: "expense", value: (period) => period?.expenseExperience },
    { label: "사업비 예실차비율", kind: "ratio", group: "expense", value: (period) => period?.ratios?.expense },
    { label: "예상사업비", kind: "amount", group: "expense", value: (period) => managementComponentValue(period, "expectedExpenseTotal") },
    { label: "실제사업비", kind: "amount", group: "expense", value: (period) => managementComponentValue(period, "actualExpenseTotal") },
  ];
  const rows = companyCatalog.flatMap((catalog) => {
    const item = managementExperienceData.companies?.[catalog.key];
    const prior = item?.periods?.[priorPeriodKey];
    const current = item?.periods?.[currentPeriodKey];
    const isSectorStart = companiesInSector(catalog.sector)[0].key === catalog.key;
    return definitions.map((definition, index) => {
      const priorValue = definition.value(prior);
      const currentValue = definition.value(current);
      const change = priorValue == null || currentValue == null ? null : currentValue - priorValue;
      const directionClass = definition.kind === "ratio" || definition.label.includes("예실차") ? managementDirection(currentValue) : "";
      return `<tr class="management-full-row group-${definition.group} ${index === 0 && isSectorStart ? "sector-start" : ""}">
        ${index === 0 && isSectorStart ? `<th class="modal-sector-cell sector-${sectorMetaForCompany(catalog).key}" rowspan="${companiesInSector(catalog.sector).length * definitions.length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}
        ${index === 0 ? `<th class="modal-company-cell" rowspan="${definitions.length}"><strong>${escapeHtml(catalog.name)}</strong><span>${escapeHtml(item?.verificationLabel)}</span>${managementSourceLink(current?.source ?? prior?.source)}</th>` : ""}
        <th class="modal-metric-cell">${definition.label}</th>
        <td class="${directionClass}">${formatManagementTableValue(priorValue, definition.kind)}</td>
        <td class="${directionClass}">${formatManagementTableValue(currentValue, definition.kind)}</td>
        <td class="${managementDirection(change)}">${formatManagementTableValue(change, definition.kind, true)}</td>
      </tr>`;
    });
  }).join("");
  const coverageNotes = companyCatalog.flatMap((catalog) => {
    const periods = managementExperienceData.companies?.[catalog.key]?.periods ?? {};
    const note = periods[currentPeriodKey]?.coverageNote ?? periods[priorPeriodKey]?.coverageNote;
    return note ? [`<li><strong>${escapeHtml(catalog.name)}</strong><span>${escapeHtml(note)}</span></li>`] : [];
  }).join("");
  return `<div class="disclosure-table-wrap management-full-table-wrap">
    <table class="disclosure-table management-full-table">
      <caption class="table-unit-caption">금액: 억원 · 비율: % · 전년비: 금액 증감 또는 %p</caption>
      <thead><tr><th class="modal-sector-cell">업권</th><th class="modal-company-cell">회사</th><th class="modal-metric-cell">구분</th><th>${priorYear}년 전기</th><th>${currentYear}년 당기</th><th>전년비</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>${coverageNotes ? `<ul class="management-modal-notes">${coverageNotes}</ul>` : ""}`;
}

const assumptionExportMeta = {
  management: { filename: "5퍼센트관리_예실차", sheetName: "5% 관리 예실차" },
  liability: { filename: "보험부채_변동내역", sheetName: "보험부채 변동내역" },
  claim: { filename: "보험금_예실차", sheetName: "보험금 예실차" },
  loss: { filename: "경과기간_손해율", sheetName: "경과기간 손해율" },
  expense: { filename: "경과기간_유지비율", sheetName: "경과기간 유지비율" },
};

function assumptionExportPeriodToken(type) {
  if (type === "management") {
    const periodKey = managementExperiencePeriodKey();
    if (!periodKey) return "latest";
    const year = parsePeriodKey(periodKey).year;
    return `${year - 1}-${year}`;
  }
  const periodKey = type === "liability" ? liabilityAvailablePeriodKey() : assumptionPeriodKey();
  if (!periodKey) return "latest";
  const year = parsePeriodKey(periodKey).year;
  if (type === "liability" && liabilityAssumptionData.availablePeriods?.includes(`${year - 1}-ye`)) {
    return `${year - 1}-${year}`;
  }
  return String(year);
}

function prepareAssumptionDownload(type) {
  activeAssumptionTableType = type;
  assumptionTableDownload.disabled = false;
  assumptionTableDownload.innerHTML = '<span aria-hidden="true">↓</span> Excel 다운로드';
}

function downloadAssumptionTable() {
  const type = activeAssumptionTableType;
  const meta = assumptionExportMeta[type];
  const table = document.querySelector("#assumption-table-modal-content table");
  if (!type || !meta || !table || !window.CSM_XLSX_EXPORT) return;
  const originalMarkup = assumptionTableDownload.innerHTML;
  assumptionTableDownload.disabled = true;
  try {
    const result = window.CSM_XLSX_EXPORT.downloadTable({
      table,
      filename: `CSM_Lens_${meta.filename}_${assumptionExportPeriodToken(type)}.xlsx`,
      sheetName: meta.sheetName,
    });
    window.CSM_LAST_EXPORT = { ...result, type };
    assumptionTableDownload.innerHTML = '<span aria-hidden="true">✓</span> 생성 완료';
  } catch (error) {
    console.error("Excel export failed", error);
    assumptionTableDownload.innerHTML = '<span aria-hidden="true">!</span> 생성 실패';
  }
  setTimeout(() => {
    assumptionTableDownload.innerHTML = originalMarkup;
    assumptionTableDownload.disabled = false;
  }, 1600);
}

function openAssumptionTable(type) {
  if (type === "management") {
    const periodKey = managementExperiencePeriodKey();
    if (!periodKey) return;
    const year = parsePeriodKey(periodKey).year;
    document.querySelector("#assumption-table-modal-title").textContent = "예실차 전체보기 · 5% 관리 대상";
    document.querySelector("#assumption-table-modal-subtitle").textContent = `회사 공식 별도 SAP · ${year - 1}년 전기 / ${year}년 당기 / 전년비 · 금액과 비율`;
    document.querySelector("#assumption-table-modal-content").innerHTML = fullManagementExperienceTable();
    prepareAssumptionDownload(type);
    assumptionTableModal.showModal();
    return;
  }
  if (type === "liability") {
    const periodKey = liabilityAvailablePeriodKey();
    if (!periodKey) return;
    const year = parsePeriodKey(periodKey).year;
    const hasPrior = liabilityAssumptionData.availablePeriods?.includes(`${year - 1}-ye`);
    document.querySelector("#assumption-table-modal-title").textContent = "보험부채 변동내역 전체보기";
    document.querySelector("#assumption-table-modal-subtitle").textContent = `Open DART ${hasPrior ? `${year - 1}·` : ""}${year} 사업보고서 재무제표 주석 · 회사계/발행한 보험계약 · 금액 조원`;
    document.querySelector("#assumption-table-modal-content").innerHTML = fullLiabilityAssumptionTable();
    prepareAssumptionDownload(type);
    assumptionTableModal.showModal();
    return;
  }
  if (!assumptionPeriodAvailable()) return;
  const periodKey = assumptionPeriodKey();
  const year = assumptionYear();
  const titles = { claim: "보험금 예실차 전체보기", loss: "경과기간별 손해율 전체보기", expense: "경과기간별 유지비율 전체보기" };
  document.querySelector("#assumption-table-modal-title").textContent = titles[type];
  const unitLabel = type === "claim" ? "비율: %" : "금액: 억원 · 비율: %";
  document.querySelector("#assumption-table-modal-subtitle").textContent = `${periodLabel(periodKey)} · Open DART 연결재무제표 주석 · ${unitLabel}`;
  if (type === "claim") {
    const priorYear = year - 1;
    const definitions = [["예상손해율", "expectedLossRatio"], ["실제손해율", "actualLossRatio"], ["예실차비율", "variance"]];
    const rows = companyCatalog.flatMap((catalog) => {
      const item = assumptionData.companies?.[catalog.key]?.claimExperience;
      const isSectorStart = companiesInSector(catalog.sector)[0].key === catalog.key;
      return definitions.map(([label, key], index) => `<tr class="${index === 0 && isSectorStart ? "sector-start" : ""}">${index === 0 && isSectorStart ? `<th class="modal-sector-cell sector-${sectorMetaForCompany(catalog).key}" rowspan="${companiesInSector(catalog.sector).length * definitions.length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}${index ? "" : `<th class="modal-company-cell" rowspan="3"><strong>${escapeHtml(catalog.name)}</strong>${assumptionSourceLink(claimSourceForYear(item, year))}</th>`}<th class="modal-metric-cell">${label}</th><td class="${key === "variance" ? "ratio-cell" : ""}">${formatDisclosureNumber(item?.values?.[String(priorYear)]?.[key], true)}</td><td class="${key === "variance" ? "ratio-cell" : ""}">${formatDisclosureNumber(item?.values?.[String(year)]?.[key], true)}</td></tr>`);
    }).join("");
    document.querySelector("#assumption-table-modal-content").innerHTML = `<div class="disclosure-table-wrap modal-claim-table-wrap"><table class="disclosure-table"><thead><tr><th class="modal-sector-cell">업권</th><th class="modal-company-cell">회사</th><th class="modal-metric-cell">구분</th><th>${priorYear}년 전기</th><th>${year}년 당기</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    document.querySelector("#assumption-table-modal-content").innerHTML = fullDurationTable(type);
  }
  prepareAssumptionDownload(type);
  assumptionTableModal.showModal();
}

function detailedDurationChart(values) {
  const compact = window.innerWidth <= 580;
  const medium = !compact && window.innerWidth <= 820;
  const width = compact ? 360 : medium ? 720 : 940;
  const height = compact ? 240 : medium ? 300 : 330;
  const pad = compact ? 24 : medium ? 30 : 32;
  const points = sparklineGeometry(values, width, height, pad);
  const gridLines = [0.25, 0.5, 0.75]
    .map((ratio) => {
      const y = Math.round(height * ratio);
      return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}"/>`;
    })
    .join("");
  return `<div class="duration-detail-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="경과기간별 비율 상세 그래프"><g class="duration-detail-grid">${gridLines}</g><polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}"/>${points.map(({ x, y, value }, index) => `<circle cx="${x}" cy="${y}" r="4"/><text class="duration-point-value duration-point-value-${index}" x="${x}" y="${Math.max(y - 12, 16)}">${formatDisclosureNumber(value, true)}</text><text class="axis-label duration-axis-label duration-axis-label-${index}" x="${x}" y="${height - 6}">${escapeHtml(assumptionData.durationBuckets[index])}</text>`).join("")}</svg></div>`;
}

function openDurationChart(type, companyKey) {
  const catalog = companyCatalog.find((company) => company.key === companyKey);
  const item = durationPeriodItem(companyKey, type);
  if (!catalog || !item) return;
  const periodKey = assumptionPeriodKey();
  document.querySelector("#assumption-chart-modal-title").textContent = `${catalog.name} ${type === "loss" ? "손해율" : "유지비율"} 흐름`;
  document.querySelector("#assumption-chart-modal-subtitle").textContent = `${periodLabel(periodKey)} · 경과기간별 비율`;
  document.querySelector("#assumption-chart-modal-content").innerHTML = `${detailedDurationChart(item.ratio.duration)}<div class="duration-chart-meta"><span>현재가치 비율</span><strong>${formatDisclosureNumber(item.ratio.presentValue, true)}</strong>${assumptionSourceLink(item.sourceReference)}</div>`;
  assumptionChartModal.showModal();
}

function renderAssumptionMetrics() {
  renderLiabilityAssumption();
  renderClaimExperience();
  renderDurationSummary("loss");
  renderDurationSummary("expense");
  syncDurationMetricView();
}

function syncDurationMetricView() {
  durationMetricButtons.forEach((button) => {
    const isActive = button.dataset.durationMetric === state.durationMetric;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-duration-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.durationPanel !== state.durationMetric;
  });
}

function qualityStatus(status) {
  const labels = {
    matched: ["일치", "passed"],
    validated: ["검증", "passed"],
    arithmetic_validated: ["산식 일치", "passed"],
    basis_difference: ["기준 차이", "warning"],
    mismatch: ["불일치", "failed"],
  };
  return labels[status] ?? ["검토 전", "calculated"];
}

function formatQualityValue(value) {
  if (value == null) return "—";
  if (typeof value === "object") {
    const labels = {
      opening: "기시",
      newbiz: "신계약",
      interest: "이자",
      adjustment: "조정",
      amortization: "상각",
      closing: "기말",
    };
    return Object.entries(value)
      .map(([key, item]) => `${labels[key] ?? key} ${Number(item).toLocaleString("ko-KR")}`)
      .join(" · ");
  }
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function renderAuditItem({
  label,
  original,
  check,
  status,
  source,
  basis,
  note,
  table,
  link,
  sourcePage,
}) {
  const [statusLabel, statusClass] = qualityStatus(status);
  const isSolvencyRatio = label.includes("K-ICS") || label.includes("RBC");
  const displayAuditValue = (value) =>
    isSolvencyRatio && Number.isFinite(Number(value))
      ? formatPercent(Number(value), 0)
      : formatQualityValue(value);
  return `
    <article class="quality-audit-card">
      <div class="quality-audit-card-head">
        <strong>${escapeHtml(label)}</strong>
        <span class="quality-result ${statusClass}">${statusLabel}</span>
      </div>
      <dl>
        <div><dt>DART 원본</dt><dd>${escapeHtml(displayAuditValue(original))}</dd></div>
        <div><dt>검증값</dt><dd>${escapeHtml(displayAuditValue(check))}</dd></div>
        <div><dt>검증 소스</dt><dd>${
          link
            ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(source || "공식 원문")} ↗</a>`
            : escapeHtml(source || "외부 검증 미연결")
        }${table ? ` <code>${escapeHtml(table)}</code>` : ""}</dd></div>
      </dl>
      <p>${escapeHtml(basis || note || "DART 원문 내부 산식만 검산")}</p>
      ${sourcePage ? `<small>원문 위치 · ${escapeHtml(sourcePage)}</small>` : ""}
      ${basis && note ? `<small>${escapeHtml(note)}</small>` : ""}
    </article>
  `;
}

function signedAuditDifference(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "비교값 없음";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric).toLocaleString("ko-KR", {
    maximumFractionDigits: 3,
  })}십억원`;
}

function renderProcessingLineage(context) {
  const period = context.period;
  const source = period.sourceReference ?? {};
  const audit = period.quarterlyAudit;
  const selection = source.movementSelectionAudit ?? {};
  const financial = audit?.financialValidation ?? {};
  const insuranceDifference =
    financial.dartInsuranceProfitCumulative != null &&
    financial.fisisInsuranceProfitCumulative != null
      ? financial.dartInsuranceProfitCumulative - financial.fisisInsuranceProfitCumulative
      : null;
  const steps = audit
    ? [
        {
          number: "01",
          title: "원본 선택",
          text: `${source.reportName} · 표 ${source.sourceTables?.map((table) => `#${table}`).join(" · ") || "—"}. 정정공시는 CSM 본문 포함 여부를 확인하고 원공시까지 순차 탐색.`,
        },
        {
          number: "02",
          title: "CSM 파싱",
          text: `별도 발행보험계약·출재 재보험 제외. 공시 기초 ${formatWon(selection.disclosedOpening)} · 직전 연말 ${formatWon(selection.openingAnchor)}를 대사해 현재 표를 선택. 차이 ${signedAuditDifference(selection.openingDifference)}.`,
        },
        {
          number: "03",
          title: "분기 단독 환산",
          text: `잔액은 분기말 시점값. ${audit.quarter === 1 ? "Q1 누적값을 당분기로 사용" : audit.quarter === 4 ? "연간 누적에서 Q3 누적 차감" : `Q${audit.quarter} 누적에서 직전 누적 차감`}. 저장 단위는 십억원.`,
        },
        {
          number: "04",
          title: "검증·판정",
          text: `Movement 산식 차이 ${signedAuditDifference(audit.movementIdentityDifference)} · DART 누적 차감/당 3개월 보험손익 차이 ${signedAuditDifference(financial.insuranceProfitStandaloneDifference)} · 지배주주 순이익 차이 ${signedAuditDifference(financial.parentNetIncomeStandaloneDifference)}. FISIS 누적 보험손익 차이 ${signedAuditDifference(insuranceDifference)}.`,
        },
      ]
    : [
        {
          number: "01",
          title: "원본 선택",
          text: `${source.reportName} · 별도재무제표 보험계약 주석 표 ${source.sourceTables?.map((table) => `#${table}`).join(" · ") || "—"}.`,
        },
        {
          number: "02",
          title: "CSM 파싱",
          text: "발행 보험계약만 포함하고 출재 재보험을 제외. 상품군·측정모형별 분리 표는 합산.",
        },
        {
          number: "03",
          title: "단위·기간 환산",
          text: "원문 단위를 십억원으로 통일하고 연도말 잔액과 연간 누적 Movement를 저장.",
        },
        {
          number: "04",
          title: "검증·판정",
          text: `${period.quality || "DART 내부 산식 검산"}. 연결·별도 및 표시단위 차이는 별도 기록.`,
        },
      ];
  return steps
    .map(
      (step) => `<article><span>${step.number}</span><div><strong>${step.title}</strong><p>${escapeHtml(step.text)}</p></div></article>`,
    )
    .join("");
}

function renderQuality() {
  const context = getContext();
  const review = reviewSummary(state.companyKey, state.periodKey);
  const source = context.period.sourceReference;
  const validation = context.period.validation;
  const audit = context.period.quarterlyAudit;
  const cards = [
    {
      label: "원문 출처",
      value: source.sourceType || "Open DART",
      note: `접수번호 ${source.rceptNo}`,
      state: "passed",
      link: source.dartUrl,
    },
    {
      label: "CSM 기준",
      value: "별도 · 재보험 제외",
      note: `원문 표 ${source.sourceTables.join(", ")}`,
      state: "passed",
    },
    {
      label: "검산 상태",
      value: review.failed ? "실패" : review.needsReview ? "검토 필요" : "통과",
      note: `통과 ${review.passed} · 검토 ${review.needsReview} · 실패 ${review.failed}`,
      state: review.failed ? "failed" : review.needsReview ? "warning" : "passed",
    },
    {
      label: "전망 데이터",
      value: "시나리오 계산",
      note: "실제 공시값과 분리 표시",
      state: "calculated",
    },
  ];
  if (validation) {
    const checks = [validation.csm, validation.movement, validation.insuranceProfit];
    const hasMismatch = checks.some((check) => check?.status === "mismatch");
    cards.splice(2, 0, {
      label: "외부 교차검증",
      value: hasMismatch ? "차이 확인 필요" : validation.summary,
      note: `${validation.validationPriority} · CSM/무브먼트/보험손익`,
      state: hasMismatch ? "warning" : "passed",
      link: validation.csm?.sourceUrl,
    });
    cards.splice(3, 0, {
      label: "당기순이익 검증",
      value: "기준 차이 별도 표시",
      note: validation.parentNetIncome?.basis || "귀속 범위 확인 필요",
      state: "warning",
    });
  }

  document.querySelector("#quality-grid").innerHTML = cards
    .map(
      (card) => `
        <article class="quality-card">
          <span class="quality-state ${card.state}"></span>
          <div>
            <span>${card.label}</span>
            ${
              card.link
                ? `<a href="${escapeHtml(card.link)}" target="_blank" rel="noreferrer">${card.value} ↗</a>`
                : `<strong>${card.value}</strong>`
            }
            <small>${card.note}</small>
          </div>
        </article>
      `,
    )
    .join("");

  document.querySelector("#quality-method-table-body").innerHTML = qualityMethodology
    .map(
      (item) => `
        <tr>
          <th scope="row">${item.metric}</th>
          <td>${item.source}</td>
          <td>${item.validation}</td>
          <td>${item.rule}</td>
        </tr>
      `,
    )
    .join("");

  document.querySelector("#quality-method-history").innerHTML = (methodologyRegistry.records ?? [])
    .map(
      (record) => `
        <article class="quality-history-item">
          <div><time>${escapeHtml(record.effectiveDate)}</time><span>${escapeHtml(record.scope)}</span></div>
          <dl>
            <div><dt>원본</dt><dd>${escapeHtml(record.source)}</dd></div>
            <div><dt>파싱</dt><dd>${escapeHtml(record.parsing)}</dd></div>
            <div><dt>환산</dt><dd>${escapeHtml(record.conversion)}</dd></div>
            <div><dt>검증</dt><dd>${escapeHtml(record.validation)}</dd></div>
          </dl>
          <p>${escapeHtml(record.result)}</p>
        </article>`,
    )
    .join("");

  document.querySelector("#quality-audit-period").textContent =
    `${context.company.name} · ${periodLabel(state.periodKey)}`;
  document.querySelector("#quality-source-record").innerHTML = `
    <div>
      <span>원본 보고서</span>
      <a href="${escapeHtml(source.dartUrl)}" target="_blank" rel="noreferrer">
        ${escapeHtml(source.reportName)} ↗
      </a>
    </div>
    <div>
      <span>DART 접수번호</span>
      <strong>${escapeHtml(source.rceptNo)}</strong>
    </div>
    <div>
      <span>원문 표 번호</span>
      <strong>${source.sourceTables.map((table) => `#${table}`).join(" · ")}</strong>
    </div>
    <div>
      <span>수집 기준</span>
      <strong>${escapeHtml(context.period.metricBasis?.csm || "별도 · 발행 보험계약 · 출재 재보험 제외")}</strong>
    </div>
    <div>
      <span>저장 단위</span>
      <strong>십억원 (원문 단위 환산)</strong>
    </div>
    <div>
      <span>처리 기준 버전</span>
      <strong>${escapeHtml(methodologyRegistry.version || "기록 전")}</strong>
    </div>
    <div>
      <span>현재 표시 기준</span>
      <strong>${state.valueBasis === "cumulative" ? "당해연도 누적 · 기시 전년도말" : "분기 단독 · 기시 전분기말"}</strong>
    </div>
  `;
  document.querySelector("#quality-processing-record").innerHTML = renderProcessingLineage(context);

  const movement = context.period.movement;
  const movementCheck = validation?.movement?.checkValue ?? {
    ...movement,
    closing:
      movement.opening +
      movement.newbiz +
      movement.interest +
      movement.adjustment +
      movement.amortization,
  };
  const auditItems = validation
    ? [
        {
          label: "보유 CSM",
          original: context.period.csm,
          check: validation.csm?.checkValue,
          ...validation.csm,
          original: context.period.csm,
          link: validation.csm?.sourceUrl,
        },
        {
          label: "CSM Movement",
          original: movement,
          check: movementCheck,
          ...validation.movement,
          original: movement,
          check: movementCheck,
        },
        {
          label: "보험손익",
          original: context.period.insuranceProfit,
          check: validation.insuranceProfit?.checkValue,
          ...validation.insuranceProfit,
          original: context.period.insuranceProfit,
          check: validation.insuranceProfit?.checkValue,
        },
        {
          label: "당기순이익",
          original: context.period.parentNetIncome,
          check: validation.parentNetIncome?.fisisSeparateNetIncome,
          ...validation.parentNetIncome,
          original: context.period.parentNetIncome,
          check: validation.parentNetIncome?.fisisSeparateNetIncome,
        },
        {
          label: context.period.solvencyBasis || "K-ICS / RBC",
          original: context.period.kics,
          check: validation.kics?.checkValue ?? context.period.kics,
          ...validation.kics,
          original: context.period.kics,
          check: validation.kics?.checkValue ?? context.period.kics,
        },
      ]
    : audit
    ? [
        {
          label: "CSM Movement",
          original: movement,
          check: movementCheck,
          status:
            movementCheck.closing === movement.closing ? "arithmetic_validated" : "mismatch",
          source: "Open DART 별도 보험계약 주석",
          note: `누적 원문과 분기 단독 환산값을 함께 보존. 기초 대사 차이 ${signedAuditDifference(audit.openingReconciliationDifference)}.`,
        },
        ...(audit.csmValidation
          ? [
              {
                label: "보유 CSM · 공식 IR 보조검증",
                original: context.period.csm,
                check: audit.csmValidation.value,
                status: "basis_difference",
                source: audit.csmValidation.source,
                link: audit.csmValidation.sourceUrl,
                basis: audit.csmValidation.basis,
                note: audit.csmValidation.note,
              },
            ]
          : []),
        {
          label: "보험손익",
          original: context.period.insuranceProfit,
          check:
            audit.financialValidation?.dartInsuranceProfitStandaloneDisclosed ??
            audit.financialValidation?.fisisInsuranceProfitStandalone,
          status:
            audit.financialValidation?.dartInsuranceProfitStandaloneDisclosed != null
              ? audit.financialValidation?.insuranceProfitStandaloneStatus
              : audit.financialValidation?.fisisInsuranceProfitStandalone == null
                ? "not_connected"
              : Math.abs(context.period.insuranceProfit - audit.financialValidation.fisisInsuranceProfitStandalone) <= 0.1
                ? "matched"
                : "basis_difference",
          source:
            audit.financialValidation?.dartInsuranceProfitStandaloneDisclosed != null
              ? "Open DART 당 3개월 XBRL"
              : "FISIS 분기 통계",
          table:
            audit.financialValidation?.insuranceProfitAccountId ??
            (context.company.sector === "생명보험" ? "SH154/A" : "SI150/A"),
          note:
            audit.financialValidation?.dartInsuranceProfitStandaloneDisclosed != null
              ? `누적 차감 환산 ${formatQualityValue(audit.financialValidation.dartInsuranceProfitStandaloneDerived)}와 직접 공시값을 대사. 차이 ${signedAuditDifference(audit.financialValidation.insuranceProfitStandaloneDifference)}.`
              : "DART 누적값을 분기 단독으로 환산한 값과 FISIS a(분기 단독)를 비교.",
        },
        {
          label: "당기순이익",
          original: context.period.parentNetIncome,
          check:
            audit.financialValidation?.dartParentNetIncomeStandaloneDisclosed ??
            audit.financialValidation?.fisisSeparateNetIncomeStandalone,
          status:
            audit.financialValidation?.dartParentNetIncomeStandaloneDisclosed != null
              ? audit.financialValidation?.parentNetIncomeStandaloneStatus
              : context.period.metricBasis?.parentNetIncome?.startsWith("별도")
                ? "matched"
                : "basis_difference",
          source:
            audit.financialValidation?.dartParentNetIncomeStandaloneDisclosed != null
              ? "Open DART 당 3개월 연결 XBRL"
              : "FISIS 분기 통계",
          table:
            audit.financialValidation?.parentNetIncomeAccountId ??
            (context.company.sector === "생명보험" ? "SH154/G" : "SI150/G"),
          note:
            audit.financialValidation?.dartParentNetIncomeStandaloneDisclosed != null
              ? `누적 차감 환산 ${formatQualityValue(audit.financialValidation.dartParentNetIncomeStandaloneDerived)}와 직접 공시값을 대사. 차이 ${signedAuditDifference(audit.financialValidation.parentNetIncomeStandaloneDifference)}. ${context.period.metricBasis?.parentNetIncome}`
              : context.period.metricBasis?.parentNetIncome,
        },
      ]
    : [
        {
          label: "CSM Movement",
          original: movement,
          check: movementCheck,
          status:
            movementCheck.closing === movement.closing ? "arithmetic_validated" : "mismatch",
          source: "Open DART 별도 보험계약 주석",
          note: "외부 FISIS·IR 교차검증 메타데이터는 아직 연결되지 않았습니다.",
        },
      ];
  document.querySelector("#quality-audit-grid").innerHTML = auditItems
    .map(renderAuditItem)
    .join("");
}

function renderDashboard() {
  renderHeader();
  renderIndustryBoard();
  renderComparisonTable();
  renderForecast();
  renderMovement();
  renderAssumptionMetrics();
  renderQuality();
}

function bindNavigation() {
  const links = [...document.querySelectorAll("[data-section-link]")];
  const sections = [...document.querySelectorAll("[data-page-section]")];
  const primaryNav = document.querySelector(".primary-nav");
  const validSectionIds = new Set(sections.map((section) => section.id));
  const sectionFromHash = () => {
    const sectionId = window.location.hash.slice(1);
    return validSectionIds.has(sectionId) ? sectionId : "market";
  };
  const setActiveSection = (sectionId, { resetScroll = false } = {}) => {
    const resolvedSectionId = validSectionIds.has(sectionId) ? sectionId : "market";
    links.forEach((link) => {
      const isActive = link.dataset.sectionLink === resolvedSectionId;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
        if (window.matchMedia("(max-width: 820px)").matches) {
          requestAnimationFrame(() => link.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }));
        }
      } else {
        link.removeAttribute("aria-current");
      }
    });
    sections.forEach((section) => {
      const isActive = section.id === resolvedSectionId;
      section.hidden = !isActive;
      section.classList.toggle("is-active", isActive);
    });
    if (resetScroll) window.scrollTo({ top: 0, behavior: "auto" });
  };

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const sectionId = link.dataset.sectionLink;
      if (window.location.hash !== `#${sectionId}`) {
        window.history.pushState({ sectionId }, "", `#${sectionId}`);
      }
      setActiveSection(sectionId, { resetScroll: true });
    });
  });

  document.querySelectorAll("[data-nav-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      primaryNav?.scrollBy({
        left: Number(button.dataset.navScroll) * Math.max(primaryNav.clientWidth * 0.72, 180),
        behavior: "smooth",
      });
    });
  });

  window.addEventListener("popstate", () => setActiveSection(sectionFromHash(), { resetScroll: true }));
  window.addEventListener("hashchange", () => setActiveSection(sectionFromHash(), { resetScroll: true }));
  setActiveSection(sectionFromHash());
}

periodSelect.addEventListener("change", () => {
  state.periodKey = periodSelect.value;
  renderDashboard();
});

trendModalClose.addEventListener("click", () => trendModal.close());
trendModal.addEventListener("click", (event) => {
  if (event.target === trendModal) trendModal.close();
});
movementModalClose.addEventListener("click", () => movementModal.close());
movementModal.addEventListener("click", (event) => {
  if (event.target === movementModal) movementModal.close();
});
assumptionTableModalClose.addEventListener("click", () => assumptionTableModal.close());
assumptionTableDownload.addEventListener("click", downloadAssumptionTable);
assumptionTableModal.addEventListener("click", (event) => {
  if (event.target === assumptionTableModal) assumptionTableModal.close();
});
assumptionChartModalClose.addEventListener("click", () => assumptionChartModal.close());
assumptionChartModal.addEventListener("click", (event) => {
  if (event.target === assumptionChartModal) assumptionChartModal.close();
});
document.querySelectorAll("[data-full-metric]").forEach((button) => {
  button.addEventListener("click", () => openAssumptionTable(button.dataset.fullMetric));
});

metricTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.marketMetric = button.dataset.marketMetric;
    metricTabs.forEach((tab) => tab.classList.toggle("is-active", tab === button));
    renderIndustryBoard();
  });
});

basisButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.valueBasis = button.dataset.valueBasis;
    renderDashboard();
  });
});

durationMetricButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.durationMetric = button.dataset.durationMetric;
    syncDurationMetricView();
  });
});

peerTrendScenarioButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.peerTrendScenario = button.dataset.peerTrendScenario;
    state.peerTrendCompanyKey = null;
    renderPeerTrendChart();
  });
});

peerTrendReset?.addEventListener("click", () => {
  state.peerTrendCompanyKey = null;
  renderPeerTrendChart();
});

document.addEventListener("click", (event) => {
  if (!state.peerTrendCompanyKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-peer-select], [data-peer-trend-scenario], #peer-trend-reset")) return;
  if (target.closest("a, button, input, select, textarea, summary, [role=button]")) return;
  state.peerTrendCompanyKey = null;
  renderPeerTrendChart();
});

initializeControls();
bindNavigation();
renderDashboard();
