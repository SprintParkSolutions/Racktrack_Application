# Deploy notes

The auto-pull watcher on the production box restarts the Node server (and with
it the Python worker pool, which preloads the YOLO models from `config.json`)
only when a pushed commit touches `server/`. Editing this file is the sanctioned
way to force that restart when a deploy only changes files outside `server/`
(for example `config.json` model swaps).

## Log

- 2026-07-31: rolled `models.devices_seg` back to `Models/devices_seg.pt` —
  scans failed in production with `master_best.pt` while the same file loads
  and infers correctly on the build Mac (ultralytics 8.4.48). Suspect the
  production venv is too old to deserialize the newer checkpoint, or the copy
  on the box differs. Re-apply the swap only after the box's env/model is
  verified.
- 2026-07-31 (later): re-applied `master_best.pt`. The checkpoint was proven
  good under the production stack's exact ultralytics (8.4.53) on the build
  Mac, and this deploy is verified end-to-end with a live probe scan
  immediately after the restart; if that scan fails the swap gets rolled back
  again and the failure belongs to the box's local file/GPU, not the model.
- 2026-07-31 (verdict): the probe scan failed INSTANTLY (0s, baseline with the
  old model passed in 7s just before) — the box cannot load
  `D:\RACKTRACK\dark_mobile\Models\master_best.pt` at all: missing, misnamed
  (hidden double extension), or a corrupt copy. Rolled back again. The good
  file is 218,557,304 bytes, sha256
  600c86ff1bea678bc44672f319e0688fa1a8010a6fe08763e75851c7f3a8a1da. Fix the
  copy on the box, then re-apply the one-line swap in config.json.
