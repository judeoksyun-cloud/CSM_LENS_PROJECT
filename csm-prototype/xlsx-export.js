(function registerCsmXlsxExport(global) {
  "use strict";

  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });

  function escapeXml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function sanitizeSheetName(value) {
    const cleaned = String(value || "Data").replace(/[\\/*?:[\]]/g, " ").trim();
    return (cleaned || "Data").slice(0, 31);
  }

  function columnName(index) {
    let current = index + 1;
    let name = "";
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - 1) / 26);
    }
    return name;
  }

  function displayWidth(value) {
    return [...String(value ?? "")].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  function classifyValue(value) {
    const text = String(value ?? "").trim();
    if (!text || text === "—") return { type: "blank", value: "" };
    const normalized = text.replaceAll(",", "").replaceAll("−", "-");
    if (/^[+-]?\d+(?:\.\d+)?%$/.test(normalized)) {
      return { type: "percent", value: Number(normalized.slice(0, -1)) / 100 };
    }
    if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
      return { type: "number", value: Number(normalized) };
    }
    return { type: "string", value: text };
  }

  function cellXml(reference, rawValue, header) {
    const cell = classifyValue(rawValue);
    if (cell.type === "blank") return "";
    if (cell.type === "number") {
      return `<c r="${reference}" s="${header ? 3 : 1}"><v>${cell.value}</v></c>`;
    }
    if (cell.type === "percent") {
      return `<c r="${reference}" s="${header ? 3 : 2}"><v>${cell.value}</v></c>`;
    }
    return `<c r="${reference}" t="inlineStr"${header ? ' s="3"' : ""}><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
  }

  function worksheetXml(rows, headerRowCount) {
    const columnCount = Math.max(1, ...rows.map((row) => row.length));
    const lastReference = `${columnName(columnCount - 1)}${Math.max(rows.length, 1)}`;
    const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
      const width = Math.min(42, Math.max(10, ...rows.map((row) => displayWidth(row[columnIndex]) + 2)));
      return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${width}" customWidth="1"/>`;
    }).join("");
    const rowXml = rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => cellXml(
        `${columnName(columnIndex)}${rowIndex + 1}`,
        value,
        rowIndex < headerRowCount,
      )).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const freezePane = headerRowCount
      ? `<pane ySplit="${headerRowCount}" topLeftCell="A${headerRowCount + 1}" activePane="bottomLeft" state="frozen"/>`
      : "";
    const autoFilter = headerRowCount && rows.length > headerRowCount
      ? `<autoFilter ref="A${headerRowCount}:${lastReference}"/>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastReference}"/><sheetViews><sheetView workbookViewId="0">${freezePane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData>${autoFilter}</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.##;[Red]-#,##0.##"/><numFmt numFmtId="165" formatCode="0.00%;[Red]-0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1F3A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
  }

  function concatBytes(chunks) {
    const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function zipEntries(entries) {
    const localParts = [];
    const centralParts = [];
    const { date, time } = dosDateTime();
    let localOffset = 0;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
      const checksum = crc32(dataBytes);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, time, true);
      localView.setUint16(12, date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      const localPart = concatBytes([localHeader, nameBytes, dataBytes]);
      localParts.push(localPart);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, time, true);
      centralView.setUint16(14, date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, localOffset, true);
      centralParts.push(concatBytes([centralHeader, nameBytes]));
      localOffset += localPart.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, localOffset, true);
    return concatBytes([...localParts, centralDirectory, endRecord]);
  }

  function buildWorkbookBlob({ rows, headerRowCount = 1, sheetName = "Data" }) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Excel export requires at least one row.");
    const normalizedRows = rows.map((row) => Array.isArray(row) ? row : [row]);
    const safeSheetName = sanitizeSheetName(sheetName);
    const entries = [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      { name: "xl/worksheets/sheet1.xml", data: worksheetXml(normalizedRows, headerRowCount) },
      { name: "xl/styles.xml", data: stylesXml() },
    ];
    return new Blob([zipEntries(entries)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function exportCellText(cell) {
    let text = cell.innerText || cell.textContent || "";
    for (const control of cell.querySelectorAll("a, button")) {
      const controlText = control.innerText || control.textContent || "";
      if (controlText) text = text.replace(controlText, " ");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function tableToMatrix(table) {
    if (!table) throw new Error("Excel export table is not available.");
    const matrix = [];
    const tableRows = [...table.rows];
    tableRows.forEach((row, rowIndex) => {
      matrix[rowIndex] ??= [];
      let columnIndex = 0;
      for (const cell of row.cells) {
        while (matrix[rowIndex][columnIndex] !== undefined) columnIndex += 1;
        const value = exportCellText(cell);
        const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
        const columnSpan = Math.max(1, Number(cell.colSpan) || 1);
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          matrix[rowIndex + rowOffset] ??= [];
          for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
            matrix[rowIndex + rowOffset][columnIndex + columnOffset] = value;
          }
        }
        columnIndex += columnSpan;
      }
    });
    const columnCount = Math.max(0, ...matrix.map((row) => row.length));
    return {
      rows: matrix.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "")),
      headerRowCount: table.tHead?.rows?.length ?? 0,
    };
  }

  function downloadTable({ table, filename, sheetName }) {
    const workbook = tableToMatrix(table);
    const blob = buildWorkbookBlob({ ...workbook, sheetName });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return {
      filename: anchor.download,
      rowCount: workbook.rows.length,
      columnCount: workbook.rows[0]?.length ?? 0,
      size: blob.size,
    };
  }

  global.CSM_XLSX_EXPORT = Object.freeze({ buildWorkbookBlob, downloadTable, tableToMatrix });
})(typeof window === "undefined" ? globalThis : window);
