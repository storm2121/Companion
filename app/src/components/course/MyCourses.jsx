import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const MyCourses = ({ activeCourses, remaining, onDrop }) => {
  return (
    <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <header className="panel-head">
        <div>
          <p className="pill alt">My Current Courses</p>
          <h2>Active Load</h2>
        </div>
        <div className="counter">
          <span>{remaining}</span>
          <p>changes remaining</p>
        </div>
      </header>
      <div className="my-course-grid">
        {activeCourses.map((course) => (
          <article key={course.courseKey} className="course-card active">
            <div>
              <p className="course-code">{course.code}</p>
              <p>
                Section {course.section} · {course.semester} {course.year}
              </p>
            </div>
            <div className="card-actions">
              <Link className="btn-link" to={`/course/${course.courseKey}`}>
                Enter Course Room
              </Link>
              <button className="btn-outline" onClick={() => onDrop(course.courseKey)}>
                Drop
              </button>
            </div>
          </article>
        ))}
        {activeCourses.length === 0 && (
          <p className="microcopy">You have no active courses. Add at least one from the catalog.</p>
        )}
      </div>
    </motion.section>
  );
};

export default MyCourses;
