// موتور معاملاتی v2: چند پوزیشن هم‌زمان، اوردر معلق، مارجین/لوریج،
// اسپرد/کمیسیون/سواپ، کال مارجین، و لاگ عمل کاربر برای بازپخش تعیین‌کننده هنگام عقب‌گرد

import { state, emit } from '../core/store.js';
import * as chartApi from '../chart.js';

export const defaults = {
  balance: 10000,
  contractSize: 1,
  leverage: 100,       // برابر 1:100
  spread: 0,           // واحد قیمت؛ نصفش در هر معامله اعمال می‌شود
  commissionPerLot: 0, // هر سوگی (ورود و خروج جداگانه)
  swapLong: 0,         // به ازای هر لات به ازای هر شب
  swapShort: 0,
  stopOutPct: 50,      // سطح استاپ‌اوت: درصد سطح مارجین
  marginCallPct: 100   // سطح هشدار کال مارجین
};

export const TRADE_REASON = {
  MANUAL: 'Manual close',
  SL: 'Stop loss',
  TP: 'Take profit',
  STOP_OUT: 'Stop out',
  MARGIN_CALL: 'Margin call'
};

const LONG_COLOR = '#0ecb81';
const SHORT_COLOR = '#f6465d';
const EXIT_COLOR = '#e8b339';

let cfg = { ...defaults };
let balance = defaults.balance;
let initialBalance = defaults.balance;
let positions = [];
let orders = [];
let closedTrades = [];
let actionLog = []; // { index, kind, params } با ترتیب درج
let nextPositionId = 1;
let nextOrderId = 1;
let nextTradeId = 1;
let sessionId = '';
let lastProcessedIndex = -1;
let warnedMarginCall = false;
let batch = false; // حلقه بازسازی: بدون رسم/امیت میانی

export function getConfig () { return { ...cfg }; }

export function configure (patch) {
  cfg = { ...cfg, ...patch };
  for (const k of Object.keys(cfg)) {
    if (typeof cfg[k] === 'number' && (!Number.isFinite(cfg[k]) || cfg[k] < 0)) cfg[k] = defaults[k] ?? 0;
  }
  if (!positions.length) {
    balance = cfg.balance;
    initialBalance = cfg.balance;
  }
  if (!batch) afterChange('config');
}

export function getPositions () { return positions; }
export function getOrders () { return orders; }
export function getClosedTrades () { return closedTrades; }
export function getSessionId () { return sessionId; }

const curIndex = () => state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
const curBar = () => state.candles[curIndex()];
const markPrice = () => { const c = curBar(); return c ? c.close : NaN; };
const halfSpread = () => cfg.spread / 2;
const buyAt = p => p + halfSpread();
const sellAt = p => p - halfSpread();
const marginFor = (price, volume) => price * volume * cfg.contractSize / Math.max(1, cfg.leverage);
const commissionFor = volume => cfg.commissionPerLot * volume;

function floatingPnl (pos, price) {
  return (price - pos.entryPrice) * pos.dir * pos.volume * cfg.contractSize;
}

export function account () {
  const price = markPrice();
  let openPnl = 0;
  for (const pos of positions) openPnl += Number.isFinite(price) ? floatingPnl(pos, price) : 0;
  const equity = balance + openPnl;
  let marginUsed = 0;
  for (const pos of positions) marginUsed += pos.margin;
  const freeMargin = equity - marginUsed;
  const marginLevelPct = marginUsed > 0 ? (equity / marginUsed) * 100 : Infinity;
  return {
    balance,
    initialBalance,
    equity,
    openPnl,
    marginUsed,
    freeMargin,
    marginLevelPct,
    marginCall: marginUsed > 0 && marginLevelPct < cfg.marginCallPct,
    positionsCount: positions.length,
    closedCount: closedTrades.length
  };
}

// ---------- سشن و بازسازی ----------

function resetInternals () {
  balance = cfg.balance;
  initialBalance = cfg.balance;
  positions = [];
  orders = [];
  closedTrades = [];
  nextPositionId = 1;
  nextOrderId = 1;
  nextTradeId = 1;
  lastProcessedIndex = state.mode === 'replay' ? state.replayStart : -1;
  warnedMarginCall = false;
  lastOverlaySig = null; // پاک‌سازی امضا → بازسازی کامل در رسم بعدی
}

export function resetSession (newSessionId = '') {
  if (newSessionId) sessionId = newSessionId;
  actionLog = [];
  resetInternals();
  chartApi.clearTradeMarkers();
  afterChange('reset');
}

// ---------- ترسیم روی چارت ----------

function drawOrderLine (order) {
  eraseOrderLine(order);
  order.art = {
    line: chartApi.addPendingOrderLine(
      order.id, order.price,
      order.dir > 0 ? LONG_COLOR : SHORT_COLOR,
      `${order.id} ${order.dir > 0 ? 'BUY' : 'SELL'} ${order.type.toUpperCase()}`,
      order.id
    ),
    sl: null, tp: null
  };
  if (order.sl != null) order.art.sl = chartApi.addSlTpLine(`osl_${order.id}`, order.sl, SHORT_COLOR, `${order.id} SL ⬇ drag`, order.id);
  if (order.tp != null) order.art.tp = chartApi.addSlTpLine(`otp_${order.id}`, order.tp, LONG_COLOR, `${order.id} TP ⬆ drag`, order.id);
}

function eraseOrderLine (order) {
  if (order.art) {
    if (order.art.line) chartApi.removePendingOrderLine(order.art.line);
    if (order.art.sl) chartApi.removeTradeMarker(order.art.sl);
    if (order.art.tp) chartApi.removeTradeMarker(order.art.tp);
  }
  order.art = null;
}

function bandEnd () {
  const last = state.candles[state.candles.length - 1];
  if (!last) return Date.now();
  const cur = curBar();
  return (cur ? cur.timestamp : last.timestamp) + (last.timestamp - state.candles[0].timestamp) * 0.05;
}

function drawPositionArt (pos) {
  erasePositionArt(pos);
  const color = pos.dir > 0 ? LONG_COLOR : SHORT_COLOR;
  pos.art = { marker: null, entry: null, sl: null, tp: null };
  pos.art.marker = chartApi.addTradeMarker({
    timestamp: pos.entryTime, value: pos.entryPrice,
    text: (pos.dir > 0 ? 'B▲ ' : 'S▼ ') + pos.volume, color,
    positionId: pos.id
  });
  pos.art.entry = chartApi.addPriceLine(pos.entryPrice, color, `${pos.id} Entry`, pos.id);
  if (pos.sl != null) pos.art.sl = chartApi.addSlTpLine(`sl_${pos.id}`, pos.sl, SHORT_COLOR, `${pos.id} SL ⬇ drag`, pos.id);
  if (pos.tp != null) pos.art.tp = chartApi.addSlTpLine(`tp_${pos.id}`, pos.tp, LONG_COLOR, `${pos.id} TP ⬆ drag`, pos.id);
  chartApi.addTradeBand(pos.id, pos.entryPrice, pos.sl, pos.tp, pos.dir, pos.entryTime, bandEnd());
}

function erasePositionArt (pos) {
  if (pos.art) {
    if (pos.art.marker) chartApi.removeTradeMarker(pos.art.marker);
    for (const k of ['entry', 'sl', 'tp']) {
      if (pos.art[k]) chartApi.removeTradeMarker(pos.art[k]);
    }
    pos.art = null;
  }
  chartApi.removeTradeBand(pos.id);
}

function addExitMarker (trade) {
  chartApi.addTradeMarker({
    timestamp: trade.closeTime, value: trade.exitPrice,
    text: '× ' + trade.volume, color: EXIT_COLOR
  });
}

function overlaySignature () {
  const p = positions.map(x => `${x.id}:${x.volume}|${x.entryPrice}|${x.sl}|${x.tp}`).join(';');
  const o = orders.map(x => `${x.id}:${x.price}|${x.type}|${x.dir}|${x.sl}|${x.tp}`).join(';');
  return `${p}#${o}#${closedTrades.length}`;
}

let lastOverlaySig = null;

function rebuildOverlays (force = false) {
  const sig = overlaySignature();
  if (!force && sig === lastOverlaySig) return;   // بدون تغییر ساختاری: از پاک/رسم مجدد سنگین صرف‌نظر کن
  lastOverlaySig = sig;
  chartApi.clearTradeMarkers();
  for (const trade of closedTrades) {
    const color = trade.dir > 0 ? LONG_COLOR : SHORT_COLOR;
    chartApi.addTradeMarker({ timestamp: trade.entryTime, value: trade.entryPrice, text: (trade.dir > 0 ? 'B▲ ' : 'S▼ ') + trade.volume, color });
    chartApi.addTradeMarker({ timestamp: trade.closeTime, value: trade.exitPrice, text: '× ' + trade.volume, color: EXIT_COLOR });
  }
  for (const pos of positions) drawPositionArt(pos);
  for (const order of orders) drawOrderLine(order);
}

function afterChange (reason) {
  rebuildOverlays();
  emit('engine-changed', reason);
}

// ---------- پردازش کندل (بازار) ----------

const dayOf = ts => Math.floor(ts / 86400000);

function accrueSwap (index) {
  const prev = state.candles[index - 1];
  const bar = state.candles[index];
  if (!prev || !bar) return;
  const days = dayOf(bar.timestamp) - dayOf(prev.timestamp);
  if (days <= 0) return;
  for (const pos of positions) {
    const rate = pos.dir > 0 ? cfg.swapLong : cfg.swapShort;
    const swap = rate * pos.volume * cfg.contractSize * days;
    if (swap === 0) continue;
    balance += swap;
    pos.swapAccrued += swap;
  }
}

function shouldTrigger (order, candle) {
  if (order.type === 'limit') return order.dir > 0 ? candle.low <= order.price : candle.high >= order.price;
  return order.dir > 0 ? candle.high >= order.price : candle.low <= order.price;
}

function checkStopOut () {
  if (!positions.length) return;
  const acc = account();
  if (!(acc.marginUsed > 0)) return;
  if (acc.equity <= 0) {
    warnedMarginCall = true;
    if (!batch) emit('margin-event', { kind: 'margin-call', level: 0 });
    for (const pos of [...positions]) closePositionInternal(pos.id, 1, state.candles[Math.max(0, lastProcessedIndex)], TRADE_REASON.MARGIN_CALL);
    return;
  }
  if (acc.marginLevelPct < cfg.stopOutPct) {
    warnedMarginCall = true;
    if (!batch) emit('margin-event', { kind: 'stop-out', level: acc.marginLevelPct });
    const byWorst = [...positions].sort((a, b) => floatingPnl(a, markPrice()) - floatingPnl(b, markPrice()));
    for (const pos of byWorst) {
      if (account().marginLevelPct >= cfg.stopOutPct || !positions.includes(pos)) break;
      closePositionInternal(pos.id, 1, state.candles[Math.max(0, lastProcessedIndex)], TRADE_REASON.STOP_OUT);
    }
  } else if (!warnedMarginCall && acc.marginLevelPct < cfg.marginCallPct) {
    warnedMarginCall = true;
    if (!batch) emit('margin-event', { kind: 'warning', level: acc.marginLevelPct });
  }
}

export function onBar (index) {
  if (index !== lastProcessedIndex + 1) return;
  lastProcessedIndex = index;
  const candle = state.candles[index];
  if (!candle) return;

  accrueSwap(index);

  const triggered = orders
    .filter(o => o.createdIndex < index && shouldTrigger(o, candle))
    .sort((a, b) => a.createdIndex - b.createdIndex || a.seq - b.seq);

  for (const order of triggered) {
    if (!orders.includes(order)) continue;
    removeOrder(order);
    openPosition(order.dir, order.volume, order.price, order.sl, order.tp, index, `${order.type} ${order.dir > 0 ? 'buy' : 'sell'}`);
  }

  for (const pos of [...positions]) {
    if (pos.entryIndex >= index) continue;
    const slHit = pos.dir > 0 ? (pos.sl != null && candle.low <= pos.sl) : (pos.sl != null && candle.high >= pos.sl);
    const tpHit = pos.dir > 0 ? (pos.tp != null && candle.high >= pos.tp) : (pos.tp != null && candle.low <= pos.tp);
    if (slHit && tpHit) closePositionInternal(pos.id, 1, candle, TRADE_REASON.SL);
    else if (slHit) closePositionInternal(pos.id, 1, candle, TRADE_REASON.SL, pos.sl);
    else if (tpHit) closePositionInternal(pos.id, 1, candle, TRADE_REASON.TP, pos.tp);
  }

  applyActionsAt(index);
  checkStopOut();
  if (!batch) afterChange('bar');
}

function applyActionsAt (index) {
  for (const entry of actionLog) {
    if (entry.index === index) applyAction(entry, index);
  }
}

// ---------- عمل‌های کاربر (لاگ‌شده) ----------

function truncateFuture () {
  const idx = curIndex();
  actionLog = actionLog.filter(e => e.index <= idx);
}

export function marketOrder (dir, volume, sl = null, tp = null) {
  return userAction('market', { dir, volume, sl, tp });
}

export function placeOrder (type, dir, price, volume, sl = null, tp = null) {
  return userAction('order', { type, dir, price, volume, sl, tp });
}

export function cancelOrder (id) {
  return userAction('cancel', { id });
}

export function closePositionById (id, portion = 1, reason = TRADE_REASON.MANUAL) {
  return userAction('close', { id, portion, reason });
}

export function modifyPosition (id, { sl, tp } = {}) {
  return userAction('modify', { id, sl, tp });
}

export function modifyOrder (id, { sl, tp } = {}) {
  return userAction('modify-order', { id, sl, tp });
}

function userAction (kind, params) {
  const result = applyAction({ kind, params });
  if (result.ok) {
    truncateFuture();
    actionLog.push({ index: curIndex(), kind, params: { ...params } });
    checkStopOut();
    if (!batch) afterChange(kind);
  }
  return result;
}

function applyAction ({ kind, params }, barIndex) {
  const candle = barIndex != null ? state.candles[barIndex] : null;
  const price = candle ? candle.close : markPrice();
  const market = price;
  const bar = candle ?? curBar();

  switch (kind) {
    case 'market': {
      if (!Number.isFinite(price)) return { ok: false, msg: 'No market price available' };
      const err = validateVolume(params.volume) || validateProtection(params.dir, buyAt(params.dir > 0 ? price : price), params.sl, params.tp, price);
      if (err) return { ok: false, msg: err };
      return openPosition(params.dir, params.volume, price, params.sl, params.tp, barIndex != null ? barIndex : curIndex(), 'Market');
    }
    case 'order': {
      if (!Number.isFinite(market)) return { ok: false, msg: 'No market price available' };
      const err = validatePending(params, market);
      if (err) return { ok: false, msg: err };
      return addOrder(params, barIndex);
    }
    case 'cancel': {
      const order = orders.find(o => o.id === params.id);
      if (!order) return { ok: false, msg: 'Pending order not found' };
      removeOrder(order);
      return { ok: true, msg: `${order.id} cancelled` };
    }
    case 'close': {
      const pos = positions.find(p => p.id === params.id);
      if (!pos) return { ok: false, msg: 'Position not found' };
      return closePositionInternal(pos.id, params.portion ?? 1, bar, params.reason || TRADE_REASON.MANUAL);
    }
    case 'modify': {
      const pos = positions.find(p => p.id === params.id);
      if (!pos) return { ok: false, msg: 'Position not found' };
      const newSl = params.sl === undefined ? pos.sl : params.sl;
      const newTp = params.tp === undefined ? pos.tp : params.tp;
      const err = validateProtection(pos.dir, pos.entryPrice, newSl, newTp);
      if (err) return { ok: false, msg: err };
      pos.sl = newSl;
      pos.tp = newTp;
      if (!batch) drawPositionArt(pos);
      return { ok: true, msg: `${pos.id} updated` };
    }
    case 'modify-order': {
      const order = orders.find(o => o.id === params.id);
      if (!order) return { ok: false, msg: 'Pending order not found' };
      const newSl = params.sl === undefined ? order.sl : params.sl;
      const newTp = params.tp === undefined ? order.tp : params.tp;
      const err = validateProtection(order.dir, order.price, newSl, newTp, order.price);
      if (err) return { ok: false, msg: err };
      order.sl = newSl;
      order.tp = newTp;
      if (!batch) drawOrderLine(order);
      return { ok: true, msg: `${order.id} updated` };
    }
    default:
      return { ok: false, msg: 'Unknown action' };
  }
}

// ---------- اعتبارسنجی ----------

function validateVolume (volume) {
  if (!Number.isFinite(volume) || volume <= 0) return 'Volume must be greater than zero';
  return null;
}

function validateProtection (dir, entryPrice, sl, tp, marketPrice = entryPrice) {
  if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return 'Stop loss must be a valid positive price';
  if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return 'Take profit must be a valid positive price';
  if (dir > 0) {
    if (sl != null && sl >= marketPrice) return 'Long stop loss must be below the market price';
    if (tp != null && tp <= marketPrice) return 'Long take profit must be above the market price';
  } else {
    if (sl != null && sl <= marketPrice) return 'Short stop loss must be above the market price';
    if (tp != null && tp >= marketPrice) return 'Short take profit must be below the market price';
  }
  void entryPrice;
  return null;
}

function validatePending (params, market) {
  const { type, dir, price, volume, sl, tp } = params;
  if (!['limit', 'stop'].includes(type)) return 'Unsupported order type';
  if (!Number.isFinite(price) || price <= 0) return 'Trigger price must be a valid positive number';
  const err = validateVolume(volume) || validateProtection(dir, price, sl, tp, price);
  if (err) return err;
  if (type === 'limit' && dir > 0 && price >= market) return 'Buy Limit price must be below the market';
  if (type === 'limit' && dir < 0 && price <= market) return 'Sell Limit price must be above the market';
  if (type === 'stop' && dir > 0 && price <= market) return 'Buy Stop price must be above the market';
  if (type === 'stop' && dir < 0 && price >= market) return 'Sell Stop price must be below the market';
  return null;
}

// ---------- اجرا ----------

function addOrder (params, createdIndex) {
  const candle = createdIndex != null ? state.candles[createdIndex] : null;
  const order = {
    id: 'PO-' + nextOrderId++,
    seq: nextOrderId,
    type: params.type,
    dir: params.dir,
    price: params.price,
    volume: params.volume,
    sl: params.sl ?? null,
    tp: params.tp ?? null,
    createdIndex: createdIndex != null ? createdIndex : curIndex(),
    createdTime: candle ? candle.timestamp : (curBar() ? curBar().timestamp : 0),
    art: null
  };
  orders.push(order);
  if (!batch) drawOrderLine(order);
  return { ok: true, msg: `${order.id} ${order.dir > 0 ? 'BUY' : 'SELL'} ${order.type} placed`, order };
}

function removeOrder (order) {
  eraseOrderLine(order);
  const i = orders.indexOf(order);
  if (i >= 0) orders.splice(i, 1);
}

function openPosition (dir, volume, rawPrice, sl, tp, index, source) {
  const entryPrice = dir > 0 ? buyAt(rawPrice) : sellAt(rawPrice);
  const margin = marginFor(entryPrice, volume);
  const acc = account();
  if (acc.marginUsed + margin > acc.equity + 1e-9) {
    return { ok: false, msg: 'Not enough free margin (lower volume or raise leverage)' };
  }
  const commission = commissionFor(volume);
  balance -= commission;
  const bar = state.candles[index];
  const pos = {
    id: 'P-' + nextPositionId++,
    dir,
    volume,
    entryPrice,
    entryTime: bar ? bar.timestamp : 0,
    entryIndex: index,
    sl: sl ?? null,
    tp: tp ?? null,
    margin,
    commissionEntry: commission,
    swapAccrued: 0,
    source,
    art: null
  };
  positions.push(pos);
  if (!batch) drawPositionArt(pos);
  return { ok: true, msg: `${pos.id} ${dir > 0 ? 'LONG' : 'SHORT'} opened (${source})`, position: pos };
}

function closePositionInternal (id, portion, bar, reason, levelPrice = null) {
  const pos = positions.find(p => p.id === id);
  if (!pos) return { ok: false, msg: 'Position not found' };
  if (!bar) return { ok: false, msg: 'No bar for close' };
  const originalVolume = pos.volume;
  const closeVolume = Math.min(Math.max(portion, 0), 1) * originalVolume;
  if (closeVolume <= 0) return { ok: false, msg: 'Close volume must be positive' };
  const exitPrice = levelPrice != null
    ? (pos.dir > 0 ? sellAt(levelPrice) : buyAt(levelPrice))
    : (pos.dir > 0 ? sellAt(bar.close) : buyAt(bar.close));
  const exitIndex = lastProcessedIndex >= 0 ? lastProcessedIndex : curIndex();
  const gross = (exitPrice - pos.entryPrice) * pos.dir * closeVolume * cfg.contractSize;
  const exitCommission = commissionFor(closeVolume);
  balance += gross - exitCommission;
  const volumeShare = closeVolume / originalVolume;
  const swapShare = pos.swapAccrued * volumeShare;
  const trade = {
    id: 'T-' + nextTradeId++,
    sessionId,
    symbol: state.symbol,
    timeframe: state.timeframe,
    dir: pos.dir,
    volume: closeVolume,
    entryPrice: pos.entryPrice,
    exitPrice,
    entryTime: pos.entryTime,
    closeTime: bar.timestamp,
    entryIndex: pos.entryIndex,
    exitIndex,
    bars: Math.max(0, exitIndex - pos.entryIndex),
    grossPnl: gross,
    commission: pos.commissionEntry * volumeShare + exitCommission,
    swap: swapShare,
    netPnl: gross - pos.commissionEntry * volumeShare - exitCommission - swapShare,
    reason,
    source: pos.source
  };
  closedTrades.push(trade);
  pos.volume -= closeVolume;
  pos.margin = pos.margin * (1 - volumeShare);
  pos.commissionEntry = pos.commissionEntry * (1 - volumeShare);
  pos.swapAccrued -= swapShare;
  if (pos.volume <= 1e-10) {
    erasePositionArt(pos);
    positions = positions.filter(p => p !== pos);
  } else if (!batch) {
    drawPositionArt(pos); // به‌روزرسانی متن حجم روی مارکر ورود
  }
  if (!batch) addExitMarker(trade);
  emit('trade-closed', trade);
  return { ok: true, msg: `${id} closed — ${reason}`, trade };
}

// ---------- بازپخش برای عقب‌گرد ----------

export function undoLastAction () {
  if (!actionLog.length) return { ok: false, msg: 'Nothing to undo' };
  actionLog.pop();
  const idx = curIndex();
  batch = true;
  resetInternals();
  const upto = Math.min(idx, state.candles.length - 1);
  while (lastProcessedIndex < upto) onBar(lastProcessedIndex + 1);
  batch = false;
  warnedMarginCall = false;
  afterChange('undo');
  return { ok: true, msg: 'Last action undone' };
}

export function rewindTo (targetIndex) {
  const log = actionLog;
  batch = true;
  resetInternals();
  actionLog = log;
  const upto = Math.min(targetIndex, state.candles.length - 1);
  while (lastProcessedIndex < upto) onBar(lastProcessedIndex + 1);
  batch = false;
  warnedMarginCall = false;
  afterChange('rewind');
}

export function isBatched () { return batch; }
