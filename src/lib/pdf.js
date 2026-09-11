/**
 * Expense exports as PDF.
 *
 * jsPDF and the autotable plugin are pulled in dynamically so the ~400kB of
 * PDF machinery only reaches a visitor who actually exports something, rather
 * than riding along in the main bundle for everyone.
 */

/**
 * jsPDF's built-in fonts are WinAnsi only — anything above U+00FF renders as
 * mojibake rather than failing loudly. Typographic punctuation the app emits
 * (the real minus sign in formatMoney, curly quotes, the ellipsis) has an
 * honest ASCII equivalent, so map those; anything left that the font cannot
 * draw becomes "?" and is reported, which is ugly but at least truthful.
 */
const SUBSTITUTIONS = {
  '−': '-', // minus sign
  '–': '-', // en dash
  '—': '-', // em dash
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
};

function sanitize(value, report) {
  let out = '';
  for (const ch of String(value ?? '')) {
    if (SUBSTITUTIONS[ch]) {
      out += SUBSTITUTIONS[ch];
    } else if (ch.codePointAt(0) > 0xff) {
      out += '?';
      report.dropped = true;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * What to label the amount column with.
 *
 * The currency symbol is usually outside the built-in font's range — the
 * default here is the Bengali taka sign, which would print as garbage — so the
 * three-letter code goes in the column header and the cells hold bare numbers.
 * That reads better in a document anyway than repeating a symbol on every row.
 */
function amountUnit(settings) {
  const code = settings?.currencyCode?.trim();
  if (code) return code;
  const symbol = settings?.currencySymbol ?? '';
  return [...symbol].every((c) => c.codePointAt(0) <= 0xff) ? symbol : 'amount';
}

const money = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * Render rows into a PDF.
 *
 * Returns the blob plus a `dropped` flag, so the caller can tell the user when
 * characters could not be represented instead of letting them discover a page
 * of question marks after downloading.
 */
export async function buildExpensesPdf({ rows = [], settings, title, subtitle, filename }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const report = { dropped: false };
  const unit = sanitize(amountUnit(settings), report);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(sanitize(title, report), margin, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(sanitize(subtitle, report), margin, 70);

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const count = `${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}`;
  doc.text(`${count} · ${money(total)} ${unit} total`, margin, 86);

  autoTable(doc, {
    startY: 104,
    margin: { left: margin, right: margin, bottom: 54 },
    head: [['Date', 'Category', 'Note', `Amount (${unit})`]],
    body: rows.map((r) => [
      isoDate(r.date),
      sanitize(r.category?.name || 'Uncategorized', report),
      sanitize(r.note || '', report),
      money(r.amount),
    ]),
    foot: [['', '', 'Total', `${money(total)}`]],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [35, 37, 50], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [244, 244, 248], textColor: 30, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    // The note is the only column that can run long, so it absorbs the leftover
    // width while the rest stay at a size their content actually needs.
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 86 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 76, halign: 'right' },
    },
    didDrawPage: () => {
      const { pageSize } = doc.internal;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Generated ${isoDate(Date.now())} · Ledgerline`,
        margin,
        pageSize.getHeight() - 28
      );
      const page = doc.internal.getNumberOfPages();
      doc.text(`Page ${page}`, pageWidth - margin, pageSize.getHeight() - 28, { align: 'right' });
    },
  });

  return { blob: doc.output('blob'), filename, dropped: report.dropped };
}
