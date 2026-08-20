import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("csm-prototype/xlsx-export.js", "utf8");
const context = {
  ArrayBuffer,
  Blob,
  DataView,
  Date,
  TextEncoder,
  Uint8Array,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const exporter = context.CSM_XLSX_EXPORT;
assert.ok(exporter, "XLSX exporter should register itself");

const blob = exporter.buildWorkbookBlob({
  rows: [
    ["업권", "회사", "비율", "금액"],
    ["생명보험", "삼성생명", "12.5%", "1,234.5"],
    ["손해보험", "삼성화재", "−3.2%", "−456"],
  ],
  headerRowCount: 1,
  sheetName: "보험사 전체보기",
});

assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
const bytes = new Uint8Array(await blob.arrayBuffer());
assert.equal(String.fromCharCode(...bytes.slice(0, 2)), "PK", "XLSX should be a ZIP package");
assert.equal(bytes.at(-22), 0x50, "ZIP end record should be present");
assert.equal(bytes.at(-21), 0x4b);

const packageText = new TextDecoder().decode(bytes);
assert.match(packageText, /\[Content_Types\]\.xml/);
assert.match(packageText, /xl\/worksheets\/sheet1\.xml/);
assert.match(packageText, /보험사 전체보기/);
assert.match(packageText, /삼성생명/);
assert.match(packageText, /<v>0\.125<\/v>/, "percent values should be stored as numeric Excel cells");
assert.match(packageText, /<v>1234\.5<\/v>/, "amount values should be stored as numeric Excel cells");
