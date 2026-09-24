// توابع آماده Pine — همه به‌صورت برداری روی آرایه‌ها

export const PALETTE = {
  red: '#F23645', green: '#089981', blue: '#2962FF', orange: '#FF9800',
  purple: '#9C27B0', gray: '#787B86', silver: '#B2B5BE', white: '#FFFFFF',
  black: '#363A45', yellow: '#FFEB3B', lime: '#00E676', teal: '#26A69A',
  aqua: '#00BCD4', fuchsia: '#E040FB', maroon: '#880E4F', navy: '#311B92',
  olive: '#808000'
};

export const isSeries = (v) => Array.isArray(v);
export const isNa = (v) => typeof v === 'number' && isNaN(v);

export function toSeries (v, n) {
  if (isSeries(v)) return v;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

// اعمال تابع دوگانه با پخش (broadcast) اسکالر/سری
export function zip (a, b, fn) {
  if (isSeries(a) || isSeries(b)) {
    const n = isSeries(a) ? a.length : b.length;
    const A = toSeries(a, n), B = toSeries(b, n);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = fn(A[i], B[i]);
    return out;
  }
  return fn(a, b);
}

export function mapS (v, fn) {
  if (isSeries(v)) return v.map(fn);
  return fn(v);
}

function shift (arr, k, fill = NaN) {
  if (!isSeries(arr)) return k === 0 ? arr : fill;
  const out = new Array(arr.length).fill(fill);
  for (let i = k; i < arr.length; i++) out[i] = arr[i - k];
  return out;
}

function nanArr (n) { return new Array(n).fill(NaN); }

// ---------- ta ----------

export const ta = {
  sma (src, len) {
    return rolling(src, len, (win) => {
      let s = 0;
      for (const v of win) s += v;
      return s / win.length;
    });
  },

  ema (src, len) {
    if (!isSeries(src)) return src;
    const n = src.length;
    const out = nanArr(n);
    const k = 2 / (len + 1);
    let prev = NaN, sum = 0, seen = 0, seeded = false;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (typeof v !== 'number' || isNaN(v)) continue;
      if (!seeded) {
        sum += v; seen++;
        if (seen === len) { prev = sum / len; out[i] = prev; seeded = true; }
        continue;
      }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  },

  wma (src, len) {
    return rolling(src, len, (win) => {
      let s = 0, wsum = 0;
      for (let i = 0; i < win.length; i++) {
        const w = win.length - i;
        s += win[i] * w; wsum += w;
      }
      return s / wsum;
    });
  },

  hma (src, len) {
    const half = Math.max(1, Math.round(len / 2));
    const sq = Math.max(1, Math.round(Math.sqrt(len)));
    const w1 = ta.wma(src, half);
    const w2 = ta.wma(src, len);
    const diff = zip(w1, w2, (a, b) => 2 * a - b);
    return ta.wma(diff, sq);
  },

  rma (src, len) {
    if (!isSeries(src)) return src;
    const n = src.length;
    const out = nanArr(n);
    let prev = NaN, sum = 0, seen = 0, seeded = false;
    const alpha = 1 / len;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (typeof v !== 'number' || isNaN(v)) continue;
      if (!seeded) {
        sum += v; seen++;
        if (seen === len) { prev = sum / len; out[i] = prev; seeded = true; }
        continue;
      }
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  },

  vwma (src, len, volume) {
    const pv = zip(src, volume, (a, b) => a * b);
    const vs = ta.sma(volume, len);
    const ps = ta.sma(pv, len);
    return zip(ps, vs, (a, b) => a / b);
  },

  tr (candles, handleNa = false) {
    const n = candles.length;
    const out = nanArr(n);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (i === 0) { out[i] = handleNa ? c.high - c.low : c.high - c.low; continue; }
      const pc = candles[i - 1].close;
      out[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    }
    return out;
  },

  atr (candles, len) {
    return ta.rma(ta.tr(candles), len);
  },

  rsi (src, len) {
    if (!isSeries(src)) return src;
    const n = src.length;
    const gains = nanArr(n), losses = nanArr(n);
    gains[0] = 0; losses[0] = 0;
    for (let i = 1; i < n; i++) {
      const ch = src[i] - src[i - 1];
      gains[i] = Math.max(ch, 0);
      losses[i] = Math.max(-ch, 0);
    }
    const ag = ta.rma(gains, len);
    const al = ta.rma(losses, len);
    return zip(ag, al, (g, l) => {
      if (isNaN(g) || isNaN(l)) return NaN;
      if (l === 0) return 100;
      if (g === 0) return 0;
      return 100 - 100 / (1 + g / l);
    });
  },

  stdev (src, len) {
    return rolling(src, len, (win) => {
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      let s2 = 0;
      for (const v of win) s2 += (v - m) * (v - m);
      return Math.sqrt(s2 / win.length);
    });
  },

  dev (src, len) {
    return rolling(src, len, (win) => {
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      let s2 = 0;
      for (const v of win) s2 += Math.abs(v - m);
      return s2 / win.length;
    });
  },

  variance (src, len) {
    return rolling(src, len, (win) => {
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      let s2 = 0;
      for (const v of win) s2 += (v - m) * (v - m);
      return s2 / win.length;
    });
  },

  highest (src, len) {
    return rolling(src, len, (win) => Math.max(...win));
  },

  lowest (src, len) {
    return rolling(src, len, (win) => Math.min(...win));
  },

  change (src, len = 1) {
    return zip(src, shift(src, len), (a, b) => a - b);
  },

  mom (src, len) {
    return zip(src, shift(src, len), (a, b) => a - b);
  },

  roc (src, len) {
    return zip(src, shift(src, len), (a, b) => 100 * (a - b) / b);
  },

  cum (src) {
    if (!isSeries(src)) return src;
    let s = 0;
    return src.map(v => { s += v; return s; });
  },

  macd (src, fast, slow, signal) {
    const fastMa = ta.ema(src, fast);
    const slowMa = ta.ema(src, slow);
    const macdLine = zip(fastMa, slowMa, (a, b) => a - b);
    const signalLine = ta.ema(macdLine, signal);
    const hist = zip(macdLine, signalLine, (a, b) => a - b);
    return [macdLine, signalLine, hist];
  },

  crossover: null, // در ادامه تعریف می‌شود
  crossunder: null,

  cross (a, b) {
    const up = ta.crossover(a, b);
    const down = ta.crossover(b, a);
    return zip(up, down, (x, y) => x || y);
  },

  rising (src, len) {
    const prev = shift(src, len);
    return zip(src, prev, (a, b) => a > b);
  },

  falling (src, len) {
    const prev = shift(src, len);
    return zip(src, prev, (a, b) => a < b);
  },

  barssince (cond) {
    if (!isSeries(cond)) return cond;
    let last = -1;
    return cond.map((c, i) => {
      if (c) last = i;
      return last < 0 ? NaN : i - last;
    });
  },

  valuewhen (cond, src, occurrence = 0) {
    if (!isSeries(cond)) return src;
    const n = cond.length;
    const out = nanArr(n);
    const hits = [];
    for (let i = 0; i < n; i++) {
      if (cond[i]) hits.push(src[i]);
      out[i] = hits.length > occurrence ? hits[hits.length - 1 - occurrence] : NaN;
    }
    return out;
  },

  vwap (candles) {
    let pv = 0, v = 0;
    return candles.map(c => {
      const tp = (c.high + c.low + c.close) / 3;
      pv += tp * c.volume;
      v += c.volume || 1;
      return pv / v;
    });
  }
};

// crossover واقعی — جدا نوشته شد تا ایندکس داشته باشد
ta.crossover = function (a, b) {
  if (!isSeries(a) && !isSeries(b)) return false;
  const n = isSeries(a) ? a.length : b.length;
  const A = toSeries(a, n), B = toSeries(b, n);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) { out[i] = false; continue; }
    out[i] = A[i - 1] <= B[i - 1] && A[i] > B[i];
  }
  return out;
};
ta.crossunder = function (a, b) { return ta.crossover(b, a); };

function rolling (src, len, fn) {
  if (!isSeries(src)) return src;
  const n = src.length;
  const out = nanArr(n);
  for (let i = len - 1; i < n; i++) {
    let ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      if (isNaN(src[j])) { ok = false; break; }
    }
    if (!ok) continue;
    out[i] = fn(src.slice(i - len + 1, i + 1));
  }
  return out;
}

// ---------- math ----------

export const math = {
  abs: (v) => mapS(v, Math.abs),
  sqrt: (v) => mapS(v, Math.sqrt),
  pow: (a, b) => zip(a, b, Math.pow),
  exp: (v) => mapS(v, Math.exp),
  log: (v) => mapS(v, Math.log),
  log10: (v) => mapS(v, Math.log10),
  sign: (v) => mapS(v, Math.sign),
  floor: (v) => mapS(v, Math.floor),
  ceil: (v) => mapS(v, Math.ceil),
  round: (v, p) => p == null
    ? mapS(v, Math.round)
    : mapS(v, (x) => Math.round(x * Math.pow(10, p)) / Math.pow(10, p)),
  max: (...args) => zipAll(args, (...vals) => Math.max(...vals)),
  min: (...args) => zipAll(args, (...vals) => Math.min(...vals)),
  avg: (...args) => zipAll(args, (...vals) => vals.reduce((s, v) => s + v, 0) / vals.length),
  sum: (...args) => zipAll(args, (...vals) => vals.reduce((s, v) => s + v, 0)),
  pi: Math.PI,
  e: Math.E
};

function zipAll (args, fn) {
  const s = args.find(isSeries);
  if (!s) return fn(...args);
  const n = s.length;
  const A = args.map(a => toSeries(a, n));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const vals = A.map(a => a[i]);
    out[i] = vals.some(isNaN) ? NaN : fn(...vals);
  }
  return out;
}

// ---------- رنگ ----------

export function colorNew (color, transp = 0) {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  let r = 0, g = 0, b = 0;
  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  const a = Math.max(0, Math.min(1, 1 - transp / 100));
  return `rgba(${r},${g},${b},${a})`;
}
