# KIOSK-DEPLOY.md — running the ferry-dock kiosk

**Status:** software shipped (E22), device not yet deployed.
**Companions:** [KIOSK.md](KIOSK.md) — the software design · [KIOSK-POWER.md](KIOSK-POWER.md) —
power, enclosure, and operating-hours analysis.

This is the operating manual for the Chamber's touchscreen at the ferry. It has two
audiences and they are kept firmly apart:

- **[§1 The one-page card](#1-the-one-page-card)** — for whoever is at the front desk.
  No terminal, no commands, nothing to install. Print it and keep it by the phone.
- **[§2 onwards](#2-what-the-device-actually-is)** — for whoever sets the device up or
  fixes it properly. Assumes comfort with a Linux command line.

---

## 1. The one-page card

**Print this section and keep it at the front desk.**

The kiosk is a screen by the ferry that shows the same information as the Explore
Kingston website — ferry times, places to eat, what's on, parking. **It updates itself.**
When you edit something in the admin area of the website, the kiosk picks it up within
about a minute. There is nothing separate to keep up to date, and nothing on the kiosk
itself that needs a password.

### Something looks wrong — what do I do?

| What you see | What it means | What to do |
| --- | --- | --- |
| **The screen is black, frozen, or stuck on one page** | The little computer behind the screen has locked up. | Switch it off at the wall, wait ten seconds, switch it back on. It returns to the welcome screen on its own after a minute or two. Nothing needs to be typed. |
| **"Be right back — showing the last information we loaded"** | The kiosk cannot reach the internet. It is still showing the last information it successfully loaded, so it is not urgent. | Check the internet at the dock. If other things are online too, tell the person named in [§7](#7-who-to-call). The message clears by itself when the connection returns. |
| **"Be right back — this screen is reconnecting"** | Same thing, but the kiosk had nothing saved yet — usually only right after it was switched on. | As above. It will fill in once it connects. |
| **The information is out of date or wrong** | Someone edited it recently, or it needs editing. | Fix it in the admin area like any other page. Wait about a minute, or open **Admin → Kiosk** and press **Refresh now**. |
| **A visitor says it took them to a strange website** | This should be impossible. | Tell the person in [§7](#7-who-to-call) straight away — it means the lockdown is not working, and that is the one fault worth interrupting someone for. |
| **The screen is on but nothing happens when you touch it** | The touch layer, not the software. | Power-cycle as above. If touch still does nothing, the screen needs a technician; the software cannot fix it. |

### Turning the kiosk off

Open the website's admin area → **Kiosk** → **Turn the kiosk off**. The screen stops
showing the directory within a minute. Use this if the kiosk is showing something it
should not, or during work at the dock. Turning it back on is the same page.

**You do not need to touch the device to do this.** You can do it from your phone.

### Changing what it shows

Admin → **Kiosk**:

- **Which screens does it show?** — tick or untick. Fewer is better for someone hurrying
  for a boat.
- **Return to the welcome screen after** — how long it waits before clearing what the last
  person was looking at. 90 seconds is the default.
- **Refresh now** — pushes your changes to the screen immediately instead of waiting a
  minute.

*Everything else on the kiosk is edited exactly where you already edit it for the
website. There is no separate kiosk content.*

---

## 2. What the device actually is

A low-power mini PC (Raspberry Pi 5 or Intel N100 class) booting Linux straight into
Chromium in kiosk mode, pointed at one URL. It replaces the delisted **Qwick Tourist**
platform's PC while keeping the existing portrait display and enclosure.

```
https://app.explorekingstonwa.com/kiosk
```

There is no kiosk application to install, no content to sync, and no credentials on the
device. It is a browser showing a web page — which is the entire point of the design
(see [KIOSK.md §2](KIOSK.md)). If the mini PC dies, any machine that can run Chromium and
reach that URL is a replacement.

> **Before the custom domain cuts over**, use the Render URL
> (`https://explore-kingston.onrender.com/kiosk`) and change it when DNS moves. Note that
> `NEXT_PUBLIC_SITE_URL` is inlined **at build time**, so the QR codes the kiosk prints
> encode whatever origin the image was built with — moving the domain needs a **redeploy**,
> not just a DNS change, or the codes will keep sending phones to the old host.

## 3. Chromium setup

Autostart Chromium from the OS session so a power cut returns to the app unattended:

```
chromium-browser \
  --kiosk \
  --app=https://app.explorekingstonwa.com/kiosk \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --incognito \
  --no-first-run \
  --check-for-update-interval=31536000
```

Why each of the non-obvious ones:

- `--kiosk` — fullscreen, no address bar, no tabs. The visitor has no way to type a URL.
- `--disable-pinch` — stops a visitor zooming the fixed stage into an unusable state.
  **This is deliberately a device flag and not a page setting**: the same code serves
  phones, where blocking zoom would be an accessibility failure (WCAG 1.4.4). Putting it
  here means it applies only to the panel, and an operator can remove it.
- `--incognito` — nothing persists between restarts. On a shared device this is a privacy
  property, not a convenience: no history, no storage, nothing for the next visitor.
- `--disable-session-crashed-bubble` and `--noerrdialogs` — a "Chromium didn't shut down
  correctly" bubble on a public screen is both ugly and a tappable surface.
- `--check-for-update-interval` — long, so an update prompt never appears mid-season.

### The URL allowlist policy — the real lock

The app cancels navigations that would leave `/kiosk`, and no kiosk screen renders an
external link at all (both are CI-enforced). **That is defence in depth, not the lock.**
The enforcement is a Chromium policy on the device:

```json
// /etc/chromium/policies/managed/kiosk.json
{
  "URLBlocklist": ["*"],
  "URLAllowlist": [
    "https://app.explorekingstonwa.com/kiosk",
    "https://app.explorekingstonwa.com/kiosk/*",
    "https://app.explorekingstonwa.com/api/*",
    "https://app.explorekingstonwa.com/_next/*",
    "https://app.explorekingstonwa.com/brand/*",
    "https://app.explorekingstonwa.com/sw.js",
    "https://app.explorekingstonwa.com/manifest.webmanifest"
  ],
  "IncognitoModeAvailability": 0,
  "BookmarkBarEnabled": false,
  "PasswordManagerEnabled": false,
  "PrintingEnabled": false
}
```

Deny-all-then-allow, not allow-some. A blocklist of known-bad destinations is a losing
game on a device nobody is watching; this way anything not on the list — including a page
we have not thought of — simply does not load.

Note `/admin` and `/portal` are **not** on the allowlist and must never be added.

## 4. Display, power, and hours

The display and enclosure are reused from the Qwick installation.
[KIOSK-POWER.md](KIOSK-POWER.md) owns the power budget and settles two things this
document only consumes:

- **Mains vs solar** — year-round off-grid at Kingston's latitude was assessed and
  rejected; a mains drop or a grid/solar hybrid wins.
- **Operating hours** — the screen sleeps overnight while the compute deep-idles. Set the
  sleep window in the OS power settings, not in the app; the kiosk has no opinion about
  what time it is.

**Still open in that document:** whether the existing panel is bright enough to read
behind glass in direct sun. That is a hardware question and a launch blocker for the
outdoor position — do not let it be discovered on install day.

## 5. Network

Wired is preferable. An LTE hotspot is acceptable — the service worker caches the kiosk
screens and the last ferry snapshot, so short outages show slightly stale content rather
than an error, and the "Be right back" strip appears only after about three minutes of
confirmed silence.

The kiosk is **read-only**: it submits nothing, stores nothing about visitors, and needs
no inbound access. A firewall may block everything except outbound HTTPS to the app host.

## 6. Field test — do this on install day, in this order

Record the results at the bottom of this file.

1. **It comes up by itself.** Pull the mini PC's power. Plug it back in. It must reach the
   welcome screen with nobody touching a keyboard. *This is the single most important
   test — every recovery instruction in §1 depends on it.*
2. **Pull the plug on the network.** With a screen open, disconnect the network. Confirm
   the last-loaded content stays on screen; confirm "Be right back" appears within a few
   minutes; confirm it is a strip and not a blank screen. Reconnect: the message must
   clear on its own.
3. **Try to escape.** Long-press. Try to select text. Drag an image. Look for anything
   tappable that is not a kiosk button. Scan a QR with your own phone and confirm it opens
   the right page **with `utm_source=kiosk` in the address** — that tag is how the Chamber
   counts what the kiosk is worth.
4. **Content reaches it.** Edit a restaurant's description in admin. Confirm the kiosk
   shows the change within about a minute. Then use Admin → Kiosk → **Refresh now** and
   confirm a second change appears immediately.
5. **It resets between visitors.** Open a screen, walk away, and time it. It must return to
   the welcome screen at the configured idle timeout.
6. **Overnight soak.** Leave it running. Next morning confirm: the welcome photographs are
   still cycling, the ferry times are today's, and the screen has not dimmed into a stuck
   frame.
7. **Read it standing up.** From where a visitor actually stands, in the light it actually
   gets. If the text is too small or the glare wins, that is a finding — record it.

## 7. Who to call

Fill this in before the device goes live, and put the names on the printed card:

| Problem | Who |
| --- | --- |
| Content wrong / kiosk needs turning off | *Chamber staff with admin access — name:* |
| Screen or mini PC hardware | *name:* |
| Network at the dock | *name:* |
| App itself is down (see /admin/ops) | *name:* |

## 8. Future: more than one kiosk

Not built, deliberately — there is one device. The seam is reserved: a second kiosk would
be pointed at `/kiosk?device=<id>` and the layout would read that parameter to select
per-device settings. Nothing today reads it, and nothing should be built for it until
there is a real second panel.

## 9. Retiring Qwick

This kiosk **replaces the Qwick Tourist software**, which is a delisted product on an
annual licence. Turning this on is not the same as cancelling that — the licence-dated
decommission checklist, the final content export, and the 166-listing import/claim policy
all belong to **E17**, not here.

Do not cancel the Qwick subscription until this kiosk has passed §6 on the real device.
Two working kiosks for a month is a much better problem than none.

---

## Field-test record

*Fill in on install day.*

| # | Test | Date | By | Result |
| --- | --- | --- | --- | --- |
| 1 | Recovers from power loss unattended | | | |
| 2 | Survives a network drop, recovers | | | |
| 3 | No escape from the app; QR carries `utm_source=kiosk` | | | |
| 4 | Admin edit reaches the screen (~1 min, and instantly via Refresh) | | | |
| 5 | Resets to welcome at the idle timeout | | | |
| 6 | Overnight soak clean | | | |
| 7 | Readable from where visitors stand | | | |
