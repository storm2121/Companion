import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, rtdb, storage } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ref as dbRef, onValue, push, set } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import ScreenLoader from '../components/ui/ScreenLoader';

const CourseRoom = () => {
  const { courseId } = useParams();
  const { firebaseUser } = useAuth();
  const [course, setCourse] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const fetchCourse = async () => {
      const snap = await getDoc(doc(db, 'courses', courseId));
      setCourse(snap.exists() ? snap.data() : null);
      setLoading(false);
    };
    fetchCourse();
  }, [courseId]);

  useEffect(() => {
    const messagesRef = dbRef(rtdb, `courseRooms/${courseId}/messages`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const parsed = Object.values(data).sort((a, b) => a.createdAt - b.createdAt);
      setMessages(parsed);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return () => unsubscribe();
  }, [courseId]);

  const uploadAsset = async (file) => {
    if (!file) return null;
    const refPath = `course-media/${courseId}/${Date.now()}-${file.name}`;
    const ref = storageRef(storage, refPath);
    await uploadBytes(ref, file, {
      contentType: file.type || undefined,
      cacheControl: 'public,max-age=31536000,immutable',
    });
    return getDownloadURL(ref);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!firebaseUser) return;
    if (!text && !imageFile && !audioFile) return;
    setSending(true);
    const messagesRef = dbRef(rtdb, `courseRooms/${courseId}/messages`);
    try {
      const [imageUrl, audioUrl] = await Promise.all([uploadAsset(imageFile), uploadAsset(audioFile)]);
      const newMsg = {
        body: text,
        imageUrl,
        audioUrl,
        sender: firebaseUser.displayName || firebaseUser.email,
        senderId: firebaseUser.uid,
        createdAt: Date.now(),
      };
      const newRef = push(messagesRef);
      await set(newRef, newMsg);
      setText('');
      setImageFile(null);
      setAudioFile(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const courseTitle = useMemo(() => {
    if (!course) return '';
    return `${course.code} · Sec ${course.section} · ${course.semester} ${course.year}`;
  }, [course]);

  if (loading) {
    return <ScreenLoader note="Loading course room..." />;
  }

  if (!course) {
    return <p className="text-error">Course not found.</p>;
  }

  return (
    <div className="course-room-shell">
      <header className="room-head">
        <div>
          <p className="pill">Course Room</p>
          <h2>{courseTitle}</h2>
        </div>
      </header>
      <section className="chat-pane">
        {messages.map((message) => (
          <article key={message.createdAt + message.senderId} className="chat-message">
            <div className="avatar-circle">{message.sender.slice(0, 2).toUpperCase()}</div>
            <div className="bubble">
              <div className="meta">
                <span>{message.sender}</span>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              <p>{message.body}</p>
              {message.imageUrl && (
                <img src={message.imageUrl} alt="upload" className="chat-image" loading="lazy" />
              )}
              {message.audioUrl && (
                <audio controls className="chat-audio">
                  <source src={message.audioUrl} />
                </audio>
              )}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </section>
      <form className="chat-composer" onSubmit={handleSend}>
        <textarea
          placeholder="Type a focused update..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="composer-row">
          <label className="file-pill">
            Image
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} />
          </label>
          <label className="file-pill">
            Voice
            <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files[0])} />
          </label>
          <button className="btn-accent" type="submit" disabled={sending}>
            {sending ? 'Posting...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CourseRoom;
