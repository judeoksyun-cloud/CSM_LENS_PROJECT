import {
  buildQuarterPeriodScope,
  DEFAULT_DASHBOARD_SNAPSHOT_PATH,
  getFinancialMetric,
  getLatestQuarterPeriodKey,
  getPreviousQuarterPeriodKey,
  getReviewSummary,
  getSupportedCompanyKeys,
  readDashboardSnapshot,
} from './dashboard-contract.mjs';
import {
  DEFAULT_FORECAST_SNAPSHOT_PATH,
  getCompanyForecast,
  readForecastSnapshot,
  summarizeForecastEntry,
  validateForecastEntry,
} from './forecast-contract.mjs';

const ANALYSIS_TYPES = new Set(['anomaly', 'movement', 'forecast', 'peer', 'briefing', 'chat']);
const AUDIENCES = new Set(['practitioner', 'executive']);
const REFUSAL_PATTERNS = [
  /매수|매도|추천|목표주가|투자\s*추천|투자\s*판단/i,
  /경쟁사\s*전략\s*추론|전략\s*추론/i,
  /일반\s*챗봇|잡담/i,
];

export function createAiGateway({
  snapshotPath = DEFAULT_DASHBOARD_SNAPSHOT_PATH,
  forecastPath = DEFAULT_FORECAST_SNAPSHOT_PATH,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    analyze: (request = {}) => analyzeRequest({ snapshotPath, forecastPath, env, fetchImpl, request }),
    chat: (request = {}) => chatRequest({ snapshotPath, forecastPath, env, fetchImpl, request }),
    status: async () => {
      const [dashboard, forecast] = await Promise.all([
        readDashboardSnapshot(snapshotPath),
        readForecastSnapshot(forecastPath),
      ]);
      return {
        dashboardHash: dashboard.hash,
        forecastHash: forecast.hash,
        dashboardContractVersion: dashboard.data.dataContractVersion,
        forecastContractVersion: forecast.data.version,
      };
    },
  };
}

async function analyzeRequest({ snapshotPath, forecastPath, env, fetchImpl, request }) {
  const [snapshot, forecastSnapshot] = await Promise.all([
    readDashboardSnapshot(snapshotPath),
    readForecastSnapshot(forecastPath),
  ]);
  const companyKey = pickCompanyKey(snapshot, request.company);
  const company = snapshot.data.sampleData[companyKey];
  const periodKey = pickLatestPeriodKey(snapshot, companyKey);
  const audience = normalizeAudience(request.audience);
  const analysisType = normalizeAnalysisType(request.analysisType, 'briefing');
  const facts = buildFacts(snapshot, forecastSnapshot, companyKey, periodKey);

  const base = buildAnalysisBundle({
    facts,
    audience,
    analysisType,
  });

  const polished = await maybePolishWithLlm({
    env,
    fetchImpl,
    request,
    snapshot,
    facts,
    audience,
    analysisType,
    base,
  });

  return polished ?? base;
}

async function chatRequest({ snapshotPath, forecastPath, env, fetchImpl, request }) {
  const [snapshot, forecastSnapshot] = await Promise.all([
    readDashboardSnapshot(snapshotPath),
    readForecastSnapshot(forecastPath),
  ]);
  const companyKey = pickCompanyKey(snapshot, request.company);
  const periodKey = pickLatestPeriodKey(snapshot, companyKey);
  const audience = normalizeAudience(request.audience);
  const facts = buildFacts(snapshot, forecastSnapshot, companyKey, periodKey);

  const query = typeof request.question === 'string' ? request.question.trim() : '';
  if (!query) {
    return buildRefusalResponse({
      facts,
      audience,
      reason: 'empty_question',
      message: '질문이 비어 있습니다. CSM, 손익, K-ICS, Movement 중 하나를 포함해 물어봐 주세요.',
    });
  }

  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(query))) {
    return buildRefusalResponse({
      facts,
      audience,
      reason: 'out_of_scope_request',
      message: '이 시스템은 투자 추천이나 전략 추론을 하지 않습니다. 검증된 CSM, 손익, K-ICS 기준으로만 답변합니다.',
    });
  }

  const analysisType = classifyQuestion(query);
  const base = buildAnalysisBundle({
    facts,
    audience,
    analysisType,
    question: query,
    mode: 'chat',
  });

  const polished = await maybePolishWithLlm({
    env,
    fetchImpl,
    request: { ...request, question: query },
    snapshot,
    facts,
    audience,
    analysisType,
    base,
    mode: 'chat',
  });

  return polished ?? base;
}

function pickCompanyKey(snapshot, requestedCompany) {
  const supportedCompanies = getSupportedCompanyKeys(snapshot.data);
  if (!supportedCompanies.length) {
    throw new Error('snapshot has no supported companies');
  }

  if (requestedCompany && supportedCompanies.includes(requestedCompany)) {
    return requestedCompany;
  }

  if (requestedCompany && !supportedCompanies.includes(requestedCompany)) {
    throw new Error(`unsupported company: ${requestedCompany}`);
  }

  return supportedCompanies[0];
}

function pickLatestPeriodKey(snapshot, companyKey) {
  return getLatestQuarterPeriodKey(snapshot.data, companyKey);
}

function normalizeAudience(value) {
  return AUDIENCES.has(value) ? value : 'practitioner';
}

function normalizeAnalysisType(value, fallback = 'briefing') {
  if (!value) return fallback;
  return ANALYSIS_TYPES.has(value) ? value : fallback;
}

function buildFacts(snapshot, forecastSnapshot, companyKey, periodKey) {
  const company = snapshot.data.sampleData[companyKey];
  const period = company?.periods?.[periodKey];
  const financial = getFinancialMetric(snapshot.data, companyKey, periodKey);
  if (!company || !period) {
    throw new Error(`missing company-period data: ${companyKey}.${periodKey}`);
  }

  const reviewSummary = getReviewSummary(snapshot.data, companyKey, periodKey);
  const reviewState = {
    status: reviewSummary.status,
    total: reviewSummary.total,
    passed: reviewSummary.passed,
    needsReview: reviewSummary.needsReview,
    failed: reviewSummary.failed,
    reasons: reviewSummary.items
      .filter((item) => item.status !== 'passed')
      .map((item) => item.reviewReason),
  };
  const periodScope = buildQuarterPeriodScope(periodKey);
  const previousPeriodKey = getPreviousQuarterPeriodKey(company.periods, periodKey);
  const previousPeriod = previousPeriodKey ? company.periods[previousPeriodKey] : null;
  const peerCompanyKey = getSupportedCompanyKeys(snapshot.data).find(
    (key) => key !== companyKey && snapshot.data.sampleData[key]?.sector === company.sector,
  ) ?? getSupportedCompanyKeys(snapshot.data).find((key) => key !== companyKey) ?? null;
  const peerCompany = peerCompanyKey ? snapshot.data.sampleData[peerCompanyKey] : null;
  const peerFinancial = peerCompany
    ? getFinancialMetric(snapshot.data, peerCompanyKey, periodKey)
    : null;
  const forecast = getCompanyForecast(forecastSnapshot.data, companyKey);

  return {
    snapshotHash: snapshot.hash,
    generatedAt: snapshot.data.generatedAt,
    dataContractVersion: snapshot.data.dataContractVersion,
    runtimeContractVersion: snapshot.data.runtimeContractVersion,
    forecastHash: forecastSnapshot.hash,
    forecastContractVersion: forecastSnapshot.data.version,
    forecastRuntimeContractVersion: forecastSnapshot.data.runtimeContractVersion,
    companyKey,
    company,
    periodKey,
    period,
    financial,
    reviewState,
    periodScope,
    previousPeriodKey,
    previousPeriod,
    peerCompanyKey,
    peerCompany,
    peerFinancial,
    forecast,
    basis: {
      csm: period.metricBasis?.csm ?? '별도 재무제표 기준 · 재보험 제외',
      insuranceProfit: period.metricBasis?.insuranceProfit ?? '별도 보험서비스손익',
      investmentProfit: financial.investmentProfit == null
        ? '현재 분기 계약에서 미제공'
        : '별도 투자손익 + 영업외손익 + 연결효과',
      netIncome: period.metricBasis?.parentNetIncome ?? '당기순이익 공시 기준',
      kics: period.metricBasis?.solvency ?? '지급여력 공시 기준',
    },
  };
}

function buildAnalysisBundle({ facts, audience, analysisType, question = null, mode = 'analysis' }) {
  const cards = [
    buildAnomalyCard(facts),
    buildMovementCard(facts),
    buildForecastCard(facts),
    buildPeerCard(facts),
    buildBriefingCard(facts, audience),
  ];
  const focusCard = cards.find((card) => card.key === analysisType) ?? cards[cards.length - 1];
  const answer = buildAnswer({
    facts,
    cards,
    focusCard,
    analysisType,
    audience,
    question,
  });

  return {
    dataKind: 'actual',
    mode,
    audience,
    analysisType,
    company: facts.companyKey,
    companyName: facts.company.name,
    period: facts.periodKey,
    periodLabel: facts.periodScope.periodLabel,
    periodScope: facts.periodScope,
    validationStatus: facts.reviewState.status,
    reviewState: facts.reviewState,
    snapshotHash: facts.snapshotHash,
    generatedAt: facts.generatedAt,
    dataContractVersion: facts.dataContractVersion,
    runtimeContractVersion: facts.runtimeContractVersion,
    forecastHash: facts.forecastHash,
    forecastContractVersion: facts.forecastContractVersion,
    forecastRuntimeContractVersion: facts.forecastRuntimeContractVersion,
    forecastDataKind: 'scenario',
    forecast: summarizeForecastEntry(facts.forecast),
    basis: facts.basis,
    answer,
    insightCards: cards,
    evidence: focusCard.evidence,
    calculation: focusCard.calculation,
    followUps: focusCard.followUps,
    unsupportedReason: null,
  };
}

function buildAnomalyCard(facts) {
  const current = facts.period;
  const previous = facts.previousPeriod;
  const qoqCsmChange = previous ? current.csm - previous.csm : 0;
  const qoqGrowthChange = previous ? current.growth - previous.growth : 0;
  const status = facts.reviewState.status === 'passed' ? 'passed' : 'warning';

  const summary = previous
    ? `${facts.company.name}은 직전 분기 대비 보유 CSM이 ${formatSignedTrillion(qoqCsmChange)} 변했고, 성장률은 ${formatSignedPercent(qoqGrowthChange)}p 변동했다. 검증 상태는 ${facts.reviewState.status}다.`
    : `${facts.company.name}의 최신 검증 기간은 ${facts.periodScope.periodLabel}이며 검증 상태는 ${facts.reviewState.status}다.`;

  return {
    key: 'anomaly',
    title: '이상변화 감지',
    status,
    summary,
    evidence: [
      { label: '기준 기간', value: facts.periodScope.periodLabel },
      { label: '검증 상태', value: facts.reviewState.status },
      { label: '직전 기간 보유 CSM', value: previous ? formatTrillion(previous.csm) : '없음' },
      { label: '현재 보유 CSM', value: formatTrillion(current.csm) },
    ],
    calculation: previous
      ? [
          { label: '보유 CSM QoQ 변화', formula: `${formatTrillion(current.csm)} - ${formatTrillion(previous.csm)}`, value: formatSignedTrillion(qoqCsmChange) },
          { label: '성장률 변화', formula: `${current.growth.toFixed(1)}% - ${previous.growth.toFixed(1)}%`, value: `${formatSignedPercent(qoqGrowthChange)}p` },
        ]
      : [
          { label: '보유 CSM 변화', formula: '직전 기간 없음', value: formatTrillion(current.csm) },
        ],
    followUps: [
      '직전 기간 대비 손익과 CSM 조정 항목을 함께 확인하세요.',
      '검증 상태가 needs_review 또는 failed로 바뀌면 원문 표 번호부터 다시 확인하세요.',
    ],
  };
}

function buildMovementCard(facts) {
  const movement = facts.period.movement;
  const calculatedClosing =
    movement.opening + movement.newbiz + movement.interest + movement.adjustment + movement.amortization;
  const delta = movement.closing - movement.opening;
  const drivers = [
    ['신계약', movement.newbiz],
    ['이자부리', movement.interest],
    ['CSM 조정 등', movement.adjustment],
    ['CSM 상각', movement.amortization],
  ];
  const positiveDrivers = drivers.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const negativeDrivers = drivers.filter(([, value]) => value < 0).sort((a, b) => a[1] - b[1]);

  const summary = `${facts.company.name}의 CSM은 ${formatTrillion(movement.opening)}에서 ${formatTrillion(movement.closing)}으로 ${formatSignedTrillion(delta)} 변했다. 신계약 ${formatTrillion(movement.newbiz)}과 이자부리 ${formatTrillion(movement.interest)}가 늘었지만, CSM 조정 등 ${formatTrillion(Math.abs(movement.adjustment))}과 상각 ${formatTrillion(Math.abs(movement.amortization))}이 대부분 상쇄했다.`;

  return {
    key: 'movement',
    title: 'CSM Movement 원인분해',
    status: facts.reviewState.status === 'failed' ? 'warning' : 'passed',
    summary,
    evidence: [
      { label: '기시 CSM', value: formatTrillion(movement.opening) },
      { label: '신계약', value: formatTrillion(movement.newbiz) },
      { label: '이자부리', value: formatTrillion(movement.interest) },
      { label: 'CSM 조정 등', value: formatTrillion(movement.adjustment) },
      { label: 'CSM 상각', value: formatTrillion(movement.amortization) },
      { label: '기말 CSM', value: formatTrillion(movement.closing) },
    ],
    calculation: [
      {
        label: 'Movement 합계',
        formula: `${formatTrillion(movement.opening)} + ${formatTrillion(movement.newbiz)} + ${formatTrillion(movement.interest)} + ${formatTrillion(movement.adjustment)} + ${formatTrillion(movement.amortization)}`,
        value: formatTrillion(calculatedClosing),
      },
      {
        label: '공시 기말 CSM',
        formula: '원문 표 기말값',
        value: formatTrillion(movement.closing),
      },
    ],
    followUps: [
      positiveDrivers.length ? `가장 큰 증가 요인은 ${positiveDrivers[0][0]}입니다.` : '증가 요인이 없습니다.',
      negativeDrivers.length ? `가장 큰 감소 요인은 ${negativeDrivers[0][0]}입니다.` : '감소 요인이 없습니다.',
    ],
  };
}

function buildForecastCard(facts) {
  const forecast = facts.forecast;
  if (!forecast) {
    return {
      key: 'forecast',
      title: 'CSM 전망',
      status: 'warning',
      summary: '해당 회사의 전망 계약을 찾지 못했습니다.',
      evidence: [],
      calculation: [],
      followUps: ['전망 생성 작업과 회사 키 매핑을 확인하세요.'],
    };
  }

  const contractValidation = validateForecastEntry(forecast);
  const modelMovement = forecast.independentModel?.base ?? forecast.base;
  const modelClosing = modelMovement?.closing ?? forecast.base?.modelClosing;
  const baseClosing = forecast.base?.closing;
  const worstClosing = forecast.worst?.closing;
  const targetAdjustmentOverlay = forecast.base?.targetAdjustmentOverlay ?? 0;
  const anchor = forecast.anchor;
  const anchorText = anchor?.type === 'management_target'
    ? `경영계획 Base ${formatTrillion(baseClosing)}(${anchor.verificationLabel ?? '출처 확인 필요'})`
    : `Base ${formatTrillion(baseClosing)}`;
  const sourceEvidence = (forecast.sources ?? []).slice(0, 5).map((source) => ({
    label: source.type ?? 'source',
    value: `${source.title} · ${source.use}`,
  }));

  return {
    key: 'forecast',
    title: 'CSM 전망',
    status: contractValidation.status === 'passed' ? 'passed' : 'warning',
    summary: `${facts.company.name}의 독립 모델 전망은 ${formatTrillion(modelClosing)}, ${anchorText}, Worst는 ${formatTrillion(worstClosing)}다. 목표 정합화 조정 ${formatSignedTrillion(targetAdjustmentOverlay)}은 CSM 조정 등에 포함했다.`,
    evidence: [
      { label: '독립 모델', value: formatTrillion(modelClosing) },
      { label: '경영계획 Base', value: `${formatTrillion(baseClosing)} · ${anchor?.verificationLabel ?? '별도 목표 없음'}` },
      { label: 'Worst', value: formatTrillion(worstClosing) },
      { label: '검증 상태', value: `${forecast.validation?.label ?? forecast.confidence} · ${forecast.validation?.sampleCount ?? 0}개 시점` },
      ...sourceEvidence,
    ],
    calculation: [
      {
        label: '독립 모델 Movement',
        formula: `${formatTrillion(modelMovement.opening)} + ${formatTrillion(modelMovement.newbiz)} + ${formatTrillion(modelMovement.interest)} + ${formatTrillion(modelMovement.adjustment)} + ${formatTrillion(modelMovement.amortization)}`,
        value: formatTrillion(modelClosing),
      },
      {
        label: 'CSM 조정 목표 정합화',
        formula: `${formatTrillion(modelClosing)} ${targetAdjustmentOverlay >= 0 ? '+' : '-'} ${formatTrillion(Math.abs(targetAdjustmentOverlay))}`,
        value: formatTrillion(baseClosing),
      },
    ],
    followUps: [
      `경영목표 입력 방식은 ${anchor?.verificationLabel ?? '해당 없음'}입니다.`,
      `장기 값은 정밀 예측이 아니라 ${forecast.horizon?.terminal?.period ?? '장기'} 시나리오로 해석하세요.`,
    ],
  };
}

function buildPeerCard(facts) {
  const peer = facts.peerCompany;
  const peerFinancial = facts.peerFinancial;
  const peerPeriod = peer?.periods?.[facts.periodKey];
  if (!peer || !peerFinancial || !Number.isFinite(peerPeriod?.csm)) {
    return {
      key: 'peer',
      title: 'Peer 비교',
      status: 'warning',
      summary: 'Peer 데이터를 찾지 못했습니다.',
      evidence: [],
      calculation: [],
      followUps: ['같은 업권의 비교 대상과 동일 기간 데이터가 있는지 확인하세요.'],
    };
  }

  const comparisons = [
    ['보유 CSM', facts.period.csm, peerPeriod.csm, '조원'],
    ['보험손익', facts.financial.insuranceProfit, peerFinancial.insuranceProfit, '조원'],
    ['투자손익', facts.financial.investmentProfit, peerFinancial.investmentProfit, '조원'],
    ['당기순이익', facts.financial.netIncome, peerFinancial.netIncome, '조원'],
    ['K-ICS', facts.financial.kics, peerFinancial.kics, '%'],
  ].filter(([, current, peerValue]) => Number.isFinite(current) && Number.isFinite(peerValue));

  const peerCsm = peerPeriod.csm;
  const csmDifference = facts.period.csm - peerCsm;
  const summary = `${facts.company.name}은 ${formatTrillion(facts.period.csm)}의 보유 CSM으로 ${peer.name}보다 ${formatTrillion(Math.abs(csmDifference))} ${csmDifference >= 0 ? '크고' : '작다'}. K-ICS는 ${formatPercent(facts.financial.kics)}로 ${peer.name} 대비 ${facts.financial.kics >= peerFinancial.kics ? '높다' : '낮다'}.`;

  return {
    key: 'peer',
    title: 'Peer 비교',
    status: 'passed',
    summary,
    evidence: comparisons.map(([label, current, peerValue, unit]) => ({
      label,
      value: `${facts.company.name} ${formatMetricValue(label, current, unit)} / ${peer.name} ${formatMetricValue(label, peerValue, unit)}`,
    })),
    calculation: comparisons.map(([label, current, peerValue, unit]) => ({
      label,
      formula: `${formatMetricValue(label, current, unit)} - ${formatMetricValue(label, peerValue, unit)}`,
      value: unit === '%' ? formatSignedPercent(current - peerValue) : formatSignedTrillion(current - peerValue),
    })),
    followUps: [
      `${facts.company.name}와 ${peer.name}의 CSM, 손익, K-ICS 차이를 같은 기준으로 비교하세요.`,
      '수익성과 자본적정성을 분리해서 읽으면 차이의 의미가 더 잘 보입니다.',
    ],
  };
}

function buildBriefingCard(facts, audience) {
  const movement = facts.period.movement;
  const peer = facts.peerCompany;
  const peerFinancial = facts.peerFinancial;
  const peerCsm = peer?.periods?.[facts.periodKey]?.csm ?? null;
  const peerKics = peerFinancial?.kics ?? null;
  const executiveMetrics = [
    `보유 CSM ${formatTrillion(facts.period.csm)}`,
    `보험손익 ${formatTrillion(facts.financial.insuranceProfit)}`,
    Number.isFinite(facts.financial.investmentProfit)
      ? `투자손익 ${formatTrillion(facts.financial.investmentProfit)}`
      : null,
    `당기순이익 ${formatTrillion(facts.financial.netIncome)}`,
    `K-ICS ${formatPercent(facts.financial.kics)}`,
  ].filter(Boolean);

  const summary =
    audience === 'executive'
      ? `${facts.company.name}은 ${facts.periodScope.periodLabel} 기준으로 ${executiveMetrics.join(', ')}를 기록했다. 검증 상태는 ${facts.reviewState.status}다.`
      : `${facts.company.name}의 최신 검증 스냅샷은 보유 CSM ${formatTrillion(facts.period.csm)}, 신계약 ${formatTrillion(movement.newbiz)}, 이자부리 ${formatTrillion(movement.interest)}, CSM 조정 등 ${formatTrillion(movement.adjustment)}, 상각 ${formatTrillion(movement.amortization)}으로 구성된다. Peer 대비 CSM과 K-ICS 차이도 함께 봐야 한다.`;

  return {
    key: 'briefing',
    title: '임원용 브리핑',
    status: facts.reviewState.status === 'passed' ? 'passed' : 'warning',
    summary,
    evidence: [
      { label: '검증 상태', value: facts.reviewState.status },
      { label: '보유 CSM', value: formatTrillion(facts.period.csm) },
      { label: '보험손익', value: formatTrillion(facts.financial.insuranceProfit) },
      Number.isFinite(facts.financial.investmentProfit)
        ? { label: '투자손익', value: formatTrillion(facts.financial.investmentProfit) }
        : null,
      { label: '당기순이익', value: formatTrillion(facts.financial.netIncome) },
      { label: 'K-ICS', value: formatPercent(facts.financial.kics) },
    ].filter(Boolean),
    calculation: [
      {
        label: '관리손익 스냅샷',
        formula: '검증된 최신 공시 + 대시보드 기준',
        value: facts.periodScope.periodLabel,
      },
      {
        label: 'Peer CSM 차이',
        formula: peerCsm == null ? 'peer 없음' : `${formatTrillion(facts.period.csm)} - ${formatTrillion(peerCsm)}`,
        value: peerCsm == null ? 'n/a' : formatSignedTrillion(facts.period.csm - peerCsm),
      },
      {
        label: 'Peer K-ICS 차이',
        formula: peerKics == null ? 'peer 없음' : `${formatPercent(facts.financial.kics)} - ${formatPercent(peerKics)}`,
        value: peerKics == null ? 'n/a' : formatSignedPercent(facts.financial.kics - peerKics),
      },
    ],
    followUps: [
      '임원 브리핑은 검증 상태와 기준 기간을 항상 함께 보세요.',
      '세부 원인은 Movement 패널과 Peer 패널에서 다시 확인할 수 있습니다.',
    ],
  };
}

function buildAnswer({ cards, focusCard, audience, analysisType, question = null }) {
  const executiveStyle = audience === 'executive';
  const cardByKey = new Map(cards.map((card) => [card.key, card]));
  const bullets = executiveStyle
    ? ['briefing', 'forecast', 'movement'].map((key) => cardByKey.get(key)?.summary).filter(Boolean)
    : [focusCard.summary, ...focusCard.followUps.slice(0, 2)];

  return {
    title: focusCard.title,
    summary: focusCard.summary,
    bullets,
    note:
      question && analysisType === 'chat'
        ? `질문: ${question}`
        : `분석 기준은 최신 검증 기간이며, 결과는 ${audience === 'executive' ? '임원용' : '실무자용'} 톤으로 정리됐다.`,
  };
}

function buildRefusalResponse({ facts, audience, reason, message }) {
  return {
    dataKind: 'actual',
    mode: 'chat',
    audience,
    analysisType: 'chat',
    company: facts.companyKey,
    companyName: facts.company.name,
    period: facts.periodKey,
    periodLabel: facts.periodScope.periodLabel,
    periodScope: facts.periodScope,
    validationStatus: facts.reviewState.status,
    reviewState: facts.reviewState,
    snapshotHash: facts.snapshotHash,
    generatedAt: facts.generatedAt,
    dataContractVersion: facts.dataContractVersion,
    runtimeContractVersion: facts.runtimeContractVersion,
    forecastHash: facts.forecastHash,
    forecastContractVersion: facts.forecastContractVersion,
    forecastRuntimeContractVersion: facts.forecastRuntimeContractVersion,
    forecastDataKind: 'scenario',
    forecast: summarizeForecastEntry(facts.forecast),
    basis: facts.basis,
    answer: {
      title: '지원 범위 밖 질문',
      summary: message,
      bullets: [
        '이 시스템은 검증된 CSM, 손익, K-ICS 분석만 제공합니다.',
        '투자 추천, 일반 전략 추론, 임의의 숫자 생성은 하지 않습니다.',
      ],
      note: reason,
    },
    insightCards: [],
    evidence: [],
    calculation: [],
    followUps: ['검증된 CSM Movement, Peer 비교, 손익 질문으로 다시 물어봐 주세요.'],
    unsupportedReason: reason,
  };
}

function classifyQuestion(question) {
  if (/(이상|검증|오류|품질|검산)/i.test(question)) {
    return 'anomaly';
  }
  if (/(전망|예상|forecast|base|worst|향후|미래)/i.test(question)) {
    return 'forecast';
  }
  if (/(변동|원인|무브먼트|movement|왜|상세)/i.test(question)) {
    return 'movement';
  }
  if (/(비교|peer|상대|차이)/i.test(question)) {
    return 'peer';
  }
  return 'briefing';
}

function formatTrillion(value) {
  if (!Number.isFinite(value)) return '미제공';
  return `${(Number(value) / 1000).toFixed(1)}조원`;
}

function formatSignedTrillion(value) {
  if (!Number.isFinite(value)) return '미제공';
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : '-'}${Math.abs(numeric / 1000).toFixed(1)}조원`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '미제공';
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '미제공';
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}`;
}

function formatMetricValue(label, value, unit) {
  if (unit === '%') {
    return formatPercent(value);
  }
  return formatTrillion(value);
}

async function maybePolishWithLlm({
  env,
  fetchImpl,
  request,
  snapshot,
  facts,
  audience,
  analysisType,
  base,
  mode = 'analysis',
}) {
  if ((env.LLM_PROVIDER ?? 'mock') !== 'openai') {
    return null;
  }
  if (!env.LLM_API_KEY || typeof fetchImpl !== 'function') {
    return null;
  }

  const apiUrl = env.LLM_API_URL || env.LLM_API_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const model = env.LLM_MODEL || 'gpt-4.1-mini';
  const prompt = {
    request: {
      mode,
      analysisType,
      audience,
      question: request.question ?? null,
      company: facts.company.name,
      period: facts.periodScope.periodLabel,
    },
    rules: [
      'Return JSON only.',
      'Do not invent numbers.',
      'Keep the provided evidence and calculation intact.',
      'If the request is out of scope, set unsupportedReason.',
    ],
    responseTemplate: {
      answer: { title: '', summary: '', bullets: [], note: '' },
      insightCards: [],
      followUps: [],
      unsupportedReason: null,
    },
    facts: base,
    snapshotPolicy: snapshot.data.analysisPolicy ?? null,
  };

  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a grounded assistant for an insurance CSM dashboard. Return JSON only and never change the provided numbers.',
        },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    return null;
  }

  const parsed = safeParseJson(content);
  if (!parsed) {
    return null;
  }

  return mergePolishedResponse(base, parsed);
}

function safeParseJson(content) {
  const trimmed = String(content).trim();
  const stripped = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function mergePolishedResponse(base, polished) {
  return {
    ...base,
    answer: polished.answer ? { ...base.answer, ...polished.answer } : base.answer,
    insightCards: Array.isArray(polished.insightCards) && polished.insightCards.length ? polished.insightCards : base.insightCards,
    followUps: Array.isArray(polished.followUps) && polished.followUps.length ? polished.followUps : base.followUps,
    unsupportedReason: polished.unsupportedReason ?? base.unsupportedReason,
  };
}
