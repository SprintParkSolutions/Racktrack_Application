// Vendor → login portal resolution.
//
// The table itself is generated from login-info.xlsx and will be regenerated;
// what must not drift is the four-step matching order around it, because the
// substring step is the one that decides between two plausible answers. A
// change that made "allied" win over "alliedtelesis", or that let the generic
// fallback fire before a curated portal, would send technicians to the wrong
// vendor's login page — a failure nobody reports as a bug, they just give up.

import { describe, test, expect } from 'vitest';
import { findVendorLogin, VENDOR_LOGIN, VENDOR_ALIAS } from './vendorLoginUrls';

describe('findVendorLogin', () => {
  test('empty-ish input resolves to nothing rather than a random vendor', () => {
    // Scan results carry '', null and 'Unknown' constantly; normalize() maps
    // the first two to '' and a bare substring scan on '' would match every
    // key in the table.
    for (const v of ['', null, undefined, '   ']) {
      expect(findVendorLogin(v)).toBe(null);
    }
  });

  test('an exact name matches regardless of case, spaces and punctuation', () => {
    // Vendor strings arrive from OCR and from Netdisco, in every shape.
    for (const v of ['cisco', 'Cisco', 'CISCO', ' Cisco ']) {
      expect(findVendorLogin(v)).toMatchObject({ name: 'Cisco', source: 'login' });
    }
    expect(findVendorLogin('Alcatel-Lucent Enterprise')).toMatchObject({
      name: 'Alcatel-Lucent Enterprise',
      source: 'login',
    });
    expect(findVendorLogin('TP-Link')).toMatchObject({ name: 'TP-Link' });
  });

  test('short names resolve through the alias table to the canonical vendor', () => {
    expect(findVendorLogin('HP')).toMatchObject({ name: 'HPE Aruba Networking' });
    expect(findVendorLogin('Aruba')).toMatchObject({ name: 'HPE Aruba Networking' });
    expect(findVendorLogin('Juniper')).toMatchObject({ name: 'Juniper Networks' });
    expect(findVendorLogin('FS')).toMatchObject({ name: 'FS.com' });
  });

  test('every alias points at a key that exists in the table', () => {
    // The table is regenerated from a spreadsheet; a rename there silently
    // turns an alias into a dead end that falls through to substring matching.
    for (const [alias, target] of Object.entries(VENDOR_ALIAS)) {
      expect(VENDOR_LOGIN[target], `alias "${alias}" → missing key "${target}"`).toBeTruthy();
    }
  });

  test('a decorated vendor string still finds its curated portal', () => {
    expect(findVendorLogin('Cisco Systems, Inc.')).toMatchObject({
      name: 'Cisco',
      source: 'login',
    });
    expect(findVendorLogin('Arista Networks Inc')).toMatchObject({ name: 'Arista Networks' });
  });

  test('the longest substring match wins', () => {
    // "alliedtelesis" contains "allied"; the more specific key is the right
    // answer, and this is the exact case the length comparison exists for.
    expect(findVendorLogin('Allied Telesis')).toMatchObject({ name: 'Allied Telesis' });
  });

  test('a curated portal beats the generic fallback', () => {
    // Both tables contain a 'cisco' entry. Sending someone to the support
    // landing page when a real login portal is known is a silent downgrade.
    expect(findVendorLogin('Cisco').source).toBe('login');
  });

  test('an unknown vendor resolves to nothing at all', () => {
    expect(findVendorLogin('Definitely Not A Switch Vendor')).toBe(null);
  });

  test('every entry in the table carries a name and an absolute https URL', () => {
    for (const [key, entry] of Object.entries(VENDOR_LOGIN)) {
      expect(entry.name, key).toBeTruthy();
      expect(entry.url, key).toMatch(/^https:\/\//);
      // Keys are the normalized form; a stray space or capital would make the
      // entry unreachable by exact match.
      expect(key).toMatch(/^[a-z0-9]+$/);
    }
  });

  test('the returned object is a copy, so callers cannot corrupt the table', () => {
    const r = findVendorLogin('Cisco');
    r.url = 'https://evil.example/';
    expect(findVendorLogin('Cisco').url).not.toBe('https://evil.example/');
  });
});
