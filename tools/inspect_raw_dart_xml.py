# -*- coding: utf-8 -*-
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.external_dart_insurance_extract import extract_document_xml


def main():
    rcept_no = sys.argv[1] if len(sys.argv) > 1 else "20260331004244"
    needles = [
        "순부채 내역(합계)",
        "합계) 당기",
        "보험계약마진",
        "잔여보장부채 변동분",
    ]
    for doc in extract_document_xml(rcept_no):
        if not doc["name"].endswith(".xml"):
            continue
        text = doc["bytes"].decode("utf-8", "ignore")
        print("doc", doc["name"], "len", len(text))
        for needle in needles:
            idx = text.find(needle)
            print("needle", needle, "idx", idx)
            if idx != -1:
                print(text[max(0, idx - 1000) : idx + 5000])
                print("\n---")


if __name__ == "__main__":
    main()
