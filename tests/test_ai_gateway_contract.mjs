import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiGateway } from '../tools/ai-gateway.mjs';

const gateway = createAiGateway({
  env: {
    LLM_PROVIDER: 'mock',
  },
});

test('analyze returns a grounded dashboard bundle for the latest validated period', async () => {
  const result = await gateway.analyze({
    company: 'samsung-life',
    audience: 'practitioner',
    analysisType: 'briefing',
  });

  assert.equal(result.dataKind, 'actual');
  assert.equal(result.company, 'samsung-life');
  assert.equal(result.period, '2026-q1');
  assert.equal(result.periodScope.mode, 'latest-validated');
  assert.equal(result.validationStatus, 'passed');
  assert.equal(result.dataContractVersion, 'csm-dashboard-quarterly/v1');
  assert.equal(result.runtimeContractVersion, 'csm-dashboard-runtime/v1');
  assert.ok(result.snapshotHash);
  assert.ok(Array.isArray(result.insightCards));
  assert.equal(result.insightCards.length, 5);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.calculation.length > 0);
  assert.ok(result.followUps.length > 0);
  assert.ok(result.answer.summary.length > 0);
  assert.equal(result.forecastContractVersion, '2026.08.16-v7.5');
  assert.equal(result.forecastRuntimeContractVersion, 'csm-forecast-runtime/v1');
  assert.equal(result.forecast.independentModel, 14135);
  assert.equal(result.forecast.base, 13500);
  assert.equal(result.forecast.worst, 13040);
  assert.equal(result.forecast.targetAdjustmentOverlay, -635);
  assert.equal(result.forecast.adjustmentBeforeTargetOverlay, -1640);
  assert.ok(
    !result.insightCards
      .find((card) => card.key === 'briefing')
      .evidence.some((item) => item.label === '투자손익'),
    'metrics absent from the quarterly contract must not be rendered as zero',
  );
});

test('all nine dashboard companies use the same latest quarterly contract', async () => {
  const companyKeys = [
    'samsung-life',
    'hanwha-life',
    'kyobo-life',
    'shinhan-life',
    'samsung-fire',
    'meritz-fire',
    'db-insurance',
    'hyundai-marine',
    'kb-insurance',
  ];

  const results = await Promise.all(
    companyKeys.map((company) => gateway.analyze({ company, analysisType: 'briefing' })),
  );

  assert.deepEqual(results.map((result) => result.company), companyKeys);
  assert.ok(results.every((result) => result.period === '2026-q1'));
  assert.ok(results.every((result) => result.dataContractVersion === 'csm-dashboard-quarterly/v1'));
  assert.ok(results.every((result) => result.snapshotHash === results[0].snapshotHash));
});

test('analyze honors an explicit supported actual period', async () => {
  const gateway = createAiGateway();
  const result = await gateway.analyze({
    company: 'samsung-life',
    periodKey: '2025-q4',
    analysisType: 'movement',
    audience: 'executive',
  });
  assert.equal(result.period, '2025-q4');
  assert.equal(result.periodLabel, '2025 Q4');
  assert.equal(result.forecast.base, 13500, 'forecast remains latest validated outlook while actual analysis period changes');
});

test('opening reconciliation differences surface as human review state', async () => {
  const result = await gateway.analyze({
    company: 'shinhan-life',
    audience: 'practitioner',
    analysisType: 'anomaly',
  });

  assert.equal(result.period, '2026-q1');
  assert.equal(result.validationStatus, 'needs_review');
  assert.equal(result.reviewState.needsReview, 1);
  assert.match(result.reviewState.reasons[0], /기초 CSM|104십억원/);
});

test('chat refuses unsupported investment advice', async () => {
  const result = await gateway.chat({
    company: 'samsung-life',
    question: '삼성생명 매수 추천해줘',
  });

  assert.ok(result.unsupportedReason);
  assert.equal(result.dataKind, 'actual');
  assert.match(result.answer.summary, /지원 범위 밖|거부|추천/i);
});

test('chat answers an operational CSM question with evidence', async () => {
  const result = await gateway.chat({
    company: 'hanwha-life',
    question: '한화생명 최신 CSM 변동 원인을 알려줘',
  });

  assert.equal(result.company, 'hanwha-life');
  assert.equal(result.period, '2026-q1');
  assert.equal(result.validationStatus, 'passed');
  assert.equal(result.unsupportedReason, null);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.answer.bullets.length > 0);
  assert.match(result.answer.summary, /CSM|신계약|이자부리|상각|조정/);
});

test('forecast questions use the same generated contract as the dashboard', async () => {
  const result = await gateway.chat({
    company: 'samsung-life',
    audience: 'executive',
    question: '삼성생명 CSM 전망과 근거를 알려줘',
  });

  assert.equal(result.analysisType, 'forecast');
  assert.equal(result.forecast.validation.contractStatus, 'passed');
  assert.match(result.answer.summary, /독립 모델|13\.5조원|Worst|경영목표/);
  assert.ok(result.evidence.some((item) => item.label === '독립 모델'));
  assert.ok(result.calculation.some((item) => item.label === '경영목표 연결 조정'));
});

test('status reports both quarterly and forecast contract hashes', async () => {
  const status = await gateway.status();

  assert.ok(status.dashboardHash);
  assert.ok(status.forecastHash);
  assert.equal(status.dashboardContractVersion, 'csm-dashboard-quarterly/v1');
  assert.equal(status.forecastContractVersion, '2026.08.16-v7.5');
});
