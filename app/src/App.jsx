import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AuthHub from './pages/AuthHub';
import AuthComplete from './pages/AuthComplete';
import ProfileSetup from './pages/ProfileSetup';
import Dashboard from './pages/Dashboard';
import ClassNotes from './pages/ClassNotes';
import NoteEditor from './pages/NoteEditor';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AuthHub />} />
          <Route path="/auth/complete" element={<AuthComplete />} />
          <Route
            path="/setup"
            element={
              <ProtectedRoute>
                <ProfileSetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireProfile>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requireProfile>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute requireProfile>
                <Calendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/class/:classId"
            element={
              <ProtectedRoute requireProfile>
                <ClassNotes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/class/:classId/note/:noteId"
            element={
              <ProtectedRoute requireProfile>
                <NoteEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/template/new"
            element={
              <ProtectedRoute requireProfile>
                <NoteEditor />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
