import { getJSON, removeItem, setItem } from './safeStorage';

// Which of the two jobs a person is doing with a rack.
//
//   analyse  "Analyse the network": Overview, Network, Drift, Report, Timeline.
//            The default after a scan and whenever a rack is opened.
//   port     "Look up a port": Result, Switches, Network, Topology, Timeline.
//            Entered by that button on the review page, left by that screen's
//            own Back.
//
// Network and Timeline belong to both, and Network is a page of its own, so
// the choice has to outlive the page it was made on. It is kept here and read
// by every rack tab bar. One rack at a time, and only for this visit: leaving
// the rack's pages forgets it, so a rack opened again starts on 'analyse'.
const KEY = 'rt.rack.flow';

export const RACK_FLOWS = ['analyse', 'port'];

/** The flow this rack is in: 'port' only while that rack is in the port flow. */
export function getRackFlow(rackId) {
  const kept = getJSON(KEY, null, 'session');
  return kept && rackId != null && kept.rackId === String(rackId) && kept.flow === 'port' ? 'port' : 'analyse';
}

/** Entering the port flow keeps it; 'analyse' is the default, so it is simply forgotten. */
export function setRackFlow(rackId, flow) {
  if (flow === 'port' && rackId != null) setItem(KEY, JSON.stringify({ rackId: String(rackId), flow }), 'session');
  else removeItem(KEY, 'session');
}

export const clearRackFlow = () => removeItem(KEY, 'session');
