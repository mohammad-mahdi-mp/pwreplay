// وضعیت مرکزی و باس رویداد — چندنمادی/چندتایم‌فریمی

export const state = {
  datasets: new Map(), // key: "SYMBOL|TF" -> { symbol, timeframe, candles, derivedFrom }
  symbol: '—',
  timeframe: '—',
  candles: [],
  mode: 'view', // 'view' | 'replay'
  replayIndex: -1,
  replayStart: 0,
  loaded: false
};

const listeners = new Map();

export function on (evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}

export function emit (evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of set) fn(payload);
}

export const keyOf = (symbol, timeframe) => `${symbol}|${timeframe}`;

export function addDataset (candles, symbol, timeframe, { activate = true, derivedFrom = null } = {}) {
  state.datasets.set(keyOf(symbol, timeframe), { symbol, timeframe, candles, derivedFrom });
  if (activate) setActiveDataset(symbol, timeframe);
  else emit('datasets-changed');
}

export function getDataset (symbol, timeframe) {
  return state.datasets.get(keyOf(symbol, timeframe)) || null;
}

export function setActiveDataset (symbol, timeframe) {
  const ds = state.datasets.get(keyOf(symbol, timeframe));
  if (!ds) return false;
  state.symbol = ds.symbol;
  state.timeframe = ds.timeframe;
  state.candles = ds.candles;
  state.mode = 'view';
  state.replayIndex = -1;
  state.loaded = true;
  emit('data-loaded');
  return true;
}

export function listDatasets () {
  return [...state.datasets.values()].map(ds => ({ symbol: ds.symbol, timeframe: ds.timeframe, bars: ds.candles.length, derivedFrom: ds.derivedFrom }));
}

export function setMode (mode, replayIndex = -1) {
  state.mode = mode;
  state.replayIndex = mode === 'replay' ? replayIndex : -1;
  emit('mode-changed');
}

export function setReplayIndex (i) {
  state.replayIndex = i;
  emit('replay-index', i);
}

export function currentIndex () {
  if (!state.loaded) return -1;
  return state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
}

export function currentCandle () {
  const idx = currentIndex();
  return idx >= 0 ? state.candles[idx] : null;
}

export function visibleCandles () {
  if (state.mode === 'replay') return state.candles.slice(0, state.replayIndex + 1);
  return state.candles;
}

export function formatTime (ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmt (n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  if (n === Infinity) return '∞';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function priceDigits (price) {
  return Math.abs(price) >= 1000 ? 2 : 5;
}
