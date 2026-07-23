from firmware_lookup.providers.adtran import _CURRENT_RELEASE_ROW_RE

REAL_RELEASE_TABLE_HTML = """
<p><span>Current Release</span></p>
<p>The following are the software files associated with the last software release for the NetVanta 1560-24 ASE products.</p>
<table>
<tbody><tr>
  <th>Version</th>
  <th>Release Date</th>
  <th>Release Notes</th>
  <th>Download</th>
  <th>Hash</th>
  </tr>
 <tr>
      <td>4.4-50</td>
      <td>12/17/25</td>
<td><a href="...">Release Notes</a></td>
<td><a href="...">Software</a></td>
 <td>SHA256: E644B96B...</td>
  </tr>
</tbody></table>
<p><span>Archived Releases</span></p>
<table>
  <tbody><tr>
  <th>Version</th>
  <th>Release Date</th>
  </tr>
<tr>
      <td>4.4-49</td>
      <td>9/20/24</td>
</tr>
</tbody></table>
"""


def test_current_release_row_regex_parses_real_markup_and_skips_header():
    """Regression guard for the real markup found live against a real
    Adtran account: the header row uses <th>, not <td>, so the <td>-
    only pattern naturally never matches it -- confirms the FIRST real
    match is genuinely the Current Release row (4.4-50), not the
    Archived Releases table's older 4.4-49 entry."""
    m = _CURRENT_RELEASE_ROW_RE.search(REAL_RELEASE_TABLE_HTML)
    assert m is not None
    assert m.group(1) == "4.4-50"
    assert m.group(2) == "12/17/25"


def test_no_current_release_table_returns_none():
    m = _CURRENT_RELEASE_ROW_RE.search("<html>no release table here</html>")
    assert m is None
