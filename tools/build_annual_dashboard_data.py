# -*- coding: utf-8 -*-
"""Normalize annual DART disclosures into the dashboard's year-end data contract."""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "external-data" / "dart-annual-insurance-extract.json"
OUTPUT = ROOT / "external-data" / "csm-annual-dashboard-data.json"
DASHBOARD_JS = ROOT / "csm-prototype" / "dashboard-data.generated.js"
LIFE_VALIDATION = ROOT / "external-data" / "life-company-validation.json"
MERITZ_VALIDATION = ROOT / "external-data" / "meritz-fire-validation.json"

LIFE_META = {
    "samsung-life": ("삼성생명", "생명보험", "신계약 확보형"),
    "hanwha-life": ("한화생명", "생명보험", "대형 생보"),
    "kyobo-life": ("교보생명", "생명보험", "전속채널 중심"),
    "shinhan-life": ("신한라이프", "생명보험", "금융지주 계열"),
    "samsung-fire": ("삼성화재", "손해보험", "대형 손보"),
    "meritz-fire": ("메리츠화재", "손해보험", "장기보험 중심"),
    "db-insurance": ("DB손해보험", "손해보험", "대형 손보"),
    "hyundai-marine": ("현대해상", "손해보험", "대형 손보"),
    "kb-insurance": ("KB손해보험", "손해보험", "금융지주 계열"),
}

OPENING_LABELS = (
    "보험계약순부채(자산)(기초)",
    "기초보험계약마진",
    "기초순장부금액",
    "기초순보험계약부채",
    "기초보험계약순부채",
    "기초보험계약부채",
    "전기말보험계약마진",
)
CLOSING_LABELS = (
    "보험계약순부채(자산)(기말)",
    "기말보험계약마진",
    "기말순장부금액",
    "당기말순보험계약부채",
    "기말보험계약순부채",
    "기말순보험계약부채",
    "기말보험계약부채",
    "당기말보험계약마진",
)
NEWBIZ_LABELS = (
    "최초인식한계약의효과",
    "당기신계약의최초인식효과",
    "당기최초인식계약",
    "최초인식계약",
    "신계약인식효과",
    "신계약효과",
    "해당기간에처음인식한계약의효과",
    "해당기간에처음인식한계약의영향에따른증가분(감소분),보험계약마진",
    "해당기간에처음인식한계약의영향에따른증가분(감소분)",
    "해당기간에처음인식한계약효과를통한증가(감소)",
)
AMORTIZATION_LABELS = (
    "제공한서비스에대해인식한보험계약마진",
    "제공된서비스관련당기손익인식",
    "서비스이전을반영하기위해당기손익으로인식한보험계약마진",
    "당기손익으로인식한보험계약마진금액",
    "보험계약마진상각",
    "서비스의이전을반영하기위해당기손익으로인식한보험계약마진금액",
    "서비스이전을반영하기위해당기손익으로인식한보험계약마진금액에따른증가분(감소분)",
    "서비스이전을반영하기위해당기손익으로인식한보험계약마진금액을통한증가(감소)",
)
INTEREST_LABELS = (
    "보험계약의순금융손익",
    "순보험금융손익",
    "보험금융비용",
    "보험금융손익",
    "이자비용",
    "보험금융손익",
    "보험금융수익(비용)에따른증가분(감소분),보험계약마진",
    "보험금융수익(비용)에따른증가분(감소분)",
    "보험금융수익(비용)에따른총증가분(감소분)",
)


def compact(value: object) -> str:
    return "".join(str(value or "").split())


def number(value: object) -> Decimal | None:
    raw = str(value or "").strip()
    if raw in {"", "-", "–", "—"}:
        return Decimal("0")
    negative = raw.startswith("(") and raw.endswith(")")
    cleaned = raw.strip("()").replace(",", "").replace("%", "")
    try:
        result = Decimal(cleaned)
    except InvalidOperation:
        return None
    return -result if negative else result


def row_numbers(row: list[str]) -> list[Decimal]:
    return [parsed for cell in row for parsed in [number(cell)] if parsed is not None]


def find_row(rows: list[list[str]], labels: tuple[str, ...]) -> list[str]:
    for label in labels:
        for index, row in enumerate(rows):
            text = compact("".join(row))
            if label in text:
                if row_numbers(row):
                    return row
                for child in rows[index + 1 : index + 4]:
                    if row_numbers(child):
                        return child
    raise ValueError(f"row not found: {labels}")


def csm_amount(
    row: list[str], *, simple_total: bool, has_csm_subtotal: bool,
    issued_reinsurance_pair: bool = False,
) -> Decimal:
    values = row_numbers(row)
    if not values:
        raise ValueError(f"no numeric cells: {row}")
    if issued_reinsurance_pair and len(values) >= 2:
        return values[0]
    if simple_total:
        return values[-1]
    # Some disclosures place three CSM transition-method columns plus a total
    # after FCF and RA, and repeat that six-column block by product.  Summing
    # the generic middle range would incorrectly include FCF/RA and subtotals.
    if len(values) >= 12 and len(values) % 6 == 0:
        return sum(
            (sum(values[offset + 2 : offset + 5], Decimal("0"))
             for offset in range(0, len(values), 6)),
            Decimal("0"),
        )
    # Some non-life disclosures repeat a four-column block by dividend or
    # product group: FCF, RA, CSM, subtotal.  Only the third value in each
    # block is CSM; the subtotal and the next block's FCF/RA must be excluded.
    if len(values) >= 8 and len(values) % 4 == 0:
        return sum(
            (values[offset + 2] for offset in range(0, len(values), 4)),
            Decimal("0"),
        )
    if has_csm_subtotal and len(values) >= 3:
        return values[-2]
    if len(values) < 4:
        return values[-2] if len(values) >= 2 else values[-1]
    return sum(values[2:-1], Decimal("0"))


def unit_divisor(table: dict) -> Decimal:
    text = compact(table.get("context", "")) + compact("".join("".join(row) for row in table["rows"][:3]))
    if "단위:원" in text:
        return Decimal("1000000000")
    return Decimal("1000000") if "단위:천원" in text else Decimal("1000")


def extract_raw_table_movement(table: dict) -> dict[str, Decimal]:
    rows = table["rows"]
    header = compact("".join(rows[0])) if rows else ""
    header_block = compact("".join("".join(row) for row in rows[:4]))
    simple_total = "합계" in header and "미래현금흐름" not in header
    has_csm_subtotal = "소계" in header_block
    issued_reinsurance_pair = (
        "발행한보험계약" in header_block and "보유재보험계약" in header_block
    )
    divisor = unit_divisor(table)

    def amount(labels: tuple[str, ...]) -> Decimal:
        return csm_amount(
            find_row(rows, labels),
            simple_total=simple_total,
            has_csm_subtotal=has_csm_subtotal,
            issued_reinsurance_pair=issued_reinsurance_pair,
        )

    return {
        "opening": amount(OPENING_LABELS),
        "newbiz": amount(NEWBIZ_LABELS),
        "interest": amount(INTEREST_LABELS),
        "amortization": amount(AMORTIZATION_LABELS),
        "closing": amount(CLOSING_LABELS),
        "_divisor": divisor,
    }


def rounded_movement(raw: dict[str, Decimal]) -> dict[str, int]:
    divisor = raw["_divisor"]
    values = {
        key: int((value / divisor).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        for key, value in raw.items()
        if key != "_divisor"
    }
    values["adjustment"] = (
        values["closing"]
        - values["opening"]
        - values["newbiz"]
        - values["interest"]
        - values["amortization"]
    )
    return values


def extract_table_movement(table: dict) -> dict[str, int]:
    return rounded_movement(extract_raw_table_movement(table))


def movement_candidate(table: dict) -> bool:
    text = compact("".join("".join(row) for row in table["rows"]))
    if "보험계약마진" not in text:
        return False
    groups = (
        any(label in text for label in OPENING_LABELS),
        any(label in text for label in CLOSING_LABELS),
        any(label in text for label in NEWBIZ_LABELS),
        any(label in text for label in AMORTIZATION_LABELS),
    )
    return all(groups)


def preferred_document(tables: list[dict]) -> list[dict]:
    eligible = [table for table in tables if movement_candidate(table)]
    for suffix in ("_00761.xml", "_00760.xml", ".xml"):
        selected = [table for table in eligible if table["document"].endswith(suffix)]
        if selected:
            return sorted(selected, key=lambda table: table["table_index"])
    return sorted(eligible, key=lambda table: table["table_index"])


def general_current_and_prior(
    tables: list[dict], company_key: str, year: int
) -> tuple[dict, dict | None]:
    candidates = preferred_document(tables)
    parsed = []
    for table in candidates:
        try:
            parsed.append((table, extract_table_movement(table)))
        except ValueError:
            continue
    if not parsed:
        raise ValueError("no parsable movement table")

    if company_key == "db-insurance":
        current_candidates = [
            (table, movement)
            for table, movement in parsed
            if "<당기>" in table.get("context", "")
        ]
        current, _ = max(current_candidates, key=lambda item: item[1]["closing"])
        current_index = next(index for index, item in enumerate(parsed) if item[0] is current)
        prior = parsed[current_index + 1][0] if current_index + 1 < len(parsed) else None
        return current, prior
    if company_key == "samsung-fire" and year == 2025:
        current, _ = max(parsed, key=lambda item: item[1]["closing"])
        current_index = next(index for index, item in enumerate(parsed) if item[0] is current)
        prior = parsed[current_index + 2][0] if current_index + 2 < len(parsed) else None
        return current, prior
    pairs = []
    index = 0
    while index < len(parsed):
        current, movement = parsed[index]
        prior = None
        if (
            index + 1 < len(parsed)
            and 0 < parsed[index + 1][0]["table_index"] - current["table_index"] <= 2
        ):
            prior = parsed[index + 1][0]
            index += 2
        else:
            index += 1
        pairs.append((current, movement, prior))
    current, _, prior = max(pairs, key=lambda item: item[1]["closing"])
    return current, prior


MULTI_TABLE_OVERRIDES = {
    ("samsung-fire", 2025): [479, 481],
    ("hyundai-marine", 2025): [397, 401],
    # DB손해보험 2025년 발행보험계약 CSM은 같은 별도 주석 안의
    # 소규모 계약군 표(281)와 주계약군 표(285)로 분리된다. 주계약군만
    # 선택하면 기말이 12,187십억원으로 과소계상되고 2026 Q1 공시 기초
    # 12,205십억원과 연결되지 않는다.
    ("db-insurance", 2025): [281, 285],
}

# 생명보험사는 연결 주석(_00761)과 별도 주석(_00760)에 같은 형태의
# CSM 차이조정표가 함께 존재한다. 대시보드 공통 기준인
# '별도·발행 보험계약·출재 재보험 제외' 표를 명시적으로 선택한다.
LIFE_SEPARATE_TABLES = {
    "samsung-life": {
        2022: (2023, [193, 195, 197]),
        2023: (2023, [187, 189, 191]),
        2024: (2024, [183, 185, 187]),
        2025: (2025, [204, 206, 208]),
    },
    "hanwha-life": {
        2022: (2023, [122]),
        2023: (2023, [121]),
        2024: (2024, [134]),
        2025: (2025, [132]),
    },
    "kyobo-life": {
        2022: (2023, [114]),
        2023: (2023, [113]),
        2024: (2024, [112]),
        2025: (2025, [116, 117, 118]),
    },
    "shinhan-life": {
        2022: (2023, [209]),
        2023: (2023, [208]),
        2024: (2024, [231]),
        2025: (2025, [257, 259, 261]),
    },
}

# 메리츠화재 2025년 주석은 장기·일반 보험계약 CSM 표가 분리되어 있다.
# 부채 중심 표(328)만 읽으면 기시·기말 CSM이 각각 약 470억·490억원
# 과소계상되므로, 회사 IR 기준과 동일하게 두 발행보험계약 표를 합산한다.
MERITZ_SEPARATE_TABLES = {
    2022: (2023, "_00760.xml", [255]),
    2023: (2023, "_00760.xml", [253]),
    2024: (2024, "_00760.xml", [245]),
    2025: (2025, "20260331003916.xml", [324, 328]),
}


def separate_life_movement(
    company_key: str, company: dict, year: int
) -> tuple[dict[str, int], list[int], dict]:
    report_year, table_indexes = LIFE_SEPARATE_TABLES[company_key][year]
    source = company["years"][str(report_year)]
    tables = [
        table
        for table in source["document_candidates"]
        if table["document"].endswith("_00760.xml")
        and table["table_index"] in table_indexes
    ]
    if len(tables) != len(table_indexes):
        raise ValueError(f"{company_key}: separate tables missing for {year}: {table_indexes}")
    movement = (
        extract_table_movement(tables[0])
        if len(tables) == 1
        else combined_movement(tables)
    )
    return movement, table_indexes, source["report"]


def meritz_fire_movement(
    company: dict, year: int
) -> tuple[dict[str, int], list[int], dict]:
    report_year, document_suffix, table_indexes = MERITZ_SEPARATE_TABLES[year]
    source = company["years"][str(report_year)]
    tables = [
        table
        for table in source["document_candidates"]
        if table["document"].endswith(document_suffix)
        and table["table_index"] in table_indexes
    ]
    if len(tables) != len(table_indexes):
        raise ValueError(f"meritz-fire: tables missing for {year}: {table_indexes}")
    movement = (
        extract_table_movement(tables[0])
        if len(tables) == 1
        else combined_movement(tables)
    )
    return movement, table_indexes, source["report"]


def combined_movement(tables: list[dict]) -> dict[str, int]:
    parts = [extract_raw_table_movement(table) for table in tables]
    movement = {
        key: int(
            sum(
                (part[key] / part["_divisor"] for part in parts),
                Decimal("0"),
            ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        for key in ("opening", "newbiz", "interest", "amortization", "closing")
    }
    movement["adjustment"] = (
        movement["closing"]
        - movement["opening"]
        - movement["newbiz"]
        - movement["interest"]
        - movement["amortization"]
    )
    return movement


def kics_ratio(year_data: dict, year: int) -> tuple[float | None, str]:
    rows = []
    for table in year_data["document_candidates"]:
        if not table["document"].endswith(".xml") or "_" in Path(table["document"]).stem:
            continue
        if table["table_index"] > 250:
            continue
        for row in table["rows"]:
            label = compact(row[0] if row else "")
            if ("지급여력비율(A/B)" in label or "위험기준지급여력비율(A/B)" in label) and len(row) > 1:
                values = [
                    float(value)
                    for cell in row[1:]
                    if str(cell).strip() not in {"", "-", "–", "—"}
                    for value in [number(cell)]
                    if value is not None
                ]
                if values:
                    return values[0], "RBC" if year == 2022 else "K-ICS"
    return None, "RBC" if year == 2022 else "K-ICS"


def metric_value(year_data: dict, key: str, *, prior: bool = False) -> float | None:
    account = year_data["financial_metrics"].get(key)
    if not account:
        return None
    return account.get("prior_amount_bn" if prior else "amount_bn")


def source_reference(report: dict, tables: list[int]) -> dict:
    return {
        "sourceType": "Open DART",
        "rceptNo": report["rcept_no"],
        "reportName": report["report_name"],
        "dartUrl": report["dart_url"],
        "valueKind": "actual",
        "basis": "separate_financial_statement_excluding_reinsurance",
        "unit": "KRW billion",
        "sourceTables": tables,
    }


def main() -> int:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    life_validation = (
        json.loads(LIFE_VALIDATION.read_text(encoding="utf-8"))
        if LIFE_VALIDATION.exists()
        else {}
    )
    meritz_validation = (
        json.loads(MERITZ_VALIDATION.read_text(encoding="utf-8"))
        if MERITZ_VALIDATION.exists()
        else {}
    )
    output = {
        "dataContractVersion": "csm-dashboard-annual/v1",
        "periodBasis": "year-end-only",
        "years": [2022, 2023, 2024, 2025],
        "sampleData": {},
    }
    for company_key, company in source["companies"].items():
        name, sector, company_type = LIFE_META[company_key]
        periods = {}
        current_prior: tuple[dict, dict | None] | None = None
        for year in (2022, 2023, 2024, 2025):
            if company_key in LIFE_SEPARATE_TABLES:
                movement, table_indexes, report = separate_life_movement(
                    company_key, company, year
                )
            elif company_key == "meritz-fire":
                movement, table_indexes, report = meritz_fire_movement(company, year)
            elif (company_key, year) in MULTI_TABLE_OVERRIDES:
                table_indexes = MULTI_TABLE_OVERRIDES[(company_key, year)]
                source_year = company["years"][str(year)]
                tables = [
                    table
                    for table in source_year["document_candidates"]
                    if table["document"].endswith("_00761.xml")
                    and table["table_index"] in table_indexes
                ]
                if len(tables) != len(table_indexes):
                    raise ValueError(f"{company_key}: tables missing for {year}: {table_indexes}")
                movement = combined_movement(tables)
                report = source_year["report"]
            elif year == 2022:
                if current_prior is None:
                    current_prior = general_current_and_prior(
                        company["years"]["2023"]["document_candidates"], company_key, 2023
                    )
                prior_table = current_prior[1]
                if prior_table is None:
                    raise ValueError(f"{company_key}: 2022 comparative table missing")
                movement = extract_table_movement(prior_table)
                table_indexes = [prior_table["table_index"]]
                report = company["years"]["2023"]["report"]
            else:
                current_table, prior_table = general_current_and_prior(
                    company["years"][str(year)]["document_candidates"], company_key, year
                )
                if year == 2023:
                    current_prior = (current_table, prior_table)
                movement = extract_table_movement(current_table)
                table_indexes = [current_table["table_index"]]
                report = company["years"][str(year)]["report"]

            financial_year = company["years"]["2023"] if year == 2022 else company["years"][str(year)]
            insurance_profit = metric_value(financial_year, "insurance_profit", prior=year == 2022)
            parent_net_income = metric_value(financial_year, "parent_net_income", prior=year == 2022)
            kics, solvency_basis = kics_ratio(company["years"][str(year)], year)
            validation = life_validation.get("companies", {}).get(company_key, {}).get(
                "periods", {}
            ).get(str(year), {})
            if company_key == "meritz-fire":
                validation = meritz_validation.get("periods", {}).get(str(year), {})
            if validation.get("kics", {}).get("value") is not None:
                kics = validation["kics"]["value"]
                solvency_basis = validation["kics"]["basis"]
            validated_profit = validation.get("insuranceProfit", {})
            if (
                validated_profit.get("source") == "FISIS"
                and validated_profit.get("checkValue") is not None
            ):
                insurance_profit = round(validated_profit["checkValue"], 3)
            periods[f"{year}-ye"] = {
                "csm": movement["closing"],
                "growth": round((movement["closing"] / movement["opening"] - 1) * 100, 1)
                if movement["opening"]
                else None,
                "movement": movement,
                "insuranceProfit": insurance_profit,
                "parentNetIncome": parent_net_income,
                "kics": kics,
                "solvencyBasis": solvency_basis,
                "quality": (
                    "DART 원문 · FISIS/IR 교차검증"
                    if validation
                    else "DART 연차 공시 · 무브먼트 검산"
                ),
                "sourceReference": source_reference(report, table_indexes),
                "metricBasis": {
                    "csm": "별도 · 발행 보험계약 · 출재 재보험 제외",
                    "insuranceProfit": "별도 · K-IFRS",
                    "parentNetIncome": "연결 · 지배기업 소유주 귀속",
                    "solvency": solvency_basis,
                },
                "validation": validation or None,
            }
        output["sampleData"][company_key] = {
            "name": name,
            "sector": sector,
            "type": company_type,
            "periods": periods,
        }

    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    DASHBOARD_JS.write_text(
        "/* Generated by tools/build_annual_dashboard_data.py. */\n"
        f"window.CSM_AGENT_DATA = {json.dumps(output, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
