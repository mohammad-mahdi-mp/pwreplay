import { state, listDatasets, setActiveDataset } from './core/store.js';
import { stepForward, stepBack, startPlay, stopPlay, isPlaying } from './core/replay.js';
import * as engine from './trading/engine.js';
import { setTool } from './chart.js';

const $ = (id) => document.getElementById(id);

function isEditable (el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || el.closest('.CodeMirror');
}

function currentVolume () {
  return Number($('order-volume').value) || 1;
}

function currentSlTp () {
  const slRaw = $('order-sl').value.trim();
  const tpRaw = $('order-tp').value.trim();
  return { sl: slRaw === '' ? null : Number(slRaw), tp: tpRaw === '' ? null : Number(tpRaw) };
}

function marketBuy () {
  if (state.mode !== 'replay') return;
  const { sl, tp } = currentSlTp();
  const result = engine.marketOrder(1, currentVolume(), sl, tp);
  showShortcutToast(result.msg, result.ok ? 'ok' : 'err');
}

function marketSell () {
  if (state.mode !== 'replay') return;
  const { sl, tp } = currentSlTp();
  const result = engine.marketOrder(-1, currentVolume(), sl, tp);
  showShortcutToast(result.msg, result.ok ? 'ok' : 'err');
}

function undo () {
  const result = engine.undoLastAction();
  showShortcutToast(result.msg, result.ok ? 'info' : 'err');
}

function togglePlay () {
  if (state.mode !== 'replay') return;
  if (isPlaying()) stopPlay();
  else startPlay();
}

function closeAllPositions () {
  if (state.mode !== 'replay') return;
  const positions = engine.getPositions();
  if (!positions.length) return;
  for (const pos of positions) engine.closePositionById(pos.id, 1);
  showShortcutToast(`Closed ${positions.length} position(s)`, 'info');
}

let toastEl = null;
let toastTimer = null;
function showShortcutToast (msg, type) {
  if (typeof window.__mr2_toast === 'function') { window.__mr2_toast(msg, type); return; }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'shortcut-toast';
    document.getElementById('toasts').appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = 'shortcut-toast visible ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.classList.remove('visible'); }, 2200);
}

export function initShortcuts () {
  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (e.shiftKey) { stepBack(); }
      else { togglePlay(); }
      return;
    }

    if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      stopPlay(); stepForward();
      return;
    }
    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      stopPlay(); stepBack();
      return;
    }

    if (e.key === 'b' || e.key === 'B') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      marketBuy();
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      marketSell();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    if (e.key === 'x' || e.key === 'X') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      closeAllPositions();
      return;
    }

    if (e.altKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = Number(e.key) - 1;
      const datasets = listDatasets();
      if (idx < datasets.length) {
        const ds = datasets[idx];
        if (state.mode === 'replay') { showShortcutToast('Exit replay before switching', 'err'); return; }
        setActiveDataset(ds.symbol, ds.timeframe);
        showShortcutToast(`Switched to ${ds.symbol} · ${ds.timeframe}`, 'info');
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      showShortcutToast('Space=play | ←→=step | B/S=buy/sell | X=close all | Ctrl+Z=undo | Alt+1-9=switch dataset', 'info');
      return;
    }

    if (e.key === 'Escape') {
      if (engine.getPositions().length || document.activeElement !== document.body) {
        setTool('none');
      }
      return;
    }
  });
}
