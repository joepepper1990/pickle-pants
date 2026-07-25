# Pickle Pants v6

A mobile-first, offline-first weight, growth, feeding and forecasting PWA for Reggie.

## Design

This version is an application shell rather than a long scrolling webpage.

- Fixed mobile bottom navigation with a central **Add weight** button
- Fixed desktop sidebar
- Separate Home, Growth, Feeding, Forecast Lab and More screens
- Bottom-sheet weight entry
- Horizontal insight, forecast and model carousels
- Reorderable and hideable Home insight cards
- Dedicated Weight History, Milestones, Ask and Data screens
- Responsive light and dark themes

Individual screens may scroll when their content requires it, but the application is no longer one continuous page.

## Included functionality

### Weight only

The only physical measurement is weight in kilograms. There is no WSAVA score, circumference measurement, camera OCR or voice entry.

### Growth analysis

- Multi-model adult-weight prediction
- Automatic historical model backtesting
- Model weighting based on previous accuracy
- Monte Carlo likely and wider ranges
- Four-, eight- and twelve-week forecast checkpoints
- Sustained growth-change detection
- Decimal, pounds/kilograms and unusual-reading checks
- Adaptive chart smoothing
- Personal forecast, forecast fan, actual weights, reference trajectory and milestone chart layers
- Intelligent next-weigh-in recommendation

### Feeding

- Raw-food calculation using editable bodyweight percentages
- Exactly two meals per day at every age
- Current daily and per-meal amounts
- Four-, eight- and twelve-week feeding forecasts
- Weekly and monthly food totals
- No kcal-per-100-g setting
- No stock, roll, shopping or payday planner

### Supplements

- Fixed, per-kg, per-5-kg or per-10-kg dose rules in grams
- Optional maximum dose
- Three calibration trials using 10 level teaspoons each
- Average grams per teaspoon and calibration consistency rating
- Practical output using:
  - ¼, ½, ¾, 1 and 2 teaspoons
  - 1, 2 and 3 tablespoons
- Delivered grams and difference from the exact target
- Morning, evening or split-across-both-meals timing

### Forecast Lab

Temporary scenarios can:

- Continue the current model
- Reduce future growth by 5%, 10% or 20%
- Use all readings, the last eight weeks or the last twelve weeks
- Add a hypothetical next weight

Scenarios never alter Reggie’s real records.

### Ask Pickle Pants

A deterministic local assistant answers common questions using the tested calculation engine. It does not use an API, send data away or allow a language model to invent calculations.

### Data

- Existing Pickle Pants history is migrated automatically
- Rolling automatic snapshots before significant edits, retained for 30 days
- JSON backup and restore
- CSV weight export
- Calendar file for the next recommended weigh-in
- Local storage only
- Full offline support
- Explicit update notification when a new service worker is ready

## Deployment to GitHub Pages

1. Copy all files and folders from this package into the root of the GitHub repository.
2. Commit and push to the `main` branch.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, select **GitHub Actions**.
5. The included workflow runs syntax and engine tests before deploying.

The workflow file is:

```text
.github/workflows/pages.yml
```

## Local testing

Run:

```bash
npm test
```

For a local web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Do not open `index.html` directly from the file system because service workers and ES modules require HTTP or HTTPS.

## Storage and migration

The current schema key is:

```text
picklePants.v6
```

The app imports data from `picklePants.v5` and the older historical weight keys. Fields that are no longer wanted, such as body-condition and circumference values, are deliberately discarded during migration. Existing dates, weights, notes and exclusion status are retained.

Before replacing a live version, export its current data where possible. Browser storage is associated with the site origin, so keeping the same GitHub Pages URL allows automatic migration.
