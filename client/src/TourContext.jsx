import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOUR_STEPS } from './tourSteps.js';
import { getItem, setItem } from './utils/safeStorage';

const TourContext = createContext(null);

// Shown once per device: answering the "New to RackTrack?" prompt either way
// (taking the tour, or declining it) is remembered, so it never interrupts a
// returning user again. Storage that throws — blocked site data, full quota —
// degrades to "ask again next load" rather than breaking the app, which is
// what safeStorage guarantees.
const ASKED_KEY = 'racktrack:tour-asked';

export function TourProvider({ children }) {
  const navigate = useNavigate();
  const [asked, setAsked] = useState(() => getItem(ASKED_KEY) === '1');
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const showIntro = !asked;

  const markAsked = useCallback(() => {
    setItem(ASKED_KEY, '1');
    setAsked(true);
  }, []);

  const dismissIntro = useCallback(() => {
    markAsked();
  }, [markAsked]);

  const startTour = useCallback(() => {
    markAsked();
    setStepIndex(0);
    setActive(true);
    navigate('/scan');
  }, [markAsked, navigate]);

  const stopTour = useCallback(() => {
    setActive(false);
  }, []);

  // Browser/hardware back (and the Android back button, which also drives
  // history via navigate(-1) in AndroidBackHandler) fires a native
  // `popstate` event — stopping the tour here catches all of those in one
  // place, on top of the explicit in-page "Back" buttons calling stopTour()
  // themselves before they navigate.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    const onPopState = () => { if (activeRef.current) stopTour(); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [stopTour]);

  const advance = useCallback(() => {
    setStepIndex((i) => {
      const next = i + 1;
      if (next >= TOUR_STEPS.length) {
        setActive(false);
        return i;
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    showIntro,
    dismissIntro,
    startTour,
    stopTour,
    advance,
    active,
    stepIndex,
    steps: TOUR_STEPS,
    currentStep: active ? TOUR_STEPS[stepIndex] : null,
  }), [showIntro, dismissIntro, startTour, stopTour, advance, active, stepIndex]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  return useContext(TourContext);
}
