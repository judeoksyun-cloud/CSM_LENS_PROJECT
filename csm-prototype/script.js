const cloneData =
  typeof structuredClone === "function"
    ? structuredClone
    : (value) => JSON.parse(JSON.stringify(value));

let agentDashboardData =
  typeof window !== "undefined" ? window.CSM_AGENT_DATA ?? {} : {};

let sampleData = cloneData(agentDashboardData.sampleData ?? {});
let financialMetrics = cloneData(agentDashboardData.financialMetrics ?? {});
let reviewItems = cloneData(agentDashboardData.reviewItems ?? []);

function normalizeMovementOpeningBasis(data) {
  Object.values(data).forEach((company) => {
    const latestPeriodKey = Object.keys(company.periods ?? {})
      .sort()
      .at(-1);
    const previousYearEndCsm =
      company.periods?.[latestPeriodKey]?.movement?.opening ?? null;

    if (previousYearEndCsm == null) return;

    Object.values(company.periods ?? {}).forEach((period) => {
      const openingDifference = previousYearEndCsm - period.movement.opening;
      period.movement.opening = previousYearEndCsm;
      period.movement.adjustment -= openingDifference;
    });
  });
}

function applyInvestmentProfitFormula(metrics) {
  Object.values(metrics).forEach((periods) => {
    Object.values(periods).forEach((metric) => {
      if (!metric.investmentFormula) return;

      const { parentNetIncome, nonControllingInterest, incomeTaxExpense } =
        metric.investmentFormula;

      metric.investmentProfit = Number(
        (
          parentNetIncome +
          (nonControllingInterest ?? 0) -
          metric.insuranceProfit +
          incomeTaxExpense
        ).toFixed(3),
      );
    });
  });
}

normalizeMovementOpeningBasis(sampleData);
applyInvestmentProfitFormula(financialMetrics);

const formatWon = (value) => `${(value / 1000).toFixed(1)}조원`;
const formatChartValue = (value) => {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value / 1000).toFixed(2)}`;
};
const formatGrowth = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const formatKics = (value) =>
  `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}%`;
const formatSignedTrillion = (value) =>
  `${value >= 0 ? "+" : ""}${(value / 1000).toFixed(1)}조원`;
const formatSignedPercent = (value) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

const forecastScenarios = {
  conservative: {
    label: "Conservative",
    newbizFactor: 0.86,
    interestRate: 0.011,
    amortRate: 0.1,
    adjustmentRate: -0.014,
    riskAdjustmentRate: 0.16,
    experienceRate: 0.018,
    investmentFactor: 0.9,
  },
  base: {
    label: "Base",
    newbizFactor: 1,
    interestRate: 0.014,
    amortRate: 0.092,
    adjustmentRate: -0.004,
    riskAdjustmentRate: 0.18,
    experienceRate: 0.032,
    investmentFactor: 1,
  },
  optimistic: {
    label: "Optimistic",
    newbizFactor: 1.12,
    interestRate: 0.016,
    amortRate: 0.087,
    adjustmentRate: 0.004,
    riskAdjustmentRate: 0.2,
    experienceRate: 0.048,
    investmentFactor: 1.1,
  },
};

const companySelect = document.querySelector("#company-select");
const periodSelect = document.querySelector("#period-select");
const agentTargetSelect = document.querySelector("#agent-target-select");
const agentRunButton = document.querySelector("#agent-run-button");
const agentRunTimeline = document.querySelector("#agent-timeline");
const agentRunLiveStatus = document.querySelector("#agent-run-live-status");
const agentLastRunAt = document.querySelector("#agent-last-run-at");
const agentLastRunResult = document.querySelector("#agent-last-run-result");
const agentRunNote = document.querySelector("#agent-run-note");
const agentSnapshotKind = document.querySelector("#agent-snapshot-kind");
const agentTargetSummary = document.querySelector("#agent-target-summary");
const scenarioSelect = document.querySelector("#scenario-select");
const marketSortSelect = document.querySelector("#market-sort-select");
const marketFilterSelect = document.querySelector("#market-filter-select");
const marketPeerSelect = document.querySelector("#market-peer-select");
const forecastMovementDetail = document.querySelector("#forecast-movement-detail");
const aiFocusSelect = document.querySelector("#ai-focus-select");
const aiRefreshButton = document.querySelector("#ai-refresh-button");
const aiSnapshotStatus = document.querySelector("#ai-snapshot-status");
const aiPeriodStatus = document.querySelector("#ai-period-status");
const aiValidationStatus = document.querySelector("#ai-validation-status");
const aiInsightCards = document.querySelector("#ai-insight-cards");
const aiChatForm = document.querySelector("#ai-chat-form");
const aiChatInput = document.querySelector("#ai-chat-input");
const aiChatThread = document.querySelector("#ai-chat-thread");
const aiDrawer = document.querySelector("#ai-drawer");
const aiOverlay = document.querySelector("#ai-overlay");
const aiDrawerButton = document.querySelector("#ai-drawer-button");
const aiCloseButton = document.querySelector("#ai-close-button");
const quickJumpButtons = [...document.querySelectorAll("[data-jump-tab]")];
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const tabPanels = [...document.querySelectorAll("[data-tab-panel]")];
const companySubtabButtons = [...document.querySelectorAll("[data-company-subtab]")];
const companySubtabPanels = [
  ...document.querySelectorAll("[data-company-subtab-panel]"),
];

const topLevelTabs = ["overview", "company-analysis", "market", "forecast", "quality"];
const companySubtabs = ["movement", "profit", "portfolio", "trend"];
let supportedCompanies = Object.keys(sampleData);

const agentStageOrder = [
  { key: "dart_ingestion", label: "DART 수집" },
  { key: "csm_parsing", label: "CSM 파싱" },
  { key: "movement_mapping", label: "Movement 매핑" },
  { key: "validation", label: "검산" },
  { key: "human_review", label: "휴먼리뷰" },
];

if (!supportedCompanies.length) {
  throw new Error("CSM dashboard data is not available.");
}

if (!supportedCompanies.includes(companySelect.value)) {
  companySelect.value = supportedCompanies[0];
}

syncCompanyOptions(companySelect.value);
syncPeriodOptions(companySelect.value, periodSelect.value);

const tabAiContexts = {
  overview: {
    focus: "briefing",
    description:
      "개요 탭에서는 현재 선택한 회사와 기간의 핵심 수치, 검토 필요 항목, 바로 봐야 할 변화 신호를 짧게 정리합니다.",
    prompts: [
      "이번 기간 핵심 변화 3가지만 정리해줘",
      "지금 가장 먼저 봐야 할 위험 신호가 뭐야?",
      "보유 CSM과 손익을 같이 보면 어떤 해석이 가능해?",
    ],
  },
  "company-analysis": {
    focus: "movement",
    description:
      "회사 분석 탭에서는 Movement 원인분해, 손익 구조, 포트폴리오 특성, 분기 추세를 한 회사 안에서 깊게 봅니다.",
    prompts: [
      "이번 분기 CSM 변동의 핵심 원인을 설명해줘",
      "손익 구조를 기준으로 눈에 띄는 점을 짚어줘",
      "포트폴리오 구성 변화가 해석상 어떤 영향을 줘?",
    ],
  },
  market: {
    focus: "peer",
    description:
      "시장 비교 탭에서는 같은 기간 기준으로 회사 간 차이, 상대 순위, 확장 가능한 비교 축을 요약합니다.",
    prompts: [
      "선택 회사와 비교 회사의 차이를 핵심만 설명해줘",
      "보유 CSM과 K-ICS를 같이 보면 누가 더 안정적이야?",
      "지금 비교 보드에서 가장 큰 차이는 뭐야?",
    ],
  },
  forecast: {
    focus: "briefing",
    description:
      "전망 탭에서는 최신 검증 기간만 기준으로 다음 연말 전망을 만들고, Movement 기반 초안과 민감도 가정을 설명합니다.",
    prompts: [
      "현재 시나리오에서 전망값에 가장 민감한 가정은 뭐야?",
      "전망 보유 CSM을 Movement 기준으로 설명해줘",
      "손익 전망을 해석할 때 주의할 점이 뭐야?",
    ],
  },
  quality: {
    focus: "anomaly",
    description:
      "데이터 품질 탭에서는 출처, 검증 상태, 휴먼 리뷰, 보정 이력을 중심으로 숫자를 어떻게 믿어야 하는지 설명합니다.",
    prompts: [
      "지금 검증이 가장 약한 항목은 뭐야?",
      "휴먼 리뷰가 필요한 이유를 출처 기준으로 설명해줘",
      "표시 기준이 달라서 오해할 수 있는 지점이 있어?",
    ],
  },
};

const state = {
  activeTab: parseHashTab(window.location.hash),
  activeCompanySubtab: "movement",
  aiOpen: false,
  agentTargets: {
    targets: [],
    summary: {
      backlog: 0,
      completed: 0,
      failed: 0,
      needs_review: 0,
    },
  },
  agentRun: {
    runId: null,
    status: "idle",
    selectedCompany: null,
    selectedPeriod: null,
    stages: createDefaultAgentStages(),
    lastUpdatedAt: null,
    failureReason: null,
    snapshotAppliedRunId: null,
    pollTimer: null,
  },
};

let aiConversation = [];
let aiLatestResponse = null;
let aiRequestSerial = 0;
let aiConversationCompany = companySelect.value;

function parsePeriodKey(periodKey) {
  const match = periodKey.match(/^(\d{4})-q([1-4])$/);
  return {
    year: match ? Number(match[1]) : 2025,
    quarter: match ? Number(match[2]) : 4,
  };
}

function getPeriodLabel(periodKey) {
  const { year, quarter } = parsePeriodKey(periodKey);
  return `${year} Q${quarter}`;
}

function getLatestPeriodKey(company) {
  return Object.keys(company.periods ?? {})
    .sort((a, b) => {
      const periodA = parsePeriodKey(a);
      const periodB = parsePeriodKey(b);

      if (periodA.year !== periodB.year) {
        return periodA.year - periodB.year;
      }

      return periodA.quarter - periodB.quarter;
    })
    .at(-1);
}

function getForecastPeriodInfo(company) {
  const basisPeriodKey = getLatestPeriodKey(company);
  const { year, quarter } = parsePeriodKey(basisPeriodKey);
  const targetYear = quarter === 4 ? year + 1 : year;
  const remainingQuarters = quarter === 4 ? 4 : Math.max(0, 4 - quarter);
  const basisLabel = getPeriodLabel(basisPeriodKey);
  const targetYearEndLabel = `${targetYear}년 말`;

  return {
    basisPeriodKey,
    year,
    quarter,
    targetYear,
    remainingQuarters,
    basisLabel,
    targetYearEndLabel,
  };
}

function parseHashTab(hashValue) {
  const value = String(hashValue || "").replace(/^#/, "");
  return topLevelTabs.includes(value) ? value : "overview";
}

function getSelectedPeriodLabel() {
  return (
    periodSelect?.options?.[periodSelect.selectedIndex]?.text ??
    getPeriodLabel(periodSelect.value)
  );
}

function createDefaultAgentStages() {
  return agentStageOrder.map((stage) => ({
    key: stage.key,
    label: stage.label,
    status: "idle",
    message: "실행 대기",
    startedAt: null,
    finishedAt: null,
  }));
}

function getDashboardDataKind() {
  return agentDashboardData.sourcePolicy ? "actual" : "sample";
}

function syncCompanyOptions(preferredCompanyKey = companySelect.value) {
  if (!companySelect) return;

  companySelect.innerHTML = supportedCompanies
    .map((companyKey) => {
      const companyName = sampleData[companyKey]?.name ?? companyKey;
      return `<option value="${companyKey}">${companyName}</option>`;
    })
    .join("");

  companySelect.value = supportedCompanies.includes(preferredCompanyKey)
    ? preferredCompanyKey
    : supportedCompanies[0];
}

function syncPeriodOptions(companyKey, preferredPeriodKey = periodSelect.value) {
  if (!periodSelect) return;

  const company = sampleData[companyKey];
  const sortedPeriods = getSortedPeriodKeys(company).reverse();

  periodSelect.innerHTML = sortedPeriods
    .map((periodKey) => `<option value="${periodKey}">${getPeriodLabel(periodKey)}</option>`)
    .join("");

  periodSelect.value = sortedPeriods.includes(preferredPeriodKey)
    ? preferredPeriodKey
    : sortedPeriods[0];
}

function comparePeriodKeysDesc(periodAKey, periodBKey) {
  const periodA = parsePeriodKey(periodAKey);
  const periodB = parsePeriodKey(periodBKey);

  if (periodA.year !== periodB.year) {
    return periodB.year - periodA.year;
  }

  return periodB.quarter - periodA.quarter;
}

function getAgentTargetLifecycleStatus(companyKey, periodKey) {
  const reviewState = summarizeReviewStateForPeriod(companyKey, periodKey);
  if (reviewState.failed > 0) return "failed";
  if (reviewState.needsReview > 0) return "needs_review";
  return "completed";
}

function buildLocalAgentTargetCatalog({ includeCompleted = false } = {}) {
  const targets = [];
  const summary = {
    backlog: 0,
    completed: 0,
    failed: 0,
    needs_review: 0,
  };

  supportedCompanies.forEach((companyKey) => {
    const company = sampleData[companyKey];
    if (!company) return;

    getSortedPeriodKeys(company)
      .slice()
      .sort(comparePeriodKeysDesc)
      .forEach((periodKey) => {
        const status = getAgentTargetLifecycleStatus(companyKey, periodKey);
        const reviewState = summarizeReviewStateForPeriod(companyKey, periodKey);
        const period = company.periods?.[periodKey];

        if (status === "completed") {
          summary.completed += 1;
        } else {
          summary.backlog += 1;
        }

        if (status === "failed") summary.failed += 1;
        if (status === "needs_review") summary.needs_review += 1;

        if (!includeCompleted && status === "completed") {
          return;
        }

        targets.push({
          id: `${companyKey}.${periodKey}`,
          companyKey,
          companyName: company.name ?? companyKey,
          periodKey,
          periodLabel: getPeriodLabel(periodKey),
          status,
          reviewSummary: reviewState,
          valueKind: period?.sourceReference?.valueKind ?? getDashboardDataKind(),
        });
      });
  });

  targets.sort((targetA, targetB) => {
    const statusRank = {
      failed: 0,
      needs_review: 1,
      completed: 2,
    };
    const rankA = statusRank[targetA.status] ?? 9;
    const rankB = statusRank[targetB.status] ?? 9;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const periodCompare = comparePeriodKeysDesc(targetA.periodKey, targetB.periodKey);
    if (periodCompare !== 0) {
      return periodCompare;
    }

    return targetA.companyName.localeCompare(targetB.companyName, "ko");
  });

  return { targets, summary };
}

function formatAgentTargetStatus(status) {
  const labels = {
    failed: "실패",
    needs_review: "검토 필요",
    completed: "검증 완료",
  };

  return labels[status] ?? status;
}

function getAgentTargetMeta(target) {
  if (!target) return "-";

  if (target.status === "failed") {
    return `검산 실패 ${target.reviewSummary.failed}건`;
  }

  if (target.status === "needs_review") {
    return `휴먼리뷰 ${target.reviewSummary.needsReview}건`;
  }

  return "검증 완료";
}

function getSelectedAgentTarget() {
  const targetId = agentTargetSelect?.value;
  if (!targetId) return null;
  return state.agentTargets.targets.find((target) => target.id === targetId) ?? null;
}

function syncAgentTargetOptions(preferredTargetId = agentTargetSelect?.value ?? null) {
  if (!agentTargetSelect) return;

  const targets = state.agentTargets.targets ?? [];
  if (!targets.length) {
    agentTargetSelect.innerHTML = `<option value="">현재 실행할 미완료 대상 없음</option>`;
    agentTargetSelect.value = "";
    agentTargetSelect.disabled = true;

    if (agentTargetSummary) {
      agentTargetSummary.textContent =
        "검증 완료 조합은 숨기고, 미완료 대상이 생길 때만 실행할 수 있습니다.";
    }
    return;
  }

  agentTargetSelect.innerHTML = targets
    .map(
      (target) =>
        `<option value="${target.id}">${target.companyName} · ${target.periodLabel} · ${formatAgentTargetStatus(target.status)}</option>`,
    )
    .join("");

  const selectedTarget = targets.find((target) => target.id === preferredTargetId);
  agentTargetSelect.value = selectedTarget?.id ?? targets[0].id;
  agentTargetSelect.disabled = false;

  const currentTarget = getSelectedAgentTarget();
  if (agentTargetSummary) {
    const backlog = state.agentTargets.summary.backlog;
    const completed = state.agentTargets.summary.completed;
    agentTargetSummary.textContent =
      `${backlog}건 실행 가능 · 현재 선택 ${getAgentTargetMeta(currentTarget)} · 완료 ${completed}건은 기본 숨김`;
  }
}

async function refreshAgentTargetCatalog(preferredTargetId = agentTargetSelect?.value ?? null) {
  try {
    const response = await requestJson("/api/agent/targets", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    state.agentTargets = response;
  } catch {
    state.agentTargets = buildLocalAgentTargetCatalog();
  }

  syncAgentTargetOptions(preferredTargetId);
  renderAgentRunState();
}

function applyDashboardSnapshot(snapshot, options = {}) {
  if (!snapshot?.sampleData || !snapshot?.financialMetrics) {
    return false;
  }

  agentDashboardData = {
    ...agentDashboardData,
    ...snapshot,
  };

  sampleData = cloneData(snapshot.sampleData);
  financialMetrics = cloneData(snapshot.financialMetrics);
  reviewItems = cloneData(snapshot.reviewItems ?? []);
  normalizeMovementOpeningBasis(sampleData);
  applyInvestmentProfitFormula(financialMetrics);
  supportedCompanies = Object.keys(sampleData);

  if (!supportedCompanies.length) {
    return false;
  }

  const nextCompanyKey = supportedCompanies.includes(options.companyKey)
    ? options.companyKey
    : getCurrentCompanyKey();
  syncCompanyOptions(nextCompanyKey);
  syncPeriodOptions(companySelect.value, options.periodKey);
  return true;
}

function getCurrentCompanyKey() {
  return supportedCompanies.includes(companySelect.value)
    ? companySelect.value
    : supportedCompanies[0];
}

function getCurrentData() {
  const companyKey = getCurrentCompanyKey();
  const company = sampleData[companyKey];
  const periodKey =
    company?.periods?.[periodSelect.value] ? periodSelect.value : getLatestPeriodKey(company);
  const financial = financialMetrics[companyKey]?.[periodKey];
  return {
    companyKey,
    company,
    periodKey,
    period: company.periods[periodKey],
    financial,
  };
}

function getSortedPeriodKeys(company) {
  return Object.keys(company.periods ?? {}).sort((a, b) => {
    const periodA = parsePeriodKey(a);
    const periodB = parsePeriodKey(b);

    if (periodA.year !== periodB.year) {
      return periodA.year - periodB.year;
    }

    return periodA.quarter - periodB.quarter;
  });
}

function getCurrentReviewItems() {
  return reviewItems.filter(
    (item) =>
      item.company === getCurrentCompanyKey() && item.period === periodSelect.value,
  );
}

function getCompanyReviewSummary() {
  const items = getCurrentReviewItems();
  return {
    total: items.length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    failed: items.filter((item) => item.status === "failed").length,
    applied: items.filter((item) => item.manualAdjustment?.applied).length,
  };
}

function buildMetricItems(company, period, financial) {
  return [
    {
      label: "보유 CSM",
      value: formatWon(period.csm),
      note: `${financial.csmScope} | ${getSelectedPeriodLabel()}`,
    },
    {
      label: "성장률",
      value: formatGrowth(period.growth),
      note: "회사 기준 전년말 대비 성장률",
    },
    {
      label: "신계약 CSM",
      value: formatWon(period.movement.newbiz),
      note: "Movement 기준 기여 항목",
    },
    {
      label: "CSM 상각",
      value: formatWon(Math.abs(period.movement.amortization)),
      note: "보험손익 인식과 연결되는 항목",
    },
    {
      label: "보험손익",
      value: formatWon(financial.insuranceProfit),
      note: financial.insuranceScope ?? "별도 보험서비스손익 기준",
    },
    {
      label: "투자손익",
      value: formatWon(financial.investmentProfit),
      note: financial.investmentScope ?? "관리 기준",
      subnote: financial.investmentCalcNote ?? "",
    },
    {
      label: "당기순이익",
      value: formatWon(financial.netIncome),
      note: financial.netIncomeScope ?? "당기순이익 기준",
    },
    {
      label: "K-ICS",
      value: formatKics(financial.kics),
      note: `${financial.kicsScope} | 지급여력 공시`,
    },
  ];
}

function renderMetricGrid(container, items) {
  if (!container) return;

  container.innerHTML = items
    .map((item) => {
      return `
        <article class="metric-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <small>${item.note ?? "-"}</small>
          ${item.subnote ? `<small class="calc-note">${item.subnote}</small>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderShellSummary() {
  const { company, period, financial } = getCurrentData();
  const periodLabel = getSelectedPeriodLabel();
  const reviewSummary = getCompanyReviewSummary();
  const shellSummary = document.querySelector("#shell-summary");

  if (shellSummary) {
    shellSummary.textContent =
      `${company.name} ${periodLabel} 기준 보유 CSM은 ${formatWon(period.csm)}, 보험손익은 ${formatWon(financial.insuranceProfit)}, ` +
      `투자손익은 ${formatWon(financial.investmentProfit)}입니다. 검토 필요 ${reviewSummary.needsReview}건과 ` +
      `실패 ${reviewSummary.failed}건이 데이터 품질 탭에 연결되어 있습니다.`;
  }
}

function renderOverview() {
  const { company, period, financial } = getCurrentData();
  const reviewSummary = getCompanyReviewSummary();
  const csmDelta = period.movement.closing - period.movement.opening;

  document.querySelector("#overview-status-chip").textContent = period.quality;
  document.querySelector("#overview-company-title").textContent =
    `${company.name} · ${company.sector}`;
  document.querySelector("#overview-summary").textContent = period.summary;
  document.querySelector("#overview-period-label").textContent = getSelectedPeriodLabel();
  document.querySelector("#overview-quality-note").textContent =
    `${financial.profitScope} | 수동 보정 ${reviewSummary.applied}건 반영`;

  renderMetricGrid(
    document.querySelector("#overview-metric-grid"),
    buildMetricItems(company, period, financial),
  );

  const watchItems = [
    {
      tone: reviewSummary.failed ? "danger" : "neutral",
      title: "검토 상태",
      value: reviewSummary.failed
        ? `실패 ${reviewSummary.failed}건`
        : reviewSummary.needsReview
          ? `검토 필요 ${reviewSummary.needsReview}건`
          : "검증 통과",
      note: "상세 근거는 데이터 품질 탭에서 확인합니다.",
    },
    {
      tone: period.movement.adjustment < 0 ? "warning" : "neutral",
      title: "CSM 조정 등",
      value: formatWon(Math.abs(period.movement.adjustment)),
      note: "가정변경과 자잘한 조정 항목을 포함합니다.",
    },
    {
      tone: period.growth >= 0 ? "good" : "warning",
      title: "전년말 대비",
      value: formatGrowth(period.growth),
      note: "모든 분기 기시 CSM은 전년도말 기준입니다.",
    },
    {
      tone: "neutral",
      title: "손익 기준",
      value: "별도 보험손익 / 관리 기준 투자손익",
      note: "표시 기준과 계산 메모는 데이터 품질 탭에서 추적합니다.",
    },
  ];

  document.querySelector("#overview-watchlist").innerHTML = watchItems
    .map((item) => {
      return `
        <article class="watch-item" data-tone="${item.tone}">
          <span>${item.title}</span>
          <strong>${item.value}</strong>
          <small>${item.note}</small>
        </article>
      `;
    })
    .join("");

  const changeCards = [
    {
      label: "기초 대비 순변동",
      value: `${csmDelta >= 0 ? "+" : ""}${formatWon(csmDelta)}`,
      note: "선택 기간의 총 CSM 변동입니다.",
    },
    {
      label: "신계약 기여",
      value: formatWon(period.movement.newbiz),
      note: "CSM 증가에 가장 직접적인 유입 항목입니다.",
    },
    {
      label: "상각 영향",
      value: formatWon(Math.abs(period.movement.amortization)),
      note: "보험손익 인식과 연결됩니다.",
    },
    {
      label: "K-ICS",
      value: formatKics(financial.kics),
      note: `${financial.kicsScope} 기준`,
    },
  ];

  document.querySelector("#overview-change-grid").innerHTML = changeCards
    .map((item) => {
      return `
        <article class="change-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <small>${item.note}</small>
        </article>
      `;
    })
    .join("");
}

function renderCompanySummary() {
  const { company, period, financial } = getCurrentData();
  const statusChip = document.querySelector("#company-analysis-status-chip");
  const companyTitle = document.querySelector("#company-analysis-company");
  const companySummary = document.querySelector("#company-analysis-summary");
  const companyPeriod = document.querySelector("#company-analysis-period");
  const companyQualityNote = document.querySelector("#company-analysis-quality-note");
  const companyMetricGrid = document.querySelector("#company-metric-grid");

  if (!statusChip && !companyTitle && !companySummary && !companyPeriod && !companyQualityNote) {
    return;
  }

  if (statusChip) statusChip.textContent = period.quality;
  if (companyTitle) companyTitle.textContent = `${company.name} · ${company.type}`;
  if (companySummary) companySummary.textContent = period.summary;
  if (companyPeriod) companyPeriod.textContent = getSelectedPeriodLabel();
  if (companyQualityNote) {
    companyQualityNote.textContent = `${financial.profitScope} | CSM ${financial.csmScope}`;
  }

  if (companyMetricGrid) {
    renderMetricGrid(companyMetricGrid, buildMetricItems(company, period, financial));
  }
}

function formatReviewStatus(status) {
  const labels = {
    passed: "통과",
    needs_review: "검토 필요",
    failed: "실패",
  };

  return labels[status] ?? status;
}

function formatManualReviewDecision(manualAdjustment) {
  if (!manualAdjustment?.applied) return "미반영";

  const labels = {
    approved: "확인",
    adjusted: "보정 적용",
  };

  return labels[manualAdjustment.decision] ?? "반영";
}

function formatReviewMetricValue(item) {
  if (item.metric === "csm_movement") {
    return `기말 CSM ${formatWon(item.systemValue?.closing ?? 0)}`;
  }

  if (item.metric === "financial_metrics") {
    const value = item.systemValue ?? {};
    return [
      `보험손익 ${formatWon(value.insuranceProfit ?? 0)}`,
      `투자손익 ${formatWon(value.investmentProfit ?? 0)}`,
      `당기순이익 ${formatWon(value.netIncome ?? 0)}`,
      `K-ICS ${formatKics(value.kics ?? 0)}`,
    ].join(" | ");
  }

  return "-";
}

function formatReviewAdjustedValue(item) {
  const adjustedValue = item.manualAdjustment?.adjustedValue;
  if (!adjustedValue) return "-";

  if (item.metric === "csm_movement") {
    const value = adjustedValue.closing ?? adjustedValue.csm ?? adjustedValue;
    return typeof value === "number"
      ? `기말 CSM ${formatWon(value)}`
      : JSON.stringify(adjustedValue);
  }

  if (item.metric === "financial_metrics") {
    const rows = [];
    if (typeof adjustedValue.insuranceProfit === "number") {
      rows.push(`보험손익 ${formatWon(adjustedValue.insuranceProfit)}`);
    }
    if (typeof adjustedValue.investmentProfit === "number") {
      rows.push(`투자손익 ${formatWon(adjustedValue.investmentProfit)}`);
    }
    if (typeof adjustedValue.netIncome === "number") {
      rows.push(`당기순이익 ${formatWon(adjustedValue.netIncome)}`);
    }
    if (typeof adjustedValue.kics === "number") {
      rows.push(`K-ICS ${formatKics(adjustedValue.kics)}`);
    }
    return rows.length ? rows.join(" | ") : JSON.stringify(adjustedValue);
  }

  return JSON.stringify(adjustedValue);
}

function renderReviewWorkbench() {
  const container = document.querySelector("#review-item-list");
  const summary = document.querySelector("#review-summary");
  if (!container || !summary) return;

  const items = getCurrentReviewItems();
  const needsReviewCount = items.filter((item) => item.status === "needs_review").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const appliedCount = items.filter((item) => item.manualAdjustment?.applied).length;

  summary.textContent =
    `${items.length}건 | 검토 필요 ${needsReviewCount}건 | 실패 ${failedCount}건 | 반영 ${appliedCount}건`;

  document.querySelector("#manual-review-status").textContent =
    appliedCount ? `보정 반영 ${appliedCount}건` : "수동 반영 없음";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = "현재 선택 값에 해당하는 리뷰 항목이 없습니다.";
    container.replaceChildren(empty);
    return;
  }

  const nodes = items.map((item) => {
    const detail = document.createElement("details");
    detail.className = `review-item review-item-${item.status}`;
    detail.open = item.status !== "passed" && !item.manualAdjustment?.applied;

    const itemSummary = document.createElement("summary");
    const title = document.createElement("span");
    const status = document.createElement("strong");
    title.textContent = item.title;
    status.textContent = formatReviewStatus(item.status);
    itemSummary.append(title, status);

    const list = document.createElement("dl");
    list.className = "review-item-grid";
    addQualityRow(list, "시스템 상태", formatReviewStatus(item.systemStatus ?? item.status));
    addQualityRow(list, "지표 값", formatReviewMetricValue(item));
    addQualityRow(list, "검토 사유", item.reviewReason);
    addQualityRow(list, "권장 조치", item.recommendedAction);
    addQualityRow(list, "원문 표", formatSourceTables(item.sourceReference?.sourceTables));
    addQualityRow(list, "접수번호", item.sourceReference?.rceptNo);
    addQualityRow(list, "리뷰 결정", formatManualReviewDecision(item.manualAdjustment));
    addQualityRow(list, "수동 보정", item.manualAdjustment?.applied ? "적용" : "미적용");
    addQualityRow(list, "보정 값", formatReviewAdjustedValue(item));
    addQualityRow(list, "검토자", item.manualAdjustment?.reviewedBy);
    addQualityRow(list, "검토 시각", item.manualAdjustment?.reviewedAt);
    addQualityRow(list, "검토 메모", item.manualAdjustment?.reviewerNote);

    detail.append(itemSummary, list);
    return detail;
  });

  container.replaceChildren(...nodes);
}

function formatSourceTables(sourceTables) {
  if (!sourceTables?.length) return "원문 정보 없음";
  return sourceTables.map((table) => `표 ${table}`).join(", ");
}

function formatBasisLabel(value) {
  const labels = {
    separate_financial_statement_excluding_reinsurance:
      "별도재무제표 기준, 재보험 제외",
    separate_insurance_service_result: "별도 보험서비스손익",
    separate_investment_profit_plus_non_operating_and_consolidation_effect:
      "별도 투자손익 + 영업외손익 + 연결효과",
    controlling_parent_consolidated_net_income: "지배주주 연결손익",
    public_solvency_disclosure: "지급여력 공시 기준",
  };

  return labels[value] ?? value ?? "-";
}

function formatUnitLabel(value) {
  const labels = {
    "KRW billion": "십억원",
    percent: "%",
  };

  return labels[value] ?? value ?? "-";
}

function formatFormulaLabel(value) {
  const labels = {
    "closing = opening + newbiz + interest + adjustment + amortization":
      "기말 CSM = 기시 CSM + 신계약 CSM + 이자부리 + CSM 조정 등 - CSM 상각",
    "parentNetIncome + nonControllingInterest + incomeTaxExpense - insuranceProfit":
      "투자손익 = 당기순이익 - 보험손익 - 법인세비용",
  };

  return labels[value] ?? value ?? "-";
}

function addQualityRow(list, label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value ?? "-";
  row.append(term, description);
  list.append(row);
}

function createQualityDetail(title, rows) {
  const detail = document.createElement("details");
  detail.className = "quality-detail";
  detail.open = title === "CSM Movement";

  const summary = document.createElement("summary");
  summary.textContent = title;

  const list = document.createElement("dl");
  list.className = "quality-detail-grid";
  rows.forEach(([label, value]) => addQualityRow(list, label, value));

  detail.append(summary, list);
  return detail;
}

function renderQualityDetails(period, financial) {
  const container = document.querySelector("#quality-detail-list");
  if (!container) return;

  const movementReference = period.sourceReference ?? {};
  const metricReferences = financial.sourceReferences ?? {};
  const qualityItems = [];

  document.querySelector("#source-status").textContent =
    movementReference.rceptNo ? `DART ${movementReference.rceptNo}` : "출처 확인 필요";
  document.querySelector("#parser-status").textContent = formatSourceTables(
    movementReference.sourceTables,
  );
  document.querySelector("#movement-status").textContent = period.quality;

  qualityItems.push(
    createQualityDetail("CSM Movement", [
      ["보고서명", movementReference.reportName],
      ["접수번호", movementReference.rceptNo],
      ["원문 표", formatSourceTables(movementReference.sourceTables)],
      ["기준", formatBasisLabel(movementReference.basis)],
      ["단위", formatUnitLabel(movementReference.unit)],
      ["검증식", formatFormulaLabel(movementReference.formula)],
    ]),
  );

  [
    ["insuranceProfit", "보험손익"],
    ["investmentProfit", "투자손익"],
    ["netIncome", "당기순이익"],
    ["kics", "K-ICS"],
  ].forEach(([key, label]) => {
    const reference = metricReferences[key] ?? {};
    const account = reference.account ?? reference.sourceAccounts?.[key];
    qualityItems.push(
      createQualityDetail(label, [
        ["보고서명", reference.reportName],
        ["접수번호", reference.rceptNo],
        ["원천 계층", reference.sourceLayer],
        ["원문 표", formatSourceTables(reference.sourceTables)],
        ["계정명", account?.account_nm],
        ["기준", formatBasisLabel(reference.basis)],
        ["단위", formatUnitLabel(reference.unit)],
        ["계산식", formatFormulaLabel(reference.formula)],
      ]),
    );
  });

  container.replaceChildren(...qualityItems);
}

function renderWaterfall() {
  const { company, period, periodKey } = getCurrentData();
  const selectedLabel = getSelectedPeriodLabel();
  const opening = period.movement.opening;
  const { year } = parsePeriodKey(periodKey);
  const openingLabel = `'${String(year - 2000).padStart(2, "0")}.12월말`;
  const deltas = [
    { label: "신계약", value: period.movement.newbiz, type: "positive" },
    { label: "이자부리", value: period.movement.interest, type: "positive" },
    { label: "CSM 조정 등", value: period.movement.adjustment, type: "negative" },
    { label: "상각", value: period.movement.amortization, type: "negative amortization" },
  ];

  const runningValues = [opening];
  for (const delta of deltas) {
    runningValues.push(runningValues[runningValues.length - 1] + delta.value);
  }

  const maxTotal = Math.max(...runningValues, period.movement.closing);
  const scaleTop = maxTotal * 1.08;
  const chartHeight = 260;
  const toBottom = (value) => Math.max(0, Math.round((value / scaleTop) * chartHeight));
  const chart = document.querySelector("#waterfall");

  const deltaSteps = deltas
    .map((delta, index) => {
      const start = runningValues[index];
      const end = runningValues[index + 1];
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      const height = Math.max(9, toBottom(high) - toBottom(low));
      const bottom = toBottom(low);
      const connectorBottom = toBottom(end);

      return `
        <div class="movement-step delta ${delta.type}" style="--bar-height:${height}px; --bar-bottom:${bottom}px; --connector-bottom:${connectorBottom}px">
          <div class="delta-value">${formatChartValue(delta.value)}</div>
          <div class="delta-bar"></div>
          <div class="step-connector" aria-hidden="true"></div>
          <div class="axis-label">${delta.label}</div>
        </div>
      `;
    })
    .join("");

  const composition = period.mix
    .map(([label, percent, color]) => {
      return `
        <div class="mix-segment" style="--height:${percent}%; --color:${color}">
          <strong>${((period.movement.closing * percent) / 100 / 1000).toFixed(1)}</strong>
          <span>${label}<br>(${percent}%)</span>
        </div>
      `;
    })
    .join("");

  const openingHeight = toBottom(opening);
  const closingHeight = toBottom(period.movement.closing);

  chart.innerHTML = `
    <div class="movement-tab">CSM 변동</div>
    <span class="chart-unit">(조원)</span>
    <div class="movement-chart">
      <div class="movement-step base" style="--bar-height:${openingHeight}px">
        <div class="total-value">${formatChartValue(opening).replace("+", "")}</div>
        <div class="total-bar">
          <span>기시<br>CSM</span>
        </div>
        <div class="axis-label">${openingLabel}</div>
      </div>
      ${deltaSteps}
      <div class="movement-step end" style="--bar-height:${closingHeight}px">
        <div class="total-value">${formatChartValue(period.movement.closing).replace("+", "")}</div>
        <div class="total-bar">
          <span>기말<br>CSM</span>
        </div>
        <div class="axis-label axis-strong">${selectedLabel}</div>
      </div>
      <div class="mix-bridge" aria-hidden="true"></div>
      <div class="mix-stack" aria-label="${company.name} 포트폴리오 CSM 구성">
        ${composition}
      </div>
    </div>
    <p class="movement-footnote">
      1) Open DART 원문 XML 및 재무제표 API 기준입니다. CSM 조정 등은 개별 공시에서 별도 제시하지 않은 자잘한 항목을 포함합니다.
    </p>
  `;

  const summary = document.querySelector("#movement-summary");
  const calculated =
    period.movement.opening +
    period.movement.newbiz +
    period.movement.interest +
    period.movement.amortization +
    period.movement.adjustment;
  const diff = calculated - period.movement.closing;
  summary.innerHTML = `
    <div><span>계산 기준 CSM</span><strong>${formatWon(calculated)}</strong></div>
    <div><span>공시 기준 CSM</span><strong>${formatWon(period.movement.closing)}</strong></div>
    <div><span>차이</span><strong>${formatChartValue(Math.abs(diff))}조</strong></div>
  `;

  document.querySelector("#quality-pill").textContent = period.quality;
  document.querySelector("#movement-title").textContent = `${company.name} CSM 변동`;
  document.querySelector("#movement-headline").textContent = period.summary;
}

function renderProfitView() {
  const { financial } = getCurrentData();
  const periodLabel = getSelectedPeriodLabel();
  const cards = [
    {
      label: "보험손익",
      value: formatWon(financial.insuranceProfit),
      note: financial.insuranceScope ?? "별도 보험서비스손익 기준",
    },
    {
      label: "투자손익",
      value: formatWon(financial.investmentProfit),
      note: financial.investmentScope ?? "관리 기준",
    },
    {
      label: "당기순이익",
      value: formatWon(financial.netIncome),
      note: financial.netIncomeScope ?? "당기순이익 기준",
    },
    {
      label: "K-ICS",
      value: formatKics(financial.kics),
      note: `${financial.kicsScope} 기준`,
    },
  ];

  document.querySelector("#profit-card-grid").innerHTML = cards
    .map((card) => {
      return `
        <article class="profit-card">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
          <small>${card.note}</small>
        </article>
      `;
    })
    .join("");

  const basisRows = [
    ["선택 기간", periodLabel],
    ["보험손익 기준", financial.insuranceScope ?? "별도 보험서비스손익 기준"],
    ["투자손익 기준", financial.investmentScope ?? "별도 투자손익 + 영업외손익 + 연결효과"],
    ["계산 메모", financial.investmentCalcNote ?? "추가 메모 없음"],
    ["당기순이익 기준", financial.netIncomeScope ?? "지배주주 연결손익 기준"],
    ["K-ICS 기준", financial.kicsScope ?? "지급여력 공시"],
  ];

  document.querySelector("#profit-basis-list").innerHTML = basisRows
    .map(([label, value]) => {
      return `
        <div class="basis-row">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `;
    })
    .join("");

  const insightItems = [
    `보험손익은 ${financial.insuranceScope ?? "별도 보험서비스손익 기준"}으로 표시합니다.`,
    `투자손익은 ${financial.investmentScope ?? "관리 기준"} 라벨을 사용하고, 계산 메모를 함께 노출합니다.`,
    `당기순이익은 ${financial.netIncomeScope ?? "지배주주 연결손익 기준"} 기준으로 비교합니다.`,
  ];

  document.querySelector("#profit-insight-list").innerHTML = insightItems
    .map((item) => `<div class="insight-item">${item}</div>`)
    .join("");
}

function renderPortfolioView() {
  const { company, period } = getCurrentData();
  const stack = document.querySelector("#portfolio-stack");
  const list = document.querySelector("#portfolio-list");

  const segments = period.mix.map(([label, percent, color]) => {
    return {
      label,
      percent,
      color,
      amount: (period.movement.closing * percent) / 100,
    };
  });

  stack.innerHTML = `
    <div class="portfolio-stack-bar" aria-label="${company.name} 보유 CSM 구성">
      ${segments
        .map((segment) => {
          return `
            <div class="portfolio-stack-segment" style="--height:${segment.percent}%; --color:${segment.color}">
              <strong>${segment.percent}%</strong>
              <span>${segment.label}</span>
            </div>
          `;
        })
        .join("")}
    </div>
    <div class="portfolio-stack-caption">
      <strong>기말 보유 CSM ${formatWon(period.movement.closing)}</strong>
      <span>구성 비중은 현재 선택 기간 기준입니다.</span>
    </div>
  `;

  list.innerHTML = segments
    .sort((a, b) => b.percent - a.percent)
    .map((segment) => {
      return `
        <article class="portfolio-item">
          <div>
            <span>${segment.label}</span>
            <strong>${segment.percent}%</strong>
          </div>
          <small>${formatWon(segment.amount)} 규모</small>
        </article>
      `;
    })
    .join("");
}

function renderTrendView() {
  const { company, companyKey } = getCurrentData();
  const body = document.querySelector("#trend-table-body");
  const summary = document.querySelector("#trend-summary");
  const periodKeys = getSortedPeriodKeys(company);
  const selectedPeriod = periodSelect.value;

  body.innerHTML = periodKeys
    .map((periodKey) => {
      const period = company.periods[periodKey];
      const financial = financialMetrics[companyKey]?.[periodKey];
      const isSelected = periodKey === selectedPeriod;
      return `
        <tr class="${isSelected ? "is-selected" : ""}">
          <td>${getPeriodLabel(periodKey)}</td>
          <td>${formatWon(period.csm)}</td>
          <td>${formatGrowth(period.growth)}</td>
          <td>${formatWon(financial.insuranceProfit)}</td>
          <td>${formatWon(financial.investmentProfit)}</td>
          <td>${formatWon(financial.netIncome)}</td>
          <td>${formatKics(financial.kics)}</td>
        </tr>
      `;
    })
    .join("");

  const earliestPeriodKey = periodKeys[0];
  const latestPeriodKey = periodKeys.at(-1);
  const earliestPeriod = company.periods[earliestPeriodKey];
  const latestPeriod = company.periods[latestPeriodKey];
  const latestFinancial = financialMetrics[companyKey]?.[latestPeriodKey];

  summary.innerHTML = `
    <article class="change-card">
      <span>기간 CSM 변동</span>
      <strong>${formatWon(latestPeriod.csm - earliestPeriod.csm)}</strong>
      <small>${getPeriodLabel(earliestPeriodKey)} - ${getPeriodLabel(latestPeriodKey)}</small>
    </article>
    <article class="change-card">
      <span>최신 보험손익</span>
      <strong>${formatWon(latestFinancial.insuranceProfit)}</strong>
      <small>${getPeriodLabel(latestPeriodKey)} 기준</small>
    </article>
    <article class="change-card">
      <span>최신 K-ICS</span>
      <strong>${formatKics(latestFinancial.kics)}</strong>
      <small>공시 기준 요약</small>
    </article>
  `;
}

function getMarketRows() {
  const sortKey = marketSortSelect?.value ?? "csm";
  const filterKey = marketFilterSelect?.value ?? "all";

  const rows = supportedCompanies
    .map((companyKey) => {
      const company = sampleData[companyKey];
      const period = company.periods[periodSelect.value];
      const financial = financialMetrics[companyKey]?.[periodSelect.value];
      return {
        companyKey,
        company,
        period,
        financial,
      };
    })
    .filter((row) => {
      if (filterKey === "life") return row.company.sector.includes("생명");
      if (filterKey === "non-life") return row.company.sector.includes("손해");
      return true;
    });

  const accessor = {
    csm: (row) => row.period.csm,
    growth: (row) => row.period.growth,
    insurance: (row) => row.financial.insuranceProfit,
    investment: (row) => row.financial.investmentProfit,
    kics: (row) => row.financial.kics,
  }[sortKey];

  return rows.sort((a, b) => accessor(b) - accessor(a));
}

function renderMarketTopline(rows) {
  const topline = document.querySelector("#market-topline");
  if (!topline) return;

  const leaders = [
    ["보유 CSM 선두", rows[0], (row) => formatWon(row.period.csm)],
    [
      "성장률 선두",
      [...rows].sort((a, b) => b.period.growth - a.period.growth)[0],
      (row) => formatGrowth(row.period.growth),
    ],
    [
      "보험손익 선두",
      [...rows].sort((a, b) => b.financial.insuranceProfit - a.financial.insuranceProfit)[0],
      (row) => formatWon(row.financial.insuranceProfit),
    ],
    [
      "K-ICS 선두",
      [...rows].sort((a, b) => b.financial.kics - a.financial.kics)[0],
      (row) => formatKics(row.financial.kics),
    ],
  ];

  topline.innerHTML = leaders
    .filter(([, row]) => row)
    .map(([label, row, formatter]) => {
      return `
        <article class="market-top-card">
          <span>${label}</span>
          <strong>${row.company.name}</strong>
          <small>${formatter(row)}</small>
        </article>
      `;
    })
    .join("");
}

function syncMarketPeerOptions(rows) {
  if (!marketPeerSelect) return;

  const currentCompany = getCurrentCompanyKey();
  const candidateKeys = rows
    .map((row) => row.companyKey)
    .filter((companyKey) => companyKey !== currentCompany);
  const fallbackKey =
    candidateKeys[0] ??
    supportedCompanies.find((companyKey) => companyKey !== currentCompany);

  marketPeerSelect.innerHTML = candidateKeys.length
    ? candidateKeys
      .map((companyKey) => {
        return `<option value="${companyKey}">${sampleData[companyKey].name}</option>`;
      })
      .join("")
    : fallbackKey
      ? `<option value="${fallbackKey}">${sampleData[fallbackKey].name}</option>`
      : "";

  if (fallbackKey && !candidateKeys.includes(marketPeerSelect.value)) {
    marketPeerSelect.value = fallbackKey;
  }
}

function renderMarketDrilldown(rows) {
  const drilldown = document.querySelector("#market-drilldown");
  const ranking = document.querySelector("#market-ranking");
  if (!drilldown || !ranking) return;

  const currentKey = getCurrentCompanyKey();
  const currentRow = rows.find((row) => row.companyKey === currentKey);
  const peerKey = marketPeerSelect?.value;
  const peerRow = rows.find((row) => row.companyKey === peerKey);

  if (!currentRow || !peerRow) {
    drilldown.innerHTML = `<p class="review-empty">비교 가능한 회사 조합이 부족합니다.</p>`;
    ranking.innerHTML = "";
    return;
  }

  const comparisons = [
    ["보유 CSM", currentRow.period.csm, peerRow.period.csm, formatWon],
    ["성장률", currentRow.period.growth, peerRow.period.growth, formatGrowth],
    [
      "보험손익",
      currentRow.financial.insuranceProfit,
      peerRow.financial.insuranceProfit,
      formatWon,
    ],
    [
      "투자손익",
      currentRow.financial.investmentProfit,
      peerRow.financial.investmentProfit,
      formatWon,
    ],
    ["K-ICS", currentRow.financial.kics, peerRow.financial.kics, formatKics],
  ];

  drilldown.innerHTML = comparisons
    .map(([label, currentValue, peerValue, formatter]) => {
      const diff = currentValue - peerValue;
      return `
        <div class="drilldown-row">
          <div>
            <span>${label}</span>
            <strong>${currentRow.company.name} ${formatter(currentValue)}</strong>
          </div>
          <div>
            <span>비교 회사</span>
            <strong>${peerRow.company.name} ${formatter(peerValue)}</strong>
          </div>
          <small>차이 ${formatter(diff)}</small>
        </div>
      `;
    })
    .join("");

  const csmRank = rows.findIndex((row) => row.companyKey === currentKey) + 1;
  const insuranceRank =
    [...rows]
      .sort((a, b) => b.financial.insuranceProfit - a.financial.insuranceProfit)
      .findIndex((row) => row.companyKey === currentKey) + 1;

  ranking.innerHTML = `
    <div class="insight-item">선택 회사는 현재 필터 기준 보유 CSM ${csmRank}위입니다.</div>
    <div class="insight-item">보험손익 순위는 ${insuranceRank}위입니다.</div>
    <div class="insight-item">주요 특성은 ${currentRow.company.type}이고, 비교 회사는 ${peerRow.company.type}입니다.</div>
  `;
}

function renderComparison() {
  const rows = getMarketRows();
  syncMarketPeerOptions(rows);
  renderMarketTopline(rows);
  renderMarketDrilldown(rows);

  document.querySelector("#comparison-table").innerHTML = rows
    .map(({ company, financial, period }) => {
      return `
        <tr>
          <td>${company.name}</td>
          <td>CSM ${financial.csmScope}<br>손익 ${financial.profitScope}</td>
          <td>${formatWon(period.csm)}</td>
          <td>${formatGrowth(period.growth)}</td>
          <td>${formatWon(financial.insuranceProfit)}</td>
          <td>${formatWon(financial.investmentProfit)}</td>
          <td>${formatWon(financial.netIncome)}</td>
          <td>${formatKics(financial.kics)}</td>
          <td>${company.type}</td>
        </tr>
      `;
    })
    .join("");
}

function calculateNumericForecast(company) {
  const scenario = forecastScenarios[scenarioSelect.value];
  const periodInfo = getForecastPeriodInfo(company);
  const basisPeriod = company.periods[periodInfo.basisPeriodKey];
  const opening = basisPeriod.movement.closing;
  let projectedClosing = opening;
  let projectedNewbiz = 0;
  let projectedInterest = 0;
  let projectedAmortization = 0;
  let projectedAdjustment = 0;

  for (let index = 0; index < periodInfo.remainingQuarters; index += 1) {
    const quarterNewbiz = basisPeriod.movement.newbiz * scenario.newbizFactor;
    const quarterInterest = projectedClosing * scenario.interestRate;
    const quarterAmortization = projectedClosing * scenario.amortRate;
    const quarterAdjustment = projectedClosing * scenario.adjustmentRate;

    projectedNewbiz += quarterNewbiz;
    projectedInterest += quarterInterest;
    projectedAmortization += quarterAmortization;
    projectedAdjustment += quarterAdjustment;
    projectedClosing =
      projectedClosing +
      quarterNewbiz +
      quarterInterest -
      quarterAmortization +
      quarterAdjustment;
  }

  const profitAmortizationBase =
    projectedAmortization > 0
      ? projectedAmortization
      : opening * scenario.amortRate;
  const profitNewbizBase =
    projectedNewbiz > 0
      ? projectedNewbiz
      : basisPeriod.movement.newbiz * scenario.newbizFactor;
  const riskAdjustmentRelease =
    profitAmortizationBase * scenario.riskAdjustmentRate;
  const experienceMargin = profitNewbizBase * scenario.experienceRate;
  const insuranceProfit =
    profitAmortizationBase + riskAdjustmentRelease + experienceMargin;
  const investmentProfit =
    company.profitBase.investment * scenario.investmentFactor;
  const pretaxProfit =
    insuranceProfit + investmentProfit + company.profitBase.other;

  return {
    scenario,
    periodInfo,
    basisPeriod,
    opening,
    projectedNewbiz,
    projectedInterest,
    projectedAmortization,
    projectedAdjustment,
    projectedClosing,
    insuranceProfit,
    investmentProfit,
    pretaxProfit,
  };
}

function renderForecastMovementDetail(projection) {
  const movementRows = [
    ["최신 공시 보유 CSM", projection.opening],
    ["신계약 CSM 전망", projection.projectedNewbiz],
    ["이자부리 전망", projection.projectedInterest],
    ["CSM 조정 등 전망", projection.projectedAdjustment],
    ["CSM 상각 전망", -projection.projectedAmortization],
    ["연말 보유 CSM 전망", projection.projectedClosing],
  ];

  const rowMarkup = movementRows
    .map(([label, value]) => {
      const isFinal = label.includes("연말");
      return `
        <div class="${isFinal ? "forecast-movement-final" : ""}">
          <span>${label}</span>
          <strong>${formatWon(value)}</strong>
        </div>
      `;
    })
    .join("");

  forecastMovementDetail.innerHTML = `
    <div class="forecast-movement-heading">
      <strong>${projection.periodInfo.targetYearEndLabel} CSM Movement 전망</strong>
      <span>${projection.periodInfo.basisLabel} 최신 공시 기준으로 남은 ${projection.periodInfo.remainingQuarters}개 분기를 추정합니다.</span>
    </div>
    <div class="forecast-movement-grid">
      ${rowMarkup}
    </div>
  `;
}

function renderForecast() {
  const { company } = getCurrentData();
  const projection = calculateNumericForecast(company);
  const csmChange = projection.projectedClosing - projection.opening;
  const selectedLabel = getSelectedPeriodLabel();
  const horizonText =
    `${projection.periodInfo.basisLabel} 최신 공시값에서 ${projection.periodInfo.targetYearEndLabel}까지 ` +
    `남은 ${projection.periodInfo.remainingQuarters}개 분기를 추정합니다.`;

  document.querySelector("#forecast-summary").textContent =
    `${company.name} 전망은 선택 기간 ${selectedLabel}과 무관하게 대시보드에 입력된 최신 검증 기간 ` +
    `${projection.periodInfo.basisLabel} 기준으로만 제공합니다. ${projection.scenario.label} 시나리오에서 ` +
    `${projection.periodInfo.targetYearEndLabel} 보유 CSM은 ${formatWon(projection.projectedClosing)}, ` +
    `보험손익은 ${formatWon(projection.insuranceProfit)}, 투자손익은 ${formatWon(projection.investmentProfit)}로 추정합니다. ${horizonText}`;

  document.querySelector("#projection-csm").textContent = formatWon(
    projection.projectedClosing,
  );
  document.querySelector("#projection-csm-target").textContent =
    `전망 시점: ${projection.periodInfo.targetYearEndLabel}`;
  document.querySelector("#projection-csm-change").textContent =
    `${csmChange >= 0 ? "+" : ""}${formatWon(csmChange)} vs ${projection.periodInfo.basisLabel}`;
  document.querySelector("#projection-insurance").textContent = formatWon(
    projection.insuranceProfit,
  );
  document.querySelector("#projection-investment").textContent = formatWon(
    projection.investmentProfit,
  );
  document.querySelector("#projection-net").textContent = formatWon(
    projection.pretaxProfit,
  );
  document.querySelector("#forecast-method").textContent =
    `보유 CSM은 최신 공시 기간(${projection.periodInfo.basisLabel})의 기말 CSM에서 시작해 ` +
    `${projection.periodInfo.targetYearEndLabel}까지 Movement roll-forward로 계산합니다. ` +
    `과거 선택 기간은 이미 실적값이 있으므로 별도 전망값을 노출하지 않습니다. 손익 전망은 ` +
    `CSM 상각과 위험조정 방출 proxy, 투자손익 run-rate를 결합한 초안입니다.`;
  document.querySelector("#assumption-list").innerHTML = `
    <li>전망 기준: ${projection.periodInfo.basisLabel} 최신 공시값</li>
    <li>전망 시점: ${projection.periodInfo.targetYearEndLabel}</li>
    <li>신계약 CSM: 최신 공시 신계약 CSM의 ${(projection.scenario.newbizFactor * 100).toFixed(0)}%</li>
    <li>이자부리: 보유 CSM의 ${(projection.scenario.interestRate * 100).toFixed(1)}%</li>
    <li>CSM 상각: 보유 CSM의 ${(projection.scenario.amortRate * 100).toFixed(1)}%</li>
    <li>CSM 조정 등: 보유 CSM의 ${(projection.scenario.adjustmentRate * 100).toFixed(1)}%</li>
  `;

  renderForecastMovementDetail(projection);
  forecastMovementDetail.hidden = false;
  document.querySelector("#forecast-csm").textContent =
    projection.basisPeriod.forecast.csm;
  document.querySelector("#forecast-insurance").textContent =
    projection.basisPeriod.forecast.insurance;
  document.querySelector("#forecast-investment").textContent =
    projection.basisPeriod.forecast.investment;
}

function getAiCompanyPeriodKey() {
  const company = sampleData[getCurrentCompanyKey()];
  return company ? getLatestPeriodKey(company) : periodSelect.value;
}

function formatAiStatusLabel(status) {
  const labels = {
    passed: "검증 통과",
    needs_review: "검증 필요",
    failed: "검증 실패",
    warning: "주의",
  };

  return labels[status] ?? status;
}

function ensureAiConversationScope(companyKey) {
  if (aiConversationCompany !== companyKey) {
    aiConversation = [];
    aiConversationCompany = companyKey;
  }
}

function normalizeAiTitle(title) {
  const labels = {
    "Executive briefing": "요약 브리프",
    "Summary briefing": "요약 브리프",
  };

  return labels[title] ?? title;
}

function createAiListBlock(title, items) {
  if (!Array.isArray(items) || !items.length) return null;

  const block = document.createElement("div");
  block.className = "ai-card-block";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const list = document.createElement("ul");
  items.forEach((item) => {
    const li = document.createElement("li");
    if (typeof item === "string") {
      li.textContent = item;
    } else if (item && typeof item === "object") {
      const label = item.label ?? "";
      const value = item.value ?? "";
      const formula = item.formula ? `${item.formula} = ` : "";
      li.textContent = formula
        ? `${label}: ${formula}${value}`
        : `${label}: ${value}`;
    } else {
      li.textContent = String(item);
    }
    list.append(li);
  });

  block.append(heading, list);
  return block;
}

function createAiCard(card, focusKey) {
  const article = document.createElement("article");
  article.className = "ai-card";
  article.dataset.focus = String(card.key === focusKey);

  const head = document.createElement("div");
  head.className = "ai-card-head";

  const title = document.createElement("h4");
  title.className = "ai-card-title";
  title.textContent = normalizeAiTitle(card.title);

  const status = document.createElement("span");
  status.className = "ai-card-status";
  status.dataset.status = card.status;
  status.textContent = formatAiStatusLabel(card.status);

  head.append(title, status);

  const summary = document.createElement("p");
  summary.className = "ai-card-summary";
  summary.textContent = card.summary;

  const evidenceBlock = createAiListBlock("근거", card.evidence);
  const calculationBlock = createAiListBlock("계산", card.calculation);
  const followUpBlock = createAiListBlock("다음 질문", card.followUps);

  article.append(head, summary);
  if (evidenceBlock) article.append(evidenceBlock);
  if (calculationBlock) article.append(calculationBlock);
  if (followUpBlock) article.append(followUpBlock);

  return article;
}

function renderAiCards(response) {
  if (!aiInsightCards) return;

  if (!response?.insightCards?.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = "AI 인사이트를 아직 불러오지 못했습니다.";
    aiInsightCards.replaceChildren(empty);
    return;
  }

  const focusKey =
    response.analysisType === "chat" ? "briefing" : response.analysisType;
  aiInsightCards.replaceChildren(
    ...response.insightCards.map((card) => createAiCard(card, focusKey)),
  );
}

function renderAiThread() {
  if (!aiChatThread) return;

  if (!aiConversation.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = "질문을 보내면 답변이 여기에 쌓입니다.";
    aiChatThread.replaceChildren(empty);
    return;
  }

  const nodes = aiConversation.map((message) => {
    const article = document.createElement("article");
    article.className = `ai-message ai-message-${message.role}`;

    const meta = document.createElement("div");
    meta.className = "ai-message-meta";

    const role = document.createElement("strong");
    role.textContent = message.role === "user" ? "사용자" : "AI";

    const status = document.createElement("span");
    status.textContent =
      message.role === "assistant" && message.validationStatus
        ? formatAiStatusLabel(message.validationStatus)
        : message.role === "user"
          ? "질문"
          : "응답";

    meta.append(role, status);

    const body = document.createElement("div");
    body.className = "ai-message-body";

    if (message.role === "user") {
      body.textContent = message.text;
    } else {
      const title = document.createElement("div");
      title.textContent = message.title || "응답";
      title.style.fontWeight = "850";
      title.style.marginBottom = "6px";

      const summary = document.createElement("div");
      summary.textContent = message.summary || "";
      summary.style.marginBottom = "8px";

      const list = document.createElement("ul");
      list.style.margin = "0";
      list.style.paddingLeft = "16px";
      list.style.display = "grid";
      list.style.gap = "4px";
      (message.bullets || []).forEach((bullet) => {
        const li = document.createElement("li");
        li.textContent = bullet;
        list.append(li);
      });

      body.append(title, summary, list);
    }

    article.append(meta, body);
    return article;
  });

  aiChatThread.replaceChildren(...nodes);
}

function renderAiStatus(response) {
  if (!response) return;

  if (aiSnapshotStatus) {
    aiSnapshotStatus.textContent =
      `스냅샷 ${String(response.snapshotHash || "").slice(0, 12)}`;
  }
  if (aiPeriodStatus) {
    aiPeriodStatus.textContent =
      `기준 ${response.companyName} | ${response.periodLabel}`;
  }
  if (aiValidationStatus) {
    aiValidationStatus.textContent =
      `검증 ${formatAiStatusLabel(response.validationStatus)}`;
  }
}

function renderAiError(message) {
  if (aiSnapshotStatus) aiSnapshotStatus.textContent = "AI 분석 실패";
  if (aiPeriodStatus) aiPeriodStatus.textContent = "기준 기간 -";
  if (aiValidationStatus) aiValidationStatus.textContent = "검증 상태 -";

  if (!aiInsightCards) return;
  const article = document.createElement("article");
  article.className = "ai-card";

  const head = document.createElement("div");
  head.className = "ai-card-head";

  const title = document.createElement("h4");
  title.className = "ai-card-title";
  title.textContent = "AI 게이트웨이 오류";

  const status = document.createElement("span");
  status.className = "ai-card-status";
  status.dataset.status = "failed";
  status.textContent = "오류";

  head.append(title, status);

  const summary = document.createElement("p");
  summary.className = "ai-card-summary";
  summary.textContent = message;

  article.append(head, summary);
  aiInsightCards.replaceChildren(article);
}

function renderAiContext() {
  const context = tabAiContexts[state.activeTab];
  const description = document.querySelector("#ai-context-description");
  const list = document.querySelector("#ai-context-list");

  if (description) {
    description.textContent = context.description;
  }

  if (list) {
    list.innerHTML = context.prompts
      .map((prompt) => `<button type="button" class="context-pill">${prompt}</button>`)
      .join("");

    [...list.querySelectorAll(".context-pill")].forEach((button) => {
      button.addEventListener("click", () => {
        if (aiChatInput) aiChatInput.value = button.textContent ?? "";
        setAiDrawerOpen(true);
      });
    });
  }

  if (aiFocusSelect && aiFocusSelect.value !== context.focus) {
    aiFocusSelect.value = context.focus;
  }
}

function getPreviousPeriodKeyForCompany(company, periodKey) {
  const ordered = getSortedPeriodKeys(company);
  const currentIndex = ordered.indexOf(periodKey);
  if (currentIndex <= 0) return null;
  return ordered[currentIndex - 1];
}

function summarizeReviewStateForPeriod(companyKey, periodKey) {
  const items = reviewItems.filter(
    (item) => item.company === companyKey && item.period === periodKey,
  );

  const counts = {
    total: items.length,
    passed: 0,
    needsReview: 0,
    failed: 0,
  };

  items.forEach((item) => {
    if (item.status === "passed") counts.passed += 1;
    if (item.status === "needs_review") counts.needsReview += 1;
    if (item.status === "failed") counts.failed += 1;
  });

  const status = counts.failed > 0 ? "failed" : counts.needsReview > 0 ? "needs_review" : "passed";
  return { status, ...counts };
}

function buildLocalAiPeriodScope(periodKey) {
  const { year, quarter } = parsePeriodKey(periodKey);
  const targetYear = quarter === 4 ? year + 1 : year;
  return {
    mode: "latest-validated",
    label: getPeriodLabel(periodKey),
    periodKey,
    periodLabel: getPeriodLabel(periodKey),
    targetYearEndLabel: `${targetYear}년 말`,
  };
}

function buildLocalAiResponse({
  companyKey,
  periodKey,
  analysisType = "briefing",
  mode = "analysis",
  question = null,
}) {
  const company = sampleData[companyKey];
  const financial = financialMetrics[companyKey]?.[periodKey];
  const period = company?.periods?.[periodKey];

  if (!company || !financial || !period) {
    throw new Error(`missing company-period data: ${companyKey}.${periodKey}`);
  }

  const periodScope = buildLocalAiPeriodScope(periodKey);
  const reviewState = summarizeReviewStateForPeriod(companyKey, periodKey);
  const previousPeriodKey = getPreviousPeriodKeyForCompany(company, periodKey);
  const previousPeriod = previousPeriodKey ? company.periods[previousPeriodKey] : null;
  const peerCompanyKey = supportedCompanies.find((key) => key !== companyKey) ?? null;
  const peerCompany = peerCompanyKey ? sampleData[peerCompanyKey] : null;
  const peerPeriodKey = peerCompany?.periods?.[periodKey] ? periodKey : getLatestPeriodKey(peerCompany ?? company);
  const peerFinancial = peerCompany ? financialMetrics[peerCompanyKey]?.[peerPeriodKey] : null;
  const movement = period.movement;
  const reviewLabel = formatAiStatusLabel(reviewState.status);

  const cards = [
    {
      key: "anomaly",
      title: "이상변화 감지",
      status: reviewState.status === "passed" ? "passed" : "warning",
      summary: previousPeriod
        ? `${company.name}은 직전 분기 대비 보유 CSM이 ${formatSignedTrillion(period.csm - previousPeriod.csm)} 변했고, 성장률은 ${formatSignedPercent(period.growth - previousPeriod.growth)}p 움직였습니다. 검증 상태는 ${reviewLabel}입니다.`
        : `${company.name}의 최신 검증 기간은 ${periodScope.periodLabel}이며, 검증 상태는 ${reviewLabel}입니다.`,
      evidence: [
        { label: "기준 기간", value: periodScope.periodLabel },
        { label: "검증 상태", value: reviewLabel },
        { label: "직전 기간 보유 CSM", value: previousPeriod ? formatWon(previousPeriod.csm) : "n/a" },
        { label: "현재 보유 CSM", value: formatWon(period.csm) },
      ],
      calculation: previousPeriod
        ? [
            {
              label: "CSM QoQ 변화",
              formula: `${formatWon(period.csm)} - ${formatWon(previousPeriod.csm)}`,
              value: formatSignedTrillion(period.csm - previousPeriod.csm),
            },
            {
              label: "성장률 변화",
              formula: `${period.growth.toFixed(1)}% - ${previousPeriod.growth.toFixed(1)}%`,
              value: `${formatSignedPercent(period.growth - previousPeriod.growth)}p`,
            },
          ]
        : [
            {
              label: "CSM 변화",
              formula: "직전 기간 없음",
              value: formatWon(period.csm),
            },
          ],
      followUps: [
        "직전 기간 대비 손익과 CSM 조정 등 항목을 함께 확인해보세요.",
        reviewState.status === "needs_review" || reviewState.status === "failed"
          ? "검증 상태가 좋지 않으면 원문 수치와 검토 내역을 먼저 확인하세요."
          : "검증 상태가 통과이면 같은 기준으로 peer 비교를 이어보세요.",
      ],
    },
    {
      key: "movement",
      title: "CSM Movement 원인분해",
      status: reviewState.status === "failed" ? "warning" : "passed",
      summary: `${company.name}의 CSM은 ${formatWon(movement.opening)}에서 ${formatWon(movement.closing)}로 ${formatSignedTrillion(period.csm - movement.opening)} 변했습니다. 신계약, 이자부리, CSM 조정 등, 상각의 흐름을 함께 보면 변동 원인을 구조적으로 볼 수 있습니다.`,
      evidence: [
        { label: "기시 CSM", value: formatWon(movement.opening) },
        { label: "신계약 CSM", value: formatWon(movement.newbiz) },
        { label: "이자부리", value: formatWon(movement.interest) },
        { label: "CSM 조정 등", value: formatWon(movement.adjustment) },
        { label: "CSM 상각", value: formatWon(movement.amortization) },
        { label: "기말 CSM", value: formatWon(movement.closing) },
      ],
      calculation: [
        {
          label: "Movement 합계",
          formula: `${formatWon(movement.opening)} + ${formatWon(movement.newbiz)} + ${formatWon(movement.interest)} + ${formatWon(movement.adjustment)} + ${formatWon(movement.amortization)}`,
          value: formatWon(movement.opening + movement.newbiz + movement.interest + movement.adjustment + movement.amortization),
        },
        {
          label: "공시 기말 CSM",
          formula: "원문 공시 기준",
          value: formatWon(movement.closing),
        },
      ],
      followUps: [
        "신계약과 이자부리의 기여를 먼저 보고, 이후 조정과 상각을 확인해보세요.",
        "CSM 조정 등에는 가정변경 같은 자잘한 항목이 함께 포함될 수 있습니다.",
      ],
    },
    {
      key: "peer",
      title: "Peer 비교",
      status: peerCompany && peerFinancial ? "passed" : "warning",
      summary: peerCompany && peerFinancial
        ? `${company.name}과 ${peerCompany.name}를 같은 기간 기준으로 비교했습니다. 보유 CSM과 K-ICS의 차이를 먼저 보면 상대적인 안정성을 읽기 쉽습니다.`
        : "Peer 비교에 필요한 상대 회사 데이터를 찾지 못했습니다.",
      evidence: peerCompany && peerFinancial
        ? [
            { label: "비교 회사", value: peerCompany.name },
            { label: "보유 CSM", value: `${company.name} ${formatWon(period.csm)} / ${peerCompany.name} ${formatWon(peerCompany.periods?.[peerPeriodKey]?.csm ?? 0)}` },
            { label: "보험손익", value: `${company.name} ${formatWon(financial.insuranceProfit)} / ${peerCompany.name} ${formatWon(peerFinancial.insuranceProfit)}` },
            { label: "투자손익", value: `${company.name} ${formatWon(financial.investmentProfit)} / ${peerCompany.name} ${formatWon(peerFinancial.investmentProfit)}` },
            { label: "당기순이익", value: `${company.name} ${formatWon(financial.netIncome)} / ${peerCompany.name} ${formatWon(peerFinancial.netIncome)}` },
            { label: "K-ICS", value: `${company.name} ${formatKics(financial.kics)} / ${peerCompany.name} ${formatKics(peerFinancial.kics)}` },
          ]
        : [],
      calculation: peerCompany && peerFinancial
        ? [
            {
              label: "보유 CSM 차이",
              formula: `${formatWon(period.csm)} - ${formatWon(peerCompany.periods?.[peerPeriodKey]?.csm ?? 0)}`,
              value: formatSignedTrillion(period.csm - (peerCompany.periods?.[peerPeriodKey]?.csm ?? 0)),
            },
            {
              label: "K-ICS 차이",
              formula: `${formatKics(financial.kics)} - ${formatKics(peerFinancial.kics)}`,
              value: `${(financial.kics - peerFinancial.kics).toFixed(1)}p`,
            },
          ]
        : [],
      followUps: [
        "보유 CSM, 보험손익, 투자손익, 당기순이익을 같은 분기 기준으로 같이 보세요.",
        "회사별 기준이 다르면 먼저 데이터 품질 탭에서 기준과 검증 상태를 확인하세요.",
      ],
    },
    {
      key: "briefing",
      title: "요약 브리프",
      status: reviewState.status === "passed" ? "passed" : "warning",
      summary:
        `${company.name}의 ${periodScope.periodLabel} 기준 보유 CSM은 ${formatWon(period.csm)}, 보험손익은 ${formatWon(financial.insuranceProfit)}, 투자손익은 ${formatWon(financial.investmentProfit)}, 당기순이익은 ${formatWon(financial.netIncome)}, K-ICS는 ${formatKics(financial.kics)}입니다.`,
      evidence: [
        { label: "검증 상태", value: reviewLabel },
        { label: "보유 CSM", value: formatWon(period.csm) },
        { label: "보험손익", value: formatWon(financial.insuranceProfit) },
        { label: "투자손익", value: formatWon(financial.investmentProfit) },
        { label: "당기순이익", value: formatWon(financial.netIncome) },
        { label: "K-ICS", value: formatKics(financial.kics) },
      ],
      calculation: [
        {
          label: "전망 기준",
          formula: `${periodScope.label} 최신 검증 공시`,
          value: periodScope.targetYearEndLabel,
        },
        {
          label: "peer 참고",
          formula: peerCompany && peerFinancial ? `${peerCompany.name} 비교 가능` : "peer data unavailable",
          value: peerCompany && peerFinancial ? formatWon(peerCompany.periods?.[peerPeriodKey]?.csm ?? 0) : "n/a",
        },
      ],
      followUps: [
        "같은 기준으로 다른 분기와 비교하면 추세가 더 잘 드러납니다.",
        "검증 필요 상태라면 데이터 품질 탭을 먼저 확인하세요.",
      ],
    },
  ];

  const focusKey = analysisType === "chat" ? "briefing" : analysisType;
  const focusCard = cards.find((card) => card.key === focusKey) ?? cards[cards.length - 1];

  return {
    dataKind: "actual",
    mode,
    audience: "practitioner",
    analysisType,
    company: companyKey,
    companyName: company.name,
    period: periodKey,
    periodLabel: periodScope.periodLabel,
    periodScope,
    validationStatus: reviewState.status,
    reviewState,
    snapshotHash: `local-fallback-${companyKey}-${periodKey}`,
    generatedAt: agentDashboardData.generatedAt ?? new Date().toISOString(),
    basis: {
      csm: "별도재무제표 기준, 재보험 제외",
      insuranceProfit: "별도 보험서비스손익 기준",
      investmentProfit: "별도 투자손익 + 영업외손익 + 연결효과",
      netIncome: "지배주주 연결손익 기준",
      kics: "지급여력 공시 기준",
    },
    answer: {
      title: focusCard.title,
      summary:
        mode === "chat" && question
          ? `질문 "${question}"에 대한 답변입니다. ${focusCard.summary}`
          : focusCard.summary,
      bullets:
        mode === "chat" && question
          ? [focusCard.summary, ...focusCard.followUps.slice(0, 1)]
          : [focusCard.summary, ...focusCard.followUps.slice(0, 2)],
      note: "로컬 fallback 응답",
    },
    insightCards: cards,
    evidence: focusCard.evidence,
    calculation: focusCard.calculation,
    followUps: focusCard.followUps,
    unsupportedReason: null,
  };
}

function formatAgentStatusLabel(status) {
  const labels = {
    idle: "대기",
    running: "실행 중",
    completed: "완료",
    needs_review: "검토 필요",
    failed: "실패",
    not_required: "검토 없음",
  };

  return labels[status] ?? status;
}

function formatAgentTimestamp(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setAgentControlLock(isLocked) {
  companySelect.disabled = isLocked;
  periodSelect.disabled = isLocked;
  if (agentTargetSelect) {
    agentTargetSelect.disabled = isLocked || !(state.agentTargets.targets?.length);
  }
  if (agentRunButton) {
    agentRunButton.disabled = isLocked || !getSelectedAgentTarget();
    agentRunButton.textContent = isLocked ? "실행 중..." : "에이전트 실행";
  }
}

function renderAgentTimeline() {
  if (!agentRunTimeline) return;

  agentRunTimeline.innerHTML = state.agentRun.stages
    .map((stage) => {
      return `
        <article class="agent-stage" data-status="${stage.status}">
          <div class="agent-stage-head">
            <strong class="agent-stage-title">${stage.label}</strong>
            <span class="agent-stage-status">${formatAgentStatusLabel(stage.status)}</span>
          </div>
          <p class="agent-stage-message">${stage.message || "실행 대기"}</p>
        </article>
      `;
    })
    .join("");
}

function renderAgentRunState() {
  if (agentRunLiveStatus) {
    agentRunLiveStatus.dataset.status = state.agentRun.status;
    agentRunLiveStatus.textContent = formatAgentStatusLabel(state.agentRun.status);
  }

  if (agentSnapshotKind) {
    const dataKind = getDashboardDataKind();
    agentSnapshotKind.dataset.kind = dataKind;
    agentSnapshotKind.textContent = dataKind === "actual" ? "실데이터" : "실데이터 아님";
  }

  if (agentLastRunAt) {
    agentLastRunAt.textContent = `마지막 실행 ${formatAgentTimestamp(state.agentRun.lastUpdatedAt)}`;
  }

  if (agentLastRunResult) {
    const finalStage = state.agentRun.stages.at(-1);
    let resultText = "마지막 결과 -";

    if (state.agentRun.status === "running") {
      resultText = "마지막 결과 자동 단계 진행 중";
    } else if (state.agentRun.status === "completed") {
      resultText =
        finalStage?.status === "needs_review"
          ? "마지막 결과 검산 완료 · 휴먼리뷰 검토 필요"
          : "마지막 결과 검산 완료 · 휴먼리뷰 없음";
    } else if (state.agentRun.status === "failed") {
      resultText = "마지막 결과 검산 실패";
    }

    agentLastRunResult.textContent = resultText;
  }

  if (agentRunNote) {
    agentRunNote.textContent = state.agentRun.failureReason
      || (state.agentTargets.targets?.length
        ? "실행 실패 시 마지막 검증 완료 스냅샷은 유지되고, 단계 상태와 실패 사유만 갱신됩니다."
        : "현재는 미완료 실행 대상이 없어 에이전트 실행이 비활성화되어 있습니다.");
  }

  setAgentControlLock(state.agentRun.status === "running");
  renderAgentTimeline();
}

function setAgentRunState(nextState) {
  const defaultStages = createDefaultAgentStages();
  state.agentRun = {
    ...state.agentRun,
    ...nextState,
    stages: nextState.stages ?? state.agentRun.stages ?? defaultStages,
  };
  renderAgentRunState();
}

function clearAgentRunPolling() {
  if (state.agentRun.pollTimer) {
    window.clearTimeout(state.agentRun.pollTimer);
  }
  state.agentRun.pollTimer = null;
}

function buildAgentRunHint(message) {
  if (window.location.port !== "8766") {
    return `${message} 에이전트 실행은 preview server origin에서만 동작합니다. http://127.0.0.1:8766/csm-prototype/index.html 로 열어주세요.`;
  }

  return message;
}

async function requestJson(endpoint, options = {}) {
  const response = await fetch(endpoint, options);
  const rawText = await response.text();
  let payload = null;

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { message: rawText };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Request failed (${response.status})`;
    throw new Error(buildAgentRunHint(message));
  }

  return payload;
}

function applyAgentSnapshotIfReady(response) {
  const validationStage = response.stages?.find((stage) => stage.key === "validation");
  const snapshotReady =
    validationStage?.status === "completed" && response.snapshot && response.runId;

  if (!snapshotReady || state.agentRun.snapshotAppliedRunId === response.runId) {
    return;
  }

  const applied = applyDashboardSnapshot(response.snapshot, {
    companyKey: response.selectedCompany,
    periodKey: response.selectedPeriod,
  });

  if (!applied) return;

  state.agentRun.snapshotAppliedRunId = response.runId;
  renderDashboard();
  void refreshAgentTargetCatalog(`${response.selectedCompany}.${response.selectedPeriod}`);
}

function consumeAgentRunResponse(response) {
  applyAgentSnapshotIfReady(response);
  setAgentRunState({
    runId: response.runId,
    status: response.status,
    selectedCompany: response.selectedCompany,
    selectedPeriod: response.selectedPeriod,
    stages: response.stages ?? createDefaultAgentStages(),
    lastUpdatedAt: response.updatedAt ?? new Date().toISOString(),
    failureReason: response.failureReason ?? null,
    snapshotAppliedRunId: state.agentRun.snapshotAppliedRunId,
  });
}

async function pollAgentRun(runId) {
  try {
    const response = await requestJson(`/api/agent/run/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    consumeAgentRunResponse(response);

    if (response.status === "running") {
      state.agentRun.pollTimer = window.setTimeout(() => {
        void pollAgentRun(runId);
      }, 500);
      return;
    }

    clearAgentRunPolling();
  } catch (error) {
    clearAgentRunPolling();
    setAgentRunState({
      status: "failed",
      failureReason: String(error?.message ?? error),
      lastUpdatedAt: new Date().toISOString(),
    });
  }
}

async function startAgentRun() {
  const target = getSelectedAgentTarget();
  if (!target) {
    setAgentRunState({
      status: "idle",
      failureReason: null,
      lastUpdatedAt: state.agentRun.lastUpdatedAt,
    });
    return;
  }

  clearAgentRunPolling();
  setAgentRunState({
    runId: null,
    status: "running",
    selectedCompany: target.companyKey,
    selectedPeriod: target.periodKey,
    stages: createDefaultAgentStages(),
    failureReason: null,
    lastUpdatedAt: new Date().toISOString(),
    snapshotAppliedRunId: null,
  });

  try {
    const response = await requestJson("/api/agent/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        companyKey: target.companyKey,
        periodKey: target.periodKey,
      }),
    });

    consumeAgentRunResponse(response);
    await pollAgentRun(response.runId);
  } catch (error) {
    clearAgentRunPolling();
    setAgentRunState({
      status: "failed",
      stages: createDefaultAgentStages(),
      failureReason: String(error?.message ?? error),
      lastUpdatedAt: new Date().toISOString(),
    });
  }
}

async function requestAiResponse(endpoint, payload, fallbackFactory) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || data?.error || "AI request failed");
    }
    return data;
  } catch (error) {
    return fallbackFactory(error);
  }
}

async function refreshAiInsights() {
  if (!aiFocusSelect) return;

  const companyKey = getCurrentCompanyKey();
  const periodKey = getAiCompanyPeriodKey();
  const serial = ++aiRequestSerial;
  ensureAiConversationScope(companyKey);

  if (aiSnapshotStatus) aiSnapshotStatus.textContent = "AI 분석 중...";
  if (aiPeriodStatus) {
    aiPeriodStatus.textContent = `기준 ${sampleData[companyKey].name} | ${getPeriodLabel(periodKey)}`;
  }
  if (aiValidationStatus) aiValidationStatus.textContent = "검증 상태 확인 중...";

  renderAiThread();

  const payload = await requestAiResponse(
    "/api/ai/analyze",
    {
      company: companyKey,
      period: periodKey,
      requestedPeriod: periodSelect.value,
      analysisType: aiFocusSelect.value,
      contextTab: state.activeTab,
      contextSubtab: state.activeCompanySubtab,
    },
    () =>
      buildLocalAiResponse({
        companyKey,
        periodKey,
        analysisType: aiFocusSelect.value,
        mode: "analysis",
      }),
  );

  if (serial !== aiRequestSerial) return;

  aiLatestResponse = payload;
  renderAiCards(payload);
  renderAiStatus(payload);
}

async function submitAiChat(event) {
  event.preventDefault();
  if (!aiChatInput) return;

  const question = aiChatInput.value.trim();
  if (!question) return;

  const companyKey = getCurrentCompanyKey();
  ensureAiConversationScope(companyKey);
  const periodKey = getAiCompanyPeriodKey();
  aiConversation.push({ role: "user", text: question });
  renderAiThread();
  aiChatInput.value = "";

  const payload = await requestAiResponse(
    "/api/ai/chat",
    {
      company: companyKey,
      period: periodKey,
      requestedPeriod: periodSelect.value,
      question,
      conversation: aiConversation.slice(-6),
      contextTab: state.activeTab,
      contextSubtab: state.activeCompanySubtab,
    },
    () =>
      buildLocalAiResponse({
        companyKey,
        periodKey,
        analysisType: aiFocusSelect.value,
        mode: "chat",
        question,
      }),
  );

  const assistantMessage = {
    role: "assistant",
    title: payload.answer?.title || "응답",
    summary: payload.answer?.summary || "",
    bullets: payload.answer?.bullets || [],
    validationStatus: payload.validationStatus,
  };
  aiConversation.push(assistantMessage);
  aiLatestResponse = payload;
  renderAiThread();
}

function applyTopLevelTabState() {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === state.activeTab;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === state.activeTab;
    panel.dataset.activePanel = String(isActive);
    panel.hidden = !isActive;
  });
}

function applyCompanySubtabState() {
  companySubtabButtons.forEach((button) => {
    const isActive = button.dataset.companySubtab === state.activeCompanySubtab;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  companySubtabPanels.forEach((panel) => {
    const isActive = panel.dataset.companySubtabPanel === state.activeCompanySubtab;
    panel.dataset.activeSubpanel = String(isActive);
    panel.hidden = !isActive;
  });
}

function setActiveTab(tabKey, options = {}) {
  const nextTab = topLevelTabs.includes(tabKey) ? tabKey : "overview";
  state.activeTab = nextTab;
  applyTopLevelTabState();
  renderAiContext();

  if (options.syncHash !== false && window.location.hash !== `#${nextTab}`) {
    history.replaceState(null, "", `#${nextTab}`);
  }

  if (options.refreshAi !== false) {
    void refreshAiInsights();
  }
}

function setActiveCompanySubtab(subtabKey, options = {}) {
  const nextSubtab = companySubtabs.includes(subtabKey) ? subtabKey : "movement";
  state.activeCompanySubtab = nextSubtab;
  applyCompanySubtabState();

  if (options.refreshAi !== false && state.activeTab === "company-analysis") {
    renderAiContext();
    void refreshAiInsights();
  }
}

function setAiDrawerOpen(isOpen) {
  state.aiOpen = Boolean(isOpen);
  if (!aiDrawer || !aiOverlay) return;

  aiDrawer.dataset.open = String(state.aiOpen);
  aiDrawer.setAttribute("aria-hidden", String(!state.aiOpen));
  aiOverlay.dataset.open = String(state.aiOpen);
  aiOverlay.hidden = !state.aiOpen;
  document.body.classList.toggle("ai-drawer-open", state.aiOpen);
}

function renderDashboard() {
  const { period, financial } = getCurrentData();

  renderShellSummary();
  renderOverview();
  renderCompanySummary();
  renderWaterfall();
  renderProfitView();
  renderPortfolioView();
  renderTrendView();
  renderComparison();
  renderForecast();
  renderQualityDetails(period, financial);
  renderReviewWorkbench();
  renderAiContext();
  applyTopLevelTabState();
  applyCompanySubtabState();
  renderAiThread();
  renderAgentRunState();
  void refreshAiInsights();
}

companySelect.addEventListener("change", () => {
  syncPeriodOptions(companySelect.value, periodSelect.value);
  renderDashboard();
});

periodSelect.addEventListener("change", () => {
  renderDashboard();
});

agentTargetSelect?.addEventListener("change", () => {
  const currentTarget = getSelectedAgentTarget();
  if (agentTargetSummary) {
    const backlog = state.agentTargets.summary.backlog;
    const completed = state.agentTargets.summary.completed;
    agentTargetSummary.textContent = currentTarget
      ? `${backlog}건 실행 가능 · 현재 선택 ${getAgentTargetMeta(currentTarget)} · 완료 ${completed}건은 기본 숨김`
      : "검증 완료 조합은 숨기고, 미완료 대상만 표시합니다.";
  }
  renderAgentRunState();
});

scenarioSelect.addEventListener("change", () => {
  renderForecast();
  if (state.activeTab === "forecast") {
    void refreshAiInsights();
  }
});

marketSortSelect?.addEventListener("change", () => {
  renderComparison();
});

marketFilterSelect?.addEventListener("change", () => {
  renderComparison();
});

marketPeerSelect?.addEventListener("change", () => {
  renderComparison();
});

aiFocusSelect?.addEventListener("change", refreshAiInsights);
aiRefreshButton?.addEventListener("click", refreshAiInsights);
aiChatForm?.addEventListener("submit", submitAiChat);
aiDrawerButton?.addEventListener("click", () => setAiDrawerOpen(true));
aiCloseButton?.addEventListener("click", () => setAiDrawerOpen(false));
aiOverlay?.addEventListener("click", () => setAiDrawerOpen(false));
agentRunButton?.addEventListener("click", () => {
  void startAgentRun();
});

quickJumpButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTab = button.dataset.jumpTab;
    const nextSubtab = button.dataset.companySubtab;
    if (nextSubtab) {
      setActiveCompanySubtab(nextSubtab, { refreshAi: false });
    }
    setActiveTab(nextTab, { refreshAi: true });
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
  });
});

companySubtabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveCompanySubtab(button.dataset.companySubtab);
  });
});

window.addEventListener("hashchange", () => {
  const nextTab = parseHashTab(window.location.hash);
  if (nextTab !== state.activeTab) {
    setActiveTab(nextTab, { syncHash: false });
  }
});

window.addEventListener("resize", () => setAiDrawerOpen(state.aiOpen));

void refreshAgentTargetCatalog();
renderDashboard();
setActiveCompanySubtab(state.activeCompanySubtab, { refreshAi: false });
setActiveTab(state.activeTab, { syncHash: false, refreshAi: false });
setAiDrawerOpen(state.aiOpen);

