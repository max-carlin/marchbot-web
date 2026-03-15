# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Static frontend for marchbot — an NCAA men's basketball stats and prediction viewer. No build step, no framework, no bundler. Served by GitHub Pages. Data comes from a private backend repo (`marchbot`) that exports a stripped SQLite database and pre-computed predictions.

## Running Locally

```bash
python -m http.server 8080
# Open http://localhost:8080
```

A local server is required because the app fetches `data/web.db.gz` and `data/predictions.json` via HTTP.

## Updating Data

In the backend repo (`marchbot`):
```bash
python cli.py collect --days 1
python cli.py train
python cli.py export-web
cp data/web.db.gz data/predictions.json ../marchbot-web/data/
```

## Architecture

**No build system.** All JS uses native ES modules (`import`/`export`). CDN dependencies only: sql.js (SQLite→WebAssembly) and Chart.js.

**Data flow:** On page load, `db.js` fetches `data/web.db.gz`, decompresses it using the browser-native `DecompressionStream`, and initializes an in-memory SQLite database via sql.js. All queries happen client-side. Predictions are pre-computed JSON (XGBoost can't run in-browser).

**Routing:** Hash-based (`#/team/{id}`, `#/player/{id}`, `#/predict`). `app.js` listens for `hashchange` and renders the appropriate page by replacing `#app` innerHTML.

### Module responsibilities

- `js/app.js` — Router, page rendering, header search, init/boot sequence
- `js/db.js` — sql.js initialization with progress tracking, all SQL query helpers
- `js/predict.js` — Loads `predictions.json`, provides matchup lookup by team ID pair
- `js/charts/court.js` — Half-court drawing on Canvas 2D (ported from Python's matplotlib)
- `js/charts/shot-chart.js` — Gaussian blur heatmap + shot scatter overlay on court
- `js/charts/season-log.js` — Chart.js bar chart (green=win, red=loss, height=margin)
- `js/charts/top-players.js` — Chart.js horizontal grouped bars (PPG/RPG/APG) + shooting %

### Database schema (`web.db`)

Five tables: `teams`, `games`, `athletes`, `player_game_stats`, `shots`. The `shots` table is pre-joined from the backend's `plays` + `play_participants` tables (shot types only, shooter only). This avoids shipping the full 400MB+ play-by-play database.

### Key conventions

- ESPN coordinate system: x=0–50 (sideline to sideline), y=0 at baseline, basket at ~(25, 4)
- Prediction keys in JSON: `smallerId_largerId`, value = P(smaller ID team wins)
- `shortName()` in `season-log.js` strips mascot suffixes ("Duke Blue Devils" → "Duke")
- Chart.js instances are stored on `canvas._chart` for cleanup on re-render
