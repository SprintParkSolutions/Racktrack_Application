// Pool of long-running Python workers.
//
// Each worker is spawned with `py -u -m pipeline.worker` and keeps all YOLO
// models resident in memory. Requests travel over newline-delimited JSON:
//   stdin : {"id", "command", ...}
//   stdout: {"id", "ok", ...}
// stderr is operator logs (we forward to console.error).
//
// The pool fans requests out to the first free worker, queues when all busy,
// and auto-respawns workers that die.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const path = require('path');

// Lazy-load observability so this module can also be required from non-server
// contexts. When present we use structured logging + worker-event counters.
let _o11y = null;
function o11y() {
  if (_o11y === null) {
    try { _o11y = require('./lib/observability'); }
    catch { _o11y = false; }
  }
  return _o11y || null;
}
function wlog(level, fields, msg) {
  const o = o11y();
  if (o) o.logger[level](fields, msg);
  else console[level === 'error' || level === 'fatal' ? 'error' : (level === 'warn' ? 'warn' : 'log')](
    `[${fields.worker !== undefined ? `worker ${fields.worker}` : 'pool'}] ${msg}`
  );
}
function wcount(event) {
  const o = o11y();
  if (o) o.metrics.workerEvents.labels(event).inc();
}

class Worker extends EventEmitter {
  constructor(pythonCmd, pythonArgs, cwd, index, env) {
    super();
    this.index = index;
    this.busy = false;
    this.ready = false;
    this.pending = new Map(); // id -> {resolve, reject}
    this.stdoutBuf = '';

    this.proc = spawn(pythonCmd, pythonArgs, { cwd, env });

    this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
    this.proc.stderr.on('data', (chunk) => {
      const s = chunk.toString().trimEnd();
      if (s) wlog('warn', { worker: index, kind: 'worker.stderr' }, s);
    });
    this.proc.on('exit', (code, signal) => {
      wcount('exit');
      wlog('warn', { worker: index, code, signal, kind: 'worker.exit' },
        `worker ${index} exited code=${code} signal=${signal}`);
      for (const { reject } of this.pending.values()) {
        reject(new Error('worker exited mid-request'));
      }
      this.pending.clear();
      this.ready = false;
      this.emit('exit', { code, signal });
    });
    this.proc.on('error', (err) => {
      wcount('spawn_error');
      wlog('error', { worker: index, err: err.message, kind: 'worker.spawn_error' },
        `worker ${index} spawn error: ${err.message}`);
      // A failed spawn (e.g. python3 not on PATH) emits 'error' and 'close' but
      // NEVER 'exit'. Without this, the dead worker stayed in the pool marked
      // not-ready, the respawn/backoff path never ran, and every queued request
      // hung forever with no response and no error — the server looked healthy
      // while /api/analyze, /api/detect and /api/select silently stopped working.
      for (const { reject } of this.pending.values()) {
        reject(new Error(`worker failed to start: ${err.message}`));
      }
      this.pending.clear();
      this.ready = false;
      this.emit('exit', { code: null, signal: null });
    });
    wcount('spawn');
  }

  _onStdout(chunk) {
    this.stdoutBuf += chunk.toString();
    let idx;
    while ((idx = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, idx).trim();
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      if (!line) continue;

      let msg;
      try { msg = JSON.parse(line); }
      catch {
        wcount('bad_json');
        wlog('error', { worker: this.index, kind: 'worker.bad_json', line: line.slice(0, 200) },
          `bad JSON on stdout`);
        continue;
      }

      if (msg.ready === true) {
        this.ready = true;
        this.emit('ready');
        continue;
      }
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        this.busy = false;
        pending.resolve(msg);
        this.emit('free', this);
      }
    }
  }

  dispatch(command, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('worker not ready'));
      const id = randomUUID();
      this.busy = true;
      let timer = null;
      const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
      // Wrap so a stdout reply (or mid-request exit) also cancels the timer.
      this.pending.set(id, {
        resolve: (v) => { clear(); resolve(v); },
        reject:  (e) => { clear(); reject(e); },
      });
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          this.busy = false;
          wcount('timeout');
          wlog('error', { worker: this.index, kind: 'worker.timeout', command, timeoutMs },
            `worker ${this.index} request '${command}' timed out after ${timeoutMs}ms — recycling worker`);
          reject(new Error(`pipeline worker timed out after ${timeoutMs}ms`));
          this.kill(); // a hung worker won't recover — kill it; the pool respawns it
        }, timeoutMs);
      }
      const payload = JSON.stringify({ id, command, ...params }) + '\n';
      this.proc.stdin.write(payload, (err) => {
        if (err) {
          clear();
          this.pending.delete(id);
          this.busy = false;
          reject(err);
        }
      });
    });
  }

  kill() {
    this.ready = false;        // prevent _drain from picking us mid-shutdown
    try { this.proc.kill('SIGTERM'); } catch { /* already dead */ }
  }
}


class WorkerPool extends EventEmitter {
  constructor({ size = 1, pythonCmd, pythonArgs, cwd, env, requestTimeoutMs }) {
    super();
    this.size = size;
    this.pythonCmd = pythonCmd;
    this.pythonArgs = pythonArgs;
    this.cwd = cwd;
    this.env = env;
    // Per-request wall-clock cap so a hung/OOM inference can't pin a request
    // (and its worker) forever. Overridable via env; 0 disables.
    this.requestTimeoutMs = requestTimeoutMs != null
      ? requestTimeoutMs
      : Number(process.env.RACKTRACK_WORKER_TIMEOUT_MS || 120000);
    this.workers = [];
    this.queue = []; // [{command, params, resolve, reject}]
    this._shuttingDown = false;
    this._crashCounts = {}; // index -> consecutive fast-exit count (backoff)

    for (let i = 0; i < size; i++) this._spawn(i);
  }

  _spawn(index) {
    if (this._shuttingDown) return;  // don't respawn after shutdown
    const w = new Worker(this.pythonCmd, this.pythonArgs, this.cwd, index, this.env);
    w._spawnedAt = Date.now();
    w.on('ready', () => {
      wcount('ready');
      wlog('info', { worker: index, kind: 'worker.ready' },
        `worker ${index} ready`);
      this._drain();
    });
    w.on('free', () => this._drain());
    w.on('exit', () => {
      this.workers = this.workers.filter(x => x !== w);
      if (this._shuttingDown) return;
      // Crash-loop guard: if a worker dies quickly (< 15s), it's likely a
      // permanent fault (missing model, bad dep, OOM). Back off exponentially
      // (2s → 30s cap) instead of respawning every 2s forever. A worker that
      // ran healthily resets the counter.
      const lived = Date.now() - (w._spawnedAt || 0);
      if (lived < 15000) this._crashCounts[index] = (this._crashCounts[index] || 0) + 1;
      else this._crashCounts[index] = 0;
      const n = this._crashCounts[index];
      const delay = Math.min(30000, 2000 * Math.pow(2, Math.max(0, n - 1)));
      if (n >= 1) {
        wlog('warn', { worker: index, crashes: n, delay, kind: 'worker.backoff' },
          `worker ${index} died fast (${n}x) — respawning in ${delay}ms`);
      }
      setTimeout(() => this._spawn(index), delay);
    });
    this.workers.push(w);
  }

  _drain() {
    while (this.queue.length > 0) {
      const free = this.workers.find(x => x.ready && !x.busy);
      if (!free) return;
      const task = this.queue.shift();
      free.dispatch(task.command, task.params, this.requestTimeoutMs).then(task.resolve, task.reject);
    }
  }

  request(command, params) {
    return new Promise((resolve, reject) => {
      if (this._shuttingDown) return reject(new Error('worker pool shutting down'));
      this.queue.push({ command, params, resolve, reject });
      this._drain();
    });
  }

  async shutdown() {
    this._shuttingDown = true;
    // Reject anything still queued so callers stop hanging on shutdown.
    while (this.queue.length > 0) {
      const t = this.queue.shift();
      try { t.reject(new Error('worker pool shutting down')); } catch (_) {}
    }
    for (const w of this.workers) w.kill();
  }
}

module.exports = { WorkerPool };
