// آمار پیشرفته بک‌تست v3 + خروجی گزارش HTML مستقل

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const bucket = () => ({ trades: 0, wins: 0, pnl: 0 });
function add (b, t) { b.trades++; if (t.netPnl > 0) b.wins++; b.pnl += t.netPnl; }
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function std (a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
const toRows = map => Object.entries(map).map(([name, b]) => ({ name, ...b })).sort((a, b) => b.pnl - a.pnl);

export function advancedStats (trades, { initialBalance = 0, maxDd = 0, journal = {} } = {}) {
  const long = bucket();
  const short = bucket();
  const byWeekday = WEEKDAYS.map(name => ({ name, ...bucket() }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ name: String(h).padStart(2, '0') + ':00', ...bucket() }));
  const byReason = {};
  const byTag = {};
  const byEmotion = {};
  let streakW = 0, streakL = 0, maxW = 0, maxL = 0;
  let largestWin = 0, largestLoss = 0;
  const rs = [], barsWin = [], barsLoss = [], mfe = [], mae = [];

  for (const t of trades) {
    add(t.dir > 0 ? long : short, t);
    const d = new Date(t.entryTime);
    add(byWeekday[d.getDay()], t);
    add(byHour[d.getHours()], t);
    if (!byReason[t.reason]) byReason[t.reason] = bucket();
    add(byReason[t.reason], t);

    const entry = journal[t.id];
    if (entry) {
      const tags = String(entry.tags || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const tag of tags) {
        if (!byTag[tag]) byTag[tag] = bucket();
        add(byTag[tag], t);
      }
      if (entry.emotion) {
        if (!byEmotion[entry.emotion]) byEmotion[entry.emotion] = bucket();
        add(byEmotion[entry.emotion], t);
      }
    }

    if (t.netPnl > 0) {
      streakW++; streakL = 0; maxW = Math.max(maxW, streakW);
      barsWin.push(t.bars);
      largestWin = Math.max(largestWin, t.netPnl);
    } else {
      streakL++; streakW = 0; maxL = Math.max(maxL, streakL);
      barsLoss.push(t.bars);
      largestLoss = Math.min(largestLoss, t.netPnl);
    }
    if (Number.isFinite(t.rMultiple)) rs.push(t.rMultiple);
    if (Number.isFinite(t.mfe)) mfe.push(t.mfe);
    if (Number.isFinite(t.mae)) mae.push(t.mae);
  }

  const net = trades.reduce((s, t) => s + t.netPnl, 0);
  const pnls = trades.map(t => t.netPnl);
  const base = rs.length >= 2 ? rs : pnls;
  const sd = std(base);
  const sqn = base.length >= 2 && sd > 0 ? Math.sqrt(base.length) * mean(base) / sd : NaN;

  return {
    long,
    short,
    byWeekday,
    byHour: byHour.filter(h => h.trades),
    byReason: toRows(byReason),
    byTag: toRows(byTag),
    byEmotion: toRows(byEmotion),
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    largestWin,
    largestLoss,
    avgR: mean(rs),
    totalR: rs.reduce((s, x) => s + x, 0),
    rCount: rs.length,
    sqn,
    sqnBasis: rs.length >= 2 ? 'R' : 'P&L',
    avgBars: mean(trades.map(t => t.bars)),
    avgBarsWin: mean(barsWin),
    avgBarsLoss: mean(barsLoss),
    avgMfe: mean(mfe),
    avgMae: mean(mae),
    recoveryFactor: maxDd > 0 ? net / maxDd : (net > 0 ? Infinity : 0),
    returnPct: initialBalance > 0 ? net / initialBalance * 100 : 0
  };
}

// ---------- گزارش HTML ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function equitySvg (points, w = 760, h = 180) {
  if (!points || points.length < 2) return '<p class="muted">Not enough trades for an equity curve.</p>';
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((v, i) => `${(i / (points.length - 1) * (w - 20) + 10).toFixed(1)},${(h - 10 - (v - min) / span * (h - 20)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><polyline fill="none" stroke="#0ecb81" stroke-width="2" points="${xy}"/></svg>`;
}

function bucketTable (title, rows, fmt) {
  const body = rows.filter(r => r.trades).map(r =>
    `<tr><td>${esc(r.name)}</td><td>${r.trades}</td><td>${fmt(r.trades ? r.wins / r.trades * 100 : 0, 1)}%</td><td class="${r.pnl >= 0 ? 'pos' : 'neg'}">${fmt(r.pnl, 2)}</td></tr>`).join('');
  if (!body) return '';
  return `<h3>${esc(title)}</h3><table><thead><tr><th></th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function buildHtmlReport ({ title, subtitle, basic, adv, trades, fmt, formatTime }) {
  const kv = [
    ['Net P&L', fmt(basic.realized, 2)], ['Return', fmt(adv.returnPct, 2) + '%'], ['Trades', basic.total],
    ['Win rate', fmt(basic.winRate, 1) + '%'], ['Profit factor', fmt(basic.profitFactor, 2)], ['Expectancy', fmt(basic.expectancy, 2)],
    ['Max drawdown', `${fmt(basic.maxDd, 2)} (${fmt(basic.maxDdPct, 1)}%)`], ['Recovery factor', fmt(adv.recoveryFactor, 2)],
    ['Avg R', fmt(adv.avgR, 2)], ['Total R', fmt(adv.totalR, 2)], [`SQN (${adv.sqnBasis})`, fmt(adv.sqn, 2)],
    ['Max consecutive wins', adv.maxConsecWins], ['Max consecutive losses', adv.maxConsecLosses],
    ['Largest win', fmt(adv.largestWin, 2)], ['Largest loss', fmt(adv.largestLoss, 2)],
    ['Avg bars held', fmt(adv.avgBars, 1)], ['Avg MFE', fmt(adv.avgMfe, 2)], ['Avg MAE', fmt(adv.avgMae, 2)]
  ];
  const cards = kv.map(([k, v]) => `<div class="card"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  const tradeRows = trades.map((t, i) => `<tr><td>${i + 1}</td><td>${t.dir > 0 ? 'LONG' : 'SHORT'}</td><td>${fmt(t.volume, 2)}</td><td>${t.entryPrice}</td><td>${t.exitPrice}</td><td>${esc(formatTime(t.entryTime))}</td><td>${esc(formatTime(t.closeTime))}</td><td>${t.bars}</td><td class="${t.netPnl >= 0 ? 'pos' : 'neg'}">${fmt(t.netPnl, 2)}</td><td>${fmt(t.rMultiple, 2)}</td><td>${esc(t.reason)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:13px/1.5 system-ui,sans-serif;background:#0f1218;color:#d4d8de;margin:0;padding:28px}h1{margin:0;font-size:22px}h2{margin:28px 0 10px;font-size:16px}h3{margin:18px 0 6px;font-size:13px;color:#9aa3ad}
.sub{color:#7d8590;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.card{background:#171c24;border:1px solid #272e39;border-radius:6px;padding:10px}.card span{display:block;color:#7d8590;font-size:11px}.card b{font:600 15px monospace}
table{border-collapse:collapse;width:100%;margin-bottom:8px}th,td{padding:5px 8px;border-bottom:1px solid #222a35;text-align:left;font-family:monospace}th{color:#7d8590;font-weight:500}.pos{color:#0ecb81}.neg{color:#f6465d}.muted{color:#7d8590}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}
</style></head><body><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div><div class="grid">${cards}</div>
<h2>Equity curve</h2>${equitySvg(basic.equityPoints)}
<h2>Breakdown</h2><div class="cols"><div>${bucketTable('Direction', [{ name: 'Long', ...adv.long }, { name: 'Short', ...adv.short }], fmt)}${bucketTable('Exit reason', adv.byReason, fmt)}</div><div>${bucketTable('Weekday (entry)', adv.byWeekday, fmt)}</div><div>${bucketTable('Hour (entry)', adv.byHour, fmt)}</div><div>${bucketTable('Journal tags', adv.byTag, fmt)}${bucketTable('Emotion', adv.byEmotion, fmt)}</div></div>
<h2>Trades</h2><table><thead><tr><th>#</th><th>Side</th><th>Vol</th><th>Entry</th><th>Exit</th><th>Entry time</th><th>Exit time</th><th>Bars</th><th>Net</th><th>R</th><th>Reason</th></tr></thead><tbody>${tradeRows}</tbody></table>
<p class="muted">Generated by Market Replay 3</p></body></html>`;
}
