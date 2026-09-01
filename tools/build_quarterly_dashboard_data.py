# -*- coding: utf-8 -*-
"""Normalize quarterly DART disclosures and merge them into the dashboard data.

DART interim income statement values and CSM movements are cumulative.  This
module keeps the disclosed cumulative values as audit evidence and derives
quarter-standalone flows by subtraction.  Balance sheet values remain point in
time.  Q4 is derived from the audited annual disclosure less Q3 cumulative.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import build_annual_dashboard_data as annual


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "external-data" / "dart-quarterly-insurance-extract.json"
ANNUAL = ROOT / "external-data" / "csm-annual-dashboard-data.json"
FISIS = ROOT / "external-data" / "fisis-quarterly-financials.json"
OUTPUT = ROOT / "external-data" / "csm-quarterly-dashboard-data.json"
DASHBOARD_JS = ROOT / "csm-prototype" / "dashboard-data.generated.js"
FLOW_KEYS = ("newbiz", "interest", "amortization")
DATA_REFRESH_DATE = "2026-09-01"
SHINHAN_2026_CSM_IR = {
    1: {
        "value": 7724.9,
        "source": "신한금융그룹 2026년 2분기 경영실적발표",
        "sourceUrl": "https://www.shinhangroup.com/kr/ir/finance/investorPresentations/detail/33171",
        "basis": "회사 IR · 원보험 기준",
        "note": "DART 저장값은 별도 발행 보험계약 기준이므로 exact-value 일치 판정에서 제외",
    },
    2: {
        "value": 7914.7,
        "source": "신한금융그룹 2026년 2분기 경영실적발표",
        "sourceUrl": "https://www.shinhangroup.com/kr/ir/finance/investorPresentations/detail/33171",
        "basis": "회사 IR · 원보험 기준",
        "note": "DART 저장값은 별도 발행 보험계약 기준이므로 exact-value 일치 판정에서 제외",
    },
}


def parsable_tables(period: dict) -> list[tuple[dict, dict]]:
    parsed = []
    for table in annual.preferred_document(period.get("document_candidates", [])):
        try:
            parsed.append((table, annual.extract_table_movement(table)))
        except (ValueError, IndexError):
            continue
    return parsed


def table_groups(parsed: list[tuple[dict, dict]]) -> list[list[tuple[dict, dict]]]:
    """Split candidates into nearby table blocks within each source document."""
    groups: list[list[tuple[dict, dict]]] = []
    for item in parsed:
        table = item[0]
        if (
            not groups
            or groups[-1][-1][0]["document"] != table["document"]
            or table["table_index"] - groups[-1][-1][0]["table_index"] > 4
        ):
            groups.append([item])
        else:
            groups[-1].append(item)
    return groups


def select_cumulative_movement(period: dict, anchor: float) -> tuple[dict, list[int], dict]:
    """Choose the separate, issued-contract CSM table set using prior YE CSM.

    Insurers disclose one to three issued-contract tables, often followed by an
    adjacent comparative set.  The current-period table set is the one whose
    opening CSM reconciles to the already validated prior year-end balance.
    """
    parsed = parsable_tables(period)
    if not parsed:
        raise ValueError("no parsable CSM movement table")

    contiguous_candidates = []
    alternate_candidates = []

    def build_candidate(subset: list[tuple[dict, dict]]) -> tuple[float, dict, list[dict]]:
        tables = [item[0] for item in subset]
        movement = subset[0][1] if len(subset) == 1 else annual.combined_movement(tables)
        relative_error = abs(movement["opening"] - anchor) / max(abs(anchor), 1)
        # Prefer fewer tables only after balance reconciliation.
        score = relative_error + (len(subset) - 1) * 0.000001
        return score, movement, tables

    for group in table_groups(parsed):
        # A company can split CSM by measurement model.  Some filings print
        # current/comparative tables in alternating pairs, so the current
        # issued-contract set is not necessarily contiguous (for example,
        # Shinhan Life 2026 H1 uses tables 208, 210 and 212).  Enumerate short
        # ordered combinations and let the audited prior year-end opening
        # balance select the correct current-period set.
        max_size = min(4, len(group))
        for size in range(1, max_size + 1):
            for start in range(0, len(group) - size + 1):
                contiguous_candidates.append(build_candidate(group[start : start + size]))
            for indexes in combinations(range(len(group)), size):
                if indexes == tuple(range(indexes[0], indexes[0] + size)):
                    continue
                alternate_candidates.append(build_candidate([group[index] for index in indexes]))

    score, movement, tables = min(contiguous_candidates, key=lambda item: item[0])
    # Preserve the existing contiguous-table rule unless it leaves a material
    # opening bridge.  Switch to an alternating current/comparative layout only
    # when that alternative reconciles within KRW 20bn.  This avoids silently
    # rewriting older transition-basis periods merely because an arbitrary
    # non-contiguous subset happens to be somewhat closer.
    if abs(movement["opening"] - anchor) > 20:
        reconciled_alternates = [
            candidate
            for candidate in alternate_candidates
            if abs(candidate[1]["opening"] - anchor) <= 20
        ]
        if reconciled_alternates:
            score, movement, tables = min(reconciled_alternates, key=lambda item: item[0])
    # 2023 interim disclosures can use an IFRS 17 transition/restatement basis
    # different from the comparative amount later printed in the annual note.
    # Preserve that bridge in the audit payload; reject only differences large
    # enough to indicate that a different table/basis was selected.
    tolerance = max(20, abs(anchor) * 0.20)
    if abs(movement["opening"] - anchor) > tolerance:
        raise ValueError(
            f"opening CSM does not reconcile: disclosed={movement['opening']}, anchor={anchor}, score={score:.4f}"
        )
    audit = {
        "openingAnchor": anchor,
        "disclosedOpening": movement["opening"],
        "openingDifference": movement["opening"] - anchor,
        "sourceDocument": tables[0]["document"],
    }
    return movement, [table["table_index"] for table in tables], audit


def standalone_movement(cumulative: dict, previous_cumulative: dict | None, opening: float) -> dict:
    flows = {
        key: cumulative[key] - (previous_cumulative[key] if previous_cumulative else 0)
        for key in FLOW_KEYS
    }
    closing = cumulative["closing"]
    adjustment = closing - opening - sum(flows.values())
    return {
        "opening": round(opening),
        **{key: round(value) for key, value in flows.items()},
        "adjustment": round(adjustment),
        "closing": round(closing),
    }


def standalone_metric(current: float | None, previous: float | None) -> float | None:
    if current is None:
        return None
    return round(current - (previous or 0), 3)


def metric(period: dict, key: str) -> float | None:
    item = period.get("financial_metrics", {}).get(key)
    return item.get("amount_bn") if item else None


def metric_item(period: dict, key: str) -> dict:
    return period.get("financial_metrics", {}).get(key) or {}


def disclosed_standalone_metric(period: dict, key: str) -> float | None:
    return metric_item(period, key).get("disclosed_standalone_amount_bn")


def standalone_validation(derived: float | None, disclosed: float | None) -> tuple[float | None, str]:
    if derived is None or disclosed is None:
        return None, "not_available"
    difference = round(derived - disclosed, 3)
    return difference, "matched" if abs(difference) <= 0.001 else "mismatch"


def quarterly_source(period: dict, table_indexes: list[int], audit: dict, basis: str) -> dict:
    report = period["report"]
    return {
        "sourceType": "Open DART",
        "rceptNo": report["rcept_no"],
        "reportName": report["report_name"],
        "dartUrl": report["dart_url"],
        "valueKind": "actual",
        "basis": "separate_financial_statement_excluding_reinsurance",
        "unit": "KRW billion",
        "sourceTables": table_indexes,
        "sourcePeriodBasis": basis,
        "displayPeriodBasis": "quarter-standalone",
        "movementSelectionAudit": audit,
    }


def movement_identity(movement: dict) -> float:
    return round(
        movement["opening"]
        + movement["newbiz"]
        + movement["interest"]
        + movement["adjustment"]
        + movement["amortization"]
        - movement["closing"],
        6,
    )


def period_payload(
    *,
    movement: dict,
    insurance_profit: float | None,
    parent_net_income: float | None,
    kics: float | None,
    source_reference: dict,
    cumulative: dict,
    quarter: int,
    opening_difference: float,
    financial_audit: dict,
    net_income_basis: str,
    csm_validation: dict | None = None,
) -> dict:
    fisis_available = any(
        value is not None
        for key, value in financial_audit.items()
        if key.startswith("fisis")
    )
    correction_prefix = "정정 " if "기재정정" in source_reference.get("reportName", "") else ""
    disclosure_label = correction_prefix + ("반기" if quarter == 2 else "분기")
    validation_label = "FISIS 교차검증" if fisis_available else "FISIS 미게시"
    financial_audit = {
        **financial_audit,
        "fisisStatus": "available" if fisis_available else "not_published",
        "fisisCheckedAt": DATA_REFRESH_DATE,
        "fallbackValidation": (
            "Open DART 원문 Movement 항등식·기초 잔액 연속성 검산"
            if not fisis_available
            else None
        ),
    }
    return {
        "csm": movement["closing"],
        "growth": round((movement["closing"] / movement["opening"] - 1) * 100, 1)
        if movement["opening"]
        else None,
        "movement": movement,
        "insuranceProfit": insurance_profit,
        "parentNetIncome": parent_net_income,
        "kics": kics,
        "solvencyBasis": "K-ICS",
        "quality": f"DART {disclosure_label} 공시 · {validation_label} · 누적값 분기 단독 환산",
        "sourceReference": source_reference,
        "metricBasis": {
            "csm": "별도 · 발행 보험계약 · 출재 재보험 제외",
            "insuranceProfit": "별도 · K-IFRS · 분기 단독",
            "parentNetIncome": net_income_basis,
            "solvency": "K-ICS · 분기말",
        },
        "quarterlyAudit": {
            "quarter": quarter,
            "movementIdentityDifference": movement_identity(movement),
            "openingReconciliationDifference": opening_difference,
            "disclosedCumulativeMovement": cumulative,
            "financialValidation": financial_audit,
            "csmValidation": csm_validation,
        },
    }


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    output = json.loads(ANNUAL.read_text(encoding="utf-8"))
    fisis = json.loads(FISIS.read_text(encoding="utf-8"))
    output["dataContractVersion"] = "csm-dashboard-quarterly/v1"
    output["periodBasis"] = "quarterly-point-in-time-with-standalone-flows"
    output["methodologyRegistry"] = {
        "version": "2026-09-01.6",
        "recordPolicy": (
            "모든 데이터 변경 시 원본 출처, 파싱 규칙, 단위·기간 환산, "
            "검증 소스, 판정 결과, 예외 처리를 함께 기록한다."
        ),
        "records": [
            {
                "effectiveDate": "2026-09-01",
                "scope": "한화생명 2026년 2분기 K-ICS 확정값",
                "source": (
                    "Open DART [기재정정]반기보고서 (2026.06), 접수번호 20260831001232, "
                    "사업의 내용 > 재무건전성 지급여력비율 표 #10"
                ),
                "parsing": (
                    "지급여력비율 행의 첫 번째 기간열인 2026.06만 선택. 정정 전 '산출중' 행에서 "
                    "이전 연도 157.5%를 현재 값으로 오인하지 않도록, 첫 기간열이 숫자가 아니면 해당 행을 건너뛴다."
                ),
                "conversion": (
                    "지급여력 25,215,416백만원 ÷ 지급여력기준 15,011,165백만원 × 100을 "
                    "원문 표시 정밀도에 따라 168.0%로 저장. 경과조치 적용 전 184.7%는 감사 주석으로 구분한다."
                ),
                "validation": (
                    "정정공시 표의 A/B 재계산값 167.98%와 표시값 168.0%를 대사. 회사 FY2026 2분기 IR의 "
                    "167%(e)는 확정 전 예상치로 분류하고, FISIS SH021/D·A 2026-06 미게시 상태를 재확인했다."
                ),
                "result": (
                    "한화생명 2026 Q2 K-ICS를 null·산출중에서 168.0%·published로 변경하고 "
                    "원본 접수번호를 20260831001232로 교체. CSM과 보험손익·지배주주 순이익은 변동 없음."
                ),
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "당해연도 전망을 포함한 9개사 신계약 추세율·CSM 조정률",
                "source": "검증 완료 CSM Movement, 2024·2025년 롤링 백테스트, 회사별 증권사 애널리스트 리포트",
                "parsing": (
                    "신계약 추세율은 2024·2025년 실적과 2026년 Base 전망의 두 변화율을 35%·65%로 가중. "
                    "CSM 조정률은 같은 3개년을 20%·30%·50%로 가중하고 연간 순양(+) 조정, "
                    "분기성 환입·재분류의 총액 반복과 경영목표 연결분을 제외."
                ),
                "conversion": (
                    "당해연도 Base는 상반기 확정 실적과 Q3~Q4 전망의 연간 합계로 사용. "
                    "신계약 추세는 -5%~+5%로 제한하고 2026~2030년을 연도별로 연결."
                ),
                "validation": (
                    "9개사 전 연도 Movement 항등식, Base>Worst, 3개년 관측창·가중치, 일회성 제외액, "
                    "CSM 조정률 0% 이하와 성장률 상한을 자동검사."
                ),
                "result": (
                    "대시보드에 24·25년 실적과 26년 전망, 가중 추세율·최종 적용률 및 CSM 조정률을 표시. "
                    "9개사 전망 계약을 rolling-origin-current-year/v5로 갱신."
                ),
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "한화생명 분기 지배주주 순이익 및 9개사 2026 Q2 손익 재검증",
                "source": "Open DART 단일회사 전체계정 API의 연결 포괄손익계산서",
                "parsing": (
                    "지배기업 소유주 귀속 순이익은 한글 계정명보다 표준 계정 ID "
                    "ifrs-full_ProfitLossAttributableToOwnersOfParent를 우선 선택. 보험손익도 "
                    "ifrs-full_InsuranceServiceResult를 우선하고 명칭 매칭은 예외 대체로만 사용."
                ),
                "conversion": (
                    "보험손익·순이익은 DART가 직접 공시한 당 3개월 값을 분기 단독값으로 사용하고, "
                    "반기 누적값에서 Q1 누적값을 차감한 값과 0.001십억원 허용오차로 재대사."
                ),
                "validation": (
                    "9개사 보험손익·지배주주 순이익의 표준 계정 ID, 반기 누적, Q2 직접 공시값, "
                    "분기 단독 환산값을 함께 저장. FISIS 2026년 6월 미게시 상태도 별도 기록."
                ),
                "result": (
                    "한화생명 지배주주 순이익을 2026 Q1 381.582→324.395십억원, "
                    "Q2 522.943→447.554십억원으로 수정. 9개사 Q2 직접 공시 손익과 환산값 대사 완료."
                ),
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "DB손해보험 2025년말 보유 CSM 재파싱",
                "source": "Open DART 2025 사업보고서 별도 보험계약 주석 표 #281·#285",
                "parsing": (
                    "발행보험계약 CSM이 분리 공시된 소규모 계약군 표와 주계약군 표를 합산. "
                    "주계약군 단일 표 선택 규칙을 회사·연도 명시 규칙으로 교체."
                ),
                "conversion": "원문 백만원을 십억원으로 환산한 뒤 합산하고 표시단위에서 반올림.",
                "validation": (
                    "2025년말 기말 CSM을 2026 Q1·Q2 공시 기초와 대사하고 Movement 항등식 및 "
                    "회사 공식 결산자료의 12,205십억원과 교차검증."
                ),
                "result": "2025년말 보유 CSM 12,187→12,205십억원, 기시 12,206→12,232십억원으로 수정.",
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "신한라이프 2026년 1·2분기 보유 CSM 재파싱",
                "source": (
                    "Open DART 분기·반기보고서 별도재무제표 보험계약 주석, "
                    "신한금융그룹 2026년 2분기 공식 IR"
                ),
                "parsing": (
                    "신한라이프 XBRL은 상품군별 당기표와 비교표가 교대로 배치된다. "
                    "연속 표를 합산하지 않고, 직전 연말 별도 CSM과 기초가 20십억원 이내로 "
                    "대사되는 당기 표 조합만 선택한다."
                ),
                "conversion": (
                    "백만원 원문을 십억원으로 환산. Q1은 당기 누적값, Q2 단독 Movement는 "
                    "반기 누적값에서 수정된 Q1 누적값을 차감한다."
                ),
                "validation": (
                    "DART 별도 표의 기초 CSM을 2025년말과 대사하고 Movement 항등식과 Q1 기말·Q2 기시 "
                    "연속성을 검산. 공식 IR 원보험 기준 CSM 7,724.9·7,914.7십억원은 기준 차이를 "
                    "표시한 보조 검증값으로 보존한다."
                ),
                "result": (
                    "보유 CSM을 2026 Q1 7,610→7,722십억원, Q2 7,702→7,911십억원으로 수정. "
                    "기초 대사 차이는 -104→0십억원."
                ),
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "9개사 2026년 2분기 CSM·Movement·손익·K-ICS",
                "source": "Open DART 2026년 반기보고서, FISIS 2026년 6월 분기 통계 조회",
                "parsing": (
                    "CSM은 별도재무제표 발행 보험계약 표만 사용하고 출재 재보험을 제외. "
                    "반기 XBRL의 4열·6열 반복 블록에서는 CSM 열만 합산하고 기초 잔액이 "
                    "2025년말 공시값과 연결되는 당반기 표를 선택."
                ),
                "conversion": (
                    "반기 누적 Movement에서 2026년 1분기 누적값을 차감해 2분기 단독값으로 환산. "
                    "보험손익·순이익은 DART 당 3개월 공시값을 사용하고 누적 차감값으로 재대사하며, "
                    "CSM·K-ICS는 2026년 6월말 시점값을 사용."
                ),
                "validation": (
                    "기말 = 기시 + 신계약 + 이자 + 조정 + 상각, 1분기 기말과 2분기 기시 연속성, "
                    "DART 누적값 재합산을 검산. FISIS 2026년 6월 값은 조회 시점 미게시여서 "
                    "미확인으로 기록하고 회사 공식 IR은 보조검증 수단으로만 사용."
                ),
                "result": (
                    "9개사 반기보고서 접수 및 2026 Q2 정규화 완료. 한화생명 K-ICS는 "
                    "원문이 '산출중'이므로 null 유지."
                ),
            },
            {
                "effectiveDate": "2026-08-21",
                "scope": "9개사 관리기준 예실차",
                "source": "각 보험사 공식 홈페이지의 연말 결산 별도 SAP 손익계산서·Factsheet·경영공시",
                "parsing": (
                    "예상보험금, 발생보험금, 발생사고요소조정과 예상·발생 손해조사비·계약유지비·"
                    "투자관리비를 추출. 세부 행이 없으면 회사가 기술한 공식 결과금액만 저장."
                ),
                "conversion": (
                    "원·천원·백만원·억원을 억원으로 통일하고 부호를 정규화. 연말만 저장하며 "
                    "선택기간 1~3분기는 직전 연말, 4분기·연말은 해당 연말을 당기로 표시."
                ),
                "validation": (
                    "보험금·사업비·종합 항등식과 세 비율을 재계산. 동일 SAP 분모가 없으면 null로 유지하고 "
                    "Open DART·FISIS·공시기준 값·ref_data로 대체하지 않음."
                ),
                "result": "2024·2025년말 9개사 원본 위치·검증등급·결측 사유와 전기·당기 표시 규칙 확정",
            },
            {
                "effectiveDate": "2026-08-04",
                "scope": "9개사 분기 CSM·손익·K-ICS",
                "source": "Open DART 분기·반기·사업보고서, FISIS 분기 통계",
                "parsing": (
                    "CSM은 별도재무제표 발행 보험계약 표에서 추출하고 출재 재보험을 제외. "
                    "상품군·측정모형별 표는 합산하며 직전 연말 CSM과 기초 잔액을 대사해 표를 선택."
                ),
                "conversion": (
                    "CSM 잔액은 분기말 시점값. Q2·Q3 손익 및 Movement는 누적값에서 직전 누적을 차감, "
                    "Q4는 연간 누적에서 Q3 누적을 차감해 분기 단독값으로 환산."
                ),
                "validation": (
                    "기말 = 기시 + 신계약 + 이자 + 조정 + 상각, 분기 기시·기말 연속성, "
                    "연간 합계 대사. 보험손익·순이익은 FISIS SH154/SI150과 교차검증."
                ),
                "result": "9개사 126개 회사-분기 값 및 Movement 산식 검산 대상 확장",
            },
            {
                "effectiveDate": "2026-08-03",
                "scope": "보험금 예실차·경과기간별 손해율·유지비율",
                "source": "Open DART 연결재무제표 주석",
                "parsing": "Open DART 원문 표의 합계행을 직접 추출하고, 합계가 없으면 동일 기준의 세부 포트폴리오 행을 합산.",
                "conversion": "2024년말부터 연 1회 공시. 원문 금액·비율을 보존하고 대시보드 비율을 별도 계산.",
                "validation": "예실차 및 기간별 비율 산식을 재계산하고 회사·연도·경과기간 구간을 대조.",
                "result": "04~06 탭의 원본 링크·전체표·계산 비율 연결",
            },
            {
                "effectiveDate": "2026-07-31",
                "scope": "9개사 연도말 CSM·Movement",
                "source": "Open DART 사업보고서 별도재무제표 주석",
                "parsing": "발행 보험계약 CSM만 사용하고 출재 재보험 제외. 분리된 상품군·측정모형 표는 합산.",
                "conversion": "원문 원·천원·백만원을 십억원으로 통일하고 연도말 잔액과 연간 누적 흐름을 저장.",
                "validation": "FISIS를 우선 활용하고 CSM 부재 시 회사 IR·경영공시로 교차검증. 산식과 표시단위 반올림을 별도 판정.",
                "result": "2022~2025년 연도말 9개사 데이터 기준 확정",
            },
        ],
    }

    errors = []
    for company_key, company in output["sampleData"].items():
        quarterly_company = source["companies"][company_key]
        fisis_company = fisis["companies"][company_key]
        for year in (2023, 2024, 2025, 2026):
            annual_anchor = company["periods"].get(f"{year - 1}-ye")
            if not annual_anchor:
                continue
            previous_cumulative = None
            previous_financial = {"insurance_profit": None, "parent_net_income": None}
            filed_interims = [
                quarterly_company["periods"].get(f"{year}-q{quarter}", {})
                for quarter in (1, 2, 3)
            ]
            use_fisis_net_year = any(
                period.get("availability") == "filed"
                and metric(period, "parent_net_income") is None
                for period in filed_interims
            )
            opening = annual_anchor["csm"]
            completed_q3 = True
            for quarter in (1, 2, 3):
                period_key = f"{year}-q{quarter}"
                raw_period = quarterly_company["periods"].get(period_key)
                if not raw_period or raw_period.get("availability") != "filed":
                    completed_q3 = False
                    continue
                try:
                    cumulative, table_indexes, audit = select_cumulative_movement(raw_period, annual_anchor["csm"])
                except ValueError as exc:
                    errors.append({"company": company_key, "period": period_key, "error": str(exc)})
                    completed_q3 = False
                    continue

                movement_opening = cumulative["opening"] if quarter == 1 else opening
                movement = standalone_movement(cumulative, previous_cumulative, movement_opening)
                current_financial = {
                    "insurance_profit": metric(raw_period, "insurance_profit"),
                    "parent_net_income": metric(raw_period, "parent_net_income"),
                }
                fisis_period = fisis_company["periods"].get(period_key, {})
                fisis_insurance = fisis_period.get("insuranceProfit", {})
                fisis_net = fisis_period.get("netIncome", {})
                if current_financial["insurance_profit"] is None:
                    current_financial["insurance_profit"] = fisis_insurance.get("cumulative")
                if use_fisis_net_year:
                    current_financial["parent_net_income"] = fisis_net.get("cumulative")
                kics, _ = annual.kics_ratio(raw_period, year)
                source_reference = quarterly_source(
                    raw_period, table_indexes, audit, "year-to-date-cumulative"
                )
                insurance_derived = standalone_metric(
                    current_financial["insurance_profit"], previous_financial["insurance_profit"]
                )
                parent_derived = (
                    fisis_net.get("standalone")
                    if use_fisis_net_year
                    else standalone_metric(
                        current_financial["parent_net_income"],
                        previous_financial["parent_net_income"],
                    )
                )
                disclosed_insurance = disclosed_standalone_metric(raw_period, "insurance_profit")
                disclosed_parent = disclosed_standalone_metric(raw_period, "parent_net_income")
                # Use DART's directly disclosed three-month value when present.
                # The cumulative subtraction remains in the audit record as an
                # independent reconciliation and can differ by KRW 1mn because
                # each XBRL fact is rounded separately.
                insurance_standalone = (
                    disclosed_insurance if disclosed_insurance is not None else insurance_derived
                )
                parent_standalone = disclosed_parent if disclosed_parent is not None else parent_derived
                insurance_difference, insurance_status = standalone_validation(
                    insurance_derived, disclosed_insurance
                )
                parent_difference, parent_status = standalone_validation(
                    parent_derived, disclosed_parent
                )
                company["periods"][period_key] = period_payload(
                    movement=movement,
                    insurance_profit=insurance_standalone,
                    parent_net_income=parent_standalone,
                    kics=kics,
                    source_reference=source_reference,
                    cumulative=cumulative,
                    quarter=quarter,
                    opening_difference=audit["openingDifference"],
                    financial_audit={
                        "dartInsuranceProfitCumulative": metric(raw_period, "insurance_profit"),
                        "insuranceProfitAccountId": metric_item(raw_period, "insurance_profit").get("account_id"),
                        "dartInsuranceProfitStandaloneDerived": insurance_derived,
                        "dartInsuranceProfitStandaloneDisclosed": disclosed_insurance,
                        "insuranceProfitStandaloneDifference": insurance_difference,
                        "insuranceProfitStandaloneStatus": insurance_status,
                        "fisisInsuranceProfitCumulative": fisis_insurance.get("cumulative"),
                        "fisisInsuranceProfitStandalone": fisis_insurance.get("standalone"),
                        "dartParentNetIncomeCumulative": metric(raw_period, "parent_net_income"),
                        "parentNetIncomeAccountId": metric_item(raw_period, "parent_net_income").get("account_id"),
                        "dartParentNetIncomeStandaloneDerived": parent_derived,
                        "dartParentNetIncomeStandaloneDisclosed": disclosed_parent,
                        "parentNetIncomeStandaloneDifference": parent_difference,
                        "parentNetIncomeStandaloneStatus": parent_status,
                        "fisisSeparateNetIncomeCumulative": fisis_net.get("cumulative"),
                        "fisisSeparateNetIncomeStandalone": fisis_net.get("standalone"),
                        "solvencyStatus": "published" if kics is not None else "pending_in_source",
                        "solvencyReason": (
                            None
                            if kics is not None
                            else "Open DART 원문이 해당 분기 K-ICS를 산출 중으로 표시"
                        ),
                    },
                    net_income_basis=(
                        "별도 · FISIS · 분기 단독 (DART 초기 공백 대체)"
                        if use_fisis_net_year
                        else "연결 · 지배기업 소유주 귀속 · 분기 단독"
                    ),
                    csm_validation=(
                        SHINHAN_2026_CSM_IR.get(quarter)
                        if company_key == "shinhan-life" and year == 2026
                        else None
                    ),
                )
                previous_cumulative = cumulative
                previous_financial = current_financial
                opening = cumulative["closing"]

            # Q4 standalone is annual cumulative less Q3 cumulative. Keep the
            # existing -ye record as the audited full-year view used by tabs 04-06.
            annual_period = company["periods"].get(f"{year}-ye")
            if year <= 2025 and completed_q3 and previous_cumulative and annual_period:
                annual_movement = annual_period["movement"]
                q4_movement = standalone_movement(annual_movement, previous_cumulative, opening)
                annual_source = dict(annual_period["sourceReference"])
                annual_source.update(
                    {
                        "sourcePeriodBasis": "full-year-cumulative",
                        "displayPeriodBasis": "quarter-standalone",
                    }
                )
                fisis_q4 = fisis_company["periods"].get(f"{year}-q4", {})
                company["periods"][f"{year}-q4"] = period_payload(
                    movement=q4_movement,
                    insurance_profit=standalone_metric(
                        annual_period["insuranceProfit"], previous_financial["insurance_profit"]
                    ),
                    parent_net_income=(
                        fisis_q4.get("netIncome", {}).get("standalone")
                        if use_fisis_net_year
                        else standalone_metric(
                            annual_period["parentNetIncome"], previous_financial["parent_net_income"]
                        )
                    ),
                    kics=annual_period["kics"],
                    source_reference=annual_source,
                    cumulative=annual_movement,
                    quarter=4,
                    opening_difference=annual_movement["opening"] - annual_anchor["csm"],
                    financial_audit={
                        "dartInsuranceProfitCumulative": annual_period["insuranceProfit"],
                        "fisisInsuranceProfitCumulative": fisis_q4.get("insuranceProfit", {}).get("cumulative"),
                        "fisisInsuranceProfitStandalone": fisis_q4.get("insuranceProfit", {}).get("standalone"),
                        "dartParentNetIncomeCumulative": annual_period["parentNetIncome"],
                        "fisisSeparateNetIncomeCumulative": fisis_q4.get("netIncome", {}).get("cumulative"),
                        "fisisSeparateNetIncomeStandalone": fisis_q4.get("netIncome", {}).get("standalone"),
                        "solvencyStatus": "published",
                        "solvencyReason": None,
                    },
                    net_income_basis=(
                        "별도 · FISIS · 분기 단독 (DART 초기 공백 대체)"
                        if use_fisis_net_year
                        else "연결 · 지배기업 소유주 귀속 · 분기 단독"
                    ),
                )

    output["quarterlyBuild"] = {
        "sourceContract": source.get("contract"),
        "validationContract": fisis.get("contract"),
        "latestAvailable": "2026-q2",
        "errors": errors,
    }
    return output


def main() -> int:
    output = build()
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    DASHBOARD_JS.write_text(
        "/* Generated by tools/build_quarterly_dashboard_data.py. */\n"
        f"window.CSM_AGENT_DATA = {json.dumps(output, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print(OUTPUT)
    errors = output["quarterlyBuild"]["errors"]
    if errors:
        print(json.dumps(errors, ensure_ascii=False, indent=2))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
