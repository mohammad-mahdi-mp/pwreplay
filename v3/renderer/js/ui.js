import { state, addDataset, on } from './core/store.js';
import { parseCsv } from './core/csv.js';
import { generateSampleCandles } from './core/sample.js';
import { enterReplay, exitReplay, startPlay, stopPlay, stepForward, stepBack, jumpTo, isPlaying, restartWithSpeed } from './core/replay.js';
import * as chartApi from './chart.js';

const $ = id => document.getElementById(id);
export function toast (msg, type = 'info') { const box = $('toasts'); const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg; box.appendChild(el); setTimeout(() => el.remove(), 3000); }
export function openModal (id) { $(id)?.classList.remove('hidden'); }
export function closeModal (id) { $(id)?.classList.add('hidden'); }
function readCsvFile (file) { const r = new FileReader(); r.onload = () => { const res = parseCsv(String(r.result), { delimiter: 'auto', hasHeader: true, timeUnit: 'auto' }); if (!res.ok) return toast(res.errors.join(' · '), 'err'); addDataset(res.candles, $('csv-symbol').value.trim() || file.name.replace(/\..*$/, '').toUpperCase(), $('csv-tf').value); closeModal('csv-modal'); toast(`${res.candles.length} bars loaded`, 'ok'); }; r.readAsText(file); }
function syncControls () { $('btn-replay-toggle').disabled = !state.loaded; $('scrubber').disabled = state.mode !== 'replay'; $('scrubber').max = String(Math.max(0, state.candles.length - 1)); if (state.mode === 'replay') { $('scrubber').min = String(state.replayStart); $('scrubber').value = String(state.replayIndex); $('btn-replay-toggle').textContent = 'Exit replay'; } else { $('scrubber').min = '0'; $('btn-replay-toggle').textContent = 'Start replay'; } $('bar-time').textContent = state.candles[state.mode === 'replay' ? state.replayIndex : state.candles.length - 1] ? new Date(state.candles[state.mode === 'replay' ? state.replayIndex : state.candles.length - 1].timestamp).toLocaleString() : '-'; }
export function initUi () {
  $('btn-import').onclick = () => openModal('csv-modal'); $('btn-sample').onclick = () => addDataset(generateSampleCandles(), 'SAMPLE', 'M15'); $('csv-file').onchange = e => e.target.files[0] && readCsvFile(e.target.files[0]); document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeModal(b.dataset.close));
  $('btn-replay-toggle').onclick = () => { if (state.mode === 'replay') { exitReplay(); toast('Replay ended'); } else if (state.loaded) enterReplay(Math.max(10, Math.min(100, state.candles.length - 1))); };
  $('btn-jump-start').onclick = () => { stopPlay(); if (state.mode === 'replay') { const i = state.replayStart; import('./core/replay.js').then(m => m.jumpStart()); } };
  $('btn-step-back').onclick = () => { stopPlay(); stepBack(); }; $('btn-play').onclick = () => isPlaying() ? stopPlay() : startPlay(); $('btn-step-fwd').onclick = () => { stopPlay(); stepForward(); }; $('speed-select').onchange = restartWithSpeed; $('scrubber').onchange = e => jumpTo(Number(e.target.value)); window.addEventListener('resize', () => chartApi.resize());
  on('data-loaded', syncControls); on('mode-changed', syncControls); on('replay-index', syncControls); syncControls();
}