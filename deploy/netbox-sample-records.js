/*
 * Sample records for every site in NetBox.
 *
 * A rack can only drift from a record that exists, so a demonstration at a
 * site with no records shows nothing at all. This puts two named racks in each
 * site, each with the kit a small room actually holds - a patch panel, two
 * switches, a router, a gateway, two servers, an access point, a UPS and a
 * power strip - at fixed shelves.
 *
 * It is idempotent: a rack or a device that is already there is left exactly
 * as it is, and nothing existing is ever edited or removed. Run it as often as
 * you like.
 *
 * On the demo, where NetBox is inside the docker network and its address and
 * token are the application's own environment:
 *
 *   ssh -i ~/.ssh/racktrack_demo root@82.29.164.213 \
 *     "docker exec -i racktrack-demo node -" < deploy/netbox-sample-records.js
 *
 * Anywhere else, set NETBOX_URL and NETBOX_TOKEN and run it with node.
 */
const u = process.env.NETBOX_URL, t = process.env.NETBOX_TOKEN;
const H = { Authorization: 'Token ' + t, 'Content-Type': 'application/json' };
const get = (p) => fetch(u + p, { headers: H }).then((r) => r.json());
const post = async (p, body) => {
  const r = await fetch(u + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 300)}`);
  return d;
};

/* One kit, in the order a rack is built: panel at the top, switches under it,
   the network kit in the middle, servers, and power at the bottom. */
const KIT = [
  { u: 42, type: 74, role: 8,  tag: 'PP01', what: 'Patch panel' },
  { u: 41, type: 75, role: 28, tag: 'SW01', what: 'Access switch' },
  { u: 40, type: 71, role: 28, tag: 'SW02', what: 'Access switch' },
  { u: 38, type: 69, role: 7,  tag: 'RT01', what: 'Router' },
  { u: 36, type: 76, role: 29, tag: 'GW01', what: 'Gateway' },
  { u: 30, type: 77, role: 30, tag: 'SRV01', what: 'Server' },
  { u: 28, type: 77, role: 30, tag: 'SRV02', what: 'Server' },
  { u: 20, type: 62, role: 27, tag: 'AP01', what: 'Wireless access point' },
  { u: 4,  type: 80, role: 31, tag: 'UPS01', what: 'UPS' },
  { u: 2,  type: 79, role: 26, tag: 'PDU01', what: 'Power strip' },
];

const RACKS = {
  7: ['SP-HYB-RM01-R01-R2', 'SP-HYB-RM01-R02-R1'],
  8: ['HYD-C-RM01-R02', 'HYD-C-RM02-R01'],
  9: ['HYD-E-RM01-R01', 'HYD-E-RM01-R02'],
};

(async () => {
  for (const [siteId, names] of Object.entries(RACKS)) {
    for (const name of names) {
      const found = await get(`/api/dcim/racks/?site_id=${siteId}&name=${encodeURIComponent(name)}`);
      let rack = found.results && found.results[0];
      if (rack) {
        console.log(`rack ${name}: already there (${rack.id})`);
      } else {
        rack = await post('/api/dcim/racks/', {
          name, site: Number(siteId), status: 'active', u_height: 42, width: 19,
          comments: 'Sample records for a demonstration.',
        });
        console.log(`rack ${name}: created (${rack.id})`);
      }
      for (const k of KIT) {
        const devName = `${name}-${k.tag}`;
        const has = await get(`/api/dcim/devices/?name=${encodeURIComponent(devName)}&limit=1`);
        if (has.count) { console.log(`  ${devName}: already there`); continue; }
        try {
          await post('/api/dcim/devices/', {
            name: devName, device_type: k.type, role: k.role, site: Number(siteId),
            rack: rack.id, position: k.u, face: 'front', status: 'active',
            comments: `${k.what}, sample record.`,
          });
          console.log(`  ${devName}: created at U${k.u}`);
        } catch (e) { console.log(`  ${devName}: NOT created - ${e.message}`); }
      }
    }
  }
})().catch((e) => console.log('ERR', e.message));
