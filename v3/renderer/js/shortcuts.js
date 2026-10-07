import { state } from './core/store.js';
import { stepForward, stepBack, startPlay, stopPlay, isPlaying, nudgeSpeed } from './core/replay.js';
import * as engine from './trading/engine.js';
import * as chartApi from './chart.js';
import { toast } from './ui.js';
const $ = id => document.getElementById(id);
function editable (el) { return el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName); }
export function initShortcuts () {
 document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's' && !e.target.closest('.CodeMirror')) { e.preventDefault(); $('btn-session-save').click(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('btn-session-open').click(); return; }
  if (editable(e.target)) return;
  if (e.key === ' ') { e.preventDefault(); if (state.mode !== 'replay') return; isPlaying() ? stopPlay() : startPlay(); }
  else if (e.key === 'ArrowRight') { stopPlay(); stepForward(); }
  else if (e.key === 'ArrowLeft') { stopPlay(); stepBack(); }
  else if (e.key === '[') toast(`Speed ${nudgeSpeed(-1)}`);
  else if (e.key === ']') toast(`Speed ${nudgeSpeed(1)}`);
  else if (e.key.toLowerCase() === 'b' && state.mode === 'replay') toast(engine.marketOrder(1, Number($('order-volume').value)||1).msg);
  else if (e.key.toLowerCase() === 's' && state.mode === 'replay') toast(engine.marketOrder(-1, Number($('order-volume').value)||1).msg);
  else if (e.key.toLowerCase() === 'm') chartApi.setTool('measurex');
 });
}
