# -*- coding: utf-8 -*-
import json
import sys
from pathlib import Path


DATA_PATH = Path("external-data/dart-2025-insurance-extract.json")
KEYWORDS = [
    "보험계약마진",
    "계약서비스마진",
    "CSM",
    "기초",
    "기말",
    "당기말",
    "전기말",
    "신계약",
    "상각",
    "잔액",
    "잔여보장",
    "보험계약부채",
]


def has_focus(text):
    return any(keyword in text for keyword in KEYWORDS)


def main():
    company_filter = sys.argv[1] if len(sys.argv) > 1 else None
    period_filter = sys.argv[2] if len(sys.argv) > 2 else None
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    for company_key, company in data["companies"].items():
        if company_filter and company_key != company_filter:
            continue
        print(f"\n================ {company_key} {company['name']} ================")
        for period_key, period in company["periods"].items():
            if period_filter and period_key != period_filter:
                continue
            print(f"\n-- {period_key} {period['report_name']} {period['rcept_no']}")
            shown = 0
            for idx, table in enumerate(period["document_candidates"]["tables"]):
                preview = table.get("text_preview", "")
                rows = table.get("rows", [])
                joined_rows = "\n".join(" | ".join(row) for row in rows)
                if not (has_focus(preview) or has_focus(joined_rows)):
                    continue
                print(f"\nTABLE {idx} doc={table['document']} table_index={table['table_index']}")
                if table.get("context"):
                    context = table["context"]
                    print(f"CONTEXT {context[-700:]}")
                for row in rows[:30]:
                    print(" | ".join(row[:14]))
                shown += 1
                if shown >= 8:
                    break
            if shown == 0:
                print("(no focused table)")


if __name__ == "__main__":
    main()
