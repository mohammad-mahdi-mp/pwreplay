import { state, setMode, setReplayIndex, formatTime } from './store.js';
import * as chartApi from './chart.js';
import * as tradingApi from './trading.js';

let playTimer = null;
let playing = false;
let nextTickAt = 0;

function resetTradingState () {
  const t = tradingApi.getTrading();
  tradingApi.resetTrading(t.initialBalance, state.settings.contractSize || 1);
}

function candles () { return state.candles; }

function speedMs () {
  return Number(document.getElementById('speed-select').value) || 1000;
}

function advanceOne (animate = false) {
  if (state.replayIndex >= candles().length - 1) return false;
  const nextIndex = state.replayIndex + 1;
  setReplayIndex(nextIndex);
  chartApi.appendCandle(candles()[nextIndex], animate ? Math.min(140, speedMs() * 0.55) : 0);
  tradingApi.processCandle(nextIndex);
  return true;
}

function scheduleNext () {
  if (!playing) return;
  const delay = Math.max(16, speedMs());
  if (!nextTickAt) nextTickAt = performance.now() + delay;
  const wait = Math.max(0, nextTickAt - performance.now());
  playTimer = setTimeout(() => {
    playTimer = null;
    if (!playing) return;
    if (!advanceOne(delay >= 120)) {
      stopPlay();
      return;
    }
    nextTickAt += delay;
    if (nextTickAt < performance.now() - delay) nextTickAt = performance.now() + delay;
    scheduleNext();
  }, wait);
}

export function enterReplay (startIndex) {
  stopPlay();
  resetTradingState();
  state.replayStart = Math.max(1, Math.min(startIndex, state.candles.length - 1));
  chartApi.setFollowMode(true);
  setMode('replay', state.replayStart);
  chartApi.applySlice(state.candles, state.replayStart + 1, true);
}

export function exitReplay () {
  stopPlay();
  resetTradingState();
  setMode('view');
  chartApi.applyAll(state.candles);
  chartApi.setFollowMode(true);
}

export function stepForward () {
  if (state.mode !== 'replay') return;
  advanceOne(false);
}

export function stepBack () {
  if (state.mode !== 'replay' || state.replayIndex <= state.replayStart) return;
  resetTradingState();
  setReplayIndex(state.replayIndex - 1);
  chartApi.applySlice(candles(), state.replayIndex + 1, chartApi.isFollowing());
}

export function jumpStart () {
  if (state.mode !== 'replay') return;
  resetTradingState();
  setReplayIndex(state.replayStart);
  chartApi.applySlice(candles(), state.replayIndex + 1, chartApi.isFollowing());
}

export function jumpTo (index) {
  if (state.mode !== 'replay') return;
  const target = Math.max(state.replayStart, Math.min(index, candles().length - 1));
  const previous = state.replayIndex;
  if (target < previous) {
    resetTradingState();
  } else {
    for (let i = previous + 1; i <= target; i++) tradingApi.processCandle(i);
  }
  setReplayIndex(target);
  chartApi.applySlice(candles(), target + 1, chartApi.isFollowing());
}

export function startPlay () {
  if (state.mode !== 'replay' || playing || state.replayIndex >= candles().length - 1) return;
  playing = true;
  nextTickAt = 0;
  emit('play-state', true);
  scheduleNext();
}

export function stopPlay () {
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  nextTickAt = 0;
  if (playing) {
    playing = false;
    emit('play-state', false);
  }
}

export function isPlaying () { return playing; }

export function restartWithSpeed () {
  if (!playing) return;
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  nextTickAt = 0;
  scheduleNext();
}

export function currentBarInfo () {
  if (!state.loaded) return null;
  const c = state.mode === 'replay' && state.replayIndex >= 0 ? candles()[state.replayIndex] : candles()[candles().length - 1];
  if (!c) return null;
  return { time: formatTime(c.timestamp), ohlc: c };
}
