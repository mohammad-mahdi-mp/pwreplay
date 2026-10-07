// میانبرهای کیبورد v3

import { state, listDatasets, setActiveDataset } from './core/store.js';
import { stepForward, stepBack, startPlay, stopPlay, isPlaying, nudgeSpeed } from './core/replay.js';
import * as engine from './trading/engine.js';
import * as chartApi from './chart.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);

export const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['Shift+Space or ←', 'Previous bar'],
  ['→', 'Next bar'],
  ['[ / ]', 'Slower / faster'],
  ['B / S', 'Market buy / sell with ticket SL/TP'],
  ['X', 'Close all positions'],
  ['Ctrl+Z', 'Undo last trading action'],
  ['F', 'Toggle follow latest bar'],
  ['R', 'Start / exit replay'],
  ['M', 'Measure tool'],
  ['Ctrl+S', 'Save replay session'],
  ['Ctrl+O', 'Open replay session'],
  ['Alt+1..9', 'Switch dataset'],
  ['Esc', 'Cursor tool / close dialog'],
  ['Del', 'Delete selected drawing'],
  ['?', 'Show this list']
];

function isEditable (el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || Boolean(el.closest('.CodeMirror'));
}

function ticketSlTp () {
  const slRaw = $('order-sl').value.trim();
  const tpRaw = $('order-tp').value.trim();
  return { sl: slRaw === '' ? null : Number(slRaw), tp: tpRaw === '' ? null : Number(tpRaw) };
}

function market (dir) {
  if (state.mode !== 'replay') { toast('Start a replay session before trading', 'err'); return; }
  const { sl, tp } = ticketSlTp();
  const result = engine.marketOrder(dir, Number($('order-volume').value) || 1, sl, tp);
  toast(result.msg, result.ok ? 'ok' : 'err');
}

export function initShortcuts () {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    // میانبرهای Ctrl حتی داخل فیلدها (به جز ادیتور Pine)
    if (mod && !e.altKey && (e.key === 's' || e.key === 'S') && !e.target.closest('.CodeMirror')) {
      e.preventDefault();
      $('btn-session-save').click();
      return;
    }
    if (mod && !e.altKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      $('btn-session-open').click();
      return;
    }

    if (isEditable(e.target)) return;
    if (document.querySelector('.modal:not(.hidden)')) return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (state.mode !== 'replay') return;
      if (e.shiftKey) { stopPlay(); stepBack(); } else if (isPlaying()) stopPlay(); else startPlay();
      return;
    }
    if (mod) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        const result = engine.undoLastAction();
        toast(result.msg, result.ok ? 'info' : 'err');
      }
      return;
    }
    if (e.altKey) {
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const ds = listDatasets()[Number(e.key) - 1];
        if (!ds) return;
        if (state.mode === 'replay') { toast('Exit replay before switching', 'err'); return; }
        setActiveDataset(ds.symbol, ds.timeframe);
        toast(`Switched to ${ds.symbol} · ${ds.timeframe}`, 'info');
      }
      return;
    }

    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); stopPlay(); stepForward(); break;
      case 'ArrowLeft': e.preventDefault(); stopPlay(); stepBack(); break;
      case '[': toast('Speed ' + nudgeSpeed(-1), 'info'); break;
      case ']': toast('Speed ' + nudgeSpeed(1), 'info'); break;
      case 'b': case 'B': e.preventDefault(); market(1); break;
      case 's': case 'S': e.preventDefault(); market(-1); break;
      case 'x': case 'X': {
        if (state.mode !== 'replay') return;
        const n = engine.closeAll();
        if (n) toast(`Closed ${n} position(s)`, 'info');
        break;
      }
      case 'f': case 'F': chartApi.setFollowMode(!chartApi.isFollowing()); break;
      case 'r': case 'R': if (!$('btn-replay-toggle').disabled) $('btn-replay-toggle').click(); break;
      case 'm': case 'M': chartApi.setTool('measurex'); break;
      case '?': e.preventDefault(); $('btn-shortcuts').click(); break;
      default: break;
    }
  });
}
