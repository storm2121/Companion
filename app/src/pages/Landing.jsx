import { motion } from 'framer-motion';
import RegistrationForm from '../components/auth/RegistrationForm';
import LoginForm from '../components/auth/LoginForm';

const Landing = () => {
  return (
    <div className="landing-shell">
      <motion.section
        className="landing-hero"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9 }}
      >
        <div>
          <p className="lock-pill">@aui.ma gated</p>
          <h1>Companion · Course Intelligence</h1>
          <p className="lead">
            Dark Academia inspired workspace for managing course loads, crafting private chat rooms, and preserving
            discipline. Every entry is authenticated, every action tracked.
          </p>
        </div>
        <div className="forms-grid">
          <RegistrationForm />
          <LoginForm />
        </div>
      </motion.section>
    </div>
  );
};

export default Landing;
