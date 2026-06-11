# CSM Agent Runbook

작성일: 2026-06-11

## 목적

이 문서는 CSM Lens의 데이터 재생성, 검증, 리뷰, AI 게이트웨이 운영 절차를 정리한다. 설계 기준은 [agent-architecture.md](agent-architecture.md)를 우선하고, 제품 요구사항은 [superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md](superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md)를 참고한다.

## 기본 산출물

- external-data/dart-2025-insurance-extract.json
- external-data/csm-dashboard-agent-output.json
- csm-prototype/dashboard-data.generated.js
- external-data/manual-review-overrides.json

## 대시보드 재생성

다음 명령으로 외부 DART 기반 스냅샷과 대시보드 자바스크립트를 다시 만든다.

`ash
python tools/csm_agent_pipeline.py --write-dashboard
`

수동 검토 보정값을 반영하려면 오버라이드 파일을 함께 넘긴다.

`ash
python tools/csm_agent_pipeline.py --write-dashboard --review-overrides external-data/manual-review-overrides.json
`

## 검증

파이프라인 메타데이터와 기준 계약을 확인할 때는 다음 명령을 순서대로 실행한다.

`ash
python -m unittest tests.test_csm_agent_pipeline_metadata -v
node --check tools/preview-server.mjs
node --test tests/test_ai_gateway_contract.mjs
`

## 로컬 프리뷰 서버

대시보드와 AI 게이트웨이는 같은 origin에서 실행한다.

`ash
node tools/preview-server.mjs
`

브라우저에서 여는 주소는 다음과 같다.

`	ext
http://127.0.0.1:8765/csm-prototype/index.html
`

## AI 게이트웨이 환경변수

AI는 서버사이드 게이트웨이에서만 동작한다. 브라우저에는 API 키를 노출하지 않는다.

- LLM_PROVIDER: mock 또는 openai
- LLM_API_KEY: LLM 호출 키
- LLM_MODEL: 사용할 모델명
- LLM_API_BASE_URL: OpenAI-compatible API endpoint

키가 없으면 mock 모드로 동작하고, 이 경우에도 계약 JSON은 유지한다.

## 운영 원칙

- AI는 최신 검증 스냅샷만 읽는다.
- 업로드된 PDF나 로컬 문서는 AI 게이트웨이에 직접 넣지 않는다.
- dataKind, alidationStatus, 
eviewState, periodScope를 항상 표시한다.
- 근거가 없는 질문은 숫자를 지어내지 말고 검증필요 또는 근거부족으로 응답한다.
- forecast는 최신 검증 기간에 대해서만 노출한다.
