// موتور معاملاتی v3: چند پوزیشن هم‌زمان، اوردر معلق، مارجین/لوریج،
// اسپرد/کمیسیون/سواپ، کال مارجین، MFE/MAE و R-multiple،
// و لاگ عمل کاربر برای بازسازی تعیین‌کننده هنگام عقب‌گرد یا بارگذاری سشن
//
// تغییرات نسبت به v2:
// - اکشن‌های روی کندل شروع ریپلی هنگام عقب‌گرد/Undo گم نمی‌شوند
// - برخورد هم‌زمان SL و TP در یک کندل روی سطح SL بسته می‌شود (نه قیمت close)
// - گپ: SL/TP و اوردرهای معلق در صورت باز شدن کندل آن‌طرف سطح، روی open پر می‌شوند
// - علامت سواپ در netPnl با بالانس هماهنگ شد
// - در حین بازسازی، رویداد trade-closed (و توست‌ها) منتشر نمی‌شود

import { state, emit } from '../core/store.js';
import * as chartApi from '../chart.js';

export const defaults = {
  balance: 10000,
  contractSize: 1,
  leverage: 100,       // برابر 1:100
  spread: 0,           // واحد قیمت؛ نصفش در هر سمت معامله اعمال می‌شود
  commissionPerLot: 0, // هر سمت (ورود و خروج جداگانه)
  swapLong: 0,         // به ازای هر لات به ازای هر شب (مثبت = اعتبار)
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
const SIGNED_KEYS = new Set(['swapLong', 'swapShort']);
const ACTION_KINDS = new Set(['market', 'order', 'cancel', 'close', 'modify', 'modify-order']);

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
let lastOverlaySig = null;

function sanitizeConfig (raw) {
  const out = { ...defaults, ...raw };
  for (const k of Object.keys(defaults)) {
    const v = Number(out[k]);
    if (!Number.isFinite(v) || (!SIGNED_KEYS.has(k) && v < 0)) out[k] = defaults[k];
    else out[k] = v;
  }
  if (out.leverage < 1) out.leverage = 1;
  return out;
}

export function getConfig () { return { ...cfg }; }

export function configure (patch) {
  cfg = sanitizeConfig({ ...cfg, ...patch });
  if (!positions.length && !closedTrades.length) {
    balance = cfg.balance;
    initialBalance = cfg.balance;
  }
  if (!batch) afterChange('config');
}

export function getPositions () { return positions; }
export function getOrders () { return orders; }
export function getClosedTrades () { return closedTrades; }
export function getSessionId () { return sessionId; }
export function getActionCount () { return actionLog.length; }

const curIndex = () => state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
const curBar = () => state.candles[curIndex()];
const markPrice = () => { const c = curBar(); return c ? c.close : NaN; };
const halfSpread = () => cfg.spread / 2;
const buyAt = p => p + halfSpread();
const sellAt = p => p - halfSpread();
const marginFor = (price, volume) => price * volume * cfg.contractSize / Math.max(1, cfg.leverage);
const commissionFor = volume => cfg.commissionPerLot * volume;

export function floatingPnl (pos, price = markPrice()) {
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
  sessionId = newSessionId;
  actionLog = [];
  resetInternals();
  chartApi.clearTradeMarkers();
  afterChange('reset');
}

// بازسازی کامل وضعیت از کندل شروع تا targetIndex با همان لاگ اکشن‌ها
function rebuildTo (targetIndex) {
  const log = actionLog;
  batch = true;
  try {
    resetInternals();
    actionLog = log;
    // اکشن‌هایی که روی خود کندل شروع ثبت شده‌اند (در v2 هنگام عقب‌گرد گم می‌شدند)
    if (lastProcessedIndex >= 0) {
      applyActionsAt(lastProcessedIndex);
      checkStopOut();
    }
    const upto = Math.min(targetIndex, state.candles.length - 1);
    while (lastProcessedIndex < upto) onBar(lastProcessedIndex + 1);
  } finally {
    batch = false;
  }
  warnedMarginCall = false;
}

export function rewindTo (targetIndex) {
  rebuildTo(targetIndex);
  afterChange('rewind');
}

// جلو رفتن چندکندلی (اسکرابر/Go-To) بدون رسم میانی
export function fastForward (targetIndex) {
  const upto = Math.min(targetIndex, state.candles.length - 1);
  if (upto <= lastProcessedIndex) return;
  batch = true;
  try {
    while (lastProcessedIndex < upto) onBar(lastProcessedIndex + 1);
  } finally {
    batch = false;
  }
  afterChange('jump');
}

// اعمال تنظیمات جدید روی کل سشن فعلی بدون از دست دادن معاملات
export function recalculate () {
  rebuildTo(curIndex());
  afterChange('recalc');
}

export function exportSession () {
  return {
    sessionId,
    config: { ...cfg },
    actionLog: actionLog.map(e => ({ index: e.index, kind: e.kind, params: { ...e.params } }))
  };
}

export function importSession (payload = {}, targetIndex = curIndex()) {
  if (payload.config) cfg = sanitizeConfig(payload.config);
  const log = Array.isArray(payload.actionLog) ? payload.actionLog : [];
  actionLog = log
    .filter(e => e && Number.isInteger(e.index) && ACTION_KINDS.has(e.kind) && e.params && typeof e.params === 'object')
    .map(e => ({ index: e.index, kind: e.kind, params: { ...e.params } }))
    .sort((a, b) => a.index - b.index);
  rebuildTo(targetIndex);
  afterChange('import');
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

function rebuildOverlays (force = false) {
  const sig = overlaySignature();
  if (!force && sig === lastOverlaySig) return;
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

// قیمت پر شدن اوردر معلق با در نظر گرفتن گپ
function orderFillPrice (order, candle) {
  const o = candle.open;
  if (order.type === 'limit') {
    if (order.dir > 0 && o <= order.price) return o; // لیمیت: قیمت خودش یا بهتر
    if (order.dir < 0 && o >= order.price) return o;
  } else {
    if (order.dir > 0 && o >= order.price) return o; // استاپ: در گپ، بدتر
    if (order.dir < 0 && o <= order.price) return o;
  }
  return order.price;
}

// تشخیص خروج با SL/TP روی یک کندل (بدبینانه وقتی هر دو خورده‌اند)
function protectionExit (pos, c) {
  const long = pos.dir > 0;
  const slHit = pos.sl != null && (long ? c.low <= pos.sl : c.high >= pos.sl);
  const tpHit = pos.tp != null && (long ? c.high >= pos.tp : c.low <= pos.tp);
  if (!slHit && !tpHit) return null;
  if (slHit && (long ? c.open <= pos.sl : c.open >= pos.sl)) return { reason: TRADE_REASON.SL, price: c.open };
  if (tpHit && (long ? c.open >= pos.tp : c.open <= pos.tp)) return { reason: TRADE_REASON.TP, price: c.open };
  if (slHit) return { reason: TRADE_REASON.SL, price: pos.sl };
  return { reason: TRADE_REASON.TP, price: pos.tp };
}

// بیشترین حرکت موافق/مخالف از ورود (واحد قیمت)
function trackExcursion (pos, c, exit) {
  const long = pos.dir > 0;
  let hi = c.high, lo = c.low;
  if (exit) { // بعد از خروج، بقیه کندل حساب نمی‌شود
    if (long) { hi = Math.min(hi, Math.max(exit.price, pos.entryPrice)); lo = Math.max(lo, Math.min(exit.price, pos.entryPrice)); }
    else { lo = Math.max(lo, Math.min(exit.price, pos.entryPrice)); hi = Math.min(hi, Math.max(exit.price, pos.entryPrice)); }
    if (exit.reason === TRADE_REASON.SL) { if (long) lo = Math.min(lo, exit.price); else hi = Math.max(hi, exit.price); }
    if (exit.reason === TRADE_REASON.TP) { if (long) hi = Math.max(hi, exit.price); else lo = Math.min(lo, exit.price); }
  }
  const fav = long ? hi - pos.entryPrice : pos.entryPrice - lo;
  const adv = long ? pos.entryPrice - lo : hi - pos.entryPrice;
  if (fav > pos.mfe) pos.mfe = fav;
  if (adv > pos.mae) pos.mae = adv;
}

function checkStopOut () {
  if (!positions.length) return;
  const acc = account();
  if (!(acc.marginUsed > 0)) return;
  const bar = state.candles[Math.max(0, lastProcessedIndex >= 0 ? lastProcessedIndex : curIndex())];
  if (acc.equity <= 0) {
    warnedMarginCall = true;
    if (!batch) emit('margin-event', { kind: 'margin-call', level: 0 });
    for (const pos of [...positions]) closePositionInternal(pos.id, 1, bar, TRADE_REASON.MARGIN_CALL);
    return;
  }
  if (acc.marginLevelPct < cfg.stopOutPct) {
    warnedMarginCall = true;
    if (!batch) emit('margin-event', { kind: 'stop-out', level: acc.marginLevelPct });
    const byWorst = [...positions].sort((a, b) => floatingPnl(a) - floatingPnl(b));
    for (const pos of byWorst) {
      if (account().marginLevelPct >= cfg.stopOutPct || !positions.includes(pos)) break;
      closePositionInternal(pos.id, 1, bar, TRADE_REASON.STOP_OUT);
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
    openPosition(order.dir, order.volume, orderFillPrice(order, candle), order.sl, order.tp, index, `${order.type} ${order.dir > 0 ? 'buy' : 'sell'}`);
  }

  for (const pos of [...positions]) {
    if (pos.entryIndex >= index) continue;
    const exit = protectionExit(pos, candle);
    trackExcursion(pos, candle, exit);
    if (exit) closePositionInternal(pos.id, 1, candle, exit.reason, exit.price);
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

export function closeAll () {
  const ids = positions.map(p => p.id);
  let closed = 0;
  for (const id of ids) if (closePositionById(id, 1).ok) closed++;
  return closed;
}

// بردن SL به نقطه ورود (ریسک‌فری)
export function breakEven (id) {
  const pos = positions.find(p => p.id === id);
  if (!pos) return { ok: false, msg: 'Position not found' };
  const price = markPrice();
  if (!Number.isFinite(price)) return { ok: false, msg: 'No market price available' };
  if ((pos.dir > 0 && price <= pos.entryPrice) || (pos.dir < 0 && price >= pos.entryPrice)) {
    return { ok: false, msg: 'Price must be beyond entry to move SL to break-even' };
  }
  return modifyPosition(id, { sl: pos.entryPrice });
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
  const bar = candle ?? curBar();

  switch (kind) {
    case 'market': {
      if (!Number.isFinite(price)) return { ok: false, msg: 'No market price available' };
      const err = validateVolume(params.volume) || validateProtection(params.dir, params.sl, params.tp, price);
      if (err) return { ok: false, msg: err };
      return openPosition(params.dir, params.volume, price, params.sl, params.tp, barIndex != null ? barIndex : curIndex(), 'Market');
    }
    case 'order': {
      if (!Number.isFinite(price)) return { ok: false, msg: 'No market price available' };
      const err = validatePending(params, price);
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
      const err = validateProtection(pos.dir, newSl, newTp, price);
      if (err) return { ok: false, msg: err };
      pos.sl = newSl;
      pos.tp = newTp;
      if (pos.initialRisk == null && newSl != null) {
        pos.initialRisk = Math.abs(pos.entryPrice - newSl) * pos.volume * cfg.contractSize;
      }
      if (!batch) drawPositionArt(pos);
      return { ok: true, msg: `${pos.id} updated` };
    }
    case 'modify-order': {
      const order = orders.find(o => o.id === params.id);
      if (!order) return { ok: false, msg: 'Pending order not found' };
      const newSl = params.sl === undefined ? order.sl : params.sl;
      const newTp = params.tp === undefined ? order.tp : params.tp;
      const err = validateProtection(order.dir, newSl, newTp, order.price);
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

function validateProtection (dir, sl, tp, refPrice) {
  if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return 'Stop loss must be a valid positive price';
  if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return 'Take profit must be a valid positive price';
  if (dir > 0) {
    if (sl != null && sl >= refPrice) return 'Long stop loss must be below the market price';
    if (tp != null && tp <= refPrice) return 'Long take profit must be above the market price';
  } else {
    if (sl != null && sl <= refPrice) return 'Short stop loss must be above the market price';
    if (tp != null && tp >= refPrice) return 'Short take profit must be below the market price';
  }
  return null;
}

function validatePending (params, market) {
  const { type, dir, price, volume, sl, tp } = params;
  if (!['limit', 'stop'].includes(type)) return 'Unsupported order type';
  if (!Number.isFinite(price) || price <= 0) return 'Trigger price must be a valid positive number';
  const err = validateVolume(volume) || validateProtection(dir, sl, tp, price);
  if (err) return err;
  if (type === 'limit' && dir > 0 && price >= market) return 'Buy Limit price must be below the market';
  if (type === 'limit' && dir < 0 && price <= market) return 'Sell Limit price must be above the market';
  if (type === 'stop' && dir > 0 && price <= market) return 'Buy Stop price must be above the market';
  if (type === 'stop' && dir < 0 && price >= market) return 'Sell Stop price must be below the market';
  return null;
}

// ---------- اجرا ----------

function addOrder (params, createdIndex) {
  const idx = createdIndex != null ? createdIndex : curIndex();
  const candle = state.candles[idx];
  const order = {
    id: 'PO-' + nextOrderId++,
    seq: nextOrderId,
    type: params.type,
    dir: params.dir,
    price: params.price,
    volume: params.volume,
    sl: params.sl ?? null,
    tp: params.tp ?? null,
    createdIndex: idx,
    createdTime: candle ? candle.timestamp : 0,
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
    initialRisk: sl != null ? Math.abs(entryPrice - sl) * volume * cfg.contractSize : null,
    mfe: 0,
    mae: 0,
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
  const ref = levelPrice != null ? levelPrice : bar.close;
  const exitPrice = pos.dir > 0 ? sellAt(ref) : buyAt(ref);
  const exitIndex = lastProcessedIndex >= 0 ? lastProcessedIndex : curIndex();
  const gross = (exitPrice - pos.entryPrice) * pos.dir * closeVolume * cfg.contractSize;
  const exitCommission = commissionFor(closeVolume);
  balance += gross - exitCommission;
  const volumeShare = closeVolume / originalVolume;
  const swapShare = pos.swapAccrued * volumeShare;
  const entryCommission = pos.commissionEntry * volumeShare;
  const netPnl = gross - entryCommission - exitCommission + swapShare; // سواپ مثبت = اعتبار
  const initialRisk = pos.initialRisk != null ? pos.initialRisk * volumeShare : null;
  const cs = cfg.contractSize;
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
    commission: entryCommission + exitCommission,
    swap: swapShare,
    netPnl,
    initialRisk,
    rMultiple: initialRisk > 0 ? netPnl / initialRisk : null,
    mfe: pos.mfe * closeVolume * cs,
    mae: pos.mae * closeVolume * cs,
    reason,
    source: pos.source
  };
  closedTrades.push(trade);
  pos.volume -= closeVolume;
  pos.margin = pos.margin * (1 - volumeShare);
  pos.commissionEntry = pos.commissionEntry * (1 - volumeShare);
  pos.swapAccrued -= swapShare;
  if (pos.initialRisk != null) pos.initialRisk *= (1 - volumeShare);
  if (pos.volume <= 1e-10) {
    erasePositionArt(pos);
    positions = positions.filter(p => p !== pos);
  } else if (!batch) {
    drawPositionArt(pos);
  }
  if (!batch) {
    addExitMarker(trade);
    emit('trade-closed', trade);
  }
  return { ok: true, msg: `${id} closed (${reason})`, trade };
}

// ---------- Undo ----------

export function undoLastAction () {
  if (!actionLog.length) return { ok: false, msg: 'Nothing to undo' };
  actionLog.pop();
  rebuildTo(curIndex());
  afterChange('undo');
  return { ok: true, msg: 'Last action undone' };
}

export function isBatched () { return batch; }
