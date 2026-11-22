#!/usr/bin/env python3.11
"""Download spot photos from Wikimedia (URLs pre-fetched in spot-meta.json).

- Saves to content/images/spot-{id}.jpg, downscaled to max 1600px width (mobile-friendly).
- Credit from Commons API extmetadata (Artist + License); generic fallback when unavailable.
- Idempotent: skips spots already present in spots.json images[] unless --force.
"""
from __future__ import annotations

import argparse
import html
import json
import random
import re
import socket
import subprocess
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
META_PATH = ROOT / "content" / "spot-meta.json"
SPOTS_PATH = ROOT / "content" / "spots.json"
IMAGES_DIR = ROOT / "content" / "images"

UA = {"User-Agent": "BeijingEchoContentBot/0.1 (local content pipeline; one-off fetch)"}
API = "https://commons.wikimedia.org/w/api.php"
MAX_WIDTH = 1600
RPS_DELAY = 20.0  # bucket recovery observed ~seconds; stay polite but not sluggish


def _force_ipv6_if_works() -> bool:
    """Pin all DNS resolution to IPv6 when the v6 route to Wikimedia is healthy.

    This network's IPv4 path to Wikimedia times out during TLS handshake while IPv6
    works — dual-stack address selection made ~half of all requests fail.
    """
    orig = socket.getaddrinfo
    try:
        infos = orig("upload.wikimedia.org", 443, socket.AF_INET6)
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.settimeout(6)
        sock.connect(infos[0][4])  # sockaddr tuple already includes port 443
        sock.close()
    except OSError:
        return False

    def ipv6_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return orig(host, port, socket.AF_INET6, type, proto, flags)

    socket.getaddrinfo = ipv6_only_getaddrinfo
    return True


IPV6_FORCED = _force_ipv6_if_works()


def thumbify(image_url: str, width: int) -> str:
    """Convert an upload.wikimedia.org original URL to its thumbnail URL (much smaller file).

    .../commons/e/ef/NAME.ext -> .../commons/thumb/e/ef/NAME.ext/{width}px-NAME.ext
    (SVG thumbs end in .png; ffmpeg probes by content so extension mismatches are harmless.)
    """
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/commons)/([^/]+/[^/]+/[^/]+)$", image_url)
    if not m:
        return image_url
    base, tail = m.groups()
    name = tail.rsplit("/", 1)[-1]
    return f"{base}/thumb/{tail}/{width}px-{name}"


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return html.unescape(text).strip()


def credit_for(wiki_file: str, cache: dict[str, str] | None = None) -> str:
    """Artist + license from Commons extmetadata; generic fallback.

    When a batched cache (from credits_for_many) is provided, no API call is made here.
    """
    if cache is not None and wiki_file in cache:
        return cache[wiki_file]
    title = "File:" + wiki_file
    try:
        resp = requests.get(API, params={
            "action": "query", "titles": title, "prop": "imageinfo",
            "iiprop": "extmetadata", "format": "json",
        }, headers=UA, timeout=20)
        pages = (resp.json().get("query", {}) or {}).get("pages", {}) or {}
        info = next(iter(pages.values()), {}).get("imageinfo", [])
        meta = (info[0].get("extmetadata", {}) or {}) if info else {}
        artist = strip_html((meta.get("Artist", {}) or {}).get("value", ""))
        license_ = strip_html((meta.get("LicenseShortName", {}) or {}).get("value", ""))
        if artist:
            credit = f"Photo: {artist}" + (f", {license_}" if license_ else "")
            return f"{credit} · via Wikimedia Commons"
    except Exception as exc:
        print(f"  credit lookup failed for {wiki_file}: {type(exc).__name__}")
    return f"Photo: Wikimedia Commons file '{wiki_file}' (see file page for author/license)"


def credits_for_many(wiki_files: list[str]) -> dict[str, str]:
    """Batch credit lookup: one API call per up to 40 files (vs one per file)."""
    out: dict[str, str] = {}
    for i in range(0, len(wiki_files), 40):
        chunk = [f for f in wiki_files[i:i + 40] if f not in out]
        if not chunk:
            continue
        titles = "|".join("File:" + f for f in chunk)
        try:
            resp = requests.get(API, params={
                "action": "query", "titles": titles, "prop": "imageinfo",
                "iiprop": "extmetadata", "format": "json", "formatversion": "2",
            }, headers=UA, timeout=30)
            for page in (resp.json().get("query", {}) or {}).get("pages", []) or []:
                title = (page.get("title") or "").removeprefix("File:").replace(" ", "_")
                meta = ((page.get("imageinfo") or [{}])[0].get("extmetadata") or {})
                artist = strip_html((meta.get("Artist", {}) or {}).get("value", ""))
                license_ = strip_html((meta.get("LicenseShortName", {}) or {}).get("value", ""))
                if artist:
                    credit = f"Photo: {artist}" + (f", {license_}" if license_ else "")
                    out[title] = f"{credit} · via Wikimedia Commons"
        except Exception as exc:
            print(f"  batch credit lookup failed (chunk {i // 40}): {type(exc).__name__}")
        time.sleep(2)
    return out


def download(url_candidates: list[str], target: Path) -> None:
    """Try each candidate URL (thumb first, original as fallback) with backoff on 429.

    Downloads shell out to curl: Wikimedia's Varnish edge throttles the python-requests
    TLS fingerprint much more aggressively (verified: same URL+moment via IPv6 —
    curl 200, requests 429). The Commons API still uses requests (that host is fine).
    """
    last_error: Exception | None = None
    raw = target.with_suffix(".bin")  # ffmpeg probes content, extension irrelevant
    for url in url_candidates:
        for attempt, backoff in ((1, 0), (2, 15), (3, 30), (4, 45)):
            if backoff:
                print(f"  retry {attempt} after {backoff}s …", flush=True)
                time.sleep(backoff)
            try:
                proc = subprocess.run(
                    ["curl", "-6", "-sS", "-L", "--max-time", "180",
                     "-A", UA["User-Agent"], "-o", str(raw), "-w", "%{http_code}", url],
                    capture_output=True, text=True, timeout=200)
                code = proc.stdout.strip()
                if code == "429":
                    raise requests.HTTPError("429 rate-limited (curl)")
                if code != "200":
                    raise requests.HTTPError(f"HTTP {code or '?'}: {proc.stderr.strip()[:100]}")
                # normalize to jpg, cap width at 1600px (no-op scale if smaller)
                subprocess.run(
                    ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                     "-i", str(raw), "-vf", f"scale='min({MAX_WIDTH},iw)':-2", "-q:v", "4", str(target)],
                    check=True, capture_output=True, timeout=120)
                raw.unlink(missing_ok=True)
                if not target.is_file() or target.stat().st_size < 10_000:
                    raise ValueError(f"suspicious output size for {target.name}")
                return
            except Exception as exc:
                last_error = exc
                print(f"  download attempt {attempt} failed: {type(exc).__name__}: {exc}", flush=True)
    raise RuntimeError(f"download failed: {url_candidates} ({type(last_error).__name__})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="redownload even if spot already has images")
    parser.add_argument("--only", help="single spot id")
    parser.add_argument("--credits-only", action="store_true", help="refresh credit strings without downloading")
    args = parser.parse_args()
    print(f"ipv6-forced: {IPV6_FORCED}", flush=True)

    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    spots_doc = json.loads(SPOTS_PATH.read_text(encoding="utf-8"))
    spots = spots_doc["spots"]
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    existing = {s["id"] for s in spots if s.get("images")}
    done, skipped, failed = 0, 0, []

    # Pass 1: collect pending downloads, batch-fetch credits (1-2 API calls total)
    pending: list[tuple[str, str, Path, str]] = []  # (sid, url, target, wiki_file)
    for spot in spots:
        sid = spot["id"]
        if args.only and sid != args.only:
            continue
        entry = meta.get(sid) or {}
        url = entry.get("imageUrl")
        if not url:
            skipped += 1
            print(f"SKIP {sid}: no imageUrl (logged)")
            continue
        if not args.credits_only and not args.force and sid in existing:
            skipped += 1
            continue
        wiki_file = entry.get("wikiFile") or url.rsplit("/", 1)[-1]
        pending.append((sid, url, IMAGES_DIR / f"spot-{sid}.jpg", wiki_file))

    print(f"plan: {len(pending)} to download, {skipped} skipped", flush=True)
    credits = credits_for_many([p[3] for p in pending]) if pending else {}
    print(f"credits batched: {len(credits)}/{len(pending)}", flush=True)

    if args.credits_only:
        refreshed = 0
        for spot in spots:
            entry = meta.get(spot["id"]) or {}
            wiki_file = entry.get("wikiFile")
            if wiki_file and wiki_file in credits and spot.get("images"):
                spot["images"][0]["credit"] = credits[wiki_file]
                refreshed += 1
        SPOTS_PATH.write_text(json.dumps(spots_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"credits refreshed: {refreshed}/{len(pending)}")
        return

    # Pass 2: download one by one, slow pacing (token-bucket ~1/2min); save after each success
    for sid, url, target, wiki_file in pending:
        print(f"[{sid}] downloading…", flush=True)
        try:
            download([thumbify(url, 1280), url], target)
            credit = credit_for(wiki_file, cache=credits)
            spot_by_id = next(s for s in spots if s["id"] == sid)
            spot_by_id["images"] = [{"url": f"images/{target.name}", "credit": credit}]
            done += 1
            SPOTS_PATH.write_text(json.dumps(spots_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  ok ({target.stat().st_size // 1024} KB) credit: {credit[:70]}…", flush=True)
        except Exception as exc:
            failed.append(sid)
            print(f"  FAIL {sid}: {exc}", flush=True)
        time.sleep(RPS_DELAY + random.uniform(0, 15))

    SPOTS_PATH.write_text(json.dumps(spots_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\ndone: {done} downloaded, {skipped} skipped, {len(failed)} failed: {failed or 'none'}")


if __name__ == "__main__":
    main()
