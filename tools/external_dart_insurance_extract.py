# -*- coding: utf-8 -*-
"""Collect Samsung Life/Fire 2025 insurance dashboard inputs from external DART only.

The script may read a local .env file for the DART API key, but it must not use
local PDFs, uploaded files, or cached user documents as source evidence.
"""

import json
import re
import urllib.parse
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path

from lxml import html


ENV_PATH = Path(r"C:\Users\user\Desktop\codex_day2\.env")
OUT_PATH = Path(r"C:\Users\user\Desktop\Codex_Practice\external-data\dart-2025-insurance-extract.json")

COMPANIES = {
    "samsung-life": {
        "name": "삼성생명",
        "corp_code": "00126256",
        "periods": {
            "2025-q1": {
                "reprt_code": "11013",
                "rcept_no": "20250530002283",
                "label": "2025 Q1",
                "report_name": "[기재정정]분기보고서 (2025.03)",
            },
            "2025-q2": {
                "reprt_code": "11012",
                "rcept_no": "20250813000585",
                "label": "2025 Q2",
                "report_name": "반기보고서 (2025.06)",
            },
            "2025-q3": {
                "reprt_code": "11014",
                "rcept_no": "20251114002091",
                "label": "2025 Q3",
                "report_name": "분기보고서 (2025.09)",
            },
            "2025-q4": {
                "reprt_code": "11011",
                "rcept_no": "20260331004244",
                "label": "2025 Q4",
                "report_name": "[기재정정]사업보고서 (2025.12)",
            },
        },
    },
    "samsung-fire": {
        "name": "삼성화재",
        "corp_code": "00139214",
        "periods": {
            "2025-q1": {
                "reprt_code": "11013",
                "rcept_no": "20250515002709",
                "label": "2025 Q1",
                "report_name": "분기보고서 (2025.03)",
            },
            "2025-q2": {
                "reprt_code": "11012",
                "rcept_no": "20250814004098",
                "label": "2025 Q2",
                "report_name": "반기보고서 (2025.06)",
            },
            "2025-q3": {
                "reprt_code": "11014",
                "rcept_no": "20251114002900",
                "label": "2025 Q3",
                "report_name": "분기보고서 (2025.09)",
            },
            "2025-q4": {
                "reprt_code": "11011",
                "rcept_no": "20260312001399",
                "label": "2025 Q4",
                "report_name": "사업보고서 (2025.12)",
                "note": "2026-03-13 첨부정정은 본문 XML 후보가 비어 있어 본문 파싱은 최초 사업보고서 접수번호를 사용",
            },
        },
    },
}

TEXT_KEYWORDS = [
    "CSM",
    "계약서비스마진",
    "보험계약서비스마진",
    "보험계약마진",
    "계약마진",
    "지급여력",
    "K-ICS",
    "킥스",
]


def read_api_key():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("API_K_DART="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("API_K_DART not found")


API_KEY = read_api_key()


def fetch_bytes(endpoint, params):
    query = urllib.parse.urlencode({"crtfc_key": API_KEY, **params})
    url = f"https://opendart.fss.or.kr/api/{endpoint}?{query}"
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def fetch_json(endpoint, params):
    return json.loads(fetch_bytes(endpoint, params).decode("utf-8"))


def amount_to_bn(value):
    if value in (None, "", "-"):
        return None
    cleaned = str(value).replace(",", "").strip()
    try:
        return float((Decimal(cleaned) / Decimal("1000000000")).quantize(Decimal("0.001")))
    except (InvalidOperation, ValueError):
        return None


def normalize_text(text):
    return re.sub(r"\s+", " ", text or "").strip()


def table_context(table, max_items=8):
    context = []
    for sibling in table.itersiblings(preceding=True):
        text = normalize_text(sibling.text_content())
        if text:
            context.append(text[:500])
        if len(context) >= max_items:
            break
    return " | ".join(reversed(context))


def compact(text):
    return re.sub(r"\s+", "", text or "")


def row_amount(row):
    return amount_to_bn(row.get("thstrm_amount"))


def account_payload(row):
    return {
        "account_nm": row.get("account_nm"),
        "sj_nm": row.get("sj_nm"),
        "thstrm_nm": row.get("thstrm_nm"),
        "raw_amount": row.get("thstrm_amount"),
        "amount_bn": row_amount(row),
    }


def find_first(rows, predicate):
    for row in rows:
        if row_amount(row) is None:
            continue
        if predicate(row):
            return account_payload(row)
    return None


def find_insurance_profit(rows):
    exact_names = {"보험서비스손익", "보험서비스결과", "보험손익"}
    return find_first(rows, lambda row: compact(row.get("account_nm")) in exact_names)


def find_parent_net_income(rows):
    def matches(row):
        name = compact(row.get("account_nm"))
        if "포괄" in name:
            return False
        has_parent = "지배기업" in name and ("소유주" in name or "소유주지분" in name)
        return has_parent and "순이익" in name

    return find_first(rows, matches)


def find_non_controlling_interest(rows):
    def matches(row):
        name = compact(row.get("account_nm"))
        if "포괄" in name:
            return False
        return "비지배지분" in name and "순이익" in name

    return find_first(rows, matches)


def find_income_tax_expense(rows):
    return find_first(
        rows,
        lambda row: "법인세비용" in compact(row.get("account_nm")) and "차감전" not in compact(row.get("account_nm")),
    )


def get_accounts(corp_code, reprt_code, fs_div):
    result = fetch_json(
        "fnlttSinglAcntAll.json",
        {
            "corp_code": corp_code,
            "bsns_year": "2025",
            "reprt_code": reprt_code,
            "fs_div": fs_div,
        },
    )
    if result.get("status") != "000":
        return {"status": result.get("status"), "message": result.get("message"), "rows": []}
    return {"status": "000", "message": result.get("message"), "rows": result.get("list", [])}


def extract_document_xml(rcept_no):
    payload = fetch_bytes("document.xml", {"rcept_no": rcept_no})
    try:
        with zipfile.ZipFile(BytesIO(payload)) as zf:
            names = [name for name in zf.namelist() if name.lower().endswith((".xml", ".html", ".htm"))]
            return [{"name": name, "bytes": zf.read(name)} for name in names]
    except zipfile.BadZipFile:
        return [{"name": f"{rcept_no}.xml", "bytes": payload}]


def parse_document_candidates(rcept_no):
    candidates = {"tables": [], "snippets": []}
    seen_snippets = set()
    for doc in extract_document_xml(rcept_no):
        try:
            root = html.fromstring(doc["bytes"])
        except Exception:
            continue

        full_text = normalize_text(root.text_content())
        for keyword in TEXT_KEYWORDS:
            for match in re.finditer(re.escape(keyword), full_text, flags=re.IGNORECASE):
                start = max(0, match.start() - 180)
                end = min(len(full_text), match.end() + 320)
                snippet = full_text[start:end]
                if snippet in seen_snippets:
                    continue
                seen_snippets.add(snippet)
                candidates["snippets"].append({"document": doc["name"], "keyword": keyword, "text": snippet})
                if len(candidates["snippets"]) >= 120:
                    break
            if len(candidates["snippets"]) >= 120:
                break

        table_items = []
        for table_index, table in enumerate(root.xpath(".//table")):
            text = normalize_text(table.text_content())
            rows = []
            for tr in table.xpath(".//tr"):
                cells = [normalize_text(cell.text_content()) for cell in tr.xpath("./th|./td|./te")]
                cells = [cell for cell in cells if cell]
                if cells:
                    rows.append(cells)
            if not rows:
                continue
            table_items.append({"element": table, "table_index": table_index, "text": text, "rows": rows})

        focus_positions = set()
        for position, item in enumerate(table_items):
            if not any(keyword.lower() in item["text"].lower() for keyword in TEXT_KEYWORDS):
                continue
            for nearby in range(max(0, position - 1), min(len(table_items), position + 6)):
                focus_positions.add(nearby)

        for position in sorted(focus_positions):
            item = table_items[position]
            candidates["tables"].append(
                {
                    "document": doc["name"],
                    "table_index": item["table_index"],
                    "context": table_context(item["element"]),
                    "text_preview": item["text"][:700],
                    "rows": item["rows"][:80],
                }
            )
            if len(candidates["tables"]) >= 520:
                break
    return candidates


def derive_financial_metric(ofs_accounts, cfs_accounts):
    accounts = {
        "insurance_service_profit": find_insurance_profit(ofs_accounts["rows"]),
        "parent_net_income": find_parent_net_income(cfs_accounts["rows"]),
        "non_controlling_interest": find_non_controlling_interest(cfs_accounts["rows"]),
        "income_tax_expense": find_income_tax_expense(cfs_accounts["rows"]),
    }

    insurance = accounts["insurance_service_profit"]
    parent = accounts["parent_net_income"]
    nci = accounts["non_controlling_interest"]
    tax = accounts["income_tax_expense"]

    if all(item and item.get("amount_bn") is not None for item in [insurance, parent, nci, tax]):
        investment = round(parent["amount_bn"] + nci["amount_bn"] + tax["amount_bn"] - insurance["amount_bn"], 3)
    else:
        investment = None

    return {
        "accounts": accounts,
        "derived": {
            "insurance_profit_bn": insurance["amount_bn"] if insurance else None,
            "investment_profit_bn": investment,
            "parent_net_income_bn": parent["amount_bn"] if parent else None,
            "non_controlling_interest_bn": nci["amount_bn"] if nci else None,
            "income_tax_expense_bn": tax["amount_bn"] if tax else None,
        },
        "basis": {
            "insurance_profit": "OFS 별도 보험서비스손익/보험손익",
            "investment_profit": "별도 투자손익 + 영업외손익 + 연결효과",
            "investment_calculation": "지배주주 연결순이익 + 비지배지분순이익 + 법인세비용 - 별도 보험손익",
            "net_income": "CFS 지배기업 소유주 귀속 순이익",
            "tax": "CFS 법인세비용",
        },
    }


def main():
    output = {
        "source_policy": "external DART API only; local PDFs, uploaded files, and user-provided documents excluded",
        "generated_from": "https://opendart.fss.or.kr/api/",
        "companies": {},
    }
    for company_key, company in COMPANIES.items():
        output["companies"][company_key] = {
            "name": company["name"],
            "corp_code": company["corp_code"],
            "periods": {},
        }
        for period_key, period in company["periods"].items():
            ofs = get_accounts(company["corp_code"], period["reprt_code"], "OFS")
            cfs = get_accounts(company["corp_code"], period["reprt_code"], "CFS")
            output["companies"][company_key]["periods"][period_key] = {
                **period,
                "dart_url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={period['rcept_no']}",
                "financial_metric": derive_financial_metric(ofs, cfs),
                "document_candidates": parse_document_candidates(period["rcept_no"]),
            }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUT_PATH)


if __name__ == "__main__":
    main()
