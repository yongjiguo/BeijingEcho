#!/usr/bin/env python3.11
"""Build review-pending development data without modifying source drafts."""
import argparse
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = re.compile(r'^### \d+\. ([a-z0-9-]+) — (.+?)(?: — landmark: "([^"]+)")?$', re.M)
# Exact source spans for inline notes and notes containing English. Never infer
# an English boundary from capitalization, commas, dashes, or sentence length.
EXACT_NOTES = {
    'mutianyu-great-wall': ['⚠ 编号请核实'],
    'ming-tombs': ['⚠ Dingling 开放状态请核实（近年或有调整）。'],
    'olympic-green': ['⚠ Ai Weiwei 参与角色为"艺术顾问"，后与其产生分歧；表述请核实。'],
    'fragrant-hills': ['⚠ 红叶最佳期（10月中-11月上旬）与黄栌smoke tree表述请核实。'],
    'beijing-zoo': ['⚠ 开放年份表述请核实（1908年正式开放为常见说法）'],
    'dongjiaominxiang': ['⚠ 具体建筑功能与编号请核实'],
    'taimiao': ['⚠ 年份表述请核实（1924/1950年改名两说，请核实）'],
    'zhongshan-park': ['⚠ 牡丹花期4月下旬表述请核实'],
    'baiyun-guan': ['⚠ 丘处机1220-1223年西行与成吉思汗赐居白云观表述请核实'],
    'tanzhe-temple': ['⚠ 建于西晋"1700余年"为景区通行说法，学术上有争议，请核实表述口径', '⚠ 帝王树树龄约千年为通行说法，请核实'],
    'jietai-temple': ['⚠ "三大戒坛"通行说法请核实，其余两处（泉州开元寺等）表述请核实'],
    'dajue-temple': ['⚠ 辽咸雍四年1068年建为通行说法，请核实'],
    'biyun-temple': ['⚠ 始建于元代（元至顺二年1331年为通行说法）请核实'],
    'wofu-temple': ['⚠ 1321年至治元年铸造为通行说法，请核实，重量数据（约54吨）请核实，各来源出入大，建议模糊处理', '⚠ 唐代始建（贞观年间说与开元说并存）请核实口径'],
    'yunju-temple': ['⚠ 静琬刻经始于隋末（约605年前后）为通行说法，请核实', '⚠ 舍利出土与展出状态请核实（1981年发现佛舍利为通行说法）'],
    'lugou-bridge': ['⚠ 1192年建成通行说法，请核实'],
    'zhoukoudian': ['⚠ 化石1941年丢失为定论，表述可保留'],
    'cuandixia': ['⚠ 距市区约90公里通行说法，请核实'],
    'yuandadu-park': ['⚠ 1267年始建大都与北城墙遗存为定论，表述可保留'],
    'huguang-guild-hall': ['⚠ 1807年嘉庆年间创建为通行说法，请核实'],
}
AUDIBLE_CHINESE = ('北京欢迎你', '不到长城非好汉', '爨')


def assert_clean(sid, text):
    remaining = text
    for phrase in AUDIBLE_CHINESE:
        remaining = remaining.replace(phrase, '')
    if re.search(r'[\u3400-\u9fff⚠⚡]', remaining):
        raise ValueError(f'{sid}: unresolved editorial text')
    if not text.strip():
        raise ValueError(f'{sid}: empty transcript')


def clean_transcript(sid, text):
    for note in EXACT_NOTES.get(sid, []):
        if note not in text:
            continue
        end = text.index(note) + len(note)
        if not note.endswith('。') and end < len(text) and text[end] not in ' ,.—':
            raise ValueError(f'{sid}: changed exact note boundary')
        text = text.replace(note, ' ')
    while re.search('[⚠⚡]', text):
        start = re.search('[⚠⚡]', text).start()
        end = text.find('。', start)
        if end < 0:
            raise ValueError(f'{sid}: unterminated note; add an exact source span')
        note = text[start:end + 1]
        if re.search('[A-Za-z]', note) or not re.search('[\u3400-\u9fff]', note):
            raise ValueError(f'{sid}: ambiguous note containing English; add an exact source span')
        text = text[:start] + ' ' + text[end + 1:]
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r' +([,.;!?])', r'\1', text)
    assert_clean(sid, text)
    return text


def parse_markdown(text):
    result = {}
    matches = list(HEADER.finditer(text))
    for i, match in enumerate(matches):
        sid, name, landmark = match.groups()
        if sid in result:
            raise ValueError(f'duplicate id: {sid}')
        section = text[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        lines = []
        for line in section.splitlines():
            if line.startswith(('>', '#', '---')):
                break
            if line.strip():
                lines.append(line.strip())
        if sid != 'app-welcome' and not landmark:
            raise ValueError(f'{sid}: missing landmark name')
        result[sid] = {'name': name, 'landmark': landmark, 'transcript': clean_transcript(sid, ' '.join(lines))}
    return result


def parse_drafts(paths):
    result = {}
    for path in paths:
        parsed = parse_markdown(path.read_text(encoding='utf-8'))
        if result.keys() & parsed.keys():
            raise ValueError('duplicate ids across drafts')
        result.update(parsed)
    return result


def valid_coords(value):
    return isinstance(value, dict) and all(type(value.get(k)) in (int, float) and math.isfinite(value[k]) for k in ('lat', 'lng'))


def merge_data(drafts, meta, titles, images_by_id=None):
    ids = set(drafts) - {'app-welcome'}
    if len(ids) != 60 or 'app-welcome' not in drafts or ids != set(meta) or ids != {r['id'] for r in titles} or len(titles) != 60:
        raise ValueError('expected matching 60 spot ids plus app-welcome')
    missing = [sid for sid in ids if not valid_coords(meta[sid])]
    if missing:
        raise ValueError('missing/invalid coordinates: ' + ', '.join(sorted(missing)))
    radii = {r['id']: r['radiusMeters'] for r in titles}
    warnings, spots = [], []
    for sid, draft in drafts.items():
        if sid == 'app-welcome':
            continue
        entry = meta[sid]
        landmark = entry.get('landmark')
        if landmark is None:
            landmark = entry
            warnings.append(f'{sid}: landmark uses spot-center fallback, NOT verified landmark coordinates')
        elif not valid_coords(landmark):
            raise ValueError(f'{sid}: invalid landmark coordinates')
        spots.append({'id': sid, 'name': draft['name'], 'summary': ' '.join(draft['transcript'].split()[:12]) + '…',
                      'lat': entry['lat'], 'lng': entry['lng'], 'radiusMeters': radii[sid],
                      'audio': f'audio/spot-{sid}.mp3', 'transcript': draft['transcript'],
                      'images': (images_by_id or {}).get(sid, []),
                      'landmark': {'name': draft['landmark'], 'lat': landmark['lat'], 'lng': landmark['lng']}})
    return {'version': 1, 'reviewStatus': 'pending-review-development-only',
            'welcome': {'audio': 'audio/welcome.mp3', 'transcript': drafts['app-welcome']['transcript']}, 'spots': spots}, warnings


def build_data(root=ROOT):
    drafts = parse_drafts([root / 'content-src/narrations-draft.md', root / 'content-src/narrations-draft-2.md'])
    images_by_id = {}
    spots_path = root / 'content/spots.json'
    if spots_path.is_file():
        try:
            prev = json.loads(spots_path.read_text())
            images_by_id = {s['id']: s['images'] for s in prev.get('spots', []) if s.get('images')}
        except (ValueError, KeyError):
            pass  # unreadable previous file: rebuild without images (fetch_images can repopulate)
    return merge_data(drafts, json.loads((root / 'content/spot-meta.json').read_text()),
                      json.loads((root / 'content/wikipedia-titles.json').read_text()), images_by_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-unreviewed', action='store_true', help='explicit development-only authorization; not publication approval')
    args = parser.parse_args()
    if not args.allow_unreviewed:
        parser.error('drafts remain unreviewed; development builds require --allow-unreviewed')
    data, warnings = build_data()
    (ROOT / 'content/spots.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('DEVELOPMENT ONLY: 60 spots + 1 welcome; review pending; images deferred')
    print('\n'.join(warnings))


if __name__ == '__main__':
    main()
