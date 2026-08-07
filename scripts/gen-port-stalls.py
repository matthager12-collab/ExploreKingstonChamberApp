#!/usr/bin/env python3
"""Generate public/geo/port-stalls.json — bay-level geometry for the Port lot.

Input: the Port of Kingston's official parking map PDF, which is vector art
rather than a scan, so the stall bays, the row blocks and the legend colours
can all be read out of it exactly:
  https://portofkingston.org/wp-content/uploads/2025/12/Updated-Parking-Map-12-30-25.pdf

Usage (from the repo root):
  python3 scripts/gen-port-stalls.py ~/Downloads/Updated-Parking-Map-12-30-25.pdf \
      > public/geo/port-stalls.json

WHY THIS IS PIECEWISE, AND WHY THAT MATTERS.

The obvious approach — fit the whole sheet to the world once and overlay it —
does not work. Fitting the schematic's five biggest zone blocks against the
same zones' aerial-snapped centres in src/lib/data/parking.ts gives RMS 9.6 m
and a worst case of 16.2 m: about six stall widths. The schematic straightens
rows, regularises bay spacing and rounds off the shoreline, so no single
similarity transform can satisfy both ends of the sheet at once. (The same
finding is recorded in parking.ts's header: "the schematic's similarity-fit
residuals grow to ~15 m at the map edges, hence the per-zone snapping".)

So each zone is fitted on its own. The schematic supplies INTERNAL STRUCTURE —
how many bays a row holds, which way they run, which rows are double-loaded.
The app's zone polygon supplies POSITION. Every bay is generated inside the
polygon of the zone it belongs to, so bays inherit that zone's accuracy and
cannot drift outside it.

WHAT THIS DOES AND DOES NOT CLAIM.

Claimed: this row is double-loaded, holds these numbered bays, and runs on this
bearing inside this zone. All of that is on the Port's map.

Not claimed: that bay 47 is at a surveyed position. Bays are uniform
subdivisions of a row, which is exactly how the Port draws them and is not how
asphalt works. Everything here inherits the zone's "probable" confidence, and
the painted markings on the ground always win. Do not relabel this "verified"
without a field survey.
"""

import json
import math
import sys

# ------------------------------------------------------------ PDF vocabulary

# Fill colours in the Port's art -> our zone classes. Two greys and two reds
# appear because the sheet was assembled over several revisions.
LEGEND = {
    "#ffd640": "pokpark", "#ffc000": "pokpark",
    "#92d050": "pokhill",
    "#a7a9ac": "poktt",   "#bfbfbf": "poktt",
    "#ff66ff": "free2hr",
    "#7030a0": "tenant",
    "#00b0f0": "disabled",
    "#b50b3c": "portuse", "#8b0000": "portuse",
}

# The legend key itself is drawn with the same fills, in this box. Skip it.
LEGEND_BOX = (100, 600, 260, 960)

# Two rows are drawn bay-by-bay rather than as one block: the 181–190 and
# 214–233 columns flanking Washington Blvd, where the Port drew each stall as
# its own rectangle (plus a second, half-pixel-offset copy of each). Left
# alone they key as ~50 separate slivers and the row's length collapses. Merge
# every block of `cls` whose centroid lands in the box, under one key.
#   (x0, y0, x1, y1, cls, merged_key)
MERGE_REGIONS = [
    (1038, 262, 1068, 525, "pokpark", (1051, 400)),   # 214–233
    (1006, 235, 1034, 372, "pokpark", (1019, 300)),   # 181–190
]

# Rows, keyed by the rounded PDF centroid of their colour block. Keys are
# stable because the input PDF is a fixed, dated document.
#
# `sides` is the double-loaded structure the Port draws: one entry per bank of
# bays, with that bank's count and its printed number range. Counts come from
# the ranges the Port prints on the sheet, NOT from counting divider strokes —
# the strokes undercount (trailer bays are longer than any sane divider filter,
# and the hill block is a single shape covering two banks).
#
# Verified by rendering each block outlined and numbered over the sheet and
# reading the printed ranges off it; see the docstring above for the caveat.
ROWS = {
    (333, 443): ("port-pokhill", "POKHILL", [(29, "104–132"), (30, "133–162")]),
    (685, 705): ("port-poktt", "POKTT", [(18, "301–318")]),
    (774, 653): ("port-pokpark-main-fan", "POKPARK", [(20, "47–66"), (22, "67–88")]),
    (866, 624): ("port-pokpark-main-fan", "POKPARK", [(13, "19–31"), (15, "32–46")]),
    (962, 595): ("port-pokpark-main-fan", "POKPARK", [(6, "5–10"), (8, "11–18")]),
    (1052, 581): ("port-pokpark-main-fan", "POKPARK", [(4, "1–4")]),
    (784, 492): ("port-pokpark-89-103", "POKPARK", [(15, "89–103")]),
    (1042, 154): ("port-pokpark-north-rows", "POKPARK", [(7, "201–213")]),
    (1048, 214): ("port-pokpark-north-rows", "POKPARK", [(6, "201–213")]),
    (1019, 300): ("port-pokpark-north-rows", "POKPARK", [(10, "181–190")]),
    (1051, 400): ("port-pokpark-north-rows", "POKPARK", [(20, "214–233")]),
    (1117, 393): ("port-free-2hr-row", None, [(15, None), (15, None)]),
    (872, 489): ("port-kcyc-permit-row", None, [(11, None)]),
    (130, 336): ("port-pokhill", None, [(5, None)]),
    (1196, 475): ("port-tenant-row-park", None, [(6, None)]),
    # The four tenant/Port-use caps at the waterfront ends of the fan rows are
    # framed by port-pokpark-main-fan, NOT by port-tenant-fan-block. Two
    # reasons. Only one of the four has a polygon at all — parking.ts says the
    # caps on rows 19–88 and 1–4 were never polygonized — so framing them all
    # by the one small polygon squeezes four rows' worth of art into a single
    # block and bays collapse to 0.7 m. And the fan polygon is the better
    # frame regardless: it is aerial-snapped (PORT_GEO_NOTE), while the tenant
    # block is schematic-only (PORT_SCHEMATIC_NOTE, "among the least certain
    # shapes here"). The frame decides POSITION; the colour class still
    # decides the rule, so these stay permit and Port-use on the map.
    (960, 718): ("port-pokpark-main-fan", None, [(5, None)]),
    (1023, 657): ("port-pokpark-main-fan", None, [(5, None)]),
    (889, 769): ("port-pokpark-main-fan", None, [(3, None)]),
    (913, 793): ("port-pokpark-main-fan", None, [(2, None)]),
    (808, 823): ("port-poktt", None, [(6, None)]),
    (1252, 393): ("port-15min-dropoff", None, [(6, None)]),
}

# Our rule for each schematic class, so the output carries the app's taxonomy
# rather than the Port's colour names.
CLASS_RULE = {
    "pokpark": "paid", "pokhill": "paid", "poktt": "paid",
    "free2hr": "free-2hr", "tenant": "permit", "disabled": "disabled",
    "portuse": "port-use",
}

LAT0 = 47.7972
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LNG = 111320.0 * math.cos(math.radians(LAT0))
LNG0 = -122.4980


# --------------------------------------------------------------- plane helpers


def hexof(c):
    return "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in c) if c else None


def hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2:
                (ax, ay), (bx, by) = out[-2], out[-1]
                if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) > 0:
                    break
                out.pop()
            out.append(p)
        return out[:-1]

    return half(pts) + half(list(reversed(pts)))


def min_area_rect(pts):
    """Oriented bounding box via rotating calipers.

    Returns (cx, cy, angle, half_long, half_short); `angle` is the long axis,
    which for these blocks is the direction the row runs.
    """
    h = hull(pts)
    if len(h) < 3:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0,
                max((max(xs) - min(xs)) / 2, 1e-6), max((max(ys) - min(ys)) / 2, 1e-6))
    best = None
    for i in range(len(h)):
        ax, ay = h[i]
        bx, by = h[(i + 1) % len(h)]
        ang = math.atan2(by - ay, bx - ax)
        c, s = math.cos(-ang), math.sin(-ang)
        xs = [p[0] * c - p[1] * s for p in h]
        ys = [p[0] * s + p[1] * c for p in h]
        w, ht = max(xs) - min(xs), max(ys) - min(ys)
        if best is None or w * ht < best[0]:
            mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
            cc, ss = math.cos(ang), math.sin(ang)
            best = (w * ht, mx * cc - my * ss, mx * ss + my * cc, ang, w / 2, ht / 2)
    _, cx, cy, ang, hw, hh = best
    if hh > hw:
        ang += math.pi / 2
        hw, hh = hh, hw
    return (cx, cy, ang, hw, hh)


def rect_corners(cx, cy, ang, hw, hh):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + x * c - y * s, cy + x * s + y * c)
            for x, y in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]


def similarity(src, dst):
    """Least-squares 2-D similarity: rotate + uniform scale + translate."""
    n = len(src)
    msx = sum(p[0] for p in src) / n
    msy = sum(p[1] for p in src) / n
    mdx = sum(p[0] for p in dst) / n
    mdy = sum(p[1] for p in dst) / n
    S = [(p[0] - msx, p[1] - msy) for p in src]
    D = [(p[0] - mdx, p[1] - mdy) for p in dst]
    a = sum(S[i][0] * D[i][0] + S[i][1] * D[i][1] for i in range(n))
    b = sum(S[i][0] * D[i][1] - S[i][1] * D[i][0] for i in range(n))
    den = sum(S[i][0] ** 2 + S[i][1] ** 2 for i in range(n))
    if den < 1e-12:
        return lambda x, y: (x - msx + mdx, y - msy + mdy)
    th = math.atan2(b, a)
    sc = math.hypot(a, b) / den
    c, s = math.cos(th) * sc, math.sin(th) * sc
    return lambda x, y: (c * (x - msx) - s * (y - msy) + mdx,
                         s * (x - msx) + c * (y - msy) + mdy)


def fit_box(src_box, dst_box):
    """Similarity taking one oriented box onto another, choosing whichever of
    the four corner alignments leaves corners closest."""
    sc = rect_corners(*src_box)
    dc = rect_corners(*dst_box)
    best = None
    for shift in range(4):
        rolled = dc[shift:] + dc[:shift]
        f = similarity(sc, rolled)
        err = sum(math.dist(f(*sc[i]), rolled[i]) for i in range(4))
        if best is None or err < best[0]:
            best = (err, f)
    return best[1]


def centroid_latlng(poly):
    """Area centroid of a [lat, lng] ring, returned as (lat, lng)."""
    a = clat = clng = 0.0
    n = len(poly)
    for i in range(n):
        la0, ln0 = poly[i]
        la1, ln1 = poly[(i + 1) % n]
        cr = ln0 * la1 - ln1 * la0
        a += cr
        clng += (ln0 + ln1) * cr
        clat += (la0 + la1) * cr
    if abs(a) < 1e-14:
        return (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)
    a *= 0.5
    return (clat / (6 * a), clng / (6 * a))


def to_world(lat, lng):
    return ((lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT)


def to_lnglat(x, y):
    return (round(LNG0 + x / M_PER_DEG_LNG, 6), round(LAT0 + y / M_PER_DEG_LAT, 6))


# ------------------------------------------------------------------ extraction


def read_blocks(path):
    """Colour blocks from the Port's sheet, minus the legend key swatches."""
    import fitz

    out = []
    for it in fitz.open(path)[0].get_drawings():
        cls = LEGEND.get(hexof(it.get("fill")))
        if not cls:
            continue
        pts = []
        for i in it["items"]:
            if i[0] == "l":
                pts += [(i[1].x, i[1].y), (i[2].x, i[2].y)]
            elif i[0] == "re":
                r = i[1]
                pts += [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
            elif i[0] == "qu":
                q = i[1]
                pts += [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y),
                        (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
        if len(pts) < 3:
            continue
        box = min_area_rect(pts)
        cx, cy = box[0], box[1]
        if LEGEND_BOX[0] < cx < LEGEND_BOX[2] and LEGEND_BOX[1] < cy < LEGEND_BOX[3]:
            continue
        out.append({"cls": cls, "box": box, "pts": pts})
    return out


def load_zones(parking_ts):
    """Zone id -> polygon, read straight out of the seed so the two can't drift."""
    import re

    src = open(parking_ts, encoding="utf-8").read()
    zones = {}
    for zid, body in re.findall(r'\{\s*\n\s{4}id: "([a-z0-9-]+)",(.*?)\n  \},\n', src, re.S):
        m = re.search(r"polygon: \[(.*?)\n    \],", body, re.S)
        if not m:
            continue
        pts = [(float(a), float(b))
               for a, b in re.findall(r"\[([-\d.]+), ([-\d.]+)\]", m.group(1))]
        if len(pts) >= 3:
            zones[zid] = pts
    return zones


# -------------------------------------------------------------------- geometry


def bays_for(quad, sides):
    """Split a row quad into banks of bays.

    `quad` is the row's four corners in world metres, corner 0->1 running along
    the row. One `sides` entry fills the quad; two split it across its width
    into the two banks of a double-loaded row.
    """
    (ax, ay), (bx, by), (cx, cy), (dx, dy) = quad
    out = []
    nb = len(sides)
    for bi, (count, rng) in enumerate(sides):
        t0, t1 = bi / nb, (bi + 1) / nb
        # Edges of this bank, interpolated across the row's width.
        e0 = (ax + (dx - ax) * t0, ay + (dy - ay) * t0)
        e1 = (bx + (cx - bx) * t0, by + (cy - by) * t0)
        f0 = (ax + (dx - ax) * t1, ay + (dy - ay) * t1)
        f1 = (bx + (cx - bx) * t1, by + (cy - by) * t1)
        for k in range(count):
            u0, u1 = k / count, (k + 1) / count
            p = [(e0[0] + (e1[0] - e0[0]) * u0, e0[1] + (e1[1] - e0[1]) * u0),
                 (e0[0] + (e1[0] - e0[0]) * u1, e0[1] + (e1[1] - e0[1]) * u1),
                 (f0[0] + (f1[0] - f0[0]) * u1, f0[1] + (f1[1] - f0[1]) * u1),
                 (f0[0] + (f1[0] - f0[0]) * u0, f0[1] + (f1[1] - f0[1]) * u0)]
            out.append((p, rng))
    return out


def merge_regions(blocks):
    """Collapse the bay-by-bay columns into one block each (see MERGE_REGIONS)."""
    pooled = {}
    rest = []
    for b in blocks:
        cx, cy = b["box"][0], b["box"][1]
        for x0, y0, x1, y1, cls, key in MERGE_REGIONS:
            if b["cls"] == cls and x0 <= cx <= x1 and y0 <= cy <= y1:
                pooled.setdefault(key, {"cls": cls, "pts": []})["pts"] += b["pts"]
                break
        else:
            rest.append(b)
    for key, m in pooled.items():
        box = min_area_rect(m["pts"])
        # Re-centre on the declared key so the ROWS lookup is exact.
        rest.append({"cls": m["cls"], "pts": m["pts"],
                     "box": (key[0], key[1]) + box[2:]})
    return rest


def build(pdf_path, parking_ts):
    blocks = merge_regions(read_blocks(pdf_path))
    zones = load_zones(parking_ts)

    # Attach each mapped block to its row record.
    tagged = []
    for b in blocks:
        key = (round(b["box"][0]), round(b["box"][1]))
        rec = ROWS.get(key)
        if rec is None:                       # tolerate ±1 pt rounding drift
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    rec = rec or ROWS.get((key[0] + dx, key[1] + dy))
        if rec:
            tagged.append({**b, "zone": rec[0], "code": rec[1], "sides": rec[2]})

    # ROTATION IS GLOBAL; SCALE AND POSITION ARE PER ZONE.
    #
    # The three obvious fits are each wrong in a different way, so this one is
    # deliberate. Fitting the whole sheet once leaves 16 m of error (above).
    # Fitting each zone's bounding box to its polygon's bounding box corrects
    # that but inherits the polygon's own defects — port-pokhill is an
    # axis-aligned rectangle where the real strip runs diagonally, and a box
    # fit obediently rotates 59 bays into that wrong box — and it cannot
    # express port-pokpark-north-rows at all, which is L-shaped. Keeping the
    # global rotation AND scale and merely shifting each zone preserves the
    # drawing but lets neighbouring zones slide into each other, because
    # nothing then constrains how much room a zone takes up.
    #
    # So: take the bearing from the sheet, which is one drawing and therefore
    # has exactly one rotation; take extent and position from the zone polygon,
    # which is what a human actually snapped to aerials. Three degrees of
    # freedom per zone — uniform scale and translation — solved by least
    # squares against the polygon's corners.
    anchors = [(t, zones[t["zone"]]) for t in tagged if t["zone"] in zones]
    # PDF y grows downward; flip it so the fit is a rotation, not a mirror.
    g = similarity(
        [(t["box"][0], -t["box"][1]) for t, _ in anchors],
        [to_world(*centroid_latlng(p)) for _, p in anchors],
    )
    # Recover the sheet's bearing from the global fit.
    ox, oy = g(0.0, 0.0)
    ux, uy = g(1.0, 0.0)
    theta = math.atan2(uy - oy, ux - ox)
    ct, st = math.cos(theta), math.sin(theta)

    feats, report = [], []
    for zid in sorted({t["zone"] for t in tagged}):
        mine = [t for t in tagged if t["zone"] == zid]
        poly = zones.get(zid)
        if not poly:
            continue
        # Rotate this zone's art by the sheet bearing, then solve for the one
        # scale and offset that best seat it in the zone polygon. Both sides
        # are compared corner-to-corner via their oriented boxes, so a long
        # thin row is matched on length and depth rather than on centroid only.
        src_box = min_area_rect([(p[0], -p[1]) for t in mine
                                 for p in rect_corners(*t["box"])])
        dst_box = min_area_rect([to_world(lat, lng) for lat, lng in poly])
        src = [(x * ct - y * st, x * st + y * ct) for x, y in rect_corners(*src_box)]
        dst = rect_corners(*dst_box)
        # Corner correspondence: whichever rotation of the destination box
        # leaves the rotated source closest.
        best = None
        for shift in range(4):
            rolled = dst[shift:] + dst[:shift]
            err = sum(math.dist(src[i], rolled[i]) for i in range(4))
            if best is None or err < best[0]:
                best = (err, rolled)
        dst = best[1]
        msx = sum(p[0] for p in src) / 4
        msy = sum(p[1] for p in src) / 4
        mdx = sum(p[0] for p in dst) / 4
        mdy = sum(p[1] for p in dst) / 4
        num = sum((src[i][0] - msx) * (dst[i][0] - mdx)
                  + (src[i][1] - msy) * (dst[i][1] - mdy) for i in range(4))
        den = sum((src[i][0] - msx) ** 2 + (src[i][1] - msy) ** 2 for i in range(4))
        s = num / den if den > 1e-9 else 1.0

        def f(x, y, s=s, msx=msx, msy=msy, mdx=mdx, mdy=mdy):
            rx, ry = x * ct - y * st, x * st + y * ct
            return (s * (rx - msx) + mdx, s * (ry - msy) + mdy)

        for t in mine:
            quad = [f(x, -y) for x, y in rect_corners(*t["box"])]
            side_len = math.dist(quad[0], quad[1])
            total = sum(c for c, _ in t["sides"])
            for pts, rng in bays_for(quad, t["sides"]):
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon",
                                 "coordinates": [[to_lnglat(*p) for p in pts]
                                                 + [to_lnglat(*pts[0])]]},
                    "properties": {"zone": zid, "rule": CLASS_RULE[t["cls"]],
                                   "code": t["code"], "range": rng},
                })
            report.append((zid, t["cls"], t["code"], total, side_len,
                           side_len / max(1, max(c for c, _ in t["sides"]))))

    return {"type": "FeatureCollection",
            "note": ("Bay geometry derived from the Port of Kingston map dated "
                     "2025-12-30, fitted per-zone to the aerial-snapped polygons "
                     "in src/lib/data/parking.ts. Bays are uniform subdivisions "
                     "of each row, as the Port draws them — not surveyed "
                     "positions. Painted markings on the ground always win."),
            "features": feats}, report


if __name__ == "__main__":
    pdf = sys.argv[1]
    ts = sys.argv[2] if len(sys.argv) > 2 else "src/lib/data/parking.ts"
    fc, report = build(pdf, ts)
    if "--report" in sys.argv:
        print(f"{'zone':30s} {'cls':9s} {'code':8s} {'bays':>5s} {'row_m':>7s} {'m/bay':>6s}",
              file=sys.stderr)
        for r in sorted(report):
            print(f"{r[0]:30s} {r[1]:9s} {str(r[2] or '-'):8s} {r[3]:5d} "
                  f"{r[4]:7.1f} {r[5]:6.2f}", file=sys.stderr)
        print(f"\n{len(fc['features'])} bays total", file=sys.stderr)
    json.dump(fc, sys.stdout, separators=(",", ":"))
