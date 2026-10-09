const PublicLoader = ({ note = 'Checking your session…' }) => (
  <main className="pub-loading" id="main-content" tabIndex={-1} role="status">
    <p>{note}</p>
  </main>
);

export default PublicLoader;
