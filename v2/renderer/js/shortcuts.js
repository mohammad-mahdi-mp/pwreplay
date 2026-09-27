import { state, listDatasets, setActiveDataset } from './core/store.js';
import { stepForward, stepBack, startPlay, stopPlay, isPlaying, jumpTo } from './core/replay.js';
import * as engine from './trading/engine.js';
import { setTool } from './chart.js';
import * as sound from './core/sound.js';

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
  if (state.mode !== 'replay') { showShortcutToast('Start replay to trade', 'err'); return; }
  const { sl, tp } = currentSlTp();
  const result = engine.marketOrder(1, currentVolume(), sl, tp);
  if (result.ok) sound.playOrder();
  showShortcutToast(result.msg, result.ok ? 'ok' : 'err');
}

function marketSell () {
  if (state.mode !== 'replay') { showShortcutToast('Start replay to trade', 'err'); return; }
  const { sl, tp } = currentSlTp();
  const result = engine.marketOrder(-1, currentVolume(), sl, tp);
  if (result.ok) sound.playOrder();
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

function breakEvenAll () {
  if (state.mode !== 'replay') return;
  const positions = engine.getPositions();
  if (!positions.length) return;
  let count = 0;
  for (const pos of positions) {
    const res = engine.modifyPosition(pos.id, { sl: pos.entryPrice });
    if (res.ok) count++;
  }
  sound.playOrder();
  showShortcutToast(`Moved ${count} position(s) to Break-Even`, 'ok');
}

function toggleFullscreen () {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function toggleTradePanel () {
  const btn = $('btn-toggle-trade');
  if (btn) btn.click();
}

function showShortcutToast (msg, type) {
  if (typeof window.__mr2_toast === 'function') { window.__mr2_toast(msg, type); return; }
  const container = document.getElementById('toasts');
  if (!container) return;
  const toastEl = document.createElement('div');
  toastEl.className = 'toast ' + (type || 'info');
  toastEl.textContent = msg;
  container.appendChild(toastEl);
  setTimeout(() => toastEl.remove(), 2500);
}

export function initShortcuts () {
  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;

    if (e.key === ' ' || e.code === 'Space' || (e.shiftKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      togglePlay();
      return;
    }

    if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      stopPlay();
      if (e.shiftKey) {
        for (let i = 0; i < 10; i++) stepForward();
      } else {
        stepForward();
      }
      return;
    }

    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      stopPlay();
      if (e.shiftKey) {
        for (let i = 0; i < 10; i++) stepBack();
      } else {
        stepBack();
      }
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

    if (e.key === 'e' || e.key === 'E') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      breakEvenAll();
      return;
    }

    if (e.key === 't' || e.key === 'T') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      toggleTradePanel();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      toggleFullscreen();
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
      const modal = document.getElementById('shortcuts-modal');
      if (modal) modal.classList.remove('hidden');
      return;
    }

    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.modal:not(.hidden)');
      if (modals.length) {
        modals.forEach(m => m.classList.add('hidden'));
        return;
      }
      setTool('none');
      return;
    }
  });
}
