# Breakout backtest (Pattern Lab)

Offline research tool. Nothing here runs on Vercel or changes the website.

| Command | What it does | Time |
|---|---|---|
| `npm run backtest:cases` | Downloads ~15 symbols, runs the engine on the hand-analysis case studies and three delisted failures, prints every trade, saves `backtest-results/cases-<date>.json` | ~1-2 min |
| `npm run backtest:universe` | Phase 3. Runs every variant on the whole downloaded universe, compares each strategy trade with random trades (another eligible stock of the same liquidity tier, same day, same stop distance and exits), simulates a 10-slot portfolio vs SPY, saves `backtest-results/universe-<date>.json`. Options: `-- --limit 500`, `-- --draws 5`, `-- --slots 10` | ~15-40 min |
| `npm run backtest:download` | Downloads daily bars (2016 onward) for every active and delisted US common stock on Alpaca. Resumable: re-run to continue. `-- --limit 200` for a partial run | ~30-60 min, a few hundred MB |

Needs `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` in `.env.local`.
Price data is stored in `%USERPROFILE%\stock-backtest-data` (outside OneDrive);
set `BACKTEST_DATA_DIR` in `.env.local` to change it.

## Where the rules live

- `src/lib/breakout/config.ts` - every parameter, with the reason for its default, and the named variants
- `src/lib/breakout/signals.ts` - Setups A (tight base breakout), B (first pullback), C (catalyst + volume)
- `src/lib/breakout/engine.ts` - entries, stops (gap-through fills at the open), 10-week exit, re-entry, costs, delisting
- `src/lib/breakout/compare.ts` - strategy vs random-entry edge, t-statistic clustered by month
- `src/lib/breakout/portfolio.ts` - equal-slot portfolio simulation, CAGR, max drawdown
- `src/lib/breakout/*.test.ts` - unit tests, including no-lookahead tests and a check that the
  random-entry control applies exactly the engine's exits

Bias check (done Oct 2026 on synthetic zero-momentum data, 400 stocks): every variant's edge
over random entries was ~0 with |t| < 1, so a positive edge on real data is not produced by the
comparison method itself.

## Known limits

- Catalysts are inferred from price and volume (no news or earnings feed).
- Company size is inferred from dollar volume (no point-in-time market cap).
- Delisted coverage is partial; positions open at a delisting count as -100% by default.
- The governance filter is a hand-maintained, dated list and is empty by default.
- The case-study run checks the engine. It cannot show an edge: the stocks were picked because they went up.
  That needs the Phase 3 universe run against random entries.
