# WeatherWalk

Enter a US ZIP code, get the best hours to go for a walk in the next 72 hours.

Every hour gets a walkability score built **multiplicatively** from five factors —
US AQI, dew point, precipitation probability, temperature, and UV index — so one
genuinely bad factor (hazardous air, dangerous heat) sinks the hour, while several
mildly imperfect factors only dent it. The app shows the single best time, an
hourly chart, and a ranked list of walk windows with per-factor breakdowns.

Fully static and client-side: the browser talks directly to free, no-key APIs.

## Data sources

- **Weather** — [Open-Meteo forecast API](https://open-meteo.com/en/docs) (hourly
  temperature, dew point, precipitation probability, UV index; CC-BY 4.0)
- **Air quality** — [Open-Meteo air quality API](https://open-meteo.com/en/docs/air-quality-api)
  (hourly US AQI; ~4–5 day model horizon, later hours degrade to 4-factor scores)
- **ZIP → coordinates** — [Zippopotam.us](https://www.zippopotam.us/), with the
  Open-Meteo geocoder as fallback; results cached in localStorage

All timestamps are handled as location-local wall-clock strings (the APIs'
`timezone=auto` format) and never parsed with `new Date(ts)` — so a viewer in any
timezone sees the ZIP's own clock. See `src/core/time.ts`.

## Scoring

Each factor maps to a "percent comfort" in [0,1] through a smooth curve,
judged in isolation (`src/core/scoring.ts`):

- **Temperature** — an asymmetric bell around 66 °F. The cold side is wider
  than the hot side (clothing fixes cold; nothing fixes heat): 55 °F ≈ ×0.88,
  45 °F ≈ ×0.63, freezing ≈ ×0.30; 80 °F ≈ ×0.56, 90 °F ≈ ×0.18.
- **Dew point, AQI, UV** — logistic drop-offs: comfort ≈ 1 at the harmless
  end, 50% at a midpoint (dew 68 °F, AQI 150, UV 9), with a per-factor
  softness controlling how fast it falls.
- **Rain** — simply the probability of staying dry (1 − p/100), so certain
  rain zeroes the hour.

The per-hour score is literally the product of the sub-scores ×100 — the
×multipliers shown in a tooltip's factor breakdown multiply to the score, and
the quality bands are plain thresholds on it (≥ 75 excellent, ≥ 50 good,
≥ 30 fair, ≥ 10 poor). Exact zeros are reserved for hazards (AQI ≥ 301,
temperature ≤ −10 °F or ≥ 105 °F) and certain rain. Night hours are marked
visually but not penalized.

## Develop

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (offline, deterministic)
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
```

Live-API integration tests (hit the real endpoints):

```powershell
$env:LIVE_API='1'; npm test
```

## Deploy

`npm run build`, then host `dist/` anywhere static (GitHub Pages, Netlify, …).
Assets use relative paths (`base: './'`), so subpath hosting works unchanged.

Keep the footer attribution (Open-Meteo CC-BY 4.0 requires it), and note the
Open-Meteo free tier is for non-commercial use.
