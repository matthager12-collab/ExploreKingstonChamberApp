# Geo-IP (DB-IP City Lite)

**Purpose.** The Visitor Insights dashboard reports *roughly where visitors come
from* for the Chamber's LTAC grant reporting. On Render there are no platform geo
headers, so this resolves a coarse country / region / city from a local **DB-IP
City Lite** database ([db-ip.com](https://db-ip.com)).

**What breaks when it's absent:** nothing user-facing. Analytics geography simply
shows **"Unknown"** (exactly as before this feature existed). No visitor ever sees
a difference. So this is a "nice to have working," not an outage.

**There is no chore.** This page used to describe a MaxMind GeoLite2 license-key
routine. That is gone (2026-07-22). DB-IP City Lite is **CC-BY-4.0**, i.e.
redistributable, so the database is **baked into the container image at build
time** — no account, no license key, no annual EULA re-acceptance, and it is
present the instant the container boots.

---

## How it works

- **Production:** the Dockerfile's `geoip` stage downloads the current month's
  `dbip-city-lite.mmdb` from DB-IP and copies it into the image at
  `/app/geoip/dbip-city-lite.mmdb`. `GEOIP_DB_PATH` (set in the Dockerfile) points
  the app at it. `src/lib/geoip.ts` loads it into memory on first lookup.
- **Refreshing = redeploying.** DB-IP publishes a new file monthly. Each image
  build grabs the current month, so **any deploy refreshes the data**. There is no
  runtime download, no cron, and no "Refresh now" button.
- **The build tries the current month, then the previous month** (DB-IP publishes
  on the 1st; a build in the first minutes of a month can race the upload). If
  **neither** resolves, the build **fails** on purpose — better a failed deploy
  than an image whose geography silently never works.

## Local development

`next dev` has no baked file, so geo shows "Unknown" for public IPs (local
traffic is classified `dev-local` regardless). To exercise real geo locally:

```bash
npm run geoip:update            # downloads to .data/geoip/dbip-city-lite.mmdb
```

`src/lib/geoip.ts` falls back to that path when `GEOIP_DB_PATH` is unset. The file
is git-ignored and excluded from the backup bundle — never commit it.

## Reading the ops page

`/admin/ops` → **Geo-IP** shows the baked file's build date and a freshness
status. **WARN (older than 40 days)** means the service simply hasn't been
redeployed in over a month, so the geo data is a release or two stale — redeploy
to refresh. It is not an error.

## Edition & memory

- Shipped edition is **City Lite** (~125 MB on disk, loaded into memory once). It
  gives country + **region (US state)** + city — region is the figure LTAC cares
  about, which is why the lighter **Country Lite** (~8 MB, country only) is *not*
  the default. If memory pressure ever forces the switch, change the Dockerfile
  `geoip` stage to `dbip-country-lite` and drop the subdivision expectations.
- **Field note (why `deriveCoarseGeo` exists):** DB-IP fills a US subdivision's
  full *name* (`subdivisions[0].names.en` = "Washington") but **not** its ISO code
  — the reverse of GeoLite2. `src/lib/geoip.ts` falls back name ← iso, so region
  is populated either way. This is unit-tested in `tests/unit/geoip.test.ts`.

## License & privacy (do not skip)

- **Attribution is required (CC-BY-4.0).** "IP geolocation by DB-IP" links to
  <https://db-ip.com> on every admin page that shows the data (the ops Geo-IP tile
  and the analytics "By connection" card). Keep it if you surface geo elsewhere.
- **Never commit the `.mmdb`.** It is git-ignored, excluded from the Docker build
  context via `.dockerignore` (the image gets its own copy from the `geoip`
  stage), and excluded from the backup bundle. It is always re-obtainable.
- **Privacy (MHMDA posture):** visitor IPs are looked up **in memory only and are
  never stored or logged** — only coarse country / region / city strings persist,
  the same region-grained reporting the Chamber already relies on. Never change the
  tracker to store the IP.
