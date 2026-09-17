"""Every NetBox object, from the live schema, as one readable HTML page."""

import collections
import html
import json
import re
import sys

USAGE = """Rebuild the NetBox object reference.

    curl -s "$NETBOX_URL/api/schema/?format=json" -o schema.json
    python3 build-netbox-object-reference.py schema-dumps/netbox-4.6.10-openapi.json netbox-object-reference.html
"""

if len(sys.argv) != 3:
    sys.exit(USAGE)
SRC, OUT = sys.argv[1], sys.argv[2]
doc = json.load(open(SRC, encoding="utf-8"))
S = doc["components"]["schemas"]
VER = doc["info"]["version"].split("-")[0]

# ── which objects RackTrack writes, and what they are in plain words ─────────
CORE = {
    "Manufacturer": (1, "Who made it"),
    "DeviceType": (2, "The model, not the box"),
    "DeviceRole": (3, "What it is for"),
    "Site": (4, "The building"),
    "Location": (5, "The room"),
    "Rack": (6, "The rack itself"),
    "Device": (7, "The actual box"),
    "Interface": (8, "A network port"),
    "RearPort": (9, "Patch panel, back"),
    "FrontPort": (10, "Patch panel, front"),
    "PowerPort": (11, "Where it draws power"),
    "PowerOutlet": (12, "A socket on a strip"),
    "VLAN": (13, "A VLAN"),
    "Prefix": (14, "A subnet"),
    "IPAddress": (15, "An address"),
    "Cable": (16, "A cable, both ends"),
}

GROUP_TITLE = {
    "dcim": ("Racks and hardware", "Physical things: sites, racks, devices, ports, cables."),
    "ipam": ("Addressing", "Networks, addresses, VLANs and the ranges they come from."),
    "tenancy": (
        "Who owns it",
        "Tenants and contacts, for attributing equipment to a customer or team.",
    ),
    "virtualization": (
        "Virtual machines",
        "Clusters and VMs, modelled alongside the physical estate.",
    ),
    "circuits": ("Circuits", "Links bought from a provider, and where they land."),
    "wireless": ("Wireless", "Wireless LANs and the links between antennas."),
    "vpn": ("VPN", "Tunnels, tunnel groups and the terminations either end."),
    "extras": ("Customisation", "Custom fields, tags, webhooks, journal entries, saved views."),
    "core": ("Housekeeping", "Background jobs, data sources and object changes."),
    "users": ("Accounts", "Users, groups, tokens and permissions."),
    "status": ("Instance", "What this NetBox reports about itself."),
    "embedded": (
        "Shapes used inside other objects",
        "Not things you create. This is how a linked object appears when it is "
        "embedded in another one — a device shown inside a cable, say. They have "
        "no endpoints of their own.",
    ),
}
GROUP_ORDER = [
    "dcim",
    "ipam",
    "circuits",
    "virtualization",
    "wireless",
    "vpn",
    "tenancy",
    "extras",
    "users",
    "core",
    "status",
    "embedded",
]

# ── map each model to the app whose endpoints return it ─────────────────────
REF = re.compile(r"#/components/schemas/([A-Za-z0-9_]+)")
app_of = {}
for path, ops in doc.get("paths", {}).items():
    m = re.match(r"^(?:/[a-z]+)?/api/([a-z-]+)/", path)
    if not m:
        continue
    app = m.group(1)
    for name in REF.findall(json.dumps(ops)):
        app_of.setdefault(name, app)

SKIP = re.compile(r"^(Brief|Writable|Patched|Paginated)|Request$")
MODELS = sorted(n for n in S if not SKIP.search(n))

# NetBox's own descriptions are mostly serializer boilerplate. Drop those.
BOILER = re.compile(r"serializer|Adds support for|^Base ", re.I)


def ref_name(node):
    if not isinstance(node, dict):
        return None
    if "$ref" in node:
        return node["$ref"].rsplit("/", 1)[-1]
    for k in ("allOf", "oneOf", "anyOf"):
        for sub in node.get(k, []):
            n = ref_name(sub)
            if n:
                return n
    return None


def plain(name):
    return name[5:] if name.startswith("Brief") else name


def choices(node):
    val = (node.get("properties") or {}).get("value") or {}
    en = val.get("enum") or node.get("enum")
    return [e for e in en if e != ""] if en else None


def describe(node):
    notes = []
    r, ch = ref_name(node), choices(node)

    if r:
        t = "link → " + plain(r)
    elif ch:
        t = f"one of {len(ch)}"
        shown = ", ".join(str(c) for c in ch[:6])
        if len(ch) > 6:
            shown += f", and {len(ch) - 6} more"
        notes.append(shown)
    else:
        t = node.get("type", "object")
        fmt = node.get("format")
        if t == "array":
            inner = ref_name(node.get("items") or {})
            t = ("many → " + plain(inner)) if inner else "list"
        elif fmt:
            t = fmt if fmt in ("uri", "date", "date-time", "email") else f"{t}, {fmt}"

    d = (node.get("description") or "").strip().split("\n")[0].strip()
    if d and not d.startswith("*") and not BOILER.search(d):
        notes.insert(0, d.rstrip("."))
    if node.get("maxLength"):
        notes.append(f"up to {node['maxLength']} characters")
    if node.get("nullable"):
        notes.append("can be empty")
    return t, notes


def rows(model):
    node = S.get(model) or {}
    req = set(node.get("required") or [])
    out = []
    for fname, f in (node.get("properties") or {}).items():
        t, notes = describe(f)
        out.append(
            {
                "name": fname,
                "type": t,
                "req": fname in req,
                "ro": bool(f.get("readOnly")),
                "notes": notes,
            }
        )
    out.sort(key=lambda r: (r["ro"], not r["req"], r["name"]))
    return out


def obj_desc(model):
    d = (S.get(model) or {}).get("description", "").strip().split("\n")[0].strip()
    return "" if (not d or BOILER.search(d)) else d.rstrip(".")


def esc(x):
    return html.escape(str(x))


def slug(x):
    return re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-")


groups = collections.OrderedDict((g, []) for g in GROUP_ORDER)
for n in MODELS:
    groups.setdefault(app_of.get(n, "embedded"), []).append(n)
for g in groups:
    groups[g].sort(
        key=lambda n: (
            (0, CORE[n][0])
            if n in CORE
            else (1, 0, n)
            if False
            else ((0, CORE[n][0], "") if n in CORE else (1, 0, n))
        )
    )
groups = collections.OrderedDict((g, v) for g, v in groups.items() if v)

total_fields = sum(len(rows(n)) for n in MODELS)

P = []
A = P.append

A("""<title>NetBox Object Reference</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
  :root{
    --paper:#fff; --ink:#14181b; --body:#333b36; --muted:#5f6864; --quiet:#949d98;
    --rule:#e6eae8; --rule-firm:#c9d0cc;
    --good:#0b6a44; --good-bg:#eef5f1;
    --stop:#9d4a3f; --stop-bg:#f9f1f0;
    --serif:"Newsreader",Georgia,"Times New Roman",serif;
    --sans:"Source Sans 3","Helvetica Neue",Helvetica,Arial,sans-serif;
    --mono:"IBM Plex Mono","SF Mono",Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:82px}
  body{margin:0;background:var(--paper);color:var(--body);
       font-family:var(--sans);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
  .pad{padding:0 clamp(18px,3.5vw,56px)}

  /* masthead */
  header{padding-top:50px;padding-bottom:24px;border-bottom:1px solid var(--ink)}
  .eyebrow{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.15em;
           text-transform:uppercase;color:var(--muted);margin:0 0 14px}
  h1{font-family:var(--serif);font-weight:500;font-size:clamp(32px,4.4vw,46px);line-height:1.05;
     letter-spacing:-.015em;color:var(--ink);margin:0 0 12px;max-width:18ch}
  .lede{font-family:var(--serif);font-size:clamp(17px,1.9vw,20px);line-height:1.45;
        color:var(--muted);margin:0;max-width:64ch}
  .facts{margin:22px 0 0;display:flex;flex-wrap:wrap;gap:10px 44px}
  .fact b{display:block;font-family:var(--mono);font-size:19px;font-weight:600;
          color:var(--ink);line-height:1.2;font-variant-numeric:tabular-nums}
  .fact span{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;
             text-transform:uppercase;color:var(--quiet)}

  /* sticky bar */
  .bar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.97);
       backdrop-filter:blur(6px);border-bottom:1px solid var(--rule)}
  .bar-in{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
          padding-top:12px;padding-bottom:12px}
  .bar input{font-family:var(--sans);font-size:15px;padding:9px 13px;flex:1 1 300px;max-width:420px;
             border:1px solid var(--rule-firm);border-radius:3px;background:#fff;color:var(--ink)}
  .bar input:focus{outline:2px solid var(--good);outline-offset:1px;border-color:var(--good)}
  .bar .count{font-family:var(--mono);font-size:11.5px;color:var(--quiet);white-space:nowrap}
  .bar label{font-size:14.5px;color:var(--muted);display:inline-flex;align-items:center;
             gap:7px;white-space:nowrap;cursor:pointer}

  /* legend */
  .legend{padding:26px 0 6px;display:grid;grid-template-columns:1fr;gap:18px 44px}
  @media(min-width:820px){.legend{grid-template-columns:repeat(3,1fr)}}
  .legend div{font-size:15px;line-height:1.5}
  .legend b{display:block;font-size:14px;color:var(--ink);margin-bottom:3px}

  /* contents */
  .toc{padding:28px 0 6px;border-top:1px solid var(--rule);margin-top:26px}
  .toc h2{font-family:var(--serif);font-size:20px;font-weight:600;color:var(--ink);margin:0 0 14px}
  .toc-grid{display:grid;grid-template-columns:1fr;gap:0 44px}
  @media(min-width:760px){.toc-grid{grid-template-columns:1fr 1fr}}
  @media(min-width:1180px){.toc-grid{grid-template-columns:repeat(3,1fr)}}
  .toc a{display:flex;justify-content:space-between;gap:16px;padding:9px 0;
         border-bottom:1px solid var(--rule);color:var(--ink);text-decoration:none;font-size:15.5px}
  .toc a:hover{color:var(--good)}
  .toc a em{font-style:normal;font-family:var(--mono);font-size:11.5px;color:var(--quiet)}

  /* groups */
  .group{padding-top:56px}
  .g-head{padding-bottom:10px;border-bottom:2px solid var(--ink)}
  .g-head h2{font-family:var(--serif);font-weight:600;font-size:clamp(24px,2.9vw,32px);
             line-height:1.12;color:var(--ink);margin:0 0 5px}
  .g-head p{margin:0;font-size:16px;color:var(--muted);max-width:70ch}
  .g-head span{font-family:var(--mono);font-size:11px;letter-spacing:.09em;
               text-transform:uppercase;color:var(--quiet)}

  /* objects */
  .obj{padding:26px 0 4px;border-top:1px solid var(--rule)}
  .o-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:2px}
  .obj h3{font-family:var(--serif);font-size:23px;font-weight:600;color:var(--ink);
          margin:0;line-height:1.18}
  .badge{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.06em;
         text-transform:uppercase;padding:2px 7px;border-radius:2px;
         background:var(--good-bg);color:var(--good);white-space:nowrap}
  .o-what{font-size:15.5px;color:var(--good);font-weight:600}
  .o-tally{font-family:var(--mono);font-size:11px;color:var(--quiet);white-space:nowrap}
  .o-desc{margin:5px 0 0;font-size:15.5px;color:var(--muted);max-width:74ch}

  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:14px}
  table{border-collapse:collapse;width:100%;min-width:600px;font-size:14.5px}
  thead th{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.09em;
           text-transform:uppercase;color:var(--quiet);text-align:left;
           padding:0 20px 7px 0;border-bottom:1px solid var(--rule-firm);white-space:nowrap}
  td{padding:9px 20px 9px 0;border-bottom:1px solid var(--rule);vertical-align:top;line-height:1.45}
  td.f{font-family:var(--mono);font-size:13px;color:var(--ink);white-space:nowrap;width:1%}
  td.t{white-space:nowrap;width:1%;color:var(--body)}
  td.t.lk{color:var(--good)}
  td.n{color:var(--muted);font-size:14px}
  .req{font-family:var(--sans);font-size:10px;font-weight:700;letter-spacing:.05em;
       text-transform:uppercase;color:var(--stop);margin-left:9px;vertical-align:1px}
  tr.sep td{padding:15px 0 7px;border-bottom:1px solid var(--rule-firm);
            font-family:var(--mono);font-size:10px;letter-spacing:.09em;
            text-transform:uppercase;color:var(--quiet)}
  tr.ro td{color:var(--quiet)}
  tr.ro td.f,tr.ro td.t{color:var(--quiet)}

  footer{margin-top:56px;padding-top:20px;padding-bottom:70px;border-top:1px solid var(--ink);
         color:var(--muted);font-size:14.5px}
  footer p{margin:0 0 9px;max-width:80ch}
  footer code{font-family:var(--mono);font-size:.92em;background:#f2f5f3;padding:1px 5px;border-radius:2px}
  .hidden{display:none!important}
  .empty{padding:40px 0;color:var(--quiet);font-size:16px}
</style>""")

A('<header class="pad">')
A(f'<p class="eyebrow">NetBox {esc(VER)} · complete object reference</p>')
A("<h1>Everything NetBox stores</h1>")
A(
    '<p class="lede">Every object this NetBox models, every field on it, generated from the schema the '
    "running instance publishes about itself. Nothing here was written by hand.</p>"
)
A('<div class="facts">')
A(f'<div class="fact"><b>{len(MODELS)}</b><span>objects</span></div>')
A(f'<div class="fact"><b>{total_fields}</b><span>fields</span></div>')
A(f'<div class="fact"><b>{len(groups)}</b><span>groups</span></div>')
A('<div class="fact"><b>16</b><span>a rack scan writes</span></div>')
A(f'<div class="fact"><b>{esc(VER)}</b><span>version</span></div>')
A("</div></header>")

A('<div class="bar"><div class="pad bar-in">')
A(
    '<input id="q" type="search" placeholder="Filter by object or field — device, serial, position, cable">'
)
A('<label><input type="checkbox" id="only"> Only what a rack scan writes</label>')
A('<span class="count" id="cnt"></span>')
A("</div></div>")

A('<div class="pad">')
A('<div class="legend">')
A(
    "<div><b>Field</b>Its name in the API, exactly as you send it. A field marked "
    '<span class="req">required</span> has to be present or the write is rejected.</div>'
)
A(
    '<div><b>What it holds</b>The value\'s type. <span style="color:var(--good)">link →</span> means it '
    "holds another object's id, which is why things must be created in the right order.</div>"
)
A(
    "<div><b>Set by NetBox</b>Below the divider in each table are fields NetBox fills in itself — ids, "
    "timestamps, counts, URLs. You never send them.</div>"
)
A("</div>")

A('<nav class="toc"><h2>Contents</h2><div class="toc-grid">')
for g, names in groups.items():
    title = GROUP_TITLE.get(g, (g.title(), ""))[0]
    A(f'<a href="#{slug(g)}">{esc(title)} <em>{len(names)}</em></a>')
A("</div></nav>")

for g, names in groups.items():
    title, blurb = GROUP_TITLE.get(g, (g.title(), ""))
    A(f'<section class="group" id="{slug(g)}"><div class="g-head">')
    A(f"<span>{esc(g)}</span><h2>{esc(title)}</h2>")
    if blurb:
        A(f"<p>{esc(blurb)}</p>")
    A("</div>")
    for name in names:
        rs = rows(name)
        core = CORE.get(name)
        writable = sum(1 for r in rs if not r["ro"])
        readonly = len(rs) - writable
        A(
            f'<article class="obj" data-name="{esc(name.lower())}"'
            f' data-core="{1 if core else 0}" id="o-{slug(name)}">'
        )
        A(f'<div class="o-top"><h3>{esc(name)}</h3>')
        if core:
            A(f'<span class="badge">a rack scan writes this · step {core[0]} of 16</span>')
            A(f'<span class="o-what">{esc(core[1])}</span>')
        A(f'<span class="o-tally">{writable} you set · {readonly} NetBox sets</span></div>')
        d = obj_desc(name)
        if d:
            A(f'<p class="o-desc">{esc(d)}</p>')
        if not rs:
            A(
                '<p class="o-desc">No fields — this object is a marker or an empty response.</p></article>'
            )
            continue
        A(
            '<div class="scroll"><table><thead><tr>'
            "<th>Field</th><th>What it holds</th><th>Notes</th></tr></thead><tbody>"
        )
        sep = False
        for r in rs:
            if r["ro"] and not sep:
                sep = True
                A('<tr class="sep"><td colspan="3">Set by NetBox — you never send these</td></tr>')
            A(
                '<tr{} data-f="{}"><td class="f">{}{}</td><td class="t{}">{}</td><td class="n">{}</td></tr>'.format(
                    ' class="ro"' if r["ro"] else "",
                    esc(r["name"].lower()),
                    esc(r["name"]),
                    '<span class="req">required</span>' if r["req"] and not r["ro"] else "",
                    " lk" if r["type"].startswith(("link", "many")) else "",
                    esc(r["type"]),
                    esc(" · ".join(r["notes"])),
                )
            )
        A("</tbody></table></div></article>")
    A("</section>")

A('<p class="empty hidden" id="none">Nothing matches that.</p>')
A("</div>")

A('<footer class="pad">')
A(
    f"<p>Generated from <code>/api/schema/</code> on this instance, NetBox {esc(VER)}, on 9 September 2026. "
    "Every field, type, length limit and choice list is what the running server reports about itself.</p>"
)
A(
    "<p>Input-only variants of each object — the <code>Brief</code>, <code>Writable</code>, "
    "<code>Patched</code> and <code>Request</code> forms NetBox generates for its own API docs — are left out. "
    "They repeat the same fields with different rules about which are optional.</p>"
)
A("</footer>")

A("""<script>
(function(){
  var q=document.getElementById('q'), only=document.getElementById('only'),
      cnt=document.getElementById('cnt'), none=document.getElementById('none'),
      objs=[].slice.call(document.querySelectorAll('.obj')),
      secs=[].slice.call(document.querySelectorAll('.group'));
  function run(){
    var v=(q.value||'').trim().toLowerCase(), core=only.checked, o=0, f=0;
    objs.forEach(function(el){
      if(core && el.dataset.core!=='1'){ el.classList.add('hidden'); return; }
      var hitName = !v || el.dataset.name.indexOf(v)>=0, any=false;
      [].slice.call(el.querySelectorAll('tbody tr')).forEach(function(r){
        if(r.classList.contains('sep')){ r.classList.toggle('hidden', !!v && !hitName); return; }
        var hit = hitName || (r.dataset.f||'').indexOf(v)>=0
                  || r.textContent.toLowerCase().indexOf(v)>=0;
        r.classList.toggle('hidden', !hit);
        if(hit){ any=true; f++; }
      });
      el.classList.toggle('hidden', !(hitName||any));
      if(hitName||any) o++;
    });
    secs.forEach(function(s){
      s.classList.toggle('hidden', !s.querySelector('.obj:not(.hidden)'));
    });
    none.classList.toggle('hidden', o>0);
    cnt.textContent = (v||core) ? (o+' objects · '+f+' fields') : '';
  }
  q.addEventListener('input', run);
  only.addEventListener('change', run);
})();
</script>""")

open(OUT, "w", encoding="utf-8").write("\n".join(P))
print("objects  :", len(MODELS))
print("fields   :", total_fields)
for g, n in groups.items():
    print(f"  {g:<16} {len(n)}")
