# switch-ocr

Detect and read **all text** on photos of network switches — including tiny port
numbers, blurry model labels and low-contrast silkscreen — and identify the
device's **make and model** (e.g. `D-Link DGS-1100-16`, `Cisco WS-C2960X-24TS-L`,
`Netgear GS724T`).

100% free and open source. Runs fully offline after the first model download.
CPU-only, no GPU required.

## How it works

```
photo ──► 3 preprocessing variants ──► OCR each ──► merge & dedup ──► identify device
          • original                   (PP-OCRv5)    (IoU-based,       • brand: exact +
          • denoise→CLAHE→sharpen                     keep best         fuzzy matching
          • smart upscale (tiny text)                 reading)          • model: per-vendor
                                                                          regex + OCR-error
                                                                          correction
```

Why multiple passes? A reading that fails on the raw photo is often recovered
on the contrast-enhanced or upscaled copy. That's the main defence against
blur, noise, glare and very small text. Overlapping results are merged, keeping
the highest-confidence reading of each region.

**The code is standard and never changes per device.** Vendor knowledge lives
in a data file (`switch_ocr/vendors.json`, ~40 vendors out of the box: Cisco,
D-Link, Netgear, TP-Link, HPE, Aruba, Juniper, Ubiquiti, MikroTik, Zyxel,
Huawei, Dell, Ruckus, ...) and is extendable at runtime. For vendors NOT in
the file at all, a universal fallback still works: the brand is inferred from
the most prominent alphabetic string on the faceplate (logos are big) and the
model from generic model-number shapes — so *any vendor, any model* produces
a result. The identifier also tolerates OCR errors (`D-Lirk`, `DGS-11OO-16`,
`TL-5G2428P`), re-joins model numbers OCR split into fragments, and can infer
the brand from the model number alone when the logo is unreadable.

## Install

```bash
pip install -r requirements.txt        # PaddleOCR backend (recommended)
pip install -e .                       # the switch-ocr package + CLI
```

Or with extras syntax: `pip install ".[paddle]"`

Three interchangeable OCR backends are supported (auto-detected in this order):

| Backend | Install | Notes |
|---|---|---|
| **PaddleOCR** (PP-OCRv5) | `pip install paddleocr paddlepaddle` | **Recommended.** Best free accuracy on small/blurred scene text, good CPU speed |
| RapidOCR | `pip install rapidocr onnxruntime` | Same model family on ONNX Runtime, lighter footprint |
| Tesseract | `pip install pytesseract` + `apt install tesseract-ocr` | Universal fallback, weakest on tiny/blurry text |

Models download automatically on first run (to `~/.paddlex` / `~/.cache`) and
are cached forever after — everything then runs offline.

## Use — CLI

```bash
switch-ocr rack_photo.jpg                        # one photo
switch-ocr photos/ -o results --csv --recursive  # a whole folder
switch-ocr photos/ --workers 4                   # 4 images in parallel (4x faster folders)
switch-ocr photo.jpg --accurate                  # hardest images (server models)
switch-ocr photo.jpg --fast --no-zoom --no-rotate  # fastest single pass
switch-ocr photo.jpg --budget 10                 # cap escalation time per image (s)
switch-ocr photos/ --min-device-conf 0.6         # "only truth": suppress weak guesses
switch-ocr photo.jpg --min-conf 0.25             # catch fainter text
switch-ocr photo.jpg --print-text                # dump every string found
```

### Escalating pipeline (budget-controlled)

Every image gets the 3-variant baseline pass. If the device is still
unresolved, escalation kicks in — bounded by `--budget` seconds per image:

1. **ZOOM** — magnify + enhance the neighbourhoods of detected text (model
   numbers live next to logos), each crop also tried Otsu-binarized with
   automatic polarity (rescues white-on-dark chassis labels).
2. **ROTATE** — the enhanced image retried at -8°, -4°, +4°, +8° for tilted
   rack shots.

Images that resolve in the baseline never pay for escalation.

Output per image:

```
rack_photo.jpg: D-Link DGS-1100-16  (confidence 0.87)
```

plus, in the output directory:

- `<name>.json` — device ID + every text region with confidence and coordinates
- `<name>_annotated.jpg` — the photo with boxes drawn on it
- `results.csv` — combined spreadsheet (with `--csv`)

Exit code is `0` on success, `1` if any image failed, `2` on usage errors.

## Use — Python

```python
from switch_ocr import SwitchTextReader, OCRConfig

reader = SwitchTextReader()            # defaults tuned for switches
result = reader.read("rack_photo.jpg")

print(result.device.display_name)     # "D-Link DGS-1100-16"
print(result.device.confidence)       # 0.87
print(result.device.evidence)         # the strings that support the ID

for det in result.detections:          # every piece of text found
    print(det.text, det.confidence, det.box)

# presets / tuning
reader = SwitchTextReader(OCRConfig.accurate())   # server models, max recall
reader = SwitchTextReader(OCRConfig.fast())       # single pass
cfg = OCRConfig(min_confidence=0.25, upscale_target=2600, engine="paddle")
```

`reader.read()` never raises on a bad image — check `result.ok` / `result.error`.
`reader.read_batch(paths)` processes many; one failure never aborts the batch.
The reader is thread-safe; call `reader.warmup()` at service start to
pre-load models.

### JSON shape

```json
{
  "source": "rack_photo.jpg",
  "device": {
    "brand": "D-Link",
    "model": "DGS-1100-16",
    "display_name": "D-Link DGS-1100-16",
    "confidence": 0.87,
    "evidence": [{"text": "D-Link", "ocr_confidence": 0.91, "role": "brand"},
                 {"text": "DGS-1100-16", "ocr_confidence": 0.84, "role": "model"}],
    "alternates": []
  },
  "detections": [
    {"text": "D-Link", "confidence": 0.91, "box": [98, 41, 187, 63],
     "polygon": [[98, 41], [187, 41], [187, 63], [98, 63]], "variant": "upscaled"}
  ]
}
```

## Docker

```bash
docker build -t switch-ocr .
docker run --rm -v "$PWD/photos:/data" switch-ocr /data -o /data/out --csv
```

Models are baked into the image at build time, so containers run with the
network fully disabled.

## Getting the best results on hard photos

`--accurate` switches to the server-grade detector (biggest single win).
Lower `--min-conf` (e.g. 0.25) to keep fainter readings. Shoot as close and
as straight-on as possible; the pipeline upscales up to 4x, but pixels that
were never captured can't be invented. For faceplates photographed at a steep
angle, crop to the device before OCR.

## Extending vendor coverage (no code changes)

Unknown vendors already work via the universal fallback, at reduced
confidence. To make a vendor first-class, add it to a JSON file — the code
stays untouched:

```json
{ "vendors": { "Sodola": {
    "aliases": ["sodola"],
    "patterns": ["\\bSL-[A-Z0-9]+\\b"]
} } }
```

Use it with `switch-ocr photos/ --vendors my_vendors.json`, or
`OCRConfig(extra_vendors="my_vendors.json")` in Python, or merge it into the
built-in `switch_ocr/vendors.json` permanently.

## Tests

```bash
python -m unittest discover tests            # unit tests (no OCR engine needed)
python tests/make_test_images.py             # generate synthetic hard photos
switch-ocr tests/data -o /tmp/out --csv      # end-to-end
```

## License

MIT. The OCR backends have their own permissive licenses (PaddleOCR: Apache-2.0,
RapidOCR: Apache-2.0, Tesseract: Apache-2.0). All free for commercial use.
