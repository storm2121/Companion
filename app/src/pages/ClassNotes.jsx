import { useEffect, useMemo, useState } from 'react';
import { FaArrowLeft, FaSearch } from 'react-icons/fa';
import { useNavigate, useParams } from 'react-router-dom';
import { listenToNotes, createNote, getClass } from '../services/library';
import { useAuth } from '../context/authState';
import ScreenLoader from '../components/ui/ScreenLoader';

const getNoteTimestamp = (note) => {
  const updated = note?.updatedAt?.toMillis?.();
  if (Number.isFinite(updated)) return updated;
  const created = note?.createdAt?.toMillis?.();
  if (Number.isFinite(created)) return created;
  return 0;
};

const toNoteMeta = (docSnap) => {
  const meta = { ...(docSnap.data() || {}) };
  delete meta.blocks;
  delete meta.canvasHeight;
  return { id: docSnap.id, ...meta };
};

const ClassNotes = () => {
  const { classId } = useParams();
  const { firebaseUser } = useAuth();
  const [classInfo, setClassInfo] = useState(null);
  const [notes, setNotes] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadClass = async () => {
      if (!firebaseUser) return;
      const data = await getClass(firebaseUser.uid, classId);
      setClassInfo(data);
      setLoading(false);
    };
    loadClass();
  }, [firebaseUser, classId]);

  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = listenToNotes(
      firebaseUser.uid,
      classId,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => toNoteMeta(docSnap));
        const ordered = [...items].sort((a, b) => {
          const aHasOrder = Number.isFinite(a.order);
          const bHasOrder = Number.isFinite(b.order);
          if (aHasOrder && bHasOrder) return a.order - b.order;
          if (aHasOrder) return -1;
          if (bHasOrder) return 1;
          return getNoteTimestamp(b) - getNoteTimestamp(a);
        });
        setNotes(ordered);
      },
      (err) => console.error(err),
    );
    return () => unsub();
  }, [firebaseUser, classId]);

  const filtered = useMemo(() => {
    if (!search) return notes;
    const term = search.toLowerCase();
    return notes.filter((note) => note.title?.toLowerCase().includes(term));
  }, [notes, search]);

  const handleAdd = async () => {
    if (!firebaseUser) return;
    try {
      const noteId = await createNote(firebaseUser.uid, classId);
      navigate(`/class/${classId}/note/${noteId}`);
    } catch (err) {
      console.error('Failed to create note', err);
    }
  };

  if (loading) {
    return <ScreenLoader note="Opening class..." />;
  }

  if (!classInfo) {
    return (
      <div className="gate-shell">
        <div className="gate-card centered">
          <p className="status-text">Class not found.</p>
          <button className="ghost-btn" onClick={() => navigate('/dashboard')}>
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="top-bar">
        <button className="ghost-btn" onClick={() => navigate('/dashboard')}>
          <FaArrowLeft /> Back
        </button>
        <h3>{classInfo.name}</h3>
        <button className="ghost-btn" onClick={() => setSearchOpen((prev) => !prev)}>
          <FaSearch />
        </button>
      </header>
      {searchOpen && (
        <div className="main-body">
          <input
            placeholder="Search notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <section className="note-grid">
        {filtered.map((note, index) => (
          <div
            key={note.id}
            className="note-card"
            onClick={() => navigate(`/class/${classId}/note/${note.id}`)}
          >
            <span className="note-number">{String(index + 1).padStart(2, '0')}</span>
            <strong>{note.title || 'Untitled Note'}</strong>
            <div className="note-preview">
              {note.summary || 'No preview yet.'}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="status-text">No notes yet. Tap + to begin.</p>}
      </section>
      <button className="fab" onClick={handleAdd}>
        +
      </button>
    </div>
  );
};

export default ClassNotes;
