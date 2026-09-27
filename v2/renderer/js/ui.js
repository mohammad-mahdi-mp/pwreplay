// سیم‌کشی رابط کاربری v2: مودال‌ها، تب‌ها، جریان CSV، کنترل‌های ریپلی، اسکرابر، تب اندیکاتورها
// رندر معاملات/مارجین در app.js انجام می‌شود؛ این فایل فقط نمایش و کنترل سطح بالاست

import { state, on, addDataset, formatTime } from './core/store.js';
import * as chartApi from './chart.js';
import { parseCsv } from './core/csv.js';
import { generateSampleCandles } from './core/sample.js';
import { enterReplay, exitReplay, startPlay, stopPlay, stepForward, stepBack, jumpStart, jumpTo, isPlaying, restartWithSpeed } from './core/replay.js';

// ---------- توست و مودال ----------

export function toast (msg, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

export function openModal (id) {
  document.getElementById(id).classList.remove('hidden');
}

export function closeModal (id) {
  document.getElementById(id).classList.add('hidden');
}

// ---------- جریان CSV ----------

let pendingFile = null; // { name, text }

function csvOpts () {
  return {
    delimiter: document.getElementById('csv-delimiter').value,
    hasHeader: document.getElementById('csv-has-header').checked,
    timeUnit: document.getElementById('csv-time-unit').value
  };
}

function mappingFromUi () {
  return {
    time: +document.getElementById('map-time').value,
    open: +document.getElementById('map-open').value,
    high: +document.getElementById('map-high').value,
    low: +document.getElementById('map-low').value,
    close: +document.getElementById('map-close').value,
    volume: +document.getElementById('map-volume').value
  };
}

function fillMappingSelects (header, mapping, hasHeader) {
  const ids = ['map-time', 'map-open', 'map-high', 'map-low', 'map-close', 'map-volume'];
  const nCols = header.length;
  for (const id of ids) {
    const sel = document.getElementById(id);
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = '—';
    sel.appendChild(none);
    for (let i = 0; i < nCols; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = hasHeader ? header[i] : 'Column ' + (i + 1);
      sel.appendChild(opt);
    }
  }
  document.getElementById('map-time').value = String(mapping.time);
  document.getElementById('map-open').value = String(mapping.open);
  document.getElementById('map-high').value = String(mapping.high);
  document.getElementById('map-low').value = String(mapping.low);
  document.getElementById('map-close').value = String(mapping.close);
  document.getElementById('map-volume').value = String(mapping.volume);
}

function renderPreview (res) {
  const table = document.getElementById('csv-preview');
  table.textContent = '';
  const rows = res.preview || [];
  if (!rows.length) return;
  const hasHeader = document.getElementById('csv-has-header').checked;
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const cols = rows[0].length;
  for (let i = 0; i < cols; i++) {
    const th = document.createElement('th');
    th.textContent = hasHeader && res.header[i] != null ? res.header[i] : 'Column ' + (i + 1);
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const dataRows = hasHeader ? rows.slice(1) : rows;
  for (const r of dataRows) {
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

function refreshCsvPreview () {
  if (!pendingFile) return;
  const status = document.getElementById('csv-status');
  const loadBtn = document.getElementById('btn-csv-load');
  const headerRow = parseCsvFirstHeader(pendingFile.text, csvOpts());
  const res = parseCsv(pendingFile.text, { ...csvOpts(), mapping: undefined });

  fillMappingSelects(headerRow, res.mapping || { time: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 }, document.getElementById('csv-has-header').checked);
  renderPreview(res);

  if (res.ok) {
    status.textContent = `${res.candles.length.toLocaleString('en-US')} valid bars` + (res.skipped ? ` · ${res.skipped} invalid rows skipped` : '');
    status.style.color = 'var(--green)';
    loadBtn.disabled = false;
  } else {
    status.textContent = (res.errors || []).join(' · ');
    status.style.color = 'var(--red)';
    loadBtn.disabled = true;
  }
}

// هدر خام برای ساخت سلکت‌های نگاشت (مستقل از موفقیت پارس)
function parseCsvFirstHeader (text, opts) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const byDelim = (d) => {
    const out = []; let cur = '', inQ = false;
    for (const ch of lines[0]) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const first = opts.delimiter === 'auto' || !opts.delimiter
    ? byDelim(sniffDelimQuick(text))
    : byDelim(opts.delimiter === '\\t' ? '\t' : opts.delimiter);
  if (opts.hasHeader) return first;
  const second = lines[1] ? byDelim(opts.delimiter === 'auto' || !opts.delimiter ? sniffDelimQuick(text) : (opts.delimiter === '\\t' ? '\t' : opts.delimiter)) : first;
  return second.map((_, i) => 'col' + i);
}

function sniffDelimQuick (text) {
  const line = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = [
    { d: ',', n: (line.match(/,/g) || []).length },
    { d: ';', n: (line.match(/;/g) || []).length },
    { d: '\t', n: (line.match(/\t/g) || []).length },
    { d: '|', n: (line.match(/\|/g) || []).length }
  ].sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

function acceptFile (name, text) {
  pendingFile = { name, text };
  document.getElementById('csv-file-name').textContent = name;
  document.getElementById('csv-options').classList.remove('hidden');
  const guessed = name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').toUpperCase();
  document.getElementById('csv-symbol').value = guessed.slice(0, 24) || 'MY-SYMBOL';
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
  const symbol = document.getElementById('csv-symbol').value.trim() || 'MY-SYMBOL';
  const tf = document.getElementById('csv-tf').value;
  addDataset(res.candles, symbol, tf);
  closeModal('csv-modal');
  toast(`${res.candles.length.toLocaleString('en-US')} bars loaded`, 'ok');
}

function openCsvModal () {
  pendingFile = null;
  document.getElementById('csv-file-name').textContent = '';
  document.getElementById('csv-options').classList.add('hidden');
  document.getElementById('csv-status').textContent = '';
  document.getElementById('btn-csv-load').disabled = true;
  openModal('csv-modal');
}

function loadSample () {
  const candles = generateSampleCandles(3000);
  addDataset(candles, 'SAMPLE', 'M15');
  toast('3,000 sample bars generated', 'ok');
}

// ---------- مودال شروع ریپلی ----------

function syncReplayInputs (v) {
  document.getElementById('replay-start-num').value = v;
  document.getElementById('replay-start-range').value = v;
  const info = document.getElementById('replay-start-info');
  if (state.candles[v]) {
    info.textContent = `Bar ${v} of ${state.candles.length} · ${formatTime(state.candles[v].timestamp)}`;
  }
}

function openReplayModal () {
  const max = Math.max(10, state.candles.length - 2);
  document.getElementById('replay-start-range').max = max;
  const numInput = document.getElementById('replay-start-num');
  numInput.max = max;
  const current = Math.min(100, max);
  numInput.min = 10;
  syncReplayInputs(current);
  openModal('replay-modal');
}

// ---------- کنترل‌های ریپلی ----------

function updateReplayControls () {
  const inReplay = state.mode === 'replay';
  const toggleBtn = document.getElementById('btn-replay-toggle');
  toggleBtn.textContent = inReplay ? 'Exit Replay' : 'Start Replay';
  toggleBtn.disabled = !state.loaded;

  ['btn-jump-start', 'btn-step-back', 'btn-play', 'btn-step-fwd'].forEach(id => {
    document.getElementById(id).disabled = !inReplay;
  });
  const scrubber = document.getElementById('scrubber');
  scrubber.disabled = !inReplay;
  scrubber.max = Math.max(0, state.candles.length - 1);
  if (inReplay) {
    scrubber.value = state.replayIndex;
    document.getElementById('scrub-min').textContent = String(state.replayStart);
    const progress = ((state.replayIndex - state.replayStart) / Math.max(1, state.candles.length - 1 - state.replayStart)) * 100;
    document.getElementById('scrub-progress').textContent = `${progress.toFixed(1)}%`;
  } else {
    scrubber.value = 0;
    document.getElementById('scrub-min').textContent = '0';
    document.getElementById('scrub-progress').textContent = state.loaded ? 'Ready' : 'No data';
  }
  document.getElementById('scrub-max').textContent = String(Math.max(0, state.candles.length - 1));
  setPlayIcon (isPlaying());
}

const PLAY_SVG = '<svg viewBox="0 0 16 16"><path d="M4.5 3l8 5-8 5z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 16 16"><path d="M4.5 3.5h3v9h-3zM8.5 3.5h3v9h-3z" fill="currentColor"/></svg>';
function setPlayIcon (playing) {
  const btn = document.getElementById('btn-play');
  if (!btn) return;
  btn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  btn.classList.toggle('playing', playing);
}

function updateBarTime () {
  const el = document.getElementById('bar-time');
  if (!state.loaded) { el.textContent = '—'; return; }
  const idx = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  const c = state.candles[idx];
  el.textContent = c ? formatTime(c.timestamp) : '—';
}

function toggleReplay () {
  if (!state.loaded) return;
  if (state.mode === 'replay') {
    stopPlay();
    exitReplay();
    toast('Replay session ended', 'info');
  } else {
    openReplayModal();
  }
}

// ---------- تب اندیکاتورها ----------

function refreshIndicatorLists () {
  const activeUl = document.getElementById('ind-active');
  const availUl = document.getElementById('ind-available');
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
  // تب‌ها
  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.bp-page').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // بستن مودال‌ها
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
  document.getElementById('btn-csv-cancel').addEventListener('click', () => closeModal('csv-modal'));
  document.getElementById('btn-replay-cancel').addEventListener('click', () => closeModal('replay-modal'));

  // بارگذاری داده
  document.getElementById('btn-import').addEventListener('click', openCsvModal);
  document.getElementById('btn-import-empty').addEventListener('click', openCsvModal);
  document.getElementById('btn-sample').addEventListener('click', loadSample);
  document.getElementById('btn-sample-empty').addEventListener('click', loadSample);

  // مودال CSV
  const dropZone = document.getElementById('csv-drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  document.getElementById('btn-csv-pick').addEventListener('click', pickFile);
  ['csv-delimiter', 'csv-has-header', 'csv-time-unit'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshCsvPreview);
  });
  ['map-time', 'map-open', 'map-high', 'map-low', 'map-close', 'map-volume'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const res = parseCsv(pendingFile ? pendingFile.text : '', { ...csvOpts(), mapping: mappingFromUi() });
      const status = document.getElementById('csv-status');
      const loadBtn = document.getElementById('btn-csv-load');
      if (res.ok) {
        status.textContent = `${res.candles.length.toLocaleString('en-US')} valid bars` + (res.skipped ? ` · ${res.skipped} invalid rows skipped` : '');
        status.style.color = 'var(--green)';
        loadBtn.disabled = false;
      } else {
        status.textContent = (res.errors || []).join(' · ');
        status.style.color = 'var(--red)';
        loadBtn.disabled = true;
      }
    });
  });
  document.getElementById('btn-csv-load').addEventListener('click', loadCsvOnChart);

  // ریپلی
  document.getElementById('btn-replay-toggle').addEventListener('click', toggleReplay);
  document.getElementById('btn-replay-start').addEventListener('click', () => {
    const v = Math.max(10, Math.min(+document.getElementById('replay-start-num').value || 100, state.candles.length - 1));
    closeModal('replay-modal');
    enterReplay(v);
    toast(`Replay started at bar ${v}`, 'ok');
  });
  document.getElementById('replay-start-num').addEventListener('input', (e) => {
    const max = +document.getElementById('replay-start-range').max;
    const v = Math.max(10, Math.min(+e.target.value || 10, max));
    syncReplayInputs(v);
  });
  document.getElementById('replay-start-range').addEventListener('input', (e) => {
    document.getElementById('replay-start-num').value = e.target.value;
    syncReplayInputs(+e.target.value);
  });

  // کنترل‌های پخش
  document.getElementById('btn-jump-start').addEventListener('click', jumpStart);
  document.getElementById('btn-step-back').addEventListener('click', () => { stopPlay(); stepBack(); });
  document.getElementById('btn-play').addEventListener('click', () => { isPlaying() ? stopPlay() : startPlay(); });
  document.getElementById('btn-step-fwd').addEventListener('click', () => { stopPlay(); stepForward(); });
  document.getElementById('speed-select').addEventListener('change', restartWithSpeed);

  // اسکرابر: پیش‌نمایش هنگام کشیدن، اعمال یک‌باره هنگام رها کردن
  const scrubber = document.getElementById('scrubber');
  scrubber.addEventListener('input', (e) => {
    if (state.mode !== 'replay') return;
    const target = +e.target.value;
    const progress = ((target - state.replayStart) / Math.max(1, state.candles.length - 1 - state.replayStart)) * 100;
    document.getElementById('scrub-progress').textContent = `${progress.toFixed(1)}%`;
  });
  scrubber.addEventListener('change', (e) => {
    if (state.mode !== 'replay') return;
    stopPlay();
    jumpTo(+e.target.value);
  });

  // وضعیت پخش از موتور ریپلی (رویداد DOM سبک‌وزن)
  document.addEventListener('replay-play-state', (e) => {
    setPlayIcon(e.detail);
  });

  // refresh اندیکاتورها پس از تب
  document.querySelector('.bp-tab[data-tab="indicators"]').addEventListener('click', refreshIndicatorLists);

  // رویدادهای store
  onStoreEvents();
}

function onStoreEvents () {
  on('data-loaded', () => {
    updateReplayControls();
    updateBarTime();
  });

  on('mode-changed', () => {
    updateReplayControls();
    updateBarTime();
  });

  on('replay-index', () => {
    updateReplayControls();
    updateBarTime();
  });
}
