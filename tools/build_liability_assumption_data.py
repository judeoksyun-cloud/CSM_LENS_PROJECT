# -*- coding: utf-8 -*-
"""Build liability-assumption dashboard data from Open DART annual-report notes."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DART_FILES = {
    2024: ROOT / "external-data" / "dart-assumption-metrics-2024.json",
    2025: ROOT / "external-data" / "dart-assumption-metrics-2025.json",
}
DISCLOSURE_SEARCH_FILES = {
    2022: ROOT / "external-data" / "dart-assumption-metrics-2022.json",
    2023: ROOT / "external-data" / "dart-assumption-metrics-2023.json",
    **DART_FILES,
}
OUTPUT_JSON = ROOT / "external-data" / "liability-assumption-dashboard-data.json"
OUTPUT_JS = ROOT / "csm-prototype" / "liability-assumption-data.generated.js"

# Reviewed company-only / issued-insurance-contract tables in each Open DART report.
SELECTED_CANDIDATES = {
    2024: {
        "samsung-life": 2, "hanwha-life": 0, "kyobo-life": 0, "shinhan-life": 2,
        "samsung-fire": 0, "meritz-fire": 0, "db-insurance": 0,
        "hyundai-marine": 0, "kb-insurance": 0,
    },
    2025: {
        "samsung-life": 5, "hanwha-life": 4, "kyobo-life": 1, "shinhan-life": 2,
        "samsung-fire": 2, "meritz-fire": 0, "db-insurance": 0,
        "hyundai-marine": 0, "kb-insurance": 0,
    },
}

CANONICAL_LABELS = {
    "newBusiness": "당기최초인식계약",
    "estimateChange": "보험계약마진 추정의 변경",
    "assumptionEffect": "가정변경효과",
    "volume": "물량차이 및 투자요소예실차",
    "onerous": "손실부담계약 추정의 변경",
}


def compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def number(value):
    text = str(value or "").strip().replace(",", "")
    if text in ("", "-"):
        return 0.0
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    try:
        result = float(text)
    except ValueError:
        return None
    return -result if negative else result


def clean(value):
    rounded = round(value, 4)
    return int(rounded) if float(rounded).is_integer() else rounded


def parse_candidate(candidate: dict) -> dict:
    parsed_rows = []
    raw_numbers = []
    for source_index, source_row in enumerate(candidate["rows"]):
        numeric_positions = [index for index, value in enumerate(source_row) if number(value) is not None]
        if not numeric_positions:
            continue
        start = numeric_positions[0]
        label = " ".join(source_row[:start])
        values = [number(value) for value in source_row[start:] if number(value) is not None]
        if len(values) < 3:
            if len(values) == 1 and ("손실요소" in label or "손실부담" in label):
                values = [0.0, 0.0, values[0]]
            else:
                continue
        values = values[:3]
        raw_numbers.extend(abs(value) for value in values)
        parsed_rows.append({"sourceIndex": source_index, "sourceLabel": label, "values": values})

    source_text = candidate.get("context", "") + " " + " ".join(
        " ".join(row) for row in candidate["rows"]
    )
    peak = max(raw_numbers or [0])
    if "억원" in source_text:
        factor, original_unit = 1, "억원"
    elif peak > 1e11:
        factor, original_unit = 1e-8, "원"
    elif peak > 1e8:
        factor, original_unit = 1e-5, "천원"
    else:
        factor, original_unit = 0.01, "백만원"
    for row in parsed_rows:
        row["values"] = [clean(value * factor) for value in row["values"]]

    def find(predicate):
        return next((row for row in parsed_rows if predicate(compact(row["sourceLabel"]))), None)

    new_business = find(
        lambda label: ("신계약" in label or "최초인식계약" in label)
        and "외" not in label and "外" not in label
    )
    drivers = []
    for token in ("해지율", "위험률", "위험율", "사업비율", "기타가정"):
        if token == "위험율" and any("위험률" in compact(row["sourceLabel"]) for row in drivers):
            continue
        row = find(lambda label, target=token: target in label)
        if row and row not in drivers:
            drivers.append(row)

    effect_options = [
        row for row in parsed_rows
        if "가정변경효과" in compact(row["sourceLabel"])
        and not any(token in compact(row["sourceLabel"]) for token in ("해지율", "위험률", "위험율", "사업비율", "기타가정"))
    ]
    assumption_effect = min(effect_options, key=lambda row: len(compact(row["sourceLabel"]))) if effect_options else None
    if not assumption_effect and len(drivers) == 4:
        last_driver = max(row["sourceIndex"] for row in drivers)
        assumption_effect = next(
            (row for row in parsed_rows if row["sourceIndex"] > last_driver and compact(row["sourceLabel"]) in ("소계", "합계")),
            None,
        )
    volume = find(lambda label: "물량차이" in label)
    onerous = find(lambda label: "손실부담" in label or "손실요소" in label)
    estimate_change = find(
        lambda label: (
            "보험계약마진추정의변경" in label or "신계약외변동" in label or "신계약外변동" in label
        ) and not any(token in label for token in ("해지율", "위험률", "위험율", "사업비율", "기타가정"))
    )
    if estimate_change and estimate_change["sourceIndex"] == assumption_effect["sourceIndex"]:
        estimate_change = None
    if not all((new_business, assumption_effect, volume, onerous)) or len(drivers) != 4:
        raise ValueError(f"Open DART liability table parsing failed: {candidate['document']} table {candidate['tableIndex']}")

    def values(row, label, level):
        return {"label": label, "level": level, "bel": row["values"][0], "ra": row["values"][1], "csm": row["values"][2]}

    new_item = values(new_business, CANONICAL_LABELS["newBusiness"], 0)
    effect_item = values(assumption_effect, CANONICAL_LABELS["assumptionEffect"], 1)
    driver_items = [
        values(row, label, 2)
        for row, label in zip(drivers, ("해지율가정", "위험율가정", "사업비율가정", "기타가정"))
    ]
    volume_item = values(volume, CANONICAL_LABELS["volume"], 1)
    onerous_item = values(onerous, CANONICAL_LABELS["onerous"], 1)
    if estimate_change:
        estimate_item = values(estimate_change, CANONICAL_LABELS["estimateChange"], 0)
        estimate_item["valueType"] = "disclosed"
    else:
        estimate_item = {
            "label": CANONICAL_LABELS["estimateChange"], "level": 0,
            **{
                key: clean(effect_item[key] + volume_item[key] + onerous_item[key])
                for key in ("bel", "ra", "csm")
            },
            "valueType": "calculated-from-open-dart-components",
        }
    rows = [new_item, estimate_item, effect_item, *driver_items, volume_item, onerous_item]
    return {
        "rows": rows,
        "summary": {
            "newBusiness": new_item,
            "estimateChange": estimate_item,
            "assumptionEffect": effect_item,
            "drivers": driver_items,
            "volumeAndInvestmentExperience": volume_item,
            "onerousContractChange": onerous_item,
        },
        "originalUnit": original_unit,
        "conversionFactorToEok": factor,
    }


def build():
    companies = {}
    for year, source_path in DART_FILES.items():
        source = json.loads(source_path.read_text(encoding="utf-8"))
        for company_key, candidate_index in SELECTED_CANDIDATES[year].items():
            company = source["companies"][company_key]
            candidate = company["candidates"]["liability_assumption"][candidate_index]
            period = parse_candidate(candidate)
            report = company["report"]
            period["sourceReference"] = {
                "sourceType": "Open DART",
                "corpCode": company["corpCode"],
                "rceptNo": report["rcept_no"],
                "reportName": report["report_name"],
                "rceptDate": report["rcept_dt"],
                "dartUrl": report["dart_url"],
                "document": candidate["document"],
                "tableIndex": candidate["tableIndex"],
                "candidateIndex": candidate_index,
                "basis": "사업보고서 재무제표 주석 · 회사계/발행한 보험계약",
                "originalUnit": period.pop("originalUnit"),
                "conversionFactorToEok": period.pop("conversionFactorToEok"),
            }
            driver_sum = clean(sum(item["csm"] for item in period["summary"]["drivers"]))
            effect_delta = clean(driver_sum - period["summary"]["assumptionEffect"]["csm"])
            component_sum_with_onerous = clean(sum(
                period["summary"][metric]["csm"]
                for metric in ("assumptionEffect", "volumeAndInvestmentExperience", "onerousContractChange")
            ))
            component_sum_without_onerous = clean(sum(
                period["summary"][metric]["csm"]
                for metric in ("assumptionEffect", "volumeAndInvestmentExperience")
            ))
            estimate_delta_with_onerous = clean(component_sum_with_onerous - period["summary"]["estimateChange"]["csm"])
            estimate_delta_without_onerous = clean(component_sum_without_onerous - period["summary"]["estimateChange"]["csm"])
            estimate_is_derived = period["summary"]["estimateChange"]["valueType"] != "disclosed"
            estimate_reconciled = estimate_is_derived or min(
                abs(estimate_delta_with_onerous), abs(estimate_delta_without_onerous)
            ) <= 1
            period["checks"] = {
                "driversToAssumptionEffectDelta": effect_delta,
                "componentsToEstimateChangeDeltaIncludingOnerous": estimate_delta_with_onerous,
                "componentsToEstimateChangeDeltaExcludingOnerous": estimate_delta_without_onerous,
                "estimateChangeValueType": period["summary"]["estimateChange"]["valueType"],
                "sourceTraceComplete": all(
                    period["sourceReference"].get(field)
                    for field in ("rceptNo", "document", "tableIndex", "originalUnit")
                ),
                "status": "passed" if abs(effect_delta) <= 1 and estimate_reconciled else "needs_review",
            }
            record = companies.setdefault(company_key, {
                "name": company["name"], "sector": company["sector"], "corpCode": company["corpCode"], "periods": {},
            })
            record["periods"][f"{year}-ye"] = period

    ordered_keys = list(SELECTED_CANDIDATES[2025])
    disclosure_audit = {}
    for year, source_path in DISCLOSURE_SEARCH_FILES.items():
        source = json.loads(source_path.read_text(encoding="utf-8"))
        full_counts = {
            key: len(company["candidates"].get("liability_assumption", []))
            for key, company in source["companies"].items()
        }
        partial_counts = {
            key: len(company["candidates"].get("liability_assumption_partial", []))
            for key, company in source["companies"].items()
        }
        disclosure_audit[str(year)] = {
            "fullTableCandidateCountByCompany": full_counts,
            "partialTableCandidateCountByCompany": partial_counts,
            "status": "available" if all(count > 0 for count in full_counts.values()) else "not_available",
        }
    first_disclosure_year = min(
        int(year) for year, audit in disclosure_audit.items() if audit["status"] == "available"
    )
    return {
        "version": "2026.08.04-v2-dart",
        "generatedAt": "2026-08-04",
        "availablePeriods": ["2024-ye", "2025-ye"],
        "searchedFromYear": 2022,
        "firstDisclosureYear": first_disclosure_year,
        "disclosureHistoryAudit": disclosure_audit,
        "unit": "억원",
        "sourcePolicy": "Open DART annual-report financial-statement notes are the sole source and validation basis",
        "signConvention": "CSM 양수는 보험계약마진 증가, 음수는 감소",
        "companies": {key: companies[key] for key in ordered_keys},
    }


if __name__ == "__main__":
    payload = build()
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT_JS.write_text("window.CSM_LIABILITY_ASSUMPTION_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(f"wrote {OUTPUT_JSON}")
    print(f"wrote {OUTPUT_JS}")
