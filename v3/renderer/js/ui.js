// سیم‌کشی رابط کاربری v3: مودال‌ها، تب‌ها، جریان CSV، کنترل‌های ریپلی، اسکرابر، تب اندیکاتورها

import { state, on, addDataset, formatTime } from './core/store.js';
import * as chartApi from './chart.js';
import { parseCsv, sniffDelimiter, splitLine } from './core/csv.js';
import { generateSampleCandles } from './core/sample.js';
import { guessTimeframe } from './core/resample.js';
import { enterReplay, exitReplay, startPlay, stopPlay, stepForward, stepBack, jumpStart, jumpTo, isPlaying, restartWithSpeed } from './core/replay.js';

const $ = (id) => document.getElementById(id);

// ---------- توست و مودال ----------

const MAX_TOASTS = 4;
export function toast (msg, type = 'info') {
  const box = $('toasts');
  while (box.children.length >= MAX_TOASTS) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

export function openModal (id) {
  $(id).classList.remove('hidden');
}

export function closeModal (id) {
  $(id).classList.add('hidden');
}

// ---------- جریان CSV ----------

let pendingFile = null; // { name, text }

function csvOpts () {
  return {
    delimiter: $('csv-delimiter').value,
    hasHeader: $('csv-has-header').checked,
    timeUnit: $('csv-time-unit').value
  };
}

function resolvedDelimiter (text, opts) {
  if (opts.delimiter === 'auto' || !opts.delimiter) return sniffDelimiter(text);
  return opts.delimiter === '\\t' ? '\t' : opts.delimiter;
}

const MAP_IDS = ['map-time', 'map-open', 'map-high', 'map-low', 'map-close', 'map-volume'];

function mappingFromUi () {
  return {
    time: +$('map-time').value,
    open: +$('map-open').value,
    high: +$('map-high').value,
    low: +$('map-low').value,
    close: +$('map-close').value,
    volume: +$('map-volume').value
  };
}

function fillMappingSelects (header, mapping, hasHeader) {
  for (const id of MAP_IDS) {
    const sel = $(id);
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = '—';
    sel.appendChild(none);
    header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = hasHeader ? h : 'Column ' + (i + 1);
      sel.appendChild(opt);
    });
  }
  $('map-time').value = String(mapping.time);
  $('map-open').value = String(mapping.open);
  $('map-high').value = String(mapping.high);
  $('map-low').value = String(mapping.low);
  $('map-close').value = String(mapping.close);
  $('map-volume').value = String(mapping.volume);
}

function renderPreview (res) {
  const table = $('csv-preview');
  table.textContent = '';
  const rows = res.preview || [];
  if (!rows.length) return;
  const hasHeader = $('csv-has-header').checked;
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const cols = rows[0].length;
  for (let i = 0; i < cols; i++) {
    const th = document.createElement('th');
    th.textContent = hasHeader && res.header && res.header[i] != null ? res.header[i] : 'Column ' + (i + 1);
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const cell of r) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

function showParseStatus (res) {
  const status = $('csv-status');
  const loadBtn = $('btn-csv-load');
  if (res.ok) {
    const extra = [];
    if (res.skipped) extra.push(`${res.skipped} invalid rows skipped`);
    if (res.duplicates) extra.push(`${res.duplicates} duplicate timestamps removed`);
    status.textContent = `${res.candles.length.toLocaleString('en-US')} valid bars` + (extra.length ? ' · ' + extra.join(' · ') : '');
    status.style.color = 'var(--green)';
    loadBtn.disabled = false;
  } else {
    status.textContent = (res.errors || []).join(' · ');
    status.style.color = 'var(--red)';
    loadBtn.disabled = true;
  }
}

function headerCells (text, opts) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const first = splitLine(lines[0], resolvedDelimiter(text, opts));
  return opts.hasHeader ? first : first.map((_, i) => 'col' + i);
}

function refreshCsvPreview () {
  if (!pendingFile) return;
  const opts = csvOpts();
  const res = parseCsv(pendingFile.text, { ...opts, mapping: undefined });
  fillMappingSelects(headerCells(pendingFile.text, opts), res.mapping || { time: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 }, opts.hasHeader);
  renderPreview(res);
  showParseStatus(res);
  if (res.ok) {
    const tf = guessTimeframe(res.candles);
    if (tf && [...$('csv-tf').options].some(o => o.value === tf)) $('csv-tf').value = tf;
  }
}

function acceptFile (name, text) {
  pendingFile = { name, text };
  $('csv-file-name').textContent = name;
  $('csv-options').classList.remove('hidden');
  const guessed = name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').toUpperCase();
  $('csv-symbol').value = guessed.slice(0, 24) || 'MY-SYMBOL';
  refreshCsvPreview();
}

function readFile (file) {
  const reader = new FileReader();
  reader.onload = () => acceptFile(file.name, String(reader.result));
  reader.readAsText(file);
}

function pickFile () {
  if (window.desktop && window.desktop.openCsv) {
    window.desktop.openCsv().then(res => {
      if (res && res.content) acceptFile(res.name, res.content);
      else if (res && res.error) toast('Could not open file: ' + res.error, 'err');
    });
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.txt,.tsv';
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) readFile(input.files[0]);
  });
  input.click();
}

function loadCsvOnChart () {
  if (!pendingFile) return;
  const res = parseCsv(pendingFile.text, { ...csvOpts(), mapping: mappingFromUi() });
  if (!res.ok) {
    toast('Import failed: ' + (res.errors || []).join(' · '), 'err');
    return;
  }
  if (state.mode === 'replay') exitReplay();
  const symbol = $('csv-symbol').value.trim() || 'MY-SYMBOL';
  const tf = $('csv-tf').value;
  addDataset(res.candles, symbol, tf);
  closeModal('csv-modal');
  pendingFile = null;
  toast(`${res.candles.length.toLocaleString('en-US')} bars loaded`, 'ok');
}

function openCsvModal () {
  pendingFile = null;
  $('csv-file-name').textContent = '';
  $('csv-options').classList.add('hidden');
  $('csv-status').textContent = '';
  $('btn-csv-load').disabled = true;
  openModal('csv-modal');
}

function loadSample () {
  if (state.mode === 'replay') exitReplay();
  addDataset(generateSampleCandles(3000), 'SAMPLE', 'M15');
  toast('3,000 sample bars generated', 'ok');
}

// ---------- مودال شروع ریپلی ----------

function syncReplayInputs (v) {
  $('replay-start-num').value = v;
  $('replay-start-range').value = v;
  const info = $('replay-start-info');
  info.textContent = state.candles[v] ? `Bar ${v} of ${state.candles.length} · ${formatTime(state.candles[v].timestamp)}` : '';
}

function openReplayModal () {
  const max = Math.max(10, state.candles.length - 2);
  $('replay-start-range').max = max;
  $('replay-start-num').max = max;
  $('replay-start-num').min = 10;
  syncReplayInputs(Math.min(100, max));
  openModal('replay-modal');
}

// ---------- کنترل‌های ریپلی ----------

function progressText (index) {
  const span = Math.max(1, state.candles.length - 1 - state.replayStart);
  return `${(((index - state.replayStart) / span) * 100).toFixed(1)}%`;
}

function updateReplayControls () {
  const inReplay = state.mode === 'replay';
  const toggleBtn = $('btn-replay-toggle');
  toggleBtn.textContent = inReplay ? 'Exit Replay' : 'Start Replay';
  toggleBtn.classList.toggle('danger', inReplay);
  toggleBtn.classList.toggle('success', !inReplay);
  toggleBtn.disabled = !state.loaded;

  ['btn-jump-start', 'btn-step-back', 'btn-play', 'btn-step-fwd'].forEach(id => { $(id).disabled = !inReplay; });
  const scrubber = $('scrubber');
  scrubber.disabled = !inReplay;
  scrubber.max = Math.max(0, state.candles.length - 1);
  if (inReplay) {
    scrubber.min = state.replayStart;
    scrubber.value = state.replayIndex;
    $('scrub-min').textContent = String(state.replayStart);
    $('scrub-progress').textContent = progressText(state.replayIndex);
  } else {
    scrubber.min = 0;
    scrubber.value = 0;
    $('scrub-min').textContent = '0';
    $('scrub-progress').textContent = state.loaded ? 'Ready' : 'No data';
  }
  $('scrub-max').textContent = String(Math.max(0, state.candles.length - 1));
  setPlayIcon(isPlaying());
}

const PLAY_SVG = '<svg viewBox="0 0 16 16"><path d="M4.5 3l8 5-8 5z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 16 16"><path d="M4.5 3.5h3v9h-3zM8.5 3.5h3v9h-3z" fill="currentColor"/></svg>';
function setPlayIcon (playing) {
  const btn = $('btn-play');
  if (!btn) return;
  btn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  btn.classList.toggle('playing', playing);
}

function updateBarTime () {
  const el = $('bar-time');
  if (!state.loaded) { el.textContent = '—'; return; }
  const idx = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  const c = state.candles[idx];
  el.textContent = c ? formatTime(c.timestamp) : '—';
}

function toggleReplay () {
  if (!state.loaded) return;
  if (state.mode === 'replay') {
    if (window.__mr3_hasSessionWork && window.__mr3_hasSessionWork() && !window.confirm('Exit replay? Unsaved trades in this session will be discarded (use Save session to keep them).')) return;
    stopPlay();
    exitReplay();
    toast('Replay session ended', 'info');
  } else {
    openReplayModal();
  }
}

// ---------- تب اندیکاتورها ----------

function refreshIndicatorLists () {
  const activeUl = $('ind-active');
  const availUl = $('ind-available');
  activeUl.textContent = '';
  availUl.textContent = '';

  const active = chartApi.listIndicators();
  if (!active.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'No active indicators';
    activeUl.appendChild(li);
  }
  for (const ind of active) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = ind.shortName || ind.name;
    const btn = document.createElement('button');
    btn.className = 'rm';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      chartApi.removeIndicatorById(ind.paneId, ind.name);
      refreshIndicatorLists();
    });
    li.appendChild(b);
    li.appendChild(btn);
    activeUl.appendChild(li);
  }

  for (const ind of chartApi.availableIndicators()) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = ind.label + ' (' + ind.name + ')';
    btn.addEventListener('click', () => {
      chartApi.addIndicator(ind.name, ind.pane);
      refreshIndicatorLists();
      toast(`${ind.label} added`, 'ok');
    });
    li.appendChild(btn);
    availUl.appendChild(li);
  }
}

// ---------- راه‌اندازی ----------

export function initUi () {
  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.bp-page').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab).classList.add('active');
      document.dispatchEvent(new CustomEvent('bottom-tab', { detail: tab.dataset.tab }));
    });
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('mousedown', event => {
      if (event.target === modal) closeModal(modal.id);
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = document.querySelector('.modal:not(.hidden)');
    if (open) closeModal(open.id);
  });
  $('btn-csv-cancel').addEventListener('click', () => closeModal('csv-modal'));
  $('btn-replay-cancel').addEventListener('click', () => closeModal('replay-modal'));

  $('btn-import').addEventListener('click', openCsvModal);
  $('btn-import-empty').addEventListener('click', openCsvModal);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-sample-empty').addEventListener('click', loadSample);

  const dropZone = $('csv-drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  $('btn-csv-pick').addEventListener('click', pickFile);
  ['csv-delimiter', 'csv-has-header', 'csv-time-unit'].forEach(id => $(id).addEventListener('change', refreshCsvPreview));
  MAP_IDS.forEach(id => {
    $(id).addEventListener('change', () => {
      if (!pendingFile) return;
      showParseStatus(parseCsv(pendingFile.text, { ...csvOpts(), mapping: mappingFromUi() }));
    });
  });
  $('btn-csv-load').addEventListener('click', loadCsvOnChart);

  $('btn-replay-toggle').addEventListener('click', toggleReplay);
  $('btn-replay-start').addEventListener('click', () => {
    const v = Math.max(10, Math.min(+$('replay-start-num').value || 100, state.candles.length - 1));
    closeModal('replay-modal');
    enterReplay(v);
    toast(`Replay started at bar ${v}`, 'ok');
  });
  $('replay-start-num').addEventListener('input', (e) => {
    const max = +$('replay-start-range').max;
    syncReplayInputs(Math.max(10, Math.min(+e.target.value || 10, max)));
  });
  $('replay-start-range').addEventListener('input', (e) => syncReplayInputs(+e.target.value));

  $('btn-jump-start').addEventListener('click', jumpStart);
  $('btn-step-back').addEventListener('click', () => { stopPlay(); stepBack(); });
  $('btn-play').addEventListener('click', () => { isPlaying() ? stopPlay() : startPlay(); });
  $('btn-step-fwd').addEventListener('click', () => { stopPlay(); stepForward(); });
  $('speed-select').addEventListener('change', restartWithSpeed);

  const scrubber = $('scrubber');
  scrubber.addEventListener('input', (e) => {
    if (state.mode !== 'replay') return;
    $('scrub-progress').textContent = progressText(+e.target.value);
  });
  scrubber.addEventListener('change', (e) => {
    if (state.mode !== 'replay') return;
    stopPlay();
    jumpTo(+e.target.value);
  });

  document.addEventListener('replay-play-state', (e) => setPlayIcon(e.detail));
  document.querySelector('.bp-tab[data-tab="indicators"]').addEventListener('click', refreshIndicatorLists);

  const refresh = () => { updateReplayControls(); updateBarTime(); };
  on('data-loaded', refresh);
  on('mode-changed', refresh);
  on('replay-index', refresh);
}
