import { createPageNote } from '../services/library';
import { startingBlocks } from './pageBlocks';

// A new note in a course, the room's one way (Ctrl K's "New note in …", the desk's small notebook): made on
// this device and opened at once, online or not (`createPageNote` stamps format:'page'); a refusal is logged.
export const startNote = (uid, courseId, navigate, title = '') => {
  if (!uid || !courseId) return null;
  const { id, saved } = createPageNote(uid, courseId, {
    title: title.trim().slice(0, 120) || 'Untitled',
    blocks: startingBlocks(),
  });
  saved.catch((err) => console.error('The server refused that note', err));
  navigate(`/room/note/${courseId}/${id}`);
  return id;
};
