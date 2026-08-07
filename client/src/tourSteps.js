// Guided-tour step config for first-time users. Each step names a
// `data-tour="..."` anchor already present in the real page (ScanPage.jsx /
// ResultsPage.jsx) — the tour never renders fake UI, it spotlights the real
// element and waits for the real interaction before advancing.
//
// event: which DOM event on the anchor (or `advanceSelector`, if set) counts
// as "done" for this step. Defaults to 'click'.
// optional: if the anchor never appears (e.g. no incident tickets for this
// org), the step is skipped automatically instead of stalling the tour.
// advanceWhenVisible: some steps don't complete via a click on their own
// target — they complete once the app reaches a new state (a photo was
// actually chosen, however that happened: file picker, drag-drop, camera
// capture, or enough photos for multi-mode). A raw CSS selector that
// matches once that state is reached advances the step automatically,
// instead of requiring a specific click.
export const TOUR_STEPS = [
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
    body: 'If this scan is for a specific ticket, tap here to link it — otherwise you can skip this.',
    optional: true,
  },
  {
    id: 'analyze',
    target: 'analyze-rack-btn',
    title: 'Analyze the rack',
    body: 'When the photo looks good, tap Analyze Rack to scan it.',
  },
  {
    id: 'pick-device',
    target: 'device-picker',
    title: 'Pick a device',
    body: 'Choose the device you’re working on, or tap it directly in the rack photo.',
    event: 'change',
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
    body: 'Tap the photo to switch from rack view to a close-up device view.',
  },
  {
    id: 'full-report',
    // Anchored to the View chip in the report row. The original copy named a
    // "Full Device & Port Report" button, which exists in the prototype this
    // came from but not here — the instruction has to match the label the user
    // is actually looking at.
    target: 'full-report-btn',
    title: 'See the full report',
    body: 'Tap View to open the full report for this device and port.',
  },
];
