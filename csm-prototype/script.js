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
const trendModal = document.querySelector("#trend-modal");
const trendModalClose = document.querySelector("#trend-modal-close");
const movementModal = document.querySelector("#movement-modal");
const movementModalClose = document.querySelector("#movement-modal-close");
const assumptionTableModal = document.querySelector("#assumption-table-modal");
const assumptionTableModalClose = document.querySelector("#assumption-table-modal-close");
const assumptionChartModal = document.querySelector("#assumption-chart-modal");
const assumptionChartModalClose = document.querySelector("#assumption-chart-modal-close");

const state = {
  companyKey: Object.keys(companies)[0],
  periodKey: null,
  marketMetric: "csm",
  valueBasis: "cumulative",
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
    description: "신계약과 CSM 조정을 Base 대비 각각 20% 악화한 일관된 하방 시나리오",
    newbizFactor: 0.8,
    interestRate: 0.01,
    adjustmentRate: -0.012,
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
  return kind === "ye" ? `${String(year).slice(2)}.YE` : `${String(year).slice(2)}.${quarter}Q`;
}

function trendPeriodLabel(periodKey) {
  const { year, quarter, kind } = parsePeriodKey(periodKey);
  return kind === "ye" || quarter === 4
    ? `${String(year).slice(2)}.YE`
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
  return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric / 1000).toFixed(digits)}조`;
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
  return ["newbiz", "insurance"].includes(metricKey)
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
    ? "신계약 CSM·보험손익·당기순이익은 당해연도 누적으로 비교합니다."
    : "신계약 CSM·보험손익·당기순이익은 해당 분기 단독값으로 비교합니다.";
  document.querySelector("#comparison-newbiz-heading").textContent = `신계약 CSM (${basisLabel()})`;
  document.querySelector("#comparison-insurance-heading").textContent = `보험손익 (${basisLabel()})`;
  document.querySelector("#comparison-net-income-heading").textContent = `당기순이익 (${basisLabel()})`;
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
          <td>${row.financial?.insuranceProfit != null ? formatWon(row.financial.insuranceProfit) : "—"}</td>
          <td>${row.financial?.netIncome != null ? formatWon(row.financial.netIncome) : "—"}</td>
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
  const term = { 2026: "1년 전망", 2027: "2년 전망", 2028: "3년 전망", 2030: "5년 전망", 2035: "10년 전망" }[year] ?? "전망";
  return { term, year: `${String(year).slice(2)} YE` };
}

function forecastHorizonSeries(projection, scenarioKey) {
  const horizon = projection.forecastMeta?.horizon;
  const nearTerm = horizon?.[scenarioKey] ?? [
    { period: projection.forecastMeta?.targetPeriod ?? "2026-ye", closing: projection.closing },
  ];
  const terminal = horizon?.terminal?.[scenarioKey];
  return terminal ? [...nearTerm, terminal] : nearTerm;
}

function renderForecast() {
  const grid = document.querySelector("#trend-grid");
  document.querySelector("#forecast-basis-label").textContent = "1~3Y · 5Y · 10Y";

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
      const chartValues = [...history, ...baseSeries.map((item) => item.closing), ...worstSeries.map((item) => item.closing)];
      const min = Math.min(...chartValues) * 0.97;
      const max = Math.max(...chartValues) * 1.03;
      const range = Math.max(1, max - min);
      const toMiniY = (value) => 88 - ((value - min) / range) * 70;
      const actualX = history.map((_, index) =>
        history.length === 1 ? 6 : 6 + (index * 34) / (history.length - 1),
      );
      const forecastX = baseSeries.map((_, index) =>
        baseSeries.length === 1 ? 94 : 50 + (index * 46) / (baseSeries.length - 1),
      );
      const actualPoints = history
        .map((value, index) => `${actualX[index]},${toMiniY(value)}`)
        .join(" ");
      const lastX = actualX.at(-1);
      const lastValue = history.at(-1);
      const basePoints = `${lastX},${toMiniY(lastValue)} ${baseSeries.map((item, index) => `${forecastX[index]},${toMiniY(item.closing)}`).join(" ")}`;
      const worstPoints = `${lastX},${toMiniY(lastValue)} ${worstSeries.map((item, index) => `${forecastX[index]},${toMiniY(item.closing)}`).join(" ")}`;
      const terminalBase = baseSeries.at(-1);
      const terminalWorst = worstSeries.at(-1);
      const terminalX = forecastX.at(-1);

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
            ${history
              .map(
                (value, index) =>
                  `<span class="mini-actual-value" style="left:${actualX[index]}%; top:${Math.max(1, toMiniY(value) - 8)}%">${formatTrendWon(value)}</span>`,
              )
              .join("")}
            <span class="mini-forecast-value base" style="left:${terminalX}%; top:${Math.max(0, toMiniY(terminalBase.closing) - 10)}%">B ${formatTrendWon(terminalBase.closing)}</span>
            <span class="mini-forecast-value worst" style="left:${terminalX}%; top:${Math.min(76, toMiniY(terminalWorst.closing) + 3)}%">W ${formatTrendWon(terminalWorst.closing)}</span>
            <span class="mini-chart-labels"><small>Actual</small><small>1~3년</small><small>5년</small><small>10년</small></span>
          </div>
          <div class="trend-card-values">
            <span><small>${periodLabel(context.periodKey)} 실적</small><strong>${formatTrendWon(context.period.csm)}</strong></span>
            <span><small>2035년말 Base</small><strong>${formatTrendWon(terminalBase.closing)}</strong></span>
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
      if (!entry) return `<tr class="${sectorCell ? "sector-start" : ""}">${sectorCell}<th class="table-company-cell forecast-company-cell" scope="row">${escapeHtml(catalog.name)}</th>${"<td>—</td>".repeat(8)}</tr>`;
      const nearBase = entry.horizon.base.at(-1);
      const nearWorst = entry.horizon.worst.at(-1);
      const terminalBase = entry.horizon.terminal.base;
      const terminalWorst = entry.horizon.terminal.worst;
      return `
        <tr class="${sectorCell ? "sector-start" : ""}">
          ${sectorCell}
          <th class="table-company-cell forecast-company-cell" scope="row">${escapeHtml(catalog.name)}</th>
          <td>${formatTrendWon(entry.asOfCsm ?? entry.base.opening)}</td>
          <td class="forecast-base-cell">${formatTrendWon(entry.base.closing)}</td>
          <td class="forecast-worst-cell">${formatTrendWon(entry.worst.closing)}</td>
          <td class="forecast-base-cell">${formatTrendWon(nearBase.closing)}</td>
          <td class="forecast-worst-cell">${formatTrendWon(nearWorst.closing)}</td>
          <td class="forecast-base-cell">${formatTrendWon(terminalBase.closing)}</td>
          <td class="forecast-worst-cell">${formatTrendWon(terminalWorst.closing)}</td>
          <td><span class="forecast-confidence">${escapeHtml(entry.confidence)}</span></td>
        </tr>`;
    })
    .join("");
}

function openTrendModal(companyKey) {
  const context = getTrendContext(companyKey);
  if (!context.period) return;
  document.querySelector("#trend-modal-title").textContent = `${context.company.name} CSM 추이`;
  document.querySelector("#trend-modal-subtitle").textContent =
    `${periodLabel(context.periodKey)} 최신 실적 → 1~3년 · 5년 · 10년 Base / Worst 전망`;
  document.querySelector("#trend-modal-content").innerHTML = `
    <div class="forecast-layout modal-forecast-layout">
      <article class="forecast-chart-card">
        <div class="forecast-chart-header">
          <div>
            <span>과거 실적 → 1~3년 전망 → 5년 전망 → 10년 전망</span>
            <strong id="forecast-company-name">${context.company.name}</strong>
          </div>
          <div class="chart-legend">
            <span><i class="legend-dot actual"></i>Actual</span>
            <span><i class="legend-dot base"></i>Base</span>
            <span><i class="legend-dot worst"></i>Worst</span>
          </div>
        </div>
        <div class="forecast-chart" id="forecast-chart"></div>
        <div class="forecast-axis-labels" id="forecast-axis-labels"></div>
      </article>
      <div class="scenario-stack">
        <article class="scenario-card scenario-base" id="base-scenario-card"></article>
        <article class="scenario-card scenario-worst" id="worst-scenario-card"></article>
      </div>
    </div>
    <article class="forecast-executive-brief" id="forecast-executive-brief"></article>
    <article class="forecast-evidence" id="forecast-evidence"></article>
  `;
  renderTrendModalDetail(context);
  trendModal.showModal();
}

function renderTrendModalDetail(context) {
  const base = calculateForecast(context, "base");
  const worst = calculateForecast(context, "worst");
  const target = forecastTargetLabel(context.periodKey);
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
    baseSeries.length === 1 ? 96 : 46 + (index * 50) / (baseSeries.length - 1),
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
          `<span class="chart-value-label actual-value" style="left:${historyX[index]}%; top:${Math.max(0, toY(item.value) - 9)}%">${formatTrendWon(item.value)}</span>`,
      )
      .join("")}
    ${baseSeries.map((item, index) => `<span class="chart-value-label forecast-series-value base-value" style="left:${forecastX[index]}%; top:${Math.max(0, toY(item.closing) - 8)}%">B ${formatTrendWon(item.closing)}</span>`).join("")}
    ${worstSeries.map((item, index) => `<span class="chart-value-label forecast-series-value worst-value" style="left:${forecastX[index]}%; top:${Math.min(91, toY(item.closing) + 3)}%">W ${formatTrendWon(item.closing)}</span>`).join("")}
  `;

  document.querySelector("#forecast-axis-labels").innerHTML =
    [
      ...history.map((item, index) => ({ label: item.label, x: historyX[index], end: false })),
      ...baseSeries.map((item, index) => ({ label: forecastPeriodLabel(item.period), x: forecastX[index], end: index === baseSeries.length - 1 })),
    ]
      .map(
        ({ label, x, end }) =>
          typeof label === "string"
            ? `<span style="left:${x}%">${label}</span>`
            : `<span class="forecast-term-label ${end ? "forecast-end-label" : ""}" style="left:${x}%"><strong>${label.term}</strong><small>${label.year}</small></span>`,
      )
      .join("");

  renderScenarioCard("base-scenario-card", base, target, "기준 시나리오");
  renderScenarioCard("worst-scenario-card", worst, target, "하방 시나리오");

  const meta = base.forecastMeta;
  const evidence = document.querySelector("#forecast-evidence");
  if (meta) {
    const executiveRationale = meta.horizon?.executiveRationale ?? {};
    document.querySelector("#forecast-executive-brief").innerHTML = `
      <div class="executive-brief-heading"><span>EXECUTIVE BRIEF</span><strong>전망 구간별 핵심 근거</strong></div>
      <div class="executive-brief-grid">
        <div><span>1~3년 전망</span><p>${escapeHtml(executiveRationale.years1to3 ?? "최근 실적과 계절성으로 단기 CSM을 전망")}</p></div>
        <div><span>5년 전망</span><p>${escapeHtml(executiveRationale.year5 ?? "단기 추세와 Movement 비율을 2030년까지 연결")}</p></div>
        <div><span>10년 전망</span><p>${escapeHtml(executiveRationale.year10 ?? "성장률 수렴과 연도별 Movement 누적으로 2035년 종착점을 산출")}</p></div>
      </div>`;
    evidence.innerHTML = `
      <div class="forecast-evidence-heading">
        <div><span>회사별 판단 근거 · 외부자료는 증권사 애널리스트 리포트만 사용</span><strong>${escapeHtml(context.company.name)} · ${escapeHtml(meta.confidence)} 신뢰도</strong></div>
        <a href="../CSM_FORECAST_METHODOLOGY.md" target="_blank" rel="noreferrer">전체 방법론 ↗</a>
      </div>
      <div class="forecast-rationale-grid">
        <div><span>Base 신계약</span><p>${escapeHtml(meta.qualitativeJudgment.baseNewbiz)}</p></div>
        <div><span>Base 조정</span><p>${escapeHtml(meta.qualitativeJudgment.baseAdjustment)}</p></div>
        <div><span>Worst</span><p>${escapeHtml(meta.qualitativeJudgment.worst)}</p></div>
      </div>
      <ul class="forecast-source-list">
        ${meta.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a><span>${escapeHtml(source.use)}</span></li>`).join("")}
      </ul>`;
  } else {
    evidence.hidden = true;
  }
}

function renderScenarioCard(id, projection, target, subtitle) {
  const direction = projection.change >= 0 ? "증가" : "감소";
  document.querySelector(`#${id}`).innerHTML = `
    <div class="scenario-heading">
      <span>${subtitle}</span>
      <strong>${projection.scenario.label}</strong>
    </div>
    <div class="scenario-value">
      <strong>${formatTrendWon(projection.closing)}</strong>
      <span class="${projection.change >= 0 ? "positive" : "negative"}">
        ${formatSignedTrendWon(projection.change)} · ${direction}
      </span>
    </div>
    <p>${escapeHtml(projection.rationale ?? projection.scenario.description)}</p>
    <dl>
      <div><dt>신계약</dt><dd>${formatSignedTrendWon(projection.newbiz)}</dd></div>
      <div><dt>이자부리</dt><dd>${formatSignedTrendWon(projection.interest)}</dd></div>
      <div><dt>조정 등</dt><dd>${formatSignedTrendWon(projection.adjustment)}</dd></div>
      <div><dt>상각</dt><dd>${formatSignedTrendWon(projection.amortization)}</dd></div>
    </dl>
    <small>2025년말 기시 기준 연간 Movement · ${target} 전망 · 단위 조원</small>
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
  for (const key of ["newbiz", "interest", "adjustment", "amortization"]) {
    cumulative.push(cumulative.at(-1) + movement[key]);
  }
  const max = Math.max(movement.opening, movement.closing, ...cumulative) * 1.1;
  return items.map((item, index) => {
    if (index === 0 || index === 5) {
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
      return `
        <tr class="movement-row ${isSectorStart ? "sector-start" : ""}">
          ${sectorCell}
          <td class="table-company-cell movement-company-cell">
            <span class="movement-company">
              <span>
                <strong>${context.company.name}</strong>
                <small>${check === movement.closing ? "검산 일치" : "검토 필요"}</small>
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
        <div><span>Movement 합계 검산</span><strong class="${check === movement.closing ? "check-pass" : "check-warning"}">${check === movement.closing ? "일치" : "검토 필요"}</strong></div>
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
      return { total: 0, passed: 0, needsReview: 0, failed: 0 };
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
    };
  }
  return {
    total: items.length,
    passed: items.filter((item) => item.status === "passed").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
}

const qualityMethodology = [
  {
    metric: "보험부채 변동내역",
    source:
      "Open DART 사업보고서 재무제표 주석의 보험계약부채 변동표 중 회사계·발행한 보험계약 기준에서 2024·2025년 BEL·RA·CSM을 직접 수집.",
    validation:
      "2022년말부터 회사별 Open DART 사업보고서 원문 전체를 탐색. 2022년은 상세·유사표가 없고 2023년 일부 민감도 분석표만 확인되며, 9개사의 동일 상세 변동표는 2024년말부터 확인됨. 회사·연도별 접수번호, XML, 표 인덱스와 원단위를 저장.",
    rule: "원본·검증 기준은 Open DART로 단일화하고 연말 선택 시에만 표시. 원·천원·백만원·억원을 억원으로 정규화하며 구성요소 합계와 공시 합계의 반올림 차이만 허용.",
  },
  {
    metric: "보험금 예실차 비율",
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
      "Open DART 사업보고서 · 별도 보험계약 주석의 ‘보험계약마진’ 기말 잔액. 발행 보험계약만 포함하고 출재 재보험은 제외.",
    validation:
      "FISIS에는 CSM 항목이 없어 회사 공식 연간 IR·경영공시의 기말 CSM을 비교.",
    rule: "십억원 원값 일치 또는 IR의 조/천억원 표시단위 반올림 범위이면 일치.",
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
      "최근 4개 분기 비율·전년 계절성과 대조하고, 내부 계산한 2026~2035년 모든 연도에서 기시 + 신계약 + 이자 + 조정 + 상각 = 기말을 재검산.",
    rule: "Base 신계약·조정은 실적 추이와 증권사 애널리스트 근거로 판단. Worst는 두 항목을 Base 대비 각각 20% 악화하고 이자·상각을 다시 계산. 화면에는 1~3년·5년·10년 전망만 표시.",
  },
  {
    metric: "보험손익",
    source:
      "Open DART 별도 포괄손익계산서의 보험손익. 공시 누적값과 누적 차감으로 산출한 분기 단독값을 함께 보존.",
    validation:
      "FISIS 별도 손익: 생보 SH154/A, 손보 SI150/A의 보험손익.",
    rule: "십억원 환산 후 0.01십억원(0.1억원) 이내면 일치.",
  },
  {
    metric: "당기순이익",
    source:
      "Open DART 연결 손익계산서의 ‘지배기업 소유주 귀속 당기순이익’. 누적값과 누적 차감으로 산출한 분기 단독값을 함께 보존.",
    validation:
      "FISIS 별도 손익: 생보 SH154/G, 손보 SI150/G의 당기순이익.",
    rule: "연결 귀속값과 별도값은 범위가 달라 일치 판정에서 제외하고 두 값을 병기.",
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
  const absolute = Math.abs(number);
  if (absolute >= 10000) {
    return `${sign}${(absolute / 10000).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}조`;
  }
  return `${sign}${Math.round(absolute).toLocaleString("ko-KR")}억`;
}

function formatLiabilityRaw(value, ratio = false) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  if (ratio) return formatDashboardPercent(Number(value) * 100, 2);
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function liabilityAvailablePeriodKey() {
  const { year, quarter, kind } = parsePeriodKey(state.periodKey);
  if (kind !== "ye" && quarter !== 4) return null;
  const targetPeriodKey = `${year}-ye`;
  return liabilityAssumptionData.availablePeriods?.includes(targetPeriodKey) ? targetPeriodKey : null;
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
    return `<article class="liability-card ${state.companyKey === catalog.key ? "is-selected" : ""}">
      <div class="liability-card-head"><strong>${escapeHtml(catalog.name)}</strong><small>${item.checks.status === "passed" ? "검산 완료" : "검토 필요"}</small></div>
      <div class="liability-impact"><span>가정변경 CSM 영향</span><strong class="${direction}">${formatLiabilityAmount(effect)}</strong><small>Open DART · ${escapeHtml(item.sourceReference.originalUnit)} → 억원 ${assumptionSourceLink(item.sourceReference)}</small></div>
      <div class="liability-prior"><span>전년</span><strong>${formatLiabilityAmount(prior)}</strong><i>→</i><span>당기</span><strong class="${direction}">${formatLiabilityAmount(effect)}</strong></div>
      <div class="liability-driver-list">
        ${summary.drivers.map((driver) => {
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
  return `<div class="liability-full-table-wrap"><table class="liability-full-table"><thead><tr><th rowspan="2">업권</th><th rowspan="2">회사</th><th rowspan="2">구분</th>${yearHeadings}</tr><tr>${metricHeadings}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
  return parsePeriodKey(state.periodKey).year;
}

function assumptionPeriodKey() {
  const { year, quarter, kind } = parsePeriodKey(state.periodKey);
  return kind === "ye" || quarter === 4 ? `${year}-ye` : null;
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

function renderClaimExperience() {
  const grid = document.querySelector("#claim-summary-grid");
  const year = assumptionYear();
  const priorYear = year - 1;
  document.querySelector("#claim-period-label").textContent = periodLabel(state.periodKey);
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
  document.querySelector(isLoss ? "#loss-period-label" : "#expense-period-label").textContent = periodLabel(state.periodKey);
  document.querySelector(`[data-full-metric="${type}"]`).disabled = !assumptionPeriodAvailable();
  const labels = compactDurationLabels();
  head.innerHTML = `<tr><th class="table-sector-heading">업권</th><th class="table-company-heading">회사</th>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}<th>기간별 흐름</th></tr>`;
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
        ${values.map((value) => `<td>${formatDashboardPercent(value, 0)}</td>`).join("")}
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
      return `<tr class="${index === 0 && isSectorStart ? "sector-start" : ""}">${index === 0 && isSectorStart ? `<th class="modal-sector-cell sector-${sectorMetaForCompany(catalog).key}" rowspan="${companiesInSector(catalog.sector).length * definitions.length}"><span>${catalog.shortSector}</span><small>${escapeHtml(catalog.sector)}</small></th>` : ""}${index ? "" : `<th class="modal-company-cell" rowspan="3"><strong>${escapeHtml(catalog.name)}</strong>${assumptionSourceLink(item?.sourceReference)}</th>`}<th class="modal-metric-cell">${label}</th>${(metric?.duration ?? []).map((value) => `<td>${formatDisclosureNumber(value, isRatio)}</td>`).join("")}<td class="modal-current-value">${formatDisclosureNumber(metric?.presentValue, isRatio)}</td></tr>`;
    });
  }).join("");
  return `<div class="disclosure-table-wrap modal-disclosure-table-wrap"><table class="disclosure-table duration-table"><thead><tr><th class="modal-sector-cell">업권</th><th class="modal-company-cell">회사</th><th class="modal-metric-cell">구분</th>${(assumptionData.durationBuckets ?? []).map((bucket) => `<th>${escapeHtml(bucket)}</th>`).join("")}<th class="modal-current-value">현재가치</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openAssumptionTable(type) {
  if (type === "liability") {
    const periodKey = liabilityAvailablePeriodKey();
    if (!periodKey) return;
    const year = parsePeriodKey(periodKey).year;
    const hasPrior = liabilityAssumptionData.availablePeriods?.includes(`${year - 1}-ye`);
    document.querySelector("#assumption-table-modal-title").textContent = "보험부채 변동내역 전체보기";
    document.querySelector("#assumption-table-modal-subtitle").textContent = `Open DART ${hasPrior ? `${year - 1}·` : ""}${year} 사업보고서 재무제표 주석 · 회사계/발행한 보험계약 · 단위 억원`;
    document.querySelector("#assumption-table-modal-content").innerHTML = fullLiabilityAssumptionTable();
    assumptionTableModal.showModal();
    return;
  }
  if (!assumptionPeriodAvailable()) return;
  const year = assumptionYear();
  const titles = { claim: "보험금 예실차 전체보기", loss: "경과기간별 손해율 전체보기", expense: "경과기간별 유지비율 전체보기" };
  document.querySelector("#assumption-table-modal-title").textContent = titles[type];
  document.querySelector("#assumption-table-modal-subtitle").textContent = `${periodLabel(state.periodKey)} · Open DART 연결재무제표 주석`;
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
  assumptionTableModal.showModal();
}

function detailedDurationChart(values) {
  const width = 940;
  const height = 330;
  const points = sparklineGeometry(values, width, height, 32);
  return `<div class="duration-detail-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="경과기간별 비율 상세 그래프"><g class="duration-detail-grid"><line x1="32" y1="82" x2="908" y2="82"/><line x1="32" y1="165" x2="908" y2="165"/><line x1="32" y1="248" x2="908" y2="248"/></g><polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}"/>${points.map(({ x, y, value }, index) => `<circle cx="${x}" cy="${y}" r="4"/><text x="${x}" y="${Math.max(y - 12, 14)}">${formatDisclosureNumber(value, true)}</text><text class="axis-label" x="${x}" y="322">${escapeHtml(assumptionData.durationBuckets[index])}</text>`).join("")}</svg></div>`;
}

function openDurationChart(type, companyKey) {
  const catalog = companyCatalog.find((company) => company.key === companyKey);
  const item = durationPeriodItem(companyKey, type);
  if (!catalog || !item) return;
  document.querySelector("#assumption-chart-modal-title").textContent = `${catalog.name} ${type === "loss" ? "손해율" : "유지비율"} 흐름`;
  document.querySelector("#assumption-chart-modal-subtitle").textContent = `${periodLabel(state.periodKey)} · 경과기간별 비율`;
  document.querySelector("#assumption-chart-modal-content").innerHTML = `${detailedDurationChart(item.ratio.duration)}<div class="duration-chart-meta"><span>현재가치 비율</span><strong>${formatDisclosureNumber(item.ratio.presentValue, true)}</strong>${assumptionSourceLink(item.sourceReference)}</div>`;
  assumptionChartModal.showModal();
}

function renderAssumptionMetrics() {
  renderLiabilityAssumption();
  renderClaimExperience();
  renderDurationSummary("loss");
  renderDurationSummary("expense");
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
  if (!Number.isFinite(Number(value))) return "비교값 없음";
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
          text: `Movement 산식 차이 ${signedAuditDifference(audit.movementIdentityDifference)} · DART/FISIS 누적 보험손익 차이 ${signedAuditDifference(insuranceDifference)}. 순이익 기준: ${period.metricBasis?.parentNetIncome || "—"}.`,
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
        {
          label: "보험손익",
          original: context.period.insuranceProfit,
          check: audit.financialValidation?.fisisInsuranceProfitStandalone,
          status:
            audit.financialValidation?.fisisInsuranceProfitStandalone == null
              ? "not_connected"
              : Math.abs(context.period.insuranceProfit - audit.financialValidation.fisisInsuranceProfitStandalone) <= 0.1
                ? "matched"
                : "basis_difference",
          source: "FISIS 분기 통계",
          table: context.company.sector === "생명보험" ? "SH154/A" : "SI150/A",
          note: "DART 누적값을 분기 단독으로 환산한 값과 FISIS a(분기 단독)를 비교.",
        },
        {
          label: "당기순이익",
          original: context.period.parentNetIncome,
          check: audit.financialValidation?.fisisSeparateNetIncomeStandalone,
          status: context.period.metricBasis?.parentNetIncome?.startsWith("별도")
            ? "matched"
            : "basis_difference",
          source: "FISIS 분기 통계",
          table: context.company.sector === "생명보험" ? "SH154/G" : "SI150/G",
          note: context.period.metricBasis?.parentNetIncome,
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

initializeControls();
bindNavigation();
renderDashboard();
