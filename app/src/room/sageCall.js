import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

// The room's Sage call — ONE request that both versions of the server understand.
//
// A server with the page path (functions/lib/pageSage.js) sees `format: 'page'` and reads
// the room's own blocks from `page`: callouts, code, math and checklists as themselves.
// A server deployed before that path ignores those fields and runs classic's contract on
// `styles`, `addons` and `blocks` (the room's blocks translated to text and image) — an
// answer the room can still apply (sageBridge.js). So the room keeps working whichever
// version is live, and gets the better answer as soon as the new one is.
export const callRoomSage = async (payload) => {
  const fn = httpsCallable(functions, 'sageImprove', { timeout: 120000 });
  const res = await fn(payload);
  return res.data;
};
