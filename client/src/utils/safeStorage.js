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
 * When the write fails and the value is an array, drop the oldest entries and
 * retry — a truncated history is worth far more to the user than a crash. If
 * it still will not fit, clear the key entirely so the next write starts from
 * a clean slate rather than failing forever on a value already too big to
 * replace.
 *
 * @returns {boolean} true if anything was persisted.
 */
export function setJSON(key, value, storage = 'local') {
  if (setItem(key, JSON.stringify(value), storage)) return true;

  if (Array.isArray(value)) {
    let trimmed = value;
    while (trimmed.length > 1) {
      trimmed = trimmed.slice(Math.ceil(trimmed.length / 2));
      if (setItem(key, JSON.stringify(trimmed), storage)) return true;
    }
  }

  removeItem(key, storage);
  return false;
}

function pick(storage) {
  return storage === 'session' ? window.sessionStorage : window.localStorage;
}
