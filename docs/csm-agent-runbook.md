# CSM Agent Runbook

최종 갱신: 2026-08-21

## 목적

이 문서는 CSM Lens의 데이터 재생성, 검증, 리뷰, AI 게이트웨이, 에이전트 실행 패널 운영 절차를 정리한다. 설계 기준은 [agent-architecture.md](agent-architecture.md)를 우선하고, 제품 요구사항은 [superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md](superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md)를 참고한다.

## 기본 산출물

- `external-data/csm-quarterly-dashboard-data.json` — 화면·AI·Agent Run의 단일 진실 원천
- `csm-prototype/dashboard-data.generated.js`
- `external-data/management-experience-2025.json` — 관리기준 예실차 연말 정규화 계약
- `csm-prototype/management-experience-data.generated.js` — 관리기준 예실차 브라우저 산출물
- `tools/dashboard-contract.mjs` — AI/Agent 공통 런타임 계약과 리뷰 상태 파생

`external-data/csm-dashboard-agent-output.json`과 `tools/csm_agent_pipeline.py`는 초기 2개사 파일럿 보존물이다. 최신 9개사 대시보드와 런타임은 이 파일을 읽지 않는다.

## 대시보드 재생성

원시 캐시가 준비된 상태에서 9개사 대시보드와 전망을 다시 만들 때는 다음 순서를 사용한다.

```bash
python tools/build_annual_dashboard_data.py
python tools/build_quarterly_dashboard_data.py
python tools/build_csm_forecast.py
```

원시 캐시가 없으면 먼저 `annual_dart_insurance_extract.py`, `quarterly_dart_insurance_extract.py`, `quarterly_fisis_financial_extract.py`를 실행한다. API 키와 네트워크 호출이 필요하다.

## 관리기준 예실차 갱신

관리기준 예실차는 Open DART 수집기가 아니라 회사 공식 홈페이지의 연말 결산 별도 SAP 손익계산서·Factsheet를 사용한다. 전체 기준은 [management-experience-standard.md](management-experience-standard.md)를 따른다.

갱신 순서는 다음과 같다.

1. 대상 회사와 결산연도를 확정한다.
2. 공식 회사 도메인에서 결산 경영공시·Factsheet를 확보하고 별도 SAP 범위를 확인한다.
3. 문서명, URL, 시트·페이지, 열·행, 원단위를 먼저 기록한다.
4. 예상보험금, 발생보험금, 발생사고요소조정과 예상·발생 사업비 세 항목을 추출한다.
5. 억원으로 정규화하고 보험금·사업비·종합 예실차 및 세 비율을 재계산한다.
6. 세부 행이 없으면 회사의 공식 결과금액만 저장하고, 동일 SAP 기준 분모가 없으면 비율을 `null`로 둔다.
7. 결과와 함께 `verificationStatus`, `verificationLabel`, `coverageNote`, `source`를 갱신한다.
8. `external-data/management-experience-2025.json`과 `csm-prototype/management-experience-data.generated.js`를 동일하게 만든다.
9. 데이터 기준 표와 방법론 변경 이력을 갱신하고 회귀 테스트를 실행한다.

절대 사용하지 않는 보정 원본은 Open DART 공시기준 예실차, FISIS의 다른 재무비율, 기사·증권사 표, `ref_data`, 사용자 첨부 양식이다. 이 자료들은 SAP 관리기준 결측값을 채우는 데 사용할 수 없다.

## 검증

파이프라인 메타데이터, UI 구조, AI 계약, 에이전트 런타임 상태를 확인할 때는 다음 명령을 순서대로 실행한다.

```bash
node --check tools/preview-server.mjs
node --check tools/dashboard-contract.mjs
node --check csm-prototype/script.js
node --test tests/csm-lens-ia.test.mjs
node --test tests/dashboard-contract.test.mjs
node --test tests/test_ai_gateway_contract.mjs
node --test tests/test_agent_run_gateway.mjs
node tests/management-experience.test.mjs
python tools/test_quarterly_dashboard_data.py
```

## 로컬 프리뷰 서버

대시보드, AI 게이트웨이, 에이전트 실행 API는 같은 origin의 preview server에서 함께 실행한다.

```bash
node tools/preview-server.mjs
```

브라우저에서 여는 주소는 다음과 같다.

```text
http://127.0.0.1:8766/csm-prototype/index.html
```

정적 파일 서버(`8765`)만 열어두면 `POST /api/ai/*`, `POST /api/agent/run` 같은 런타임 API가 동작하지 않는다.

## 에이전트 실행 패널 운영

Agent Run API는 9개사 117개 분기를 대상으로 검증 완료와 휴먼리뷰 백로그를 구분한다. 현재 단계 진행은 선택한 검증 스냅샷을 읽어 재검산 상태를 보여 주는 `snapshot_revalidation` 실행이며, DART 수집기나 Python 빌더를 실시간으로 실행하지 않는다.

```text
미완료 대상 선택 -> 에이전트 실행 ->
적재 원문 확인 -> 파싱 스냅샷 확인 -> Movement 계약 매핑 -> 스냅샷 재검산 -> 휴먼리뷰
```

운영 원칙은 다음과 같다.

- `검산` 완료 전에는 기존 대시보드 스냅샷을 유지한다.
- `검산` 성공 시 선택한 회사/분기 기준 동일 canonical snapshot을 반환한다.
- `휴먼리뷰`는 자동 완료시키지 않고 `검토 필요` 또는 `검토 없음`으로 끝낸다.
- 실패 시 마지막 검증 완료 스냅샷은 유지하고, 상단 단계 상태와 실패 사유만 바뀐다.
- `검증 완료` 상태 대상은 기본 실행 목록에서 숨긴다. 완료 대상을 다시 돌리는 기능은 운영자 재개방 사유가 생길 때만 별도 옵션으로 연다.

## AI 게이트웨이 환경변수

AI는 서버사이드 게이트웨이에서만 동작한다. 브라우저에는 API 키를 노출하지 않는다.

- `LLM_PROVIDER`: `mock` 또는 `openai`
- `LLM_API_KEY`: LLM 호출 키
- `LLM_MODEL`: 사용할 모델명
- `LLM_API_BASE_URL`: OpenAI-compatible API endpoint

키가 없으면 `mock` 모드로 동작하고, 이 경우에도 계약 JSON은 유지한다.

## 운영 원칙

- AI는 요청 기간이 명시된 실적 분석에는 해당 기간의 검증 스냅샷을 읽고, 전망 분석에는 생성 완료된 공통 전망 계약을 함께 읽는다.
- 업로드된 PDF나 로컬 문서는 AI 게이트웨이에 직접 넣지 않는다.
- `dataKind`, `validationStatus`, `reviewState`, `periodScope`를 항상 표시한다.
- 근거가 없는 질문은 숫자를 지어내지 말고 근거 부족 또는 검증 필요로 응답한다.
- forecast는 `csm-forecast-2026.json`의 9개사 공통 계약을 통해서만 노출하며 독립 모델, 경영계획 Base, Worst를 분리한다.
- 경영목표와 독립 모델의 차이는 `CSM 조정 등`에 포함하되 `targetAdjustmentOverlay`로 구분하고 설명에 포함 사실을 명시한다.
- 최신 계약에 없는 투자손익은 `0`으로 대체하지 않고 미제공으로 유지한다.
- 분기 공시 기초 CSM과 직전 연말 잔액 차이가 20십억원을 초과하면 `needs_review`로 분류한다.
