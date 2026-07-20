# GeoLite2 geo-IP chore

**Purpose.** The Visitor Insights dashboard reports *roughly where visitors come
from* for the Chamber's LTAC grant reporting. On Render there are no platform geo
headers, so this uses a local **MaxMind GeoLite2** database. That database needs a
free account, a license key, and periodic refreshes — this runbook is that chore.

**What breaks when it's absent:** nothing user-facing. Analytics geography simply
shows **"Unknown"** (exactly as before this feature existed). No visitor ever sees
a difference. So this is a "nice to have working," not an outage.

---

## One-time setup

1. **Create a free MaxMind account** at <https://www.maxmind.com/en/geolite2/signup>.
2. **Generate a license key:** MaxMind account → *Manage License Keys* → *Generate*.
   Copy it once (you can't see it again).
3. **Set it on Render:** the service → *Environment* → add `MAXMIND_LICENSE_KEY`
   (declared `sync: false` in `render.yaml` — it lives only in the dashboard,
   never in git). Do the same on the **staging** service if you want geo there.
4. **Install the database.** Either:
   - click **Refresh now** on the [Ops & status](/admin/ops) page (Geo-IP tile), or
   - run the script locally / on the box:
     ```bash
     MAXMIND_LICENSE_KEY=... node scripts/update-geolite2.mjs --data-dir /data
     ```
     (`--help` prints usage and exits 0 without a key.)

The file installs to `<DATA_DIR>/geoip/<edition>.mmdb` on the mounted disk, so it
survives deploys.

---

## Edition & memory

- Default is **`GeoLite2-City`** (~70 MB, gives city + region — the richest LTAC
  data). It is loaded once into memory.
- If Render **memory alarms** fire, switch to **`GeoLite2-Country`** (~6 MB,
  country only): set `GEOIP_EDITION=GeoLite2-Country` on Render and re-install.

---

## Keeping it fresh (the recurring chore)

- **Automatic:** when a lookup sees the file **missing or older than 30 days** and
  `MAXMIND_LICENSE_KEY` is set, the app downloads and atomically installs a fresh
  copy **in the background** while the old one keeps serving. No cron needed.
- **What "WARN: stale" on `/admin/ops` means:** the file is older than 40 days —
  i.e. the self-refresh has been failing (usually an expired/removed license key).
  Fix the key and click **Refresh now**.
- **Annual:** re-check the MaxMind account is active and the GeoLite2 EULA hasn't
  changed (MaxMind occasionally requires re-acceptance, which can disable a key).

---

## License & privacy (do not skip)

- **Never commit the `.mmdb`.** MaxMind's license forbids redistribution. It is
  excluded from the git repo, the Docker image, and the backup bundle
  (`src/lib/backup-bundle.ts` skips `geoip/`), and it is always re-downloadable.
- **Privacy (MHMDA posture):** visitor IPs are looked up **in memory only and are
  never stored or logged** — only coarse country/region/city strings persist, the
  same region-grained reporting the Chamber already relies on. Never change the
  tracker to store the IP.
