#!/usr/bin/env python3
"""Generate public/geo/street-parking.json — the color-coded street overlay.

Inputs (fetch fresh, then run from the repo root):
  streets-raw.json  — Overpass export of highways in the Kingston UGA bbox:
      curl -s -X POST https://overpass-api.de/api/interpreter --data-urlencode \
        'data=[out:json][timeout:90];(way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"](47.770,-122.530,47.812,-122.483););out geom;' \
        -o streets-raw.json
  kingston-cdp.json — Census TIGERweb GeoJSON for Kingston CDP (GEOID 5335870):
      curl -s "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/5/query?where=GEOID%3D%275335870%27&outFields=NAME,GEOID&returnGeometry=true&geometryPrecision=5&f=geojson" \
        -o kingston-cdp.json

Usage: python3 scripts/gen-street-parking.py <streets-raw.json> <kingston-cdp.json>

Rule sources: the 2015/2016 Kitsap County "Kingston Complete Streets" study
(street time limits), Port of Kingston 2025 parking policy, and KCC 46.02/.04
— see docs/DATA_SOURCES.md. Streets without a researched rule get "default"
(no known restriction; obey posted signs; RCW 46.55.085 24-hour rule).
"""

import json
import sys

STUDY_NOTE = "Per the 2015 county parking study — signs on the pole always win. Not re-surveyed since Complete Streets construction."

# name -> (rule, note) applied way-by-way, with optional per-way overrides below
NAME_RULES = {
    "Central Avenue Northeast": ("prohibited", "Parking prohibited full length (bike lanes, main Port outbound route)."),
    "Washington Boulevard Northeast": ("prohibited", "Parking prohibited (ferry offload route)."),
    "Northeast State Highway 104": ("prohibited", "No shoulder parking — ferry holding line; striped/signed against queue-jumping."),
    "State Highway 104": ("prohibited", "No shoulder parking — ferry holding line."),
    "Northeast West Kingston Road": ("prohibited", "Parking prohibited per county study."),
    "Northeast 2nd Street": ("free-2hr", STUDY_NOTE),
    "Northeast Georgia Avenue": ("free-unrestricted", "Unrestricted free street parking per county study — closest no-limit parking to the ferry. " + STUDY_NOTE),
    "Pennsylvania Avenue Northeast": ("free-unrestricted", "Free with no time limit on ONE SIDE only — the other side is signed no-parking. " + STUDY_NOTE),
}


def midpoint(way):
    pts = way["geometry"]
    return pts[len(pts) // 2]


def classify(way):
    name = way.get("tags", {}).get("name", "")
    mid = midpoint(way)
    lat, lng = mid["lat"], mid["lon"]

    if name in NAME_RULES:
        return NAME_RULES[name]
    # Segment-level rules (midpoint thresholds ≈ block boundaries)
    if name == "Northeast 1st Street":
        if lng > -122.4992:  # downtown core blocks near Ohio/Iowa
            return ("free-2hr", STUDY_NOTE)
        return ("default", None)
    if name == "Ohio Avenue Northeast":
        if 47.7978 <= lat <= 47.8004:  # NE 1st to NE 2nd
            return ("free-2hr", STUDY_NOTE)
        return ("default", None)
    if name == "Iowa Avenue Northeast":
        if lat <= 47.8010:  # SR 104 up to NE 3rd
            return ("free-2hr", STUDY_NOTE)
        return ("default", None)
    if name == "Illinois Avenue Northeast":
        if lat <= 47.8003:  # lower blocks near SR 104
            return ("free-2hr", STUDY_NOTE)
        return ("free-unrestricted", "Upper blocks unrestricted per county study. " + STUDY_NOTE)
    return ("default", None)


def point_in_ring(lat, lng, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def main(streets_path, cdp_path):
    streets = json.load(open(streets_path))
    cdp = json.load(open(cdp_path))
    geom = cdp["features"][0]["geometry"]
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]

    segments = []
    for way in streets.get("elements", []):
        pts = way.get("geometry")
        if not pts:
            continue
        # Keep ways that touch the UGA (any of first/mid/last point inside)
        probes = [pts[0], pts[len(pts) // 2], pts[-1]]
        if not any(point_in_ring(p["lat"], p["lon"], ring) for p in probes):
            continue
        rule, note = classify(way)
        seg = {
            "name": way.get("tags", {}).get("name", "Unnamed road"),
            "rule": rule,
            "coords": [[round(p["lat"], 5), round(p["lon"], 5)] for p in pts],
        }
        if note:
            seg["note"] = note
        segments.append(seg)

    boundary = [[round(c[1], 5), round(c[0], 5)] for c in ring]
    out = {
        "generated": "from OSM (streets) + Census TIGERweb Kingston CDP 5335870 (boundary)",
        "boundary": boundary,
        "segments": segments,
    }
    with open("public/geo/street-parking.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))

    from collections import Counter
    counts = Counter(s["rule"] for s in segments)
    print("segments:", len(segments), dict(counts))
    print("bytes:", len(json.dumps(out, separators=(",", ":"))))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
