// موتور ریپلی v2: پخش/گام/اسکراب با بازپخش تعیین‌کننده موتور ترید هنگام عقب‌گرد

import { state, setMode, setReplayIndex } from './store.js';
import * as chartApi from '../chart.js';
import * as engine from '../trading/engine.js';

let playTimer = null;
let playing = false;
let nextTickAt = 0;

function candles () { return state.candles; }

function speedMs () {
  return Number(document.getElementById('speed-select').value) || 1000;
}

function resetEngineSession () {
  engine.resetSession(sessionKey());
}

function sessionKey () {
  return `${state.symbol}|${state.timeframe}|${state.replayStart}`;
}

function advanceOne (animate = false) {
  if (state.replayIndex >= candles().length - 1) return false;
  const nextIndex = state.replayIndex + 1;
  setReplayIndex(nextIndex);
  chartApi.appendCandle(candles()[nextIndex], animate ? Math.min(140, speedMs() * 0.55) : 0);
  engine.onBar(nextIndex);
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
  state.replayStart = Math.max(1, Math.min(startIndex, state.candles.length - 1));
  chartApi.setFollowMode(true);
  setMode('replay', state.replayStart);
  resetEngineSession();
  chartApi.applySlice(state.candles, state.replayStart + 1, true);
  emitPlayState(false);
}

export function exitReplay () {
  stopPlay();
  setMode('view');
  resetEngineSession();
  chartApi.applyAll(state.candles);
  chartApi.setFollowMode(true);
  emitPlayState(false);
}

export function stepForward () {
  if (state.mode !== 'replay') return;
  stopPlay();
  advanceOne(false);
}

export function stepBack () {
  if (state.mode !== 'replay' || state.replayIndex <= state.replayStart) return;
  stopPlay();
  const target = state.replayIndex - 1;
  engine.rewindTo(target);
  setReplayIndex(target);
  chartApi.applySlice(candles(), target + 1, chartApi.isFollowing());
}

export function jumpStart () {
  if (state.mode !== 'replay') return;
  stopPlay();
  engine.rewindTo(state.replayStart);
  setReplayIndex(state.replayStart);
  chartApi.applySlice(candles(), state.replayStart + 1, chartApi.isFollowing());
}

export function jumpTo (index) {
  if (state.mode !== 'replay') return;
  stopPlay();
  const target = Math.max(state.replayStart, Math.min(index, candles().length - 1));
  if (target < state.replayIndex) {
    engine.rewindTo(target);
  } else {
    for (let i = state.replayIndex + 1; i <= target; i++) engine.onBar(i);
  }
  setReplayIndex(target);
  chartApi.applySlice(candles(), target + 1, chartApi.isFollowing());
}

export function startPlay () {
  if (state.mode !== 'replay' || playing || state.replayIndex >= candles().length - 1) return;
  playing = true;
  nextTickAt = 0;
  emitPlayState(true);
  scheduleNext();
}

export function stopPlay () {
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  nextTickAt = 0;
  if (playing) {
    playing = false;
    emitPlayState(false);
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

function emitPlayState (isPlayingNow) {
  // رویداد سبک برای دکمه پخش
  const evt = new CustomEvent('replay-play-state', { detail: isPlayingNow });
  document.dispatchEvent(evt);
}

export function currentBarInfo () {
  if (!state.loaded) return null;
  const c = state.mode === 'replay' && state.replayIndex >= 0
    ? candles()[state.replayIndex]
    : candles()[candles().length - 1];
  if (!c) return null;
  return { time: c.timestamp, ohlc: c };
}
