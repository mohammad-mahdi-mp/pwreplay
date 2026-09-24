// پارسر CSV با تشخیص خودکار جداکننده، ستون‌ها و فرمت زمان

const COL_ALIASES = {
  time: ['time', 'date', 'datetime', 'timestamp', 'ts', 'زمان', 'تاریخ', 'local time', 'gmt time', 'utc', 'open_time'],
  open: ['open', 'o', 'باز', 'باز شدن'],
  high: ['high', 'h', 'max', 'بیشترین', 'سقف'],
  low: ['low', 'l', 'min', 'کمترین', 'کف'],
  close: ['close', 'c', 'adj close', 'بسته', 'بسته شدن'],
  volume: ['volume', 'vol', 'v', 'tickvol', 'tick volume', 'حجم', 'turnover']
};

export function sniffDelimiter (text) {
  const sample = text.slice(0, 4000);
  const lines = sample.split(/\r?\n/).slice(0, 20);
  const candidates = [',', ';', '\t', '|'];
  let best = { d: ',', score: 0 };
  for (const d of candidates) {
    const counts = lines.filter(l => l.trim()).map(l => countOutsideQuotes(l, d));
    if (!counts.length) continue;
    const first = counts[0];
    const consistent = counts.filter(c => c === first).length / counts.length;
    const score = first * consistent;
    if (first > 0 && score > best.score) best = { d, score };
  }
  return best.d;
}

function countOutsideQuotes (line, delim) {
  let inQ = false, count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === delim) count++;
  }
  return count;
}

export function splitLine (line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (!inQ && ch === delim) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseNumber (s) {
  if (s == null) return NaN;
  s = String(s).replace(/[\s"']/g, '');
  if (!s) return NaN;
  // فرمت اروپایی: 1.234,56
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

export function parseTimeCell (s, unit) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/["']/g, '');
  if (!s) return NaN;

  if (unit === 'text' || /[a-zA-Z\u0600-\u06FF]/.test(s) || /[-/:.]/.test(s)) {
    if (unit !== 'text') {
      const t = parseDateTimeText(s);
      if (!isNaN(t)) return t;
      if (unit) return NaN;
    } else {
      const t = parseDateTimeText(s);
      return t;
    }
  }

  const n = Number(s);
  if (isNaN(n)) return NaN;
  if (unit === 's') return n * 1000;
  if (unit === 'ms') return n;
  // auto: طول عدد
  if (n > 1e14) return n / 1000;       // میکروثانیه
  if (n > 1e11) return n;              // میلی‌ثانیه
  if (n > 1e8) return n * 1000;        // ثانیه
  // عدد کوچک مثل 20240115 → تاریخ فشرده؟ نپذیر
  return NaN;
}

function parseDateTimeText (s) {
  s = s.replace('T', ' ').trim();
  // 2024.01.05 14:00 / 2024-01-05 14:00:00 / 2024/01/05
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  // 05.01.2024 14:00 / 05-01-2024
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const a = +m[1], b = +m[2];
    // اگر عدد اول > 12 روز است، در غیر این صورت dd/mm فرض کن (رایج در متاتریدر: yyyy.mm.dd بالا هم پوشش داده شد)
    const day = a > 12 ? a : a;
    const month = b > 12 ? a : b;
    const year = b > 12 ? b : +m[3];
    // برای سادگی: اولی روز، دومی ماه مگر ماه > 12
    return new Date(+m[3], month - 1, day, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  const t = Date.parse(s);
  return isNaN(t) ? NaN : t;
}

export function detectMapping (header, rows, unit) {
  const mapping = { time: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 };
  const used = new Set();

  const lower = header.map(h => String(h).toLowerCase().trim());
  for (const key of ['time', 'open', 'high', 'low', 'close', 'volume']) {
    const idx = lower.findIndex((h, i) => !used.has(i) && COL_ALIASES[key].includes(h));
    if (idx >= 0) { mapping[key] = idx; used.add(idx); }
  }

  // fallback بدون هدر: از روی داده حدس بزن
  if (mapping.time < 0 || mapping.close < 0) {
    const sample = rows.slice(0, 30);
    const nCols = Math.max(...sample.map(r => r.length));
    const colScore = [];
    for (let c = 0; c < nCols; c++) {
      if (used.has(c)) { colScore.push(null); continue; }
      let timeLike = 0, numLike = 0;
      for (const r of sample) {
        const v = (r[c] || '').trim();
        if (!v) continue;
        const t = parseTimeCell(v, unit);
        if (!isNaN(t)) timeLike++;
        if (!isNaN(parseNumber(v))) numLike++;
      }
      colScore.push({ timeLike, numLike });
    }
    if (mapping.time < 0) {
      const best = colScore.reduce((bi, s, i) =>
        s && s.timeLike > 0 && (bi === -1 || s.timeLike > colScore[bi].timeLike) ? i : bi, -1);
      if (best >= 0) { mapping.time = best; used.add(best); }
    }
    // ستون‌های OHLC: از بین ستون‌های عددی، به‌ترتیب high>=low, open/close نزدیک به هم
    if (mapping.close < 0) {
      const numCols = colScore.map((s, i) => ({ s, i })).filter(x => x.s && x.s.numLike > sample.length * 0.8 && !used.has(x.i));
      if (numCols.length >= 4) {
        // فرض رایج: ترتیب open,high,low,close
        const [o, h, l, c] = numCols.slice(0, 4);
        mapping.open = o.i; mapping.high = h.i; mapping.low = l.i; mapping.close = c.i;
        if (mapping.volume < 0 && numCols[4]) mapping.volume = numCols[4].i;
      }
    }
  }
  return mapping;
}

export function parseCsv (text, opts = {}) {
  const errors = [];
  if (!text || !text.trim()) return { ok: false, errors: ['فایل خالی است'] };

  const delim = opts.delimiter === 'auto' || !opts.delimiter ? sniffDelimiter(text) : (opts.delimiter === '\\t' ? '\t' : opts.delimiter);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { ok: false, errors: ['حداقل دو ردیف لازم است'], delimiter: delim };

  const hasHeader = opts.hasHeader !== false;
  const headerRow = splitLine(lines[0], delim);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const sampleRows = dataLines.slice(0, 50).map(l => splitLine(l, delim));
  let mapping = opts.mapping;
  if (!mapping) {
    const headerForDetect = hasHeader ? headerRow : headerRow.map((_, i) => `col${i}`);
    mapping = detectMapping(headerForDetect, sampleRows, opts.timeUnit);
  }

  const { time: ti, open: oi, high: hi, low: li, close: ci, volume: vi } = mapping;
  if (ti < 0) errors.push('ستون زمان شناسایی نشد — نگاشت دستی را تنظیم کنید');
  if (oi < 0 || hi < 0 || li < 0 || ci < 0) errors.push('ستون‌های OHLC کامل شناسایی نشدند — نگاشت دستی را تنظیم کنید');
  if (errors.length) return { ok: false, errors, delimiter: delim, header: headerRow, mapping, preview: sampleRows.slice(0, 5) };

  const candles = [];
  let skipped = 0;
  for (const line of dataLines) {
    const cells = splitLine(line, delim);
    const ts = parseTimeCell(cells[ti], opts.timeUnit);
    const o = parseNumber(cells[oi]);
    const h = parseNumber(cells[hi]);
    const l = parseNumber(cells[li]);
    const c = parseNumber(cells[ci]);
    if ([ts, o, h, l, c].some(isNaN)) { skipped++; continue; }
    const v = vi >= 0 ? parseNumber(cells[vi]) : 0;
    candles.push({ timestamp: ts, open: o, high: Math.max(h, l, o, c), low: Math.min(h, l, o, c), close: c, volume: isNaN(v) ? 0 : v });
  }

  if (candles.length < 2) return { ok: false, errors: ['هیچ کندل معتبری پیدا نشد'], delimiter: delim, header: headerRow, mapping, preview: sampleRows.slice(0, 5) };

  candles.sort((a, b) => a.timestamp - b.timestamp);
  // حذف تکراری‌ها
  const uniq = [candles[0]];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].timestamp !== uniq[uniq.length - 1].timestamp) uniq.push(candles[i]);
  }

  return {
    ok: true,
    candles: uniq,
    delimiter: delim,
    header: headerRow,
    mapping,
    skipped,
    preview: sampleRows.slice(0, 5)
  };
}
