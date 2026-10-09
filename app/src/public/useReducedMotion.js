import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

// True when the public pages should not move: the system asks for reduced motion, or the pages'
// own Motion switch is off (PublicLayout hands { still, reducedMotion } to its outlet). Both are
// read live, so an animation that is running can be cancelled the moment either one changes.
const QUERY = '(prefers-reduced-motion: reduce)';

const systemPrefersLess = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches);

export const useReducedMotion = () => {
  const context = useOutletContext();
  const [system, setSystem] = useState(systemPrefersLess);

  useEffect(() => {
    const query = window.matchMedia?.(QUERY);
    if (!query) return undefined;
    const update = () => setSystem(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return Boolean(system || context?.still || context?.reducedMotion);
};
