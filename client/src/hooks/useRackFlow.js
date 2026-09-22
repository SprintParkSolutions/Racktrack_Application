import { useEffect, useState } from 'react';
import { getRackFlow, RACK_FLOW_EVENT } from '../utils/rackFlow.js';

/**
 * The workflow this rack is in, kept up to date.
 *
 * Two places draw the rack's tab bar - the results page draws its own, and the
 * phone's bottom nav draws it on every other page of the rack - and they have
 * to agree on which bar that is at every moment, including the moment the
 * person chooses. So both read it through here and both hear the change.
 */
export function useRackFlow(rackId) {
  const [flow, setFlow] = useState(() => getRackFlow(rackId));
  useEffect(() => {
    setFlow(getRackFlow(rackId));
    const onChange = (e) => {
      // Another rack's choice is not this rack's business.
      if (e?.detail?.rackId && String(e.detail.rackId) !== String(rackId)) return;
      setFlow(getRackFlow(rackId));
    };
    window.addEventListener(RACK_FLOW_EVENT, onChange);
    return () => window.removeEventListener(RACK_FLOW_EVENT, onChange);
  }, [rackId]);
  return flow;
}

export default useRackFlow;
