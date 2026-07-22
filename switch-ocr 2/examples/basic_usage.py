"""Minimal integration example: identify every switch in a folder of photos
and print a small inventory table."""
from pathlib import Path

from switch_ocr import OCRConfig, SwitchTextReader

PHOTOS = Path("photos")  # put your rack photos here

reader = SwitchTextReader(OCRConfig())  # or OCRConfig.accurate()
reader.warmup()

rows = []
for photo in sorted(PHOTOS.glob("*.jpg")):
    result = reader.read(photo)
    if not result.ok:
        print(f"{photo.name}: ERROR {result.error}")
        continue
    dev = result.device
    rows.append((photo.name, dev.brand or "?", dev.model or "?",
                 f"{dev.confidence:.2f}", len(result.detections)))

print(f"\n{'photo':30} {'brand':12} {'model':20} {'conf':5} texts")
for r in rows:
    print(f"{r[0]:30} {r[1]:12} {r[2]:20} {r[3]:5} {r[4]}")
