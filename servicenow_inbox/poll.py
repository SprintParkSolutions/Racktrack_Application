"""
Poll ServiceNow for open incidents, extract {switch, port} from each, and
save a lightweight ticket record to this directory. This is what the
RackTrack app reads after the technician logs in and captures a scan —
it tells the app *what device and what port* to verify.

One file per incident: <INC>.ticket.json
One aggregate file:    active_tickets.json (all currently open, latest first)

Usage:
    python poll.py                 # poll once
    python poll.py --watch 30      # poll every 30 seconds

Credentials: reads .env from this dir, or h:/dark_mobile/, or h:/SERVICENOW/.
"""
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests
from dotenv import load_dotenv


HERE = Path(__file__).resolve().parent
# Look for .env in the sibling servicenow/ bridge dir. Layout:
#   dark_mobile/
#     ├── servicenow/          <- bridge code + .env
#     └── servicenow_inbox/    <- this script lives here
ENV_CANDIDATES = [
    HERE.parent / "servicenow" / ".env",  # dark_mobile/servicenow/.env
    HERE / ".env",
    HERE.parent / ".env",
]


def load_env():
    """Best-effort .env loader. When the script is spawned by the Node
    server with SN_INSTANCE / SN_USER / SN_PASSWORD already set in the
    process env (per-user connection profile flow), no .env file is
    needed — load_dotenv would no-op those keys anyway because by
    default it doesn't override existing env vars. Only fall back to the
    raise when neither path supplies credentials.
    """
    for p in ENV_CANDIDATES:
        if p.exists():
            load_dotenv(p)
            return p
    # No .env on disk — that's fine if the caller pre-set SN_* in env.
    if os.environ.get("SN_INSTANCE") and os.environ.get("SN_USER") and os.environ.get("SN_PASSWORD"):
        return None
    raise FileNotFoundError(
        f"No SN credentials in env, and no .env in any of: "
        f"{', '.join(str(p) for p in ENV_CANDIDATES)}"
    )


def extract_port(text):
    m = re.search(r"port[\s#:]*(\d+)", text or "", re.I)
    return int(m.group(1)) if m else None


RACKTRACK_DEVICE_RE = re.compile(r"\b((?:SW|SRV|PP)-U\d{1,2})\b", re.I)


def extract_device_from_text(text):
    """Fallback: parse SW-Uxx, SRV-Uxx, PP-Uxx from text."""
    m = RACKTRACK_DEVICE_RE.search(text or "")
    return m.group(1).upper() if m else None


def is_racktrack_actionable(rec):
    """Only tickets with a parseable RackTrack-style device AND a port number
    are actionable — the RackTrack app needs both to know what to verify.
    Also accepts tickets where cmdb_ci is already set to a RackTrack-pattern name.
    """
    t = rec.get("target", {})
    if t.get("port") is None:
        return False
    dev = t.get("device") or ""
    return bool(RACKTRACK_DEVICE_RE.match(dev))


def _is_hibernating(response):
    """Check if a ServiceNow response indicates the instance is hibernating."""
    if response is None:
        return False
    ct = response.headers.get("Content-Type", "")
    # Hibernating instances return HTML instead of JSON
    if "text/html" in ct and response.status_code == 200:
        body = response.text[:2000].lower()
        if "hibernat" in body or "waking up" in body or "instance is loading" in body:
            return True
    # Some instances return 503 when hibernating
    if response.status_code == 503:
        return True
    return False


def _wake_instance(instance, max_wait=180, poll_interval=10):
    """Detect if the PDI is hibernating and wake it up. Blocks until the
    instance is responsive or *max_wait* seconds have elapsed.

    ServiceNow PDIs hibernate after inactivity. A simple GET to the
    login page triggers the wake-up process. We then poll until the
    instance returns a non-hibernation response.
    """
    instance_url = f"https://{instance}.service-now.com"
    # Quick probe — is the instance even asleep?
    try:
        probe = requests.get(instance_url, timeout=20, allow_redirects=True)
    except requests.exceptions.ConnectionError:
        # Network-level failure, might be waking
        probe = None
    except requests.exceptions.Timeout:
        probe = None

    if probe is not None and not _is_hibernating(probe):
        return  # Instance is awake, nothing to do

    print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
          f"instance {instance} is hibernating — sending wake-up request ...")

    # Hit login.do to trigger the wake-up
    try:
        requests.get(f"{instance_url}/login.do", timeout=20, allow_redirects=True)
    except Exception:
        pass  # The request itself triggers wake-up even if it times out

    waited = 0
    while waited < max_wait:
        time.sleep(poll_interval)
        waited += poll_interval
        try:
            r = requests.get(
                f"{instance_url}/stats.do",
                timeout=15,
                allow_redirects=True,
            )
            if not _is_hibernating(r):
                print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
                      f"instance {instance} is awake (waited {waited}s)")
                return
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            pass
        print(f"  ... still waking ({waited}s / {max_wait}s)")

    raise RuntimeError(
        f"Instance {instance} did not wake up within {max_wait}s"
    )


def _build_session(instance, user, password, base):
    """Return a requests.Session authenticated against the SN instance.

    Tries Basic Auth first (fastest). If the instance has Basic Auth
    disabled (401), falls back to form-login + CSRF-token session auth.
    The returned session's headers already contain Accept: application/json.
    """
    # --- wake up the instance if it's hibernating (PDI sleep) ---
    _wake_instance(instance)

    # --- try Basic Auth first ---
    s = requests.Session()
    s.auth = (user, password)
    s.headers.update({"Accept": "application/json"})
    probe = s.get(f"{base}/table/sys_user", params={"sysparm_limit": 1}, timeout=15)

    # Probe might succeed HTTP-wise but return hibernation HTML
    if _is_hibernating(probe):
        _wake_instance(instance)
        probe = s.get(f"{base}/table/sys_user", params={"sysparm_limit": 1}, timeout=15)

    if probe.status_code == 200:
        return s  # Basic Auth works

    # --- fallback: form login + session cookie ---
    s = requests.Session()
    instance_url = f"https://{instance}.service-now.com"
    # Don't set Accept: application/json yet — login.do must return HTML so
    # we can scrape the CSRF token (g_ck) from the rendered page.
    login_r = s.post(
        f"{instance_url}/login.do",
        data={"user_name": user, "user_password": password, "sys_action": "sysverb_login"},
        allow_redirects=True, timeout=30,
    )
    if login_r.status_code != 200:
        raise RuntimeError(f"Form login failed: HTTP {login_r.status_code}")
    # Extract CSRF token (g_ck) from the HTML page
    ck_match = re.search(r"var\s+g_ck\s*=\s*'([^']*)'", login_r.text)
    g_ck = ck_match.group(1) if ck_match else ""
    if not g_ck:
        # Try loading a navigation page to grab g_ck
        nav_r = s.get(f"{instance_url}/nav_to.do?uri=sys_user_list.do", timeout=15)
        ck_match = re.search(r"var\s+g_ck\s*=\s*'([^']*)'", nav_r.text)
        g_ck = ck_match.group(1) if ck_match else ""
    # JSONv2 works reliably with session cookies; the REST API often
    # rejects session auth even with a valid X-UserToken. Skip the
    # REST probe entirely to avoid invalidating the session cookie.
    s._poll_use_jsonv2 = True
    s._poll_instance_url = instance_url
    s._poll_g_ck = g_ck
    return s


def fetch_open_incidents(base, auth, headers, *, session=None):
    """Fetch open incidents. Uses *session* when provided (session-auth),
    otherwise falls back to the legacy (auth, headers) Basic-Auth tuple."""
    params = {
        "sysparm_query": "active=true^stateIN1,2",  # New + In Progress
        "sysparm_display_value": "true",
        "sysparm_exclude_reference_link": "true",
        "sysparm_fields": (
            "number,sys_id,short_description,description,"
            "cmdb_ci,priority,urgency,state,category,opened_at,opened_by"
        ),
        "sysparm_limit": 200,
    }
    if session and getattr(session, "_poll_use_jsonv2", False):
        r = session.get(
            f"{session._poll_instance_url}/incident.do",
            params={"JSONv2": "", "sysparm_action": "getRecords",
                    "sysparm_query": params["sysparm_query"],
                    "displayvalue": "true",
                    "sysparm_fields": params["sysparm_fields"],
                    "sysparm_record_count": params["sysparm_limit"]},
            headers={"Accept": "application/json",
                     "X-UserToken": getattr(session, "_poll_g_ck", "")},
            timeout=20,
        )
        r.raise_for_status()
        return r.json().get("records", [])
    if session:
        r = session.get(f"{base}/table/incident", params=params, timeout=20)
    else:
        r = requests.get(f"{base}/table/incident", params=params,
                         auth=auth, headers=headers, timeout=20)
    if _is_hibernating(r):
        raise RuntimeError(
            "Instance fell asleep mid-request (hibernation detected in incident response)"
        )
    r.raise_for_status()
    if not r.text.strip():
        raise RuntimeError(f"ServiceNow returned empty body (HTTP {r.status_code})")
    try:
        data = r.json()
    except requests.exceptions.JSONDecodeError:
        raise RuntimeError(
            f"ServiceNow returned non-JSON (HTTP {r.status_code}): {r.text[:200]}"
        )
    return data.get("result", [])


_SWITCH_SUBCLASS_TABLES = ["cmdb_ci_ip_switch", "cmdb_ci_netgear", "cmdb_ci_server"]


def _sn_get(base, path, params, *, auth=None, headers=None, session=None, timeout=15):
    """Unified GET helper: uses *session* when available, else raw auth tuple."""
    url = f"{base}/{path}" if not path.startswith("http") else path
    if session and getattr(session, "_poll_use_jsonv2", False):
        # JSONv2 fallback — translate REST-style path to .do URL
        # path is like "table/cmdb_ci_ip_switch" or "table/cmdb_ci_rack/sys_id"
        parts = path.replace("table/", "").split("/")
        table = parts[0]
        qs = dict(params) if params else {}
        qs.update({"JSONv2": "", "sysparm_action": "getRecords"})
        if "sysparm_limit" in qs:
            qs["sysparm_record_count"] = qs.pop("sysparm_limit")
        # If a specific record sys_id is in the path, add it as a query
        if len(parts) > 1:
            qs["sysparm_query"] = f"sys_id={parts[1]}"
        r = session.get(f"{session._poll_instance_url}/{table}.do", params=qs,
                        headers={"Accept": "application/json",
                                 "X-UserToken": getattr(session, "_poll_g_ck", "")},
                        timeout=timeout)
        if r.status_code == 200:
            data = r.json()
            recs = data.get("records", data.get("result", []))
            # Simulate REST-style response shape
            return type("R", (), {"status_code": 200, "json": lambda self: {"result": recs}})()
        return type("R", (), {"status_code": r.status_code, "json": lambda self: {}})()
    if session:
        r = session.get(url, params=params, timeout=timeout)
    else:
        r = requests.get(url, params=params, auth=auth, headers=headers, timeout=timeout)
    return r


def fetch_cmdb_device_details(base, auth, headers, device_name, port_num, *, session=None):
    """Look up the CMDB record for the device named in the ticket, plus the
    specific port adapter if known. Returns mgmt_ip, mac, model, serial,
    os_version, interface_alias (e.g. 'Gi1/0/15'), interface_name, rack, and U.
    """
    details = {"mgmt_ip": None, "mac": None, "model": None, "serial": None,
               "os_version": None, "vendor": None, "sys_class_name": None,
               "interface_name": None, "interface_alias": None,
               "port_short_description": None, "rack_name": None, "rack_scan_id": None,
               "u_position": None}

    device = None
    device_class = None
    for tbl in _SWITCH_SUBCLASS_TABLES:
        r = _sn_get(base, f"table/{tbl}",
                    {"sysparm_query": f"name={device_name}", "sysparm_limit": 1},
                    auth=auth, headers=headers, session=session)
        if r.status_code == 200 and r.json().get("result"):
            device = r.json()["result"][0]
            device_class = tbl
            break
    if not device:
        return details

    details["mgmt_ip"] = device.get("ip_address") or None
    details["mac"] = device.get("mac_address") or None
    details["model"] = device.get("model_number") or None
    details["serial"] = device.get("serial_number") or None
    details["os_version"] = device.get("os_version") or None
    details["sys_class_name"] = device_class
    # Zurich PDI sometimes puts Cisco IOS strings in os_version, infer vendor
    osv = (details["os_version"] or "").lower()
    if "ios" in osv or "catalyst" in (details["model"] or "").lower():
        details["vendor"] = "cisco-ios"
    # U position from name suffix
    m = re.search(r"[-_]U(\d{1,2})$", device_name or "", re.I)
    if m:
        details["u_position"] = int(m.group(1))

    # Find the specific port adapter for this device + port_num
    if port_num is not None:
        r = _sn_get(base, "table/cmdb_ci_network_adapter",
                    {"sysparm_query": f"cmdb_ci={device['sys_id']}",
                     "sysparm_fields": "name,alias,mac_address,short_description",
                     "sysparm_limit": 100},
                    auth=auth, headers=headers, session=session)
        if r.status_code == 200:
            for p in r.json().get("result", []):
                alias = (p.get("alias") or "")
                # match by trailing /N or exact-ending N in alias/name
                if alias.endswith(f"/{port_num}") or alias == f"Gi0/{port_num}" or alias.endswith(str(port_num)):
                    details["interface_alias"] = alias
                    details["interface_name"] = p.get("name")
                    details["port_short_description"] = p.get("short_description")
                    break

    # Parent rack via Contains rel
    rel_r = _sn_get(base, "table/cmdb_rel_type",
                    {"sysparm_query": "name=Contains::Contained by", "sysparm_limit": 1},
                    auth=auth, headers=headers, session=session)
    rel_type = rel_r.json().get("result") if rel_r.status_code == 200 else None
    if rel_type:
        r = _sn_get(base, "table/cmdb_rel_ci",
                    {"sysparm_query": f"child={device['sys_id']}^type={rel_type[0]['sys_id']}"
                                     f"^parent.sys_class_name=cmdb_ci_rack", "sysparm_limit": 1},
                    auth=auth, headers=headers, session=session)
        rels = r.json().get("result", [])
        if rels:
            parent_ref = rels[0].get("parent", {})
            parent_id = parent_ref.get("value") if isinstance(parent_ref, dict) else parent_ref
            if parent_id:
                rr = _sn_get(base, f"table/cmdb_ci_rack/{parent_id}", {},
                             auth=auth, headers=headers, session=session)
                if rr.status_code == 200:
                    rack = rr.json().get("result", {})
                    # JSONv2 returns a list; REST returns a dict
                    if isinstance(rack, list):
                        rack = rack[0] if rack else {}
                    details["rack_name"] = rack.get("name")
                    details["rack_scan_id"] = rack.get("u_racktrack_scan_id")
    return details


def ticket_record(inc, base=None, auth=None, headers=None, *, session=None):
    text = f"{inc.get('short_description') or ''} {inc.get('description') or ''}"
    port = extract_port(text)
    device_from_ci = inc.get("cmdb_ci") or None
    device_from_text = extract_device_from_text(text)
    switch = device_from_ci or device_from_text

    cmdb_details = {}
    if switch and base is not None:
        cmdb_details = fetch_cmdb_device_details(base, auth, headers, switch, port, session=session)

    return {
        "incident_number": inc.get("number"),
        "sys_id": inc.get("sys_id"),
        "state": inc.get("state"),
        "priority": inc.get("priority"),
        "urgency": inc.get("urgency"),
        "category": inc.get("category"),
        "opened_at": inc.get("opened_at"),
        "opened_by": inc.get("opened_by"),
        "short_description": inc.get("short_description"),
        "description": inc.get("description"),
        "target": {
            "device": switch,
            "port": port,
            "device_source": "cmdb_ci" if device_from_ci else ("parsed_text" if device_from_text else None),
            "port_source": "parsed_text" if port is not None else None,
        },
        "cmdb": cmdb_details,
        "instance_url": None,  # set by caller
        "polled_at": datetime.now(tz=__import__("datetime").timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


def write_records(records, instance):
    # Remove stale per-incident ticket files not in current set
    current_names = {f"{r['incident_number']}.ticket.json" for r in records}
    for p in HERE.glob("*.ticket.json"):
        if p.name not in current_names:
            p.unlink()

    # Per-incident files
    for rec in records:
        rec["instance_url"] = f"https://{instance}.service-now.com/incident.do?sys_id={rec['sys_id']}"
        path = HERE / f"{rec['incident_number']}.ticket.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=2)

    # Aggregate index, sorted by opened_at desc
    records_sorted = sorted(records, key=lambda r: r.get("opened_at") or "", reverse=True)
    index = {
        "polled_at": datetime.now(tz=__import__("datetime").timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(records_sorted),
        "tickets": records_sorted,
    }
    with open(HERE / "active_tickets.json", "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)


def _load_cached_tickets():
    """Return the ticket list from active_tickets.json on disk, or []."""
    index_path = HERE / "active_tickets.json"
    if index_path.exists():
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("tickets", [])
        except (json.JSONDecodeError, OSError):
            pass
    return []


def poll_once():
    env_file = load_env()
    instance = os.environ["SN_INSTANCE"]
    user = os.environ["SN_USER"]
    password = os.environ["SN_PASSWORD"]
    # SN_BASE_URL lets callers override the URL (e.g. mock server on localhost).
    base = os.environ.get("SN_BASE_URL") or f"https://{instance}.service-now.com/api/now"
    headers = {"Accept": "application/json"}
    auth = (user, password)

    # Build an authenticated session (auto-detects Basic vs session auth).
    # _build_session already calls _wake_instance, so if the PDI is
    # hibernating it will block here until awake (or raise after timeout).
    try:
        sn = _build_session(instance, user, password, base)
    except Exception as e:
        cached = _load_cached_tickets()
        print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
              f"session failed ({e}); serving {len(cached)} cached ticket(s)")
        return

    # Fetch incidents — if the instance hibernates mid-request, wake it
    # and retry once with a fresh session.
    try:
        incs = fetch_open_incidents(base, auth, headers, session=sn)
    except Exception as e:
        if "hibernation" in str(e).lower():
            print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
                  f"instance hibernated mid-fetch — waking and retrying ...")
            try:
                _wake_instance(instance)
                sn = _build_session(instance, user, password, base)
                incs = fetch_open_incidents(base, auth, headers, session=sn)
            except Exception as e2:
                cached = _load_cached_tickets()
                print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
                      f"retry failed ({e2}); serving {len(cached)} cached ticket(s)")
                return
        else:
            cached = _load_cached_tickets()
            print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
                  f"fetch failed ({e}); serving {len(cached)} cached ticket(s)")
            return

    # First pass — cheap parse only, to filter out non-RackTrack tickets
    # (30+ stock ServiceNow demo incidents) before hitting CMDB.
    cheap = [ticket_record(i) for i in incs]
    actionable_incs = [i for i, r in zip(incs, cheap) if is_racktrack_actionable(r)]
    # Second pass — enrich only the actionable ones with CMDB lookups.
    records = [ticket_record(i, base, auth, headers, session=sn) for i in actionable_incs]
    skipped = len(incs) - len(records)
    write_records(records, instance)

    print(f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] "
          f"polled {instance}: {len(records)} RackTrack-actionable ticket(s) "
          f"(+{skipped} skipped, .env: {env_file})")
    for r in records:
        t = r["target"]
        print(f"  {r['incident_number']}  [{t['device']}:port{t['port']}]  "
              f"{r.get('short_description','')[:70]}")
    print(f"  -> {HERE / 'active_tickets.json'}")


def main(argv):
    if argv and argv[0] == "--watch":
        interval = int(argv[1]) if len(argv) > 1 else 30
        print(f"Polling every {interval}s. Ctrl-C to stop.")
        while True:
            try:
                poll_once()
            except Exception as e:
                print(f"  ERROR: {e}")
            time.sleep(interval)
    else:
        poll_once()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
