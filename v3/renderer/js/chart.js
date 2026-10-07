// مدیریت چارت klinecharts: تم، ابزارهای سفارشی، اندیکاتورها، ترسیم‌های ماندگار (v3)

const K = window.klinecharts;

export const darkStyles = {
  grid: {
    horizontal: { show: true, size: 1, color: '#171c24', style: 'dashed', dashedValue: [3, 5] },
    vertical: { show: true, size: 1, color: '#171c24', style: 'dashed', dashedValue: [3, 5] }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: '#0ecb81', downColor: '#f6465d', noChangeColor: '#848e9c',
      upBorderColor: '#0ecb81', downBorderColor: '#f6465d', noChangeBorderColor: '#848e9c',
      upWickColor: '#0ecb81', downWickColor: '#f6465d', noChangeWickColor: '#848e9c'
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#5a6270', textOffset: 4, textSize: 10, textFamily: 'monospace', textWeight: 'normal' },
      low: { show: true, color: '#5a6270', textOffset: 4, textSize: 10, textFamily: 'monospace', textWeight: 'normal' },
      last: {
        show: true, upColor: '#0ecb81', downColor: '#f6465d', noChangeColor: '#848e9c',
        line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
        text: { show: true, size: 10, family: 'monospace', weight: 'normal', color: '#ffffff', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
      }
    },
    tooltip: {
      showRule: 'none', showType: 'standard',
      defaultValue: 'n/a',
      text: { size: 11, family: 'monospace', color: '#c7ccd4' }
    }
  },
  indicator: {
    bars: [{ upColor: '#0ecb81', downColor: '#f6465d', noChangeColor: '#848e9c' }],
    lines: [
      { size: 1, color: '#e8b339', style: 'solid', smooth: false },
      { size: 1, color: '#58a6ff', style: 'solid', smooth: false },
      { size: 1, color: '#bc8cff', style: 'solid', smooth: false },
      { size: 1, color: '#39c5cf', style: 'solid', smooth: false },
      { size: 1, color: '#e0e0e0', style: 'solid', smooth: false }
    ],
    circles: [{ color: '#0ecb81' }],
    lastValueMark: { show: false, text: { show: false } },
    tooltip: {
      showRule: 'always', showType: 'standard', defaultValue: 'n/a',
      text: { size: 10, family: 'monospace', color: '#c7ccd4' }
    }
  },
  xAxis: {
    show: true, size: 'auto',
    axisLine: { show: true, color: '#272e39' },
    tickText: { show: true, color: '#6b7482', family: 'monospace', size: 10, marginStart: 4, marginEnd: 4 },
    tickLine: { show: true, size: 1, color: '#272e39', length: 3 }
  },
  yAxis: {
    show: true, size: 'auto', type: 'normal', position: 'right', inside: false, reverse: false,
    axisLine: { show: true, color: '#272e39' },
    tickText: { show: true, color: '#6b7482', family: 'monospace', size: 10, marginStart: 4, marginEnd: 4 },
    tickLine: { show: true, size: 1, color: '#272e39', length: 3 }
  },
  separator: { size: 1, color: '#272e39', fill: true, activeBackgroundColor: '#1a1f28' },
  crosshair: {
    show: true,
    horizontal: {
      show: true, line: { show: true, style: 'dashed', size: 1, color: '#7d8590', dashedValue: [4, 4] },
      text: { show: true, color: '#0c0e11', backgroundColor: '#e8b339', size: 10, family: 'monospace', weight: 'bold', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
    },
    vertical: {
      show: true, line: { show: true, style: 'dashed', size: 1, color: '#7d8590', dashedValue: [4, 4] },
      text: { show: true, color: '#0c0e11', backgroundColor: '#e8b339', size: 10, family: 'monospace', weight: 'bold', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
    }
  },
  overlay: {
    point: { color: '#e8b339', borderColor: '#ffffff', borderSize: 1, radius: 3, activeColor: '#e8b339', activeBorderColor: '#ffffff', activeBorderSize: 2, activeRadius: 4 },
    line: { size: 1.4, color: '#e8b339', style: 'solid', smooth: false, dashedValue: [4, 4] },
    rect: { style: 'fill', color: 'rgba(232,179,57,0.10)', borderColor: '#e8b339', borderSize: 1.2, borderRadius: 0 },
    circle: { style: 'fill', color: 'rgba(232,179,57,0.10)', borderColor: '#e8b339', borderSize: 1.2, borderStyle: 'solid' },
    polygon: { style: 'fill', color: 'rgba(232,179,57,0.10)', borderColor: '#e8b339', borderSize: 1.2 },
    arc: { size: 1.2, color: '#e8b339', style: 'solid', dashedValue: [4, 4] },
    text: { style: 'fill', color: '#e8b339', size: 11, family: 'monospace', weight: 'normal' }
  }
};

let chart = null;
let followLatest = true;
let programmaticViewport = false;

function pixelToPoint (el, ev) {
  const rect = el.getBoundingClientRect();
  return chart.convertFromPixel(
    { x: ev.clientX - rect.left, y: ev.clientY - rect.top },
    { paneId: 'candle_pane', absolute: true }
  );
}

export function initChart (el) {
  chart = K.init(el, { styles: darkStyles });
  chart.setOffsetRightDistance(72);
  registerCustomShapes();

  // کلیک روی چارت با ابزار Trade: تبدیل پیکسل به زمان/قیمت
  let pointerDownAt = null;
  el.addEventListener('pointerdown', (ev) => {
    pointerDownAt = { x: ev.clientX, y: ev.clientY };
  });
  el.addEventListener('click', (ev) => {
    if (activeTool !== 'trade' || !onTradeClick) return;
    if (Date.now() - overlayClickConsumedAt < 150) return;
    if (pointerDownAt && Math.hypot(ev.clientX - pointerDownAt.x, ev.clientY - pointerDownAt.y) > 4) return;
    const res = pixelToPoint(el, ev);
    if (!res || !Number.isFinite(res.value)) return;
    onTradeClick(res.timestamp ?? null, res.value, { shift: ev.shiftKey, ctrl: ev.ctrlKey });
  });

  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (!onCtxMenuHandler) return;
    const res = pixelToPoint(el, ev);
    if (!res || !Number.isFinite(res.value)) return;
    onCtxMenuHandler(ev.clientX, ev.clientY, res.timestamp ?? null, res.value);
  });

  // Crosshair → bar legend (با rAF تا mousemove سنگین نشود)
  let legendFrame = 0;
  let lastMove = null;
  el.addEventListener('mousemove', (ev) => {
    if (!crosshairListeners.size) return;
    lastMove = ev;
    if (legendFrame) return;
    legendFrame = requestAnimationFrame(() => {
      legendFrame = 0;
      const res = lastMove ? pixelToPoint(el, lastMove) : null;
      if (!res || res.timestamp == null) { notifyCrosshair(null); return; }
      const data = chart.getDataList();
      const idx = Number.isInteger(res.dataIndex) ? res.dataIndex : -1;
      const candle = (idx >= 0 && data[idx] && data[idx].timestamp === res.timestamp) ? data[idx] : data.find(d => d.timestamp === res.timestamp) || null;
      notifyCrosshair(candle);
    });
  });
  el.addEventListener('mouseleave', () => { notifyCrosshair(null); });

  if (K.ActionType && K.ActionType.OnVisibleRangeChange) {
    chart.subscribeAction(K.ActionType.OnVisibleRangeChange, () => {
      if (!programmaticViewport && !isAtRightEdge()) {
        followLatest = false;
        notifyViewport();
      }
    });
  }

  // درگ دستی خطوط SL/TP: شکار mousedown روی canvas قبل از klinecharts
  el.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || !slTpLines.size) return;
    const rect = el.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    let hit = null;
    for (const [stableId, info] of slTpLines) {
      const px = chart.convertToPixel({ value: info.price }, { paneId: 'candle_pane', absolute: true });
      if (px && Number.isFinite(px.y) && Math.abs(px.y - y) <= 6) { hit = { stableId, info, startPrice: info.price, moved: false }; break; }
    }
    if (!hit) return;
    ev.stopPropagation();
    ev.preventDefault();
    const onMove = (m) => {
      const my = m.clientY - el.getBoundingClientRect().top;
      const res = chart.convertFromPixel({ y: my }, { paneId: 'candle_pane', absolute: true });
      if (!res || !Number.isFinite(res.value)) return;
      hit.moved = true;
      hit.info.price = res.value;
      chart.overrideOverlay({ id: hit.stableId, points: [{ value: res.value }] });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!hit.moved || Math.abs(hit.info.price - hit.startPrice) < 1e-9) {
        hit.info.price = hit.startPrice;
        chart.overrideOverlay({ id: hit.stableId, points: [{ value: hit.startPrice }] });
        consumeTradeOverlayClick(hit.info.positionId);
        return;
      }
      const price = hit.info.price;
      for (const fn of slTpDragListeners) {
        if (fn(hit.info.positionId, hit.stableId, price) === false) {
          hit.info.price = hit.startPrice;
          chart.overrideOverlay({ id: hit.stableId, points: [{ value: hit.startPrice }] });
          break;
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, true);

  return chart;
}

export function getChart () { return chart; }

export function resize () {
  if (chart) chart.resize();
}

export function applyAppearance ({ theme = 'dark', accent = '#e8b339' } = {}) {
  if (!chart) return;
  const light = theme === 'light';
  chart.setStyles({
    grid: {
      horizontal: { color: light ? '#e4e1d8' : '#171c24' },
      vertical: { color: light ? '#e4e1d8' : '#171c24' }
    },
    xAxis: {
      axisLine: { color: light ? '#d3cfc6' : '#272e39' },
      tickText: { color: light ? '#61656d' : '#6b7482' },
      tickLine: { color: light ? '#d3cfc6' : '#272e39' }
    },
    yAxis: {
      axisLine: { color: light ? '#d3cfc6' : '#272e39' },
      tickText: { color: light ? '#61656d' : '#6b7482' },
      tickLine: { color: light ? '#d3cfc6' : '#272e39' }
    },
    separator: { color: light ? '#d3cfc6' : '#272e39', activeBackgroundColor: light ? '#efede8' : '#1a1f28' },
    candle: { tooltip: { text: { color: light ? '#22252a' : '#c7ccd4' } } },
    indicator: { tooltip: { text: { color: light ? '#22252a' : '#c7ccd4' } } },
    overlay: drawingStyles({ color: accent, width: drawingDefaults.width, style: drawingDefaults.style })
  });
}

function registerCustomShapes () {
  K.registerOverlay({
    name: 'rectx',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      const [c1, c2] = coordinates;
      return [{
        key: 'rect',
        type: 'rect',
        attrs: {
          x: Math.min(c1.x, c2.x),
          y: Math.min(c1.y, c2.y),
          width: Math.abs(c2.x - c1.x),
          height: Math.abs(c2.y - c1.y)
        }
      }];
    }
  });

  K.registerOverlay({
    name: 'circlex',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      const [c1, c2] = coordinates;
      const r = Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
      return [{ key: 'circle', type: 'circle', attrs: { x: c1.x, y: c1.y, r } }];
    }
  });

  // ابزار اندازه‌گیری فاصله قیمت/کندل (جدید در v3)
  K.registerOverlay({
    name: 'measurex',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2 || overlay.points.length < 2) return [];
      const [c1, c2] = coordinates;
      const [p1, p2] = overlay.points;
      const diff = p2.value - p1.value;
      const pct = p1.value ? diff / p1.value * 100 : 0;
      const bars = (Number.isInteger(p1.dataIndex) && Number.isInteger(p2.dataIndex)) ? p2.dataIndex - p1.dataIndex : null;
      const up = diff >= 0;
      const fill = up ? 'rgba(14,203,129,0.14)' : 'rgba(246,70,93,0.14)';
      const border = up ? '#0ecb81' : '#f6465d';
      const digits = Math.abs(p1.value) >= 1000 ? 2 : 5;
      const text = `${up ? '+' : ''}${diff.toFixed(digits)} (${pct.toFixed(2)}%)` + (bars != null ? ` · ${bars} bars` : '');
      return [
        { type: 'rect', attrs: { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y), width: Math.abs(c2.x - c1.x), height: Math.abs(c2.y - c1.y) }, styles: { style: 'stroke_fill', color: fill, borderColor: border, borderSize: 1 }, ignoreEvent: true },
        { type: 'line', attrs: { coordinates: [c1, c2] }, styles: { color: border, size: 1, style: 'dashed', dashedValue: [4, 3] }, ignoreEvent: true },
        { type: 'text', attrs: { x: (c1.x + c2.x) / 2, y: Math.min(c1.y, c2.y) - 4, text, align: 'center', baseline: 'bottom' }, styles: { color: '#ffffff', backgroundColor: border, size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 2 }, ignoreEvent: true }
      ];
    }
  });

  K.registerIndicator({
    name: 'ATR',
    shortName: 'ATR',
    calcParams: [14],
    figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] || 14;
      const tr = [];
      for (let i = 0; i < dataList.length; i++) {
        const c = dataList[i];
        const pc = i > 0 ? dataList[i - 1].close : c.close;
        tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
      }
      const result = [];
      let prev = null;
      for (let i = 0; i < tr.length; i++) {
        if (i < period - 1) { result.push({ atr: NaN }); continue; }
        if (i === period - 1) {
          let s = 0;
          for (let j = 0; j < period; j++) s += tr[j];
          prev = s / period;
        } else {
          prev = (prev * (period - 1) + tr[i]) / period;
        }
        result.push({ atr: prev });
      }
      return result;
    }
  });
}

// ---------- داده‌ها ----------

export function applyAll (candles) {
  programmaticViewport = true;
  chart.applyNewData(candles, false, () => {
    requestAnimationFrame(() => { programmaticViewport = false; });
  });
}

export function applySlice (candles, n, keepFollowing = followLatest) {
  programmaticViewport = true;
  chart.applyNewData(candles.slice(0, n), false, () => {
    if (keepFollowing) chart.scrollToRealTime(0);
    requestAnimationFrame(() => { programmaticViewport = false; });
  });
}

export function appendCandle (candle, animationMs = 0) {
  chart.updateData(candle);
  if (followLatest) {
    programmaticViewport = true;
    chart.scrollToRealTime(animationMs);
    requestAnimationFrame(() => { programmaticViewport = false; });
  }
}

export function scrollToRealTime (animationMs = 0) {
  try {
    programmaticViewport = true;
    chart.scrollToRealTime(animationMs);
    requestAnimationFrame(() => { programmaticViewport = false; });
  } catch (e) { /* ignore */ }
}

export function setFollowMode (enabled) {
  followLatest = Boolean(enabled);
  if (followLatest) scrollToRealTime(160);
  notifyViewport();
}

export function isFollowing () { return followLatest; }

const viewportListeners = new Set();
export function onViewportChange (fn) {
  viewportListeners.add(fn);
  return () => viewportListeners.delete(fn);
}
function notifyViewport () {
  for (const fn of viewportListeners) fn({ following: followLatest });
}

export function isAtRightEdge () {
  try {
    const vr = chart.getVisibleRange();
    const list = chart.getDataList();
    return vr.to >= list.length - 2;
  } catch (e) { return true; }
}

// ---------- اندیکاتورها ----------

const INDICATOR_LABELS = {
  MA: 'Moving Average', EMA: 'Exponential Moving Average', BOLL: 'Bollinger Bands',
  SAR: 'Parabolic SAR', MACD: 'MACD', KDJ: 'KDJ', RSI: 'Relative Strength Index',
  BIAS: 'Bias Ratio', BRAR: 'BRAR', CCI: 'Commodity Channel Index', DMI: 'Directional Movement', CR: 'CR',
  OBV: 'On-Balance Volume', PVT: 'Price Volume Trend', PSY: 'Psychological Line', ROC: 'Rate of Change', WR: 'Williams %R',
  EMV: 'Ease of Movement', MTM: 'Momentum', TRIX: 'TRIX', ATR: 'Average True Range',
  AVP: 'Average Price', AO: 'Awesome Oscillator', BBI: 'Bull and Bear Index', DMA: 'DMA', VR: 'Volume Ratio', VOL: 'Volume'
};

export function availableIndicators () {
  const main = ['MA', 'EMA', 'BOLL', 'SAR', 'BBI'];
  const all = K.getSupportedIndicators();
  return all.filter(n => INDICATOR_LABELS[n]).map(n => ({ name: n, label: INDICATOR_LABELS[n], pane: main.includes(n) ? 'main' : 'sub' }));
}

export function addIndicator (name, pane = 'sub') {
  if (pane === 'main') {
    return chart.createIndicator(name, true, { id: 'candle_pane' });
  }
  return chart.createIndicator(name);
}

export function removeIndicatorById (paneId, name) {
  try { chart.removeIndicator(paneId, name); } catch (e) { /* ignore */ }
}

export function listIndicators () {
  try {
    const byPane = chart.getIndicatorByPaneId();
    const out = [];
    byPane.forEach((nameMap, paneId) => {
      nameMap.forEach((ind) => {
        out.push({ name: ind.name, shortName: ind.shortName, paneId });
      });
    });
    return out;
  } catch (e) { return []; }
}

// ---------- Drawing tools (با ذخیره/بازیابی) ----------

const USER_DRAWING_GROUP = 'user-drawings';
const TRADE_GROUP = 'trade-overlays';
const PENDING_GROUP = 'pending-orders';
const DRAWING_LABELS = {
  segment: 'Trend line', rayLine: 'Ray', straightLine: 'Extended line',
  horizontalStraightLine: 'Horizontal line', horizontalRayLine: 'Horizontal ray',
  horizontalSegment: 'Horizontal segment', verticalStraightLine: 'Vertical line',
  parallelStraightLine: 'Parallel lines', priceChannelLine: 'Price channel',
  fibonacciLine: 'Fibonacci retracement', rectx: 'Rectangle', circlex: 'Circle', measurex: 'Measure'
};
const userDrawings = new Map();
const drawingListeners = new Set();
const persistListeners = new Set();
let activeTool = 'none';
let selectedDrawingId = null;
let drawingDefaults = { color: '#e8b339', width: 2, style: 'solid' };

function drawingStyles ({ color, width, style }) {
  const dashedValue = style === 'dashed' ? [6, 4] : [4, 4];
  return {
    point: { color, borderColor: '#ffffff', activeColor: color, activeBorderColor: '#ffffff' },
    line: { color, size: width, style, dashedValue },
    rect: { color: color + '20', borderColor: color, borderSize: width, borderStyle: style },
    circle: { color: color + '20', borderColor: color, borderSize: width, borderStyle: style },
    polygon: { color: color + '20', borderColor: color, borderSize: width, borderStyle: style },
    arc: { color, size: width, style, dashedValue },
    text: { color }
  };
}

function notifyDrawings () {
  const payload = { drawings: listUserDrawings(), selectedId: selectedDrawingId };
  for (const fn of drawingListeners) fn(payload);
}

function notifyPersist () {
  for (const fn of persistListeners) fn(serializeDrawings());
}

export function onDrawingsPersist (fn) {
  persistListeners.add(fn);
  return () => persistListeners.delete(fn);
}

function overlayCallbacks () {
  return {
    onDrawEnd: (event) => {
      if (event && event.overlay) {
        const drawing = userDrawings.get(event.overlay.id);
        if (drawing) drawing.complete = true;
        selectedDrawingId = event.overlay.id;
      }
      activeTool = 'none';
      notifyDrawings();
      notifyPersist();
      return false;
    },
    onPressedMoveEnd: () => { notifyPersist(); return false; },
    onSelected: (event) => {
      if (event && event.overlay && userDrawings.has(event.overlay.id)) {
        selectedDrawingId = event.overlay.id;
        notifyDrawings();
      }
      return false;
    },
    onDeselected: (event) => {
      if (event && event.overlay && selectedDrawingId === event.overlay.id) {
        selectedDrawingId = null;
        notifyDrawings();
      }
      return false;
    },
    onRemoved: (event) => {
      if (event && event.overlay && userDrawings.has(event.overlay.id)) {
        userDrawings.delete(event.overlay.id);
        if (selectedDrawingId === event.overlay.id) selectedDrawingId = null;
        notifyDrawings();
        notifyPersist();
      }
      return false;
    }
  };
}

function createUserOverlay (name, settings, points = null) {
  const opts = {
    name,
    groupId: USER_DRAWING_GROUP,
    styles: drawingStyles(settings),
    lock: Boolean(settings.lock),
    visible: settings.visible !== false,
    ...overlayCallbacks()
  };
  if (points) opts.points = points;
  const id = chart.createOverlay(opts);
  if (id) {
    userDrawings.set(id, {
      id,
      name,
      label: DRAWING_LABELS[name] || name,
      color: settings.color,
      width: settings.width,
      style: settings.style,
      lock: Boolean(settings.lock),
      visible: settings.visible !== false,
      complete: Boolean(points)
    });
  }
  return id;
}

export function setTool (name) {
  activeTool = name;
  if (name === 'none' || name === 'trade') {
    notifyDrawings();
    return null;
  }
  const id = createUserOverlay(name, drawingDefaults);
  if (id) {
    selectedDrawingId = id;
    notifyDrawings();
  }
  return id;
}

export function getTool () { return activeTool; }

export function onDrawingsChange (fn) {
  drawingListeners.add(fn);
  return () => drawingListeners.delete(fn);
}

export function listUserDrawings () {
  return [...userDrawings.values()].map(d => ({ ...d }));
}

// خروجی قابل ذخیره: فقط ترسیم‌های کامل‌شده با نقاط زمان/قیمت
export function serializeDrawings () {
  const out = [];
  for (const d of userDrawings.values()) {
    if (!d.complete) continue;
    let overlay = null;
    try { overlay = chart.getOverlayById(d.id); } catch (e) { overlay = null; }
    if (!overlay || !overlay.points || !overlay.points.length) continue;
    out.push({
      name: d.name,
      points: overlay.points.map(p => ({ timestamp: p.timestamp, value: p.value })),
      color: d.color, width: d.width, style: d.style, lock: d.lock, visible: d.visible
    });
  }
  return out;
}

export function restoreDrawings (list) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const d of list) {
    if (!d || !DRAWING_LABELS[d.name] || !Array.isArray(d.points) || !d.points.length) continue;
    const settings = { color: d.color || drawingDefaults.color, width: d.width || drawingDefaults.width, style: d.style || 'solid', lock: d.lock, visible: d.visible };
    if (createUserOverlay(d.name, settings, d.points)) n++;
  }
  selectedDrawingId = null;
  notifyDrawings();
  return n;
}

// پاک‌سازی بدون ثبت (برای عوض کردن دیتاست)
export function resetDrawings () {
  const ids = [...userDrawings.keys()];
  userDrawings.clear();
  selectedDrawingId = null;
  activeTool = activeTool === 'trade' ? 'trade' : 'none';
  try { chart.removeOverlay({ groupId: USER_DRAWING_GROUP }); } catch (e) {
    for (const id of ids) { try { chart.removeOverlay(id); } catch (err) { /* ignore */ } }
  }
  notifyDrawings();
}

export function selectDrawing (id) {
  selectedDrawingId = userDrawings.has(id) ? id : null;
  notifyDrawings();
}

export function setDrawingDefaults (settings) {
  drawingDefaults = { ...drawingDefaults, ...settings };
}

export function updateSelectedDrawing (settings) {
  const drawing = userDrawings.get(selectedDrawingId);
  if (!drawing) return false;
  Object.assign(drawing, settings);
  chart.overrideOverlay({
    id: drawing.id,
    lock: drawing.lock,
    visible: drawing.visible,
    styles: drawingStyles(drawing)
  });
  notifyDrawings();
  notifyPersist();
  return true;
}

export function removeSelectedDrawing () {
  if (!selectedDrawingId) return false;
  const id = selectedDrawingId;
  userDrawings.delete(id);
  selectedDrawingId = null;
  chart.removeOverlay(id);
  notifyDrawings();
  notifyPersist();
  return true;
}

export function clearDrawings () {
  resetDrawings();
  notifyPersist();
}

let onTradeClick = null;
export function setTradeClickHandler (fn) {
  onTradeClick = fn;
}

let onCtxMenuHandler = null;
export function setContextMenuHandler (fn) {
  onCtxMenuHandler = fn;
}

const crosshairListeners = new Set();
export function onCrosshairChange (fn) {
  crosshairListeners.add(fn);
  return () => crosshairListeners.delete(fn);
}
function notifyCrosshair (candle) {
  for (const fn of crosshairListeners) fn(candle);
}

let overlayClickConsumedAt = 0;
function consumeTradeOverlayClick (positionId) {
  overlayClickConsumedAt = Date.now();
  if (positionId) notifyPositionClick(positionId);
}

// ---------- Trading overlays ----------

const tradeOverlays = new Set();
const pendingOverlays = new Set();
const tradeBands = new Map();

const positionClickListeners = new Set();

function notifyPositionClick (positionId) {
  for (const fn of positionClickListeners) fn(positionId);
}

export function onPositionClick (fn) {
  positionClickListeners.add(fn);
  return () => positionClickListeners.delete(fn);
}

let markerSeq = 0;
export function addTradeMarker ({ timestamp, value, text, color, positionId }) {
  const id = 'trade_' + timestamp + '_' + (++markerSeq);
  chart.createOverlay({
    id,
    groupId: TRADE_GROUP,
    name: 'simpleAnnotation',
    lock: true,
    points: [{ timestamp, value }],
    extendData: text,
    styles: {
      line: { style: 'dashed', color },
      polygon: { color, borderColor: color },
      text: { color, size: 10, family: 'monospace', weight: 'bold' }
    },
    onClick: () => consumeTradeOverlayClick(positionId)
  });
  tradeOverlays.add(id);
  return id;
}

export function removeTradeMarker (id) {
  if (tradeOverlays.has(id)) {
    chart.removeOverlay(id);
    tradeOverlays.delete(id);
    slTpLines.delete(id);
  }
}

export function clearTradeMarkers () {
  try { chart.removeOverlay({ groupId: TRADE_GROUP }); } catch (e) {
    for (const id of tradeOverlays) { try { chart.removeOverlay(id); } catch (err) { /* ignore */ } }
  }
  tradeOverlays.clear();
  slTpLines.clear();
  tradeBands.clear();
  clearPendingOrderLines();
}

export function addPriceLine (value, color, title, positionId) {
  const id = 'pl_' + (++markerSeq);
  chart.createOverlay({
    id,
    groupId: TRADE_GROUP,
    name: 'priceLine',
    lock: true,
    points: [{ value }],
    extendData: { text: title || '' },
    styles: { line: { color, size: 1, style: 'dashed', dashedValue: [6, 4] } },
    onClick: () => consumeTradeOverlayClick(positionId)
  });
  tradeOverlays.add(id);
  return id;
}

const slTpDragListeners = new Set();
const slTpLines = new Map(); // stableId → { positionId, price }
export function onSlTpLineDrag (fn) {
  slTpDragListeners.add(fn);
  return () => slTpDragListeners.delete(fn);
}

export function addSlTpLine (stableId, value, color, title, positionId) {
  slTpLines.set(stableId, { positionId, price: value });
  chart.createOverlay({
    id: stableId,
    groupId: TRADE_GROUP,
    name: 'priceLine',
    lock: true,
    points: [{ value }],
    extendData: { text: title || '' },
    styles: {
      line: { color, size: 1.5, style: 'dashed', dashedValue: [6, 4] },
      point: { color, borderColor: color, radius: 0, activeRadius: 0 }
    },
    onClick: () => consumeTradeOverlayClick(positionId)
  });
  tradeOverlays.add(stableId);
  return stableId;
}

export function addPendingOrderLine (id, value, color, title, positionId) {
  const overlayId = 'pending_' + id;
  chart.createOverlay({
    id: overlayId,
    groupId: PENDING_GROUP,
    name: 'priceLine',
    lock: true,
    points: [{ value }],
    extendData: { text: title },
    styles: { line: { color, size: 1, style: 'dashed', dashedValue: [5, 4] } },
    onClick: () => consumeTradeOverlayClick(positionId)
  });
  pendingOverlays.add(overlayId);
  return overlayId;
}

export function removePendingOrderLine (id) {
  if (!id) return;
  try { chart.removeOverlay(id); } catch (e) { /* ignore */ }
  pendingOverlays.delete(id);
}

export function clearPendingOrderLines () {
  for (const id of pendingOverlays) {
    try { chart.removeOverlay(id); } catch (e) { /* ignore */ }
  }
  pendingOverlays.clear();
}

// ---------- Trade bands (risk/reward zones) ----------

export function addTradeBand (positionId, entryPrice, sl, tp, dir, barStart, barEnd) {
  removeTradeBand(positionId);
  const ids = {};

  if (sl != null) {
    const id = 'band_risk_' + positionId;
    chart.createOverlay({
      id, groupId: TRADE_GROUP, name: 'rectx', lock: true,
      points: [{ timestamp: barStart, value: dir > 0 ? entryPrice : sl }, { timestamp: barEnd, value: dir > 0 ? sl : entryPrice }],
      styles: { rect: { style: 'fill', color: 'rgba(246,70,93,0.12)', borderColor: 'rgba(246,70,93,0.3)', borderSize: 0 } }
    });
    tradeOverlays.add(id);
    ids.riskId = id;
  }

  if (tp != null) {
    const id = 'band_reward_' + positionId;
    chart.createOverlay({
      id, groupId: TRADE_GROUP, name: 'rectx', lock: true,
      points: [{ timestamp: barStart, value: dir > 0 ? tp : entryPrice }, { timestamp: barEnd, value: dir > 0 ? entryPrice : tp }],
      styles: { rect: { style: 'fill', color: 'rgba(14,203,129,0.10)', borderColor: 'rgba(14,203,129,0.25)', borderSize: 0 } }
    });
    tradeOverlays.add(id);
    ids.rewardId = id;
  }

  tradeBands.set(positionId, ids);
}

export function removeTradeBand (positionId) {
  const band = tradeBands.get(positionId);
  if (!band) return;
  for (const key of ['riskId', 'rewardId']) {
    if (band[key]) {
      try { chart.removeOverlay(band[key]); } catch (e) { /* ignore */ }
      tradeOverlays.delete(band[key]);
    }
  }
  tradeBands.delete(positionId);
}
