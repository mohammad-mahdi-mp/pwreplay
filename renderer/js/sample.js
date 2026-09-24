// تولید داده نمونه (random walk) برای تست بدون فایل CSV

export function generateSampleCandles (count = 3000, startPrice = 60000, tfMs = 15 * 60 * 1000) {
  let seed = 20260923;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const candles = [];
  let price = startPrice;
  const startTime = Date.UTC(2024, 0, 2, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    // رژیم بازار: روند دوره‌ای + نویز
    const trendCycle = Math.sin(i / 220) * 0.6 + Math.sin(i / 57) * 0.3;
    const drift = trendCycle * startPrice * 0.00035;
    const vol = startPrice * (0.0009 + 0.0006 * Math.abs(Math.sin(i / 90)));

    const o = price;
    const change = drift + (rand() - 0.5) * 2 * vol;
    const c = Math.max(startPrice * 0.3, o + change);
    const bodyLow = Math.min(o, c);
    const bodyHigh = Math.max(o, c);
    const h = bodyHigh + rand() * vol * 0.8;
    const l = Math.max(startPrice * 0.3, bodyLow - rand() * vol * 0.8);
    const v = 100 + rand() * 900 + Math.abs(change) / vol * 200;

    candles.push({
      timestamp: startTime + i * tfMs,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Math.round(v)
    });
    price = c;
  }
  return candles;
}
