"""Web UI for switch-ocr.

Upload one or more images (or a whole folder) and get, per image:
the image preview, the extracted text, and the identified make + model.

Run:
    pip install flask
    python3 app.py
    # then open http://127.0.0.1:5000
"""
from __future__ import annotations

import os

# Must be set before setuptools/paddle are imported: on this environment,
# setuptools' vendored-distutils override crashes with
# `AssertionError: ...\lib\distutils\core.py` because it can't confirm its
# local copy of distutils loaded. Forcing stdlib distutils skips that check.
os.environ.setdefault("SETUPTOOLS_USE_DISTUTILS", "stdlib")

import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

import numpy as np
import cv2

from flask import Flask, jsonify, render_template_string, request

from switch_ocr import SwitchTextReader, OCRConfig

app = Flask(__name__)

# A pool of separate OS PROCESSES (not threads) running the OCR engine.
# An earlier version of this pool used threads sharing one Python
# process, which looked reasonable but did NOT give real parallelism:
# PaddleOCR's inference holds Python's GIL for most of its work, so N
# reader instances on N threads still executed essentially one at a time
# — verified directly (12 "concurrent" uploads finished in a slow
# trickle, matching single-instance speed, not the near-simultaneous
# completion real parallelism produces). Separate PROCESSES each have
# their own interpreter and GIL, so they genuinely run at once — this is
# the exact mechanism already verified to work for the --workers CLI
# flag (10min -> 6min6s on a real 104-image batch), just applied here to
# the web app instead of the command line.
# Validated empirically: on a 20-core machine, ~12 concurrent workers
# gave the best real throughput for the full pipeline -- fewer left
# cores idle, going all the way to 20 gave no further benefit (each
# worker's own per-image work is still CPU-heavy). Scales with whatever
# this machine actually has instead of hardcoding 12.
_POOL_SIZE = max(1, min(os.cpu_count() or 4, round((os.cpu_count() or 4) * 0.6)))
#: How many uploads the BROWSER sends at once, in total across both ports
#: (see _SECOND_PORT below). An earlier version of this constant was
#: measured at 9 using a raw-script test that opens real parallel
#: sockets -- but real browsers (Chrome/Edge/Firefox) hard-cap HTTP/1.1
#: connections to a SINGLE origin at 6, no matter what number the page
#: asks for. So a page telling the browser to run 9 concurrent uploads
#: was silently throttled to 6 in practice, which is slower than the
#: measurement this constant was based on ever accounted for -- verified
#: directly: a real 6-connection-capped test on the real 101-image folder
#: came in slower than the (unrealistic) 9-raw-socket test.
#: Also capped at 10 total, not the full pool size (12): --workers
#: testing on the CLI found 11 concurrent OCR processes genuinely crash
#: on this hardware (10 is the verified-safe ceiling) -- pushing browser
#: concurrency past that risks the same crashes here.
_CLIENT_CONCURRENCY = min(10, _POOL_SIZE)
#: Serving on a second port makes it a second origin as far as the
#: browser's connection-limit rules are concerned, giving a second,
#: independent 6-connection budget -- so splitting _CLIENT_CONCURRENCY
#: across two ports (5 and 5) is actually achievable in a real browser,
#: unlike asking for 9-10 on one port ever was.
_SECOND_PORT = 5001

_executor: ProcessPoolExecutor | None = None
_executor_lock = threading.Lock()
#: Set once per WORKER PROCESS by _worker_init — never touched by the
#: main Flask process, which never runs OCR itself.
_worker_reader: SwitchTextReader | None = None


def _worker_init(cpu_threads: int) -> None:
    global _worker_reader
    _worker_reader = SwitchTextReader(OCRConfig(cpu_threads=cpu_threads))
    _worker_reader.warmup()


def _worker_ocr(img: np.ndarray) -> dict:
    """Runs inside a worker process. img/return value must both be
    picklable (a BGR ndarray and a plain dict both are) since they cross
    a real process boundary, unlike the old in-process thread version."""
    result = _worker_reader.read(img)
    payload = result.to_dict()
    payload["text"] = result.full_text
    return payload


def _noop(_ignored=None) -> None:
    return None


def get_executor() -> ProcessPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            cpu_threads = max(1, (os.cpu_count() or 4) // _POOL_SIZE)
            _executor = ProcessPoolExecutor(
                max_workers=_POOL_SIZE, initializer=_worker_init, initargs=(cpu_threads,)
            )
            # ProcessPoolExecutor spawns workers LAZILY by default -- force
            # all _POOL_SIZE of them to start and finish loading their
            # model right now, so the first real uploads aren't the ones
            # paying that cost.
            list(_executor.map(_noop, range(_POOL_SIZE)))
    return _executor


def _reset_executor() -> None:
    # If any one of the long-lived worker processes dies unexpectedly
    # (native crash in OpenCV/Paddle, OOM-kill, etc.) the WHOLE pool is
    # poisoned -- every subsequent submit().result() raises
    # BrokenProcessPool forever, which is exactly what turned into the
    # "make/model/text just doesn't show up" HTTP 500s: one bad image
    # anywhere in a run could silently kill every image after it until
    # the server was restarted. Tear down and let the next request
    # rebuild a fresh pool instead of staying broken.
    global _executor
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None


PAGE = r"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>switch-ocr · make &amp; model reader</title>
<style>
  :root{
    /* dark (default) */
    --bg:#0a0c10; --bg-2:#0e1117; --surface:#141922; --surface-2:#1a2029;
    --border:#232a35; --border-soft:#1a2028; --hair:#212833;
    --text:#eef1f6; --muted:#9aa4b2; --faint:#697180;
    --brand:#4f7cff; --brand-2:#6b93ff; --brand-soft:rgba(79,124,255,.14);
    --good:#34d399; --good-soft:rgba(52,211,153,.14);
    --warn:#f5b849; --warn-soft:rgba(245,184,73,.14);
    --bad:#f16d6d;  --bad-soft:rgba(241,109,109,.14);
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.28);
    --shadow-sm:0 1px 2px rgba(0,0,0,.25);
    --radius:16px; --radius-sm:11px;
  }
  :root[data-theme="light"]{
    --bg:#f6f8fc; --bg-2:#eef2f8; --surface:#ffffff; --surface-2:#f7f9fd;
    --border:#e3e8f0; --border-soft:#edf1f7; --hair:#eaeef4;
    --text:#0f1621; --muted:#5a6472; --faint:#98a1b0;
    --brand:#3d63f5; --brand-2:#3358ee; --brand-soft:rgba(61,99,245,.09);
    --good:#12a074; --good-soft:rgba(18,160,116,.10);
    --warn:#c98a1a; --warn-soft:rgba(201,138,26,.12);
    --bad:#dc5a5a;  --bad-soft:rgba(220,90,90,.10);
    --shadow:0 1px 2px rgba(20,30,55,.05),0 10px 30px rgba(20,30,55,.07);
    --shadow-sm:0 1px 2px rgba(20,30,55,.06);
  }
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){
      --bg:#f6f8fc; --bg-2:#eef2f8; --surface:#ffffff; --surface-2:#f7f9fd;
      --border:#e3e8f0; --border-soft:#edf1f7; --hair:#eaeef4;
      --text:#0f1621; --muted:#5a6472; --faint:#98a1b0;
      --brand:#3d63f5; --brand-2:#3358ee; --brand-soft:rgba(61,99,245,.09);
      --good:#12a074; --good-soft:rgba(18,160,116,.10);
      --warn:#c98a1a; --warn-soft:rgba(201,138,26,.12);
      --bad:#dc5a5a;  --bad-soft:rgba(220,90,90,.10);
      --shadow:0 1px 2px rgba(20,30,55,.05),0 10px 30px rgba(20,30,55,.07);
      --shadow-sm:0 1px 2px rgba(20,30,55,.06);
    }
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Inter",sans-serif;
    background:var(--bg); color:var(--text); line-height:1.5;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  ::selection{background:var(--brand-soft)}

  /* ---------- App bar ---------- */
  .appbar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 82%,transparent);
    backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--hair)}
  .appbar .in{max-width:1160px;margin:0 auto;padding:.7rem 1.25rem;display:flex;align-items:center;gap:.7rem}
  .mark{width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;
    background:linear-gradient(140deg,var(--brand),#8b5cf6);color:#fff;box-shadow:var(--shadow-sm)}
  .mark svg{width:18px;height:18px}
  .brandname{font-weight:700;letter-spacing:-.02em;font-size:1.02rem}
  .brandname .dim{color:var(--faint);font-weight:500}
  .grow{flex:1}
  .iconbtn{width:34px;height:34px;border-radius:9px;border:1px solid var(--border);
    background:var(--surface);color:var(--muted);cursor:pointer;display:grid;place-items:center;transition:.15s}
  .iconbtn:hover{color:var(--text);border-color:var(--brand)}
  .pill-live{font-size:.72rem;color:var(--muted);display:inline-flex;align-items:center;gap:.4rem;
    padding:.28rem .6rem;border:1px solid var(--hair);border-radius:99px;background:var(--surface)}
  .pill-live .d{width:7px;height:7px;border-radius:50%;background:var(--good);
    box-shadow:0 0 0 0 var(--good-soft);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 var(--good-soft)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}

  .wrap{max-width:1160px;margin:0 auto;padding:1.6rem 1.25rem 4rem}
  h1.title{font-size:1.6rem;letter-spacing:-.025em;margin:.2rem 0 .3rem}
  p.lede{color:var(--muted);margin:0 0 1.4rem;font-size:.97rem;max-width:60ch}

  /* ---------- Dropzone ---------- */
  .drop{position:relative;border:1.5px dashed var(--border);border-radius:var(--radius);
    padding:2.4rem 1.5rem;text-align:center;cursor:pointer;background:
    radial-gradient(120% 140% at 50% -10%,var(--brand-soft),transparent 60%),var(--surface);
    transition:.18s;box-shadow:var(--shadow-sm)}
  .drop:hover,.drop.over{border-color:var(--brand);transform:translateY(-1px)}
  .drop .ic{width:46px;height:46px;border-radius:12px;margin:0 auto .8rem;display:grid;place-items:center;
    background:var(--brand-soft);color:var(--brand)}
  .drop .big{font-size:1.06rem;font-weight:650;letter-spacing:-.01em}
  .drop .hint{color:var(--faint);font-size:.83rem;margin-top:.35rem}
  .drop input{display:none}
  .rowbtns{display:flex;gap:.55rem;justify-content:center;margin-top:1.05rem;flex-wrap:wrap}
  .btn{border:1px solid transparent;padding:.52rem .95rem;border-radius:10px;font-size:.86rem;
    font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:.45rem;transition:.15s}
  .btn.primary{background:var(--brand);color:#fff}
  .btn.primary:hover{background:var(--brand-2)}
  .btn.soft{background:var(--surface-2);color:var(--text);border-color:var(--border)}
  .btn.soft:hover{border-color:var(--brand);color:var(--brand)}
  .btn.link{background:none;color:var(--muted)}
  .btn.link:hover{color:var(--text)}
  .btn svg{width:15px;height:15px}

  /* ---------- KPI row ---------- */
  .kpis{display:none;grid-template-columns:repeat(4,1fr);gap:.8rem;margin:1.5rem 0}
  .kpis.show{display:grid}
  .kpi{background:var(--surface);border:1px solid var(--border-soft);border-radius:var(--radius-sm);
    padding:.95rem 1.05rem;box-shadow:var(--shadow-sm)}
  .kpi .k{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);
    display:flex;align-items:center;gap:.4rem}
  .kpi .v{font-size:1.7rem;font-weight:750;letter-spacing:-.03em;margin-top:.2rem;font-variant-numeric:tabular-nums}
  .kpi .v small{font-size:.9rem;color:var(--faint);font-weight:600}

  /* ---------- Controls ---------- */
  .controls{display:none;align-items:center;gap:.6rem;margin:0 0 1rem;flex-wrap:wrap}
  .controls.show{display:flex}
  .search{flex:1;min-width:210px;position:relative}
  .search input{width:100%;padding:.58rem .85rem .58rem 2.2rem;border-radius:10px;font-size:.9rem;
    border:1px solid var(--border);background:var(--surface);color:var(--text);transition:.15s}
  .search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
  .search svg{position:absolute;left:.7rem;top:50%;transform:translateY(-50%);opacity:.5;width:15px;height:15px}
  .switch{display:inline-flex;align-items:center;gap:.5rem;font-size:.85rem;color:var(--muted);cursor:pointer;user-select:none}
  .switch input{position:absolute;opacity:0;width:0;height:0}
  .track{width:34px;height:20px;border-radius:99px;background:var(--border);position:relative;transition:.18s;flex:none}
  .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
    background:#fff;box-shadow:var(--shadow-sm);transition:.18s}
  .switch input:checked + .track{background:var(--brand)}
  .switch input:checked + .track::after{transform:translateX(14px)}

  /* ---------- Segmented tabs ---------- */
  .tabs{display:none;gap:.25rem;padding:.28rem;background:var(--surface-2);border:1px solid var(--border-soft);
    border-radius:12px;width:max-content;margin-bottom:1.3rem}
  .tabs.show{display:inline-flex}
  .tab{background:none;border:none;color:var(--muted);font-size:.88rem;font-weight:600;
    padding:.42rem .85rem;cursor:pointer;border-radius:9px;display:inline-flex;align-items:center;gap:.45rem;transition:.15s}
  .tab:hover{color:var(--text)}
  .tab.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
  .tabcount{background:var(--bg-2);color:var(--muted);font-size:.7rem;font-weight:700;
    padding:.05rem .42rem;border-radius:99px;font-variant-numeric:tabular-nums}
  .tab.active .tabcount{background:var(--brand-soft);color:var(--brand)}

  /* ---------- Progress ---------- */
  .progress{height:3px;background:var(--border-soft);border-radius:99px;overflow:hidden;margin:0 0 1.2rem;display:none}
  .progress.show{display:block}
  .progress .bar{height:100%;width:0;background:linear-gradient(90deg,var(--brand),#8b5cf6);transition:width .3s;border-radius:99px}

  /* ---------- Gallery cards ---------- */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1.1rem}
  .card{background:var(--surface);border:1px solid var(--border-soft);border-radius:var(--radius);
    overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:.16s;
    opacity:0;transform:translateY(6px);animation:in .32s forwards}
  @keyframes in{to{opacity:1;transform:none}}
  .card:hover{transform:translateY(-2px);border-color:var(--border)}
  .thumb{position:relative;height:168px;background:
    repeating-conic-gradient(from 0deg,#0000 0 25%,rgba(128,128,128,.05) 0 50%) 50%/20px 20px}
  .thumb img{width:100%;height:100%;object-fit:contain}
  .badge{position:absolute;top:.6rem;left:.6rem;padding:.22rem .55rem;border-radius:99px;font-size:.68rem;
    font-weight:700;letter-spacing:.02em;color:#fff;box-shadow:var(--shadow-sm)}
  .statusdot{position:absolute;top:.6rem;right:.6rem;width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 3px var(--surface)}
  .sd.both{background:var(--good)} .sd.one{background:var(--warn)} .sd.none{background:var(--bad)}
  .body{padding:.95rem 1.05rem 1.1rem;display:flex;flex-direction:column;gap:.1rem;flex:1}
  .fname{font-size:.74rem;color:var(--faint);word-break:break-all}
  .device{font-size:1.16rem;font-weight:700;letter-spacing:-.015em;line-height:1.28;margin-top:.15rem}
  .device.none{color:var(--faint);font-weight:600;font-style:italic}
  .mm{font-size:.82rem;color:var(--muted);margin-top:.12rem;display:flex;gap:.35rem;flex-wrap:wrap}
  .mm .pair{background:var(--surface-2);border:1px solid var(--border-soft);border-radius:7px;padding:.05rem .4rem}
  .mm .pair b{color:var(--text);font-weight:650}
  .meter{margin:.75rem 0 .1rem}
  .meter .top{display:flex;justify-content:space-between;font-size:.72rem;color:var(--faint);margin-bottom:.28rem}
  .meter .top b{color:var(--text);font-variant-numeric:tabular-nums}
  .meter .rail{height:6px;border-radius:99px;background:var(--border-soft);overflow:hidden}
  .meter .fill{height:100%;border-radius:99px;transition:width .4s}
  .txtwrap{margin-top:.8rem;border-top:1px solid var(--hair);padding-top:.65rem}
  .txthdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem}
  .txthdr .lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
  .copy{background:none;border:none;color:var(--muted);cursor:pointer;font-size:.72rem;
    display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .35rem;border-radius:6px}
  .copy:hover{color:var(--brand);background:var(--brand-soft)}
  pre.text{white-space:pre-wrap;word-break:break-word;margin:0;font-size:.82rem;color:var(--text);
    max-height:148px;overflow:auto;background:var(--surface-2);border:1px solid var(--border-soft);
    border-radius:9px;padding:.6rem .7rem}
  .foot{margin-top:.65rem;font-size:.7rem;color:var(--faint);display:flex;gap:.7rem}
  .spinner{width:22px;height:22px;border:2.5px solid var(--border);border-top-color:var(--brand);
    border-radius:50%;animation:spin .7s linear infinite;margin:.5rem auto .2rem}
  @keyframes spin{to{transform:rotate(360deg)}}
  .skel{color:var(--faint);font-size:.83rem;text-align:center}
  .err{color:var(--bad);font-size:.85rem}
  .empty{color:var(--faint);text-align:center;padding:2.5rem 1rem;display:none;border:1px dashed var(--border);
    border-radius:var(--radius);background:var(--surface)}

  /* ---------- Results view ---------- */
  .rsummary{display:grid;grid-template-columns:repeat(3,1fr);gap:.85rem;margin-bottom:1.5rem}
  .rstat{border:1px solid var(--border-soft);border-radius:var(--radius-sm);padding:1rem 1.1rem;
    background:var(--surface);box-shadow:var(--shadow-sm);position:relative;overflow:hidden}
  .rstat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px}
  .rstat.both::before{background:var(--good)} .rstat.both{background:linear-gradient(180deg,var(--good-soft),transparent 40%),var(--surface)}
  .rstat.one::before{background:var(--warn)}  .rstat.one{background:linear-gradient(180deg,var(--warn-soft),transparent 40%),var(--surface)}
  .rstat.none::before{background:var(--bad)}  .rstat.none{background:linear-gradient(180deg,var(--bad-soft),transparent 40%),var(--surface)}
  .rstat .v{font-size:2rem;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .rstat .k{font-size:.82rem;color:var(--muted);margin-top:.05rem;font-weight:600}
  .rstat .pct{position:absolute;top:1rem;right:1.1rem;font-size:.78rem;color:var(--faint);font-variant-numeric:tabular-nums}
  .rgroup{margin-bottom:1.7rem}
  .rgroup h3{font-size:.98rem;margin:0 0 .15rem;display:flex;align-items:center;gap:.55rem;letter-spacing:-.01em}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .dot.both{background:var(--good)} .dot.one{background:var(--warn)} .dot.none{background:var(--bad)}
  .rgroup .desc{color:var(--faint);font-size:.8rem;margin:0 0 .8rem}
  .rlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:.7rem}
  .ritem{display:flex;gap:.75rem;align-items:center;background:var(--surface);border:1px solid var(--border-soft);
    border-radius:var(--radius-sm);padding:.6rem .7rem;box-shadow:var(--shadow-sm);transition:.15s}
  .ritem:hover{border-color:var(--border)}
  .ritem img{width:54px;height:42px;object-fit:contain;border-radius:7px;flex:none;background:var(--surface-2)}
  .ritem .meta{min-width:0;flex:1}
  .ritem .dn{font-size:.9rem;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ritem .fn{font-size:.72rem;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ritem .tag{font-size:.65rem;padding:.1rem .42rem;border-radius:99px;color:#fff;white-space:nowrap;font-weight:700}
  .none-txt{color:var(--faint);font-size:.82rem;padding:.35rem 0}

  footer.foot-note{max-width:1160px;margin:2.5rem auto 0;padding:1.2rem 1.25rem 0;border-top:1px solid var(--hair);
    color:var(--faint);font-size:.78rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}

  @media (max-width:640px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .rsummary{grid-template-columns:1fr}
  }
</style>
</head>
<body>
  <div class="appbar">
    <div class="in">
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11v2M10 11v2M14 11v2M18 11v2"/></svg>
      </span>
      <span class="brandname">switch<span class="dim">-ocr</span></span>
      <span class="grow"></span>
      <span class="pill-live"><span class="d"></span>local · no API</span>
      <button class="iconbtn" id="themeBtn" title="Toggle theme" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>
      </button>
    </div>
  </div>

  <div class="wrap">
    <h1 class="title">Read make &amp; model from switch photos</h1>
    <p class="lede">Upload one image or a whole folder. Each photo is scanned for all visible text and
      identified by brand and model — running entirely on this machine.</p>

    <label class="drop" id="drop">
      <div class="ic">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4m0 0L8 8m4-4l4 4"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>
      </div>
      <div class="big">Drop images or a folder here</div>
      <div class="hint">PNG · JPG — or use the buttons below. A whole folder works too.</div>
      <input type="file" id="folder" multiple accept="image/*" webkitdirectory directory>
      <input type="file" id="files" multiple accept="image/*">
    </label>
    <div class="rowbtns">
      <button class="btn primary" id="pickFolder" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
        Choose folder</button>
      <button class="btn soft" id="pickFiles" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 5"/></svg>
        Choose files</button>
    </div>

    <div class="kpis" id="stats">
      <div class="kpi"><div class="k">Images</div><div class="v" id="s-total">0</div></div>
      <div class="kpi"><div class="k">Identified</div><div class="v" id="s-id">0</div></div>
      <div class="kpi"><div class="k">Avg confidence</div><div class="v" id="s-conf">–</div></div>
      <div class="kpi"><div class="k">Text regions</div><div class="v" id="s-reg">0</div></div>
    </div>

    <div class="controls" id="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4" stroke-linecap="round"/></svg>
        <input id="q" placeholder="Filter by name, brand or model…">
      </div>
      <label class="switch"><input type="checkbox" id="onlyId"><span class="track"></span>Identified only</label>
      <button class="btn soft" id="csv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
        Export CSV</button>
      <button class="btn link" id="clear">Clear</button>
    </div>

    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="gallery">Gallery</button>
      <button class="tab" data-tab="results">Results <span class="tabcount" id="tc-all">0</span></button>
    </div>

    <div class="progress" id="progress"><div class="bar" id="bar"></div></div>

    <div id="panel-gallery">
      <div class="grid" id="grid"></div>
      <div class="empty" id="empty">No images match your filter.</div>
    </div>

    <div id="panel-results" style="display:none">
      <div class="rsummary" id="rsummary"></div>
      <div id="rgroups"></div>
      <div class="empty" id="rempty">Upload images to see results here.</div>
    </div>
  </div>

  <footer class="foot-note">
    <span class="pill-live"><span class="d"></span>Runs offline</span>
    <span>Free &amp; open source · no photos leave this computer.</span>
  </footer>

<script>
const $=s=>document.querySelector(s);
const grid=$('#grid'), stats=$('#stats'), toolbar=$('#toolbar'), tabs=$('#tabs'),
      progress=$('#progress'), bar=$('#bar'), empty=$('#empty');
let results=[]; // {file, name, url, data, el}

// ---- tabs ----
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  const g=t.dataset.tab==='gallery';
  $('#panel-gallery').style.display=g?'':'none';
  $('#panel-results').style.display=g?'none':'';
  if(!g) renderResults();
});

// ---- theme ----
$('#themeBtn').onclick=()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const dark=cur==='dark'||(!cur&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark?'light':'dark');
};

// ---- pickers / drag-drop ----
$('#pickFolder').onclick=e=>{e.preventDefault();$('#folder').click();};
$('#pickFiles').onclick=e=>{e.preventDefault();$('#files').click();};
$('#folder').onchange=()=>run($('#folder').files);
$('#files').onchange=()=>run($('#files').files);
const drop=$('#drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>run(e.dataTransfer.files));

// ---- filters ----
$('#q').oninput=applyFilter;
$('#onlyId').onchange=applyFilter;
$('#csv').onclick=exportCSV;
$('#clear').onclick=()=>{results.forEach(r=>r.el.remove());results=[];
  stats.classList.remove('show');toolbar.classList.remove('show');tabs.classList.remove('show');
  $('#rsummary').innerHTML='';$('#rgroups').innerHTML='';$('#tc-all').textContent='0';empty.style.display='none';};

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function confColor(c){return c>=0.7?'var(--good)':(c>0?'var(--warn)':'var(--bad)');}
function brandColor(b){let h=0;for(const ch of (b||'?'))h=(h*31+ch.charCodeAt(0))%360;return `hsl(${h} 55% 48%)`;}

// Injected from the backend's measured client concurrency (app.py
// _CLIENT_CONCURRENCY) at render time. Split across two ORIGINS (this
// page's port, plus _SECOND_PORT) because real browsers cap concurrent
// HTTP/1.1 connections to a single origin at ~6 -- asking for more on
// one origin just gets silently throttled, it doesn't actually run in
// parallel. Two origins = two independent connection budgets.
const OCR_CONCURRENCY={{ client_concurrency }};
const OCR_PORTS=[location.port||'80','{{ second_port }}'];
function ocrUrl(workerIdx){
  return `${location.protocol}//${location.hostname}:${OCR_PORTS[workerIdx%OCR_PORTS.length]}/ocr`;
}

async function run(fileList){
  const files=[...fileList].filter(f=>f.type.startsWith('image/'));
  if(!files.length)return;
  stats.classList.add('show');toolbar.classList.add('show');tabs.classList.add('show');progress.classList.add('show');
  let done=0;bar.style.width='0%';
  let next=0;
  async function worker(workerIdx){
    const url=ocrUrl(workerIdx);
    while(next<files.length){
      const f=files[next++];
      const rec=addCard(f);
      try{ rec.data=await ocrWithRetry(f,url); fillCard(rec); }
      catch(err){ fillError(rec,String(err)); }
      done++;bar.style.width=(done/files.length*100)+'%';refresh();
    }
  }
  const workerCount=Math.min(OCR_CONCURRENCY,files.length);
  await Promise.all(Array.from({length:workerCount},(_,i)=>worker(i)));
  setTimeout(()=>progress.classList.remove('show'),600);
}

// Safari + Werkzeug dev server occasionally drops a reused keep-alive socket
// ("TypeError: Load failed") -- short retry covers that. A 503 means the
// server-side worker pool is rebuilding after one process died (see
// app.py's _reset_executor) -- that takes several seconds for every
// worker to reload its model, so it gets a longer allowance instead of
// giving up while the rebuild is still in progress.
async function ocrWithRetry(file,url){
  let lastErr;
  for(let i=0;i<4;i++){
    try{
      const fd=new FormData();fd.append('image',file,file.name);
      const res=await fetch(url,{method:'POST',body:fd,cache:'no-store',keepalive:false});
      if(res.status===503){ lastErr=new Error('HTTP 503'); await new Promise(r=>setTimeout(r,3000*(i+1))); continue; }
      if(!res.ok) throw new Error('HTTP '+res.status);
      return await res.json();
    }catch(err){ lastErr=err; await new Promise(r=>setTimeout(r,200*(i+1))); }
  }
  throw lastErr;
}

function addCard(file){
  const url=URL.createObjectURL(file);
  const el=document.createElement('div');el.className='card';
  el.innerHTML=`<div class="thumb"><img src="${url}" alt=""></div>
    <div class="body"><div class="fname">${esc(file.name)}</div>
    <div class="spinner"></div><div class="skel">reading text…</div></div>`;
  grid.appendChild(el);
  const rec={file,name:file.name,url,data:null,el};results.push(rec);return rec;
}

// which bucket a finished result falls into
function catOf(rec){
  const d=rec.data; if(!d||d.error) return null;
  const v=d.device||{}; const b=!!v.brand,m=!!v.model;
  return (b&&m)?'both':((b||m)?'one':'none');
}

function fillError(rec,msg){
  rec.el.querySelector('.body').innerHTML=`<div class="fname">${esc(rec.name)}</div><div class="err">⚠ ${esc(msg)}</div>`;
}

function fillCard(rec){
  const d=rec.data;const body=rec.el.querySelector('.body');
  if(!d||d.error){fillError(rec,(d&&d.error)||'failed');return;}
  const dev=d.device||{};const cat=catOf(rec);
  const identified=cat==='both'||cat==='one';
  const conf=dev.confidence!=null?dev.confidence:0;
  const text=(d.text&&d.text.trim())?d.text:'(no text found)';
  const thumb=rec.el.querySelector('.thumb');
  thumb.insertAdjacentHTML('beforeend',
    (dev.brand?`<span class="badge" style="background:${brandColor(dev.brand)}">${esc(dev.brand)}</span>`:'')
    +`<span class="statusdot sd ${cat}"></span>`);
  body.innerHTML=`
    <div class="fname">${esc(d.source||rec.name)}</div>
    <div class="device ${identified?'':'none'}">${esc(identified?(dev.display_name||[dev.brand,dev.model].filter(Boolean).join(' ')):'No device identified')}</div>
    <div class="mm">
      <span class="pair">Make <b>${esc(dev.brand||'—')}</b></span>
      <span class="pair">Model <b>${esc(dev.model||'—')}</b></span>
    </div>
    <div class="meter">
      <div class="top"><span>identification confidence</span><b>${(conf*100).toFixed(0)}%</b></div>
      <div class="rail"><div class="fill" style="width:${Math.max(conf*100,2)}%;background:${confColor(conf)}"></div></div>
    </div>
    <div class="txtwrap">
      <div class="txthdr"><span class="lbl">Extracted text · ${d.detection_count||0}</span>
        <button class="copy">📋 Copy</button></div>
      <pre class="text">${esc(text)}</pre>
    </div>
    <div class="foot"><span>${esc(d.engine||'')}</span><span>${d.elapsed_ms?Math.round(d.elapsed_ms)+' ms':''}</span></div>`;
  body.querySelector('.copy').onclick=e=>{
    navigator.clipboard.writeText(text);const b=e.currentTarget;b.textContent='✓ Copied';
    setTimeout(()=>b.innerHTML='📋 Copy',1200);};
}

function refresh(){
  const done=results.filter(r=>r.data&&!r.data.error);
  const idd=done.filter(r=>{const c=catOf(r);return c==='both'||c==='one';});
  const regs=done.reduce((a,r)=>a+(r.data.detection_count||0),0);
  const avg=idd.length?idd.reduce((a,r)=>a+(r.data.device.confidence||0),0)/idd.length:0;
  $('#s-total').textContent=results.length;
  $('#s-id').textContent=idd.length;
  $('#s-conf').innerHTML=idd.length?(avg*100).toFixed(0)+'<small>%</small>':'–';
  $('#s-reg').textContent=regs;
  $('#tc-all').textContent=done.length;
  applyFilter();
  if($('#panel-results').style.display!=='none') renderResults();
}

function applyFilter(){
  const q=$('#q').value.toLowerCase().trim();const onlyId=$('#onlyId').checked;let shown=0;
  for(const r of results){
    const dev=(r.data||{}).device||{};const c=catOf(r);const id=c==='both'||c==='one';
    const hay=`${r.name} ${dev.brand||''} ${dev.model||''} ${dev.display_name||''}`.toLowerCase();
    const ok=(!q||hay.includes(q))&&(!onlyId||id);
    r.el.style.display=ok?'':'none';if(ok)shown++;
  }
  empty.style.display=(results.length&&!shown)?'block':'none';
}

const CAT={
  both:{label:'Make & model identified',desc:'Both the brand and the model number were read.'},
  one: {label:'Partially identified',desc:'Only one of make or model was found.'},
  none:{label:'Not identified',desc:'Neither make nor model could be determined.'},
};

function renderResults(){
  const done=results.filter(r=>r.data&&!r.data.error);
  const b={both:[],one:[],none:[]};
  done.forEach(r=>{const c=catOf(r);if(c)b[c].push(r);});
  $('#rempty').style.display=done.length?'none':'block';
  const tot=done.length||1;
  $('#rsummary').innerHTML=['both','one','none'].map(c=>`
    <div class="rstat ${c}"><div class="pct">${Math.round(b[c].length/tot*100)}%</div>
    <div class="v">${b[c].length}</div><div class="k">${esc(CAT[c].label)}</div></div>`).join('');
  $('#rgroups').innerHTML=['both','one','none'].map(c=>{
    const items=b[c];
    const list=items.length?`<div class="rlist">`+items.map(r=>{
      const v=r.data.device||{};
      const dn=v.display_name||[v.brand,v.model].filter(Boolean).join(' ')||'—';
      const tag=v.brand?`<span class="tag" style="background:${brandColor(v.brand)}">${esc(v.brand)}</span>`:'';
      return `<div class="ritem"><img src="${r.url}" alt="">
        <div class="meta"><div class="dn">${esc(dn)}</div><div class="fn">${esc(r.name)}</div></div>${tag}</div>`;
    }).join('')+`</div>`:`<div class="none-txt">— none —</div>`;
    return `<div class="rgroup"><h3><span class="dot ${c}"></span>${esc(CAT[c].label)}
      <span class="tabcount">${items.length}</span></h3>
      <p class="desc">${esc(CAT[c].desc)}</p>${list}</div>`;
  }).join('');
}

function exportCSV(){
  const rows=[['filename','brand','model','display_name','confidence','regions','extracted_text']];
  for(const r of results){
    if(!r.data||r.data.error)continue;const dev=r.data.device||{};
    rows.push([r.data.source||r.name,dev.brand||'',dev.model||'',dev.display_name||'',
      dev.confidence!=null?dev.confidence.toFixed(3):'',r.data.detection_count||0,
      (r.data.text||'').replace(/\n/g,' | ')]);
  }
  const csv=rows.map(row=>row.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download='switch-ocr-results.csv';a.click();
}
</script>
</body>
</html>
"""


@app.after_request
def no_cache(resp):
    # Prevent the browser from serving a stale/blank page across dev restarts.
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    # The page (opened on the primary port) also sends uploads to
    # _SECOND_PORT to get a second same-origin connection budget from the
    # browser -- that makes it a cross-origin request, so the response
    # needs this or the browser blocks it. Local-machine tool only, no
    # cookies/auth involved, so an open policy is fine here.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


@app.route("/")
def index():
    return render_template_string(PAGE, pool_size=_POOL_SIZE,
                                  client_concurrency=_CLIENT_CONCURRENCY,
                                  second_port=_SECOND_PORT)


@app.route("/ocr", methods=["POST"])
def ocr():
    f = request.files.get("image")
    if f is None:
        return jsonify(error="no image uploaded"), 400

    raw = np.frombuffer(f.read(), np.uint8)
    img = cv2.imdecode(raw, cv2.IMREAD_COLOR)  # BGR ndarray, what the reader expects
    if img is None or img.size == 0:
        return jsonify(error="could not decode image"), 400

    # Runs in a separate worker PROCESS (see get_executor's docstring for
    # why that's required, not just nice-to-have) — .result() blocks this
    # request's thread until that worker finishes, same external
    # behaviour as before, genuinely parallel underneath now.
    try:
        payload = get_executor().submit(_worker_ocr, img).result()
    except BrokenProcessPool:
        # See _reset_executor's docstring: rebuild instead of staying
        # dead. The frontend already retries a failed upload a few times
        # (ocrWithRetry), so this heals within the same run instead of
        # requiring anyone to notice and restart the server.
        _reset_executor()
        return jsonify(error="OCR worker pool restarting, please retry"), 503
    except Exception as exc:
        return jsonify(error=f"OCR failed: {exc}"), 500
    payload["source"] = f.filename or "upload"  # read() reports "<ndarray>" for arrays
    return jsonify(payload)


if __name__ == "__main__":
    import socket
    # Running `python app.py` a second time while the first copy is still
    # up doesn't fail loudly -- it happily spins up ANOTHER full 12-worker
    # OCR pool that competes with the first one for the same CPU cores,
    # which looks like random, unexplained slowdowns partway through a
    # run (this happened repeatedly in practice before this check
    # existed). Check the port BEFORE paying the expensive get_executor()
    # cost, so a second launch fails fast and says why instead of quietly
    # doubling resource usage.
    _probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _probe.settimeout(0.5)
    _already_running = _probe.connect_ex(("127.0.0.1", 5000)) == 0
    _probe.close()
    if _already_running:
        print("switch-ocr is ALREADY running -> just open http://127.0.0.1:5000")
        print("(starting a second copy would compete with the first for CPU "
              "and slow BOTH of them down -- so this refuses instead.)")
        raise SystemExit(1)

    print(f"Loading {_POOL_SIZE} OCR engine instance(s) (first run downloads models) …")
    get_executor()
    # Second origin for the browser's benefit only (see _SECOND_PORT) --
    # same app, same routes, same shared executor/pool underneath.
    threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=_SECOND_PORT, debug=False,
                               threaded=True, use_reloader=False),
        daemon=True,
    ).start()
    print(f"Ready -> open http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True, use_reloader=False)
