export const state = {
  candles: [],
  symbol: '—',
  timeframe: '—',
  mode: 'view',
  replayIndex: -1,
  replayStart: 0,
  settings: {
    balance: 10000,
    contractSize: 1
  },
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

export function setData (candles, symbol, timeframe) {
  state.candles = candles;
  state.symbol = symbol;
  state.timeframe = timeframe;
  state.mode = 'view';
  state.replayIndex = -1;
  state.loaded = true;
  emit('data-loaded');
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

export function visibleCandles () {
  if (state.mode === 'replay') {
    return state.candles.slice(0, state.replayIndex + 1);
  }
  return state.candles;
}

export function currentCandle () {
  if (!state.loaded) return null;
  const idx = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  return idx >= 0 ? state.candles[idx] : null;
}

export function formatTime (ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmt (n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
