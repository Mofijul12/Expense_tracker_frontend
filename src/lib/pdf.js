/**
 * Expense exports as a PDF report.
 *
 * jsPDF and the autotable plugin are pulled in dynamically so the ~400kB of
 * PDF machinery only reaches a visitor who actually exports something, rather
 * than riding along in the main bundle for everyone.
 */

/**
 * jsPDF's built-in fonts use WinAnsi, which is Latin-1 plus a handful of
 * typographic characters sitting above U+00FF — the dashes, curly quotes and
 * ellipsis below all encode correctly, verified against the emitted bytes, so
 * they are left alone rather than flattened to ASCII.
 */
const WINANSI_EXTRA = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž',
  '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ',
]);

/**
 * The real minus sign is *not* in WinAnsi, and formatMoney emits it, so it has
 * to come down to a hyphen.
 */
const SUBSTITUTIONS = { '−': '-' };

/**
 * Anything the font genuinely cannot draw — the taka sign, Bengali script —
 * becomes "?" and is reported, which is ugly but at least truthful; rendering
 * those needs an embedded Unicode font.
 */
function sanitize(value, report) {
  let out = '';
  for (const ch of String(value ?? '')) {
    if (SUBSTITUTIONS[ch]) {
      out += SUBSTITUTIONS[ch];
    } else if (ch.codePointAt(0) <= 0xff || WINANSI_EXTRA.has(ch)) {
      out += ch;
    } else {
      out += '?';
      report.dropped = true;
    }
  }
  return out;
}

/**
 * What to label amounts with.
 *
 * The currency symbol is usually outside the built-in font's range — the
 * default here is the Bengali taka sign, which would print as garbage — so the
 * three-letter code is used instead.
 */
function amountUnit(settings) {
  const code = settings?.currencyCode?.trim();
  if (code) return code;
  const symbol = settings?.currencySymbol ?? '';
  return [...symbol].every((c) => c.codePointAt(0) <= 0xff) ? symbol : '';
}

const money = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

// Shared by the table styles and the swatch placement so the two stay aligned.
const CELL_PAD = 7;

// Report palette. INK carries the headings and rules; SERIES colours the
// categories and is shared by the tiles, the pie, the legend and the table
// swatches so one category reads as one colour throughout.
const INK = [46, 58, 89];
const MUTED = [99, 114, 140];
const RULE = [214, 219, 228];
const GOLD = [178, 128, 44];
const SERIES = [
  [74, 111, 165],
  [176, 125, 43],
  [108, 91, 145],
  [78, 138, 107],
  [150, 100, 110],
  [90, 120, 140],
];

/** Group rows by category, largest spend first — the order everything uses. */
function summarise(rows, report) {
  const byName = new Map();
  for (const r of rows) {
    const name = sanitize(r.category?.name || 'Uncategorized', report);
    byName.set(name, (byName.get(name) || 0) + (Number(r.amount) || 0));
  }
  const items = [...byName.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = items.reduce((sum, c) => sum + c.amount, 0);
  items.forEach((c, i) => {
    c.color = SERIES[i % SERIES.length];
    c.pct = total > 0 ? (c.amount / total) * 100 : 0;
  });
  return { items, total };
}

/** A run of text where some segments are bold, laid out left to right. */
function richText(doc, x, y, parts, size) {
  let cursor = x;
  for (const part of parts) {
    doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(part.bold ? INK : MUTED));
    doc.text(part.text, cursor, y);
    cursor += doc.getTextWidth(part.text);
  }
}

/**
 * One pie sector, approximated as a polygon.
 *
 * jsPDF has no arc primitive, so the curve is walked in small steps — fine
 * enough at print resolution that the edge reads as smooth.
 */
function pieSlice(doc, cx, cy, r, from, to, color) {
  const steps = Math.max(2, Math.ceil(((to - from) / (Math.PI * 2)) * 72));
  const points = [[cx, cy]];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const deltas = [];
  for (let i = 1; i < points.length; i++) {
    deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
  }
  doc.setFillColor(...color);
  doc.lines(deltas, points[0][0], points[0][1], [1, 1], 'F', true);
}

/**
 * Render rows into a report.
 *
 * Returns the blob plus a `dropped` flag, so the caller can tell the user when
 * characters could not be represented instead of letting them discover a page
 * of question marks after downloading.
 */
export async function buildExpensesPdf({ rows = [], settings, subtitle, filename }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const report = { dropped: false };
  const unit = sanitize(amountUnit(settings), report);
  const withUnit = (n) => (unit ? `${money(n)} ${unit}` : money(n));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const right = pageW - margin;
  const period = sanitize(subtitle, report);
  const { items, total } = summarise(rows, report);

  // ── header ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text('EXPENSE REPORT', margin, 58);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Prepared for personal records', right, 52, { align: 'right' });

  doc.setFontSize(10);
  doc.text(period, margin, 76);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...GOLD);
  doc.text('CONFIDENTIAL', right, 70, { align: 'right' });

  doc.setDrawColor(...INK);
  doc.setLineWidth(1.2);
  doc.line(margin, 88, right, 88);

  // ── one-line summary ────────────────────────────────────────────────
  const txns = `${rows.length} recorded transaction${rows.length === 1 ? '' : 's'}`;
  const cats = `${items.length} categor${items.length === 1 ? 'y' : 'ies'}`;
  richText(
    doc,
    margin,
    110,
    [
      { text: 'This report summarizes ' },
      { text: txns, bold: true },
      { text: ` for ${period}, totaling ` },
      { text: withUnit(total), bold: true },
      { text: ' across ' },
      { text: cats, bold: true },
      { text: '.' },
    ],
    9
  );

  // ── figure tiles ────────────────────────────────────────────────────
  const tiles = [
    { label: 'TOTAL SPENT', amount: total, color: INK },
    ...items.slice(0, 4).map((c) => ({ label: c.name.toUpperCase(), amount: c.amount, color: c.color })),
  ];
  const tileTop = 128;
  const tileW = (right - margin) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = margin + i * tileW;
    if (i > 0) {
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.5);
      doc.line(x - 10, tileTop, x - 10, tileTop + 58);
    }
    doc.setFillColor(...tile.color);
    doc.rect(x, tileTop, 22, 3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...INK);
    doc.text(money(tile.amount), x, tileTop + 30);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    if (unit) doc.text(unit, x, tileTop + 42);
    // Long category names would run under the neighbouring tile.
    doc.text(doc.splitTextToSize(tile.label, tileW - 14)[0], x, tileTop + 52);
  });

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(margin, tileTop + 70, right, tileTop + 70);

  // ── pie and legend ──────────────────────────────────────────────────
  const pieCx = margin + 72;
  const pieCy = tileTop + 150;
  const pieR = 58;
  let angle = -Math.PI / 2; // start at twelve o'clock
  for (const c of items) {
    const sweep = total > 0 ? (c.amount / total) * Math.PI * 2 : 0;
    if (sweep > 0) pieSlice(doc, pieCx, pieCy, pieR, angle, angle + sweep, c.color);
    angle += sweep;
  }

  const legendX = margin + 190;
  let legendY = tileTop + 96;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('SHARE OF SPEND', legendX, legendY);
  legendY += 16;

  for (const c of items.slice(0, 8)) {
    doc.setFillColor(...c.color);
    doc.rect(legendX, legendY - 6, 7, 7, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(c.name, 150)[0], legendX + 13, legendY);
    doc.setTextColor(...MUTED);
    doc.text(withUnit(c.amount), right - 46, legendY, { align: 'right' });
    doc.text(`${Math.round(c.pct)}%`, right, legendY, { align: 'right' });
    legendY += 17;
  }

  // ── transaction table ───────────────────────────────────────────────
  const detailTop = Math.max(pieCy + pieR, legendY) + 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text('TRANSACTION DETAIL', margin, detailTop);

  const colorFor = new Map(items.map((c) => [c.name, c.color]));

  autoTable(doc, {
    startY: detailTop + 14,
    margin: { top: 56, left: margin, right: margin, bottom: 52 },
    theme: 'plain',
    head: [['Date', 'Category', 'Description', 'Amount']],
    body: rows.map((r) => [
      isoDate(r.date),
      sanitize(r.category?.name || 'Uncategorized', report),
      sanitize(r.note || '—', report),
      withUnit(r.amount),
    ]),
    foot: [['', '', 'TOTAL', withUnit(total)]],
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: CELL_PAD,
      textColor: INK,
      overflow: 'linebreak',
    },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: INK },
    footStyles: { fontStyle: 'bold', fontSize: 9, textColor: INK },
    // The description is the only column that can run long, so it absorbs the
    // leftover width while the rest stay at a size their content needs.
    columnStyles: {
      0: { cellWidth: 72, textColor: MUTED },
      1: { cellWidth: 96, cellPadding: { top: CELL_PAD, bottom: CELL_PAD, left: 16, right: CELL_PAD } },
      2: { cellWidth: 'auto', textColor: MUTED },
      3: { cellWidth: 78, halign: 'right', fontStyle: 'bold' },
    },
    didDrawCell: (data) => {
      const { cell, row, column, table } = data;
      // Rules run the full table width, so draw once per row off column 0
      // rather than per cell, which would stitch visible seams at the joins.
      if (column.index === 0 && (data.section === 'head' || data.section === 'body')) {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(data.section === 'head' ? 0.8 : 0.5);
        const y = cell.y + cell.height;
        doc.line(table.settings.margin.left, y, right, y);
        if (data.section === 'head') doc.line(table.settings.margin.left, cell.y, right, cell.y);
      }
      if (data.section === 'foot' && column.index === 0) {
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.8);
        doc.line(table.settings.margin.left, cell.y, right, cell.y);
      }
      // The category swatch sits in the padding reserved on that column.
      if (data.section === 'body' && column.index === 1) {
        const color = colorFor.get(row.raw[1]) || MUTED;
        doc.setFillColor(...color);
        // Pinned to the first line, not the cell's middle: a row whose
        // description wraps is tall, and centring would leave the swatch
        // floating well below the category name it belongs to.
        doc.rect(cell.x + CELL_PAD, cell.y + CELL_PAD + 2, 6, 6, 'F');
      }
    },
    didDrawPage: () => {
      const { pageSize } = doc.internal;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(`Generated ${isoDate(Date.now())} · Ledgerline`, margin, pageSize.getHeight() - 30);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, right, pageSize.getHeight() - 30, {
        align: 'right',
      });
    },
  });

  return { blob: doc.output('blob'), filename, dropped: report.dropped };
}
