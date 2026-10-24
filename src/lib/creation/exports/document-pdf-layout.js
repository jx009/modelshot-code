const fail = code => { throw new Error(`EXPORT_DOCUMENT_PDF_${code}`); };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// CJK may wrap between characters; other scripts prefer whole words. Oversized
// words use grapheme boundaries, never UTF-16 code units or combining marks.
const tokens = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|\s+/gu;

export function layoutDocumentPdf(model, measure) {
  const { page } = model, width = page.width - page.left - page.right;
  let work = 0;
  const count = () => { if (++work > 200000) fail("LIMIT"); };
  function paragraphLines(block, available, imageHeight) {
    const output = []; let line, first = true;
    function reset() {
      const indent = block.left + (first ? block.first : 0);
      line = { type: "line", parts: [], width: 0, height: block.style.size * block.lineHeight, indent, available: available - indent - block.right, align: block.align };
      if (indent < 0 || line.available < 10) fail("UNSUPPORTED");
    }
    function flush(final = false) { line.last = final; output.push(line); first = false; reset(); }
    reset();
    function add(part) {
      count();
      if (line.parts.length && line.width + part.width > line.available + .01) flush();
      // A hanging first line can be wider than subsequent lines. Recheck
      // after flushing rather than placing a token measured for the old line.
      if (part.width > line.available + .01) {
        if (part.type !== "text" || [...graphemes.segment(part.text)].length < 2) fail("CONTENT_TOO_WIDE");
        for (const { segment } of graphemes.segment(part.text)) add({ ...part, text: segment, width: measure(segment, part.style) });
        return;
      }
      line.parts.push(part); line.width += part.width; line.height = Math.max(line.height, part.height);
    }
    for (const child of block.children) {
      if (child.type === "break") { if (line.parts.length) flush(true); output.push({ type: "break" }); continue; }
      if (child.type === "image") {
        const scale = Math.min(1, Math.min(line.available, available - block.left - block.right) / child.width, imageHeight / child.height);
        add({ ...child, width: child.width * scale, height: child.height * scale }); continue;
      }
      const style = child.style, height = style.size * block.lineHeight;
      if (child.type === "field") { add({ ...child, width: measure(child.field === "PAGE" ? String(page.numberStart + 99) : "100", style), height }); continue; }
      if (child.type === "tab") {
        const stop = model.tabStop, size = stop - line.width % stop;
        if (line.width + size > line.available) flush(); else add({ type: "text", text: "", style, width: size, height });
        continue;
      }
      for (const token of child.text.matchAll(tokens)) {
        const text = token[0], measured = measure(text, style);
        if (measured <= line.available) { add({ type: "text", text, style, width: measured, height }); continue; }
        for (const { segment } of graphemes.segment(text)) add({ type: "text", text: segment, style, width: measure(segment, style), height });
      }
    }
    if (line.parts.length || !output.length) flush(true);
    else if (output.at(-1)?.type === "line") output.at(-1).last = true;
    return output;
  }
  function unpaged(blocks, available, imageHeight) {
    let y = 0; const commands = [];
    for (const block of blocks) {
      if (block.type !== "paragraph" || block.breakBefore) fail("UNSUPPORTED");
      y += block.before;
      for (const line of paragraphLines(block, available, imageHeight)) {
        if (line.type === "break") fail("UNSUPPORTED");
        commands.push({ ...line, x: 0, y }); y += line.height;
      }
      y += block.after;
    }
    return { commands, height: y };
  }
  const header = unpaged(model.header, width, 0), footer = unpaged(model.footer, width, 0);
  const top = Math.max(page.top, header.height ? page.header + header.height + 6 : 0);
  const bottom = page.height - Math.max(page.bottom, footer.height ? page.footer + footer.height + 6 : 0), capacity = bottom - top;
  if (capacity < 36) fail("MARGINS_TOO_LARGE");
  const pages = []; let current, y;
  function newPage() {
    if (pages.length >= 100) fail("TOO_MANY_PAGES");
    current = { width: page.width, height: page.height, commands: [] }; pages.push(current); y = top;
  }
  function place(line, x, at) { current.commands.push({ ...line, x, y: at }); }
  function ensure(height) {
    if (height > capacity + .01) fail("ROW_TOO_TALL");
    if (y + height > bottom + .01) newPage();
  }
  newPage();
  for (let index = 0; index < model.blocks.length; index++) {
    const block = model.blocks[index];
    if (block.type === "paragraph") {
      const lines = paragraphLines(block, width, capacity), total = lines.reduce((sum, line) => sum + (line.height || 0), 0);
      if (block.breakBefore && y > top) newPage();
      const firstHeight = lines.find(line => line.type === "line")?.height || 0;
      const next = model.blocks[index + 1], nextHeight = block.keepNext && next?.type === "paragraph" ? next.before + next.style.size * next.lineHeight : 0;
      const required = block.before + (block.keepLines && total <= capacity ? total : firstHeight) + nextHeight;
      if (required <= capacity && y > top && y + required > bottom) newPage();
      if (block.before + firstHeight <= capacity) { ensure(block.before + firstHeight); y += block.before; }
      for (const line of lines) {
        if (line.type === "break") { newPage(); continue; }
        ensure(line.height); place(line, page.left, y); y += line.height;
      }
      y = Math.min(bottom, y + block.after);
      continue;
    }
    const sum = block.widths.reduce((total, value) => total + value, 0), scale = Math.min(1, width / sum), widths = block.widths.map(w => w * scale);
    const rows = block.rows.map(row => {
      const cells = row.cells.map((cell, c) => {
        const available = widths[c] - cell.left - cell.right;
        if (available < 10) fail("CONTENT_TOO_WIDE");
        return { ...cell, ...unpaged(cell.children, available, capacity - cell.top - cell.bottom) };
      });
      return { ...row, cells, height: Math.max(row.minHeight, ...cells.map(cell => cell.height + cell.top + cell.bottom)) };
    });
    const headers = rows.filter(row => row.header), headerHeight = headers.reduce((sum, row) => sum + row.height, 0);
    function drawRow(row) {
      let x = page.left;
      for (const [c, cell] of row.cells.entries()) {
        current.commands.push({ type: "cell", x, y, width: widths[c], height: row.height, background: cell.background, borders: cell.borders });
        const spare = row.height - cell.top - cell.bottom - cell.height;
        const offset = cell.vertical === 3 ? spare / 2 : cell.vertical === 4 ? spare : 0;
        for (const command of cell.commands) place(command, x + cell.left, y + cell.top + offset + command.y);
        x += widths[c];
      }
      y += row.height;
    }
    if (headerHeight + (rows.find(row => !row.header)?.height || 0) > capacity + .01) fail("ROW_TOO_TALL");
    if (y > top && y + headerHeight + (rows.find(row => !row.header)?.height || 0) > bottom) newPage();
    for (const row of rows) {
      if (row.height > capacity || !row.header && row.height + headerHeight > capacity) fail("ROW_TOO_TALL");
      if (y + row.height > bottom) { newPage(); if (!row.header) for (const h of headers) drawRow(h); }
      drawRow(row);
    }
  }
  // Page fields resolve after pagination. Their reserved width prevents a
  // total-page-number change from causing a second, potentially unstable pass.
  for (const p of pages) {
    for (const command of header.commands) p.commands.push({ ...command, x: page.left, y: page.header + command.y });
    for (const command of footer.commands) p.commands.push({ ...command, x: page.left, y: page.height - page.footer - footer.height + command.y });
  }
  return pages;
}
