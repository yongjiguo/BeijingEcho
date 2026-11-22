#!/usr/bin/env python3.11
"""Sequential development TTS; dry masters never live in the public audio tree."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DRY = ROOT / 'content-src/audio-generated/dry'
VOICE = 'en-US-AndrewMultilingualNeural'
RATE = '-10%'
TEMPLATES = {
    'n': 'Straight ahead rises {landmark}.',
    'ne': '{landmark} is just ahead on your right.',
    'e': 'On your right stands {landmark}.',
    'se': 'Just behind you on your right is {landmark}.',
    's': '{landmark} is right behind you.',
    'sw': 'Just behind you on your left is {landmark}.',
    'w': 'On your left stands {landmark}.',
    'nw': '{landmark} is just ahead on your left.',
}


def review_gate(data, allow):
    if data.get('reviewStatus') != 'approved' and not allow:
        raise ValueError('pending review: explicit --allow-unreviewed required')


def provider(requested, env=None):
    env = os.environ if env is None else env
    configured = bool(env.get('AZURE_SPEECH_KEY') and env.get('AZURE_SPEECH_REGION'))
    if requested == 'azure' and not configured:
        raise ValueError('Azure credentials are not configured')
    return ('azure' if configured else 'edge') if requested == 'auto' else requested


def ssml(text):
    return f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="{VOICE}"><prosody rate="{RATE}">{escape(text)}</prosody></voice></speak>'


def jobs(data):
    result = [{'id': 'welcome', 'path': 'welcome.mp3', 'kind': 'welcome', 'text': data['welcome']['transcript']}]
    for spot in data['spots']:
        sid = spot['id']
        if not re.fullmatch('[a-z0-9-]+', sid):
            raise ValueError('unsafe spot id')
        result.append({'id': sid, 'path': f'spot-{sid}.mp3', 'kind': 'main', 'text': spot['transcript']})
        for direction, template in TEMPLATES.items():
            result.append({'id': sid, 'path': f'dir/spot-{sid}-{direction}.mp3', 'kind': 'dir', 'text': template.format(landmark=spot['landmark']['name'])})
    return result


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sidecar(path):
    return path.with_suffix('.manifest.json')


def duration(path):
    from mutagen.mp3 import MP3
    return MP3(path).info.length


def artifact(target, inputs, produce, dry_run=False, limits=(1, 600)):
    manifest = sidecar(target)
    previous = json.loads(manifest.read_text()) if manifest.exists() else None
    if target.exists():
        if not previous:
            raise ValueError(f'unmanaged target protected: {target}')
        if previous.get('sha256') != file_hash(target):
            raise ValueError(f'modified target protected: {target}')
        if previous.get('input') == inputs and limits[0] <= duration(target) <= limits[1]:
            return 'cached'
    if dry_run:
        return 'planned'
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.pending-', suffix='.mp3', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    meta_tmp = temporary.with_suffix('.json')
    try:
        produce(temporary)
        seconds = duration(temporary)
        if not limits[0] <= seconds <= limits[1]:
            raise ValueError(f'audio duration outside {limits}: {seconds:.2f}')
        record = {'input': inputs, 'sha256': file_hash(temporary), 'duration': seconds}
        meta_tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(target)
        meta_tmp.replace(manifest)
    finally:
        temporary.unlink(missing_ok=True)
        meta_tmp.unlink(missing_ok=True)
    return 'generated'


def synthesis_input(job, selected, status):
    return {'stage': 'tts-dry-v1', 'text': job['text'], 'kind': job['kind'], 'provider': selected,
            'voice': VOICE, 'rate': RATE, 'reviewStatus': status}


def synthesize(text, selected, target):
    if selected == 'edge':
        import edge_tts
        async def run():
            await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate=RATE).save(str(target)), timeout=45)
        asyncio.run(run())
    else:
        import azure.cognitiveservices.speech as speech
        config = speech.SpeechConfig(subscription=os.environ['AZURE_SPEECH_KEY'], region=os.environ['AZURE_SPEECH_REGION'])
        config.set_speech_synthesis_output_format(speech.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3)
        synthesizer = speech.SpeechSynthesizer(speech_config=config, audio_config=None)
        result = synthesizer.speak_ssml_async(ssml(text)).get()
        if result.reason != speech.ResultReason.SynthesizingAudioCompleted:
            raise RuntimeError('Azure synthesis unsuccessful (credential details suppressed)')
        target.write_bytes(result.audio_data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider', choices=['auto', 'edge', 'azure'], default='auto')
    parser.add_argument('--allow-unreviewed', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--only', help='welcome or one spot id (includes 8 directions)')
    args = parser.parse_args()
    try:
        data = json.loads((ROOT / 'content/spots.json').read_text())
        review_gate(data, args.allow_unreviewed)
        selected = provider(args.provider)
        work = [j for j in jobs(data) if not args.only or j['id'] == args.only]
        if not work:
            raise ValueError('unknown --only id')
        print(f'provider={selected}; reviewStatus={data.get("reviewStatus", "unreviewed")}; jobs={len(work)}', flush=True)
        failures = []
        for index, job in enumerate(work):
            produced = False
            for attempt, backoff in ((1, 0), (2, 3), (3, 8)):
                if backoff:
                    time.sleep(backoff)
                try:
                    result = artifact(DRY / job['path'], synthesis_input(job, selected, data.get('reviewStatus', 'unreviewed')),
                                      lambda p: synthesize(job['text'], selected, p), args.dry_run,
                                      (1, 15) if job['kind'] == 'dir' else (30, 600))
                    print(f'{result}: {job["path"]}', flush=True)
                    produced = True
                    break
                except Exception as exc:
                    if attempt < 3:
                        print(f'retry{attempt} ({type(exc).__name__}): {job["path"]}', flush=True)
                    # Non-ValueError messages can leak endpoints/credentials; keep them out of logs.
            if not produced:
                failures.append(job['path'])
                print(f'FAIL: {job["path"]}', flush=True)
            if index < len(work) - 1:
                time.sleep(0.3)
        print(f'done: {len(work) - len(failures)}/{len(work)} ok, {len(failures)} failed', flush=True)
        for path in failures:
            print(f'  failed: {path}', flush=True)
        return 1 if failures else 0
    except Exception as exc:
        # Provider exceptions can include signed URLs or subscription details.
        message = str(exc) if isinstance(exc, ValueError) else 'provider/IO failed; no successful cache recorded'
        print(f'ERROR {type(exc).__name__}: {message}', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
