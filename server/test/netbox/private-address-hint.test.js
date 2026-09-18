/**
 * A silent switch on a private address is a different problem from a silent
 * switch on a reachable one, and the hint has to say which.
 *
 * Found on the hosted demo: three switches were added at 192.168.1.11, .12 and
 * .100 - real switches, on the company LAN, answering perfectly well to a phone
 * standing next to them. The demo server is a public host in a datacentre with
 * no tunnel to that network, so every read timed out, and the hint it printed
 * told whoever read it to go and check SNMP settings and ACLs on the switch.
 * There was nothing wrong with the switches. No setting on them could have
 * helped, because the packets never left the datacentre.
 */
const test = require('node:test');
const assert = require('node:assert');

const { _internal } = require('../../lib/netbox/snmp');
const { isPrivateHost, timeoutHint } = _internal;

test('the ranges that only exist inside somebody own network are known', () => {
  for (const host of [
    '192.168.1.100',   // the demo's switches
    '10.10.1.1',       // the office gateway
    '172.16.0.4', '172.31.255.254',
    '169.254.1.1',     // link local
    '100.64.0.1',      // carrier grade NAT
    '127.0.0.1',
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} is private`);
  }
});

test('a routable address is not mistaken for a private one', () => {
  // 172.32 and 172.15 sit either side of the 172.16/12 block, and 100.128 just
  // past the carrier grade NAT block. An off by one here would tell someone
  // with a genuinely reachable switch to go and read it on a phone instead.
  for (const host of ['82.29.164.213', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1']) {
    assert.equal(isPrivateHost(host), false, `${host} is routable`);
  }
});

test('a private address is told it is unreachable, not told to check the switch first', () => {
  const hint = timeoutHint('192.168.1.100');
  assert.match(hint, /192\.168\.1\.100/, 'it names the address');
  assert.match(hint, /private address/i, 'and says what kind of address that is');
  assert.match(hint, /no route|no change on the switch/i,
    'and says plainly that the switch is not the thing to change');
  assert.match(hint, /phone/i, 'and points at the path that does work');
});

test('the switch side causes are still given, for a server that is on the network', () => {
  // Self hosted inside the LAN is a supported deployment, and there the old
  // advice is exactly right - so it must survive, not be replaced.
  const hint = timeoutHint('192.168.1.100');
  assert.match(hint, /SNMP may be disabled/, 'the real causes are still listed');
  assert.match(hint, /IS on that network/, 'under the condition that makes them apply');

  const routable = timeoutHint('82.29.164.213');
  assert.match(routable, /SNMP may be disabled/);
  assert.doesNotMatch(routable, /private address/i,
    'a routable host is not given the private address explanation');
});
