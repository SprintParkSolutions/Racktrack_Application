// Web Storage that cannot crash the app.
//
// localStorage is not a plain object with a null fallback — accessing it
// THROWS when site data is blocked (iOS Safari "Block All Cookies",
// Chrome/Edge blocking third-party-and-site-data, some managed WebViews), and
// setItem throws QuotaExceededError once the ~5 MB origin budget is full.
// Every one of those throws used to happen inside a React effect, and an
// uncaught throw in an effect unmounts the tree — so a storage-blocked browser
// or a full quota blanked the entire product.
//
// Reads were already guarded case by case; writes mostly were not, which is
// exactly the kind of per-site discipline that decays. Routing every call
// through here makes the guarantee structural instead.

/** @returns {string|null} the stored value, or null if unreadable. */
export function getItem(key, storage = 'local') {
  try {
    return pick(storage).getItem(key);
  } catch {
    return null;
  }
}

/** @returns {boolean} true if the value was actually persisted. */
export function setItem(key, value, storage = 'local') {
  try {
    pick(storage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key, storage = 'local') {
  try {
    pick(storage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Read and JSON.parse in one step. Returns `fallback` on either failure. */
export function getJSON(key, fallback = null, storage = 'local') {
  const raw = getItem(key, storage);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Persist a JSON value, surviving a full quota.
 *
 * When the write fails and the value is an array, drop entries and retry — a
 * truncated history is worth far more to the user than a crash.
 *
 * Which END gets dropped is the whole point, and the first version got it
 * wrong. It kept the tail, but the only caller builds its history with
 * `unshift`, i.e. NEWEST-first — so a user who completed a scan, waited
 * through the analysis and opened History found that scan missing while a
 * week-old one survived. `newestFirst` is explicit rather than guessed
 * because there is no way to infer ordering from the array itself.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.newestFirst=true] true when index 0 is the newest
 *   entry (the shape `unshift` produces), so trimming takes from the END.
 * @returns {boolean} true if anything was persisted.
 */
export function setJSON(key, value, storage = 'local', { newestFirst = true } = {}) {
  // JSON.stringify itself can throw — on a circular structure, a BigInt, or a
  // value too large to serialise. It sat outside the guard, so the one thing
  // this module promises (never throw) was not true of its main entry point.
  let serialised;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return false;
  }
  if (setItem(key, serialised, storage)) return true;

  if (Array.isArray(value)) {
    let trimmed = value;
    while (trimmed.length > 1) {
      const keep = Math.floor(trimmed.length / 2);
      trimmed = newestFirst ? trimmed.slice(0, keep) : trimmed.slice(trimmed.length - keep);
      try {
        if (setItem(key, JSON.stringify(trimmed), storage)) return true;
      } catch {
        return false;
      }
    }
  }

  // Deliberately NOT removing the key here any more. The previous version
  // cleared it on any failure, so a quota exhausted by UNRELATED keys destroyed
  // a perfectly good stored history — twelve scans lost to one failed write of
  // the thirteenth. Leaving the old value is strictly better: it is stale at
  // worst, whereas deleting it is data loss the user never asked for.
  return false;
}

function pick(storage) {
  return storage === 'session' ? window.sessionStorage : window.localStorage;
}
