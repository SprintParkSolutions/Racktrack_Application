import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Field, Input, Select, Textarea, Act, SaveMark, Choice, Seg, DcSwitch, TagBox, Picker, Secret,
  Stack, Grid, Rows, Row, Sub, Note, Empty, Block, Held, cx, mono, swatch, checkLine,
} from './Fields.jsx';
import { sectionFilled, orgWideProfile, blank, plural, vEmail, vPhone, vCidr, required, vMinLen } from '../../utils/orgSettings';

/* The optional sections: what the organization runs, buys, names and how
   its switches are reached. Systems, vendors and conventions are
   organization-wide, so they are read from the first datacentre and written
   to every one; switch access is per datacentre, with a switcher.

   None of these gates anything. Each saves as it goes and can be left
   empty. */

const NONE = [];
const stopEnter = (e) => { if (e.key === 'Enter') e.stopPropagation(); };
function useReport(onValidity, valid) { useEffect(() => { onValidity?.(valid); }, [onValidity, valid]); }

/* ---- 5. Systems ---------------------------------------------------------- */
const RECORD = [
  { key: 'netbox', label: 'NetBox' },
  { key: 'servicenow', label: 'ServiceNow' },
  { key: 'both', label: 'NetBox and ServiceNow' },
  { key: 'none', label: 'None yet' },
];
const TICKETS = [
  { key: 'servicenow', label: 'ServiceNow' },
  { key: 'jira', label: 'Jira' },
  { key: 'email', label: 'Email' },
  { key: 'none', label: 'No tickets' },
];
const NOTIFY = [
  { key: 'teams', label: 'Microsoft Teams' },
  { key: 'outlook', label: 'Outlook' },
  { key: 'email', label: 'Email' },
];
export function SystemsSection({ s, onValidity, inFlow }) {
  const navigate = useNavigate();
  const p = orgWideProfile(s.dcs) || {};
  const [f, setF] = useState(() => ({ record: '', ticketing: '', notifications: [], ...(p.systems || {}) }));
  useReport(onValidity, true);
  const save = (next) => { setF(next); s.saveSectionAll('systems', next); };
  const none = !s.dcs.length;
  return (
    <Stack>
      {none ? <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty> : null}
      <Stack gap={12}>
        <Sub title="Record of truth" />
        <Choice options={RECORD} value={f.record} onChange={(v) => save({ ...f, record: v })} columns={2} disabled={none} />
      </Stack>
      <Stack gap={12}>
        <Sub title="Ticketing" />
        <Choice options={TICKETS} value={f.ticketing} onChange={(v) => save({ ...f, ticketing: v })} columns={2} disabled={none} />
      </Stack>
      <Stack gap={12}>
        <Sub title="Notifications" />
        <Choice options={NOTIFY} value={f.notifications} onChange={(v) => save({ ...f, notifications: v })} multi columns={3} disabled={none} />
      </Stack>
      {!inFlow ? <Note>Credentials are entered under <button type="button" className="os-link" onClick={() => navigate('/connections')}>Data sources</button>.</Note> : null}
    </Stack>
  );
}

/* ---- 6. Vendors ---------------------------------------------------------- */
const blankVendor = (name) => ({ name, models: [], contact_name: '', contact_email: '', contact_phone: '', support_ref: '' });
export function VendorsSection({ s, onValidity }) {
  const p = orgWideProfile(s.dcs) || {};
  const [list, setList] = useState(() => (p.vendors || NONE).map((v) => ({ ...blankVendor(v.name), ...blank(v), models: Array.isArray(v.models) ? v.models : [] })));
  useReport(onValidity, true);
  useEffect(() => { s.loadCatalogue(); }, [s.loadCatalogue]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = !s.dcs.length;
  const send = (next) => { setList(next); s.saveSectionAll('vendors', next.map((v) => ({ ...v, contact_email: (v.contact_email || '').trim().toLowerCase() }))); };
  const add = (name) => { if (!name || list.some((v) => v.name.toLowerCase() === name.toLowerCase())) return; send([...list, blankVendor(name)]); };
  const setV = (name, patch) => setList((xs) => xs.map((v) => (v.name === name ? { ...v, ...patch } : v)));
  const commitV = (name, patch) => { send(list.map((v) => (v.name === name ? { ...v, ...patch } : v))); };
  const known = s.catalogue;
  return (
    <Stack>
      {none ? <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty> : null}
      <Field label="Add a vendor">
        <Picker options={known} exclude={list.map((v) => v.name)} onPick={add} placeholder="Cisco" loading={!known.length} ariaLabel="Search vendors" />
      </Field>
      {!list.length ? <Empty title="No vendors yet" /> : null}
      {list.map((v) => <VendorBlock key={v.name} v={v} setV={setV} commitV={commitV} onRemove={() => send(list.filter((x) => x.name !== v.name))} mark={s.marks.vendors} />)}
    </Stack>
  );
}
function VendorBlock({ v, setV, commitV, onRemove, mark }) {
  const [open, setOpen] = useState(!!(v.contact_name || v.contact_email || v.contact_phone || v.support_ref));
  const eErr = v.contact_email && vEmail(v.contact_email); const pErr = v.contact_phone && vPhone(v.contact_phone);
  const commit = () => { if (!eErr && !pErr) commitV(v.name, {}); };
  return (
    <Block title={v.name} note={v.models.length ? plural(v.models.length, 'model') : null} right={<><SaveMark mark={mark} /><Act size="sm" variant="quiet" aria-label={`Remove ${v.name}`} onClick={onRemove}>Remove</Act></>}>
      <Field label="Models" help="Enter after each model.">
        <TagBox value={v.models} onChange={(models) => commitV(v.name, { models })} placeholder="Catalyst 9300" ariaLabel={`Models from ${v.name}`} />
      </Field>
      {open ? (
        <Grid>
          <Field label="Support contact"><Input value={v.contact_name} maxLength={120} placeholder="Cisco TAC" aria-label="Support contact name" onChange={(e) => setV(v.name, { contact_name: e.target.value })} onBlur={commit} onKeyDown={stopEnter} /></Field>
          <Field label="Support reference"><Input className={mono} value={v.support_ref} maxLength={80} placeholder="CON-12345" aria-label="Support reference" onChange={(e) => setV(v.name, { support_ref: e.target.value })} onBlur={commit} onKeyDown={stopEnter} /></Field>
          <Field label="Email" error={eErr}><Input type="email" inputMode="email" value={v.contact_email} maxLength={254} placeholder="support@vendor.example" aria-label="Support email" invalid={!!eErr} onChange={(e) => setV(v.name, { contact_email: e.target.value })} onBlur={commit} onKeyDown={stopEnter} /></Field>
          <Field label="Phone" error={pErr}><Input type="tel" inputMode="tel" value={v.contact_phone} maxLength={40} placeholder="+1 800 553 2447" aria-label="Support phone" invalid={!!pErr} onChange={(e) => setV(v.name, { contact_phone: e.target.value })} onBlur={commit} onKeyDown={stopEnter} /></Field>
        </Grid>
      ) : <div><Act size="sm" variant="quiet" onClick={() => setOpen(true)}>Add support contact</Act></div>}
    </Block>
  );
}

/* ---- 7. Naming ----------------------------------------------------------- */
const PATTERNS = [
  { key: 'rack_pattern', label: 'Racks', ph: 'A##', ex: 'A07' },
  { key: 'device_pattern', label: 'Devices', ph: 'AAA-core-##', ex: 'rtm-core-01' },
  { key: 'asset_pattern', label: 'Asset tags', ph: 'AS######', ex: 'AS004512' },
  { key: 'port_pattern', label: 'Ports', ph: '(Gi|Te)\\d+/\\d+/\\d+', ex: 'Gi1/0/24' },
];
const COLOURS = [
  { key: 'blue', hex: '#2f6fd1' }, { key: 'red', hex: '#c8352e' }, { key: 'green', hex: '#2f9a58' }, { key: 'yellow', hex: '#e2b822' },
  { key: 'orange', hex: '#e2792b' }, { key: 'purple', hex: '#7a4fc9' }, { key: 'pink', hex: '#d85c9c' }, { key: 'black', hex: '#1d1d1f' },
  { key: 'white', hex: '#f4f4f2' }, { key: 'grey', hex: '#8a8f98' }, { key: 'cyan', hex: '#2ab3c4' },
];
export function ConventionsSection({ s, onValidity }) {
  const p = orgWideProfile(s.dcs) || {};
  const c0 = p.conventions || {};
  const [f, setF] = useState(() => ({ rack_pattern: '', device_pattern: '', asset_pattern: '', port_pattern: '', u_from_bottom: true, faces: 'front', ...Object.fromEntries(Object.entries(c0).filter(([, v]) => v != null)), cable_colours: Array.isArray(c0.cable_colours) ? c0.cable_colours : [] }));
  const [ex, setEx] = useState(() => Object.fromEntries(PATTERNS.map((x) => [x.key, ''])));
  const [res, setRes] = useState({});
  useReport(onValidity, true);
  const none = !s.dcs.length;
  const saved = useRef(f);
  const send = (next) => { if (JSON.stringify(next) === JSON.stringify(saved.current)) return; saved.current = next; s.saveSectionAll('conventions', next); };
  const commit = () => send(f);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setNow = (patch) => { const next = { ...f, ...patch }; setF(next); send(next); };
  return (
    <Stack>
      {none ? <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty> : null}
      <Stack gap={12}>
        <Sub title="Patterns" note="# is a digit, A is a letter, or a regular expression" />
        <Rows>
          {PATTERNS.map((x) => <PatternRow key={x.key} x={x} value={f[x.key] || ''} example={ex[x.key]} result={res[x.key]} disabled={none} onValue={(v) => set(x.key, v)} onExample={(v) => setEx((e) => ({ ...e, [x.key]: v }))} onBlur={commit} check={s.checkPattern} setResult={(r) => setRes((m) => ({ ...m, [x.key]: r }))} />)}
        </Rows>
      </Stack>
      <Stack gap={12}>
        <Sub title="Cable colours" />
        <Rows>
          {f.cable_colours.map((row, i) => (
            <Row key={i} kind="colour">
              <span className={swatch} style={{ background: COLOURS.find((c) => c.key === row.color)?.hex || '#ccc' }} />
              <Select value={row.color} aria-label="Colour" onChange={(e) => setNow({ cable_colours: f.cable_colours.map((r, k) => (k === i ? { ...r, color: e.target.value } : r)) })}>
                {COLOURS.map((c) => <option key={c.key} value={c.key}>{c.key[0].toUpperCase() + c.key.slice(1)}</option>)}
              </Select>
              <Input value={row.meaning} maxLength={80} placeholder="Uplink" aria-label="Meaning" onChange={(e) => set('cable_colours', f.cable_colours.map((r, k) => (k === i ? { ...r, meaning: e.target.value } : r)))} onBlur={commit} onKeyDown={stopEnter} />
              <Act size="sm" variant="quiet" aria-label="Remove colour" onClick={() => setNow({ cable_colours: f.cable_colours.filter((_, k) => k !== i) })}>Remove</Act>
            </Row>
          ))}
        </Rows>
        <div><Act size="sm" disabled={none} onClick={() => { const used = new Set(f.cable_colours.map((r) => r.color)); const next = COLOURS.find((c) => !used.has(c.key))?.key || 'blue'; setNow({ cable_colours: [...f.cable_colours, { color: next, meaning: '' }] }); }}>Add colour</Act></div>
      </Stack>
      <Grid>
        <Field label="Rack units are counted">
          <Seg ariaLabel="U counting" value={f.u_from_bottom === false ? 'top' : 'bottom'} disabled={none} onChange={(k) => setNow({ u_from_bottom: k === 'bottom' })} options={[{ key: 'bottom', label: 'From the bottom' }, { key: 'top', label: 'From the top' }]} />
        </Field>
        <Field label="Racks are photographed from">
          <Seg ariaLabel="Faces" value={f.faces || 'front'} disabled={none} onChange={(faces) => setNow({ faces })} options={[{ key: 'front', label: 'Front' }, { key: 'rear', label: 'Rear' }, { key: 'both', label: 'Both' }]} />
        </Field>
      </Grid>
    </Stack>
  );
}
function PatternRow({ x, value, example, result, disabled, onValue, onExample, onBlur, check, setResult }) {
  /* The check waits a third of a second after the last keystroke, and the
     answer to an old question is dropped if a newer one is in flight. */
  const gen = useRef(0);
  useEffect(() => {
    if (!value || !example) { setResult(null); return undefined; }
    const g = ++gen.current;
    const id = setTimeout(() => {
      check(value, example).then((r) => { if (g === gen.current) setResult(r ? { ok: !!r.ok, matches: !!r.matches, reason: r.reason || null, mode: r.mode || null } : null); }).catch((e) => { if (g === gen.current) setResult({ ok: false, matches: false, reason: e.message }); });
    }, 320);
    return () => clearTimeout(id);
  }, [value, example, check]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = result?.mode === 'regex' ? 'regular expression' : result?.mode === 'literal' ? 'template' : null;
  const line = !value || !example ? null : !result ? { tone: 'muted', text: 'Checking' } : result.matches ? { tone: 'ok', text: mode ? `Matches the ${mode}` : 'Matches' } : { tone: 'bad', text: result.reason || 'Does not match' };
  return (
    <Row kind="pattern">
      <div className="os-pattern-t">{x.label}</div>
      <Field label="Pattern"><Input className={mono} value={value} maxLength={200} placeholder={x.ph} aria-label={`${x.label} pattern`} disabled={disabled} spellCheck="false" onChange={(e) => onValue(e.target.value)} onBlur={onBlur} onKeyDown={stopEnter} /></Field>
      <Field label="Example" help={line ? <span className={cx(checkLine.base, checkLine[line.tone])}>{line.text}</span> : undefined}>
        <Input className={mono} value={example} maxLength={120} placeholder={x.ex} aria-label={`${x.label} example`} disabled={disabled} spellCheck="false" onChange={(e) => onExample(e.target.value)} onKeyDown={stopEnter} />
      </Field>
    </Row>
  );
}

/* ---- 8. Switch access ---------------------------------------------------- */
export function NetworkSection({ s, onValidity }) {
  const dcs = s.dcs;
  const [dcId, setDcId] = useState(dcs[0]?.id ?? null);
  const dc = dcs.find((d) => d.id === dcId) || dcs[0] || null;
  useReport(onValidity, true);
  useEffect(() => { s.loadCatalogue(); }, [s.loadCatalogue]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!dc) return <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty>;
  const tone = (d) => (sectionFilled('network', d.profile) || sectionFilled('snmp', d.profile) ? 'ok' : undefined);
  return (
    <Stack>
      <DcSwitch dcs={dcs} value={dc.id} onChange={setDcId} tone={tone} />
      <NetworkBlock key={dc.id} dc={dc} s={s} />
      <SnmpBlock key={`snmp-${dc.id}`} dc={dc} s={s} />
    </Stack>
  );
}
function NetworkBlock({ dc, s }) {
  const n0 = dc.profile?.network || {};
  const [f, setF] = useState(() => ({ wifi_ssid: '', notes: '', ...blank(n0), management_ranges: Array.isArray(n0.management_ranges) ? n0.management_ranges : [], unmanaged_makes: Array.isArray(n0.unmanaged_makes) ? n0.unmanaged_makes : [] }));
  const saved = useRef(f);
  const send = (next) => { if (JSON.stringify(next) === JSON.stringify(saved.current)) return; saved.current = next; s.saveSection(dc, 'network', next); };
  const setNow = (patch) => { const next = { ...f, ...patch }; setF(next); send(next); };
  const mark = s.marks[`network:${dc.id}`];
  return (
    <Block title="On site" note={dc.name} right={<SaveMark mark={mark} />}>
      <Grid>
        <Field label="Management ranges" help="One range per entry, Enter after each." span>
          <TagBox isMono value={f.management_ranges} onChange={(v) => setNow({ management_ranges: v })} validate={vCidr} placeholder="10.10.1.0/24" ariaLabel="Management ranges" />
        </Field>
        <Field label="Wi-Fi network" htmlFor={`wifi-${dc.id}`}>
          <Input id={`wifi-${dc.id}`} value={f.wifi_ssid} maxLength={32} placeholder="DC1-OPS" autoComplete="off" onChange={(e) => setF({ ...f, wifi_ssid: e.target.value })} onBlur={() => send(f)} onKeyDown={stopEnter} />
        </Field>
        <Field label="Unmanaged makes">
          <TagBox value={f.unmanaged_makes} onChange={(v) => setNow({ unmanaged_makes: v })} suggestions={s.catalogue} placeholder="APC" ariaLabel="Unmanaged makes" />
        </Field>
        <Field label="Notes" span htmlFor={`nn-${dc.id}`}>
          <Textarea id={`nn-${dc.id}`} value={f.notes} maxLength={2000} placeholder="Jump host 10.10.1.5, VLAN 20" onChange={(e) => setF({ ...f, notes: e.target.value })} onBlur={() => send(f)} />
        </Field>
      </Grid>
    </Block>
  );
}
const AUTH = [{ key: '', label: 'None' }, { key: 'md5', label: 'MD5' }, { key: 'sha', label: 'SHA' }, { key: 'sha256', label: 'SHA-256' }];
const PRIV = [{ key: '', label: 'None' }, { key: 'des', label: 'DES' }, { key: 'aes', label: 'AES' }];
const LEVEL = { noAuthNoPriv: 'no authentication', authNoPriv: 'authenticated', authPriv: 'authenticated and encrypted' };
function SnmpBlock({ dc, s }) {
  const cur = dc.profile?.snmp || { configured: false };
  const [editing, setEditing] = useState(!cur.configured);
  const [f, setF] = useState({ version: cur.version === 'v3' ? 'v3' : 'v2c', community: '', username: cur.username || '', auth_protocol: '', auth_key: '', priv_protocol: '', priv_key: '' });
  const [touched, setTouched] = useState(false);
  const mark = s.marks[`snmp:${dc.id}`];
  const busy = mark?.state === 'saving';
  const errs = f.version === 'v2c'
    ? { community: required(f.community, 'Enter the community string') }
    : {
      username: required(f.username, 'Enter the user name'),
      auth_key: f.auth_protocol ? (required(f.auth_key, 'Enter the authentication key') || vMinLen(f.auth_key, 8, 'The key')) : null,
      priv_key: f.priv_protocol ? (required(f.priv_key, 'Enter the privacy key') || vMinLen(f.priv_key, 8, 'The key')) : null,
      priv_protocol: f.priv_protocol && !f.auth_protocol ? 'Privacy needs authentication too' : null,
    };
  const valid = !Object.values(errs).some(Boolean);
  const show = (k) => touched && errs[k];
  const save = async () => {
    setTouched(true); if (!valid || busy) return;
    const body = f.version === 'v2c' ? { version: 'v2c', community: f.community } : { version: 'v3', username: f.username.trim(), auth_protocol: f.auth_protocol || null, auth_key: f.auth_key || null, priv_protocol: f.priv_protocol || null, priv_key: f.priv_key || null };
    const r = await s.saveSection(dc, 'snmp', body);
    if (r) { setEditing(false); setF((x) => ({ ...x, community: '', auth_key: '', priv_key: '' })); setTouched(false); }
  };
  return (
    <Block title="SNMP, read only" note={dc.name} right={<SaveMark mark={mark} />}>
      {cur.configured ? (
        <Held title={`SNMP ${cur.version || ''}`} sub={cur.username ? `user ${cur.username}` : 'community held'}
          note={cur.security_level ? `${LEVEL[cur.security_level] || cur.security_level}${cur.auth_protocol ? ` (${[cur.auth_protocol, cur.priv_protocol].filter(Boolean).join('/')})` : ''}` : 'secrets stored, never shown'}>
          <Act size="sm" variant="quiet" onClick={() => setEditing((e) => !e)}>{editing ? 'Cancel' : 'Replace'}</Act>
          <Act size="sm" variant="danger" disabled={busy} onClick={() => s.removeSnmp(dc)}>Remove</Act>
        </Held>
      ) : null}
      {editing ? (
        <Stack gap={16}>
          <Field label="Version" req>
            <Seg ariaLabel="SNMP version" value={f.version} onChange={(v) => { setF({ ...f, version: v }); setTouched(false); }} options={[{ key: 'v2c', label: 'v2c' }, { key: 'v3', label: 'v3' }]} />
          </Field>
          {f.version === 'v2c' ? (
            <Grid>
              <Field label="Community string" req error={show('community')}>
                <Secret value={f.community} onChange={(e) => setF({ ...f, community: e.target.value })} ariaLabel="Community string" req invalid={!!show('community')} disabled={busy} />
              </Field>
            </Grid>
          ) : (
            <Grid>
              <Field label="User name" req error={show('username')} htmlFor={`snmp-u-${dc.id}`}><Input id={`snmp-u-${dc.id}`} className={mono} value={f.username} maxLength={64} placeholder="racktrack-ro" autoComplete="off" req invalid={!!show('username')} disabled={busy} onChange={(e) => setF({ ...f, username: e.target.value })} onKeyDown={stopEnter} /></Field>
              <div />
              <Field label="Authentication" htmlFor={`snmp-a-${dc.id}`}><Select id={`snmp-a-${dc.id}`} value={f.auth_protocol} disabled={busy} onChange={(e) => setF({ ...f, auth_protocol: e.target.value, priv_protocol: e.target.value ? f.priv_protocol : '' })}>{AUTH.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</Select></Field>
              <Field label="Authentication key" req={!!f.auth_protocol} help={f.auth_protocol ? 'At least 8 characters.' : undefined} error={show('auth_key')}><Secret value={f.auth_key} onChange={(e) => setF({ ...f, auth_key: e.target.value })} ariaLabel="Authentication key" req={!!f.auth_protocol} invalid={!!show('auth_key')} disabled={busy || !f.auth_protocol} /></Field>
              <Field label="Privacy" error={show('priv_protocol')} htmlFor={`snmp-p-${dc.id}`}><Select id={`snmp-p-${dc.id}`} value={f.priv_protocol} disabled={busy || !f.auth_protocol} onChange={(e) => setF({ ...f, priv_protocol: e.target.value })}>{PRIV.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</Select></Field>
              <Field label="Privacy key" req={!!f.priv_protocol} help={f.priv_protocol ? 'At least 8 characters.' : undefined} error={show('priv_key')}><Secret value={f.priv_key} onChange={(e) => setF({ ...f, priv_key: e.target.value })} ariaLabel="Privacy key" req={!!f.priv_protocol} invalid={!!show('priv_key')} disabled={busy || !f.priv_protocol} /></Field>
            </Grid>
          )}
          <div><Act variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving' : cur.configured ? 'Replace credentials' : 'Save credentials'}</Act></div>
        </Stack>
      ) : null}
    </Block>
  );
}
