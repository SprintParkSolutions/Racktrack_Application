import { describe, test, expect } from 'vitest';
import {
  confidenceWord, confirmedLine, evidenceDetail, evidenceSentence,
  matchConfirmation, matchIsTrusted, plainDashes, serverReportsConfirmations,
  settleAdvice, unclearMatch, whenText,
} from './matchEvidence';

const ev = (kind, rank, detail) => ({ kind, rank, detail });

// The long dashes an older server can send, built from codes so that this file
// contains none of them: figure dash, en dash, em dash, horizontal bar.
const [FIG, EN, EM, BAR] = [8210, 8211, 8212, 8213].map((c) => String.fromCharCode(c));

describe('evidenceSentence', () => {
  test('one reason reads as one sentence', () => {
    expect(evidenceSentence({ evidence: [ev('serial', 1, 'FOC1234X5YZ')] }))
      .toBe('The serial number matches.');
  });

  test('two and three reasons share the verb', () => {
    expect(evidenceSentence({ evidence: [ev('serial', 1), ev('model', 2)] }))
      .toBe('The serial number and the model match.');
    expect(evidenceSentence({ evidence: [ev('serial', 1), ev('model', 2), ev('vendor', 3)] }))
      .toBe('The serial number, the model and the make match.');
  });

  test('more than three counts the rest rather than listing them', () => {
    const sentence = evidenceSentence({
      evidence: [ev('serial', 1), ev('chassis', 2), ev('model', 3), ev('vendor', 4), ev('ports', 5)],
    });
    expect(sentence).toBe('The serial number, the chassis number and 3 more details match.');
  });

  test('strongest first, whichever order the server sent', () => {
    expect(evidenceSentence({ evidence: [ev('ports', 9), ev('serial', 1)] }))
      .toBe('The serial number and the number of ports match.');
  });

  test('weak evidence on its own says so in the same breath', () => {
    expect(evidenceSentence({ evidence: [ev('ports', 1)] }))
      .toBe('The number of ports matches, and nothing else matches.');
    expect(evidenceSentence({ evidence: [ev('ports', 1), ev('size', 2)] }))
      .toBe('The number of ports and the space it takes in the rack match, and nothing else matches.');
  });

  test('no evidence falls back to the short reason, with plain hyphens', () => {
    expect(evidenceSentence({ why: `same port count ${EM} the only box it could be` }))
      .toBe('Same port count - the only box it could be.');
  });

  test('an older server that sends nothing at all still says something true', () => {
    expect(evidenceSentence(null))
      .toBe('Nothing about this box has been checked against the switch yet.');
  });

  test('a field name never reaches the screen', () => {
    const sentence = evidenceSentence({ evidence: [ev('sysname', 1), ev('host', 2)] });
    expect(sentence).toBe('The name the switch gives itself and the address used to reach it match.');
    expect(sentence).not.toMatch(/sysname|host|rank|\d/);
  });

  test('evidence of a kind this build does not know is ignored, not printed', () => {
    expect(evidenceSentence({ evidence: [ev('quantum_flux', 1), ev('serial', 2)] }))
      .toBe('The serial number matches.');
  });
});

describe('evidenceDetail', () => {
  test('spells out the strongest reason for checking against the label', () => {
    expect(evidenceDetail({ evidence: [ev('ports', 2, '24'), ev('serial', 1, 'FOC1234X5YZ')] }))
      .toBe('The serial number: FOC1234X5YZ');
  });

  test('nothing to show when the server sent no detail', () => {
    expect(evidenceDetail({ evidence: [ev('serial', 1)] })).toBe('');
    expect(evidenceDetail(null)).toBe('');
  });
});

describe('confidenceWord', () => {
  test('the four words the screen uses', () => {
    expect(confidenceWord({ confidence: 'confirmed' }, true).word).toBe('Confirmed');
    expect(confidenceWord({ confidence: 'probable' }, true).word).toBe('Probably');
    expect(confidenceWord({ confidence: 'possible' }, true).word).toBe('Possibly');
    expect(confidenceWord({ confidence: 'unidentified' }, false).word).toBe('Not identified');
  });

  test('an older server never reads as certain', () => {
    expect(confidenceWord({ confidence: 'high' }, true).word).toBe('Probably');
    expect(confidenceWord({ confidence: 'medium' }, true).word).toBe('Possibly');
    expect(confidenceWord({ confidence: 'low' }, true).word).toBe('Possibly');
  });

  test('nothing said at all', () => {
    expect(confidenceWord(null, true).word).toBe('Possibly');
    expect(confidenceWord(null, false).word).toBe('Not identified');
  });
});

describe('settleAdvice', () => {
  test('two boxes that look the same say what would tell them apart', () => {
    expect(settleAdvice({ confidence: 'possible', candidateCount: 2, margin: 0 }, true))
      .toBe('Two boxes here look the same. Read the serial number off the label on one of them to tell them apart.');
  });

  test('nothing in the photo looks like it', () => {
    expect(settleAdvice({ confidence: 'unidentified', candidateCount: 0, margin: 0 }, false))
      .toBe('Nothing in the photo looks like this switch. Check it is in this rack, or choose the box yourself.');
  });

  test('one candidate and nothing matching', () => {
    expect(settleAdvice({ confidence: 'unidentified', candidateCount: 1, margin: 3 }, false))
      .toBe('One box could be this switch, but nothing about it matches yet. Read the serial number off the label to be sure.');
  });

  test('a clear match is left alone', () => {
    expect(settleAdvice({ confidence: 'confirmed', candidateCount: 3, margin: 40 }, true)).toBe('');
  });

  test('an older server with no counts still gets a usable line', () => {
    expect(settleAdvice({ confidence: 'low' }, false))
      .toBe('This switch has not been matched. Choose the box it is, or leave it as not in this rack.');
  });
});

describe('unclearMatch', () => {
  test('a tie and an unidentified box are both unclear', () => {
    expect(unclearMatch({ confidence: 'unidentified' })).toBe(true);
    expect(unclearMatch({ confidence: 'possible', candidateCount: 2, margin: 0 })).toBe(true);
  });

  test('a clear winner is not', () => {
    expect(unclearMatch({ confidence: 'probable', candidateCount: 2, margin: 15 })).toBe(false);
    expect(unclearMatch({ confidence: 'confirmed' })).toBe(false);
    expect(unclearMatch(null)).toBe(false);
  });
});

describe('matchConfirmation', () => {
  const sw = { id: 7 };

  test('reads a confirmation off the switch entry', () => {
    const view = { switches: [{ id: 7, confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' }] };
    const c = matchConfirmation(view, view.switches[0]);
    expect(c.confirmed).toBe(true);
    expect(c.by).toBe('Jane Patel');
  });

  test('reads one out of a confirmations map, including a plain true', () => {
    expect(matchConfirmation({ confirmations: { 7: { confirmedAt: '2026-09-18T09:30:00Z' } } }, sw).confirmed).toBe(true);
    expect(matchConfirmation({ confirmations: { 7: true } }, sw).confirmed).toBe(true);
  });

  test('a person it names as an object still gets a name', () => {
    const view = { reasons: { 7: { confirmed: true, confirmedBy: { name: 'Sam Okoro' } } } };
    expect(matchConfirmation(view, sw).by).toBe('Sam Okoro');
  });

  test('a match from an earlier check is marked but is not a confirmation', () => {
    const c = matchConfirmation({ reasons: { 7: { fromBinding: true } } }, sw);
    expect(c.fromBinding).toBe(true);
    expect(c.confirmed).toBe(false);
  });

  test('a server that says nothing claims nothing', () => {
    const c = matchConfirmation({ reasons: { 7: { why: 'same port count' } } }, sw);
    expect(c).toEqual({ confirmed: false, fromBinding: false, at: '', by: '' });
  });
});

describe('confirmedLine', () => {
  test('names the person and the day', () => {
    const line = confirmedLine({ confirmed: true, by: 'Jane Patel', at: '2026-09-18T09:30:00Z' });
    expect(line.startsWith('Jane Patel confirmed this on ')).toBe(true);
    expect(line.endsWith('.')).toBe(true);
  });

  test('a confirmation with no date or name still reads', () => {
    expect(confirmedLine({ confirmed: true, by: '', at: '' })).toBe('A person confirmed this match.');
    expect(confirmedLine({ confirmed: false })).toBe('');
  });
});

describe('serverReportsConfirmations and matchIsTrusted', () => {
  const older = { switches: [{ id: 1, matchedTo: 'd1' }], reasons: { 1: { confidence: 'high', why: 'same port count' } } };
  const newer = { switches: [{ id: 1, matchedTo: 'd1' }], reasons: { 1: { confidence: 'probable', evidence: [ev('ports', 1)], candidateCount: 2 } } };

  test('an older server is not asked a question it cannot answer', () => {
    expect(serverReportsConfirmations(older)).toBe(false);
    expect(matchIsTrusted(older, older.switches[0])).toBe(true);
  });

  test('a newer server reports them, and an unconfirmed match is not trusted', () => {
    expect(serverReportsConfirmations(newer)).toBe(true);
    expect(matchIsTrusted(newer, newer.switches[0])).toBe(false);
  });

  test('a match from a previous check is trusted without confirming again', () => {
    const bound = { switches: [{ id: 1, matchedTo: 'd1' }], reasons: { 1: { evidence: [], fromBinding: true } } };
    expect(matchIsTrusted(bound, bound.switches[0])).toBe(true);
  });

  test('nothing at all is not a reason to doubt anything', () => {
    expect(serverReportsConfirmations(null)).toBe(false);
    expect(serverReportsConfirmations({})).toBe(false);
  });
});

describe('plainDashes and whenText', () => {
  test('every long dash becomes the plain hyphen', () => {
    expect(plainDashes(`a ${EM} b ${EN} c ${FIG} d ${BAR} e`)).toBe('a - b - c - d - e');
    expect(plainDashes(null)).toBe('');
  });

  test('a date reads as a date, and nonsense reads as nothing', () => {
    expect(whenText('2026-09-18T09:30:00Z')).toMatch(/2026/);
    expect(whenText('not a date')).toBe('');
    expect(whenText('')).toBe('');
  });
});
