import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT_PATH = resolve(
  MODULE_DIR,
  '..',
  'external-data',
  'csm-dashboard-agent-output.json',
);

const ANALYSIS_TYPES = new Set(['anomaly', 'movement', 'peer', 'briefing', 'chat']);
const AUDIENCES = new Set(['practitioner', 'executive']);
const REFUSAL_PATTERNS = [
  /매수|매도|추천|목표주가|투자\s*추천|투자\s*판단/i,
  /경쟁사\s*전략\s*추론|전략\s*추론/i,
  /일반\s*챗봇|잡담/i,
];

export function createAiGateway({
  snapshotPath = DEFAULT_SNAPSHOT_PATH,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    analyze: (request = {}) => analyzeRequest({ snapshotPath, env, fetchImpl, request }),
    chat: (request = {}) => chatRequest({ snapshotPath, env, fetchImpl, request }),
    status: () => readSnapshot(snapshotPath),
  };
}

async function analyzeRequest({ snapshotPath, env, fetchImpl, request }) {
  const snapshot = await readSnapshot(snapshotPath);
  const companyKey = pickCompanyKey(snapshot, request.company);
  const company = snapshot.data.sampleData[companyKey];
  const periodKey = pickLatestPeriodKey(snapshot, companyKey);
  const audience = normalizeAudience(request.audience);
  const analysisType = normalizeAnalysisType(request.analysisType, 'briefing');
  const facts = buildFacts(snapshot, companyKey, periodKey);

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

async function chatRequest({ snapshotPath, env, fetchImpl, request }) {
  const snapshot = await readSnapshot(snapshotPath);
  const companyKey = pickCompanyKey(snapshot, request.company);
  const periodKey = pickLatestPeriodKey(snapshot, companyKey);
  const audience = normalizeAudience(request.audience);
  const facts = buildFacts(snapshot, companyKey, periodKey);

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

async function readSnapshot(snapshotPath) {
  const raw = await readFile(snapshotPath, 'utf8');
  const data = JSON.parse(raw);
  const hash = createHash('sha256').update(raw).digest('hex');
  return { data, raw, hash, snapshotPath };
}

function pickCompanyKey(snapshot, requestedCompany) {
  const supportedCompanies = supportedCompanyKeys(snapshot);
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

function supportedCompanyKeys(snapshot) {
  const analysisPolicy = snapshot.data.analysisPolicy ?? {};
  const supportedCompanies = analysisPolicy.supportedCompanies;
  if (Array.isArray(supportedCompanies) && supportedCompanies.length) {
    return supportedCompanies;
  }

  return Object.keys(snapshot.data.sampleData ?? {});
}

function pickLatestPeriodKey(snapshot, companyKey) {
  const analysisPolicy = snapshot.data.analysisPolicy ?? {};
  const policyPeriod = analysisPolicy.latestValidatedPeriodByCompany?.[companyKey];
  if (policyPeriod) {
    return policyPeriod;
  }

  const periods = snapshot.data.sampleData?.[companyKey]?.periods ?? {};
  return Object.keys(periods).sort(comparePeriodKeys).at(-1);
}

function comparePeriodKeys(left, right) {
  const [leftYear, leftQuarter] = left.split('-q').map(Number);
  const [rightYear, rightQuarter] = right.split('-q').map(Number);
  if (leftYear !== rightYear) {
    return leftYear - rightYear;
  }
  return leftQuarter - rightQuarter;
}

function normalizeAudience(value) {
  return AUDIENCES.has(value) ? value : 'practitioner';
}

function normalizeAnalysisType(value, fallback = 'briefing') {
  if (!value) return fallback;
  return ANALYSIS_TYPES.has(value) ? value : fallback;
}

function buildFacts(snapshot, companyKey, periodKey) {
  const company = snapshot.data.sampleData[companyKey];
  const financial = snapshot.data.financialMetrics[companyKey]?.[periodKey];
  const period = company?.periods?.[periodKey];
  if (!company || !financial || !period) {
    throw new Error(`missing company-period data: ${companyKey}.${periodKey}`);
  }

  const reviewState = summarizeReviewState(snapshot.data.reviewItems ?? [], companyKey, periodKey);
  const periodScope = buildPeriodScope(periodKey);
  const previousPeriodKey = getPreviousPeriodKey(company.periods, periodKey);
  const previousPeriod = previousPeriodKey ? company.periods[previousPeriodKey] : null;
  const peerCompanyKey = supportedCompanyKeys(snapshot).find((key) => key !== companyKey) ?? null;
  const peerCompany = peerCompanyKey ? snapshot.data.sampleData[peerCompanyKey] : null;
  const peerFinancial = peerCompany ? snapshot.data.financialMetrics[peerCompanyKey]?.[periodKey] : null;
  const latestForecast = period.forecast ?? null;

  return {
    snapshotHash: snapshot.hash,
    generatedAt: snapshot.data.generatedAt,
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
    latestForecast,
    basis: {
      csm: '별도 재무제표 기준 · 재보험 제외',
      insuranceProfit: '별도 보험서비스손익',
      investmentProfit: '별도 투자손익 + 영업외손익 + 연결효과',
      netIncome: '지배주주 연결손익',
      kics: '지급여력 공시 기준',
    },
  };
}

function buildPeriodScope(periodKey) {
  const [year, quarterPart] = periodKey.split('-q');
  const quarter = Number(quarterPart);
  return {
    mode: 'latest-validated',
    label: `${year}-${String(quarter * 3).padStart(2, '0')}`,
    periodKey,
    periodLabel: `${year} Q${quarter}`,
  };
}

function getPreviousPeriodKey(periods, currentPeriodKey) {
  const ordered = Object.keys(periods).sort(comparePeriodKeys);
  const currentIndex = ordered.indexOf(currentPeriodKey);
  if (currentIndex <= 0) return null;
  return ordered[currentIndex - 1];
}

function summarizeReviewState(reviewItems, companyKey, periodKey) {
  const items = reviewItems.filter((item) => item.company === companyKey && item.period === periodKey);
  const counts = {
    total: items.length,
    passed: 0,
    needsReview: 0,
    failed: 0,
  };

  for (const item of items) {
    if (item.status === 'passed') counts.passed += 1;
    if (item.status === 'needs_review') counts.needsReview += 1;
    if (item.status === 'failed') counts.failed += 1;
  }

  const status = counts.failed > 0 ? 'failed' : counts.needsReview > 0 ? 'needs_review' : 'passed';
  return { status, ...counts };
}

function buildAnalysisBundle({ facts, audience, analysisType, question = null, mode = 'analysis' }) {
  const cards = [
    buildAnomalyCard(facts),
    buildMovementCard(facts),
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

function buildPeerCard(facts) {
  const peer = facts.peerCompany;
  const peerFinancial = facts.peerFinancial;
  if (!peer || !peerFinancial) {
    return {
      key: 'peer',
      title: 'Peer 비교',
      status: 'warning',
      summary: 'Peer 데이터를 찾지 못했습니다.',
      evidence: [],
      calculation: [],
      followUps: ['삼성생명과 삼성화재가 모두 포함된 스냅샷인지 확인하세요.'],
    };
  }

  const comparisons = [
    ['보유 CSM', facts.period.csm, peer.periods[facts.periodKey]?.csm ?? null, '조원'],
    ['보험손익', facts.financial.insuranceProfit, peerFinancial.insuranceProfit, '조원'],
    ['투자손익', facts.financial.investmentProfit, peerFinancial.investmentProfit, '조원'],
    ['당기순이익', facts.financial.netIncome, peerFinancial.netIncome, '조원'],
    ['K-ICS', facts.financial.kics, peerFinancial.kics, '%'],
  ];

  const summary = `${facts.company.name}은 ${formatTrillion(facts.period.csm)}의 보유 CSM으로 ${peer.name}보다 ${formatTrillion(Math.abs(facts.period.csm - (peer.periods[facts.periodKey]?.csm ?? 0)))} ${facts.period.csm >= (peer.periods[facts.periodKey]?.csm ?? 0) ? '크고' : '작다'}. 반면 K-ICS는 ${formatPercent(facts.financial.kics)}로 ${peer.name} 대비 ${facts.financial.kics >= peerFinancial.kics ? '높다' : '낮다'}.`;

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

  const summary =
    audience === 'executive'
      ? `${facts.company.name}은 ${facts.periodScope.periodLabel} 기준으로 보유 CSM ${formatTrillion(facts.period.csm)}, 보험손익 ${formatTrillion(facts.financial.insuranceProfit)}, 투자손익 ${formatTrillion(facts.financial.investmentProfit)}, 연결 당기순이익 ${formatTrillion(facts.financial.netIncome)}를 기록했다. 검증 상태는 ${facts.reviewState.status}다.`
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
      { label: '투자손익', value: formatTrillion(facts.financial.investmentProfit) },
      { label: '당기순이익', value: formatTrillion(facts.financial.netIncome) },
      { label: 'K-ICS', value: formatPercent(facts.financial.kics) },
    ],
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
  const bullets = executiveStyle
    ? [cards[3].summary, cards[1].summary, cards[2].summary]
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
  if (/(변동|원인|무브먼트|movement|왜|상세)/i.test(question)) {
    return 'movement';
  }
  if (/(비교|peer|상대|차이)/i.test(question)) {
    return 'peer';
  }
  return 'briefing';
}

function formatTrillion(value) {
  return `${(Number(value) / 1000).toFixed(1)}조원`;
}

function formatSignedTrillion(value) {
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : '-'}${Math.abs(numeric / 1000).toFixed(1)}조원`;
}

function formatPercent(value) {
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
}

function formatSignedPercent(value) {
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
