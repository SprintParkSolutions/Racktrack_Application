/**
 * Reading a ticket, and answering it with a photograph.
 *
 * The second workflow turns somebody's sentence into a question a photograph
 * can settle. Two ways it can go wrong, and both are worse than saying
 * nothing: reading a claim that is not there (and sending a technician to the
 * wrong rack), and answering one it cannot see (and telling them a port is
 * fine when a photograph cannot know).
 *
 * So these tests hold the conservative line: what is read, what is refused,
 * and which answers are allowed to be certain.
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { decode, answer } = require('../../lib/approvals/claim');

const RACK = {
  devices: [
    { label: 'Core router', class_name: 'router', unit: 20 },
    { label: 'SW02', class_name: 'switch', unit: 18, port_count: 24 },
    { label: 'PP-01', class_name: 'patch_panel', unit: 12, port_count: 24 },
  ],
};

describe('reading what a ticket claims', () => {
  it('reads the rack, the shelf and the thing, out of a sentence', () => {
    const c = decode('SP-HYB-RM01-R01-R1: core router is on U22, record says U20');
    assert.equal(c.rackName, 'SP-HYB-RM01-R01-R1');
    assert.equal(c.unit, 22);
    assert.equal(c.device, 'router');
    assert.equal(c.asks, 'moved');
    assert.equal(c.rackId, null);
  });

  it("reads a scan's own id, and does not read it as a rack name", () => {
    const c = decode('Port 14 on SW02 is dead - rack RK-5B81BE87');
    assert.equal(c.rackId, 'RK-5B81BE87');
    assert.equal(c.rackName, null, 'the hash of a photograph is not a name');
    assert.equal(c.port, 14);
    assert.equal(c.device, 'switch');
  });

  it('refuses a sentence with nothing a photograph can settle', () => {
    assert.equal(decode('the printer in accounts is jammed'), null);
    assert.equal(decode(''), null);
    assert.equal(decode(null), null);
  });

  it('does not read a shelf out of a device name that contains one', () => {
    // SP-R1-U20-ACT is what the record calls the device, not a claim about U20.
    const c = decode('Confirm SP-R1-U20-ACT is still there');
    assert.equal(c.unit, null);
    assert.equal(c.rackName, 'SP-R1-U20-ACT');
  });
});

describe('answering it with the photograph', () => {
  it('says what is on the shelf the ticket names, and what is not', () => {
    const a = answer(decode('SP-HYB-RM01-R01-R1: router is on U22'), RACK);
    assert.equal(a.verdict, 'differs');
    assert.match(a.says, /the router is on U22/);
    assert.match(a.found, /U22 is empty/);
    assert.match(a.found, /router is on U20/);
  });

  it('agrees when the rack is as the ticket describes it', () => {
    const a = answer(decode('Confirm the switch on U18'), RACK);
    assert.equal(a.verdict, 'agrees');
    assert.match(a.found, /SW02 on U18/);
  });

  it('will not say whether a port is passing traffic', () => {
    const a = answer(decode('Port 14 on SW02 is dead'), RACK);
    assert.equal(a.verdict, 'unsure', 'a photograph cannot see traffic');
    assert.match(a.found, /24 ports/);
    assert.match(a.found, /Read the switch/);
  });

  it('says plainly when the thing the ticket names is not in the rack', () => {
    const a = answer(decode('Please confirm the firewall'), RACK);
    assert.equal(a.verdict, 'differs');
    assert.match(a.found, /no firewall/);
  });

  it('answers nothing when there is no photograph yet, and does not guess', () => {
    const a = answer(decode('router on U22'), { devices: [] });
    assert.equal(a.verdict, 'unsure');
    assert.match(a.found, /has not been read/);
    const none = answer(null, RACK);
    assert.equal(none.verdict, 'unsure');
  });
});
