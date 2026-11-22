#!/usr/bin/env python3.11
"""Publish verified dry welcome/directions and mix narration from immutable dry masters."""
import argparse
import json
from pathlib import Path
import random
import shutil
import subprocess

from tts_generate import ROOT, DRY, VOICE, RATE, artifact, duration, file_hash, jobs, review_gate, sidecar

FILTER = '[1:a]volume=0.3981,afade=t=in:st=0:d=2[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[out]'


def assignments(data, tracks):
    if len(tracks) != 5:
        raise ValueError('exactly five BGM tracks required')
    rng = random.Random(2026)
    return {s['id']: rng.choice(sorted(tracks)) for s in data['spots']}


def mix_command(source, bgm, target):
    return ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
            '-stream_loop', '-1', '-i', str(bgm), '-filter_complex', FILTER, '-map', '[out]',
            '-codec:a', 'libmp3lame', '-b:a', '128k', str(target)]


def verify_dry(source, job):
    if not source.is_file() or not sidecar(source).is_file():
        raise ValueError(f'missing verified dry source: {source}')
    record = json.loads(sidecar(source).read_text())
    inputs = record.get('input', {})
    if (inputs.get('stage') != 'tts-dry-v1' or inputs.get('text') != job['text']
            or inputs.get('kind') != job.get('kind') or inputs.get('voice') != VOICE
            or inputs.get('rate') != RATE or record.get('sha256') != file_hash(source)):
        raise ValueError(f'stale/non-dry source: {source}')
    low, high = (1, 15) if job['kind'] == 'dir' else (30, 600)
    if not low <= duration(source) <= high:
        raise ValueError(f'invalid dry duration: {source}')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-unreviewed', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--only', help='welcome or spot id (includes dry directions)')
    args = parser.parse_args()
    try:
        data = json.loads((ROOT / 'content/spots.json').read_text())
        review_gate(data, args.allow_unreviewed)
        output = ROOT / 'content/audio'
        if not 4.5 <= duration(output / 'chime.mp3') <= 5.5:
            raise ValueError('existing chime must remain five seconds')
        tracks = sorted((output / 'bgm').glob('*.mp3'))
        mapping = assignments(data, tracks)
        if not (output / 'bgm/CREDITS.md').read_text().strip():
            raise ValueError('missing BGM credits')
        for track in tracks:
            if duration(track) <= 0:
                raise ValueError('invalid BGM')
        work = [j for j in jobs(data) if not args.only or j['id'] == args.only]
        if not work:
            raise ValueError('unknown --only id')
        for job in work:
            source, target = DRY / job['path'], output / job['path']
            if source.resolve() == target.resolve():
                raise ValueError('dry and mixed paths must differ')
            record = verify_dry(source, job)
            if record['input'].get('reviewStatus') != data.get('reviewStatus', 'unreviewed'):
                raise ValueError('source review status changed; regenerate dry first')
            inputs = {'stage': 'mix-v1' if job['kind'] == 'main' else 'copy-dry-v1',
                      'source': record, 'reviewStatus': data.get('reviewStatus', 'unreviewed')}
            if job['kind'] == 'main':
                bgm = mapping[job['id']]
                inputs.update({'bgm': bgm.name, 'bgm_sha256': file_hash(bgm), 'filter': FILTER, 'seed': 2026, 'bitrate': '128k'})
                def produce(p):
                    subprocess.run(mix_command(source, bgm, p), check=True, capture_output=True, timeout=120)
                    if abs(duration(p) - duration(source)) > 0.25 or file_hash(p) == file_hash(source):
                        raise ValueError('mix duration/content verification failed')
            else:
                def produce(p):
                    shutil.copyfile(source, p)
            result = artifact(target, inputs, produce, args.dry_run,
                              (1, 15) if job['kind'] == 'dir' else (30, 600))
            print(f'{result}: {job["path"]}', flush=True)
    except Exception as exc:
        print(f'ERROR {type(exc).__name__}: {exc}', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
