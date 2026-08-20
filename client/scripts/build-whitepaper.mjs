import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { META, SECTIONS } from "./whitepaper-content.mjs";

/**
 * Generates public/whitepaper.pdf.
 *
 *   npm run whitepaper
 *
 * Uses pdfkit's built-in Helvetica/Times metrics, so no font files are needed
 * and the output is a real text PDF — selectable, searchable and indexable —
 * rather than a rasterised page.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "whitepaper.pdf");

const INK = "#16181d";
const MUTED = "#5b6270";
const RULE = "#d5d3ce";
const ACCENT = "#0d7a4f";

const PAGE = { size: "A4", margins: { top: 68, bottom: 74, left: 68, right: 68 } };

mkdirSync(dirname(OUT), { recursive: true });

const doc = new PDFDocument({
  ...PAGE,
  // Required for bufferedPageRange()/switchToPage — without it the page count
  // always reads 1 and the footer stamping silently does nothing.
  bufferPages: true,
  info: {
    Title: `${META.title} — Whitepaper`,
    Author: META.title,
    Subject: META.subtitle,
    Keywords: "quanto, robinhood chain, chainlink, onchain game, tokenized equities",
  },
});

doc.pipe(createWriteStream(OUT));

const width = doc.page.width - PAGE.margins.left - PAGE.margins.right;

/** Page numbers are stamped at the end, once the total is known. */
const bodyPages = [];

function needsRoom(height) {
  const bottom = doc.page.height - PAGE.margins.bottom;
  if (doc.y + height > bottom) {
    doc.addPage();
    bodyPages.push(doc.bufferedPageRange().count - 1);
  }
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

function drawMark(x, y, scale = 1) {
  // The identity glyph: two candlesticks that read as buildings.
  const s = scale;
  doc.save();
  doc.lineWidth(1.1 * s).strokeColor(ACCENT).opacity(0.55);
  doc.moveTo(x + 7 * s, y).lineTo(x + 7 * s, y + 30 * s).stroke();
  doc.opacity(1).fillColor(ACCENT);
  doc.rect(x + 2 * s, y + 8 * s, 10 * s, 17 * s).fill();
  doc.fillColor("#ffffff");
  doc.rect(x + 4 * s, y + 11 * s, 2.4 * s, 2.8 * s).fill();
  doc.rect(x + 8 * s, y + 11 * s, 2.4 * s, 2.8 * s).fill();
  doc.rect(x + 4 * s, y + 16 * s, 2.4 * s, 2.8 * s).fill();

  doc.lineWidth(1.1 * s).strokeColor(INK).opacity(0.45);
  doc.moveTo(x + 24 * s, y + 5 * s).lineTo(x + 24 * s, y + 30 * s).stroke();
  doc.opacity(1).fillColor(INK);
  doc.rect(x + 19 * s, y + 14 * s, 10 * s, 11 * s).fill();
  doc.fillColor("#ffffff");
  doc.rect(x + 21 * s, y + 17 * s, 2.4 * s, 2.8 * s).fill();
  doc.restore();
}

doc.y = 190;
drawMark(PAGE.margins.left, doc.y, 1.5);
doc.y += 74;

doc.fillColor(INK).font("Helvetica-Bold").fontSize(34).text(META.title, { width });
doc.moveDown(0.5);
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(13)
  .text(META.subtitle, { width: width * 0.82, lineGap: 3 });

doc.moveDown(2.2);
doc
  .strokeColor(RULE)
  .lineWidth(1)
  .moveTo(PAGE.margins.left, doc.y)
  .lineTo(PAGE.margins.left + 120, doc.y)
  .stroke();
doc.moveDown(1.2);

doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(9.5)
  .text(`${META.version}  ·  ${META.date}`, { width, characterSpacing: 0.6 });

doc.moveDown(0.6);
doc
  .fillColor(MUTED)
  .fontSize(9)
  .text("Robinhood Chain · chain 4663 · price data by Chainlink", { width });

// Cover footnote sits at the bottom of the page.
doc.y = doc.page.height - PAGE.margins.bottom - 44;
doc
  .fillColor(MUTED)
  .fontSize(8)
  .text(
    "This document describes a game and its design. It is not an offer to sell, or a solicitation to buy, any security or financial instrument, and it is not investment advice.",
    { width: width * 0.8, lineGap: 2 }
  );

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

doc.addPage();
bodyPages.push(doc.bufferedPageRange().count - 1);

for (const block of SECTIONS) {
  switch (block.type) {
    case "h2": {
      needsRoom(74);
      doc.moveDown(1.3);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(block.text, { width });
      doc.moveDown(0.15);
      doc
        .strokeColor(RULE)
        .lineWidth(0.8)
        .moveTo(PAGE.margins.left, doc.y)
        .lineTo(PAGE.margins.left + width, doc.y)
        .stroke();
      doc.moveDown(0.7);
      break;
    }

    case "h3": {
      needsRoom(54);
      doc.moveDown(0.85);
      doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10.5).text(block.text, { width });
      doc.moveDown(0.35);
      break;
    }

    case "p": {
      doc
        .fillColor(INK)
        .font("Helvetica")
        .fontSize(10)
        .text(block.text, { width, align: "justify", lineGap: 2.6 });
      doc.moveDown(0.7);
      break;
    }

    case "ul": {
      for (const item of block.items) {
        needsRoom(34);
        const y = doc.y;
        doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10).text("—", PAGE.margins.left, y, {
          width: 14,
        });
        doc.fillColor(INK).font("Helvetica").fontSize(10).text(item, PAGE.margins.left + 16, y, {
          width: width - 16,
          align: "justify",
          lineGap: 2.4,
        });
        doc.moveDown(0.55);
      }
      doc.moveDown(0.3);
      break;
    }

    case "table": {
      const colA = width * 0.42;
      const colB = width - colA - 14;
      for (const [left, right] of block.rows) {
        // Measure first so a row never straddles a page break.
        const h = Math.max(
          doc.heightOfString(left, { width: colA, lineGap: 1.5 }),
          doc.heightOfString(right, { width: colB, lineGap: 1.5 })
        );
        needsRoom(h + 16);

        const y = doc.y;
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(left, PAGE.margins.left, y, {
          width: colA,
          lineGap: 1.5,
        });
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(9)
          .text(right, PAGE.margins.left + colA + 14, y, { width: colB, lineGap: 1.5 });

        doc.y = y + h + 7;
        doc
          .strokeColor(RULE)
          .lineWidth(0.5)
          .moveTo(PAGE.margins.left, doc.y)
          .lineTo(PAGE.margins.left + width, doc.y)
          .stroke();
        doc.moveDown(0.45);
      }
      doc.moveDown(0.6);
      break;
    }

    case "disclaimer": {
      needsRoom(90);
      doc.moveDown(1.4);
      doc
        .strokeColor(RULE)
        .lineWidth(0.8)
        .moveTo(PAGE.margins.left, doc.y)
        .lineTo(PAGE.margins.left + width, doc.y)
        .stroke();
      doc.moveDown(0.8);
      doc
        .fillColor(MUTED)
        .font("Helvetica-Oblique")
        .fontSize(8.5)
        .text(block.text, { width, align: "justify", lineGap: 2 });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Page numbers — stamped after layout, when the count is final.
// ---------------------------------------------------------------------------

const range = doc.bufferedPageRange();
for (let i = range.start + 1; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8)
    .text(
      `${META.title} · ${META.version}`,
      PAGE.margins.left,
      doc.page.height - PAGE.margins.bottom + 26,
      { width: width / 2, lineBreak: false }
    );
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .text(String(i), PAGE.margins.left + width / 2, doc.page.height - PAGE.margins.bottom + 26, {
      width: width / 2,
      align: "right",
      lineBreak: false,
    });
}

doc.end();

console.log(`whitepaper → ${OUT}`);
console.log(`pages: ${range.count}`);
