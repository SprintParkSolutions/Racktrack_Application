import { describe, test, expect } from 'vitest';
import {
  STEPS, stepDone, stepLocked, progress, remaining, firstIncompleteStep, mandatoryDone, stepState,
  proposeCode, composeAddress, vShortCode, vCidr, vEmail, vCount, sectionFilled, summaryOf,
} from './orgSettings.js';

const org = { name: 'Northwind Colocation', short_code: 'NC', timezone: 'Europe/Amsterdam', country: 'NL' };
const dc = (over = {}) => ({
  id: 11, name: 'Rotterdam DC1', datacentre: { address: 'Rack Row 1, Rotterdam', timezone: 'Europe/Amsterdam' },
  spaces: [{ id: 1, name: 'Hall 1', rack_count: 12 }], approver: { user_id: 5 }, rules: { accepted_at: '2026-09-14 10:12:00' },
  completeness: { mandatory: { location: true, approver: true, rules: true }, canScan: true },
  profile: { contacts: [], vendors: [], conventions: {}, systems: {}, network: {}, facility: {}, snmp: { configured: false } },
  ...over,
});

describe('the ten steps', () => {
  test('are in the order the flow shows them, review last', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['org', 'datacentres', 'spaces', 'people', 'systems', 'vendors', 'conventions', 'network', 'rules', 'review']);
    expect(STEPS.filter((s) => s.kind === 'required').length).toBe(5);
    expect(STEPS.filter((s) => s.kind === 'optional').length).toBe(4);
  });

  test('steps that need a datacentre are locked until one exists', () => {
    const empty = { org, dcs: [] };
    expect(stepLocked('spaces', empty)).toBe(true);
    expect(stepLocked('org', empty)).toBe(false);
    expect(stepLocked('spaces', { org, dcs: [dc()] })).toBe(false);
    expect(stepState('spaces', empty, 'org')).toBe('locked');
    expect(stepState('org', empty, 'org')).toBe('on');
  });
});

describe('progress', () => {
  test('counts the five required and five optional items', () => {
    const p = progress({ org, dcs: [dc()] });
    expect(p.required.total).toBe(5);
    expect(p.required.done).toBe(5);
    expect(p.optional.total).toBe(5);
    expect(p.optional.done).toBe(0);
    expect(mandatoryDone({ org, dcs: [dc()] })).toBe(true);
  });

  test('a missing country keeps the organization step open', () => {
    const model = { org: { ...org, country: '' }, dcs: [dc()] };
    expect(stepDone('org', model)).toBe(false);
    expect(firstIncompleteStep(model)).toBe('org');
    expect(remaining(model).required.map((x) => x.key)).toEqual(['org']);
  });

  test('an organization with no datacentre still needs everything after the profile', () => {
    const model = { org, dcs: [] };
    expect(firstIncompleteStep(model)).toBe('datacentres');
    expect(remaining(model).required.map((x) => x.key)).toEqual(['datacentres', 'spaces', 'people', 'rules']);
  });

  test('every datacentre must be done, not just one', () => {
    const model = { org, dcs: [dc(), dc({ id: 12, name: 'Amsterdam DC2', approver: null, completeness: { mandatory: { location: true, approver: false, rules: true }, canScan: false } })] };
    expect(stepDone('people', model)).toBe(false);
    expect(firstIncompleteStep(model)).toBe('people');
    expect(remaining(model).required[0].label).toBe('An approver in every datacentre');
    expect(summaryOf('people', model)).toContain('Amsterdam DC2: no approver');
  });

  test('the review is the first step once nothing required is missing', () => {
    expect(firstIncompleteStep({ org, dcs: [dc()] })).toBe('review');
  });

  test('optional sections count once something is in them', () => {
    const p = { contacts: [], vendors: [{ name: 'Cisco' }], conventions: { cable_colours: [{ color: 'blue' }] }, systems: { record: 'none' }, network: {}, snmp: { configured: false } };
    expect(sectionFilled('vendors', p)).toBe(true);
    expect(sectionFilled('conventions', p)).toBe(true);
    expect(sectionFilled('systems', p)).toBe(false);
    expect(sectionFilled('contacts', p)).toBe(false);
    expect(sectionFilled('snmp', p)).toBe(false);
  });
});

describe('field helpers', () => {
  test('a short code is proposed from the name and never forced', () => {
    expect(proposeCode('Northwind Colocation')).toBe('NC');
    expect(proposeCode('Acme')).toBe('ACME');
    expect(proposeCode('')).toBe('');
    expect(vShortCode('NC')).toBeNull();
    expect(vShortCode('n')).not.toBeNull();
  });

  test('the one-line address is composed from the facility fields', () => {
    expect(composeAddress({ address_line1: 'Rack Row 1', address_line2: '', city: 'Rotterdam', region: '', postcode: '3011 AA', country: 'NL' })).toBe('Rack Row 1, Rotterdam, 3011 AA, Netherlands');
    expect(composeAddress({})).toBe('');
  });

  test('ranges, emails and counts are checked before they are sent', () => {
    expect(vCidr('10.10.1.0/24')).toBeNull();
    expect(vCidr('fd00::/64')).toBeNull();
    expect(vCidr('10.10.1.999/24')).toBe('An octet is above 255');
    expect(vCidr('not a range')).not.toBeNull();
    expect(vEmail('priya@northwind.example')).toBeNull();
    expect(vEmail('priya@')).not.toBeNull();
    expect(vCount('12')).toBeNull();
    expect(vCount('-1')).not.toBeNull();
    expect(vCount('')).toBeNull();
  });
});
