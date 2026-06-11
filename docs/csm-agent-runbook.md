# CSM Agent Runbook

작성일: 2026-06-11

## 목적

이 문서는 CSM Lens의 데이터 재생성, 검증, 리뷰, AI 게이트웨이, 에이전트 실행 패널 운영 절차를 정리한다. 설계 기준은 [agent-architecture.md](agent-architecture.md)를 우선하고, 제품 요구사항은 [superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md](superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md)를 참고한다.

## 기본 산출물

- `external-data/dart-2025-insurance-extract.json`
- `external-data/csm-dashboard-agent-output.json`
- `csm-prototype/dashboard-data.generated.js`
- `external-data/manual-review-overrides.json`

## 대시보드 재생성

외부 DART 기반 스냅샷과 대시보드 자바스크립트를 다시 만들 때는 다음 명령을 사용한다.

```bash
python tools/csm_agent_pipeline.py --write-dashboard
```

수동 검토 보정값을 반영하려면 오버라이드 파일을 함께 넘긴다.

```bash
python tools/csm_agent_pipeline.py --write-dashboard --review-overrides external-data/manual-review-overrides.json
```

## 검증

파이프라인 메타데이터, UI 구조, AI 계약, 에이전트 런타임 상태를 확인할 때는 다음 명령을 순서대로 실행한다.

```bash
python -m unittest tests.test_csm_agent_pipeline_metadata -v
node --check tools/preview-server.mjs
node --check csm-prototype/script.js
node --test tests/csm-lens-ia.test.mjs
node --test tests/test_ai_gateway_contract.mjs
node --test tests/test_agent_run_gateway.mjs
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

상단 실행 패널은 다음 흐름을 보여준다.

```text
회사/분기 선택 -> 에이전트 실행 ->
DART 수집 -> CSM 파싱 -> Movement 매핑 -> 검산 -> 휴먼리뷰
```

운영 원칙은 다음과 같다.

- `검산` 완료 전에는 기존 대시보드 스냅샷을 유지한다.
- `검산` 성공 시 선택한 회사/분기 기준 최신 snapshot으로 화면을 다시 그린다.
- `휴먼리뷰`는 자동 완료시키지 않고 `검토 필요` 또는 `검토 없음`으로 끝낸다.
- 실패 시 마지막 검증 완료 스냅샷은 유지하고, 상단 단계 상태와 실패 사유만 바뀐다.

## AI 게이트웨이 환경변수

AI는 서버사이드 게이트웨이에서만 동작한다. 브라우저에는 API 키를 노출하지 않는다.

- `LLM_PROVIDER`: `mock` 또는 `openai`
- `LLM_API_KEY`: LLM 호출 키
- `LLM_MODEL`: 사용할 모델명
- `LLM_API_BASE_URL`: OpenAI-compatible API endpoint

키가 없으면 `mock` 모드로 동작하고, 이 경우에도 계약 JSON은 유지한다.

## 운영 원칙

- AI는 최신 검증 스냅샷만 읽는다.
- 업로드된 PDF나 로컬 문서는 AI 게이트웨이에 직접 넣지 않는다.
- `dataKind`, `validationStatus`, `reviewState`, `periodScope`를 항상 표시한다.
- 근거가 없는 질문은 숫자를 지어내지 말고 근거 부족 또는 검증 필요로 응답한다.
- forecast는 최신 검증 기간에 대해서만 노출한다.
