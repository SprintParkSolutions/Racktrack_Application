/**
 * A person's name for a rack.
 *
 * A scan generates an id like RK-3CD81888 — stable and unique, but not what an
 * engineer calls the rack. This lets them give it a real name ("Comms Room A,
 * Rack 3") without touching the id everything else keys on. The name is
 * optional: absent, the id stands in, so nothing breaks for a rack nobody has
 * named. And it is editable — a rack renamed after the fact updates here, and
 * the next scan, drift check and push pick it up.
 *
 * Keyed by rack id, one small JSON file. Lives under the data dir, which is the
 * mounted volume, so a name survives a restart.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RT_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'rack-names.json');

const read = () => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
};
const write = (map) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
};

/** The person-given name for a rack, or null if it has none. */
function get(rackId) {
  if (!rackId) return null;
  const name = read()[String(rackId)];
  return name && String(name).trim() ? String(name).trim() : null;
}

/**
 * Set or change a rack's name. An empty value clears it, so the id shows again
 * — the way to "un-name" a rack you named by mistake.
 */
function set(rackId, name) {
  if (!rackId) return null;
  const map = read();
  const clean = name === null || name === undefined ? '' : String(name).trim().slice(0, 120);
  if (clean) map[String(rackId)] = clean;
  else delete map[String(rackId)];
  write(map);
  return clean || null;
}

/** The name to show for a rack: the person's, else the id itself. */
const display = (rackId) => get(rackId) || String(rackId || '');

module.exports = { get, set, display, FILE };
