# Market Replay v3

A local-first Electron market replay and manual backtesting workspace for forex and crypto.

## What v3 improves

- Deterministic replay with forward stepping, rewind, fast-forward, variable speed, and session restore.
- Explicit market, limit, and stop order handling with spread, commission, swap, leverage, margin call, stop-out, SL/TP, partial closes, break-even, and trailing-ready engine structure.
- Gap-aware pending-order and SL/TP fills instead of blindly using candle close.
- MFE, MAE, initial risk, and R-multiple per closed trade.
- Multi-timeframe resampling from a lower timeframe dataset.
- Persistent chart drawings, measure tool, Pine indicator refresh on dataset changes, and trade overlays.
- Local journal entries with notes, tags, emotion, and chart screenshots.
- Advanced analytics: SQN, recovery factor, streaks, MFE/MAE, holding time, direction, weekday, hour, exit reason, tag, and emotion breakdowns.
- JSON session files (`.mrsession`) containing candles, replay position, engine action log, drawings, and journal entries.

## Commercial parity roadmap

The commercial benchmarks were TradingView for replay UX, Forex Tester for execution and risk controls, TraderSync for replay-to-journal workflow, and Edgewonk for behavioral analytics.

### P0: must be reliable before release

1. Run the complete Electron path offline with bundled v2 chart/editor assets.
2. Add automated tests for replay rewind, same-bar actions, gap fills, SL/TP collisions, partial close, and session round-trip.
3. Add a data-quality panel: source, timezone, spacing, duplicates, missing bars, and OHLC violations.
4. Persist chart layout, indicators, viewport, active tool, and simulator configuration in `.mrsession`.
5. Add transparent execution assumptions to every session report: OHLC vs tick, spread, slippage, fill rule, commission, and swap.

### P1: commercial-grade workflow

- Synchronized multi-chart workspace with multiple symbols and timeframes on one event clock.
- Stop-limit and OCO orders, configurable slippage, bid/ask candles, trailing stops, reverse position, and order lifecycle states.
- Prop rules: daily loss limit, max drawdown, profit target, minimum trading days, trading hours, and hard lockout.
- Pre-trade checklist, confidence score, setup taxonomy, mistake/behavior tags, and post-trade review.
- Blind testing mode that hides symbol/date while preserving time-of-day and market movement.
- Event navigation: session open, news marker, indicator crossover, next order fill, and equity threshold.

### P2: advanced research tools

- Tick and sub-bar adapters where data is available.
- Time and sales / Level II adapters for supported instruments.
- Monte Carlo resampling, risk-of-ruin, Sharpe, Sortino, Calmar, gain-to-pain, and rolling statistics.
- Exit analysis comparing actual exit with later MFE/MAE and alternative SL/TP paths.
- Separate systematic backtest mode. Manual replay and automated backtesting must not share hidden assumptions.

## Run

```bash
npm install
npm run start:v3
```

The v3 app is intentionally local-first. No network data is required for replay when candle data is imported from CSV.

## Session contract

A session is versioned and stores:

```text
version, savedAt, symbol, timeframe, candles,
replayStart, replayIndex, mode,
engine.config, engine.actionLog,
drawings, journal
```

When the execution model changes, increment the session version and provide a migration instead of silently replaying old results under new assumptions.

## Current limitations

- Current replay input is OHLC candle data; tick-level and Level II execution require adapters.
- Multi-chart synchronization and prop-firm rule enforcement are next implementation priorities.
- Commercial parity means matching workflow quality, not copying proprietary data or algorithms.
