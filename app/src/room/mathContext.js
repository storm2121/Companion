import { createContext } from 'react';

// How a math block tells the note which formula has the caret, so the dock can swap the
// text toolbar for the math one. The value is a setter: a block passes
// { id, insert(tex) } when focused, and clears it when it loses focus.
export const MathToolContext = createContext(null);
