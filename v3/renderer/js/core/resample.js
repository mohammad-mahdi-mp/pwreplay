// ساخت تایم‌فریم بالاتر از داده موجود (مثلاً M1 → M15/H1/H4/D1)
// باکت‌ها بر اساس ساعت محلی تراز می‌شوند، همان مبنایی که پارسر CSV برای زمان‌های متنی استفاده می‌کند

export const TIMEFRAMES = [
  { name: 'M1', ms: 60e3 },
  { name: 'M5', ms: 5 * 60e3 },
  { name: 'M15', ms: 15 * 60e3 },
  { name: 'M30', ms: 30 * 60e3 },
  { name: 'H1', ms: 3600e3 },
  { name: 'H4', ms: 4 * 3600e3 },
  { name: 'D1', ms: 86400e3 },
  { name: 'W1', ms: 7 * 86400e3 },
  { name: 'MN', ms: 30 * 86400e3 }
];

export function tfMs (name) {
  const tf = TIMEFRAMES.find(t => t.name === name);
  return tf ? tf.ms : NaN;
}

// فاصله غالب بین کندل‌ها (میانه) برای تشخیص تایم‌فریم واقعی داده
export function detectSpacing (candles) {
  const diffs = [];
  const n = Math.min(candles.length, 600);
  for (let i = 1; i < n; i++) {
    const d = candles[i].timestamp - candles[i - 1].timestamp;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return NaN;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

export function guessTimeframe (candles) {
  const sp = detectSpacing(candles);
  if (!Number.isFinite(sp)) return null;
  let best = null;
  for (const tf of TIMEFRAMES) {
    if (!best || Math.abs(Math.log(tf.ms / sp)) < Math.abs(Math.log(best.ms / sp))) best = tf;
  }
  return best ? best.name : null;
}

function bucketStart (ts, name, ms) {
  const d = new Date(ts);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (name === 'MN') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (name === 'W1') {
    const mondayOffset = (d.getDay() + 6) % 7; // هفته از دوشنبه
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset);
    return m.getTime();
  }
  if (name === 'D1') return midnight;
  return midnight + Math.floor((ts - midnight) / ms) * ms;
}

export function resample (candles, target) {
  const ms = tfMs(target);
  if (!Number.isFinite(ms)) throw new Error('Unknown timeframe: ' + target);
  const out = [];
  let cur = null;
  let key = null;
  for (const c of candles) {
    const k = bucketStart(c.timestamp, target, ms);
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { timestamp: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume += c.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// فقط تایم‌فریم‌هایی که واقعاً بزرگ‌تر از داده فعلی‌اند
export function higherTimeframes (candles) {
  const sp = detectSpacing(candles);
  if (!Number.isFinite(sp)) return [];
  return TIMEFRAMES.filter(t => t.ms > sp * 1.5);
}
