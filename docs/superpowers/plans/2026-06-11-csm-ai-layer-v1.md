# CSM AI Layer V1 Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 검증된 CSM 대시보드 위에 하나의 AI 레이어를 얹어 이상변화 감지, CSM Movement 원인분해, Peer 비교, 임원용 요약, 자연어 질의응답을 한 번에 제공한다. 샘플/실데이터 혼선, 근거 없는 숫자, 투자 추천은 허용하지 않는다.

**Architecture:** `tools/csm_agent_pipeline.py`는 추출/정규화/검증/대시보드 생성의 결정론적 원천으로 유지한다. `tools/preview-server.mjs`는 같은 origin의 AI gateway를 붙여 대시보드와 AI 응답이 동일한 검증 스냅샷을 읽게 한다. AI는 구조화 JSON을 반환하고, 화면은 그 JSON만 렌더링한다.

**Tech Stack:** Python 파이프라인, Node preview server, browser dashboard JS, server-side LLM adapter, JSON contracts, existing generated artifacts.

---

### Task 1: AI 계약과 문서 위계 고정

**Files**
- Modify: `docs/agent-architecture.md`
- Modify: `docs/csm-agent-runbook.md`
- Modify: `docs/superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md`

**Work**
- AI 응답 계약을 `dataKind`, `audience`, `analysisType`, `periodScope`, `validationStatus`, `reviewState`, `evidence`, `calculation`, `followUps` 중심으로 고정한다.
- PRD는 제품 요구사항만 남기고, 구현 기준과 API 계약은 architecture 문서로 되돌린다.
- 최신 검증 기간만 전망을 노출하고, forecast에서 Movement가 항상 함께 보이도록 규칙을 명시한다.

### Task 2: AI gateway와 preview server 연결

**Files**
- Create: `tools/ai-gateway.mjs`
- Modify: `tools/preview-server.mjs`
- Modify: `tools/csm_agent_pipeline.py`
- Regenerate: `external-data/csm-dashboard-agent-output.json`, `csm-prototype/dashboard-data.generated.js`

**Work**
- `POST /api/ai/analyze`와 `POST /api/ai/chat`를 same-origin으로 노출한다.
- snapshot hash, current company/period, audience, analysisType만 prompt context로 넘기고 업로드 파일/PDF는 넣지 않는다.
- `LLM_PROVIDER=mock|openai` 형태로 provider를 바꾸고, 키가 없으면 mock 응답으로 안전하게 동작하게 한다.
- AI 응답은 구조화 JSON-first로 반환하고, out-of-scope 질문은 grounded refusal로 처리한다.

### Task 3: 대시보드 AI 표면 추가

**Files**
- Modify: `csm-prototype/index.html`
- Modify: `csm-prototype/script.js`
- Modify: `csm-prototype/styles.css`

**Work**
- AI insight 패널에 anomaly, movement RCA, peer comparison, executive briefing을 보여준다.
- 채팅 drawer를 추가하고 실무자/임원 톤을 전환할 수 있게 한다.
- 모든 AI 응답에 기준 기간과 검증 상태를 표시한다.
- Forecast 화면은 최신 검증 기간 기준으로만 동작하고 Movement 전망은 기본 노출되게 한다.

### Task 4: 계약 테스트와 회귀 검증

**Files**
- Add: `tests/test_ai_gateway_contract.mjs`
- Keep: `tests/test_csm_agent_pipeline_metadata.py`
- Keep: `node --check tools/preview-server.mjs`

**Work**
- AI 분석 응답에 evidence/calculation/followUps/validationStatus가 포함되는지 검증한다.
- 범위 밖 질문이 수치 생성 없이 거부되는지 검증한다.
- 기존 파이프라인 테스트와 dashboard JS 구문 검사가 계속 통과하는지 확인한다.
- 로컬 대시보드에서 AI 패널이 최신 검증 기간을 기본 기준으로 쓰는지 확인한다.

**Assumptions**
- V1은 삼성생명, 삼성화재만 지원한다.
- AI는 대시보드 코파일럿이며 일반 목적 챗봇이나 투자 추천 엔진이 아니다.
- 실데이터 기준은 `csm_agent_pipeline.py`가 만든 검증 스냅샷만 사용한다.
