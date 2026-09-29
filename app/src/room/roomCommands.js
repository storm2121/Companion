// ⌘K's page actions. A page offers the actions that only make sense while it is open — a
// note's "Find in this note", a course's "New note here" — and they go when the page does.
// The palette (RoomSearch) reads them each time it renders and lists them before the
// room-wide ones.
//
// Kept outside React state on purpose: a page re-offers its actions after every render
// (their labels follow its state — "Pin" / "Unpin"), and that must not re-render anything.
// A page passes a FUNCTION returning its actions, called only when the palette shows them:
// building the list is then never work done in the page's own render.
// Each action is { id, label, keywords?, hint?, run }.

import { useEffect, useRef } from 'react';

const providers = new Set();

export const usePageActions = (build) => {
  const latest = useRef(build);
  useEffect(() => {
    latest.current = build;
  });
  useEffect(() => {
    const provider = () => latest.current?.() || [];
    providers.add(provider);
    return () => {
      providers.delete(provider);
    };
  }, []);
};

export const pageActions = () => [...providers].flatMap((provider) => provider());
