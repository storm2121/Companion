import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/authState';
import { getNoteAsOf } from '../../services/library';
import { photosOf } from '../pageBlocks';
import { noteTime } from '../roomData';
import { Overlay } from './Overlay';

// Files — the outlined pill on a course (design 6b). The room's only files are photos, so
// this is every photo on the course's notes (board, page and columns), grouped by note,
// newest note first. A photo opens the note it lives on.
//
// Reading: each note's content comes through `getNoteAsOf` — this device's copy unless the
// note changed since, then the server's — a few at a time, and is kept for the rest of the
// visit stamped with when the note last changed, so reopening Files reads only what changed.

// noteId -> { stamp, photos }
const seen = new Map();
const stampOf = (note) => note?.contentUpdatedAt?.toMillis?.() || noteTime(note);
const BATCH = 6;

const FilesBody = ({ course, notes, onClose }) => {
  const navigate = useNavigate();
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid;
  const courseId = course.id;
  const [found, setFound] = useState(() => new Map(seen));
  const [missed, setMissed] = useState(() => new Set());

  const unread = notes.filter((note) => !missed.has(note.id) && found.get(note.id)?.stamp !== stampOf(note));
  // One string, so the effect follows WHICH notes come next, not a new array each render.
  const nextBatch = unread
    .slice(0, BATCH)
    .map((note) => `${note.id}/${stampOf(note)}`)
    .join(',');

  useEffect(() => {
    if (!nextBatch || !uid) return undefined;
    let cancelled = false;
    const batch = nextBatch.split(',').map((item) => {
      const [id, stamp] = item.split('/');
      return { id, stamp: Number(stamp) };
    });
    Promise.all(
      batch.map((note) =>
        getNoteAsOf(uid, courseId, note.id, note.stamp)
          .then((full) => ({ note, photos: photosOf(full?.blocks || []) }))
          .catch(() => ({ note, photos: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const failed = [];
      results.forEach(({ note, photos }) => {
        if (photos === null) failed.push(note.id);
        else seen.set(note.id, { stamp: note.stamp, photos });
      });
      setFound(new Map(seen));
      if (failed.length) setMissed((prev) => new Set([...prev, ...failed]));
    });
    return () => {
      cancelled = true;
    };
  }, [nextBatch, uid, courseId]);

  const groups = notes
    .map((note) => ({ note, photos: found.get(note.id)?.photos || [] }))
    .filter((group) => group.photos.length);
  const total = groups.reduce((sum, group) => sum + group.photos.length, 0);

  const open = (note) => {
    onClose();
    navigate(`/room/note/${courseId}/${note.id}`);
  };

  const status = unread.length
    ? `Looking through ${unread.length} ${unread.length === 1 ? 'note' : 'notes'}…`
    : missed.size
      ? `${missed.size} ${missed.size === 1 ? 'note is' : 'notes are'} not on this device yet`
      : total
        ? `${total} ${total === 1 ? 'photo' : 'photos'} on ${groups.length} ${groups.length === 1 ? 'note' : 'notes'}`
        : '';

  return (
    <>
      {status && <p className="room-stamp">{status}</p>}
      {!unread.length && !total && (
        <p className="room-setting-copy">
          No photos on this course&apos;s notes yet. Drop one beside any page and it shows up here.
        </p>
      )}
      {groups.length > 0 && (
        <div className="room-files">
          {groups.map(({ note, photos }) => (
            <div key={note.id} className="room-files-group">
              <button type="button" className="room-files-note" onClick={() => open(note)}>
                {note.title || 'Untitled'}
              </button>
              <div className="room-files-grid">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="room-files-thumb"
                    onClick={() => open(note)}
                    aria-label={`Open ${note.title || 'the note'}`}
                  >
                    <img src={photo.url} alt={photo.alt} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

// The overlay unmounts its contents when closed, so each opening reads afresh from the cache.
const CourseFiles = ({ open, course, notes, onClose }) => (
  <Overlay open={open} onClose={onClose} title={course ? `Files in ${course.name}` : 'Files'}>
    {course && <FilesBody course={course} notes={notes} onClose={onClose} />}
  </Overlay>
);

export default CourseFiles;
