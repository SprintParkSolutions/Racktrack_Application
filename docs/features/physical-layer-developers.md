# Physical layer report (developers)

`pipeline/physical_layer.py` builds one report per scanned rack from what the
scan already produced, in the order the rack ladder asks for it: rack label or
id, device labels, ports, cables, OCR metadata. It invents nothing. Added 11
September 2026.

## Run it

```bash
python3 -m pipeline.physical_layer RK-F219EA47          # writes outputs/RK-F219EA47/physical_layer.json
python3 -m pipeline.physical_layer RK-F219EA47 --json   # prints instead
```

Server: `GET /api/scan/:rackId/physical-layer` returns the cached file, or
builds it when there is none; `?refresh=1` rebuilds. Sixty-second timeout.

## Inputs, all under `outputs/<rackId>/`

| File | Gives |
|---|---|
| `device_unit_map.json` | boxes, units, every socket with its status and cable colour |
| `labels-front.json` | text read anywhere on the front, with positions |
| `side_labels.json` | identifier chips on the rails, when that pass has run |
| `ocr_devices.json` | make, model, firmware, raw text and confidences per box |
| `device_overrides.json` | a person's make/model override per U, which wins |
| `scan_meta.json` | the space the scan was bound to, when the upload sent one |
| `cmdb_racks/*.json`, `server/data/netbox/rack-names.json` | a rack name from the record |

## What comes out

Top level: `schema`, `rack_id`, `image`, `generated_at`, `units_count`,
`devices_count`, then:

- `rack`: `id`, `label {text, conf, source}`, `candidates[]`, `name`, `space`,
  `unit_source`, `units_detected`. Sources, strongest first: `record`, `rail
  chip`, `front label`, `inferred from device labels` (a rack segment such as
  R1 shared by every device label), else `minted` with `text: null`.
- `labels`: every front and rail reading as read, the learned label
  `pattern`, and which sources existed.
- `units[]`: `{unit: "u09" | "u07,u08", devices: [...]}` sorted bottom-up. A
  device carries `device_type`, `confidence`, `label {text, raw, conf, source,
  stack_member}`, `ocr {make, model, firmware, raw_text, ocr_conf, match_conf,
  source}`, and either `ports[]` (`port_number`, `port_type`, `status`
  connected / empty / unknown, `cable {connector, color, confidence}` when
  connected) or, for a PDU, `outlets[]`.
- `cables[]`: every connected socket with a colour, flattened.
- `counts`: sockets by status and cables by colour.

## Label reading

The same rule as `normalizeOcrLabelText` in `server/app.js`: repair O/0 and
I/1 next to digits, then require prefix, separator, letters, digits. Two
additions:

1. **Every reading of a box is tried**, best confidence first, and the first
   one that parses wins; a box whose sticker did not parse falls back to the
   identifier inside its own OCR text.
2. **Shape-guided repair.** Every reading that parses teaches the label's
   shape per segment (letters, digits). OCR only turns digits into letters,
   never the reverse, so per segment the true shape is the fewest letters and
   the most digits any reading showed. Mangled readings are then rebuilt to
   that shape: `SP-RI-UIS-SWO2.` becomes `SP-R1-U15-SW02`. The last segment
   must end with the pattern's number of digits or the reading is refused
   (`SP-RI-UI3-SWO [` stays unread). `USB` and `UPS` are never repaired.

Measured on the office rack (11 Sep 2026): RK-F219EA47 reads all three
switch labels correctly and infers rack R1; RK-1C6AFC30 keeps `RI` because no
reading in that scan shows the digit. The fix for that is memory across scans
or the site's naming convention from setup, both later.

## Not in this slice

No serial, asset tag, LED state or face from the photo; no side-label pass is
triggered here (it is a separate POST); no comparison with the switch or the
record. Ports are numbered by detection order within each socket class, not
by the print on the panel.
