import copy
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    path = ROOT / 'scripts' / f'{name}.py'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / 'scripts/build_spots_json.py').exists(), 'build script missing')
        self.build = load('build_spots_json')

    def test_real_drafts_ids_and_unchanged(self):
        paths = sorted((ROOT / 'content-src').glob('narrations-draft*.md'))
        before = [p.read_bytes() for p in paths]
        data, warnings = self.build.build_data(ROOT)
        ids = {r['id'] for r in json.loads((ROOT / 'content/wikipedia-titles.json').read_text())}
        self.assertEqual(len(data['spots']), 61)
        self.assertEqual({s['id'] for s in data['spots']}, ids)
        self.assertEqual(len(self.build.parse_drafts(paths)), 62)
        self.assertEqual(before, [p.read_bytes() for p in paths])
        spots = {s['id']: s for s in data['spots']}
        self.assertIn('北京欢迎你', spots['capital-airport-welcome']['transcript'])
        self.assertIn('北京欢迎你', spots['daxing-airport-welcome']['transcript'])
        self.assertIn('爨,', spots['cuandixia']['transcript'])
        self.assertIn('不到长城非好汉', spots['badaling-great-wall']['transcript'])
        self.assertIn('twenty-three and', spots['mutianyu-great-wall']['transcript'])
        self.assertIn('public zoo, it grew', spots['beijing-zoo']['transcript'])
        self.assertIn('horizon. Walk north', spots['tiananmen-square']['transcript'])
        self.assertIn('taxes. The temple', spots['baiyun-guan']['transcript'])
        self.assertIn('ago and loved', spots['dajue-temple']['transcript'])
        self.assertIn('years ago by tradition — making', spots['tanzhe-temple']['transcript'])
        self.assertTrue(warnings)
        for item in [data['welcome'], *data['spots']]:
            text = item['transcript']
            self.assertNotRegex(text, r'⚠|⚡|核实|审校|本轮|通行说法|[a-z][.!?][A-Z]')
            self.assertGreater(len(text.split()), 100)
        prev_images = {s['id']: s['images'] for s in json.loads((ROOT / 'content/spots.json').read_text())['spots'] if s.get('images')}
        for s in data['spots']:
            self.assertEqual(s['images'], prev_images.get(s['id'], []))

    def test_cleaning_preserves_english_and_rejects_ambiguity(self):
        clean = self.build.clean_transcript
        self.assertEqual(clean('x', 'One. ⚠ 年份请核实。Next sentence.'), 'One. Next sentence.')
        self.assertEqual(clean('x', '爨, 北京欢迎你.'), '爨, 北京欢迎你.')
        for text in ['One ⚠ 未闭合 Next sentence.', 'One ⚠ 中文 Next English。Rest.', 'One ⚠ 请核实, rest.']:
            with self.assertRaises(ValueError):
                clean('x', text)

    def test_duplicate_headers_fail(self):
        text = '### 1. a — A — landmark: "a"\nBody.\n### 2. a — A — landmark: "a"\nBody.'
        with self.assertRaises(ValueError):
            self.build.parse_markdown(text)

    def test_missing_coordinates_and_id_mismatch_fail(self):
        drafts = self.build.parse_drafts(sorted((ROOT / 'content-src').glob('narrations-draft*.md')))
        meta = json.loads((ROOT / 'content/spot-meta.json').read_text())
        titles = json.loads((ROOT / 'content/wikipedia-titles.json').read_text())
        meta['tiananmen-square']['lat'] = None
        with self.assertRaisesRegex(ValueError, 'tiananmen-square'):
            self.build.merge_data(drafts, meta, titles)
        with self.assertRaises(ValueError):
            self.build.merge_data(drafts, meta, titles[:-1])


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / 'scripts/validate_content.py').exists(), 'validator missing')
        self.validator = load('validate_content')

    def test_radius_distinguishes_airports(self):
        valid = self.validator.valid_radius
        self.assertTrue(valid('capital-airport-welcome', 3000))
        self.assertTrue(valid('daxing-airport-welcome', 2000))
        self.assertFalse(valid('temple-of-heaven', 1500))
        self.assertFalse(valid('capital-airport-welcome', 1500))
        self.assertFalse(valid('temple-of-heaven', True))

    def test_real_data_exposes_fence_conflicts_and_pending_assets(self):
        data, _ = load('build_spots_json').build_data(ROOT)
        errors, pending = self.validator.validate(data, ROOT / 'content')
        # The four historical fence conflicts were resolved (2026-11-22, user-approved
        # radii/center fix); none of these ids may regress to a fence error.
        for sid in ['tiananmen-square', 'drum-bell-towers', 'olympic-green', 'lugou-bridge']:
            self.assertFalse(any(sid in e and 'fence' in e for e in errors))
        self.assertTrue(any('image' in p for p in pending))
        # Audio pipeline is complete: every spot must have main + 8 direction assets,
        # so nothing pending may reference audio anymore.
        self.assertFalse(any('audio/' in p for p in pending))
        broken = copy.deepcopy(data)
        broken['spots'][0]['radiusMeters'] = 1500
        errors, _ = self.validator.validate(broken, ROOT / 'content', check_assets=False)
        self.assertTrue(any('tiananmen-square' in e and 'radius' in e for e in errors))


if __name__ == '__main__':
    unittest.main()
