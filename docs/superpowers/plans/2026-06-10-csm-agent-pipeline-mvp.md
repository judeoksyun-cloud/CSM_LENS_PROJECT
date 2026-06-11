# CSM Agent Pipeline MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 외부 DART 추출 경험을 반복 가능한 1차 에이전트 파이프라인으로 만들고, 대시보드가 그 산출물을 우선 사용하게 한다.

**Architecture:** `external-data/dart-2025-insurance-extract.json`을 입력으로 받아 결정론적 에이전트들이 표준 대시보드 데이터와 검증 리포트를 만든다. 대시보드는 `csm-prototype/dashboard-data.generated.js`를 먼저 로드하고, 산출물이 없을 때만 기존 내장 데이터를 fallback으로 사용한다.

**Tech Stack:** Python 3 표준 라이브러리, 정적 HTML/CSS/JavaScript, Open DART 추출 JSON.

**Status:** 구현 완료. 아래 체크박스는 실제로 반영된 MVP 작업 내역을 기록한다.

---

### Task 1: 파이프라인 파일 추가

**Files:**
- Create: `tools/csm_agent_pipeline.py`
- Create: `external-data/csm-dashboard-agent-output.json`
- Create: `csm-prototype/dashboard-data.generated.js`

- [x] **Step 1: 입력 JSON을 읽는 CLI를 만든다**

`tools/csm_agent_pipeline.py`는 기본 입력으로 `external-data/dart-2025-insurance-extract.json`을 읽고, `--write-dashboard` 옵션이 있으면 대시보드용 JS도 생성한다.

- [x] **Step 2: 결정론적 에이전트를 분리한다**

같은 파일 안에서 `DartIngestionAgent`, `CsmMovementMappingAgent`, `FinancialMetricAgent`, `QualityValidationAgent`, `DashboardWriterAgent` 클래스로 책임을 나눈다.

- [x] **Step 3: 삼성생명/삼성화재 2025년 1Q~4Q 산출물을 만든다**

현재 검증된 DART 기반 값과 동일한 결과가 나오도록 Movement, 손익, K-ICS, 출처, 검산 상태를 JSON에 담는다.

### Task 2: 대시보드 연결

**Files:**
- Modify: `csm-prototype/index.html`
- Modify: `csm-prototype/script.js`

- [x] **Step 1: generated JS를 먼저 로드한다**

`index.html`에서 `dashboard-data.generated.js`를 `script.js`보다 먼저 로드한다.

- [x] **Step 2: script.js에 generated data overlay를 추가한다**

`window.CSM_AGENT_DATA.sampleData`와 `window.CSM_AGENT_DATA.financialMetrics`가 있으면 기존 객체를 덮어쓴다.

- [x] **Step 3: 기존 화면 동작을 유지한다**

필터, KPI 카드, Movement, Peer 비교, 전망 화면은 기존 함수 흐름을 그대로 사용한다.

### Task 3: 검증

**Files:**
- Test via commands only.

- [x] **Step 1: 파이프라인 실행**

Run: `python tools/csm_agent_pipeline.py --write-dashboard`

Expected: `external-data/csm-dashboard-agent-output.json`과 `csm-prototype/dashboard-data.generated.js` 생성.

- [x] **Step 2: JavaScript 문법 확인**

Run: `node --check csm-prototype/script.js`

Expected: exit code 0.

- [x] **Step 3: Movement 합계 검산**

Run: pipeline validation output 확인.

Expected: 삼성생명/삼성화재 2025년 1Q~4Q 전체 Movement diff가 0.

- [x] **Step 4: 로컬 페이지 확인**

Run: `Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/csm-prototype/index.html?v=agent-pipeline-mvp#dashboard'`

Expected: HTTP 200.
