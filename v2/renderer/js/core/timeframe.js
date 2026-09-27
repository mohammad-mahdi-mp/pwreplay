// سیستم تایم‌فریم‌های چندگانه و بازنمونه‌گیری (Resampling) کندل‌ها

export const TIMEFRAMES = [
  { id: 'M1', label: '1m', ms: 60 * 1000 },
  { id: 'M5', label: '5m', ms: 5 * 60 * 1000 },
  { id: 'M15', label: '15m', ms: 15 * 60 * 1000 },
  { id: 'M30', label: '30m', ms: 30 * 60 * 1000 },
  { id: 'H1', label: '1h', ms: 60 * 60 * 1000 },
  { id: 'H4', label: '4h', ms: 4 * 60 * 60 * 1000 },
  { id: 'D1', label: '1D', ms: 24 * 60 * 60 * 1000 }
];

export function getTfMs (tfId) {
  const norm = String(tfId || '').toUpperCase().trim();
  const found = TIMEFRAMES.find(t => t.id === norm || t.label.toUpperCase() === norm);
  if (found) return found.ms;
  if (norm.startsWith('M')) return Number(norm.slice(1)) * 60 * 1000;
  if (norm.startsWith('H')) return Number(norm.slice(1)) * 3600 * 1000;
  if (norm.startsWith('D')) return Number(norm.slice(1)) * 86400 * 1000;
  return 15 * 60 * 1000; // پیش‌فرض 15 دقیقه
}

export function normalizeTfLabel (tfId) {
  const norm = String(tfId || '').toUpperCase().trim();
  const found = TIMEFRAMES.find(t => t.id === norm || t.label.toUpperCase() === norm);
  return found ? found.label : (tfId || '15m');
}

export function resampleCandles (candles, targetTfId) {
  if (!candles || !candles.length) return [];
  const targetMs = getTfMs(targetTfId);
  if (!targetMs) return candles;

  const buckets = new Map();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const bTime = Math.floor(c.timestamp / targetMs) * targetMs;
    let b = buckets.get(bTime);
    if (!b) {
      b = {
        timestamp: bTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        baseIndices: [i]
      };
      buckets.set(bTime, b);
    } else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume = (b.volume || 0) + (c.volume || 0);
      b.baseIndices.push(i);
    }
  }

  const result = [...buckets.values()];
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}
