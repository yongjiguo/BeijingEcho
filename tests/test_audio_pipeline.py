import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / 'scripts/tts_generate.py').exists(), 'TTS pipeline missing')
        self.assertTrue((ROOT / 'scripts/mix_audio.py').exists(), 'mix pipeline missing')
        import tts_generate
        import mix_audio
        self.tts, self.mix = tts_generate, mix_audio

    def test_templates_and_counts(self):
        data = json.loads((ROOT / 'content/spots.json').read_text())
        jobs = self.tts.jobs(data)
        self.assertEqual(len(jobs), 550)
        self.assertEqual(sum(j['kind'] == 'dir' for j in jobs), 488)
        self.assertEqual(list(self.tts.TEMPLATES), ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
        expected = ['Straight ahead rises X.', 'X is just ahead on your right.', 'On your right stands X.', 'Just behind you on your right is X.', 'X is right behind you.', 'Just behind you on your left is X.', 'On your left stands X.', 'X is just ahead on your left.']
        self.assertEqual([s.format(landmark='X') for s in self.tts.TEMPLATES.values()], expected)

    def test_ssml_safe(self):
        text = 'A & B <voice> 北京欢迎你'
        tree = ET.fromstring(self.tts.ssml(text))
        self.assertEqual(''.join(tree.itertext()), text)
        self.assertIn('rate="-10%"', self.tts.ssml(text))

    def test_provider_and_review_gate(self):
        self.assertEqual(self.tts.provider('auto', {}), 'edge')
        self.assertEqual(self.tts.provider('auto', {'AZURE_SPEECH_KEY': 'x'}), 'edge')
        self.assertEqual(self.tts.provider('auto', {'AZURE_SPEECH_KEY': 'x', 'AZURE_SPEECH_REGION': 'y'}), 'azure')
        with self.assertRaises(ValueError):
            self.tts.provider('azure', {})
        with self.assertRaises(ValueError):
            self.tts.review_gate({}, False)
        self.tts.review_gate({}, True)

    def test_fingerprint_and_atomic_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'a.mp3'
            target.write_bytes(b'old demo' * 2000)
            with self.assertRaisesRegex(ValueError, 'unmanaged'):
                self.tts.artifact(target, {'text': 'new'}, lambda p: None)
            self.assertEqual(target.read_bytes(), b'old demo' * 2000)
            target.unlink()
            def fail(p):
                p.write_bytes(b'partial')
                raise RuntimeError('failed')
            with self.assertRaises(RuntimeError):
                self.tts.artifact(target, {'text': 'new'}, fail)
            self.assertEqual(list(Path(tmp).iterdir()), [])
            with patch.object(self.tts, 'duration', return_value=3):
                writer = lambda p: p.write_bytes(b'audio')
                self.assertEqual(self.tts.artifact(target, {'text': 'new'}, writer), 'generated')
                self.assertEqual(self.tts.artifact(target, {'text': 'new'}, fail), 'cached')
                self.assertEqual(self.tts.artifact(target, {'text': 'changed'}, writer), 'generated')
                target.write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError, 'modified'):
                    self.tts.artifact(target, {'text': 'changed'}, writer)

    def test_dry_run_no_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'missing/a.mp3'
            self.assertEqual(self.tts.artifact(target, {}, lambda p: self.fail(), dry_run=True), 'planned')
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_mix_command_and_assignment(self):
        command = self.mix.mix_command(Path('dry.mp3'), Path('bg.mp3'), Path('out.mp3'))
        self.assertIn('-stream_loop', command)
        self.assertIn('volume=0.3981,afade=t=in:st=0:d=2', ' '.join(command))
        self.assertIn('duration=first:normalize=0', ' '.join(command))
        self.assertNotIn('atempo', ' '.join(command))
        data = json.loads((ROOT / 'content/spots.json').read_text())
        tracks = sorted((ROOT / 'content/audio/bgm').glob('*.mp3'))
        assignments = self.mix.assignments(data, tracks)
        self.assertEqual(assignments, self.mix.assignments(data, tracks))
        self.assertEqual(len(assignments), 61)
        self.assertEqual(len(set(assignments.values())), 5)

    def test_real_ffmpeg_mix_is_idempotent_and_dry_stays_unchanged(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'dry.mp3', Path(tmp) / 'mixed.mp3'
            subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', str(source)], check=True)
            before = self.tts.file_hash(source)
            bgm = ROOT / 'content/audio/bgm/bgm-1-guzheng-loop.mp3'
            def produce(p):
                subprocess.run(self.mix.mix_command(source, bgm, p), check=True, capture_output=True)
            inputs = {'stage': 'mix', 'dry': before, 'bgm': self.tts.file_hash(bgm)}
            self.assertEqual(self.tts.artifact(target, inputs, produce), 'generated')
            self.assertEqual(self.tts.artifact(target, inputs, lambda p: self.fail()), 'cached')
            self.assertEqual(self.tts.file_hash(source), before)
            self.assertNotEqual(self.tts.file_hash(target), before)
            self.assertLess(abs(self.tts.duration(source) - self.tts.duration(target)), 0.15)

    def test_failed_regeneration_preserves_previous_success(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.tts, 'duration', return_value=3):
            target = Path(tmp) / 'a.mp3'
            self.tts.artifact(target, {'text': 'old'}, lambda p: p.write_bytes(b'original'))
            manifest = self.tts.sidecar(target).read_bytes()
            def fail(p):
                p.write_bytes(b'partial')
                raise RuntimeError('offline')
            with self.assertRaises(RuntimeError):
                self.tts.artifact(target, {'text': 'new'}, fail)
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(self.tts.sidecar(target).read_bytes(), manifest)

    def test_mixed_source_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'a.mp3'
            source.write_bytes(b'mixed')
            self.tts.sidecar(source).write_text(json.dumps({'input': {'stage': 'mix'}, 'sha256': self.tts.file_hash(source)}))
            with self.assertRaises(ValueError):
                self.mix.verify_dry(source, {'text': 'x'})


if __name__ == '__main__':
    unittest.main()
