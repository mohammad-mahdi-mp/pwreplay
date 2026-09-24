import { state, emit, formatTime } from './store.js';
import * as chartApi from './chart.js';

const trading = {
  balance: 10000,
  initialBalance: 10000,
  position: null,
  pendingOrders: [],
  closedTrades: []
};

let nextOrderId = 1;

export function getTrading () { return trading; }

export function resetTrading (balance = 10000, contractSize = 1) {
  state.settings.balance = balance;
  state.settings.contractSize = contractSize;
  trading.balance = balance;
  trading.initialBalance = balance;
  trading.position = null;
  trading.pendingOrders = [];
  trading.closedTrades = [];
  nextOrderId = 1;
  chartApi.clearTradeMarkers();
  emit('trade-state-changed');
}

function contractSize () { return state.settings.contractSize || 1; }
function currentIndex () { return state.mode === 'replay' ? state.replayIndex : state.candles.length - 1; }

function currentPrice () {
  if (!state.loaded) return NaN;
  const candle = state.candles[currentIndex()];
  return candle ? candle.close : NaN;
}

function validateVolume (volume) {
  return Number.isFinite(volume) && volume > 0 ? null : 'Volume must be greater than zero';
}

function validateProtection (dir, entryPrice, sl, tp) {
  if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return 'Stop loss must be a valid positive price';
  if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return 'Take profit must be a valid positive price';
  if (dir > 0) {
    if (sl != null && sl >= entryPrice) return 'Long stop loss must be below the entry price';
    if (tp != null && tp <= entryPrice) return 'Long take profit must be above the entry price';
  } else {
    if (sl != null && sl <= entryPrice) return 'Short stop loss must be above the entry price';
    if (tp != null && tp >= entryPrice) return 'Short take profit must be below the entry price';
  }
  return null;
}

function unrealizedPnl () {
  const pos = trading.position;
  if (!pos) return 0;
  return (currentPrice() - pos.entryPrice) * pos.dir * pos.volume * contractSize();
}

export function accountSnapshot () {
  const openPnl = unrealizedPnl();
  return { balance: trading.balance, openPnl, equity: trading.balance + openPnl };
}

export function marketOrder (dir, volume, sl = null, tp = null) {
  const price = currentPrice();
  if (!Number.isFinite(price)) return { ok: false, msg: 'No market price is available' };
  const volumeError = validateVolume(volume);
  if (volumeError) return { ok: false, msg: volumeError };
  const protectionError = validateProtection(dir, price, sl, tp);
  if (protectionError) return { ok: false, msg: protectionError };
  return executeAtPrice(dir, volume, sl, tp, price, currentIndex(), 'Market order');
}

export function pendingOrder (type, dir, price, volume, sl = null, tp = null) {
  const market = currentPrice();
  if (!Number.isFinite(market)) return { ok: false, msg: 'No market price is available' };
  if (!['limit', 'stop'].includes(type)) return { ok: false, msg: 'Unsupported pending order type' };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, msg: 'Trigger price must be a valid positive number' };
  const volumeError = validateVolume(volume);
  if (volumeError) return { ok: false, msg: volumeError };

  if (type === 'limit' && dir > 0 && price >= market) return { ok: false, msg: 'Buy Limit price must be below the market' };
  if (type === 'limit' && dir < 0 && price <= market) return { ok: false, msg: 'Sell Limit price must be above the market' };
  if (type === 'stop' && dir > 0 && price <= market) return { ok: false, msg: 'Buy Stop price must be above the market' };
  if (type === 'stop' && dir < 0 && price >= market) return { ok: false, msg: 'Sell Stop price must be below the market' };

  const protectionError = validateProtection(dir, price, sl, tp);
  if (protectionError) return { ok: false, msg: protectionError };

  const id = 'PO-' + nextOrderId++;
  const label = `${dir > 0 ? 'BUY' : 'SELL'} ${type.toUpperCase()}`;
  const order = {
    id,
    type,
    dir,
    price,
    volume,
    sl,
    tp,
    createdIndex: currentIndex(),
    createdTime: state.candles[currentIndex()].timestamp,
    overlayId: chartApi.addPendingOrderLine(id, price, dir > 0 ? '#12b886' : '#fa5252', label)
  };
  trading.pendingOrders.push(order);
  emit('trade-state-changed');
  return { ok: true, msg: `${label} placed at ${price}`, order };
}

export function cancelPendingOrder (id) {
  const index = trading.pendingOrders.findIndex(order => order.id === id);
  if (index < 0) return { ok: false, msg: 'Pending order not found' };
  const [order] = trading.pendingOrders.splice(index, 1);
  chartApi.removePendingOrderLine(order.overlayId);
  emit('trade-state-changed');
  return { ok: true, msg: `${order.id} cancelled` };
}

function executeAtPrice (dir, volume, sl, tp, price, index, source) {
  if (trading.position && trading.position.dir !== dir) {
    const pos = trading.position;
    if (volume >= pos.volume) {
      const remainder = volume - pos.volume;
      closePositionAt(price, index, 'Opposite order');
      if (remainder > 1e-10) return openPosition(dir, remainder, sl, tp, price, index, source);
      return { ok: true, msg: 'Position closed by opposite order' };
    }
    reducePosition(volume, price, index);
    return { ok: true, msg: 'Position partially closed' };
  }
  return openPosition(dir, volume, sl, tp, price, index, source);
}

function openPosition (dir, volume, sl, tp, price, index, source) {
  const pos = trading.position;
  if (pos) {
    const totalVolume = pos.volume + volume;
    pos.entryPrice = (pos.entryPrice * pos.volume + price * volume) / totalVolume;
    pos.volume = totalVolume;
    if (sl != null) pos.sl = sl;
    if (tp != null) pos.tp = tp;
    refreshPositionLines();
    emit('trade-state-changed');
    return { ok: true, msg: 'Position size increased' };
  }

  trading.position = {
    dir,
    volume,
    entryPrice: price,
    entryTime: state.candles[index].timestamp,
    entryIndex: index,
    sl,
    tp,
    lineIds: []
  };
  addMarker(dir > 0 ? 'BUY' : 'SELL', price, volume, dir, trading.position.entryTime);
  refreshPositionLines();
  emit('trade-state-changed');
  return { ok: true, msg: `${dir > 0 ? 'Long' : 'Short'} position opened (${source})` };
}

function clearPositionLines () {
  const pos = trading.position;
  if (!pos || !pos.lineIds) return;
  for (const id of pos.lineIds) chartApi.removeTradeMarker(id);
  pos.lineIds = [];
}

function refreshPositionLines () {
  const pos = trading.position;
  if (!pos) return;
  clearPositionLines();
  pos.lineIds.push(chartApi.addPriceLine(pos.entryPrice, pos.dir > 0 ? '#12b886' : '#fa5252', 'Entry'));
  if (pos.sl != null) pos.lineIds.push(chartApi.addPriceLine(pos.sl, '#fa5252', 'Stop Loss'));
  if (pos.tp != null) pos.lineIds.push(chartApi.addPriceLine(pos.tp, '#12b886', 'Take Profit'));
}

function reducePosition (volume, price, index) {
  const pos = trading.position;
  const closeVolume = Math.min(volume, pos.volume);
  recordClosedTrade(pos, closeVolume, price, index, 'Partial close');
  pos.volume -= closeVolume;
  if (pos.volume <= 1e-10) {
    clearPositionLines();
    trading.position = null;
  }
  emit('trade-state-changed');
}

export function closePosition (price = null, reason = 'Manual close') {
  if (!trading.position) return { ok: false, msg: 'There is no open position' };
  const exitPrice = price != null ? price : currentPrice();
  return closePositionAt(exitPrice, currentIndex(), reason);
}

function closePositionAt (price, index, reason) {
  const pos = trading.position;
  if (!pos) return { ok: false, msg: 'There is no open position' };
  recordClosedTrade(pos, pos.volume, price, index, reason);
  clearPositionLines();
  trading.position = null;
  emit('trade-state-changed');
  return { ok: true, msg: `Position closed — ${reason}` };
}

function recordClosedTrade (pos, volume, exitPrice, index, reason) {
  const pnl = (exitPrice - pos.entryPrice) * pos.dir * volume * contractSize();
  trading.balance += pnl;
  trading.closedTrades.push({
    dir: pos.dir,
    volume,
    entryPrice: pos.entryPrice,
    exitPrice,
    entryTime: pos.entryTime,
    closeTime: state.candles[index].timestamp,
    bars: index - pos.entryIndex,
    pnl,
    reason
  });
  addMarker('EXIT', exitPrice, volume, pos.dir, state.candles[index].timestamp, true);
}

function addMarker (label, price, volume, dir, timestamp, isExit = false) {
  const text = (label === 'BUY' ? 'B▲ ' : label === 'SELL' ? 'S▼ ' : '× ') + String(volume);
  chartApi.addTradeMarker({
    timestamp,
    value: price,
    text,
    color: isExit ? '#f5a524' : (dir > 0 ? '#12b886' : '#fa5252')
  });
}

function shouldTrigger (order, candle) {
  if (order.type === 'limit') return order.dir > 0 ? candle.low <= order.price : candle.high >= order.price;
  return order.dir > 0 ? candle.high >= order.price : candle.low <= order.price;
}

export function processCandle (index) {
  const candle = state.candles[index];
  if (!candle) return;

  const triggered = trading.pendingOrders
    .filter(order => order.createdIndex < index && shouldTrigger(order, candle))
    .sort((a, b) => a.createdIndex - b.createdIndex);

  for (const order of triggered) {
    const liveIndex = trading.pendingOrders.findIndex(item => item.id === order.id);
    if (liveIndex < 0) continue;
    trading.pendingOrders.splice(liveIndex, 1);
    chartApi.removePendingOrderLine(order.overlayId);
    executeAtPrice(order.dir, order.volume, order.sl, order.tp, order.price, index, `${order.type} order`);
  }

  const pos = trading.position;
  if (!pos) {
    if (triggered.length) emit('trade-state-changed');
    return;
  }

  if (pos.dir > 0) {
    if (pos.sl != null && candle.low <= pos.sl) {
      closePositionAt(pos.sl, index, 'Stop loss');
      return;
    }
    if (pos.tp != null && candle.high >= pos.tp) {
      closePositionAt(pos.tp, index, 'Take profit');
      return;
    }
  } else {
    if (pos.sl != null && candle.high >= pos.sl) {
      closePositionAt(pos.sl, index, 'Stop loss');
      return;
    }
    if (pos.tp != null && candle.low <= pos.tp) {
      closePositionAt(pos.tp, index, 'Take profit');
      return;
    }
  }
  if (triggered.length) emit('trade-state-changed');
}

export function onNewCandle () {
  processCandle(currentIndex());
}

export function computeStats () {
  const trades = trading.closedTrades;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  let peak = trading.initialBalance;
  let maxDd = 0;
  let equity = trading.initialBalance;
  const equityPoints = [trading.initialBalance];
  for (const trade of trades) {
    equity += trade.pnl;
    equityPoints.push(equity);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
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
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    maxDd,
    maxDdPct: trading.initialBalance > 0 ? (maxDd / trading.initialBalance) * 100 : 0,
    netPnl: trading.balance - trading.initialBalance,
    equityPoints
  };
}

export function exportTradesCsv () {
  const rows = [['num', 'side', 'volume', 'entryPrice', 'exitPrice', 'entryTime', 'closeTime', 'bars', 'pnl', 'reason']];
  trading.closedTrades.forEach((trade, index) => {
    rows.push([
      index + 1,
      trade.dir > 0 ? 'LONG' : 'SHORT',
      trade.volume,
      trade.entryPrice,
      trade.exitPrice,
      formatTime(trade.entryTime),
      formatTime(trade.closeTime),
      trade.bars,
      trade.pnl.toFixed(4),
      trade.reason
    ]);
  });
  return rows.map(row => row.join(',')).join('\n');
}

export function snapshotForReplayRestart () {
  return { balance: trading.initialBalance };
}
