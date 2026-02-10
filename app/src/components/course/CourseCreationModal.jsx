import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createCourse } from '../../services/enrollment';
import { useAuth } from '../../context/AuthContext';

const initialState = {
  code: '',
  section: '',
  semester: 'Fall',
  year: '26',
};

const CourseCreationModal = ({ open, onClose }) => {
  const { firebaseUser } = useAuth();
  const [form, setForm] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await createCourse(form, firebaseUser.uid);
      setSuccess('Course added to catalog.');
      setForm(initialState);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="modal-card"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
          >
            <header>
              <h3>Request New Course</h3>
              <button onClick={onClose} className="icon-btn" aria-label="Close modal">
                ×
              </button>
            </header>
            <p>Fill all four identifiers. The system enforces uniqueness.</p>
            <form onSubmit={handleSubmit} className="modal-grid">
              <label>
                Code
                <input name="code" value={form.code} onChange={handleChange} required placeholder="CSC 4137" />
              </label>
              <label>
                Section
                <input name="section" value={form.section} onChange={handleChange} required maxLength={2} />
              </label>
              <label>
                Semester
                <select name="semester" value={form.semester} onChange={handleChange}>
                  <option value="Fall">Fall</option>
                  <option value="Spring">Spring</option>
                  <option value="Summer">Summer</option>
                </select>
              </label>
              <label>
                Year
                <select name="year" value={form.year} onChange={handleChange}>
                  {['26', '27', '28', '29', '30'].map((yr) => (
                    <option key={yr}>{yr}</option>
                  ))}
                </select>
              </label>
              <button className="btn-accent" disabled={loading} type="submit">
                {loading ? 'Validating...' : 'Submit Request'}
              </button>
            </form>
            {error && <p className="text-error">{error}</p>}
            {success && <p className="text-success">{success}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CourseCreationModal;
