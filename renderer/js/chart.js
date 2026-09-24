// مدیریت چارت klinecharts: تم تیره، ابزارهای سفارشی، اندیکاتورها

const K = window.klinecharts;

export const darkStyles = {
  grid: {
    horizontal: { show: true, size: 1, color: '#1e2230', style: 'dashed', dashedValue: [4, 4] },
    vertical: { show: true, size: 1, color: '#1e2230', style: 'dashed', dashedValue: [4, 4] }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888888',
      upBorderColor: '#26a69a', downBorderColor: '#ef5350', noChangeBorderColor: '#888888',
      upWickColor: '#26a69a', downWickColor: '#ef5350', noChangeWickColor: '#888888'
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#7e838f', textOffset: 4, textSize: 10, textFamily: 'monospace', textWeight: 'normal' },
      low: { show: true, color: '#7e838f', textOffset: 4, textSize: 10, textFamily: 'monospace', textWeight: 'normal' },
      last: {
        show: true, upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888888',
        line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
        text: { show: true, size: 10, family: 'monospace', weight: 'normal', color: '#ffffff', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
      }
    },
    tooltip: {
      showRule: 'always', showType: 'standard',
      defaultValue: 'n/a',
      text: { size: 11, family: 'monospace', color: '#d1d4dc' }
    }
  },
  indicator: {
    bars: [{ upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888' }],
    lines: [
      { size: 1, color: '#2962ff', style: 'solid', smooth: false },
      { size: 1, color: '#ff9800', style: 'solid', smooth: false },
      { size: 1, color: '#ab47bc', style: 'solid', smooth: false },
      { size: 1, color: '#26c6da', style: 'solid', smooth: false },
      { size: 1, color: '#eceff1', style: 'solid', smooth: false }
    ],
    circles: [{ color: '#26a69a' }],
    lastValueMark: { show: false, text: { show: false } },
    tooltip: {
      showRule: 'always', showType: 'standard', defaultValue: 'n/a',
      text: { size: 10, family: 'monospace', color: '#d1d4dc' }
    }
  },
  xAxis: {
    show: true, size: 'auto',
    axisLine: { show: true, color: '#2a2e39' },
    tickText: { show: true, color: '#7e838f', family: 'monospace', size: 10, marginStart: 4, marginEnd: 4 },
    tickLine: { show: true, size: 1, color: '#2a2e39', length: 3 }
  },
  yAxis: {
    show: true, size: 'auto', type: 'normal', position: 'right', inside: false, reverse: false,
    axisLine: { show: true, color: '#2a2e39' },
    tickText: { show: true, color: '#7e838f', family: 'monospace', size: 10, marginStart: 4, marginEnd: 4 },
    tickLine: { show: true, size: 1, color: '#2a2e39', length: 3 }
  },
  separator: { size: 1, color: '#2a2e39', fill: true, activeBackgroundColor: '#1c2030' },
  crosshair: {
    show: true,
    horizontal: {
      show: true, line: { show: true, style: 'dashed', size: 1, color: '#758696', dashedValue: [4, 4] },
      text: { show: true, color: '#0f1420', backgroundColor: '#758696', size: 10, family: 'monospace', weight: 'normal', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
    },
    vertical: {
      show: true, line: { show: true, style: 'dashed', size: 1, color: '#758696', dashedValue: [4, 4] },
      text: { show: true, color: '#0f1420', backgroundColor: '#758696', size: 10, family: 'monospace', weight: 'normal', paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
    }
  },
  overlay: {
    point: { color: '#2962ff', borderColor: '#ffffff', borderSize: 1, radius: 3, activeColor: '#2962ff', activeBorderColor: '#ffffff', activeBorderSize: 2, activeRadius: 4 },
    line: { size: 1.4, color: '#2962ff', style: 'solid', smooth: false, dashedValue: [4, 4] },
    rect: { style: 'fill', color: 'rgba(41,98,255,0.10)', borderColor: '#2962ff', borderSize: 1.2, borderRadius: 0 },
    circle: { style: 'fill', color: 'rgba(41,98,255,0.10)', borderColor: '#2962ff', borderSize: 1.2, borderStyle: 'solid' },
    polygon: { style: 'fill', color: 'rgba(41,98,255,0.10)', borderColor: '#2962ff', borderSize: 1.2 },
    arc: { size: 1.2, color: '#2962ff', style: 'solid', dashedValue: [4, 4] },
    text: { style: 'fill', color: '#2962ff', size: 11, family: 'sans-serif', weight: 'normal' }
  }
};

let chart = null;
let followLatest = true;
let programmaticViewport = false;

export function initChart (el) {
  chart = K.init(el, { styles: darkStyles });
  chart.setOffsetRightDistance(72);
  registerCustomShapes();
  if (K.ActionType && K.ActionType.OnVisibleRangeChange) {
    chart.subscribeAction(K.ActionType.OnVisibleRangeChange, () => {
      if (!programmaticViewport && !isAtRightEdge()) {
        followLatest = false;
        notifyViewport();
      }
    });
  }
  return chart;
}

export function getChart () { return chart; }

export function resize () {
  if (chart) chart.resize();
}

export function applyAppearance ({ theme = 'dark', accent = '#4c8dff' } = {}) {
  if (!chart) return;
  const light = theme === 'light';
  chart.setStyles({
    grid: {
      horizontal: { color: light ? '#e1e6ee' : '#1d2533' },
      vertical: { color: light ? '#e1e6ee' : '#1d2533' }
    },
    xAxis: {
      axisLine: { color: light ? '#cbd3df' : '#273143' },
      tickText: { color: light ? '#58657a' : '#8994a7' },
      tickLine: { color: light ? '#cbd3df' : '#273143' }
    },
    yAxis: {
      axisLine: { color: light ? '#cbd3df' : '#273143' },
      tickText: { color: light ? '#58657a' : '#8994a7' },
      tickLine: { color: light ? '#cbd3df' : '#273143' }
    },
    separator: { color: light ? '#cbd3df' : '#273143', activeBackgroundColor: light ? '#f0f3f8' : '#171d29' },
    candle: { tooltip: { text: { color: light ? '#182131' : '#e6eaf0' } } },
    indicator: { tooltip: { text: { color: light ? '#182131' : '#e6eaf0' } } },
    overlay: drawingStyles({ color: accent, width: drawingDefaults.width, style: drawingDefaults.style })
  });
}

function registerCustomShapes () {
  // مستطیل
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

  // دایره (نقطه اول = مرکز، نقطه دوم = شعاع)
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

  // ATR سفارشی
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
  const main = ['MA', 'EMA', 'BOLL', 'SAR', 'ATR'];
  const sub = ['MACD', 'RSI', 'KDJ', 'CCI', 'OBV', 'WR', 'ROC', 'DMI', 'BIAS', 'ATR'];
  const all = K.getSupportedIndicators();
  return all.filter(n => INDICATOR_LABELS[n]).map(n => ({ name: n, label: INDICATOR_LABELS[n], pane: main.includes(n) ? 'main' : 'sub' }));
}

export function addIndicator (name, pane = 'sub') {
  if (pane === 'main') {
    return chart.createIndicator(name, false, { id: 'candle_pane' });
  }
  return chart.createIndicator(name);
}

export function removeIndicatorById (paneId, name) {
  try { chart.removeIndicator(paneId, name); } catch (e) { /* ignore */ }
}

export function listIndicators () {
  // klinecharts v9: getIndicatorByPaneId() → Map<paneId, Map<name, Indicator>>
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

// ---------- Drawing tools ----------

const USER_DRAWING_GROUP = 'user-drawings';
const TRADE_GROUP = 'trade-overlays';
const PENDING_GROUP = 'pending-orders';
const DRAWING_LABELS = {
  segment: 'Trend line', rayLine: 'Ray', straightLine: 'Extended line',
  horizontalStraightLine: 'Horizontal line', horizontalRayLine: 'Horizontal ray',
  horizontalSegment: 'Horizontal segment', verticalStraightLine: 'Vertical line',
  parallelStraightLine: 'Parallel lines', priceChannelLine: 'Price channel',
  fibonacciLine: 'Fibonacci retracement', rectx: 'Rectangle', circlex: 'Circle'
};
const userDrawings = new Map();
const drawingListeners = new Set();
let activeTool = 'none';
let selectedDrawingId = null;
let drawingDefaults = { color: '#4c8dff', width: 2, style: 'solid' };

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

function selectFromEvent (event) {
  if (event && event.overlay && userDrawings.has(event.overlay.id)) {
    selectedDrawingId = event.overlay.id;
    notifyDrawings();
  }
  return false;
}

function deselectFromEvent (event) {
  if (event && event.overlay && selectedDrawingId === event.overlay.id) {
    selectedDrawingId = null;
    notifyDrawings();
  }
  return false;
}

function removeFromEvent (event) {
  if (event && event.overlay) {
    userDrawings.delete(event.overlay.id);
    if (selectedDrawingId === event.overlay.id) selectedDrawingId = null;
    notifyDrawings();
  }
  return false;
}

export function setTool (name) {
  activeTool = name;
  if (name === 'none') {
    notifyDrawings();
    return null;
  }
  const id = chart.createOverlay({
    name,
    groupId: USER_DRAWING_GROUP,
    styles: drawingStyles(drawingDefaults),
    onDrawEnd: (event) => {
      if (event && event.overlay) {
        const drawing = userDrawings.get(event.overlay.id);
        if (drawing) drawing.complete = true;
        selectedDrawingId = event.overlay.id;
      }
      activeTool = 'none';
      notifyDrawings();
      return false;
    },
    onSelected: selectFromEvent,
    onDeselected: deselectFromEvent,
    onRemoved: removeFromEvent
  });
  if (id) {
    userDrawings.set(id, {
      id,
      name,
      label: DRAWING_LABELS[name] || name,
      color: drawingDefaults.color,
      width: drawingDefaults.width,
      style: drawingDefaults.style,
      lock: false,
      visible: true,
      complete: false
    });
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
  return true;
}

export function removeSelectedDrawing () {
  if (!selectedDrawingId) return false;
  const id = selectedDrawingId;
  chart.removeOverlay(id);
  userDrawings.delete(id);
  selectedDrawingId = null;
  notifyDrawings();
  return true;
}

export function clearDrawings () {
  chart.removeOverlay({ groupId: USER_DRAWING_GROUP });
  userDrawings.clear();
  selectedDrawingId = null;
  notifyDrawings();
}

// ---------- Trading overlays ----------

const tradeOverlays = new Set();
const pendingOverlays = new Set();

export function addTradeMarker ({ timestamp, value, text, color }) {
  const id = 'trade_' + timestamp + '_' + Math.random().toString(36).slice(2, 7);
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
    }
  });
  tradeOverlays.add(id);
  return id;
}

export function removeTradeMarker (id) {
  if (tradeOverlays.has(id)) {
    chart.removeOverlay(id);
    tradeOverlays.delete(id);
  }
}

export function clearTradeMarkers () {
  for (const id of tradeOverlays) {
    try { chart.removeOverlay(id); } catch (e) { /* ignore */ }
  }
  tradeOverlays.clear();
  clearPendingOrderLines();
}

export function addPriceLine (value, color, title) {
  const id = 'pl_' + Math.random().toString(36).slice(2, 9);
  chart.createOverlay({
    id,
    groupId: TRADE_GROUP,
    name: 'priceLine',
    lock: true,
    points: [{ value }],
    extendData: { text: title || '' },
    styles: { line: { color, size: 1, style: 'dashed', dashedValue: [6, 4] } }
  });
  tradeOverlays.add(id);
  return id;
}

export function addPendingOrderLine (id, value, color, title) {
  const overlayId = 'pending_' + id;
  chart.createOverlay({
    id: overlayId,
    groupId: PENDING_GROUP,
    name: 'priceLine',
    lock: true,
    points: [{ value }],
    extendData: { text: title },
    styles: { line: { color, size: 1, style: 'dashed', dashedValue: [5, 4] } }
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
