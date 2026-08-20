# CSM Lens System Architecture

최종 갱신: 2026-08-15

## 문서 역할

이 문서는 CSM Lens의 현재 시스템 설계 기준 문서다. 실제 구현, 에이전트/워커 설계, 데이터 계약, 최신 데이터 기준, Movement 표준, LLM 사용 원칙, 안전장치는 이 문서를 우선한다. 운영 절차와 재생성 명령은 [csm-agent-runbook.md](csm-agent-runbook.md)를 함께 본다. AI 기능은 같은 origin의 preview server gateway를 통해서만 연결한다.

제품 배경, 사용자 문제, 초기 기능 요구사항은 [보험업계 CSM 경영 대시보드 PRD](superpowers/specs/2026-06-09-insurance-csm-dashboard-prd.md)를 참고한다. 단, 두 문서의 기준이 충돌하면 이 문서를 최신 기준으로 본다.

## 1. 시스템 정체성

CSM Lens는 보험업계 CSM 벤치마킹과 리서치 보조를 위한 분석 시스템이다. 공개 공시자료와 사용자가 검토한 정형 데이터를 바탕으로 보험사별 CSM 규모, 변동 원인, 손익 및 지급여력 지표를 빠르게 비교하고 설명하는 것이 목적이다.

이 시스템은 회사 내부 계리 산출 시스템, 회계 정책 판단 시스템, 투자 의사결정 시스템을 대체하지 않는다. 모든 분석 결과는 사람이 검토할 수 있는 근거, 계산식, 기준, 검산 상태와 함께 제공되어야 한다.

## 2. 사용자와 사용 목적

1차 사용자는 계리팀 실무자다. 실무자는 공시 원문, 파싱 결과, CSM Movement, 보험사 비교, 검산 결과를 확인하고 보고자료 작성 전 숫자의 기준과 원인을 검토한다.

2차 사용자는 계리 리더, 경영기획, CFO 조직, 임원진이다. 이들은 실무자가 검산한 결과를 바탕으로 CSM 방향성, 회사 간 차이, 주요 리스크, 회의용 질문을 짧게 파악한다.

사용자별 핵심 가치는 다음과 같다.

| 사용자 | 핵심 가치 |
| --- | --- |
| 계리 실무자 | 공시 수집, 표 탐지, 항목 매핑, 단위 변환, 합계 검산, 원문 추적 시간 절감 |
| 계리 리더 | CSM 증감 원인과 검토필요 항목을 빠르게 확인 |
| 경영진 | 검산된 비교 결과와 핵심 메시지를 짧게 확인 |
| 보고 담당자 | 실무 근거가 연결된 요약 문장과 표 초안을 확보 |

## 3. 현재 범위

현재 대상은 생명보험 4개사와 손해보험 5개사다. `external-data/csm-quarterly-dashboard-data.json`의 9개사 2023 Q1~2026 Q1 분기 데이터가 화면, AI Gateway, Agent Run Gateway의 단일 진실 원천이다. 초기 삼성생명·삼성화재 2개사 산출물은 회귀 참고용으로만 보존한다.

회사와 기간을 확장할 때는 다음 기준을 적용한다.

- CSM 관련 표 자동 탐지 성공률이 안정적으로 확인될 것
- 핵심 Movement 항목 매핑이 반복 가능할 것
- 원문 위치, 단위, 연결/별도 기준, 재보험 제외 여부가 추적될 것
- 기시 CSM과 변동 항목의 합이 기말 CSM과 검산될 것
- 검토필요 항목이 조용히 보정되지 않고 사용자에게 노출될 것

## 4. 데이터 기준

현재 시스템의 기준은 다음과 같이 고정한다.

| 항목 | 기준 |
| --- | --- |
| 보유 CSM | 별도재무제표 기준, 재보험 제외 기준 |
| 보험손익 | 별도재무제표 기준 보험서비스손익 |
| 투자손익 | 최신 9개사 분기 계약에서는 미제공. 없는 값을 0으로 대체하지 않음 |
| 당기순이익 | 지배주주 연결손익 기준 |
| 법인세비용 | 연결 손익 구성의 차감항목, 음수 기여값으로 저장 |
| 비지배지분 | 투자손익 역산 시 지배주주 연결손익을 연결 당기순이익으로 되돌리는 조정항목 |
| K-ICS 비율 | 지급여력 공시 기준 |
| 기시 CSM | 누적 기준은 전년도말, 분기 단독 기준은 직전 분기말 |

초기 2개사 파일럿은 투자손익을 다음 방식으로 역산했다. 이 값은 현재 9개사 분기 계약으로 승격되지 않았으며 AI도 표시하지 않는다.

```text
투자손익
= 지배주주 연결손익
+ 비지배지분
- 별도 보험서비스손익
- 법인세비용
```

법인세비용은 손익 구성의 차감항목이므로 정규화 데이터에는 음수 기여값으로 저장한다. 지배주주 연결손익과 비지배지분을 합산한 값은 연결 당기순이익(비지배 차감 전)에 해당한다.

현재 제품은 외부 DART/FISIS 추출 산출물을 읽어 화면을 채우는 생성형 정적 웹앱이다. 브라우저는 `csm-prototype/dashboard-data.generated.js`를 읽고, AI와 Agent Run은 같은 원본 JSON을 `tools/dashboard-contract.mjs`를 통해 읽는다. 실시간 Open DART 자동 수집과 원문 파싱은 별도 Python 파이프라인 단계로 관리한다.

샘플 숫자와 실제 파싱 숫자는 반드시 구분한다. 샘플 숫자는 화면 구조와 분석 흐름 검증에만 사용하며, 실제 대시보드 집계에는 원문 출처가 있는 값만 사용한다.

## 5. CSM Movement 표준

시스템은 CSM Movement를 다음 공식으로 정규화한다.

```text
기말 CSM
= 기시 CSM
+ 신계약 CSM
+ 이자부리
+ CSM 조정 등
+ CSM 상각 (음수 저장)
```

Movement 표시 순서는 다음을 기본으로 한다.

```text
기시 CSM -> 신계약 -> 이자부리 -> CSM 조정 등 -> CSM 상각 -> 기말 CSM
```

`CSM 조정 등`에는 가정변경, 경험조정, 기타 조정, 환율효과, 공시상 세부 항목으로 분리하기 어려운 자잘한 항목을 포함한다. 원본 항목은 별도 보존하고, 표준 항목으로 통합할 때는 매핑 근거와 신뢰도를 남긴다.

모든 분기의 기시 CSM은 전년도말 데이터로 설정한다. 이 기준을 적용하면서 기말 CSM 검산 차이가 발생하면, 원본 항목을 보존한 상태에서 분석용 `CSM 조정 등`에 차이를 흡수하고 검산 로그에 남긴다.

워터폴 차트는 다음 원칙을 따른다.

- 다음 Movement 막대의 시작점은 이전 Movement 막대의 끝점이다.
- `CSM 조정 등`은 `CSM 상각`보다 먼저 표시한다.
- 상품군 믹스는 워터폴 우측에 별도 스택으로 표시한다.
- 상품군 라벨은 스택 아래가 아니라 우측에 위치한다.

## 6. 현재 프로토타입 상태

현재 프로토타입은 `csm-prototype` 폴더의 정적 웹앱과 로컬 preview runtime으로 구현되어 있다.

주요 화면 기능은 다음과 같다.

- 회사 범위: 생명보험 4개사, 손해보험 5개사
- 기간 범위: 2022~2025년말, 2023 Q1~2026 Q1
- 핵심 KPI: 보유 CSM, 신계약 CSM, CSM 상각, 보험손익, 당기순이익, K-ICS 비율
- CSM 변동 워터폴: 기시 CSM, 신계약, 이자부리, CSM 조정 등, CSM 상각, 기말 CSM
- 보험사 비교표: 생보/손보 그룹별 CSM, 신계약, 보험손익, 당기순이익, K-ICS
- 전망: 2026·2027·2028·2030·2035년 Base/Worst 시나리오
- 데이터 품질 패널: 원문 공시 링크, CSM 표 탐지, Movement 합계 검증, 수작업 보정 상태
- Human Review Workbench: 검토 큐, 검토 사유, 원문 표, 수작업 보정 상태

프로토타입의 제한은 다음과 같다.

- Open DART/FISIS 수집과 원문 파싱은 Python 배치로 연결되어 있으나 실시간 요청형은 아니다.
- LLM API 연동은 같은 origin의 preview server gateway를 통해서만 연결한다.
- 정적 운영 화면에는 AI/Agent Run 패널이 아직 연결되어 있지 않다.
- Agent Run 단계 진행은 현재 스냅샷 재검산(`snapshot_revalidation`)이며 실제 DART/FISIS 배치 실행기가 아니다.

## 6-1. 화면 정보구조와 UX 원칙

CSM Lens의 UI는 긴 보고서형 스크롤 페이지가 아니라 분석 워크벤치로 설계한다. 기본 구조는 `좌측 그룹 내비게이션 + 중앙 메인 캔버스 + 우측 AI 보조 패널`이다.

좌측 내비게이션은 기능 성격별로 그룹화한다.

| 그룹 | 탭 | 목적 |
| --- | --- | --- |
| Monitor | 개요, 회사 분석 | 핵심 상태와 선택 회사의 상세 분석 |
| Compare | 시장 비교 | 보험사 간 지표 비교와 차이 확인 |
| Forecast | 전망 | 최신 검증 기간 기준의 다음 연말 전망 |
| Trust | 데이터 품질 | 출처, 검산, 휴먼리뷰, 보정 이력 관리 |

중앙 메인 캔버스는 선택한 탭의 핵심 업무만 표시한다. 데스크톱에서는 앱 전체 스크롤에 의존하지 않고 한 화면 안에서 주요 정보를 읽도록 하며, 긴 표나 리뷰 큐처럼 불가피한 영역만 내부 스크롤을 허용한다.

우측 AI 패널은 독립 탭이 아니라 보조 레이어다. 현재 탭, 회사, 기간, 검증 상태를 문맥으로 사용하며, 분석 결과는 근거와 검산 상태를 함께 표시한다. AI 패널은 메인 콘텐츠보다 강한 시각 계층을 갖지 않는다.

모든 화면에는 현재 회사, 현재 기간, 데이터 성격, 검증 상태가 시야 안에 있어야 한다. 데이터 품질 상세는 `데이터 품질` 탭에 집중하되, 다른 탭에도 얇은 배지와 상태 문구로 노출한다.

## 6-2. 에이전트 실행 가시화

preview runtime은 공통 Agent Timeline 계약을 제공한다. 기본 실행 목록에는 `failed`, `needs_review`, 이후 확장 시 `not_started` 같은 미완료 상태만 노출하고, `completed` 상태는 기본적으로 숨긴다.

```text
적재 원문 확인 -> 파싱 스냅샷 확인 -> Movement 계약 매핑 -> 스냅샷 재검산 -> 휴먼리뷰
```

상태 모델은 다음과 같이 고정한다.

| 구분 | 상태 |
| --- | --- |
| 실행 상태 | `idle`, `running`, `completed`, `failed` |
| 단계 상태 | `idle`, `running`, `completed`, `needs_review`, `failed`, `not_required` |

동작 원칙은 다음과 같다.

- 실행 중에는 회사/기간 선택과 실행 버튼을 잠근다.
- 실행 버튼은 백로그에 남아 있는 대상이 있을 때만 활성화된다.
- 검증 완료 상태의 회사/분기는 API와 UI 양쪽에서 기본 재실행을 막는다. 예외적 재실행은 추후 관리자 옵션으로만 연다.
- `검산` 단계가 완료되기 전에는 기존 대시보드 스냅샷을 유지한다.
- `검산`까지 성공하면 선택한 회사/분기의 최신 검증 스냅샷으로 화면을 즉시 다시 그린다.
- `휴먼리뷰`는 자동 완료시키지 않고, 검토 큐가 있으면 `needs_review`, 없으면 `not_required`로 끝낸다.
- `검산` 실패 시 마지막 검증 완료 스냅샷은 유지하고, 단계 상태와 실패 사유만 상단에 보여준다.
- 샘플값은 실제값처럼 표시하지 않는다. 상단 메타에는 현재 스냅샷이 `actual`인지 `sample`인지 함께 표시한다.

V1 런타임 API는 preview server 안에 메모리 상태로 구현한다.

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/agent/run` | 회사/분기 기준 실행 시작 |
| `GET` | `/api/agent/run/:runId` | 단계 상태 폴링 |

프론트는 500ms 간격 polling으로 상태를 갱신한다. V1에서는 websocket이나 SSE를 사용하지 않는다.

## 7. 에이전트 구성 원칙

숫자 수집, 단위 변환, 합계 검산, 기준 적용은 결정론적 워커가 담당한다. LLM은 표 의미 해석, 항목 매핑 보조, 비교 분석 문장화, 후속 질문 응답처럼 판단과 언어화가 필요한 영역에 제한적으로 사용한다.

모든 워커와 에이전트는 다음 원칙을 따른다.

- 출처 없는 숫자는 실제 집계에 사용하지 않는다.
- 원문 파싱값, 사용자 보정값, 시스템 계산값, LLM 추정값을 구분한다.
- 연결/별도, 재보험 제외 여부, 기간, 단위 기준을 항상 함께 보존한다.
- 검산 실패를 자동으로 숨기지 않고 `검토필요`로 표시한다.
- LLM 응답은 근거 데이터, 계산식, 기준, 검산 상태를 함께 제공한다.
- 전망과 분석 문장은 투자 추천이나 의사결정 지시로 표현하지 않는다.

## 8. 결정론적 워커

### 8.1 `dart-ingestion-worker`

Open DART API에서 회사 마스터, 정기보고서 목록, 공시 원문, XBRL 원문, 전체 재무제표 데이터를 수집한다.

주요 입력은 다음과 같다.

- `corp_code`
- 사업연도
- 보고서 코드: `11013`, `11012`, `11014`, `11011`
- 분석 대상 회사 목록

주요 API는 다음과 같다.

| 용도 | API |
| --- | --- |
| 회사 마스터 | `corpCode.xml` |
| 정기보고서 검색 | `list.json` |
| 공시 원문 | `document.xml` |
| XBRL 원문 | `fnlttXbrl.xml` |
| 전체 재무제표 | `fnlttSinglAcntAll.json` |

출력은 원문 파일, 접수번호, 보고서명, 보고서 코드, 정정 여부, 수집 시각, 원문 링크, 저장 위치 메타데이터다.

### 8.2 `quality-checker`

수집, 파싱, 매핑, 계산, 보정의 모든 단계에서 품질을 검증한다.

검증 항목은 다음과 같다.

- 원문 출처 존재 여부
- 접수번호와 보고서 코드 일치 여부
- 연결/별도 기준
- 재보험 제외 여부
- 단위 변환 일관성
- 음수와 괄호 표기 처리
- 기시 CSM과 변동 항목 합계 검산
- 기말 CSM과 공시값 차이
- 정정공시 반영 여부
- 사용자 보정값과 원본값의 구분
- LLM 응답의 근거와 계산식 존재 여부

검증 결과는 `통과`, `검토필요`, `실패` 중 하나로 남긴다.

## 9. LLM 보조 에이전트

### 9.1 `csm-parser-agent`

공시 원문과 XBRL 자료에서 CSM 관련 주석과 표를 탐지하도록 보조한다.

주요 탐지 키워드는 다음과 같다.

- `보험계약서비스마진`
- `계약서비스마진`
- `CSM`
- `보험계약부채`
- `잔여보장부채`
- `보험수익`
- `손실요소`

이 에이전트는 숫자를 최종 확정하지 않는다. 후보 섹션, 표 제목, 주변 문맥, 원문 위치, 탐지 신뢰도를 제공하고, 최종 숫자 추출과 검산은 결정론적 파서와 `quality-checker`가 확인한다.

### 9.2 `movement-mapping-agent`

원문 표의 항목명을 표준 Movement 항목으로 매핑한다.

표준 항목은 다음과 같다.

- 기시 CSM
- 신계약 CSM
- 이자부리
- CSM 조정 등
- CSM 상각
- 기말 CSM

`보험서비스 제공에 따른 인식`, `당기손익 인식`, `수익인식`, `상각`은 `CSM 상각` 후보로 본다. `미래서비스 관련 변동`, `가정변경`, `경험조정`, `기타`, `환율효과`는 `CSM 조정 등` 후보로 본다.

출력에는 표준 항목, 원본 항목명, 원본 위치, 매핑 신뢰도, 부호 방향, 검토필요 여부가 포함되어야 한다.

### 9.3 `benchmark-analysis-agent`

같은 업권 보험사 간 Peer 비교 분석을 생성한다. AI 기능의 1차 MVP는 이 에이전트다.

주요 질문은 `누가 더 좋은가`가 아니라 `왜 차이가 나는가`다. 이 시스템은 투자판단 도구가 아니라 벤치마킹 도구이므로, 순위 판단보다 원인분해와 기준 차이 설명을 우선한다.

분석 범위는 다음과 같다.

- 보유 CSM 규모 차이
- 전기 대비 증감률 차이
- 신계약 CSM 기여도
- CSM 상각 부담
- CSM 조정 등 항목의 영향
- 보험손익, 투자손익, 당기순이익 비교
- K-ICS 비율 비교
- 생보/손보 상품 믹스 차이
- 기준 혼합 위험과 해석 주의점

응답에는 항상 다음을 포함한다.

- 사용 회사와 기간
- 사용 지표 목록
- 핵심 비교 메시지
- 계산식 또는 비교 산식
- 검산 상태
- 해석 주의사항
- 추가로 확인할 질문

### 9.4 `forecast-draft-agent`

시나리오 기반 전망 초안을 생성한다. 이 에이전트는 확정적 예측을 하지 않는다.

입력은 가장 최근에 공시되어 대시보드에 적재된 기간의 CSM Movement, 신계약 CSM, CSM 상각, CSM 조정 등, 보험손익, 투자손익, 시나리오 가정이다. 현재 프로토타입은 Base와 Worst 시나리오를 사용한다.

기간 선택값이 과거 분기여도 전망 기준은 바꾸지 않는다. 예를 들어 2025년 연말 공시 데이터가 이미 입력되어 있으면, 2025년 1분기나 2분기 기준 전망은 실적값이 존재하므로 별도 전망으로 제공하지 않고 2025년 연말 기준 다음 연말 전망만 보여준다.

출력은 다음 구조를 따른다.

- 보유 CSM 전망 초안
- 보험손익 전망 초안
- 투자손익 전망 초안
- 당기손익 전망 초안
- 사용 가정
- 계산식
- 리스크 요인
- 검토필요 문장

Open DART 자료만으로는 향후 전망의 근거가 제한적이다. IR 자료, 실적발표 자료, 애널리스트 자료, 금리 및 시장 지표를 붙이기 전까지 전망 기능은 `가정 기반 초안`으로 표시한다.

### 9.5 `ai-review-assistant`

사용자의 자연어 질문에 답하는 채팅형 분석 보조 에이전트다.

1차 역할은 자유 질의응답이지만, 답변은 현재 시스템에 적재된 데이터와 검산 가능한 계산에 묶여 있어야 한다. 예시는 다음과 같다.

- `한화생명과 삼성생명의 CSM 차이는 왜 발생했어?`
- `2025 Q4 기준 신계약 CSM 기여도를 비교해줘.`
- `CSM 조정 등이 큰 회사는 어디야?`
- `임원 보고용으로 핵심 메시지를 5줄로 줄여줘.`
- `이 분석에서 검토필요한 숫자는 뭐야?`

답변마다 다음 블록을 붙인다.

```text
기준: 회사, 기간, 재무제표 기준, 재보험 제외 여부
사용 데이터: 지표명과 값
계산식: 비교 또는 검산에 사용한 산식
검산 상태: 통과, 검토필요, 실패
주의: 샘플 여부, 기준 혼합 여부, 원문 미연결 여부
```

LLM이 계산을 수행할 수는 있지만, 최종 수치는 가능하면 코드 계산값과 대조한다. 코드 검산이 불가능한 계산은 `검산필요`로 표시한다.

## 10. 사람 검토 워크벤치

### 10.1 `human-review-workbench`

계리 실무자가 자동 처리 결과를 확인하고 보정하는 작업 화면이다.

필수 기능은 다음과 같다.

- 원문 표와 파싱 표를 나란히 확인
- 원문 셀, 단위, 부호, 연결/별도 기준 확인
- 표준 Movement 항목 매핑 수정
- 사용자 보정값 입력
- 보정 사유 입력
- 검토 완료 상태 저장
- LLM 분석 문장 승인 또는 수정

사용자 보정은 원본값을 덮어쓰지 않는다. 원본값, 보정값, 보정 사유, 작성자, 변경 시각을 모두 보존한다.

## 11. 처리 흐름

표준 처리 흐름은 다음과 같다.

```text
1. dart-ingestion-worker
   9개 보험사의 정기보고서, 원문, XBRL, 재무제표 데이터를 수집한다.

2. csm-parser-agent
   CSM 관련 후보 섹션과 표를 탐지한다.

3. deterministic parser
   표 구조, 헤더, 셀 값, 단위, 원문 위치를 추출한다.

4. quality-checker
   원문 출처, 단위, 기준, 표 구조를 검증한다.

5. movement-mapping-agent
   원문 항목을 표준 Movement 항목으로 매핑한다.

6. quality-checker
   Movement 합계, 기말 CSM 차이, 이상치를 검산한다.

7. human-review-workbench
   검토필요 항목을 사람이 확인하고 보정한다.

8. dashboard renderer
   KPI 카드, 워터폴, Peer 비교, 전망 초안, 데이터 품질 상태를 표시한다.

9. benchmark-analysis-agent
   검산된 적재 데이터를 기준으로 Peer 비교 분석을 생성한다.

10. ai-review-assistant
    사용자의 자유 질문에 근거와 검산 상태를 포함해 답한다.

11. forecast-draft-agent
    가정 기반 전망 초안을 만들고 사람이 검토한다.
```

## 12. 데이터 계약

### 12.1 `company`

```text
company_id
corp_code
corp_name
stock_code
sector
is_pilot_target
created_at
updated_at
```

### 12.2 `filing`

```text
filing_id
company_id
report_code
report_name
rcept_no
rcept_dt
period_start
period_end
is_amended
source_url
collected_at
```

### 12.3 `parsed_csm_table`

```text
table_id
filing_id
section_title
table_title
statement_scope
reinsurance_scope
unit
xml_path
raw_headers
raw_rows
parser_confidence
created_at
```

### 12.4 `csm_movement_metric`

```text
metric_id
filing_id
company_id
period
metric_key
metric_label_original
metric_label_standard
raw_value
normalized_value
unit
sign
source_cell
mapping_confidence
review_status
```

### 12.5 `financial_metric`

```text
metric_id
filing_id
company_id
period
metric_key
metric_label
statement_scope
raw_value
normalized_value
unit
source_cell
review_status
```

### 12.6 `quality_check`

```text
check_id
target_type
target_id
check_type
status
message
expected_value
actual_value
created_at
```

실행 payload의 `qualityChecks` 배열은 위 논리 테이블보다 평면적이다. 실제 항목은 다음 공통 키를 사용한다.

```text
agent
company
period
check
ok
diff_bn
source_tables
formula
details
```

### 12.7 `ai_analysis`

```text
analysis_id
analysis_type
company_ids
period
input_context_hash
summary
analysis_points
evidence
calculations
confidence
review_status
created_at
```

### 12.8 `dashboard_payload`

`external-data/csm-quarterly-dashboard-data.json`이 canonical payload다. `csm-prototype/dashboard-data.generated.js`는 이 JSON의 브라우저 번들이고, `tools/dashboard-contract.mjs`는 같은 JSON에서 AI/Agent용 런타임 필드를 파생한다. 최상위 원본 키는 다음과 같다.

```text
dataContractVersion
periodBasis
years
sampleData
methodologyRegistry
quarterlyBuild
```

런타임 어댑터는 원본 숫자를 복제하지 않고 `runtimeContractVersion`, `analysisPolicy`, `reviewItems`, `reviewSummary`를 추가한다. 초기 `csm-dashboard-agent-output.json`은 2개사 파일럿 보존물이며 현재 입력이 아니다.

### 12.9 `dashboard_period`

`sampleData[company_id].periods[period_id]`는 다음 필드를 가진다.

```text
csm
growth
movement
insuranceProfit
parentNetIncome
kics
solvencyBasis
quality
sourceReference
metricBasis
quarterlyAudit
```

`movement`는 다음 구조를 따른다.

```text
opening
newbiz
interest
adjustment
amortization
closing
```

### 12.10 `dashboard_financial_period`

분기 손익은 `sampleData[company_id].periods[period_id]` 안에 저장한다. 런타임 어댑터는 이를 다음 공통 구조로 읽는다.

```text
insuranceProfit
investmentProfit (현재 분기 계약에서는 null)
netIncome
kics
sourceReferences
```

계약에 없는 투자손익은 `0`으로 바꾸지 않는다. AI evidence와 브리핑에서도 제외한다.

### 12.11 `review_item`

`reviewItems`는 사람이 확인해야 하는 항목의 대기열이다. 각 항목은 다음 필드를 포함한다.

```text
id
company
companyName
period
category
metric
title
status
severity
systemValue
basis
sourceReference
reviewReason
recommendedAction
validation
```

현재 리뷰 항목은 분기마다 Movement와 손익/K-ICS 두 건을 파생한다. Movement 항등식, 원문 추적정보, 필수 재무지표를 검증하고, 공시 기초 CSM과 직전 연말 잔액 차이가 20십억원을 초과하면 `needs_review`로 분류한다. 원본값은 변경하지 않는다.

### 12.12 `review_summary`

`reviewSummary`는 현재 선택값의 검토 현황 요약이다.

```text
total
passed
needs_review
failed
```

### 12.13 ai_response_bundle

/api/ai/analyze 및 /api/ai/chat 응답의 공통 구조를 정의한다.

- dataKind: actual 또는 sample
- audience: practitioner 또는 executive
- analysisType: anomaly, movement, forecast, peer, briefing, chat
- company, companyName, period, periodLabel
- periodScope
- validationStatus
- reviewState
- snapshotHash
- answer
- insightCards
- evidence
- calculation
- followUps
- unsupportedReason: 지원 범위를 벗어날 때만 사용

insightCards에는 title, status, summary, evidence, calculation, followUps를 포함한다.

## 13. LLM 사용 원칙

LLM은 설명 보조와 요약 보조에만 사용하고, 진실의 원천은 아니다.

- LLM 입력에는 최신 검증 스냅샷과 현재 요청 정보만 넣는다. 원문 PDF, 업로드 파일, 미검증 초안은 넣지 않는다.
- LLM은 숫자를 새로 발명하지 않는다. 실적은 `csm-quarterly-dashboard-data.json`, 전망은 `csm-forecast-2026.json`을 공통 런타임 계약으로 해석한 값만 사용한다.
- 프롬프트에는 요청 회사, 요청 기간 또는 최신 기간, audience, analysisType, reviewState만 명시한다.
- 응답은 JSON-first로 만들고 answer, evidence, calculation, followUps를 먼저 채운다.
- dataKind, validationStatus, reviewState, periodScope, snapshotHash와 전망 응답의 forecastHash를 항상 노출한다.
- 지원 범위를 벗어난 질문은 숫자를 생성하지 말고 grounded refusal로 응답한다.
- 실무자 톤은 세부 근거를, 임원 톤은 핵심만 보여 주되 사실은 바꾸지 않는다.

LLM 출력 우선순위:

1. answer
2. evidence
3. calculation
4. followUps
5. validationStatus
6. periodScope

## 14. AI 레이어 V1

AI 레이어는 1차 MVP에서 다음 기능만 제공한다.

- 이상징후 감지
- CSM Movement 원인분해
- Peer 비교
- 임원용 요약
- 자연어 질의응답
- 최신 검증 기간만 전망을 노출하는 규칙
- 검증 상태와 근거를 항상 함께 보여 주는 규칙

AI는 다음을 하지 않는다.

- 투자 추천
- 일반 잡담
- 출처 없는 예측
- 샘플값을 실제값처럼 표시하는 행위
- 검증 실패를 숨기는 행위

## 15. 전망 기능 원칙

전망은 가장 최근에 검증된 공시 기간을 기준으로만 보여 준다.

- 현재 최신 실적이 2026년 1분기까지 있으므로 전망 기준은 2026년 1분기말이다.
- 2025년 1분기, 2분기처럼 이미 실적값이 있는 과거 분기의 전망은 노출하지 않는다.
- 최신 검증 기간이 바뀌면 전망 기준도 자동으로 바뀐다.
- 전망 CSM을 보여 줄 때는 Movement 전망도 함께 보여 준다.
- 대시보드에는 전망 시점을 명시한다.
- Base는 전년 계절성, Q1 성장 신호, 최근 최대 3개년 조정률을 사용하는 결정론적 모델을 우선한다.
- 회사별 직접 증권사 근거가 있는 경우에만 정성 입력을 25% 오버레이한다.
- Worst는 전 보험사 공통 단순 하방률(잔여 신계약 CSM -10%, CSM 조정 10% 악화)을 사용한다.
- 롤링 백테스트는 Worst 산식이 아니라 신뢰도·검증 제한 라벨의 참고 표본으로 보존한다.
- 사용자가 실적 분석 기간을 명시하면 AI는 해당 기간을 사용한다. 전망 경로는 latest-validated-only 규칙을 따른다.

## 16. 금지사항과 안전장치

다음은 금지한다.

- 근거 없는 숫자 생성
- 샘플 데이터와 실데이터 혼합
- 보험사 간 기준 혼합
- 검증 실패를 정상값처럼 표시하는 것
- 투자 판단이나 매수/매도 추천
- 일반 목적의 잡담형 챗봇처럼 동작하는 것
- 근거, 계산식, 기준, 검증 상태 없이 답변하는 것
- 최신 검증 기간을 벗어난 전망을 기본값으로 노출하는 것

안전장치:

- 모든 AI 응답은 evidence와 calculation을 포함한다.
- 모든 응답에 validationStatus와 periodScope를 포함한다.
- reviewState가 needs_review 또는 failed면 화면에 경고를 표시한다.
- AI는 canonical 계약에 없는 회사 또는 기간을 요청할 때 unsupported로 응답한다.

## 17. 구현 우선순위

1. 검증된 대시보드 데이터 계약 고정
2. CSM 및 손익 기준 문서 정리
3. Movement 원인분해 규칙 정리
4. AI gateway와 same-origin preview server 연결
5. 브라우저 대시보드에 AI 패널과 채팅 추가
6. benchmark-analysis-agent 성격의 Peer 비교 분석
7. ai-review-assistant 성격의 자연어 질의응답
8. IR/임원 보고용 짧은 요약
9. 문서와 테스트를 동기화
## 18. 운영 절차

운영자가 가장 자주 실행하는 절차는 다음과 같다.

1. 파이프라인 재생성

```bash
python tools/build_annual_dashboard_data.py
python tools/build_quarterly_dashboard_data.py
python tools/build_csm_forecast.py
```

2. 파이썬 검증

```bash
python tools/test_quarterly_dashboard_data.py
node --test tests/dashboard-contract.test.mjs
node --test tests/test_ai_gateway_contract.mjs
node --test tests/test_agent_run_gateway.mjs
```

3. 대시보드 JavaScript 문법 확인

```bash
node --check csm-prototype/script.js
```

4. 로컬 화면 확인

```text
http://127.0.0.1:8766/csm-prototype/index.html
```

5. 실패 시 우선 확인할 항목

- `reviewItems`에서 `needs_review` 또는 `failed` 항목
- `sampleData`의 `sourceReference`
- `quarterlyAudit.openingReconciliationDifference`
- `dashboard-data.generated.js`가 최신 산출물인지 여부

