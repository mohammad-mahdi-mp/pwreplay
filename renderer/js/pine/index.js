// پل Pine → klinecharts: خروجی runPine را به اندیکاتور klinecharts تبدیل و روی چارت اعمال می‌کند

import { runPine } from './interpreter.js';
import { getChart } from '../chart.js';

let runCounter = 0;
let current = null; // { name, paneId }

export function removePineIndicator () {
  if (!current) return;
  try { getChart().removeIndicator(current.paneId, current.name); } catch (e) { /* ignore */ }
  current = null;
}

function plotFigure (plot) {
  const type = plot.style === 'bar' ? 'bar' : plot.style === 'circle' ? 'circle' : 'line';
  const fig = { key: plot.key, title: plot.title + ': ', type };
  if (type === 'circle') {
    fig.styles = (data) => ({
      color: data.current[plot.key + '_c'] || plot.color,
      size: Math.max(2, (plot.lineWidth || 1) * 3)
    });
  } else if (type === 'bar') {
    fig.styles = (data) => {
      const c = data.current[plot.key + '_c'] || plot.color;
      return {
        upColor: c, downColor: c, noChangeColor: c,
        upBorderColor: c, downBorderColor: c, noChangeBorderColor: c
      };
    };
  } else {
    fig.styles = (data) => ({
      color: data.current[plot.key + '_c'] || plot.color,
      size: plot.lineWidth || 1
    });
  }
  return fig;
}

function buildCalc (plots, shapes, hlines) {
  return (dataList) => {
    const len = dataList.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      const row = {};
      for (const p of plots) {
        row[p.key] = i < p.data.length ? p.data[i] : NaN;
        if (p.colorSeries) row[p.key + '_c'] = i < p.colorSeries.length ? p.colorSeries[i] : p.color;
      }
      for (const s of shapes) row[s.key] = i < s.data.length ? s.data[i] : NaN;
      for (const h of hlines) row[h.key] = h.value;
      out[i] = row;
    }
    return out;
  };
}

// اجرای کد Pine و اعمال خروجی روی چارت
export function runAndApplyPine (code, candles, opts = {}) {
  const chart = getChart();
  if (!chart) {
    return { ok: false, errors: [{ line: null, message: 'چارت آماده نیست' }], warnings: [], inputs: [] };
  }

  const result = runPine(code, candles, opts);
  if (!result.ok) return result;

  if (!result.plots.length && !result.shapes.length && !result.hlines.length) {
    result.warnings.push('هیچ خروجی رسمی پیدا نشد — حداقل یک plot() یا plotshape() یا hline() بنویسید');
    return result;
  }

  removePineIndicator();

  const name = 'pine_' + (++runCounter);
  const figures = [];

  for (const p of result.plots) figures.push(plotFigure(p));

  for (const s of result.shapes) {
    figures.push({
      key: s.key,
      title: s.title + ': ',
      type: 'circle',
      styles: (data) => ({
        color: data.current[s.key + '_c'] || s.color,
        size: 5
      })
    });
  }

  result.hlines.forEach((h, i) => {
    const key = 'h' + i;
    h.key = key;
    figures.push({
      key,
      title: 'hline: ',
      type: 'line',
      styles: () => ({ color: h.color, size: 1, style: h.style || 'solid' })
    });
  });

  const template = {
    name,
    shortName: String(result.title || 'Pine').slice(0, 18),
    figures,
    calc: buildCalc(result.plots, result.shapes, result.hlines)
  };
  if (result.precision != null) template.precision = result.precision;

  try {
    window.klinecharts.registerIndicator(template);
  } catch (e) {
    result.errors.push({ line: null, message: 'ثبت اندیکاتور ناموفق: ' + e.message });
    return { ...result, ok: false };
  }

  let paneId;
  if (result.overlay) {
    paneId = chart.createIndicator(name, false, { id: 'candle_pane' });
  } else {
    paneId = chart.createIndicator(name);
  }

  current = { name, paneId };
  return { ...result, applied: { name, paneId } };
}
