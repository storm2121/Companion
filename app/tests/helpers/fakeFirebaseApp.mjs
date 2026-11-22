// Stands in for src/firebase.js and for `firebase/functions` in tests/library.unit.test.mjs:
// library.js only needs the two handles to exist and the callables to be creatable.
export const db = {};
export const functions = {};
export const httpsCallable = () => async () => ({ data: {} });
