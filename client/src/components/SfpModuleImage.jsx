import { useState } from 'react';

// Visual identification for SFP transceiver modules.
//
// Renders a real product photo if the server has supplied `module.imageUrl`
// (the SFP pipeline scrapes per-SKU images from JSON-LD product schemas
// and from <img> tags in product cards / table rows). When the URL is
// missing OR fails to load (404, CORS, etc.) we fall back to an inline
// SVG that draws the *front face* of the module: the connector that the
// user will actually be looking at when handling the part. That's the
// most useful visual when no photo is available, because the connector
// determines what cable plugs in.
//
// Inferred from the module data:
//   form factor (SFP / SFP+ / SFP28 / QSFP+ / QSFP28 / QSFP-DD)
//       from partNumber / speed
//   connector (RJ45 / LC duplex / MPO / DAC)
//       from `type` (T / SR / LR / SX / LX / SR4 / LR4 / DAC ...)
//
// All inputs are best-effort — unknown values fall through to a generic
// SFP silhouette so we always render *something*.

const BRAND_COLOURS = {
  cisco:    '#4c4546',
  juniper:  '#4c4546',
  arista:   '#4c4546',
  ubiquiti: '#1a1c1d',
  mikrotik: '#1a1c1d',
  hpe:      '#4c4546',
  dell:     '#1a1c1d',
  netgear:  '#cfc4c5',
  tplink:   '#cfc4c5',
  fs:       '#1a1c1d',
  finisar:  '#1a1c1d',
  default:  '#cfc4c5',
};

function brandColor(brand) {
  const key = String(brand || '').toLowerCase().replace(/\s+/g, '');
  for (const k of Object.keys(BRAND_COLOURS)) {
    if (key.includes(k)) return BRAND_COLOURS[k];
  }
  return BRAND_COLOURS.default;
}

// Pull connector kind out of the `type` field. Examples:
//   "T"   → rj45     "SR"/"SX"/"LR"/"LX" → lc
//   "SR4"/"LR4"      → mpo    "DAC"              → dac
function inferConnector(module) {
  const t = String(module?.type || '').toUpperCase();
  const p = String(module?.partNumber || '').toUpperCase();
  if (/(^|[-_])T($|[-_])|BASE-?T|RJ45/.test(t) || /(^|[-_])T-?S?($|[-_])/.test(p)) return 'rj45';
  if (/^DAC|TWINAX|DIRECT/.test(t) || /\bDAC\b/.test(p))                          return 'dac';
  if (/SR4|LR4|MPO|MTP/.test(t)    || /\b(SR4|LR4|MPO)\b/.test(p))                return 'mpo';
  if (/SR|LR|SX|LX|ER|ZR/.test(t))                                                return 'lc';
  return 'lc'; // safest visual default for an unknown fiber SFP
}

// Pull form factor out of speed / partNumber. Bigger modules render a
// noticeably wider silhouette so the user can distinguish SFP from QSFP
// at a glance.
function inferFormFactor(module) {
  const s = `${module?.speed || ''} ${module?.partNumber || ''} ${module?.type || ''}`.toUpperCase();
  if (/400G|QSFP-?DD/.test(s)) return 'qsfp-dd';
  if (/100G|QSFP28/.test(s))   return 'qsfp28';
  if (/40G|QSFP/.test(s))      return 'qsfp+';
  if (/25G|SFP28/.test(s))     return 'sfp28';
  if (/10G|SFP\+|XGS?/.test(s))return 'sfp+';
  return 'sfp';
}

const FORM_HEIGHTS = {
  'sfp':     12,
  'sfp+':    12,
  'sfp28':   12,
  'qsfp+':   18,
  'qsfp28':  18,
  'qsfp-dd': 22,
};

// SfpModuleImage — props:
//   module: the SFP module object (partNumber, brand, type, speed, imageUrl?)
//   size:   'hero' (large, used in TOP PICK card) | 'compact' (small, list rows)
export default function SfpModuleImage({ module, size = 'compact' }) {
  // Track per-mount failure so a single 404 / CORS / decode error on the
  // scraped URL falls back to the silhouette instead of leaving a broken-
  // image icon. Once failed, re-using the same image is no use, so we
  // don't retry within a render lifetime.
  const [imgFailed, setImgFailed] = useState(false);
  if (module?.imageUrl && !imgFailed) {
    // No decorative container — the parent card supplies whatever
    // framing is wanted. Hero size uses `cover` so the product photo
    // visually fills its slot; compact thumb uses `contain` so small
    // images don't get cropped.
    const hero = size === 'hero';
    return (
      <img
        src={module.imageUrl}
        alt={`${module.brand || ''} ${module.partNumber || ''}`.trim()}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        style={{
          width:  '100%',
          height: '100%',
          objectFit: hero ? 'cover' : 'contain',
          display: 'block',
          background: '#ffffff',
        }}
      />
    );
  }

  // No real image available — render nothing (used to draw an SVG
  // silhouette here but the user explicitly asked for no generated
  // graphics). The parent card layout still works because the image
  // slot collapses gracefully.
  return null;
}
