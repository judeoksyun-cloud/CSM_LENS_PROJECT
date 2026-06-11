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
  assert.equal(result.period, '2025-q4');
  assert.equal(result.periodScope.mode, 'latest-validated');
  assert.equal(result.validationStatus, 'passed');
  assert.ok(result.snapshotHash);
  assert.ok(Array.isArray(result.insightCards));
  assert.equal(result.insightCards.length, 4);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.calculation.length > 0);
  assert.ok(result.followUps.length > 0);
  assert.ok(result.answer.summary.length > 0);
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
    company: 'samsung-fire',
    question: '삼성화재 2025년 말 CSM 변동 원인을 알려줘',
  });

  assert.equal(result.company, 'samsung-fire');
  assert.equal(result.validationStatus, 'passed');
  assert.equal(result.unsupportedReason, null);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.answer.bullets.length > 0);
  assert.match(result.answer.summary, /CSM|신계약|이자부리|상각|조정/);
});
