# CSM Lens System Architecture

작성일: 2026-06-10

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

## 3. 파일럿 범위

파일럿 대상 보험사는 삼성생명과 삼성화재로 제한한다. 생명보험과 손해보험을 각각 1개씩 먼저 다루어 업권별 공시 구조와 Movement 표현 차이를 확인한다.

파일럿에서 정확도가 검증되기 전에는 보험사를 늘리지 않는다. 확장 기준은 다음과 같다.

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
| 투자손익 | 별도 투자손익 + 영업외손익 + 연결효과 |
| 당기순이익 | 지배주주 연결손익 기준 |
| 법인세비용 | 연결 손익 구성의 차감항목, 음수 기여값으로 저장 |
| 비지배지분 | 투자손익 역산 시 지배주주 연결손익을 연결 당기순이익으로 되돌리는 조정항목 |
| K-ICS 비율 | 지급여력 공시 기준 |
| 기시 CSM | 모든 분기에서 전년도말 데이터 기준 |

투자손익의 표시 기준명은 실적발표 자료의 관리손익 구성을 따라 `별도 투자손익 + 영업외손익 + 연결효과`로 둔다. 다만 구성요소별 원천 파싱이 불안정하거나 항목명이 회사별로 흔들릴 수 있으므로, 계산은 다음 방식으로 역산하여 적용하고 화면에는 작은 주석으로 표시한다.

```text
투자손익
= 지배주주 연결손익
+ 비지배지분
- 별도 보험서비스손익
- 법인세비용
```

법인세비용은 손익 구성의 차감항목이므로 정규화 데이터에는 음수 기여값으로 저장한다. 지배주주 연결손익과 비지배지분을 합산한 값은 연결 당기순이익(비지배 차감 전)에 해당한다.

현재 1차 프로토타입은 외부 DART 추출 산출물을 읽어 화면을 채우는 생성형 정적 웹앱이다. `csm-prototype/dashboard-data.generated.js`가 있으면 이를 우선 덮어쓰고, 없을 때만 내장 샘플을 fallback으로 사용한다. 실시간 Open DART 자동 수집과 원문 파싱은 별도 파이프라인 단계로 관리한다.

샘플 숫자와 실제 파싱 숫자는 반드시 구분한다. 샘플 숫자는 화면 구조와 분석 흐름 검증에만 사용하며, 실제 대시보드 집계에는 원문 출처가 있는 값만 사용한다.

## 5. CSM Movement 표준

시스템은 CSM Movement를 다음 공식으로 정규화한다.

```text
기말 CSM
= 기시 CSM
+ 신계약 CSM
+ 이자부리
+ CSM 조정 등
- CSM 상각
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

현재 프로토타입은 `csm-prototype` 폴더의 정적 웹앱으로 구현되어 있다.

주요 화면 기능은 다음과 같다.

- 회사 선택: 삼성생명, 삼성화재
- 기간 선택: 2025 Q1, Q2, Q3, Q4
- 핵심 KPI 카드: 보유 CSM, 전기 대비, 신계약 CSM, CSM 상각, 보험손익, 투자손익, 당기순이익, K-ICS 비율
- CSM 변동 워터폴: 기시 CSM, 신계약, 이자부리, CSM 조정 등, CSM 상각, 기말 CSM
- 상품군 믹스: 생보는 금융, 사망, 건강 / 손보는 일반, 자동차, 장기
- 보험사 비교표: CSM 기준, 손익 기준, 보유 CSM, 증감률, 보험손익, 투자손익, 당기순이익, K-ICS, 주요 유형
- 전망 초안: Base, Conservative, Optimistic 시나리오 기반 수치 전망과 산식
- 데이터 품질 패널: 원문 공시 링크, CSM 표 탐지, Movement 합계 검증, 수작업 보정 상태
- Human Review Workbench: 검토 큐, 검토 사유, 원문 표, 수작업 보정 상태

프로토타입의 제한은 다음과 같다.

- Open DART API 자동 수집은 아직 연결되지 않았다.
- 공시 원문 XML/XBRL 파싱은 아직 연결되지 않았다.
- LLM API 연동은 같은 origin의 preview server gateway를 통해 연결한다.
- 일부 값은 화면 검증용 샘플이며, 실제 리포팅용 수치로 사용하면 안 된다.

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

삼성생명과 삼성화재의 Peer 비교 분석을 생성한다. AI 기능의 1차 MVP는 이 에이전트다.

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

입력은 가장 최근에 공시되어 대시보드에 적재된 기간의 CSM Movement, 신계약 CSM, CSM 상각, CSM 조정 등, 보험손익, 투자손익, 시나리오 가정이다. 현재 프로토타입은 Base, Conservative, Optimistic 시나리오를 사용한다.

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

- `삼성생명과 삼성화재의 CSM 차이는 왜 발생했어?`
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
   삼성생명과 삼성화재의 정기보고서, 원문, XBRL, 재무제표 데이터를 수집한다.

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

`external-data/csm-dashboard-agent-output.json`과 `csm-prototype/dashboard-data.generated.js`는 같은 payload를 공유한다. 최상위 키는 다음과 같다.

```text
dataContractVersion
generatedAt
sourcePolicy
generatedFrom
agents
sampleData
financialMetrics
qualityChecks
reviewSummary
reviewItems
```

### 12.9 `dashboard_period`

`sampleData[company_id].periods[period_id]`는 다음 필드를 가진다.

```text
csm
growth
movement
mix
quality
sourceReference
summary
forecast
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

`financialMetrics[company_id][period_id]`는 다음 필드를 가진다.

```text
insuranceProfit
investmentProfit
netIncome
kics
csmScope
profitScope
insuranceScope
investmentScope
investmentCalcNote
netIncomeScope
kicsScope
note
investmentFormula
sourceReferences
```

`sourceReferences`는 지표별 출처 묶음이다. 현재 구현은 `insuranceProfit`, `investmentProfit`, `netIncome`, `kics` 키를 사용하고, 각 값은 `rceptNo`, `reportName`, `dartUrl`, `valueKind`, `basis`, `unit`, `sourceLayer`, `manualAdjustment`, 필요 시 `account` 또는 `sourceAccounts`, `formula`, `sourceTables`를 포함한다.

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
manualAdjustment
```

`manualAdjustment`는 원본값을 덮어쓰지 않는 보정 객체다.

```text
applied
decision
originalValue
adjustedValue
reviewerNote
reviewedBy
reviewedAt
```

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
- analysisType: anomaly, movement, peer, briefing, chat
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
- LLM은 숫자를 새로 발명하지 않는다. 필요한 수치는 `tools/csm_agent_pipeline.py`가 만든 검증 산출물에서만 가져온다.
- 프롬프트에는 현재 회사, 현재 기간, audience, analysisType, reviewState만 명시한다.
- 응답은 JSON-first로 만들고 answer, evidence, calculation, followUps를 먼저 채운다.
- dataKind, validationStatus, reviewState, periodScope, snapshotHash를 항상 노출한다.
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

- 2025년 12월말까지 데이터가 있으면 전망 기준은 2025년 12월말이다.
- 2025년 1분기, 2분기처럼 이미 실적값이 있는 과거 분기의 전망은 노출하지 않는다.
- 최신 검증 기간이 바뀌면 전망 기준도 자동으로 바뀐다.
- 전망 CSM을 보여 줄 때는 Movement 전망도 함께 보여 준다.
- 대시보드에는 전망 시점을 명시한다.
- 사용자가 기간을 바꾸더라도 AI는 latest-validated-only 규칙을 따른다.

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
- AI는 현재 회사가 삼성생명 또는 삼성화재가 아닐 때 unsupported로 응답한다.

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
python tools/csm_agent_pipeline.py --write-dashboard
```

수작업 검토 결과를 반영하려면 선택적으로 아래 파일을 함께 사용한다.

```text
external-data/manual-review-overrides.json
```

2. 파이썬 검증

```bash
python -m unittest tests.test_csm_agent_pipeline_metadata -v
```

3. 대시보드 JavaScript 문법 확인

```bash
node --check csm-prototype/script.js
```

4. 로컬 화면 확인

```text
http://127.0.0.1:8765/csm-prototype/index.html?v=review-workbench#dashboard
```

5. 실패 시 우선 확인할 항목

- `qualityChecks`에서 `ok=false`인 항목
- `reviewItems`에서 `needs_review` 또는 `failed` 항목
- `sampleData`의 `sourceReference`
- `financialMetrics`의 `sourceReferences`
- `dashboard-data.generated.js`가 최신 산출물인지 여부

