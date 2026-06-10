const ScreenLoader = ({ note = 'Loading...' }) => {
  return (
    <div className="gate-shell">
      <div className="gate-card centered screen-loader">
        <span className="screen-loader-spinner" aria-hidden="true" />
        <p className="screen-loader-text">{note}</p>
      </div>
    </div>
  );
};

export default ScreenLoader;
