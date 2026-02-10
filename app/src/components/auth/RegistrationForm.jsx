import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';

const defaultForm = {
  username: '',
  email: '',
  password: '',
};

const RegistrationForm = () => {
  const { register, statusMessage, setStatusMessage } = useAuth();
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    setError('');
    setStatusMessage('');
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await register(form);
      setForm(defaultForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="auth-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <h3>Secure Registration</h3>
      <p className="microcopy">Must use your @aui.ma email. Email verification is mandatory.</p>

      <label>
        Academic Alias
        <input name="username" value={form.username} onChange={handleChange} required />
      </label>

      <label>
        AUI Email
        <input
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          required
        />
      </label>

      <label>
        Password
        <input
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          required
          minLength={8}
        />
      </label>

      <button type="submit" className="btn-accent" disabled={submitting}>
        {submitting ? 'Securing...' : 'Create Account'}
      </button>

      {(error || statusMessage) && <p className={error ? 'text-error' : 'text-success'}>{error || statusMessage}</p>}
    </motion.form>
  );
};

export default RegistrationForm;
