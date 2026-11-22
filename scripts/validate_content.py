#!/usr/bin/env python3.11
"""Offline checks; pending assets/review are not release acceptance."""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OCTANTS = ('n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw')
AIRPORTS = {'capital-airport-welcome', 'daxing-airport-welcome'}


def valid_radius(sid, radius):
    low, high = (2000, 3000) if sid in AIRPORTS else (50, 1000)
    return type(radius) in (int, float) and low <= radius <= high


def coordinates(value):
    return (isinstance(value, dict)
            and all(type(value.get(k)) in (int, float) and math.isfinite(value[k]) for k in ('lat', 'lng'))
            and 39.3 <= value['lat'] <= 40.7 and 115.3 <= value['lng'] <= 117.5)


def distance(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    dlat, dlng = lat2 - lat1, math.radians(b['lng'] - a['lng'])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def validate(data, content, check_assets=True):
    errors, pending = [], []
    if data.get('version') != 1:
        errors.append('version: expected 1')
    if data.get('reviewStatus') != 'approved':
        pending.append('content review: development-only, not approved for publication')
    spots = data.get('spots', [])
    ids = [s.get('id') for s in spots]
    if len(spots) != 61 or len(set(ids)) != 61:
        errors.append('expected 61 unique spot ids')

    def local_file(url):
        if not isinstance(url, str) or not url:
            return None
        path = (content / url).resolve()
        return path if path.is_relative_to(content.resolve()) else None

    def audio(url, minimum, maximum):
        path = local_file(url)
        if path is None:
            errors.append(f'invalid local audio path: {url}')
        elif not path.is_file():
            pending.append(f'missing {url}')
        else:
            try:
                from mutagen.mp3 import MP3
                duration = MP3(path).info.length
                if not minimum <= duration <= maximum:
                    errors.append(f'{url}: duration {duration:.2f}s outside {minimum}-{maximum}s')
            except ImportError:
                pending.append('mutagen unavailable: duration checks not run')
            except Exception as exc:
                errors.append(f'{url}: unreadable MP3 ({type(exc).__name__})')

    welcome = data.get('welcome', {})
    for item in [welcome, *spots]:
        sid = item.get('id', 'welcome')
        for field in ('transcript', 'audio'):
            if not isinstance(item.get(field), str) or not item[field].strip():
                errors.append(f'{sid}: empty {field}')
        text = item.get('transcript', '')
        if any(marker in text for marker in ('⚠', '⚡', '核实', '审校', '本轮核查', '通行说法')):
            errors.append(f'{sid}: editorial residue')
        if check_assets:
            audio(item.get('audio'), 30, 600)
    for spot in spots:
        sid = spot.get('id')
        for field in ('id', 'name', 'summary'):
            if not isinstance(spot.get(field), str) or not spot[field].strip():
                errors.append(f'{sid}: empty {field}')
        if not valid_radius(sid, spot.get('radiusMeters')):
            errors.append(f'{sid}: invalid radius')
        lm = spot.get('landmark', {})
        if not lm.get('name'):
            errors.append(f'{sid}: empty landmark name')
        if not coordinates(spot) or not coordinates(lm):
            errors.append(f'{sid}: invalid coordinate bounds')
        elif valid_radius(sid, spot.get('radiusMeters')):
            meters = distance(spot, lm)
            if meters > spot['radiusMeters']:
                errors.append(f'{sid}: landmark outside fence ({meters:.1f}m > {spot["radiusMeters"]}m)')
        images = spot.get('images')
        if not isinstance(images, list):
            errors.append(f'{sid}: images must be an array')
        elif not images:
            pending.append(f'{sid}: images deferred by user (logged skip)')
        else:
            for image in images:
                if not isinstance(image.get('credit'), str) or not image['credit'].strip():
                    errors.append(f'{sid}: empty image credit')
                path = local_file(image.get('url'))
                if path is None or not path.is_file():
                    errors.append(f'{sid}: image file missing/invalid')
        if check_assets:
            for octant in OCTANTS:
                audio(f'audio/dir/spot-{sid}-{octant}.mp3', 1, 15)
    if check_assets:
        audio('audio/chime.mp3', 4.5, 5.5)
        bgm = list((content / 'audio/bgm').glob('*.mp3'))
        if len(bgm) != 5:
            pending.append(f'BGM: expected exactly 5 MP3 tracks, found {len(bgm)}')
        credits = content / 'audio/bgm/CREDITS.md'
        if not credits.is_file() or not credits.read_text().strip():
            pending.append('BGM: missing/non-empty CREDITS.md required')
    return errors, pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-only', action='store_true', help='skip audio checks; never release acceptance')
    args = parser.parse_args()
    data = json.loads((ROOT / 'content/spots.json').read_text())
    errors, pending = validate(data, ROOT / 'content', check_assets=not args.data_only)
    for error in errors:
        print(f'ERROR {error}')
    for item in pending:
        print(f'PENDING {item}')
    print(f'Offline report: {len(data.get("spots", []))} spots + welcome; {len(errors)} errors; {len(pending)} pending. NOT release acceptance.')
    return 1 if errors or pending else 0


if __name__ == '__main__':
    raise SystemExit(main())
