// Injects native Excel dropdown (List) data validations into a .xlsx
// ArrayBuffer that SheetJS (vendor/xlsx.full.min.js, the Community Edition)
// already wrote. That build has no support at all for WRITING data
// validations (verified: zero references to "dataValidation" in the
// vendored source) - it's gated behind SheetJS Pro. The workaround: a .xlsx
// file is itself a zip (OOXML) package, so after SheetJS produces the
// bytes, JSZip (vendor/jszip.min.js) re-opens that same zip, patches the
// target worksheet's raw XML to add a <dataValidations> block, and
// re-serializes it. Excel, LibreOffice and Google Sheets all read the
// result as an ordinary file with real dropdown cells - nothing downstream
// needs to know this extra step happened.

/** 0-based column index -> Excel column letter (0 -> A, 25 -> Z, 26 -> AA, ...). */
function excelColLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * sheetValidations: { [dataSheetName]: Array<
 *   { colIndex: number, kind: "inline", values: string[] } |
 *   { colIndex: number, kind: "range", sheetName: string, listColIndex: number, count: number }
 * > }
 * lastDataRow: how far down each data column the dropdown applies (e.g. 1000 - generous headroom for rows the user adds).
 * Returns a new ArrayBuffer - the original is left untouched.
 */
async function addDataValidations(arrayBuffer, sheetValidations, lastDataRow) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");

  const nameToRid = {};
  const sheetTagRe = /<sheet\b[^>]*\/>/g;
  let m;
  while ((m = sheetTagRe.exec(workbookXml))) {
    const tag = m[0];
    const name = (tag.match(/\bname="([^"]*)"/) || [])[1];
    const rid = (tag.match(/\br:id="([^"]*)"/) || [])[1];
    if (name && rid) nameToRid[name] = rid;
  }
  const ridToTarget = {};
  const relTagRe = /<Relationship\b[^>]*\/>/g;
  while ((m = relTagRe.exec(relsXml))) {
    const tag = m[0];
    const id = (tag.match(/\bId="([^"]*)"/) || [])[1];
    const target = (tag.match(/\bTarget="([^"]*)"/) || [])[1];
    if (id && target) ridToTarget[id] = target;
  }

  for (const [sheetName, cols] of Object.entries(sheetValidations)) {
    if (!cols || cols.length === 0) continue;
    const rid = nameToRid[sheetName];
    const target = rid && ridToTarget[rid];
    if (!target) continue;
    const path = "xl/" + target.replace(/^\/?(xl\/)?/, "");
    const file = zip.file(path);
    if (!file) continue;
    let xml = await file.async("string");

    const dvEntries = cols.map((c) => {
      const colL = excelColLetter(c.colIndex);
      const sqref = `${colL}2:${colL}${lastDataRow}`;
      let formula1;
      if (c.kind === "inline") {
        formula1 = `"${c.values.join(",")}"`;
      } else {
        const listColL = excelColLetter(c.listColIndex);
        const ref = /[^A-Za-z0-9_]/.test(c.sheetName) ? `'${c.sheetName}'` : c.sheetName;
        formula1 = `${ref}!$${listColL}$2:$${listColL}$${c.count + 1}`;
      }
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Invalid entry" error="Please pick a value from the dropdown list for this column." sqref="${sqref}"><formula1>${escapeXmlText(formula1)}</formula1></dataValidation>`;
    });
    const block = `<dataValidations count="${dvEntries.length}">${dvEntries.join("")}</dataValidations>`;

    // Per the OOXML worksheet schema, <dataValidations> comes right after
    // <sheetData> (and after <mergeCells>/<conditionalFormatting> if either
    // is present - neither is, on these generated sheets) and before
    // <pageMargins> etc. SheetJS never writes a <dataValidations> block
    // itself, so there is nothing to merge with.
    xml = xml.replace(/<\/sheetData>/, `</sheetData>${block}`);
    zip.file(path, xml);
  }

  return zip.generateAsync({ type: "arraybuffer" });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { addDataValidations, excelColLetter };
}
