// Which of the rack's two workflows a person is in.
//
// After a scan there are two jobs, and the rack's Overview asks which:
//
//   analyse the network   the rack as a whole - what its switches report, what
//                         the report says, what has drifted from the record.
//   look up a port        one socket - which device it is on, what is in it,
//                         what the switch says about it.
//
// They are different jobs, so they get different tab bars, and a bar is only
// worth having if it is the same bar on every screen of the job. That is what
// this file is for. The choice used to be page state on the results page, so
// it died the moment the person opened Network or Switches - which are routes
// of their own - and the bar under them silently became the other workflow's.
//
// Held per rack, for the session only: a rack opened again tomorrow, or from
// History, or after a new scan, starts on the network workflow, which is the
// one the Overview offers first.

import { getItem, setItem, removeItem } from './safeStorage.js';

export const NETWORK = 'network';
export const PORT = 'port';

const KEY = (rackId) => `rt.rack.flow.${rackId}`;
/** Fired on every change so both bars - the one the results page draws and the
 *  one the phone's bottom nav draws - redraw together. */
export const RACK_FLOW_EVENT = 'rt:rack-flow-changed';

/** The workflow this rack is in. Unset, unreadable or unknown → the network one. */
export function getRackFlow(rackId) {
  if (!rackId) return NETWORK;
  return getItem(KEY(rackId), 'session') === PORT ? PORT : NETWORK;
}

export function setRackFlow(rackId, flow) {
  if (!rackId) return;
  if (flow === PORT) setItem(KEY(rackId), PORT, 'session');
  else removeItem(KEY(rackId), 'session');
  try {
    window.dispatchEvent(new CustomEvent(RACK_FLOW_EVENT, { detail: { rackId, flow: flow === PORT ? PORT : NETWORK } }));
  } catch { /* no window (tests, SSR) - the next read still gets the value */ }
}

/** Back to the workflow the Overview offers first. */
export const clearRackFlow = (rackId) => setRackFlow(rackId, NETWORK);
