const ScreenLoader = ({ note = 'Loading...' }) => {
  return (
    <div className="gate-shell">
      <div className="gate-card centered">
        <p className="status-text">{note}</p>
      </div>
    </div>
  );
};

export default ScreenLoader;
