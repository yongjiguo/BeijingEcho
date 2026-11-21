#!/usr/bin/env python3.11
"""Fetch spot coordinates + lead images from Wikipedia REST API.

Input : content/wikipedia-titles.json  (61 rows: id/title/landmarkTitle/radiusMeters)
Output: content/spot-meta.json         { id: { lat, lng, imageUrl, wikiFile, landmark } }

Behavior per plan Task 9: REST page/summary per title, 1 req/sec, UA header,
retry once on failure; failures are logged, not fatal.
"""

from __future__ import annotations

import json
import os
import time
import unicodedata
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
TITLES_PATH = ROOT / "content" / "wikipedia-titles.json"
OUT_PATH = ROOT / "content" / "spot-meta.json"

API = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
HEADERS = {
    "User-Agent": "BeijingEcho-ContentBot/0.1 (local content pipeline; one-off fetch)",
    "Accept": "application/json",
}
RPS_DELAY = 1.1
TIMEOUT = 20


def summary(title: str) -> dict | None:
    """Fetch page/summary for a title; one retry; None on final failure."""
    url = API.format(title=urllib.parse.quote(title.replace(" ", "_"), safe=""))
    for attempt in (1, 2):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            print(f"  HTTP {resp.status_code} for '{title}' (attempt {attempt})")
        except requests.RequestException as exc:
            print(f"  request error for '{title}' (attempt {attempt}): {exc}")
        if attempt == 1:
            time.sleep(2)
    return None


def image_basename(url: str | None) -> str | None:
    if not url:
        return None
    return os.path.basename(urllib.parse.unquote(url.split("/File/")[-1] if "/File/" in url else url))


def coords(payload: dict) -> tuple[float, float] | None:
    c = payload.get("coordinates") or {}
    lat, lng = c.get("lat"), c.get("lon")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def main() -> None:
    rows = json.loads(TITLES_PATH.read_text(encoding="utf-8"))
    print(f"{len(rows)} rows loaded from {TITLES_PATH.name}")

    meta: dict[str, dict] = {}
    missing_coords: list[str] = []
    missing_image: list[str] = []
    failed_titles: list[str] = []
    failed_landmarks: list[str] = []

    for i, row in enumerate(rows):
        spot_id, title, landmark_title = row["id"], row["title"], row.get("landmarkTitle")
        print(f"[{i + 1}/{len(rows)}] {spot_id} <- '{title}'")

        payload = summary(title)
        if payload is None:
            failed_titles.append(f"{spot_id} ({title})")
            meta[spot_id] = {"lat": None, "lng": None, "imageUrl": None, "wikiFile": None, "landmark": None}
            time.sleep(RPS_DELAY)
            continue

        latlng = coords(payload)
        image_url = (payload.get("originalimage") or {}).get("source")

        entry: dict = {
            "lat": latlng[0] if latlng else None,
            "lng": latlng[1] if latlng else None,
            "imageUrl": image_url,
            "wikiFile": image_basename(image_url),
            "landmark": None,
        }
        if latlng is None:
            missing_coords.append(f"{spot_id} ({title})")
        if image_url is None:
            missing_image.append(spot_id)

        if landmark_title:
            time.sleep(RPS_DELAY)
            lm_payload = summary(landmark_title)
            lm = coords(lm_payload) if lm_payload else None
            if lm is None:
                failed_landmarks.append(f"{spot_id} ({landmark_title})")
            else:
                entry["landmark"] = {"lat": lm[0], "lng": lm[1]}

        meta[spot_id] = entry
        time.sleep(RPS_DELAY)

    OUT_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n==== summary ====")
    print(f"written: {OUT_PATH} ({len(meta)} ids)")
    if missing_coords:
        print(f"missing coords ({len(missing_coords)}): {', '.join(missing_coords)}")
    if missing_image:
        print(f"missing image ({len(missing_image)}): {', '.join(missing_image)}")
    if failed_titles:
        print(f"FAILED titles ({len(failed_titles)}): {', '.join(failed_titles)}")
    if failed_landmarks:
        print(f"FAILED landmark lookups ({len(failed_landmarks)}): {', '.join(failed_landmarks)}")

    # Beijing bounds sanity per plan Task 9 Step 3
    out_of_bounds = [
        sid
        for sid, e in meta.items()
        if e["lat"] is not None and not (39.3 <= e["lat"] <= 40.4 and 115.3 <= e["lng"] <= 117.6)
    ]
    if out_of_bounds:
        print(f"OUT OF BEIJING BOUNDS ({len(out_of_bounds)}): {', '.join(out_of_bounds)}")
    else:
        print("all coords inside Beijing bounds (lat 39.3-40.4, lng 115.3-117.6)")


if __name__ == "__main__":
    main()
