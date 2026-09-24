// ادیتور Pine Script با CodeMirror + حالت سینتکس اختصاصی + ذخیره/بارگذاری اسکریپت‌ها

import { runAndApplyPine } from './pine/index.js';
import { state } from './store.js';
import { toast, openModal, closeModal } from './ui.js';

const SCRIPTS_KEY = 'fxreplay.pine.scripts';
const DRAFT_KEY = 'fxreplay.pine.draft';

const DEFAULT_SCRIPT = `// نمونه: RSI با سیگنال اشباع
indicator('نمونه RSI', shorttitle='RSI', overlay=false, precision=1)

length = input.int(14, title='دوره', minval=2, maxval=100)

r = ta.rsi(close, length)

hline(70, title='اشباع خرید', color=color.red, linestyle=hline.style_dashed)
hline(30, title='اشباع فروش', color=color.green, linestyle=hline.style_dashed)

plot(r, title='RSI', color=color.purple, linewidth=2)

plotshape(ta.crossover(r, 70), title='خروج خرید', color=color.red)
plotshape(ta.crossunder(r, 30), title='خروج فروش', color=color.green)`;

let cm = null;

// ---------- حالت سینتکس Pine ----------

function definePineMode () {
  const KEYWORDS = ['if', 'else', 'for', 'to', 'by', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'na', 'import', 'export', 'float', 'int', 'bool', 'string', 'color', 'series'];
  const NAMESPACES = /^(ta|math|color|input|strategy|plot|plotshape|plotchar|hline|indicator|label|line|box|table)(\.|$)/;
  const BUILTIN_FNS = /^(indicator|plot|plotshape|plotchar|hline|nz|iff|alertcondition|alert|bgcolor|fill|barcolor)$/;

  window.CodeMirror.defineMode('pine', () => ({
    token (stream) {
      if (stream.eatSpace()) return null;
      if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
      if (stream.match(/"(?:[^"\\]|\\.)*"?/) || stream.match(/'(?:[^'\\]|\\.)*'?/)) return 'string';
      if (stream.match(/#[0-9a-fA-F]{3,8}/)) return 'atom';
      if (stream.match(/\d+\.?\d*/)) return 'number';
      if (stream.match(/[\u0600-\u06FF][\w\u0600-\u06FF]*/)) return 'variable';
      if (stream.match(/[A-Za-z_][\w]*/)) {
        const w = stream.current();
        if (NAMESPACES.test(w)) return 'builtin';
        if (BUILTIN_FNS.test(w)) return 'def';
        if (KEYWORDS.includes(w)) return 'keyword';
        return 'variable';
      }
      if (stream.match(/:=|=>|==|!=|<=|>=|\?|:|[-+*/%<>=()[\],.]/)) return 'operator';
      stream.next();
      return null;
    }
  }));
}

// ---------- ذخیره‌سازی ----------

function loadScripts () {
  try { return JSON.parse(localStorage.getItem(SCRIPTS_KEY)) || {}; } catch (e) { return {}; }
}

function saveScripts (map) {
  localStorage.setItem(SCRIPTS_KEY, JSON.stringify(map));
}

// ---------- کنسول ----------

function consoleLine (text, cls) {
  const el = document.getElementById('pine-console');
  const div = document.createElement('div');
  div.className = cls || '';
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearConsole () {
  document.getElementById('pine-console').textContent = '';
}

function renderResult (res) {
  clearConsole();
  for (const e of (res.errors || [])) consoleLine((e.line ? 'خط ' + e.line + ': ' : '') + e.message, 'err');
  if (res.errors && res.errors.length) {
    toast('خطا در اجرای اسکریپت', 'err');
    return;
  }
  for (const w of (res.warnings || [])) consoleLine('هشدار: ' + w, 'warn');
  const n = (res.plots || []).length + (res.shapes || []).length + (res.hlines || []).length;
  consoleLine(`اجرا شد — پنل: ${res.overlay ? 'روی کندل‌ها (overlay)' : 'پنل جداگانه'} | خروجی‌ها: ${n}`, 'ok');
  if (res.inputs && res.inputs.length) {
    consoleLine('اینپوت‌ها: ' + res.inputs.map(i => `${i.title}=${i.defval}`).join(' | '), 'info');
  }
  toast('اسکریپت اجرا شد', 'ok');
}

// ---------- اجرا ----------

export function runCurrentPine () {
  if (!state.loaded) {
    toast('ابتدا داده روی چارت بارگذاری کنید', 'err');
    return;
  }
  try {
    const res = runAndApplyPine(cm.getValue(), state.candles, {});
    renderResult(res);
  } catch (err) {
    clearConsole();
    consoleLine('خطای غیرمنتظره: ' + (err.message || String(err)), 'err');
    toast('خطا در اجرای اسکریپت', 'err');
  }
}

// ---------- لیست اسکریپت‌ها ----------

function renderScriptList () {
  const ul = document.getElementById('pine-script-list');
  const scripts = loadScripts();
  const names = Object.keys(scripts).sort();
  ul.textContent = '';
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'اسکریپتی ذخیره نشده است';
    ul.appendChild(li);
    return;
  }
  for (const name of names) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.addEventListener('click', () => {
      cm.setValue(scripts[name]);
      document.getElementById('pine-name').value = name;
      closeModal('pine-load-modal');
      toast('اسکریپت «' + name + '» بارگذاری شد', 'ok');
    });
    const del = document.createElement('button');
    del.className = 'rm';
    del.textContent = 'حذف';
    del.addEventListener('click', () => {
      const m = loadScripts();
      delete m[name];
      saveScripts(m);
      renderScriptList();
    });
    li.appendChild(btn);
    li.appendChild(del);
    ul.appendChild(li);
  }
}

// ---------- راه‌اندازی ----------

export function initPineEditor () {
  definePineMode();

  const draft = (() => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; }
  })();

  cm = window.CodeMirror.fromTextArea(document.getElementById('pine-editor'), {
    mode: 'pine',
    lineNumbers: true,
    autoCloseBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    lineWrapping: true
  });
  cm.setValue(draft && draft.code ? draft.code : DEFAULT_SCRIPT);
  if (draft && draft.name) document.getElementById('pine-name').value = draft.name;
  cm.setSize('100%', '100%');

  let saveTimer = null;
  cm.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        name: document.getElementById('pine-name').value,
        code: cm.getValue()
      }));
    }, 400);
  });

  cm.setOption('extraKeys', {
    'Ctrl-Enter': runCurrentPine,
    'Cmd-Enter': runCurrentPine
  });

  document.getElementById('btn-pine-run').addEventListener('click', runCurrentPine);

  document.getElementById('btn-pine-save').addEventListener('click', () => {
    const name = document.getElementById('pine-name').value.trim();
    if (!name) { toast('نام اسکریپت را وارد کنید', 'err'); return; }
    const m = loadScripts();
    m[name] = cm.getValue();
    saveScripts(m);
    toast('اسکریپت «' + name + '» ذخیره شد', 'ok');
  });

  document.getElementById('btn-pine-load').addEventListener('click', () => {
    renderScriptList();
    openModal('pine-load-modal');
  });

  document.getElementById('btn-pine-new').addEventListener('click', () => {
    cm.setValue("// اسکریپت جدید\nindicator('اندیکاتور من', overlay=true)\n\nplot(close, title='قیمت بسته', color=color.blue)\n");
    document.getElementById('pine-name').value = 'اسکریپت من';
    clearConsole();
  });
}
