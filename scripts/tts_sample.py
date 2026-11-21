"""试听样本 TTS 生成脚本（临时，正式管线见 tts_generate.py 设计）。

从 content/samples.json 读取样本，用 edge-tts（免费无 key）生成 MP3 到
content/audio/samples/。正式生产将按 spec 使用 OpenAI TTS（供应商可切换）。

用法：
    .venv/bin/python scripts/tts_sample.py
"""

import asyncio
import json
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_FILE = ROOT / "content-src" / "samples.json"
OUT_DIR = ROOT / "content-src" / "audio-samples"


async def synth(item_id: str, text: str, voice: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(out_path))
    print(f"OK  {item_id} -> {out_path.name} ({out_path.stat().st_size // 1024} KB)")


async def main() -> int:
    data = json.loads(SAMPLES_FILE.read_text(encoding="utf-8"))
    voice = data["voice"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for sample in data["samples"]:
        out_path = OUT_DIR / f"{sample['id']}.mp3"
        await synth(sample["id"], sample["text"], voice, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
