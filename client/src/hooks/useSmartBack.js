import { useNavigate } from 'react-router-dom';

// A back handler that never dead-ends. Plain navigate(-1) does nothing when
// there's no history to go back to — which happens a lot on mobile: a cold
// start straight onto a page, a deep link, or after a replace-navigation (e.g.
// the scan-resume redirect). In those cases we send the user to a sensible
// fallback instead of leaving the button inert.
export function useSmartBack(fallback = '/scan') {
  const navigate = useNavigate();
  return () => {
    // React Router stamps its stack position on history.state.idx. > 0 means
    // there's a real previous entry; 0 or null means we're at the first one.
    const idx = window.history.state && window.history.state.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback);
  };
}
