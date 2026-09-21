// Guided-tour step config for first-time users. Each step names a
// `data-tour="..."` anchor already present in the real page (ScanPage.jsx /
// ResultsPage.jsx) - the tour never renders fake UI, it spotlights the real
// element and waits for the real interaction before advancing.
//
// event: which DOM event on the anchor (or `advanceSelector`, if set) counts
// as "done" for this step. Defaults to 'click'.
// optional: if the anchor never appears (e.g. no incident tickets for this
// org), the step is skipped automatically instead of stalling the tour.
// advanceWhenVisible: some steps don't complete via a click on their own
// target - they complete once the app reaches a new state (a photo was
// actually chosen, however that happened: file picker, drag-drop, camera
// capture, or enough photos for multi-mode). A raw CSS selector that
// matches once that state is reached advances the step automatically,
// instead of requiring a specific click.
export const TOUR_STEPS = [
  {
    // Only a person with more than one Site and none chosen ever sees this
    // step. Analyze stays shut until a Site is chosen, so without it the next
    // step waited on a button that could not come alive while the dim layer
    // kept the list out of reach. It completes on the state, not on a tap: a
    // tap in the search field chooses nothing. The scan page marks itself once
    // the site list has answered and nothing is left to choose - straight
    // away for one Site, a remembered choice or a server without the list, and
    // then the step passes without ever being drawn.
    id: 'choose-site',
    target: 'site-picker',
    advanceWhenVisible: '[data-scan-site="settled"]',
    title: 'Choose the site',
    body: 'Tap the site this rack is in.',
  },
  {
    id: 'select-image',
    target: 'media-drop-zone',
    advanceWhenVisible: '[data-tour="analyze-rack-btn"]:not(:disabled)',
    title: 'Add your rack photo',
    body: 'Tap the frame to choose a photo (or drag one in).',
  },
  {
    id: 'incident-link',
    target: 'incident-dropdown',
    title: 'Link an incident (optional)',
    // The title already says "(optional)", so the body does not also offer the skip.
    body: 'Tap here to link a ticket.',
    optional: true,
  },
  {
    id: 'analyze',
    target: 'analyze-rack-btn',
    // Completes when the results actually arrive, not when the button is
    // pressed. Pressing Analyze is not the same as analysing: the image
    // quality gate can answer with "the image appears tilted - retake or
    // proceed anyway", and the scan has not run. Advancing on the click sent
    // the tour to "Pick a device" while the user was still on the scan page
    // deciding, so it asked for something that was not on screen and could
    // not be.
    advanceWhenVisible: '[data-tour="device-picker"]',
    title: 'Analyze the rack',
    body: 'Tap Analyze Rack.',
  },
  {
    id: 'pick-device',
    target: 'device-picker',
    title: 'Pick a device',
    // Not "or tap it directly in the rack photo": the very next step asks them to
    // tap it in the photo, so offering it here as an alternative to this step
    // contradicted the step after it.
    body: 'Choose the device you are working on.',
    event: 'change',
  },
  {
    // Testers picked a device from the dropdown and then stalled: the tour went
    // straight on to Find Port, so nothing ever told them to tap that device
    // where it actually sits in the rack. The dropdown copy mentions it, but a
    // parenthetical in a <select> is not guidance. Advancing on a click
    // anywhere on the rack image keeps it forgiving - the point is that they
    // look at the photo, not that they hit the box precisely.
    id: 'tap-device-in-rack',
    target: 'rack-image',
    title: 'Now find it in the photo',
    body: 'Tap that device in the photo.',
  },
  {
    id: 'find-port',
    target: 'port-input-row',
    advanceSelector: 'find-port-btn',
    title: 'Find the port',
    body: 'Type a port number, then tap Find Port.',
  },
  {
    id: 'port-image',
    target: 'port-image-tap',
    title: 'View the port',
    body: 'Tap the photo for a close-up.',
  },
  {
    id: 'full-report',
    // Anchored to the View chip in the report row. The original copy named a
    // "Full Device & Port Report" button, which exists in the prototype this
    // came from but not here - the instruction has to match the label the user
    // is actually looking at.
    target: 'full-report-btn',
    title: 'See the full report',
    body: 'Tap View to open the full report for this device and port.',
  },
];
