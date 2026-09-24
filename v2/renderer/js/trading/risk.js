// محاسبات ریسک: سایز پوزیشن بر اساس ریسک و آمار عملکرد

// حجم پیشنهادی بر اساس درصد ریسک از بالانس
// riskAmount = |entry - sl| * volume * contractSize  →  volume = riskAmount / (|entry-sl| * contractSize)
export function volumeByRisk ({ balance, riskPct, entryPrice, slPrice, contractSize }) {
  if (!Number.isFinite(balance) || !Number.isFinite(riskPct) || riskPct <= 0) return NaN;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(slPrice) || entryPrice === slPrice) return NaN;
  const riskAmount = balance * riskPct / 100;
  const perLot = Math.abs(entryPrice - slPrice) * Math.max(contractSize || 1, 1e-12);
  const volume = riskAmount / perLot;
  return Number.isFinite(volume) && volume > 0 ? volume : NaN;
}

// ریسک مالی یک معامله با حجم داده‌شده
export function riskAmount ({ balance, riskPct }) {
  return balance * riskPct / 100;
}

export function computeStats (closedTrades, initialBalance, { floating = 0 } = {}) {
  const trades = closedTrades;
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const totalCommission = trades.reduce((s, t) => s + t.commission, 0);
  const totalSwap = trades.reduce((s, t) => s + t.swap, 0);

  let peak = initialBalance;
  let maxDd = 0;
  let equity = initialBalance;
  const equityPoints = [initialBalance];
  for (const t of trades) {
    equity += t.netPnl;
    equityPoints.push(equity);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0) + (floating || 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const expectancy = trades.length ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : 0;

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    grossProfit,
    grossLoss,
    totalCommission,
    totalSwap,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    maxDd,
    maxDdPct: initialBalance > 0 ? (maxDd / initialBalance) * 100 : 0,
    netPnl,
    finalEquity: initialBalance + netPnl,
    equityPoints
  };
}

export function exportTradesCsv (closedTrades, formatTime) {
  const rows = [['id', 'side', 'volume', 'entryPrice', 'exitPrice', 'entryTime', 'closeTime', 'bars', 'grossPnl', 'commission', 'swap', 'netPnl', 'reason']];
  for (const t of closedTrades) {
    rows.push([
      t.id,
      t.dir > 0 ? 'LONG' : 'SHORT',
      t.volume,
      t.entryPrice,
      t.exitPrice,
      formatTime(t.entryTime),
      formatTime(t.closeTime),
      t.bars,
      t.grossPnl.toFixed(4),
      t.commission.toFixed(4),
      t.swap.toFixed(4),
      t.netPnl.toFixed(4),
      t.reason
    ]);
  }
  return rows.map(r => r.join(',')).join('\n');
}
