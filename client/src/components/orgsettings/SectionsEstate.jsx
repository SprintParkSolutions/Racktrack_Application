import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Field, Input, Select, Act, SaveMark, CopyRow, Secret,
  Stack, Grid, Row, Sub, Note, Empty, Err, Block, Held, cx, mono,
} from './Fields.jsx';
import {
  STEPS, browserTimezone, timezones, countries, dcHasSpoc, dcRulesAccepted, spocOf,
  progress, remaining, summaryOf, composeAddress,
  required, vEmail, vPhone, vUsername, vPassword, proposeUsername, blank, fmtDate,
} from '../../utils/orgSettings';
import { EMPTY_ORG } from '../../hooks/useOrgSettings';
import { publicOrigin } from '../../utils/api';

/* The sections of the setup: the organization, its sites, the rules and the
   review. Each one is used twice, on the first-run flow and on the settings
   view, so nothing here knows which page it is on beyond `inFlow`.

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

/* ---- What is still to do: the list the settings view shows. Each item
   opens the step that supplies it. ---- */
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
  const [f, setF] = useState(() => ({ ...EMPTY_ORG, ...blank(p), timezone: p.timezone || fallbackTz, country: p.country || '' }));
  const [touched, setTouched] = useState({});
  const saved = useRef(p);
  const zones = useMemo(() => timezones(f.timezone, fallbackTz), [f.timezone, fallbackTz]);
  const cs = useMemo(() => countries(f.country), [f.country]);
  const errs = {
    timezone: required(f.timezone, 'Select a time zone'),
    country: required(f.country, 'Select a country'),
    primary_contact_email: vEmail(f.primary_contact_email),
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
  /* The browser's time zone is saved once on arrival when the record has
     none, so what is shown is what is held. The country is never guessed. */
  useEffect(() => {
    if (s.orgId == null || has(p.timezone) || !has(f.timezone)) return;
    saved.current = { ...saved.current, timezone: f.timezone };
    s.saveOrg({ timezone: f.timezone });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (s.orgId == null) return <Empty title="No organization">This account is not linked to an organization.</Empty>;
  return (
    <Stack>
      <Grid>
        {/* The short code is made from the name by the server; it is shown
            beside the name and is not something a person types. */}
        <Field label="Organization name" span>
          <div className="os-orgname" data-testid="org-name">
            <span>{f.name}</span>
            {p.short_code ? <span className={cx('os-orgcode', mono)} title="Short code, made from the name">{p.short_code}</span> : null}
          </div>
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
        <Field label="Primary contact name" htmlFor="org-pcn">
          <Input id="org-pcn" value={f.primary_contact_name || ''} maxLength={120} placeholder="Full name" autoComplete="off" onChange={(e) => set('primary_contact_name', e.target.value)} onBlur={() => commit('primary_contact_name')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Primary contact email" error={show('primary_contact_email')} htmlFor="org-pce">
          <Input id="org-pce" type="email" inputMode="email" value={f.primary_contact_email || ''} maxLength={254} placeholder="name@company.example" autoComplete="off" invalid={!!show('primary_contact_email')} onChange={(e) => set('primary_contact_email', e.target.value)} onBlur={() => commit('primary_contact_email')} onKeyDown={stopEnter} />
        </Field>
      </Grid>
    </Stack>
  );
}

/* ---- 2. Sites ---------------------------------------------------------- */
/* First how many sites there are, then one block per site: its name and
   location, its single point of contact with the account made for them, and
   invites for the technicians who work there. A site that is only a number
   so far is a name box; naming it creates it. */
const MAX_SITES = 20;
export function SitesSection({ s, onValidity, showAll }) {
  const dcs = s.dcs;
  /* The sites not named yet, as slots with an id of their own, so typing in
     one survives another being created. The number asked for is the sites
     that exist plus these. */
  const [slots, setSlots] = useState(() => (dcs.length ? [] : [1]));
  const nextSlot = useRef(2);
  const [ok, setOk] = useState({});
  const count = dcs.length + slots.length;
  const valid = dcs.length > 0 && !slots.length && dcs.every((d) => ok[d.id] === true);
  useReport(onValidity, valid);
  useEffect(() => { s.loadMembers(); }, [s.loadMembers]); // eslint-disable-line react-hooks/exhaustive-deps
  const low = Math.max(1, dcs.length);
  const high = Math.max(MAX_SITES, low);
  const pick = (n) => setSlots((xs) => {
    const want = Math.max(0, n - dcs.length);
    if (want <= xs.length) return xs.slice(0, want);
    const more = []; while (xs.length + more.length < want) { more.push(nextSlot.current); nextSlot.current += 1; }
    return [...xs, ...more];
  });
  return (
    <Stack>
      <Grid>
        <Field label="How many sites do you have?" req htmlFor="site-count" help={dcs.length ? `${dcs.length} already added.` : undefined}>
          <Select id="site-count" value={String(Math.max(count, low))} req disabled={s.orgId == null} onChange={(e) => pick(Number(e.target.value))}>
            {Array.from({ length: high - low + 1 }, (_, i) => low + i).map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </Select>
        </Field>
      </Grid>
      {dcs.map((dc) => <SiteBlock key={dc.id} dc={dc} s={s} showAll={showAll} onValid={(v) => setOk((o) => (o[dc.id] === v ? o : { ...o, [dc.id]: v }))} />)}
      {slots.map((id, i) => <NewSite key={`new-${id}`} n={dcs.length + i + 1} s={s} showAll={showAll} onDone={() => setSlots((xs) => xs.filter((x) => x !== id))} />)}
    </Stack>
  );
}

function NewSite({ n, s, showAll, onDone }) {
  const [name, setName] = useState(''); const [adding, setAdding] = useState(false); const [tried, setTried] = useState(false);
  const can = name.trim().length >= 2;
  const mark = s.marks.datacentres;
  const failed = tried && !adding && mark?.state === 'failed' ? (mark.error?.message || 'The site could not be added') : null;
  const empty = showAll && !can ? 'Enter the site name, or choose a smaller number above' : null;
  const add = async () => {
    if (!can || adding) return;
    setAdding(true); setTried(true);
    const r = await s.addDatacentre(name.trim());
    if (r) onDone(); else setAdding(false);
  };
  return (
    <Block title={`Site ${n}`}>
      <Row kind="add">
        <Field label="Site name" req error={failed || empty} htmlFor={`site-new-${n}`}>
          <Input id={`site-new-${n}`} value={name} maxLength={120} placeholder="Rotterdam DC1" disabled={adding || s.orgId == null} req invalid={!!(failed || empty)} onChange={(e) => { setName(e.target.value); setTried(false); }} onKeyDown={onEnter(add)} />
        </Field>
        <Act variant="primary" disabled={!can || adding || s.orgId == null} onClick={add}>{adding ? 'Adding' : 'Add site'}</Act>
      </Row>
    </Block>
  );
}

/* Every key the facility section holds. This screen edits three of them;
   the section is replaced whole, so the rest ride along unchanged and what
   an older setup saved (city, provider, access notes) is not lost. */
const FAC_KEYS = ['code', 'address_line1', 'address_line2', 'city', 'region', 'postcode', 'country', 'provider', 'access_notes', 'hours'];
function SiteBlock({ dc, s, showAll, onValid }) {
  const fallback = useMemo(() => browserTimezone(), []);
  const d = dc.datacentre || {};
  const fac0 = dc.profile?.facility || {};
  const org = s.orgProfile || {};
  /* A site from before the facility section holds one address line; it is
     offered as the location. The country and the time zone start from the
     organization's, which is right for most sites and one choice away for
     the rest. */
  const [f, setF] = useState(() => ({
    address_line1: fac0.address_line1 ?? (FAC_KEYS.some((k) => has(fac0[k])) ? '' : (d.address ?? '')),
    postcode: fac0.postcode ?? '',
    country: fac0.country ?? org.country ?? '',
    timezone: d.timezone ?? org.timezone ?? fallback,
  }));
  const [touched, setTouched] = useState({});
  const savedDc = useRef({ address: d.address ?? '', timezone: d.timezone ?? '' });
  const savedFac = useRef(JSON.stringify(Object.fromEntries(FAC_KEYS.map((k) => [k, fac0[k] ?? '']))));
  const zones = useMemo(() => timezones(f.timezone, fallback), [f.timezone, fallback]);
  const cs = useMemo(() => countries(f.country), [f.country]);

  /* The SPOC: held as a contact on the site, shown from the approver when a
     site from before this screen has an approver and no contact. */
  const held = spocOf(dc);
  const ap = dc.approver;
  const [c, setC] = useState(() => ({ name: held?.name ?? ap?.username ?? '', email: held?.email ?? ap?.email ?? '', phone: held?.phone ?? '' }));
  const savedSpoc = useRef(JSON.stringify({ name: held?.name ?? '', email: held?.email ?? '', phone: held?.phone ?? '' }));

  const errs = {
    address_line1: required(f.address_line1, 'Enter the location'),
    country: required(f.country, 'Select a country'),
    timezone: required(f.timezone, 'Select a time zone'),
    spoc_name: required(c.name, 'Enter the name'),
    spoc_email: required(c.email, 'Enter the email') || vEmail(c.email),
    spoc_phone: vPhone(c.phone),
  };
  const hasSpoc = dcHasSpoc(dc);
  const valid = !Object.values(errs).some(Boolean) && hasSpoc;
  useEffect(() => { onValid(valid); }, [valid, onValid]);
  const show = (k) => (showAll || touched[k]) && errs[k];
  const touch = (...ks) => setTouched((t) => ({ ...t, ...Object.fromEntries(ks.map((k) => [k, true])) }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  /* The facility section is replaced whole; the one-line address the site
     record keeps is composed from it so the two never differ. The time zone
     rides along on the first save so a site never sits without one. */
  const commit = (fields, over = {}) => {
    const next = { ...f, ...over };
    touch(...fields);
    if (fields.some((k) => errs[k] && over[k] === undefined)) return;
    const fac = Object.fromEntries(FAC_KEYS.map((k) => [k, String((k in next ? next[k] : fac0[k]) ?? '').trim()]));
    const facJson = JSON.stringify(fac);
    if (facJson !== savedFac.current) {
      savedFac.current = facJson;
      s.saveSection(dc, 'facility', Object.fromEntries(Object.entries(fac).map(([k, v]) => [k, v === '' ? null : (k === 'country' ? v.toUpperCase() : v)])));
    }
    const body = {};
    const address = composeAddress(fac);
    if (address && address !== savedDc.current.address) body.address = address;
    if (next.timezone && !same(next.timezone, savedDc.current.timezone)) body.timezone = next.timezone;
    if (!Object.keys(body).length) return;
    savedDc.current = { ...savedDc.current, ...body };
    s.saveDatacentre(dc, body);
  };

  /* The contacts section is a list replaced whole: the SPOC goes first and
     whatever else an older setup saved there stays. */
  const commitSpoc = (k) => {
    touch(k);
    if (errs.spoc_name || errs.spoc_email || errs.spoc_phone) return;
    const spoc = { name: c.name.trim(), email: c.email.trim().toLowerCase(), phone: c.phone.trim() };
    const json = JSON.stringify(spoc);
    if (json === savedSpoc.current) return;
    savedSpoc.current = json;
    const others = (dc.profile?.contacts || NONE).filter((x) => x.role !== 'spoc');
    s.saveSection(dc, 'contacts', [{ ...spoc, role: 'spoc', phone: spoc.phone || null, hours: held?.hours ?? null, notes: held?.notes ?? null }, ...others]);
  };

  /* The account. Someone in the organization with that email already has
     one: a member of this site or an organization admin is named as they
     are, and a member of another site cannot act here, so they are refused.
     Anyone else gets a site manager account on this site, made here. Either
     way the SPOC ends up as the site's approver by user id, which is what
     the drift workflow reads. */
  const member = (s.members || NONE).find((m) => m.email && c.email && m.email.toLowerCase() === c.email.trim().toLowerCase()) || null;
  const canServe = !!member && member.active !== 0 && member.active !== false && (Number(member.tenant_id) === Number(dc.id) || member.role === 'org_admin');
  const apMember = ap?.email ? (s.members || NONE).find((m) => m.email && m.email.toLowerCase() === ap.email.toLowerCase()) : null;
  const hasAccount = !!ap?.user_id || !!apMember;
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState({ username: '', password: '' });
  const [accTouched, setAccTouched] = useState(false); const [tried, setTried] = useState(false);
  const proposed = useMemo(() => proposeUsername(c.name, c.email), [c.name, c.email]);
  const username = acc.username || proposed;
  const accErrs = {
    username: required(username, 'Enter a user name') || vUsername(username),
    password: required(acc.password, 'Enter a password') || vPassword(acc.password),
  };
  const accMark = s.marks[`spoc:${dc.id}`];
  const making = accMark?.state === 'saving' || s.marks[`people:${dc.id}`]?.state === 'saving';
  const accFailed = tried && !making && accMark?.state === 'failed' ? (accMark.error?.message || 'The account could not be created') : null;
  const showAcc = (k) => (accTouched || showAll) && accErrs[k];
  const create = async () => {
    touch('spoc_name', 'spoc_email'); setAccTouched(true);
    if (errs.spoc_name || errs.spoc_email || accErrs.username || accErrs.password || making) return;
    setTried(true);
    const r = await s.createSpocAccount(dc, { username: username.trim(), email: c.email.trim().toLowerCase(), password: acc.password });
    if (r) { setOpen(false); setAcc({ username: '', password: '' }); setAccTouched(false); setTried(false); }
  };
  const useMember = async () => {
    touch('spoc_name', 'spoc_email');
    if (errs.spoc_name || errs.spoc_email || !canServe || making) return;
    const r = await s.setApprover(dc, { user_id: Number(member.id) });
    if (r) setOpen(false);
  };
  const needsAccount = !hasAccount || open;

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

  /* The account's own failure is said beside its button, not up here. */
  const mark = [s.marks[`datacentres:${dc.id}`], s.marks[`facility:${dc.id}`], s.marks[`contacts:${dc.id}`], s.marks[`people:${dc.id}`]].filter(Boolean).sort((a, b) => b.at - a.at)[0];
  return (
    <Block title={dc.name} right={<SaveMark mark={mark} />}>
      {dc.loadError ? <Err>{dc.loadError.message}</Err> : null}
      <Grid>
        <Field label="Location" req span error={show('address_line1')} htmlFor={`site-${dc.id}-loc`}>
          <Input id={`site-${dc.id}-loc`} value={f.address_line1} maxLength={200} placeholder="12 Harbour Road, Rotterdam" autoComplete="street-address" req invalid={!!show('address_line1')} onChange={(e) => set('address_line1', e.target.value)} onBlur={() => commit(['address_line1'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Postcode" htmlFor={`site-${dc.id}-pc`}>
          <Input id={`site-${dc.id}-pc`} className={mono} value={f.postcode} maxLength={20} placeholder="3011 AA" autoComplete="postal-code" onChange={(e) => set('postcode', e.target.value)} onBlur={() => commit(['postcode'])} onKeyDown={stopEnter} />
        </Field>
        <Field label="Country" req error={show('country')} htmlFor={`site-${dc.id}-cty`}>
          <Select id={`site-${dc.id}-cty`} value={f.country} req invalid={!!show('country')} onChange={(e) => { set('country', e.target.value); commit(['country'], { country: e.target.value }); }}>
            <option value="">Select</option>
            {cs.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="Time zone" req error={show('timezone')} htmlFor={`site-${dc.id}-tz`}>
          <Select id={`site-${dc.id}-tz`} value={f.timezone} req invalid={!!show('timezone')} onChange={(e) => { const tz = e.target.value; set('timezone', tz); commit(['timezone'], { timezone: tz }); }}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
      </Grid>

      <Sub title="Site contact (SPOC)" />
      <Grid>
        <Field label="Name" req error={show('spoc_name')} htmlFor={`site-${dc.id}-sn`}>
          <Input id={`site-${dc.id}-sn`} value={c.name} maxLength={120} placeholder="Full name" autoComplete="off" req invalid={!!show('spoc_name')} onChange={(e) => setC({ ...c, name: e.target.value })} onBlur={() => commitSpoc('spoc_name')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Email" req error={show('spoc_email')} htmlFor={`site-${dc.id}-se`}>
          <Input id={`site-${dc.id}-se`} type="email" inputMode="email" value={c.email} maxLength={254} placeholder="name@company.example" autoComplete="off" req invalid={!!show('spoc_email')} onChange={(e) => setC({ ...c, email: e.target.value })} onBlur={() => commitSpoc('spoc_email')} onKeyDown={stopEnter} />
        </Field>
        <Field label="Phone" error={show('spoc_phone')} htmlFor={`site-${dc.id}-sp`}>
          <Input id={`site-${dc.id}-sp`} type="tel" inputMode="tel" value={c.phone} maxLength={40} placeholder="+31 10 000 0000" autoComplete="off" invalid={!!show('spoc_phone')} onChange={(e) => setC({ ...c, phone: e.target.value })} onBlur={() => commitSpoc('spoc_phone')} onKeyDown={stopEnter} />
        </Field>
      </Grid>
      {hasAccount ? (
        <Held title={ap.username || apMember?.username || ap.email} sub={ap.username || apMember ? (ap.email || apMember?.email) : null} note="Has an account">
          <Act size="sm" variant="quiet" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : 'Change'}</Act>
        </Held>
      ) : null}
      {needsAccount ? (
        member && !canServe ? (
          <Err>{member.username} already has an account at {member.site_name || 'another site'}. Enter someone else, or move them to this site first.</Err>
        ) : member ? (
          <Held title={member.username} sub={member.email} note="Already has an account">
            <Act size="sm" variant="primary" disabled={making} onClick={useMember} data-testid={`spoc-use-${dc.id}`}>{making ? 'Saving' : 'Make them the SPOC'}</Act>
          </Held>
        ) : (
          <Stack gap={12}>
            <Grid>
              <Field label="User name" req error={showAcc('username')} htmlFor={`site-${dc.id}-au`}>
                <Input id={`site-${dc.id}-au`} className={mono} value={username} maxLength={32} placeholder="priya.nair" autoComplete="off" spellCheck="false" req invalid={!!showAcc('username')} disabled={making} onChange={(e) => setAcc({ ...acc, username: e.target.value })} onKeyDown={stopEnter} />
              </Field>
              <Field label="Temporary password" req help="8 or more, with a capital, a small letter, a digit and a symbol." error={showAcc('password')} htmlFor={`site-${dc.id}-ap`}>
                <Secret id={`site-${dc.id}-ap`} value={acc.password} onChange={(e) => setAcc({ ...acc, password: e.target.value })} ariaLabel="Temporary password" req invalid={!!showAcc('password')} disabled={making} />
              </Field>
            </Grid>
            {accFailed ? <Err>{accFailed}</Err> : null}
            <div><Act variant="primary" disabled={making} onClick={create} data-testid={`spoc-create-${dc.id}`}>{making ? 'Creating' : 'Create account'}</Act></div>
            {showAll && !hasSpoc ? <Err>Create the account for this site's SPOC to continue.</Err> : null}
          </Stack>
        )
      ) : null}

      <Sub title="Invite technicians" />
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
  );
}

/* ---- 3. Rules ---------------------------------------------------------- */
/* One sentence and one button. The two promises in it are the product's own
   rules; accepting stamps every site. */
export const RULE = 'RackTrack changes your records only after an approval, and it never deletes a record.';
export function RulesSection({ s, onValidity }) {
  const dcs = s.dcs;
  const pending = dcs.filter((d) => !dcRulesAccepted(d));
  const valid = dcs.length > 0 && !pending.length;
  useReport(onValidity, valid);
  const [all, setAll] = useState(false);
  const accept = async () => { setAll(true); try { for (const d of pending) await s.acceptRules(d); } finally { setAll(false); } };
  const failed = dcs.filter((d) => s.marks[`rules:${d.id}`]?.state === 'failed' && !dcRulesAccepted(d));
  const when = dcs.map((d) => d.rules?.accepted_at).filter(Boolean).sort().pop();
  if (!dcs.length) return <Empty title="No site yet">Add one on the Sites step.</Empty>;
  return (
    <Stack gap={16}>
      <p className="os-rule">{RULE}</p>
      {failed.length ? <Err>Not saved for {failed.map((d) => d.name).join(', ')}. Press Accept again.</Err> : null}
      {pending.length
        ? <div><Act variant="primary" disabled={all} onClick={accept} data-testid="accept-rules">{all ? 'Accepting' : 'Accept'}</Act></div>
        : <Note>Accepted{when ? ` ${fmtDate(when)}` : ''}.</Note>}
    </Stack>
  );
}

/* ---- 4. Review --------------------------------------------------------- */
export function ReviewSection({ s, goto, onValidity }) {
  const pr = progress(s.model);
  const valid = pr.required.done === pr.required.total;
  useReport(onValidity, valid);
  return (
    <ul className="os-review">
      {STEPS.filter((st) => st.kind !== 'review').map((st) => {
        const done = pr.required.items.filter((i) => i.step === st.key).every((i) => i.done);
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
  );
}
