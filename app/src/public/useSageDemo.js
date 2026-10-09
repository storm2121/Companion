import { useState } from 'react';

// The logic behind the Sage preview (SagePreview.jsx): which goal is chosen — none at first, so
// the note shows as it was written — which version each chosen goal is showing, and the
// screen-reader status line. Choosing a goal applies it at once: there is no Run, because every
// result is prepared (sageDemoData.js) and the motion around it is paint only (useNoteMotion.js).
// Every goal works on the same original note, and Before always means that original.
export const useSageDemo = (examples) => {
  const [activeId, setActiveId] = useState(null);
  // Per goal chosen so far: the version on show ('after' | 'before').
  const [runs, setRuns] = useState({});
  // The goal just applied: its changed words get their highlight once, then never again.
  const [fresh, setFresh] = useState(null);
  const [status, setStatus] = useState('');

  const example = examples.find((item) => item.id === activeId) ?? null;
  const view = example ? (runs[example.id] ?? 'after') : 'before';

  const choose = (id) => {
    const next = examples.find((item) => item.id === id);
    if (!next) return;
    setActiveId(id);
    setRuns((prev) => ({ ...prev, [id]: 'after' }));
    setFresh(id);
    setStatus(`Showing Sage’s version. ${next.note}`);
  };

  const show = (version) => {
    if (!example) return;
    setRuns((prev) => ({ ...prev, [example.id]: version }));
    setFresh(null);
    setStatus(version === 'before' ? 'This is the note as it was written.' : 'Back to Sage’s version.');
  };

  return {
    example,
    // The note every goal starts from.
    original: examples[0],
    view,
    tried: (id) => Boolean(runs[id]),
    fresh: Boolean(example) && fresh === example.id && view === 'after',
    status,
    choose,
    show,
  };
};
