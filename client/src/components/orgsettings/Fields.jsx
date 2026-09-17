import { forwardRef, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import s from './Fields.module.css';

/* The controls the Organization settings sections are built from. The flow
   and the settings view share them, so a field looks the same on first run
   and on the day it is edited.

   Flat and bordered throughout: white controls with a 1px edge, no wells and
   no shadows. index.css sinks every input in the app; the .ctl rules in
   Fields.module.css outrank that inside these screens and nowhere else.

   Class names avoid the substrings index.css restyles (card, panel, tile,
   header, badge, chip, pill, btn, button, field, input, select, tab, bg,
   title, heading, modal, dialog, sheet, surface). */

export const cx = (...xs) => xs.filter(Boolean).join(' ');

/* The one glyph the icon set does not carry. */
const G = {
  eye: <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
};
export function Glyph({ name, size = 16, stroke = 1.9, className }) {
  const p = G[name];
  if (!p) return <Icon name={name} className={className} style={{ fontSize: size }} />;
  return (
    <svg className={cx('appIcon', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{p}</svg>
  );
}

/* A labelled field. A mandatory field carries a red asterisk after its
   label; an optional one carries nothing. The message under the control
   replaces the help line while there is one. */
export function Field({ label, req, help, error, children, span, htmlFor, className }) {
  return (
    <div className={cx(s.f, span && s.span2, className)}>
      {label ? <label className={s.lbl} htmlFor={htmlFor}>{label}{req ? <span className={s.star} aria-hidden="true">*</span> : null}</label> : null}
      {children}
      {error ? <span className={s.err} role="alert">{error}</span> : help ? <span className={s.help}>{help}</span> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ invalid, req, className, ...p }, ref) {
  return <input ref={ref} className={cx(s.ctl, invalid && s.invalid, className)} aria-invalid={invalid || undefined} aria-required={req ? true : undefined} {...p} />;
});
export function Select({ invalid, req, className, children, ...p }) {
  return <select className={cx(s.ctl, s.sel, invalid && s.invalid, className)} aria-invalid={invalid || undefined} aria-required={req ? true : undefined} {...p}>{children}</select>;
}
export function Textarea({ invalid, req, className, ...p }) {
  return <textarea className={cx(s.ctl, s.ta, invalid && s.invalid, className)} aria-invalid={invalid || undefined} aria-required={req ? true : undefined} {...p} />;
}
export const mono = s.mono; export const num = s.num;

/* Buttons. Primary is solid ink, secondary is white with a 1px edge, quiet
   is text, danger is red text. One primary per screen, no icons. */
export function Act({ variant = 'secondary', size, children, className, type = 'button', ...rest }) {
  return <button type={type} className={cx(s.act, s[variant], size && s[size], className)} {...rest}>{children}</button>;
}

/* The quiet mark beside a section: what the last write did. */
export function SaveMark({ mark }) {
  if (!mark) return null;
  if (mark.state === 'saving') return <span className={s.save} role="status">Saving</span>;
  if (mark.state === 'saved') return <span className={s.save} role="status">Saved</span>;
  return <span className={cx(s.save, s.failed)} role="alert">{mark.error?.status === 403 ? 'Your role cannot change this' : mark.error?.message || 'Not saved'}</span>;
}

/* Radio or checkbox rows: one decision, one option per row. */
export function Choice({ options, value, onChange, multi, columns, disabled }) {
  const sel = (k) => (multi ? (value || []).includes(k) : value === k);
  const pick = (k) => { if (!multi) return onChange(k); const cur = value || []; return onChange(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]); };
  return (
    <div className={cx(s.choice, columns && s[`c${columns}`])} role={multi ? 'group' : 'radiogroup'}>
      {options.map((o) => (
        <button type="button" key={o.key} role={multi ? 'checkbox' : 'radio'} aria-checked={sel(o.key)} disabled={disabled} className={cx(s.optc, sel(o.key) && s.on)} onClick={() => pick(o.key)}>
          <i className={multi ? s.box : s.dot}>{sel(o.key) && multi ? <Icon name="check" /> : null}</i>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* A segmented control. */
export function Seg({ options, value, onChange, disabled, ariaLabel }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => <button type="button" key={o.key} role="radio" aria-checked={o.key === value} disabled={disabled} className={cx(o.key === value && s.on)} onClick={() => onChange(o.key)}>{o.label}</button>)}
    </div>
  );
}

/* Which datacentre a per-datacentre section is about. Hidden with one. */
export function DcSwitch({ dcs, value, onChange, tone }) {
  if (!dcs || dcs.length < 2) return null;
  return (
    <div className={s.dcsw} role="tablist" aria-label="Datacentre">
      {dcs.map((d) => (
        <button type="button" role="tab" aria-selected={d.id === value} key={d.id} className={cx(d.id === value && s.on)} onClick={() => onChange(d.id)}>
          {tone ? <i className={cx(s.dcdot, tone(d) && s[`dcdot_${tone(d)}`])} /> : null}{d.name}
        </button>
      ))}
    </div>
  );
}

/* Tags: ranges, models, makes. Enter or a comma adds, Backspace removes the
   last, and a bad value is refused beside the box rather than swallowed. */
export function TagBox({ value = [], onChange, validate, placeholder, suggestions = [], disabled, isMono, ariaLabel, normalise }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(null); const ref = useRef(null);
  const add = (raw) => {
    const v = normalise ? normalise(String(raw || '').trim()) : String(raw || '').trim();
    if (!v) return false;
    const e = validate ? validate(v) : null;
    if (e) { setErr(e); return false; }
    if (!value.includes(v)) onChange([...value, v]);
    setText(''); setErr(null); return true;
  };
  const hits = text ? suggestions.filter((x) => x.toLowerCase().includes(text.toLowerCase()) && !value.includes(x)).slice(0, 6) : [];
  return (
    <div className={s.tagwrap}>
      {/* The wrap is not a control: the click just moves focus to the input inside it. */}
      <div className={cx(s.tags, disabled && s.disabled, err && s.invalid)} onClick={() => ref.current?.focus()}>
        {value.map((t) => (
          <span key={t} className={cx(s.tagit, isMono && s.mono)}>{t}
            <button type="button" aria-label={`Remove ${t}`} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}><Icon name="close" /></button>
          </span>
        ))}
        <input ref={ref} value={text} disabled={disabled} placeholder={value.length ? '' : placeholder} aria-label={ariaLabel || placeholder} autoComplete="off"
          onChange={(e) => { setText(e.target.value); setErr(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); add(text); }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (text) add(text); }} />
        {hits.length ? <div className={s.sugg}>{hits.map((h) => <button type="button" key={h} onMouseDown={(e) => { e.preventDefault(); add(h); }}>{h}</button>)}</div> : null}
      </div>
      {err ? <span className={s.err} role="alert">{err}</span> : null}
    </div>
  );
}

/* Search a list and pick from it, or add a name the list does not have. */
export function Picker({ options, onPick, placeholder, exclude = [], allowNew = true, loading, ariaLabel }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [i, setI] = useState(0);
  const needle = q.trim().toLowerCase();
  const hits = options.filter((o) => !exclude.includes(o) && (!needle || o.toLowerCase().includes(needle))).slice(0, 8);
  const exact = hits.some((h) => h.toLowerCase() === needle);
  const rows = allowNew && needle && !exact ? [...hits, { add: q.trim() }] : hits;
  const pick = (r) => { onPick(typeof r === 'string' ? r : r.add); setQ(''); setOpen(false); setI(0); };
  const at = Math.min(i, Math.max(0, rows.length - 1));
  return (
    <div className={s.picker}>
      <Icon name="search" className={s.pickerIc} />
      <input className={s.ctl} value={q} placeholder={placeholder} aria-label={ariaLabel || placeholder} autoComplete="off" role="combobox" aria-expanded={open && rows.length > 0} aria-autocomplete="list" aria-controls="os-picker-list"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, rows.length - 1)); setOpen(true); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (rows[at]) pick(rows[at]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (rows.length || loading) ? (
        <div className={s.pop} role="listbox" id="os-picker-list">
          {loading && !rows.length ? <span className={s.popNote}>Loading</span> : null}
          {rows.map((r, k) => (
            typeof r === 'string'
              ? <button type="button" role="option" aria-selected={k === at} key={r} className={cx(k === at && s.on)} onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setI(k)}>{r}</button>
              : <button type="button" role="option" aria-selected={k === at} key="__new" className={cx(s.newRow, k === at && s.on)} onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setI(k)}>{`Add "${r.add}"`}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* A masked secret with a way to see it while typing. */
export function Secret({ value, onChange, placeholder, disabled, ariaLabel, invalid, req, onBlur, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className={s.secret}>
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} autoComplete="new-password" invalid={invalid} req={req} onBlur={onBlur} />
      <button type="button" className={s.eye} onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide' : 'Show'} disabled={disabled}><Glyph name="eye" size={15} /></button>
    </div>
  );
}

/* A copyable value. */
export function CopyRow({ value }) {
  const [done, setDone] = useState(false);
  return (
    <div className={s.copy}>
      <input className={cx(s.ctl, s.mono)} readOnly value={value} aria-label="Link" onFocus={(e) => e.target.select()} />
      <Act onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); }}>{done ? 'Copied' : 'Copy'}</Act>
    </div>
  );
}

/* Layout helpers the sections share. */
export function Stack({ gap, children, className }) { return <div className={cx(s.stack, className)} style={gap ? { gap } : undefined}>{children}</div>; }
export function Grid({ children, className }) { return <div className={cx(s.grid, className)}>{children}</div>; }
export function Rows({ children }) { return <div className={s.rows}>{children}</div>; }
export function Row({ kind, children, style }) { return <div className={cx(s.rowc, kind && s[`rowc_${kind}`])} style={style}>{children}</div>; }
/* A group heading inside a step: 14px, with a hairline under it. */
export function Sub({ title, note, right }) { return <div className={s.sub}><h3>{title}</h3>{note ? <span>{note}</span> : null}{right ? <span className={s.subRight}>{right}</span> : null}</div>; }
export function Note({ children, className }) { return <p className={cx(s.note, className)}>{children}</p>; }
export function Empty({ title, children }) { return <p className={s.empty}><b>{title}.</b>{children ? <> {children}</> : null}</p>; }
export function Err({ children }) { return <span className={s.err} role="alert">{children}</span>; }
export function Link({ children, ...p }) { return <button type="button" className={s.link} {...p}>{children}</button>; }

/* A block inside a step: a group heading with its save mark and actions,
   then the fields. */
export function Block({ title, note, right, children, id }) {
  return (
    <section className={s.block} id={id}>
      <div className={s.blockH}><b>{title}</b>{note ? <em>{note}</em> : null}{right ? <span className={s.blockRight}>{right}</span> : null}</div>
      <div className={s.blockB}>{children}</div>
    </section>
  );
}

/* A held value, drawn as a bordered row with its actions: the approver, the
   SNMP login. */
export function Held({ title, sub, note, children }) {
  return (
    <div className={s.held}>
      <span className={s.heldT}><b>{title}</b>{sub ? <span>{sub}</span> : null}{note ? <span>{note}</span> : null}</span>
      {children ? <span className={s.heldActs}>{children}</span> : null}
    </div>
  );
}

export const swatch = s.swatch;
export const checkLine = { base: s.check, ok: s.check_ok, bad: s.check_bad, muted: s.check_muted };
