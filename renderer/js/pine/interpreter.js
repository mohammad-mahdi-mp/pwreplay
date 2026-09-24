// مفسر برداری زیرمجموعه Pine Script — کل سری به‌صورت آرایه محاسبه می‌شود

import { lex } from './lexer.js';
import { parse } from './parser.js';
import {
  PALETTE, isSeries, toSeries, zip, mapS, ta, math, colorNew
} from './builtins.js';

const SHAPE_CONSTS = {
  triangleup: 'triangleup', triangledown: 'triangledown', circle: 'circle',
  cross: 'cross', xcross: 'xcross', square: 'square', diamond: 'diamond',
  flag: 'flag', labelup: 'labelup', labeldown: 'labeldown', arrowup: 'arrowup', arrowdown: 'arrowdown'
};

const LOCATION_CONSTS = { abovebar: 'abovebar', belowbar: 'belowbar', absolute: 'absolute', top: 'top', bottom: 'bottom' };

const PLOT_STYLES = {
  'plot.style_line': 'line',
  'plot.style_linebr': 'line',
  'plot.style_stepline': 'line',
  'plot.style_stepline_diamond': 'line',
  'plot.style_histogram': 'bar',
  'plot.style_columns': 'bar',
  'plot.style_circles': 'circle',
  'plot.style_cross': 'circle',
  'plot.style_area': 'area',
  'plot.style_areabr': 'area'
};

const HL_STYLES = { 'hline.style_solid': 'solid', 'hline.style_dashed': 'dashed', 'hline.style_dotted': 'dotted' };

class PineError extends Error {
  constructor (msg, line) {
    super(line ? `خط ${line}: ${msg}` : msg);
    this.line = line;
  }
}

export function runPine (code, candles, opts = {}) {
  const n = candles.length;
  const errors = [];
  const warnings = [];

  const inputs = [];            // تعریف اینپوت‌ها برای نمایش
  const inputValueMap = opts.inputValues || {};

  const meta = { title: 'Pine', shortTitle: null, overlay: false, precision: null };
  const plots = [];
  const shapes = [];
  const hlines = [];
  let plotCounter = 0;
  let shapeCounter = 0;

  // ---------- سری‌های داخلی ----------
  const baseSeries = {
    open: candles.map(c => c.open),
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    volume: candles.map(c => c.volume || 0),
    time: candles.map(c => c.timestamp),
    hl2: candles.map(c => (c.high + c.low) / 2),
    hlc3: candles.map(c => (c.high + c.low + c.close) / 3),
    ohlc4: candles.map(c => (c.open + c.high + c.low + c.close) / 4),
    hlcc4: candles.map(c => (c.high + c.low + 2 * c.close) / 4),
    bar_index: candles.map((_, i) => i),
    last_bar_index: n - 1,
    na_value: NaN
  };

  // ---------- محیط ----------
  function makeScope (parent) {
    const vars = new Map();
    return {
      parent,
      has (name) { return vars.has(name) || (parent ? parent.has(name) : false); },
      get (name) {
        if (vars.has(name)) return vars.get(name);
        if (parent) return parent.get(name);
        throw new PineError(`متغیر «${name}» تعریف نشده است`);
      },
      set (name, slot) { vars.set(name, slot); },
      names () {
        const all = [];
        let s = this;
        while (s) { all.push(...s.vars.keys()); s = s.parent; }
        return all;
      }
    };
  }

  const globalScope = makeScope(null);
  let activeScope = globalScope;
  const userFns = new Map();
  let fnDepth = 0;

  // ---------- ابزار ----------
  function boolSeries (v) {
    return toSeries(v, n).map(x => x === true || (typeof x === 'number' && !isNaN(x) && x !== 0));
  }

  function constSeries (v) {
    return new Array(n).fill(v);
  }

  function slotValue (slot) {
    return slot.arr !== undefined ? slot.arr : slot.value;
  }

  function shiftArr (arr, k) {
    if (k === 0) return arr;
    const out = new Array(n).fill(NaN);
    for (let i = k; i < n; i++) out[i] = arr[i - k];
    return out;
  }

  // ---------- ارزیابی عبارت ----------

  function evalExpr (node, mask = null) {
    switch (node.kind) {
      case 'Num': return node.value;
      case 'Str': return node.value;
      case 'Bool': return node.value;
      case 'Color': return normalizeColor(node.value);
      case 'Na': return NaN;

      case 'Id': {
        if (activeScope.has(node.name)) return slotValue(activeScope.get(node.name));
        if (node.name in baseSeries) {
          if (node.name === 'last_bar_index') return baseSeries.last_bar_index;
          if (node.name === 'na_value') return NaN;
          return baseSeries[node.name];
        }
        throw new PineError(`متغیر «${node.name}» تعریف نشده است`, node.line);
      }

      case 'Member':
        return evalMember(node);

      case 'Unary': {
        const v = evalExpr(node.expr, mask);
        if (node.op === '-') return mapS(v, x => -x);
        if (node.op === 'not') return mapS(boolSeries(v), x => !x);
        throw new PineError(`اپراتور ${node.op} پشتیبانی نمی‌شود`, node.line);
      }

      case 'Binary': return evalBinary(node, mask);

      case 'Ternary': {
        const cond = evalExpr(node.cond, mask);
        const a = evalExpr(node.a, mask);
        const b = evalExpr(node.b, mask);
        return mergeTernary(cond, a, b);
      }

      case 'IfExpr': {
        const cond = evalExpr(node.cond, mask);
        const a = evalExpr(node.then, mask);
        const b = node.else ? evalExpr(node.else, mask) : NaN;
        return mergeTernary(cond, a, b);
      }

      case 'Index': {
        const v = evalExpr(node.expr, mask);
        const off = evalExpr(node.offset, mask);
        if (typeof off !== 'number' || isNaN(off) || off < 0 || !Number.isInteger(off)) {
          throw new PineError('آفست ارجاع تاریخی باید عدد صحیح نامنفی باشد', node.line);
        }
        if (isSeries(v)) return shiftArr(v, off);
        return off === 0 ? v : NaN;
      }

      case 'Call': return evalCall(node, mask);

      default:
        throw new PineError(`عبارت «${node.kind}» پشتیبانی نمی‌شود`, node.line);
    }
  }

  function mergeTernary (cond, a, b) {
    if (!isSeries(cond) && !isSeries(a) && !isSeries(b)) {
      const c = cond;
      if (typeof c === 'number' && isNaN(c)) return NaN;
      return c ? a : b;
    }
    const C = toSeries(cond, n), A = toSeries(a, n), B = toSeries(b, n);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = C[i];
      if (typeof c === 'number' && isNaN(c)) { out[i] = NaN; continue; }
      out[i] = c ? A[i] : B[i];
    }
    return out;
  }

  function evalBinary (node, mask) {
    const { op } = node;
    if (op === 'and' || op === 'or') {
      const a = boolSeries(evalExpr(node.l, mask));
      const b = boolSeries(evalExpr(node.r, mask));
      return zip(a, b, (x, y) => op === 'and' ? (x && y) : (x || y));
    }
    const l = evalExpr(node.l, mask);
    const r = evalExpr(node.r, mask);
    switch (op) {
      case '+': return zip(l, r, (a, b) => a + b);
      case '-': return zip(l, r, (a, b) => a - b);
      case '*': return zip(l, r, (a, b) => a * b);
      case '/': return zip(l, r, (a, b) => b === 0 ? NaN : a / b);
      case '%': return zip(l, r, (a, b) => b === 0 ? NaN : a % b);
      case '==': return zip(l, r, (a, b) => a === b);
      case '!=': return zip(l, r, (a, b) => a !== b);
      case '<': return zip(l, r, (a, b) => a < b);
      case '<=': return zip(l, r, (a, b) => a <= b);
      case '>': return zip(l, r, (a, b) => a > b);
      case '>=': return zip(l, r, (a, b) => a >= b);
      default: throw new PineError(`اپراتور «${op}» پشتیبانی نمی‌شود`, node.line);
    }
  }

  function evalMember (node) {
    const objName = node.obj.kind === 'Id' ? node.obj.name : null;
    const name = node.name;

    if (objName === 'color') {
      if (name in PALETTE) return PALETTE[name];
      throw new PineError(`رنگ «color.${name}» ناشناخته است`, node.line);
    }
    if (objName === 'shape') {
      if (name in SHAPE_CONSTS) return SHAPE_CONSTS[name];
      return name;
    }
    if (objName === 'location') {
      return LOCATION_CONSTS[name] || name;
    }
    if (objName === 'plot') {
      if (!PLOT_STYLES['plot.' + name]) throw new PineError(`استایل «plot.${name}» ناشناخته است`, node.line);
      return 'plot.' + name;
    }
    if (objName === 'hline') {
      if (!HL_STYLES['hline.' + name]) throw new PineError(`استایل «hline.${name}» ناشناخته است`, node.line);
      return 'hline.' + name;
    }
    if (objName === 'display') return 'display.' + name;
    if (objName === 'format') return 'format.' + name;
    if (objName === 'size') return 'size.' + name;
    if (objName === 'math') {
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
    }
    if (objName === 'strategy') {
      throw new PineError('استراتژی‌ها (strategy.*) پشتیبانی نمی‌شوند — از indicator استفاده کنید', node.line);
    }
    if (objName === 'label' || objName === 'line' || objName === 'box' || objName === 'table') {
      throw new PineError(`اشیای رسمی («${objName}.*») در این نسخه پشتیبانی نمی‌شوند`, node.line);
    }
    throw new PineError(`شناسه «${objName}.${name}» شناخته نشد`, node.line);
  }

  function argByName (args, names, position) {
    const named = args.find(a => a.name && names.includes(a.name));
    if (named) return named.value;
    const positional = args.filter(a => !a.name);
    return positional[position] !== undefined ? positional[position].value : undefined;
  }

  function evalCall (node, mask) {
    const { ns, name } = node;

    // متادیتا و خروجی‌ها
    if (ns === null) {
      switch (name) {
        case 'indicator': return evalIndicator(node);
        case 'strategy': throw new PineError('استراتژی‌ها پشتیبانی نمی‌شوند — از indicator استفاده کنید', node.line);
        case 'plot': return evalPlot(node, mask);
        case 'plotshape': case 'plotchar': return evalPlotshape(node, mask);
        case 'hline': return evalHline(node, mask);
        case 'bgcolor': case 'fill': case 'barcolor': case 'fill_between':
          warnings.push(`خط ${node.line}: «${name}()» نادیده گرفته شد (پشتیبانی نمی‌شود)`);
          return NaN;
        case 'alertcondition': case 'alert':
          return NaN;
        case 'na': return NaN;
        case 'nz': {
          const v = evalExpr(argByName(node.args, ['source'], 0), mask);
          const replacement = node.args.length > 1 ? evalExpr(argByName(node.args, ['replacement'], 1), mask) : 0;
          return mapS(v, x => (typeof x === 'number' && isNaN(x)) ? replacement : x);
        }
        case 'na_fn': case 'isna': return NaN;
        case 'iff': {
          const c = evalExpr(argByName(node.args, ['condition'], 0), mask);
          const a = evalExpr(argByName(node.args, ['then'], 1), mask);
          const b = evalExpr(argByName(node.args, ['else'], 2), mask);
          return mergeTernary(c, a, b);
        }
        case 'max': case 'min': {
          const vals = node.args.map(a => evalExpr(a.value, mask));
          return math[name](...vals);
        }
        case 'abs': case 'round': case 'floor': case 'ceil': case 'sqrt': case 'log': case 'exp': case 'sign': {
          const v = evalExpr(node.args[0].value, mask);
          return math[name](v);
        }
        default: break;
      }

      // توابع کاربر
      if (userFns.has(name)) {
        const fn = userFns.get(name);
        if (fnDepth > 60) throw new PineError('عمق بازگشت (recursion) بیش از حد', node.line);
        const localScope = makeScope(globalScope);
        fnDepth++;
        const prevScope = activeScope;
        activeScope = localScope;
        try {
          fn.params.forEach((p, i) => {
            const argNode = node.args[i];
            if (!argNode) throw new PineError(`پارامتر «${p}» تابع «${name}» مقدار ندارد`, node.line);
            localScope.set(p, { value: evalExpr(argNode.value, mask), isVar: false });
          });
          return evalExpr(fn.body, mask);
        } finally {
          activeScope = prevScope;
          fnDepth--;
        }
      }

      throw new PineError(`تابع «${name}» شناخته نشد`, node.line);
    }

    if (ns === 'ta') return evalTa(node, mask);
    if (ns === 'math') return evalMath(node, mask);
    if (ns === 'input') return evalInput(node);
    if (ns === 'color') {
      if (name === 'new') {
        const c = evalExpr(argByName(node.args, ['color'], 0), mask);
        const t = node.args.length > 1 ? evalExpr(argByName(node.args, ['transp'], 1), mask) : 0;
        if (isSeries(c)) return mapS(c, x => colorNew(x, t));
        return colorNew(c, t);
      }
      if (name === 'rgb') {
        const r = evalExpr(node.args[0].value, mask);
        const g = evalExpr(node.args[1].value, mask);
        const b = evalExpr(node.args[2].value, mask);
        const t = node.args[3] ? evalExpr(node.args[3].value, mask) : 0;
        const conv = (v) => Math.max(0, Math.min(255, Math.round(v)));
        const a = Math.max(0, Math.min(1, 1 - t / 100));
        return `rgba(${conv(r)},${conv(g)},${conv(b)},${a})`;
      }
      throw new PineError(`تابع «color.${name}» پشتیبانی نمی‌شود`, node.line);
    }

    throw new PineError(`فضای نام «${ns}» شناخته نشد`, node.line);
  }

  function evalIndicator (node) {
    const title = evalExpr(argByName(node.args, ['title'], 0)) ?? 'Pine';
    const shortTitle = node.args.find(a => a.name === 'shorttitle');
    const overlayArg = node.args.find(a => a.name === 'overlay');
    const precisionArg = node.args.find(a => a.name === 'precision');
    meta.title = typeof title === 'string' ? title : 'Pine';
    meta.shortTitle = shortTitle ? evalExpr(shortTitle.value) : null;
    meta.overlay = overlayArg ? evalExpr(overlayArg.value) === true : false;
    meta.precision = precisionArg ? evalExpr(precisionArg.value) : null;
    return meta.title;
  }

  function resolveColor (v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && !isNaN(v)) return '#2962ff';
    return null; // سری یا نامشخص
  }

  function evalPlot (node, mask) {
    const series = evalExpr(argByName(node.args, ['series'], 0), mask);
    if (series == null) throw new PineError('plot() به آرگومان series نیاز دارد', node.line);

    let title = 'plot';
    const titleArg = node.args.find(a => a.name === 'title');
    if (titleArg) title = String(evalExpr(titleArg.value));

    let color = '#2962ff';
    let colorSeries = null;
    const colorArg = node.args.find(a => a.name === 'color');
    if (colorArg) {
      const cv = evalExpr(colorArg.value, mask);
      if (isSeries(cv)) colorSeries = toSeries(cv, n);
      else color = resolveColor(cv) || '#2962ff';
    }

    const lwArg = node.args.find(a => a.name === 'linewidth');
    const lineWidth = lwArg ? Number(evalExpr(lwArg.value)) || 1 : 1;

    let style = 'line';
    const styleArg = node.args.find(a => a.name === 'style');
    if (styleArg) {
      const sv = evalExpr(styleArg.value);
      style = PLOT_STYLES[sv] || 'line';
    }

    const key = 'p' + (plotCounter++);
    plots.push({ key, title, data: toSeries(series, n), color, colorSeries, lineWidth, style });
    return series;
  }

  function evalPlotshape (node, mask) {
    const series = evalExpr(argByName(node.args, ['series'], 0), mask);
    const titleArg = node.args.find(a => a.name === 'title');
    const title = titleArg ? String(evalExpr(titleArg.value)) : 'shape';
    let color = '#2962ff';
    const colorArg = node.args.find(a => a.name === 'color');
    if (colorArg) {
      const cv = evalExpr(colorArg.value, mask);
      if (!isSeries(cv)) color = resolveColor(cv) || '#2962ff';
    }
    const values = toSeries(series, n).map((v, i) => (v === true || (typeof v === 'number' && !isNaN(v) && v !== 0)) ? candles[i].close : NaN);
    const key = 's' + (shapeCounter++);
    shapes.push({ key, title, data: values, color });
    return series;
  }

  function evalHline (node, mask) {
    const price = evalExpr(argByName(node.args, ['price'], 0), mask);
    const titleArg = node.args.find(a => a.name === 'title');
    let color = '#787B86';
    const colorArg = node.args.find(a => a.name === 'color');
    if (colorArg) color = resolveColor(evalExpr(colorArg.value, mask)) || '#787B86';
    const styleArg = node.args.find(a => a.name === 'linestyle');
    const style = styleArg ? (HL_STYLES[evalExpr(styleArg.value)] || 'solid') : 'solid';
    if (typeof price !== 'number' || isNaN(price)) {
      throw new PineError('hline() به قیمت ثابت نیاز دارد', node.line);
    }
    hlines.push({ value: price, color, style });
    return price;
  }

  function evalTa (node, mask) {
    const a = (names, pos) => evalExpr(argByName(node.args, names, pos), mask);
    const lenArg = (names, pos, dflt) => {
      const v = argByName(node.args, names, pos);
      return v === undefined ? dflt : Math.max(1, Math.round(Number(evalExpr(v, mask))));
    };
    const needSeries = (v, fname, arg = 'source') => {
      if (!isSeries(v)) throw new PineError(`آرگومان ${arg} تابع ta.${fname} باید سری باشد`, node.line);
      return v;
    };

    switch (node.name) {
      case 'sma': return ta.sma(needSeries(a(['source'], 0), 'sma'), lenArg(['length'], 1, 9));
      case 'ema': return ta.ema(needSeries(a(['source'], 0), 'ema'), lenArg(['length'], 1, 9));
      case 'wma': return ta.wma(needSeries(a(['source'], 0), 'wma'), lenArg(['length'], 1, 9));
      case 'hma': return ta.hma(needSeries(a(['source'], 0), 'hma'), lenArg(['length'], 1, 9));
      case 'rma': return ta.rma(needSeries(a(['source'], 0), 'rma'), lenArg(['length'], 1, 9));
      case 'vwma': return ta.vwma(needSeries(a(['source'], 0), 'vwma'), lenArg(['length'], 1, 9), baseSeries.volume);
      case 'rsi': return ta.rsi(needSeries(a(['source'], 0), 'rsi'), lenArg(['length'], 1, 14));
      case 'atr': return ta.atr(candles, lenArg(['length'], 0, 14));
      case 'tr': return ta.tr(candles, node.args.some(x => x.name === 'handle_na'));
      case 'stdev': return ta.stdev(needSeries(a(['source'], 0), 'stdev'), lenArg(['length'], 1, 5));
      case 'dev': return ta.dev(needSeries(a(['source'], 0), 'dev'), lenArg(['length'], 1, 5));
      case 'variance': return ta.variance(needSeries(a(['source'], 0), 'variance'), lenArg(['length'], 1, 5));
      case 'highest': return ta.highest(needSeries(a(['source'], 0), 'highest'), lenArg(['length'], 1, 14));
      case 'lowest': return ta.lowest(needSeries(a(['source'], 0), 'lowest'), lenArg(['length'], 1, 14));
      case 'change': return ta.change(a(['source'], 0), lenArg(['length'], 1, 1));
      case 'mom': return ta.mom(a(['source'], 0), lenArg(['length'], 1, 10));
      case 'roc': return ta.roc(a(['source'], 0), lenArg(['length'], 1, 9));
      case 'cum': return ta.cum(needSeries(a(['source'], 0), 'cum'));
      case 'crossover': return ta.crossover(a(['source1'], 0), a(['source2'], 1));
      case 'crossunder': return ta.crossunder(a(['source1'], 0), a(['source2'], 1));
      case 'cross': return ta.cross(a(['source1'], 0), a(['source2'], 1));
      case 'rising': return ta.rising(a(['source'], 0), lenArg(['length'], 1, 1));
      case 'falling': return ta.falling(a(['source'], 0), lenArg(['length'], 1, 1));
      case 'barssince': return ta.barssince(boolSeries(a(['condition'], 0)));
      case 'valuewhen': {
        const cond = boolSeries(a(['condition'], 0));
        const src = a(['source'], 1);
        const occ = node.args[2] ? Math.max(0, Number(evalExpr(node.args[2].value, mask)) || 0) : 0;
        return ta.valuewhen(cond, src, occ);
      }
      case 'vwap': return ta.vwap(candles);
      case 'macd': {
        const src = needSeries(a(['source'], 0), 'macd');
        const [m, s, h] = ta.macd(src, lenArg(['fastlen'], 1, 12), lenArg(['slowlen'], 2, 26), lenArg(['siglen'], 3, 9));
        return [m, s, h];
      }
      case 'bb': {
        const src = needSeries(a(['source'], 0), 'bb');
        const len = lenArg(['length'], 1, 5);
        const mult = a(['mult'], 2) ?? 2;
        const basis = ta.sma(src, len);
        const dev = mapS(ta.stdev(src, len), d => d * mult);
        return [basis, zip(basis, dev, (x, d) => x + d), zip(basis, dev, (x, d) => x - d)];
      }
      default:
        throw new PineError(`تابع «ta.${node.name}» پشتیبانی نمی‌شود`, node.line);
    }
  }

  function evalMath (node, mask) {
    const fn = math[node.name];
    if (typeof fn !== 'function') throw new PineError(`تابع «math.${node.name}» پشتیبانی نمی‌شود`, node.line);
    const vals = node.args.map(arg => evalExpr(arg.value, mask));
    return fn(...vals);
  }

  function evalInput (node) {
    const kind = node.name; // int | float | bool | string | source | color | time
    if (kind === 'price' || kind === 'time' || kind === 'session') {
      throw new PineError(`input.${kind} پشتیبانی نمی‌شود`, node.line);
    }
    const defvalArg = argByName(node.args, ['defval'], 0);
    const defval = defvalArg !== undefined ? evalExpr(defvalArg) : (kind === 'bool' ? false : kind === 'string' ? '' : 0);
    const titleArg = node.args.find(x => x.name === 'title');
    const title = titleArg ? String(evalExpr(titleArg.value)) : 'ورودی';

    const rec = { kind, title, defval };
    const minval = node.args.find(x => x.name === 'minval');
    const maxval = node.args.find(x => x.name === 'maxval');
    const options = node.args.find(x => x.name === 'options');
    if (minval) rec.minval = evalExpr(minval.value);
    if (maxval) rec.maxval = evalExpr(maxval.value);
    if (options && isSeries(options.value) === false) { /* آپشن‌ها به‌صورت آرگومان‌های متعدد نیستند؛ نادیده */ }

    inputs.push(rec);
    const override = inputValueMap[title];
    if (override !== undefined && override !== '') {
      if (kind === 'int' || kind === 'float') return Number(override);
      if (kind === 'bool') return override === true || override === 'true';
      if (kind === 'source' && override in baseSeries) return baseSeries[override];
      return override;
    }
    if (kind === 'source') {
      return isSeries(defval) ? defval : baseSeries[defval] ?? baseSeries.close;
    }
    return defval;
  }

  // ---------- اجرای دستورات ----------

  function assignInto (scope, target, op, isVarDecl, value, mask) {
    const existing = scope.has(target);

    if (op === ':=' && !existing) {
      throw new PineError(`متغیر «${target}» قبلاً تعریف نشده (برای := ابتدا با = تعریف کنید)`);
    }

    if (mask) {
      // انتساب ماسک‌شده داخل if
      if (!existing) {
        applyMasked(scope, target, mask, value, NaN);
        return;
      }
      const slot = scope.get(target);
      const cur = slotValue(slot);
      const isVar = slot.isVar === true;
      let out;
      if (isVar) {
        // var: مقدار بین کندل‌ها حمل می‌شود و فقط در بارهای ماسک‌شده تغییر می‌کند
        out = new Array(n);
        let running = isSeries(cur) ? cur[0] : cur;
        for (let i = 0; i < n; i++) {
          if (mask[i]) running = isSeries(value) ? value[i] : value;
          out[i] = running;
        }
      } else {
        // متغیر عادی: در هر کندل بازمقداردهی می‌شود — ادغام به‌ازای هر بار
        const C = toSeries(cur, n);
        out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = mask[i] ? (isSeries(value) ? value[i] : value) : C[i];
      }
      scope.set(target, { arr: out, isVar });
      return;
    }

    // انتساب ساده
    if (!existing || op === '=') {
      scope.set(target, isVarDecl
        ? { arr: isSeries(value) ? constSeries(value[0]) : constSeries(value), isVar: true }
        : { value, isVar: false });
      return;
    }
    // := بدون ماسک
    const slot = scope.get(target);
    slot.value = value;
    slot.isVar = false;
    delete slot.arr;
  }

  function applyMasked (scope, target, mask, value, init) {
    const out = new Array(n);
    let running = init;
    for (let i = 0; i < n; i++) {
      if (mask[i]) running = isSeries(value) ? value[i] : value;
      out[i] = running;
    }
    scope.set(target, { arr: out, isVar: false });
  }

  function execBlock (stmts, mask) {
    for (const st of stmts) execStatement(st, mask);
  }

  function execStatement (st, mask = null) {
    switch (st.kind) {
      case 'Assign': {
        const value = evalExpr(st.expr, mask);
        assignInto(globalScope, st.target, st.op, st.isVar, value, mask);
        break;
      }
      case 'TupleAssign': {
        const val = evalExpr(st.expr, mask);
        if (!Array.isArray(val) || val.length !== st.targets.length) {
          throw new PineError('انتساب چندتایی: تعداد مقادیر با تعداد متغیرها برابر نیست', st.line);
        }
        st.targets.forEach((t, i) => assignInto(globalScope, t, '=', false, val[i], mask));
        break;
      }
      case 'IfStmt': {
        const cond = evalExpr(st.cond, mask);
        const condB = boolSeries(cond);
        const base = mask || new Array(n).fill(true);
        const thenMask = new Array(n);
        const elseMask = new Array(n);
        for (let i = 0; i < n; i++) {
          const c = condB[i] === true;
          thenMask[i] = base[i] && c;
          elseMask[i] = base[i] && !c;
        }
        execBlock(st.then, thenMask);
        if (st.else) execBlock(st.else, elseMask);
        break;
      }
      case 'ForStmt':
        throw new PineError('حلقه for در این نسخه پشتیبانی نمی‌شود — محاسبات را برداری بنویسید', st.line);
      case 'FnDef':
        userFns.set(st.name, st);
        break;
      case 'ExprStmt':
        evalExpr(st.expr, mask);
        break;
      default:
        throw new PineError(`دستور «${st.kind}» پشتیبانی نمی‌شود`, st.line);
    }
  }

  // ---------- اجرای اصلی ----------
  try {
    if (/strategy\s*\(/.test(code)) {
      throw new PineError('استراتژی‌ها (strategy) پشتیبانی نمی‌شوند — فقط اندیکاتور (indicator) بنویسید');
    }
    const ast = parse(lex(code));
    for (const st of ast.body) execStatement(st, null);
  } catch (err) {
    errors.push({
      line: err.line ?? null,
      message: err.message || String(err)
    });
    return { ok: false, errors, warnings, title: null, overlay: false, plots: [], shapes: [], hlines: [], inputs };
  }

  return {
    ok: true,
    errors,
    warnings,
    title: meta.shortTitle || meta.title,
    overlay: meta.overlay,
    precision: meta.precision,
    plots,
    shapes,
    hlines,
    inputs
  };
}

function normalizeColor (hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  return '#' + h;
}
