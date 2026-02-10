import { motion } from 'framer-motion';
import { MAX_ACTIVE_COURSES, MAX_ADD_DROP } from '../../services/enrollment';

const AvailableCourseList = ({ courses, search, setSearch, onAdd, disabledReason }) => {
  return (
    <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <header className="panel-head">
        <div>
          <p className="pill">Catalog</p>
          <h2>Available Course List</h2>
        </div>
        <div className="catalog-meta">
          <p>Max active courses: {MAX_ACTIVE_COURSES}</p>
          <p>Add/drop allowance: {MAX_ADD_DROP}</p>
        </div>
      </header>
      <div className="search-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, section, or semester"
        />
      </div>
      <div className="catalog-grid">
        {courses.map((course) => (
          <article key={course.courseKey} className="course-card">
            <div>
              <p className="course-code">{course.code}</p>
              <p>
                Section {course.section} · {course.semester} {course.year}
              </p>
            </div>
            <button
              className="btn-accent"
              onClick={() => onAdd(course)}
              disabled={Boolean(disabledReason)}
              title={disabledReason || 'Add course'}
            >
              Add · Course Room
            </button>
          </article>
        ))}
        {courses.length === 0 && <p className="microcopy">No courses in catalog yet. Use “Request New Course”.</p>}
      </div>
    </motion.section>
  );
};

export default AvailableCourseList;
