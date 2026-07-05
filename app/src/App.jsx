import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ScreenLoader from './components/ui/ScreenLoader';
import AuthHub from './pages/AuthHub';
import AuthComplete from './pages/AuthComplete';
import ProfileSetup from './pages/ProfileSetup';
import Dashboard from './pages/Dashboard';
import ClassNotes from './pages/ClassNotes';

// Code-split the heavy editor (TipTap + canvas) and the secondary pages out of the
// main bundle: the dashboard boots lighter and dashboard <-> calendar navigation
// never re-downloads anything after the first visit.
const NoteEditor = lazy(() => import('./pages/NoteEditor'));
const Settings = lazy(() => import('./pages/Settings'));
const Calendar = lazy(() => import('./pages/Calendar'));

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<ScreenLoader note="Loading…" />}>
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
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
