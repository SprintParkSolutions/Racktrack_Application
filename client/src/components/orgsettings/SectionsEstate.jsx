import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  Field, Input, Select, Textarea, Act, SaveMark, DcSwitch, CopyRow, Seg,
  Stack, Grid, Rows, Row, Sub, Note, Empty, Err, Block, Held, cx, mono, num,
} from './Fields.jsx';
import {
  STEPS, browserTimezone, timezones, countries, dcHasSpace, dcHasApprover, dcRulesAccepted,
  progress, remaining, summaryOf, composeAddress, SPACE_KINDS, CONTACT_ROLES, INDUSTRIES,
  required, vEmail, vUrl, vPhone, vShortCode, vLat, vLng, vCount, proposeCode, blank, plural, fmtDate,
} from '../../utils/orgSettings';
import { EMPTY_ORG } from '../../hooks/useOrgSettings';
import { publicOrigin } from '../../utils/api';

/* The sections that fill the estate: the organization itself, its
   datacentres, the spaces in them, the people, the rules, and the review.
   Each one is used twice, on the first-run flow and on the settings view,
   so nothing here knows which page it is on beyond `inFlow`.

   Every section saves as it goes. A text field saves when it is left, a
   choice saves when it is made, and the answer goes into the hook so the
   lists and the review read what the server holds. A section reports
   whether it is valid through `onValidity`, which is what lets Next move
   on. A mandatory field is marked with an asterisk and nothing else; its
   message appears only after Next is pressed with it empty. */

const NONE = [];
const same = (a, b) => String(a ?? '') === String(b ?? '');
const has = (v) => v != null && String(v).trim() !== '';
const stopEnter = (e) => { if (e.key === 'Enter') e.stopPropagation(); };
const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fn(); } };
function useReport(onValidity, valid) { useEffect(() => { onValidity?.(valid); }, [onValidity, valid]); }

/* ---- What is still to do: the two lists the review and the settings view
   show. Each item opens the step that supplies it. ---- */
export function RemainingList({ model, goto }) {
  const r = remaining(model);
  const item = (x, needed) => (
    <li key={x.key}><i className={cx('os-rem-dot', needed && 'req')} /><button type="button" className="os-link" onClick={() => goto(x.step)}>{x.label}</button></li>
  );
  return (
    <div className="os-rem" data-testid={r.required.length || r.optional.length ? 'remaining' : 'remaining-none'}>
      {r.required.length
        ? <div className="os-rem-g"><span className="os-rem-t">Still needed</span><ul>{r.required.map((x) => item(x, true))}</ul></div>
        : <p className="os-rem-ok">All needed items are done.</p>}
      {r.optional.length
        ? <div className="os-rem-g"><span className="os-rem-t">Not filled yet</span><ul>{r.optional.map((x) => item(x, false))}</ul></div>
        : null}
    </div>
  );
}

/* ---- 1. Organization --------------------------------------------------- */
export function OrgSection({ s, onValidity, showAll }) {
  const p = s.orgProfile || EMPTY_ORG;
  const fallbackTz = useMemo(() => browserTimezone(), []);
  const [f, setF] = useState(() => ({ ...EMPTY_ORG, ...blank(p), timezone: p.timezone || fallbackTz, country: p.country || '', short_code: p.short_code || proposeCode(p.name) }));
  const [touched, setTouched] = useState({});
  const saved = useRef(p);
  const zones = useMemo(() => timezones(f.timezone, fallbackTz), [f.timezone, fallbackTz]);
  const cs = useMemo(() => countries(f.country), [f.country]);
  const errs = {
    short_code: required(f.short_code, 'Enter a short code') || vShortCode(f.short_code),
    timezone: required(f.timezone, 'Select a time zone'),
    country: required(f.country, 'Select a country'),
    website: vUrl(f.website), phone: vPhone(f.phone), primary_contact_email: vEmail(f.primary_contact_email),
  };
  const valid = !Object.values(errs).some(Boolean) && s.orgId != null;
  useReport(onValidity, valid);
  const show = (k) => (showAll || touched[k]) && errs[k];
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  /* Saves the profile when the field being left is fine and anything
     differs from what was last sent. */
  const commit = (k, over = {}) => {
    const next = { ...f, ...over };
    setTouched((t) => ({ ...t, [k]: true }));
    if (errs[k] && over[k] === undefined) return;
    if (Object.keys(EMPTY_ORG).every((key) => same(next[key], saved.current?.[key]))) return;
    saved.current = next;
    s.saveOrg(next);
  };
  /* The defaults on screen (the browser's zone and the proposed code) are
     saved once on arrival when the record lacks them, so what is shown is
     what is held. The country is never guessed. */
  useEffect(() => {
    if (s.orgId == null) return;
    const body = {};
    if (!has(p.timezone) && has(f.timezone)) body.timezone = f.timezone;
    if (!has(p.short_code) && has(f.short_code) && !vShortCode(f.short_code)) body.short_code = f.short_code;
    if (!Object.keys(body).length) return;
    saved.current = { ...saved.current, ...body };
    s.saveOrg(body);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const logo = (file) => {
    if (!file) return;
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256; const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/png'); URL.revokeObjectURL(url);
      set('logo_data', data); commit('logo_data', { logo_data: data });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };
  if (s.orgId == null) return <Empty title="No organization">This account is not linked to an organization.</Empty>;
  return (
    <Stack>
      <Grid>
        <Field label="Organization name" span htmlFor="org-name">
          <Input id="org-name" value={f.name} readOnly autoComplete="organization" />
        </Field>
        <Field label="Short code" req help="2 to 16 capital letters, digits or hyphens." error={show('short_code')} htmlFor="org-code">
          <Input id="org-code" className={mono} value={f.short_code} maxLength={16} placeholder="NWC" req invalid={!!show('short_code')} onChange={(e) => set('short_code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} onBlur={() => commit('short_code')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Time zone" req error={show('timezone')} htmlFor="org-tz">
          <Select id="org-tz" value={f.timezone} req invalid={!!show('timezone')} onChange={(e) => { set('timezone', e.target.value); commit('timezone', { timezone: e.target.value }); }}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <Field label="Country" req error={show('country')} htmlFor="org-country">
          <Select id="org-country" value={f.country} req invalid={!!show('country')} onChange={(e) => { set('country', e.target.value); commit('country', { country: e.target.value }); }}>
            <option value="">Select</option>
            {cs.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Industry" htmlFor="org-industry">
          <Select id="org-industry" value={f.industry || ''} onChange={(e) => { set('industry', e.target.value); commit('industry', { industry: e.target.value }); }}>
            <option value="">Select</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </Field>
        <Field label="Website" error={show('website')} htmlFor="org-web">
          <Input id="org-web" type="url" inputMode="url" value={f.website || ''} maxLength={200} placeholder="https://example.com" autoComplete="url" invalid={!!show('website')} onChange={(e) => set('website', e.target.value)} onBlur={() => commit('website')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Phone" error={show('phone')} htmlFor="org-phone">
          <Input id="org-phone" type="tel" inputMode="tel" value={f.phone || ''} maxLength={40} placeholder="+31 10 000 0000" autoComplete="tel" invalid={!!show('phone')} onChange={(e) => set('phone', e.target.value)} onBlur={() => commit('phone')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Primary contact name" htmlFor="org-pcn">
          <Input id="org-pcn" value={f.primary_contact_name || ''} maxLength={120} placeholder="Full name" autoComplete="off" onChange={(e) => set('primary_contact_name', e.target.value)} onBlur={() => commit('primary_contact_name')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Primary contact email" error={show('primary_contact_email')} htmlFor="org-pce">
          <Input id="org-pce" type="email" inputMode="email" value={f.primary_contact_email || ''} maxLength={254} placeholder="name@company.example" autoComplete="off" invalid={!!show('primary_contact_email')} onChange={(e) => set('primary_contact_email', e.target.value)} onBlur={() => commit('primary_contact_email')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Logo" help="PNG, JPEG or SVG." span>
          <div className="os-logo">
            <span className="os-logo-box">{f.logo_data ? <img src={f.logo_data} alt="" /> : <Icon name="apartment" />}</span>
            <div className="os-logo-acts">
              <label className="os-file" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input')?.click(); } }}>
                {f.logo_data ? 'Replace' : 'Upload'}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { logo(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {f.logo_data ? <Act variant="quiet" onClick={() => { set('logo_data', null); commit('logo_data', { logo_data: null }); }}>Remove</Act> : null}
            </div>
          </div>
        </Field>
      </Grid>
    </Stack>
  );
}

/* ---- 2. Datacentres ---------------------------------------------------- */
export function DatacentresSection({ s, onValidity, showAll }) {
  const dcs = s.dcs;
  const [name, setName] = useState(''); const [adding, setAdding] = useState(false); const [addErr, setAddErr] = useState(null);
  const [ok, setOk] = useState({});
  const valid = dcs.length > 0 && dcs.every((d) => ok[d.id] === true);
  useReport(onValidity, valid);
  const can = name.trim().length >= 2;
  const add = async () => {
    if (!can || adding) return;
    setAdding(true); setAddErr(null);
    const r = await s.addDatacentre(name.trim());
    if (r) setName(''); else setAddErr(s.marks.datacentres?.error?.message || 'The datacentre could not be added');
    setAdding(false);
  };
  return (
    <Stack>
      {dcs.map((dc) => <DcBlock key={dc.id} dc={dc} s={s} showAll={showAll} onValid={(v) => setOk((o) => (o[dc.id] === v ? o : { ...o, [dc.id]: v }))} />)}
      <Stack gap={12}>
        <Sub title={dcs.length ? 'Add another datacentre' : 'Add a datacentre'} />
        <Row kind="add">
          <Field label="Datacentre name" req={!dcs.length} error={addErr} htmlFor="dc-name">
            <Input id="dc-name" value={name} maxLength={120} placeholder="Rotterdam DC1" disabled={adding || s.orgId == null} req={!dcs.length} invalid={!!addErr} onChange={(e) => { setName(e.target.value); setAddErr(null); }} onKeyDown={onEnter(add)} />
          </Field>
          <Act variant={dcs.length ? 'secondary' : 'primary'} disabled={!can || adding || s.orgId == null} onClick={add}>{adding ? 'Adding' : 'Add datacentre'}</Act>
        </Row>
      </Stack>
    </Stack>
  );
}

const FAC_KEYS = ['code', 'address_line1', 'address_line2', 'city', 'region', 'postcode', 'country', 'provider', 'access_notes', 'hours'];
function DcBlock({ dc, s, showAll, onValid }) {
  const fallback = useMemo(() => browserTimezone(), []);
  const d = dc.datacentre || {};
  const fac0 = dc.profile?.facility || {};
  /* A record from before the facility section holds one address line; it
     is offered as line 1 so the mandatory fields can be satisfied by
     filling in the rest, not by typing the address again. */
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(FAC_KEYS.map((k) => [k, fac0[k] ?? ''])),
    address_line1: fac0.address_line1 ?? (Object.keys(fac0).length ? '' : (d.address ?? '')),
    timezone: d.timezone ?? fallback, lat: d.lat ?? '', lng: d.lng ?? '',
  }));
  const [touched, setTouched] = useState({});
  const [geo, setGeo] = useState(null); const [locating, setLocating] = useState(false);
  const savedDc = useRef({ address: d.address ?? '', timezone: d.timezone ?? '', lat: d.lat ?? '', lng: d.lng ?? '' });
  const savedFac = useRef(JSON.stringify(Object.fromEntries(FAC_KEYS.map((k) => [k, fac0[k] ?? '']))));
  const zones = useMemo(() => timezones(f.timezone, fallback), [f.timezone, fallback]);
  const cs = useMemo(() => countries(f.country), [f.country]);
  const errs = {
    address_line1: required(f.address_line1, 'Enter the street address'),
    city: required(f.city, 'Enter the city'),
    country: required(f.country, 'Select a country'),
    timezone: required(f.timezone, 'Select a time zone'),
    lat: vLat(f.lat), lng: vLng(f.lng),
  };
  const valid = !Object.values(errs).some(Boolean);
  useEffect(() => { onValid(valid); }, [valid, onValid]);
  const show = (k) => (showAll || touched[k]) && errs[k];
  const busy = s.marks[`datacentres:${dc.id}`]?.state === 'saving' || s.marks[`facility:${dc.id}`]?.state === 'saving';
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  /* The facility section is replaced whole; the one-line address the
     datacentre record keeps is composed from it so the two never differ.
     Only what changed goes in the datacentre body, and the browser's time
     zone rides along on the first save so a datacentre never sits without
     one. */
  const commit = (fields, over = {}) => {
    const next = { ...f, ...over };
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((k) => [k, true])) }));
    if (fields.some((k) => errs[k] && over[k] === undefined)) return;
    const fac = Object.fromEntries(FAC_KEYS.map((k) => [k, String(next[k] ?? '').trim()]));
    const facJson = JSON.stringify(fac);
    if (facJson !== savedFac.current) {
      savedFac.current = facJson;
      s.saveSection(dc, 'facility', Object.fromEntries(Object.entries(fac).map(([k, v]) => [k, v === '' ? null : (k === 'country' ? v.toUpperCase() : v)])));
    }
    const body = {};
    const address = composeAddress(fac);
    if (address && address !== savedDc.current.address) body.address = address;
    ['timezone', 'lat', 'lng'].forEach((k) => { if (fields.includes(k) && !same(next[k], savedDc.current[k])) body[k] = next[k] === '' ? null : next[k]; });
    if (!savedDc.current.timezone && next.timezone && body.timezone === undefined) body.timezone = next.timezone;
    if (!Object.keys(body).length) return;
    savedDc.current = { ...savedDc.current, ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v ?? ''])) };
    s.saveDatacentre(dc, body);
  };
  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeo('This device cannot give a location.'); return; }
    setGeo(null); setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5)); const lng = Number(pos.coords.longitude.toFixed(5));
        setLocating(false); setF((x) => ({ ...x, lat, lng })); commit(['lat', 'lng'], { lat, lng });
      },
      (e) => { setLocating(false); setGeo(e?.code === 1 ? 'Location access was refused.' : 'No location is available right now.'); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };
  const mark = [s.marks[`datacentres:${dc.id}`], s.marks[`facility:${dc.id}`]].filter(Boolean).sort((a, b) => b.at - a.at)[0];
  return (
    <Block title={dc.name} right={<SaveMark mark={mark} />}>
      {dc.loadError ? <Err>{dc.loadError.message}</Err> : null}
      <Grid>
        <Field label="Facility code" htmlFor={`dc-${dc.id}-code`}>
          <Input id={`dc-${dc.id}-code`} className={mono} value={f.code} maxLength={40} placeholder="RTM-1" disabled={busy} onChange={(e) => set('code', e.target.value)} onBlur={() => commit(['code'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Provider" htmlFor={`dc-${dc.id}-prov`}>
          <Input id={`dc-${dc.id}-prov`} value={f.provider} maxLength={120} placeholder="Equinix" disabled={busy} onChange={(e) => set('provider', e.target.value)} onBlur={() => commit(['provider'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Address line 1" req span error={show('address_line1')} htmlFor={`dc-${dc.id}-a1`}>
          <Input id={`dc-${dc.id}-a1`} value={f.address_line1} maxLength={200} placeholder="12 Harbour Road" autoComplete="address-line1" disabled={busy} req invalid={!!show('address_line1')} onChange={(e) => set('address_line1', e.target.value)} onBlur={() => commit(['address_line1'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Address line 2" span htmlFor={`dc-${dc.id}-a2`}>
          <Input id={`dc-${dc.id}-a2`} value={f.address_line2} maxLength={200} placeholder="Building 3, floor 2" autoComplete="address-line2" disabled={busy} onChange={(e) => set('address_line2', e.target.value)} onBlur={() => commit(['address_line2'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="City" req error={show('city')} htmlFor={`dc-${dc.id}-city`}>
          <Input id={`dc-${dc.id}-city`} value={f.city} maxLength={120} placeholder="Rotterdam" autoComplete="address-level2" disabled={busy} req invalid={!!show('city')} onChange={(e) => set('city', e.target.value)} onBlur={() => commit(['city'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Region" htmlFor={`dc-${dc.id}-reg`}>
          <Input id={`dc-${dc.id}-reg`} value={f.region} maxLength={120} placeholder="Zuid-Holland" autoComplete="address-level1" disabled={busy} onChange={(e) => set('region', e.target.value)} onBlur={() => commit(['region'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Postcode" htmlFor={`dc-${dc.id}-pc`}>
          <Input id={`dc-${dc.id}-pc`} className={mono} value={f.postcode} maxLength={20} placeholder="3011 AA" autoComplete="postal-code" disabled={busy} onChange={(e) => set('postcode', e.target.value)} onBlur={() => commit(['postcode'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Country" req error={show('country')} htmlFor={`dc-${dc.id}-cty`}>
          <Select id={`dc-${dc.id}-cty`} value={f.country} disabled={busy} req invalid={!!show('country')} onChange={(e) => { set('country', e.target.value); commit(['country'], { country: e.target.value }); }}>
            <option value="">Select</option>
            {cs.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Time zone" req error={show('timezone')} htmlFor={`dc-${dc.id}-tz`}>
          <Select id={`dc-${dc.id}-tz`} value={f.timezone} disabled={busy} req invalid={!!show('timezone')} onChange={(e) => { const tz = e.target.value; set('timezone', tz); commit(['timezone'], { timezone: tz }); }}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <Field label="Coordinates" help={geo || undefined} error={show('lat') || show('lng')}>
          <div className="os-coords">
            <Input value={f.lat} inputMode="decimal" placeholder="51.92250" aria-label="Latitude" disabled={busy} invalid={!!show('lat')} onChange={(e) => set('lat', e.target.value)} onBlur={() => commit(['lat', 'lng'])} onKeyDown={stopEnter} />
            <Input value={f.lng} inputMode="decimal" placeholder="4.47917" aria-label="Longitude" disabled={busy} invalid={!!show('lng')} onChange={(e) => set('lng', e.target.value)} onBlur={() => commit(['lat', 'lng'])} onKeyDown={stopEnter} />
            <Act disabled={busy || locating} onClick={locate}>{locating ? 'Locating' : 'Use my location'}</Act>
          </div>
        </Field>
        <Field label="Opening hours" htmlFor={`dc-${dc.id}-hrs`}>
          <Input id={`dc-${dc.id}-hrs`} value={f.hours} maxLength={120} placeholder="Mon to Fri, 08:00 to 18:00" disabled={busy} onChange={(e) => set('hours', e.target.value)} onBlur={() => commit(['hours'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Access notes" span htmlFor={`dc-${dc.id}-acc`}>
          <Textarea id={`dc-${dc.id}-acc`} value={f.access_notes} maxLength={1000} placeholder="Sign in at reception." disabled={busy} onChange={(e) => set('access_notes', e.target.value)} onBlur={() => commit(['access_notes'])} />
        </Field>
      </Grid>
    </Block>
  );
}

/* ---- 3. Spaces and racks ---------------------------------------------- */
export function SpacesSection({ s, onValidity }) {
  const dcs = s.dcs;
  const valid = dcs.length > 0 && dcs.every(dcHasSpace);
  useReport(onValidity, valid);
  if (!dcs.length) return <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty>;
  return <Stack>{dcs.map((dc) => <SpacesBlock key={dc.id} dc={dc} s={s} />)}</Stack>;
}

const EMPTY_SPACE = { name: '', kind: '', floor: '', room: '', row: '', facility_id: '', rack_count: '' };
function SpacesBlock({ dc, s }) {
  const [n, setN] = useState(EMPTY_SPACE); const [more, setMore] = useState(false);
  const busy = s.marks[`spaces:${dc.id}`]?.state === 'saving';
  const countErr = vCount(n.rack_count);
  const can = n.name.trim().length > 0 && has(n.rack_count) && !countErr;
  const setN1 = (k, v) => setN((x) => ({ ...x, [k]: v }));
  const add = async () => {
    if (busy || !can) return;
    const body = { name: n.name.trim(), rack_count: Number(n.rack_count) };
    ['kind', 'floor', 'room', 'row', 'facility_id'].forEach((k) => { if (has(n[k])) body[k] = String(n[k]).trim(); });
    const r = await s.addSpace(dc, body);
    if (r) { setN(EMPTY_SPACE); setMore(false); }
  };
  const k = dc.completeness?.counts;
  return (
    <Block title={dc.name} note={k ? `${plural(k.spaces, 'space')}, ${plural(k.racksTyped, 'rack')}` : null} right={<SaveMark mark={s.marks[`spaces:${dc.id}`]} />}>
      {!dc.spaces.length ? <Empty title="No spaces yet" /> : null}
      <Rows>{dc.spaces.map((sp) => <SpaceRow key={sp.id} dc={dc} sp={sp} s={s} busy={busy} />)}</Rows>
      <div className="os-addspace">
        <Sub title="Add a space" />
        <Row kind="addSpace">
          <Field label="Space name" req htmlFor={`sp-${dc.id}-name`}>
            <Input id={`sp-${dc.id}-name`} value={n.name} maxLength={120} placeholder="Hall 1" disabled={busy} req onChange={(e) => setN1('name', e.target.value)} onKeyDown={onEnter(add)} />
          </Field>
          <Field label="Kind" htmlFor={`sp-${dc.id}-kind`}>
            <Select id={`sp-${dc.id}-kind`} value={n.kind} disabled={busy} onChange={(e) => setN1('kind', e.target.value)}>
              <option value="">Select</option>
              {SPACE_KINDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
          </Field>
          <Field label="Racks" req error={countErr} htmlFor={`sp-${dc.id}-n`}>
            <Input id={`sp-${dc.id}-n`} className={num} type="number" inputMode="numeric" min="0" max="100000" value={n.rack_count} placeholder="12" disabled={busy} req invalid={!!countErr} onChange={(e) => setN1('rack_count', e.target.value)} onKeyDown={onEnter(add)} />
          </Field>
          <Act variant="primary" disabled={busy || !can} onClick={add}>Add space</Act>
        </Row>
        {more ? (
          <Grid>
            <Field label="Floor" htmlFor={`sp-${dc.id}-fl`}><Input id={`sp-${dc.id}-fl`} value={n.floor} maxLength={40} placeholder="2" disabled={busy} onChange={(e) => setN1('floor', e.target.value)} onKeyDown={onEnter(add)} /></Field>
            <Field label="Room" htmlFor={`sp-${dc.id}-rm`}><Input id={`sp-${dc.id}-rm`} value={n.room} maxLength={40} placeholder="2.14" disabled={busy} onChange={(e) => setN1('room', e.target.value)} onKeyDown={onEnter(add)} /></Field>
            <Field label="Row" htmlFor={`sp-${dc.id}-rw`}><Input id={`sp-${dc.id}-rw`} value={n.row} maxLength={40} placeholder="A" disabled={busy} onChange={(e) => setN1('row', e.target.value)} onKeyDown={onEnter(add)} /></Field>
            <Field label="Facility ID" htmlFor={`sp-${dc.id}-fac`}><Input id={`sp-${dc.id}-fac`} className={mono} value={n.facility_id} maxLength={40} placeholder="H1" disabled={busy} onChange={(e) => setN1('facility_id', e.target.value)} onKeyDown={onEnter(add)} /></Field>
          </Grid>
        ) : <div><Act size="sm" variant="quiet" onClick={() => setMore(true)}>More details</Act></div>}
      </div>
    </Block>
  );
}
function SpaceRow({ dc, sp, s, busy }) {
  const [f, setF] = useState({ name: sp.name ?? '', kind: sp.kind ?? '', floor: sp.floor ?? '', room: sp.room ?? '', row: sp.row ?? '', facility_id: sp.facility_id ?? '', rack_count: sp.rack_count ?? '' });
  const [open, setOpen] = useState(false);
  const commit = (k) => {
    const v = f[k];
    if (k === 'rack_count') { if (vCount(v)) return; const nv = v === '' ? null : Number(v); if (nv !== (sp.rack_count ?? null)) s.patchSpace(dc, sp, { rack_count: nv }); return; }
    if (k === 'name' && !String(v).trim()) { setF((x) => ({ ...x, name: sp.name })); return; }
    if (!same(v, sp[k] ?? '')) s.patchSpace(dc, sp, { [k]: String(v).trim() || null });
  };
  const details = [sp.floor && `Floor ${sp.floor}`, sp.room && `Room ${sp.room}`, sp.row && `Row ${sp.row}`, sp.facility_id && sp.facility_id].filter(Boolean).join(', ');
  return (
    <div className={cx('os-space', open && 'open')} style={sp.depth ? { marginLeft: sp.depth * 16 } : undefined}>
      <Row kind="space">
        <Input value={f.name} maxLength={120} aria-label="Space name" disabled={busy} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => commit('name')} onKeyDown={stopEnter} />
        <div className="os-racks">
          <Input className={num} type="number" inputMode="numeric" min="0" max="100000" value={f.rack_count} aria-label={`Racks in ${sp.name}`} disabled={busy} invalid={!!vCount(f.rack_count)} onChange={(e) => setF({ ...f, rack_count: e.target.value })} onBlur={() => commit('rack_count')} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); e.currentTarget.blur(); } }} />
          <span>racks</span>
        </div>
        <Act size="sm" variant="quiet" aria-label={`Remove ${sp.name}`} disabled={busy} onClick={() => s.removeSpace(dc, sp)}>Remove</Act>
      </Row>
      <button type="button" className="os-space-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{sp.kind ? SPACE_KINDS.find((x) => x.key === sp.kind)?.label || sp.kind : 'No kind'}{details ? `, ${details}` : ''}</span>
        <Icon name="expand_more" />
      </button>
      {open ? (
        <Grid className="os-space-det">
          <Field label="Kind"><Select value={f.kind} aria-label="Kind" disabled={busy} onChange={(e) => { setF({ ...f, kind: e.target.value }); s.patchSpace(dc, sp, { kind: e.target.value || null }); }}><option value="">Select</option>{SPACE_KINDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select></Field>
          <Field label="Facility ID"><Input className={mono} value={f.facility_id} maxLength={40} aria-label={`Facility ID of ${sp.name}`} disabled={busy} onChange={(e) => setF({ ...f, facility_id: e.target.value })} onBlur={() => commit('facility_id')} onKeyDown={stopEnter} /></Field>
          <Field label="Floor"><Input value={f.floor} maxLength={40} aria-label="Floor" disabled={busy} onChange={(e) => setF({ ...f, floor: e.target.value })} onBlur={() => commit('floor')} onKeyDown={stopEnter} /></Field>
          <Field label="Room"><Input value={f.room} maxLength={40} aria-label="Room" disabled={busy} onChange={(e) => setF({ ...f, room: e.target.value })} onBlur={() => commit('room')} onKeyDown={stopEnter} /></Field>
          <Field label="Row"><Input value={f.row} maxLength={40} aria-label="Row" disabled={busy} onChange={(e) => setF({ ...f, row: e.target.value })} onBlur={() => commit('row')} onKeyDown={stopEnter} /></Field>
        </Grid>
      ) : null}
    </div>
  );
}

/* ---- 4. People --------------------------------------------------------- */
export function PeopleSection({ s, onValidity }) {
  const dcs = s.dcs;
  const [dcId, setDcId] = useState(dcs[0]?.id ?? null);
  const dc = dcs.find((d) => d.id === dcId) || dcs[0] || null;
  const valid = dcs.length > 0 && dcs.every(dcHasApprover);
  useReport(onValidity, valid);
  useEffect(() => { s.loadMembers(); }, [s.loadMembers]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!dc) return <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty>;
  return (
    <Stack>
      <DcSwitch dcs={dcs} value={dc.id} onChange={setDcId} tone={(d) => (dcHasApprover(d) ? 'ok' : 'warn')} />
      <PeopleBlock key={dc.id} dc={dc} s={s} />
    </Stack>
  );
}

const SLOTS = CONTACT_ROLES.filter((r) => ['on_site', 'escalation', 'facilities', 'security'].includes(r.key));
const blankContact = (role, k) => ({ _k: k, name: '', role, email: '', phone: '', hours: '', notes: '' });
function PeopleBlock({ dc, s }) {
  const members = s.members;
  const eligible = (members || NONE).filter((m) => m.active !== 0 && m.active !== false && (Number(m.tenant_id) === Number(dc.id) || m.role === 'org_admin'));
  const [open, setOpen] = useState(!dc.approver);
  const [pick, setPick] = useState(''); const [mail, setMail] = useState(''); const [mailT, setMailT] = useState(false);
  const cur = dc.approver;
  const mailErr = mailT ? (required(mail, 'Enter an email or select a member') || vEmail(mail)) : null;
  const mark = s.marks[`people:${dc.id}`];
  const busy = mark?.state === 'saving';
  const choose = async (id) => { setPick(id); if (!id) return; const r = await s.setApprover(dc, { user_id: Number(id) }); if (r) { setOpen(false); setPick(''); } };
  const byMail = async () => {
    setMailT(true);
    const v = mail.trim(); if (!v || vEmail(v)) return;
    const r = await s.setApprover(dc, { email: v.toLowerCase() }); if (r) { setOpen(false); setMail(''); setMailT(false); }
  };

  /* Contacts: the four named slots first, then anything else. The rows are
     the truth while the section is open; every change writes the whole
     list, and a row with no name and no email is not sent. */
  const [contacts, setContacts] = useState(() => {
    const held = (dc.profile?.contacts || NONE).map((c, i) => ({ ...blankContact('on_site', i + 1), ...blank(c) }));
    const out = [...held]; let k = held.length + 1;
    SLOTS.forEach((r) => { if (!out.some((c) => c.role === r.key)) out.push(blankContact(r.key, k++)); });
    return out;
  });
  const [nextK, setNextK] = useState(contacts.length + 1);
  const send = (list) => s.saveSection(dc, 'contacts', list.filter((c) => c.name.trim() || c.email.trim()).map((c) => ({ name: c.name.trim(), role: c.role, email: c.email.trim().toLowerCase(), phone: c.phone, hours: c.hours, notes: c.notes })));
  const setC = (k, patch) => setContacts((xs) => xs.map((c) => (c._k === k ? { ...c, ...patch } : c)));
  const addC = () => { setContacts((xs) => [...xs, blankContact('vendor', nextK)]); setNextK((n) => n + 1); };
  const dropC = (k) => { const list = contacts.filter((c) => c._k !== k); setContacts(list); send(list); };
  const cErr = (c) => (c.email && vEmail(c.email)) || (c.phone && vPhone(c.phone)) || null;
  const isSlot = (c) => SLOTS.some((r) => r.key === c.role) && contacts.filter((x) => x.role === c.role).indexOf(c) === 0;
  const filled = (dc.profile?.contacts || NONE).length;

  /* Invites through the same route the console uses. */
  const [invMail, setInvMail] = useState(''); const [inviting, setInviting] = useState(false); const [invErr, setInvErr] = useState(null); const [links, setLinks] = useState([]);
  const invite = async () => {
    const v = invMail.trim(); const e = required(v, 'Enter an email') || vEmail(v);
    if (e) { setInvErr(e); return; }
    setInviting(true); setInvErr(null);
    try {
      const r = await s.invite(dc, v.toLowerCase()); const i = r.invite || {};
      const path = i.path || (i.code ? `/invite/${i.code}` : null);
      if (!path) throw new Error('The server did not return an invite link');
      setLinks((l) => [{ email: i.email || v, url: `${publicOrigin()}${path}`, expires: i.expires_at }, ...l]); setInvMail('');
    } catch (x) { setInvErr(x.message); }
    setInviting(false);
  };
  return (
    <Stack>
      <Block title="Approver" note={dc.name} right={<SaveMark mark={mark} />}>
        {cur ? (
          <Held title={cur.username || cur.email} sub={cur.username && cur.email ? cur.email : null}>
            <Act size="sm" variant="quiet" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : 'Change'}</Act>
          </Held>
        ) : null}
        {open ? (
          <Grid>
            <Field label="Member" req={!cur} htmlFor={`ap-${dc.id}-pick`}>
              <Select id={`ap-${dc.id}-pick`} value={pick} disabled={busy || members === null || !eligible.length} req={!cur} onChange={(e) => choose(e.target.value)}>
                <option value="">{members === null ? 'Loading' : eligible.length ? 'Select' : 'No members yet'}</option>
                {eligible.map((m) => <option key={m.id} value={String(m.id)}>{m.username}{m.email ? ` (${m.email})` : ''}{m.role === 'org_admin' ? ', org admin' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Or enter an email" error={mailErr} htmlFor={`ap-${dc.id}-mail`}>
              <Input id={`ap-${dc.id}-mail`} type="email" inputMode="email" value={mail} placeholder="approver@company.example" autoComplete="off" disabled={busy} invalid={!!mailErr} onChange={(e) => { setMail(e.target.value); setMailT(false); }} onBlur={() => { if (mail.trim()) byMail(); }} onKeyDown={onEnter(byMail)} />
            </Field>
          </Grid>
        ) : null}
      </Block>

      <Block title="Contacts" note={filled ? plural(filled, 'contact') : null} right={<SaveMark mark={s.marks[`contacts:${dc.id}`]} />}>
        <Rows>
          {contacts.map((c) => {
            const slot = isSlot(c);
            const role = CONTACT_ROLES.find((r) => r.key === c.role);
            return (
              <div key={c._k} className="os-contact">
                <div className="os-contact-h">
                  {slot ? <b>{role?.label}</b> : (
                    <Select value={c.role} aria-label="Contact role" onChange={(e) => { const list = contacts.map((x) => (x._k === c._k ? { ...x, role: e.target.value } : x)); setContacts(list); send(list); }}>
                      {CONTACT_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </Select>
                  )}
                  {!slot ? <Act size="sm" variant="quiet" aria-label="Remove contact" onClick={() => dropC(c._k)}>Remove</Act> : null}
                </div>
                <Row kind="contact">
                  <Field label="Name"><Input value={c.name} maxLength={120} placeholder="Full name" aria-label={`${role?.label || 'Contact'} name`} onChange={(e) => setC(c._k, { name: e.target.value })} onBlur={() => send(contacts)} onKeyDown={stopEnter} /></Field>
                  <Field label="Email" error={c.email && vEmail(c.email)}><Input type="email" inputMode="email" value={c.email} maxLength={254} placeholder="name@company.example" aria-label={`${role?.label || 'Contact'} email`} invalid={!!(c.email && vEmail(c.email))} onChange={(e) => setC(c._k, { email: e.target.value })} onBlur={() => { if (!cErr(c)) send(contacts); }} onKeyDown={stopEnter} /></Field>
                  <Field label="Phone" error={c.phone && vPhone(c.phone)}><Input type="tel" inputMode="tel" value={c.phone} maxLength={40} placeholder="+31 10 000 0000" aria-label={`${role?.label || 'Contact'} phone`} invalid={!!(c.phone && vPhone(c.phone))} onChange={(e) => setC(c._k, { phone: e.target.value })} onBlur={() => { if (!cErr(c)) send(contacts); }} onKeyDown={stopEnter} /></Field>
                  <Field label="Hours"><Input value={c.hours} maxLength={120} placeholder="Mon to Fri, 08:00 to 18:00" aria-label={`${role?.label || 'Contact'} hours`} onChange={(e) => setC(c._k, { hours: e.target.value })} onBlur={() => send(contacts)} onKeyDown={stopEnter} /></Field>
                </Row>
              </div>
            );
          })}
        </Rows>
        <div><Act size="sm" onClick={addC}>Add contact</Act></div>
      </Block>

      <Block title="Invite technicians">
        <Row kind="add">
          <Field label="Work email" error={invErr} htmlFor={`inv-${dc.id}`}>
            <Input id={`inv-${dc.id}`} type="email" inputMode="email" value={invMail} placeholder="technician@company.example" autoComplete="off" disabled={inviting} invalid={!!invErr} onChange={(e) => { setInvMail(e.target.value); setInvErr(null); }} onKeyDown={onEnter(invite)} />
          </Field>
          <Act disabled={inviting || !invMail.trim()} onClick={invite}>{inviting ? 'Creating' : 'Create invite link'}</Act>
        </Row>
        {links.map((l) => (
          <Stack key={l.url} gap={6}>
            <Note>Invite for <b>{l.email}</b>{l.expires ? `, valid until ${fmtDate(l.expires)}` : ''}.</Note>
            <CopyRow value={l.url} />
          </Stack>
        ))}
      </Block>
    </Stack>
  );
}

/* ---- 9. Rules ---------------------------------------------------------- */
export const RULES = [
  { t: 'Approve before write', p: 'Nothing is written to your records until the approver agrees.' },
  { t: 'Never delete', p: 'RackTrack adds and updates records. It never removes one.' },
  { t: 'Tickets go to the rack contact, then the site contact', p: 'Escalation next, when one is named.' },
  // The line under this rule used to be about 42U racks, which is nothing to do
  // with how long photos are kept - the rule above it and the sentence below it
  // said two different things. Both facts are still settable in Options below
  // ("Photo retention", "Default rack height"), which is what this now points at.
  { t: 'Photos are kept 90 days', p: 'You can change this under Options.' },
];
export function RulesSection({ s, onValidity, inFlow }) {
  const dcs = s.dcs;
  const pending = dcs.filter((d) => !dcRulesAccepted(d));
  const valid = dcs.length > 0 && !pending.length;
  useReport(onValidity, valid);
  const [all, setAll] = useState(false);
  const accept = async () => { setAll(true); try { for (const d of pending) await s.acceptRules(d); } finally { setAll(false); } };
  const failed = dcs.filter((d) => s.marks[`rules:${d.id}`]?.state === 'failed');
  return (
    <Stack>
      <ol className="os-rules">
        {RULES.map((r) => <li key={r.t}><b>{r.t}</b><p>{r.p}</p></li>)}
      </ol>
      {!dcs.length ? <Empty title="No datacentre yet">Add one on the Datacentres step.</Empty> : (
        <Block title="Acceptance" note={dcs.length > 1 ? 'per datacentre' : dcs[0].name}
          right={pending.length ? <Act variant="primary" disabled={all} onClick={accept} data-testid="accept-rules">{all ? 'Accepting' : dcs.length > 1 ? 'Accept for all' : 'Accept'}</Act> : null}>
          {dcs.length > 1 || failed.length ? (
            <ul className="os-review">
              {dcs.map((d) => {
                const ok = dcRulesAccepted(d); const m = s.marks[`rules:${d.id}`];
                return (
                  <li key={d.id}>
                    <span className={cx('os-st', ok && 'ok')} />
                    <b>{d.name}</b>
                    <span className="os-what">{ok ? `Accepted ${d.rules?.accepted_at ? fmtDate(d.rules.accepted_at) : ''}` : m?.state === 'failed' ? <Err>{m.error?.message || 'Not saved'}</Err> : 'Not accepted'}</span>
                    {!ok ? <Act size="sm" disabled={all || m?.state === 'saving'} onClick={() => s.acceptRules(d)}>{m?.state === 'saving' ? 'Accepting' : 'Accept'}</Act> : null}
                  </li>
                );
              })}
            </ul>
          ) : <Note>{pending.length ? 'Not accepted yet.' : `Accepted ${dcs[0].rules?.accepted_at ? fmtDate(dcs[0].rules.accepted_at) : ''}.`}</Note>}
        </Block>
      )}
      {!inFlow ? dcs.filter(dcRulesAccepted).map((d) => <RuleOptions key={d.id} dc={d} s={s} many={dcs.length > 1} />) : null}
    </Stack>
  );
}

const ROUTES = [{ key: 'rack_then_site', label: 'Rack contact, then site contact' }, { key: 'rack_only', label: 'Rack contact only' }, { key: 'site_only', label: 'Site contact only' }];
function RuleOptions({ dc, s, many }) {
  const r = dc.rules || {};
  const [f, setF] = useState({ ticket_route: r.ticket_route || 'rack_then_site', photo_retention_days: r.photo_retention_days ?? 90, default_u_height: r.default_u_height ?? 42, u_from_bottom: r.u_from_bottom !== false });
  const saved = useRef(f);
  const busy = s.marks[`rules:${dc.id}`]?.state === 'saving';
  const errs = {
    photo_retention_days: vCount(f.photo_retention_days, 3650) || (Number(f.photo_retention_days) < 1 ? 'At least 1 day' : null),
    default_u_height: vCount(f.default_u_height, 100) || (Number(f.default_u_height) < 1 ? 'At least 1U' : null),
  };
  const send = (next) => {
    if (Object.values(errs).some(Boolean)) return;
    if (JSON.stringify(next) === JSON.stringify(saved.current)) return;
    saved.current = next;
    s.saveRules(dc, { ticket_route: next.ticket_route, photo_retention_days: Number(next.photo_retention_days), default_u_height: Number(next.default_u_height), u_from_bottom: !!next.u_from_bottom });
  };
  const setNow = (patch) => { const next = { ...f, ...patch }; setF(next); send(next); };
  return (
    <Block title="Options" note={many ? dc.name : null} right={<SaveMark mark={s.marks[`rules:${dc.id}`]} />}>
      <Grid>
        <Field label="Tickets go to" htmlFor={`rr-${dc.id}`}>
          <Select id={`rr-${dc.id}`} value={f.ticket_route} disabled={busy} onChange={(e) => setNow({ ticket_route: e.target.value })}>{ROUTES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>
        </Field>
        <Field label="Photo retention" help="Days, 1 to 3650." error={errs.photo_retention_days} htmlFor={`rp-${dc.id}`}>
          <Input id={`rp-${dc.id}`} className={num} type="number" inputMode="numeric" min="1" max="3650" value={f.photo_retention_days} disabled={busy} invalid={!!errs.photo_retention_days} onChange={(e) => setF({ ...f, photo_retention_days: e.target.value })} onBlur={() => send(f)} onKeyDown={stopEnter} />
        </Field>
        <Field label="Default rack height" help="Rack units, 1 to 100." error={errs.default_u_height} htmlFor={`ru-${dc.id}`}>
          <Input id={`ru-${dc.id}`} className={num} type="number" inputMode="numeric" min="1" max="100" value={f.default_u_height} disabled={busy} invalid={!!errs.default_u_height} onChange={(e) => setF({ ...f, default_u_height: e.target.value })} onBlur={() => send(f)} onKeyDown={stopEnter} />
        </Field>
        <Field label="Rack units are counted">
          <Seg ariaLabel="U counting" value={f.u_from_bottom ? 'bottom' : 'top'} disabled={busy} onChange={(k) => setNow({ u_from_bottom: k === 'bottom' })} options={[{ key: 'bottom', label: 'From the bottom' }, { key: 'top', label: 'From the top' }]} />
        </Field>
      </Grid>
    </Block>
  );
}

/* ---- 10. Review -------------------------------------------------------- */
export function ReviewSection({ s, goto, onValidity }) {
  const pr = progress(s.model);
  const valid = pr.required.done === pr.required.total;
  useReport(onValidity, valid);
  return (
    <Stack>
      <RemainingList model={s.model} goto={goto} />
      <Stack gap={8}>
        <Sub title="Summary" />
        <ul className="os-review">
          {STEPS.filter((st) => st.kind !== 'review').map((st) => {
            const done = st.kind === 'required' ? pr.required.items.find((i) => i.step === st.key)?.done : pr.optional.items.some((i) => i.step === st.key && i.done);
            return (
              <li key={st.key}>
                <span className={cx('os-st', done && 'ok')} />
                <b>{st.title}</b>
                <span className="os-what">{summaryOf(st.key, s.model)}</span>
                <Act size="sm" variant="quiet" onClick={() => goto(st.key)}>Edit</Act>
              </li>
            );
          })}
        </ul>
      </Stack>
    </Stack>
  );
}
