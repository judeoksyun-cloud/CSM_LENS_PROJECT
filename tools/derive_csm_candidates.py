# -*- coding: utf-8 -*-
import sys
from pathlib import Path

from lxml import html


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.external_dart_insurance_extract import COMPANIES, extract_document_xml, normalize_text


def parse_number(value):
    value = value.replace(",", "").replace("(", "-").replace(")", "").strip()
    if value in {"", "-", "　"}:
        return 0
    try:
        return int(value)
    except ValueError:
        return None


def table_rows(table):
    rows = []
    for tr in table.xpath(".//tr"):
        cells = [normalize_text(cell.text_content()) for cell in tr.xpath("./th|./td|./te")]
        cells = [cell for cell in cells if cell]
        if cells:
            rows.append(cells)
    return rows


def csm_from_aggregate_value_table(rows):
    for row in rows:
        if row and row[0] == "보험계약부채(자산)" and len(row) >= 7:
            general_csm = parse_number(row[3])
            vfa_csm = parse_number(row[6])
            if general_csm is None or vfa_csm is None:
                return None
            return {
                "general_csm_mn": general_csm,
                "vfa_csm_mn": vfa_csm,
                "total_csm_mn": general_csm + vfa_csm,
            }
    return None


def csm_from_any_component_table(rows):
    header = None
    header_index = None
    for index, row in enumerate(rows):
        if "보험계약마진" in row:
            header = row
            header_index = index
            break
    if header is None:
        return None

    data_row = None
    for row in rows[header_index + 1 :]:
        if row and row[0] in {"보험계약부채(자산)", "보험계약부채"}:
            data_row = row
            break
    if data_row is None:
        return None

    values = []
    for header_position, header_name in enumerate(header):
        if header_name != "보험계약마진":
            continue
        data_position = header_position + 1
        if data_position >= len(data_row):
            continue
        amount = parse_number(data_row[data_position])
        if amount is not None:
            values.append(amount)
    if not values:
        return None
    return {
        "general_csm_mn": None,
        "vfa_csm_mn": None,
        "total_csm_mn": sum(values),
        "components_mn": values,
    }


def classify_section(texts, index):
    preceding = " ".join(texts[max(0, index - 120) : index])
    last_consolidated = preceding.rfind("연결")
    last_separate = max(preceding.rfind("별도"), preceding.rfind("재무제표 주석"))
    if last_consolidated > last_separate:
        return "연결 후보"
    if last_separate >= 0:
        return "별도 후보"
    return "구분 필요"


def classify_value_table(table, texts, index):
    source = html.tostring(table, encoding="unicode")
    if "ConsolidatedMember" in source:
        return "연결"
    if "SeparateMember" in source:
        return "별도"
    return classify_section(texts, index)


def collect_for_period(company_key, period_key):
    period = COMPANIES[company_key]["periods"][period_key]
    results = []
    for doc in extract_document_xml(period["rcept_no"]):
        if not doc["name"].endswith(".xml"):
            continue
        root = html.fromstring(doc["bytes"])
        tables = list(root.xpath(".//table"))
        texts = [normalize_text(table.text_content()) for table in tables]
        for i, text in enumerate(texts):
            rows = table_rows(tables[i])
            csm = csm_from_any_component_table(rows)
            if csm is None and "순부채 내역" in text:
                value_table = tables[i + 1] if i + 1 < len(tables) else None
                rows = table_rows(value_table) if value_table is not None else []
                csm = csm_from_aggregate_value_table(rows)
                value_table_index = i + 1
                value_table_for_section = value_table
            else:
                value_table_index = i
                value_table_for_section = tables[i]
            if csm is None:
                continue
            source = html.tostring(value_table_for_section, encoding="unicode")
            if "CFY2025" not in source:
                continue
            period_label = "당기"
            results.append(
                {
                    "document": doc["name"],
                    "title_table_index": i,
                    "value_table_index": value_table_index,
                    "period_label": period_label,
                    "section": classify_value_table(value_table_for_section, texts, i),
                    "csm": csm,
                    "title": text[:140],
                }
            )
    return results


def main():
    company_filter = sys.argv[1] if len(sys.argv) > 1 else None
    period_filter = sys.argv[2] if len(sys.argv) > 2 else None
    for company_key, company in COMPANIES.items():
        if company_filter and company_key != company_filter:
            continue
        print(f"\n## {company_key} {company['name']}")
        for period_key in company["periods"]:
            if period_filter and period_key != period_filter:
                continue
            print(f"\n-- {period_key}")
            for item in collect_for_period(company_key, period_key):
                csm = item["csm"]
                csm_text = "None" if csm is None else f"{csm['total_csm_mn'] / 1_000_000:.3f}조"
                print(
                    item["section"],
                    item["period_label"],
                    "title_idx",
                    item["title_table_index"],
                    "value_idx",
                    item["value_table_index"],
                    "CSM",
                    csm_text,
                    "doc",
                    item["document"],
                )


if __name__ == "__main__":
    main()
